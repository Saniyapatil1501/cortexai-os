from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
from app.database import get_session
from app.models import ActivityLog, FocusSession, ChatMessage
from pydantic import BaseModel
from openai import OpenAI
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

async def mock_streaming_generator(user_id: int, prompt: str):
    response_words = f"Simulating Cortex AI context insights. To stream real responses, please set GEMINI_API_KEY or OPENAI_API_KEY in your env variables. You asked: '{prompt}'".split()
    full_text = ""
    for word in response_words:
        text = word + " "
        full_text += text
        yield text
        await asyncio.sleep(0.08)
    await save_assistant_message(user_id, full_text.strip())

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
            # Use OpenAI compatibility interface for Google Gemini
            client = OpenAI(
                api_key=gemini_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
            )
            model = "gemini-1.5-flash"
        elif openai_key:
            client = OpenAI(api_key=openai_key)
            model = "gpt-4o-mini"
        else:
            async for chunk in mock_streaming_generator(user_id, prompt):
                yield chunk
            return

        messages = [{"role": "system", "content": system_instructions}]
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": prompt})

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )
        
        full_text = ""
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                full_text += text
                yield text
                
        if full_text:
            await save_assistant_message(user_id, full_text)
            
    except Exception as e:
        err_msg = f"Error connecting to AI Provider: {str(e)}"
        yield err_msg
        await save_assistant_message(user_id, err_msg)

@router.post("/chat")
def chat_stream(request: ChatRequest, session: Session = Depends(get_session)):
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
        media_type="text/plain"
    )

@router.get("/history/{user_id}")
def get_chat_history(user_id: int, session: Session = Depends(get_session)):
    # Retrieve past conversation history
    statement = select(ChatMessage).where(ChatMessage.user_id == user_id).order_by(ChatMessage.created_at.asc())
    return session.exec(statement).all()

