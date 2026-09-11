from fastapi import APIRouter, Depends, Query, Header, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, List, AsyncGenerator
from sqlmodel import Session, select
from app.database import get_session
from app.api.auth import verify_user_access
from app.models import ActivityLog, FocusSession, FocusSessionEvent, ChatMessage, Document, DocumentChunk
from pydantic import BaseModel
from app.ai.engine import ai_engine
from app.ai.context import get_recent_context
from app.rag.retriever import retriever
import os
import json
import asyncio
import base64
from io import BytesIO
from PIL import Image
from datetime import datetime, timedelta
from app.services.vision_ocr import screen_vision_processor

router = APIRouter()

class ChatRequest(BaseModel):
    user_id: int
    message: str
    mode: str = "general"
    document_id: Optional[int] = None
    image_base64: Optional[str] = None

async def save_assistant_message(user_id: int, content: str):
    from app.database import engine
    from app.models import ChatMessage
    with Session(engine) as session:
        assistant_msg = ChatMessage(user_id=user_id, role="assistant", content=content)
        session.add(assistant_msg)
        session.commit()

async def summarize_document(document_id: int, user_id: int, session: Session) -> AsyncGenerator[str, None]:
    yield "data: " + json.dumps({"token": "[Cortex: Preparing study materials for summarization...]\n\n"}) + "\n\n"
    await asyncio.sleep(0.1)
    
    statement = select(DocumentChunk).where(DocumentChunk.document_id == document_id).order_by(DocumentChunk.chunk_index.asc())
    chunks = session.exec(statement).all()
    
    if not chunks:
        yield "data: " + json.dumps({"token": "No study content found in this document to summarize."}) + "\n\n"
        return
        
    chunk_contents = [c.content for c in chunks]
    
    # Check if small or large document
    if len(chunks) <= 3:
        yield "data: " + json.dumps({"token": "[Cortex: Document is small. Generating summary...]\n\n"}) + "\n\n"
        await asyncio.sleep(0.1)
        combined_text = "\n\n".join(chunk_contents)
        context = f"=== STUDY MATERIAL ===\n{combined_text}\n======================"
        
        full_text = ""
        async for chunk in ai_engine.stream("Summarize this document.", context, [], mode="summarize"):
            full_text += chunk
            yield "data: " + json.dumps({"token": chunk}) + "\n\n"
        if full_text:
            await save_assistant_message(user_id, full_text)
    else:
        # Large document pipeline: chunk summaries -> aggregate summaries -> final structured summary
        yield "data: " + json.dumps({"token": f"[Cortex: Large document detected ({len(chunks)} chunks). Performing chunk-level analysis...]\n\n"}) + "\n\n"
        await asyncio.sleep(0.1)
        
        # Group chunks by 3
        group_summaries = []
        group_size = 3
        groups = [chunk_contents[i:i + group_size] for i in range(0, len(chunk_contents), group_size)]
        
        for idx, g in enumerate(groups):
            yield "data: " + json.dumps({"token": f"[Cortex: Analyzing section {idx+1}/{len(groups)}...]\n\n"}) + "\n\n"
            await asyncio.sleep(0.05)
            combined_group = "\n\n".join(g)
            prompt = f"Write a concise 3-sentence summary of the following section of a study document:\n\n{combined_group}"
            summary_part = await ai_engine.generate(prompt, "", [], mode="general")
            group_summaries.append(summary_part)
            
        yield "data: " + json.dumps({"token": "[Cortex: Sections analyzed. Aggregating summaries and creating final outline...]\n\n"}) + "\n\n"
        await asyncio.sleep(0.1)
        
        # Aggregate summaries
        aggregated_text = "\n\n".join(group_summaries)
        context = f"=== AGGREGATED SECTION SUMMARIES ===\n{aggregated_text}\n===================================="
        
        full_text = ""
        async for chunk in ai_engine.stream("Generate the final structured outline and summary.", context, [], mode="summarize"):
            full_text += chunk
            yield "data: " + json.dumps({"token": chunk}) + "\n\n"
        if full_text:
            await save_assistant_message(user_id, full_text)

async def generate_structured_gen(prompt: str, context: str, history: list, mode: str, user_id: int) -> AsyncGenerator[str, None]:
    yield "data: " + json.dumps({"token": "[Cortex: Generating study challenge cards...]\n\n"}) + "\n\n"
    await asyncio.sleep(0.1)
    
    raw_response = ""
    try:
        async for chunk in ai_engine.stream(prompt, context, history, mode=mode):
            raw_response += chunk
            
        # Clean potential markdown block formatting
        cleaned_response = raw_response.strip()
        if cleaned_response.startswith("```"):
            lines = cleaned_response.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned_response = "\n".join(lines).strip()
            
        # Validate JSON array structure
        try:
            parsed = json.loads(cleaned_response)
            if not isinstance(parsed, list):
                raise ValueError("Response is not a JSON array")
                
            yield "data: " + json.dumps({"token": json.dumps(parsed)}) + "\n\n"
            await save_assistant_message(user_id, json.dumps(parsed))
        except Exception as e:
            print(f"[StructuredGen] JSON Validation Failed. Error: {str(e)}. Raw: {raw_response}")
            if mode == "quiz":
                fallback = [
                    {
                        "question": "Failed to parse interactive questions. Here is the raw response text.",
                        "options": ["Review Material", "Retry Query", "Report Bug", "N/A"],
                        "correct_answer": "Review Material",
                        "explanation": f"Raw Output: {raw_response[:300]}"
                    }
                ]
            else:
                fallback = [
                    {
                        "front": "Parsing Failed",
                        "back": f"Raw output: {raw_response[:200]}"
                    }
                ]
            yield "data: " + json.dumps({"token": json.dumps(fallback)}) + "\n\n"
            await save_assistant_message(user_id, json.dumps(fallback))
            
    except Exception as e:
        yield "data: " + json.dumps({"error": f"Failed to complete generation: {str(e)}"}) + "\n\n"

