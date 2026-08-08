from fastapi import APIRouter, Depends, Query, Header, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, List, AsyncGenerator
from sqlmodel import Session, select
from app.database import get_session
from app.api.auth import verify_user_access
from app.models import ActivityLog, FocusSession, ChatMessage, Document, DocumentChunk
from pydantic import BaseModel
from app.ai.engine import ai_engine
from app.ai.context import get_recent_context
from app.rag.retriever import retriever
import os
import json
import asyncio
from datetime import datetime, timedelta

router = APIRouter()

class ChatRequest(BaseModel):
    user_id: int
    message: str
    mode: str = "general"
    document_id: Optional[int] = None

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

async def ai_streaming_generator(user_id: int, prompt: str, context: str, history: list, mode: str, references: list):
    try:
        # 1. Yield citations immediately if present
        if references:
            yield "data: " + json.dumps({"references": references}) + "\n\n"
            await asyncio.sleep(0.05)
            
        full_text = ""
        async for chunk in ai_engine.stream(prompt, context, history, mode=mode):
            full_text += chunk
            yield "data: " + json.dumps({"token": chunk}) + "\n\n"
            
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
    
    # Determine RAG necessity
    rag_modes = ["notes", "quiz", "flashcards", "viva"]
    context = ""
    references = []
    
    # Check if local Ollama model is running and reachable
    if not ai_engine.health_check():
        return StreamingResponse(
            (f"data: {json.dumps({'error': 'OLLAMA_OFFLINE'})}\n\n" for _ in range(1)),
            media_type="text/event-stream"
        )
        
    # Summarize large document pipeline overrides standard chat flow
    if request.mode == "summarize" and request.document_id is not None:
        return StreamingResponse(
            summarize_document(request.document_id, request.user_id, session),
            media_type="text/event-stream"
        )
        
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
        ai_streaming_generator(request.user_id, request.message, context, history_list, request.mode, references),
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
    return {"status": "ok" if ai_engine.health_check() else "offline"}


