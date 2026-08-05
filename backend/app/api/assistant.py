from fastapi import APIRouter, Depends, Query, Header
from fastapi.responses import StreamingResponse
from typing import Optional, List
from sqlmodel import Session, select
from app.database import get_session
from app.api.auth import verify_user_access
from app.models import ActivityLog, FocusSession, ChatMessage
from pydantic import BaseModel
from openai import AsyncOpenAI
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
import os
import asyncio
from datetime import datetime, timedelta

router = APIRouter()

class ChatRequest(BaseModel):
    user_id: int
    message: str

def get_recent_context(user_id: int, session: Session) -> str:
    # Get last 5 active logs
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id).order_by(ActivityLog.timestamp.desc()).limit(5)
    logs = session.exec(statement).all()
    
    log_summary = ", ".join([f"{l.app_name} ({l.duration_seconds}s, {l.category})" for l in logs])
    
    # Get active session
    active_statement = select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.completed == False)
    active_sess = session.exec(active_statement).first()
    
    intent_str = f"Active intention: '{active_sess.intention}'" if active_sess else "No active focus session."
    
    return f"Recent Activity: [{log_summary if log_summary else 'No recent logs'}]. {intent_str}"

async def save_assistant_message(user_id: int, content: str):
    from app.database import engine
    from app.models import ChatMessage
    with Session(engine) as session:
        assistant_msg = ChatMessage(user_id=user_id, role="assistant", content=content)
        session.add(assistant_msg)
        session.commit()

async def fallback_contextual_advice(user_id: int, prompt: str, context: str, error_msg: Optional[str] = None):
    # Rule-based context analyzer providing premium response fallback
    analysis = "Analyzing your workspace offline..."
    yield analysis + "\n\n"
    await asyncio.sleep(0.3)
    
    # Analyze the context details (e.g. active apps, intention)
    intent = "unknown"
    if "Active intention:" in context:
        parts = context.split("Active intention:")
        if len(parts) > 1:
            intent = parts[1].replace("'", "").strip()
            
    recent_apps = []
    if "Recent Activity: [" in context:
        apps_part = context.split("Recent Activity: [")[1].split("]")[0]
        if apps_part:
            recent_apps = [a.split("(")[0].strip() for a in apps_part.split(",") if a]

    yield "### Cortex Local Workspace Insights\n"
    await asyncio.sleep(0.2)
    
    if intent != "unknown" and intent != "No active focus session.":
        yield f"- **Active Intention**: You are currently focused on *\"{intent}\"*.\n"
        await asyncio.sleep(0.2)
    else:
        yield "- **Focus Intention**: No active Pomodoro sprint running right now. Type `start focus` or use the Focus tab to declare one.\n"
        await asyncio.sleep(0.2)
        
    if recent_apps:
        unique_apps = list(set(recent_apps))
        yield f"- **Recent Apps**: I detected activity in `{', '.join(unique_apps)}`.\n"
        await asyncio.sleep(0.2)
        
    if error_msg:
        yield f"\n*Note: Your GEMINI_API_KEY was detected, but the Gemini API returned an error: `{error_msg}`. Please check your billing/rate limits on Google AI Studio.*"
    else:
        yield "\n*Note: To enable full AI intelligence, please ensure GEMINI_API_KEY or OPENAI_API_KEY is configured in backend/.env. For now, I am monitoring your flow locally to protect your focus.*"
    
    # Save the assistant response
    note_text = f"Note: Your GEMINI_API_KEY was detected, but the API returned an error: {error_msg}." if error_msg else "Note: To enable full AI intelligence, please ensure GEMINI_API_KEY or OPENAI_API_KEY is configured."
    full_fallback_text = (
        f"### Cortex Local Workspace Insights\n"
        f"- Active Intention: {intent}\n"
        f"- Recent Apps: {', '.join(list(set(recent_apps))) if recent_apps else 'None'}\n\n"
        f"{note_text}"
    )
    await save_assistant_message(user_id, full_fallback_text)

async def ai_streaming_generator(user_id: int, prompt: str, context: str, history: list):
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    
    system_instructions = f"""
    You are Cortex, an advanced AI productivity operating system assistant.
    You have context about the user's desktop state.
    
    USER DESKTOP CONTEXT:
    {context}
    
    Provide professional, minimal, direct workspace advice in a matte black SaaS visual style (B&W tone, short sentences, engineering minded).
    """
    
    try:
        if gemini_key:
            # Use native Google Generative AI SDK
            genai.configure(api_key=gemini_key)
            
            gemini_history = []
            for h in history:
                role = "user" if h["role"] == "user" else "model"
                gemini_history.append({
                    "role": role,
                    "parts": [h["content"]]
                })
                
            model = genai.GenerativeModel(
                model_name="gemini-2.0-flash",
                system_instruction=system_instructions
            )
            
            chat = model.start_chat(history=gemini_history)
            
            response = await chat.send_message_async(prompt, stream=True)
            
            full_text = ""
            async for chunk in response:
                try:
                    if chunk.text:
                        full_text += chunk.text
                        yield chunk.text
                except (ValueError, IndexError, AttributeError):
                    # Handle safety blocks where chunk.text is unavailable
                    pass
                    
            if full_text:
                await save_assistant_message(user_id, full_text)
                
        elif openai_key:
            client = AsyncOpenAI(api_key=openai_key)
            model = "gpt-4o-mini"
            messages = [{"role": "system", "content": system_instructions}]
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
            messages.append({"role": "user", "content": prompt})

            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True
            )
            
            full_text = ""
            async for chunk in response:
                if chunk.choices and chunk.choices[0].delta.content:
                    text = chunk.choices[0].delta.content
                    full_text += text
                    yield text
                    
            if full_text:
                await save_assistant_message(user_id, full_text)
        else:
            async for chunk in fallback_contextual_advice(user_id, prompt, context):
                yield chunk
            return
            
    except ResourceExhausted as e:
        print(f"Gemini rate limit/quota error: {str(e)}. Falling back to local advice.")
        error_detail = "Rate limit or quota exceeded. Please check your Google AI Studio billing/plan limits, or try again in a few moments."
        async for chunk in fallback_contextual_advice(user_id, prompt, context, error_msg=error_detail):
            yield chunk
    except Exception as e:
        print(f"AI Provider error: {str(e)}. Falling back to local advice.")
        async for chunk in fallback_contextual_advice(user_id, prompt, context, error_msg=str(e)):
            yield chunk

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
    
    context = get_recent_context(request.user_id, session)
    return StreamingResponse(
        ai_streaming_generator(request.user_id, request.message, context, history_list),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/history/{user_id}")
def get_chat_history(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    # Retrieve past conversation history
    statement = select(ChatMessage).where(ChatMessage.user_id == user_id).order_by(ChatMessage.created_at.asc())
    return session.exec(statement).all()

@router.delete("/history/{user_id}")
def clear_chat_history(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    # Delete past conversation history
    statement = select(ChatMessage).where(ChatMessage.user_id == user_id)
    messages = session.exec(statement).all()
    for m in messages:
        session.delete(m)
    session.commit()
    return {"status": "success", "message": "Chat history cleared."}