async def ai_streaming_generator(user_id: int, prompt: str, context: str, history: list, mode: str, references: list, image_base64: Optional[str] = None):
    try:
        if image_base64:
            print(f"[ASSISTANT] image_base64 received: True", flush=True)
            print(f"[ASSISTANT] image_base64 length: {len(image_base64)}", flush=True)
            try:
                # Run OCR to get text from the image before sending to AI
                header, encoded = image_base64.split(",", 1) if "," in image_base64 else ("", image_base64)
                image_data = base64.b64decode(encoded)
                pil_image = Image.open(BytesIO(image_data))
                print(f"[VISION] Image decoded successfully", flush=True)
                print(f"[VISION] dimensions = {pil_image.width} x {pil_image.height}", flush=True)
                
                print(f"[OCR] Starting OCR", flush=True)
                processed_np = screen_vision_processor.preprocess_image(pil_image)
                ocr_results = screen_vision_processor.run_ocr(processed_np)
                print(f"[OCR] OCR completed", flush=True)
                
                if ocr_results:
                    extracted_text = " ".join([item["text"] for item in ocr_results])
                    print(f"[OCR] Extracted text: {extracted_text[:100]}...", flush=True)
                    if extracted_text.strip():
                        prompt = f"User uploaded a screenshot. The system extracted the following text from it via OCR:\n\n=== EXTRACTED TEXT ===\n{extracted_text}\n======================\n\nUser request: {prompt}"
                        print(f"[ASSISTANT] OCR text length: {len(extracted_text)}", flush=True)
                        print(f"[ASSISTANT] OCR text successfully injected into prompt", flush=True)
            except Exception as e:
                print(f"[OCR] Failed to extract text from attached image in chat stream: {str(e)}", flush=True)

        # 1. Yield citations immediately if present
        if references:
            yield "data: " + json.dumps({"references": references}) + "\n\n"
            await asyncio.sleep(0.05)
            
        full_text = ""
        print("[STREAM] Generation started", flush=True)
        token_count = 0
        async for chunk in ai_engine.stream(prompt, context, history, mode=mode, image_base64=None):
            if token_count == 0:
                print("[STREAM] Token received", flush=True)
            token_count += 1
            full_text += chunk
            yield "data: " + json.dumps({"token": chunk}) + "\n\n"
            await asyncio.sleep(0.01)  # small yield
            
        print("[STREAM] Generation completed", flush=True)
        if full_text:
            await save_assistant_message(user_id, full_text)
            
    except Exception as e:
        print(f"AI Engine error: {str(e)}.")
        yield "data: " + json.dumps({"error": "AI model is currently unavailable."}) + "\n\n"

