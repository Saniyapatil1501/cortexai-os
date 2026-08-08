from fastapi import APIRouter, Depends, HTTPException, Header
from sqlmodel import Session, select
from app.database import get_session
from app.models import FocusSession, FocusSessionEvent, UserFeedbackCorrection
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List
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

class FeedbackCorrectionRequest(BaseModel):
    user_id: int
    app_name: str
    window_title: str
    study_goal: str
    predicted_label: str
    corrected_label: str

def calculate_session_analytics(session_id: int, db_session: Session) -> dict:
    stmt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == session_id).order_by(FocusSessionEvent.start_time.asc())
    events = db_session.exec(stmt).all()
    
    study_secs = 0
    distr_secs = 0
    idle_secs = 0
    unknown_secs = 0
    
    pause_count = 0
    longest_study = 0
    longest_distr = 0
    
    productive_counts = {}
    distracting_counts = {}
    
    for e in events:
        d = e.duration
        if e.state == "STUDY":
            study_secs += d
            longest_study = max(longest_study, d)
            if e.app_name:
                productive_counts[e.app_name] = productive_counts.get(e.app_name, 0) + d
        elif e.state == "DISTRACTION":
            distr_secs += d
            longest_distr = max(longest_distr, d)
            pause_count += 1
            if e.app_name:
                distracting_counts[e.app_name] = distracting_counts.get(e.app_name, 0) + d
        elif e.state == "IDLE":
            idle_secs += d
            pause_count += 1
        elif e.state == "UNKNOWN":
            unknown_secs += d
            pause_count += 1
            
    total_secs = study_secs + distr_secs + idle_secs + unknown_secs
    focus_pct = round((study_secs / total_secs * 100), 2) if total_secs > 0 else 0.0
    
    top_prod = sorted(productive_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    top_dist = sorted(distracting_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    
    return {
        "verified_focus_seconds": study_secs,
        "distraction_seconds": distr_secs,
        "idle_seconds": idle_secs,
        "unknown_seconds": unknown_secs,
        "total_duration_seconds": total_secs,
        "focus_percentage": focus_pct,
        "pause_count": pause_count,
        "longest_focus_streak": longest_study,
        "longest_distraction": longest_distr,
        "top_productive_contexts": [{"app": k, "duration": v} for k, v in top_prod],
        "top_distracting_contexts": [{"app": k, "duration": v} for k, v in top_dist]
    }

@router.post("/start")
def start_session(data: SessionStart, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    verify_user_access(data.user_id, authorization, session)
    
    # Terminate active focus sessions
    statement = select(FocusSession).where(FocusSession.user_id == data.user_id, FocusSession.completed == False)
    active_sessions = session.exec(statement).all()
    for s in active_sessions:
        s.completed = True
        s.ended_at = datetime.utcnow()
        session.add(s)
        
        # Close open event segments
        stmt_evt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == s.id).order_by(FocusSessionEvent.end_time.desc())
        last_evt = session.exec(stmt_evt).first()
        if last_evt:
            last_evt.end_time = s.ended_at
            last_evt.duration = int((s.ended_at - last_evt.start_time).total_seconds())
            session.add(last_evt)
            
    focus_sess = FocusSession(
        user_id=data.user_id,
        intention=data.intention,
        started_at=datetime.utcnow(),
        target_duration_seconds=data.target_duration_seconds
    )
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    
    # Write initial STUDY started event segment
    start_event = FocusSessionEvent(
        session_id=focus_sess.id,
        state="STUDY",
        start_time=focus_sess.started_at,
        end_time=focus_sess.started_at,
        duration=0,
        app_name="System",
        window_title="Session Started",
        classification="study",
        confidence=1.0,
        classification_reason="Session initiated by user."
    )
    session.add(start_event)
    session.commit()
    
    return focus_sess

@router.post("/end")
def end_session(data: SessionEnd, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    focus_sess = session.get(FocusSession, data.session_id)
    if not focus_sess:
        raise HTTPException(status_code=404, detail="Focus session not found")
        
    verify_user_access(focus_sess.user_id, authorization, session)
        
    focus_sess.ended_at = datetime.utcnow()
    focus_sess.completed = data.completed
    
    # Fetch previous segment and close it
    stmt_evt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == focus_sess.id).order_by(FocusSessionEvent.end_time.desc())
    last_evt = session.exec(stmt_evt).first()
    if last_evt:
        last_evt.end_time = focus_sess.ended_at
        last_evt.duration = int((focus_sess.ended_at - last_evt.start_time).total_seconds())
        session.add(last_evt)
        
    # Write final ended event segment
    is_completed = focus_sess.duration_seconds >= focus_sess.target_duration_seconds
    end_state = "TARGET_COMPLETED" if is_completed else "SESSION_ENDED"
    
    end_event = FocusSessionEvent(
        session_id=focus_sess.id,
        state=end_state,
        start_time=focus_sess.ended_at,
        end_time=focus_sess.ended_at,
        duration=0,
        app_name="System",
        window_title="Target Reached" if is_completed else "Session Ended",
        classification="idle",
        confidence=1.0,
        classification_reason="Session stopped manually."
    )
    session.add(end_event)
    session.commit()
    
    # Calculate final verified focus analytics
    analytics = calculate_session_analytics(focus_sess.id, session)
    focus_sess.duration_seconds = analytics["verified_focus_seconds"]
    
    session.add(focus_sess)
    session.commit()
    session.refresh(focus_sess)
    
    res = focus_sess.dict()
    res.update(analytics)
    return res

@router.get("/active/{user_id}")
def get_active_session(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.completed == False)
    active_sess = session.exec(statement).first()
    if not active_sess:
        return None
        
    # Calculate analytics on current active events segments
    analytics = calculate_session_analytics(active_sess.id, session)
    
    res = active_sess.dict()
    res.update(analytics)
    res["duration_seconds"] = analytics["verified_focus_seconds"]
    return res

@router.get("/timeline/{session_id}")
def get_session_timeline(
    session_id: int, 
    session: Session = Depends(get_session), 
    authorization: Optional[str] = Header(None)
):
    focus_sess = session.get(FocusSession, session_id)
    if not focus_sess:
        raise HTTPException(status_code=404, detail="Focus session not found")
    verify_user_access(focus_sess.user_id, authorization, session)
    
    statement = select(FocusSessionEvent).where(FocusSessionEvent.session_id == session_id).order_by(FocusSessionEvent.start_time.asc())
    return session.exec(statement).all()

@router.post("/correct")
def save_correction(data: FeedbackCorrectionRequest, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    verify_user_access(data.user_id, authorization, session)
    
    correction = UserFeedbackCorrection(
        user_id=data.user_id,
        app_name=data.app_name,
        window_title=data.window_title,
        study_goal=data.study_goal,
        predicted_label=data.predicted_label,
        corrected_label=data.corrected_label
    )
    session.add(correction)
    session.commit()
    session.refresh(correction)
    return {"status": "success", "correction_id": correction.id}

@router.get("/recent/{user_id}", response_model=List[FocusSession])
def get_recent_sessions(
    user_id: int, 
    limit: int = 4, 
    session: Session = Depends(get_session), 
    _ = Depends(verify_user_access)
):
    statement = select(FocusSession).where(
        FocusSession.user_id == user_id, 
        FocusSession.completed == True
    ).order_by(FocusSession.ended_at.desc()).limit(limit)
    return session.exec(statement).all()


