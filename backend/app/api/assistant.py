from fastapi import APIRouter, Depends, Query, Header
from fastapi.responses import StreamingResponse
from typing import Optional, List
from sqlmodel import Session, select
from app.database import get_session
from app.api.auth import verify_user_access
from app.models import ActivityLog, FocusSession, ChatMessage
from pydantic import BaseModel
from app.ai.engine import ai_engine
from app.ai.context import get_recent_context
import os
import asyncio
from datetime import datetime, timedelta

router = APIRouter()

class ChatRequest(BaseModel):
    user_id: int
    message: str

async def save_assistant_message(user_id: int, content: str):
    from app.database import engine
    from app.models import ChatMessage
    with Session(engine) as session:
        assistant_msg = ChatMessage(user_id=user_id, role="assistant", content=content)
        session.add(assistant_msg)
        session.commit()

async def ai_streaming_generator(user_id: int, prompt: str, context: str, history: list):
    try:
        full_text = ""
        async for chunk in ai_engine.stream(prompt, context, history):
            full_text += chunk
            yield chunk
            
        if full_text:
            await save_assistant_message(user_id, full_text)
            
    except Exception as e:
        print(f"AI Engine error: {str(e)}.")
        error_msg = "Error connecting to AI Engine."
        yield error_msg

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