@router.post("/chat")
def chat_stream(request: ChatRequest, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    # Verify user access
    verify_user_access(request.user_id, authorization, session)
    
    # Save user message to database
    user_msg = ChatMessage(user_id=request.user_id, role="user", content=request.message)
    session.add(user_msg)
    session.commit()
    
    # Fetch chat history (excluding current user message)
    history_statement = select(ChatMessage).where(ChatMessage.user_id == request.user_id).order_by(ChatMessage.created_at.desc()).limit(11)
    history_msgs = session.exec(history_statement).all()
    history_msgs.reverse()
    
    history_list = [{"role": msg.role, "content": msg.content} for msg in history_msgs if msg.id != user_msg.id]
    
    # Check if AI provider model is running and reachable
    if not ai_engine.health_check():
        import os
        provider = os.getenv("AI_PROVIDER", "ollama").lower()
        err_code = "OPENAI_NOT_CONFIGURED" if provider == "openai" else "OLLAMA_OFFLINE"
        return StreamingResponse(
            (f"data: {json.dumps({'error': err_code})}\n\n" for _ in range(1)),
            media_type="text/event-stream"
        )
        
    # Intercept "Summarize my last study session" triggers
    message_clean = request.message.lower().strip().rstrip(".?!")
    if message_clean == "summarize my last study session":
        # Retrieve latest completed focus session
        last_sess_stmt = select(FocusSession).where(
            FocusSession.user_id == request.user_id, 
            FocusSession.completed == True
        ).order_by(FocusSession.ended_at.desc())
        last_sess = session.exec(last_sess_stmt).first()
        
        if not last_sess:
            async def no_session_gen():
                no_session_text = "No completed study session is available yet."
                yield "data: " + json.dumps({"token": no_session_text}) + "\n\n"
                await save_assistant_message(request.user_id, no_session_text)
            return StreamingResponse(no_session_gen(), media_type="text/event-stream")
            
        # Get timeline events for this session
        evts_stmt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == last_sess.id).order_by(FocusSessionEvent.start_time.asc())
        events = session.exec(evts_stmt).all()
        
        # Calculate session analytics
        study_seconds = sum(e.duration for e in events if e.state == "STUDY")
        distr_seconds = sum(e.duration for e in events if e.state == "DISTRACTION")
        idle_seconds = sum(e.duration for e in events if e.state == "IDLE")
        
        timeline_summary = []
        for e in events:
            timeline_summary.append(f"- {e.state} on App '{e.app_name}' (Window: '{e.window_title}') for {e.duration}s")
            
        # Build RAG-style study session grounding context
        session_context = (
            f"=== COMPLETED STUDY SESSION ===\n"
            f"Intention: {last_sess.intention}\n"
            f"Started At: {last_sess.started_at.strftime('%Y-%m-%d %H:%M:%S') if last_sess.started_at else 'Unknown'}\n"
            f"Ended At: {last_sess.ended_at.strftime('%Y-%m-%d %H:%M:%S') if last_sess.ended_at else 'Unknown'}\n"
            f"Verified Focus Duration: {study_seconds // 60}m {study_seconds % 60}s\n"
            f"Distraction Duration: {distr_seconds // 60}m {distr_seconds % 60}s\n"
            f"Idle Duration: {idle_seconds // 60}m {idle_seconds % 60}s\n\n"
            f"Timeline Events:\n" + "\n".join(timeline_summary) + "\n"
            f"================================="
        )
        
        prompt = (
            "Summarize the study session metrics, highlight when the user was focused versus distracted, "
            "and provide 2 productivity coaching tips based on this session."
        )
        
        return StreamingResponse(
            ai_streaming_generator(request.user_id, prompt, session_context, [], "summarize", []),
            media_type="text/event-stream"
        )
        
    # Summarize large document pipeline overrides standard chat flow
    if request.mode == "summarize" and request.document_id is not None:
        return StreamingResponse(
            summarize_document(request.document_id, request.user_id, session),
            media_type="text/event-stream"
        )
    # Determine RAG necessity
    rag_modes = ["notes", "quiz", "flashcards", "viva"]
    context = ""
    references = []
    
    if request.mode in rag_modes:
        # Search index
        retrieved = retriever.retrieve(
            session=session, 
            query=request.message, 
            user_id=request.user_id, 
            document_id=request.document_id, 
            top_k=5
        )
        
        # Strict grounding filter for Ask My Notes
        if request.mode == "notes" and not retrieved:
            # Return early refusal
            async def refusal_generator():
                refusal_text = "The answer is not available in your uploaded study material."
                yield "data: " + json.dumps({"token": refusal_text}) + "\n\n"
                await save_assistant_message(request.user_id, refusal_text)
                
            return StreamingResponse(refusal_generator(), media_type="text/event-stream")
            
        context = retriever.build_rag_context(retrieved)
        references = [
            {
                "filename": r["filename"],
                "page": r["page_number"],
                "chunk": r["chunk_index"]
            }
            for r in retrieved
        ]
        
    elif request.mode == "general":
        # Pull standard recent desktop details for grounding the study coach
        context = get_recent_context(request.user_id, session)
        
    # Handle structured challenges
    if request.mode in ["quiz", "flashcards"]:
        return StreamingResponse(
            generate_structured_gen(request.message, context, history_list, request.mode, request.user_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
        
    return StreamingResponse(
        ai_streaming_generator(request.user_id, request.message, context, history_list, request.mode, references, request.image_base64),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/history/{user_id}")
def get_chat_history(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(ChatMessage).where(ChatMessage.user_id == user_id).order_by(ChatMessage.created_at.asc())
    return session.exec(statement).all()

@router.delete("/history/{user_id}")
def clear_chat_history(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(ChatMessage).where(ChatMessage.user_id == user_id)
    messages = session.exec(statement).all()
    for m in messages:
        session.delete(m)
    session.commit()
    return {"status": "success", "message": "Chat history cleared."}

@router.get("/health")
def assistant_health():
    import os
    import urllib.request
    import json
    from app.ai.factory import ai_factory
    
    status = ai_engine.get_detailed_status()
    models_list = []
    
    try:
        engine = ai_factory.get_engine()
        provider = os.getenv("AI_PROVIDER", "ollama").lower()
        if provider == "ollama" and hasattr(engine, "base_url"):
            url = f"{engine.base_url}/api/tags"
            with urllib.request.urlopen(url, timeout=2) as res:
                data = json.loads(res.read().decode("utf-8"))
                models_list = [m["name"] for m in data.get("models", [])]
    except Exception:
        pass

    return {
        "status": status,
        "model_name": ai_factory.model_name,
        "models_available": models_list
    }


