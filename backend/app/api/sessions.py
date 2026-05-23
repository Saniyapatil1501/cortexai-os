from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.database import get_session
from app.models import FocusSession
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class SessionStart(BaseModel):
    user_id: int
    intention: str

class SessionEnd(BaseModel):
    session_id: int
    completed: bool
    distraction_count: int

@router.post("/start")
def start_session(data: SessionStart, session: Session = Depends(get_session)):
    # Terminate any active focus sessions first
    statement = select(FocusSession).where(FocusSession.user_id == data.user_id, FocusSession.completed == False)
    active_sessions = session.exec(statement).all()
    for s in active_sessions:
        s.completed = True
        s.ended_at = datetime.utcnow()
        session.add(s)
        
    focus_sess = FocusSession(
        user_id=data.user_id,
        intention=data.intention,
        started_at=datetime.utcnow()
    )
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    return focus_sess

@router.post("/end")
def end_session(data: SessionEnd, session: Session = Depends(get_session)):
    focus_sess = session.get(FocusSession, data.session_id)
    if not focus_sess:
        raise HTTPException(status_code=404, detail="Focus session not found")
        
    focus_sess.ended_at = datetime.utcnow()
    focus_sess.completed = data.completed
    
    # Query actual distractions from ActivityLog during this session
    from app.models import ActivityLog
    distraction_stmt = select(ActivityLog).where(
        ActivityLog.user_id == focus_sess.user_id,
        ActivityLog.timestamp >= focus_sess.started_at,
        ActivityLog.category == "distraction"
    )
    distractions = session.exec(distraction_stmt).all()
    focus_sess.distraction_count = len(distractions)
    
    # Calculate duration
    delta = focus_sess.ended_at - focus_sess.started_at
    focus_sess.duration_seconds = int(delta.total_seconds())
    
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    return focus_sess

@router.get("/active/{user_id}")
def get_active_session(user_id: int, session: Session = Depends(get_session)):
    statement = select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.completed == False)
    return session.exec(statement).first()
