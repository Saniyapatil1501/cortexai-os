from fastapi import APIRouter, Depends, HTTPException, Header
from sqlmodel import Session, select
from app.database import get_session
from app.models import FocusSession
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from app.api.auth import verify_user_access

router = APIRouter()

class SessionStart(BaseModel):
    user_id: int
    intention: str
    target_duration_seconds: Optional[int] = 1500

class SessionEnd(BaseModel):
    session_id: int
    completed: bool
    distraction_count: int

@router.post("/start")
def start_session(data: SessionStart, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    # Verify user access
    verify_user_access(data.user_id, authorization, session)
    
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
        started_at=datetime.utcnow(),
        target_duration_seconds=data.target_duration_seconds
    )
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    return focus_sess

@router.post("/end")
def end_session(data: SessionEnd, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    focus_sess = session.get(FocusSession, data.session_id)
    if not focus_sess:
        raise HTTPException(status_code=404, detail="Focus session not found")
        
    # Verify user access on focus session owner
    verify_user_access(focus_sess.user_id, authorization, session)
        
    focus_sess.ended_at = datetime.utcnow()
    focus_sess.completed = data.completed
    
    # Query actual distractions from ActivityLog during this session
    from app.models import ActivityLog
    logs_statement = select(ActivityLog).where(
        ActivityLog.user_id == focus_sess.user_id,
        ActivityLog.timestamp >= focus_sess.started_at
    )
    logs = session.exec(logs_statement).all()
    
    # Calculate distractions using state-transition logic chronologically
    sorted_logs = sorted(logs, key=lambda x: x.timestamp)
    distractions = 0
    last_was_distraction = False
    last_distraction_app = None
    for l in sorted_logs:
        if l.category == "distraction":
            if not last_was_distraction or (last_distraction_app and l.app_name != last_distraction_app):
                distractions += 1
            last_was_distraction = True
            last_distraction_app = l.app_name
        else:
            last_was_distraction = False
            last_distraction_app = None
            
    focus_sess.distraction_count = distractions
    
    # Calculate duration
    delta = focus_sess.ended_at - focus_sess.started_at
    focus_sess.duration_seconds = int(delta.total_seconds())
    
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    
    # Query dynamic logs for completion statistics (limited to session boundaries)
    session_logs = [l for l in logs if l.timestamp <= focus_sess.ended_at]
    sorted_session_logs = sorted(session_logs, key=lambda x: x.timestamp)
    
    idles = sum(1 for l in sorted_session_logs if l.category == "idle")
    
    # Count actual active app-to-app swaps
    swaps = 0
    last_app = None
    for l in sorted_session_logs:
        if l.category not in ["idle", "unclassified"]:
            if last_app and l.app_name != last_app:
                swaps += 1
            last_app = l.app_name
    
    res = focus_sess.dict()
    res["app_swaps"] = swaps
    res["idle_count"] = idles
    return res

@router.get("/active/{user_id}")
def get_active_session(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.completed == False)
    active_sess = session.exec(statement).first()
    if not active_sess:
        return None
        
    # Calculate distractions, swaps and idles dynamically from ActivityLogs
    from app.models import ActivityLog
    logs_statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id,
        ActivityLog.timestamp >= active_sess.started_at
    )
    logs = session.exec(logs_statement).all()
    
    sorted_logs = sorted(logs, key=lambda x: x.timestamp)
    
    distractions = 0
    last_was_distraction = False
    last_distraction_app = None
    for l in sorted_logs:
        if l.category == "distraction":
            if not last_was_distraction or (last_distraction_app and l.app_name != last_distraction_app):
                distractions += 1
            last_was_distraction = True
            last_distraction_app = l.app_name
        else:
            last_was_distraction = False
            last_distraction_app = None
            
    idles = sum(1 for l in sorted_logs if l.category == "idle")
    
    # Count actual active app-to-app swaps
    swaps = 0
    last_app = None
    for l in sorted_logs:
        if l.category not in ["idle", "unclassified"]:
            if last_app and l.app_name != last_app:
                swaps += 1
            last_app = l.app_name
    
    res = active_sess.dict()
    res["distraction_count"] = distractions
    res["app_swaps"] = swaps
    res["idle_count"] = idles
    return res

