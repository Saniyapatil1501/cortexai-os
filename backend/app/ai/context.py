from sqlmodel import Session, select
from app.models import ActivityLog, FocusSession
from datetime import datetime, timedelta
import sys

def get_recent_context(user_id: int, session: Session) -> str:
    """
    Retrieves rich real-time workspace context, including live foreground window,
    active focus session metrics, and detailed database activity logs from the last hour.
    """
    # 1. Resolve current active window from tracker daemon thread
    current_app = "Unknown"
    current_window = "Unknown"
    current_category = "unknown"
    current_reason = ""
    
    for mod in list(sys.modules.values()):
        if mod and hasattr(mod, "tracker") and getattr(mod, "tracker") is not None:
            tracker_obj = getattr(mod, "tracker")
            if hasattr(tracker_obj, "get_active_window_details"):
                current_app, current_window = tracker_obj.get_active_window_details()
            else:
                continue
            
            # Active focus intention
            active_statement = select(FocusSession).where(
                FocusSession.user_id == user_id, 
                FocusSession.ended_at == None
            )
            active_sess = session.exec(active_statement).first()
            study_goal = active_sess.intention if active_sess else ""
            
            # Resolve live classification
            from app.services.classifier import context_classifier
            classification = context_classifier.classify(
                session=session,
                user_id=user_id,
                app_name=current_app,
                window_title=current_window,
                study_goal=study_goal
            )
            current_category = classification["category"]
            current_reason = classification["reason"]
            break
            
    # 2. Get active focus session details
    active_statement = select(FocusSession).where(
        FocusSession.user_id == user_id, 
        FocusSession.ended_at == None
    )
    active_sess = session.exec(active_statement).first()
    if active_sess:
        focus_summary = (
            f"=== ACTIVE FOCUS SESSION ===\n"
            f"Intention: {active_sess.intention}\n"
            f"Started At: {active_sess.started_at}\n"
            f"Focus Type: {active_sess.focus_type}\n"
            f"Elapsed seconds: {active_sess.duration_seconds}\n"
            f"Distraction switches: {active_sess.distraction_count}\n"
            f"App swaps: {active_sess.app_swaps}\n"
            f"Idle counts: {active_sess.idle_count}"
        )
    else:
        focus_summary = "Active Focus Session: None"
        
    # 3. Pull last 1 hour of activity logs
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    logs_statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id,
        ActivityLog.timestamp >= one_hour_ago
    ).order_by(ActivityLog.timestamp.desc())
    recent_logs = session.exec(logs_statement).all()
    
    recent_logs_lines = []
    for l in recent_logs:
        timestamp_str = l.timestamp.strftime("%H:%M:%S")
        recent_logs_lines.append(
            f"- [{timestamp_str}] {l.app_name} ({l.duration_seconds}s) | Window: {l.window_title or ''} | Category: {l.category} | Reason: {l.reason or ''}"
        )
    recent_logs_str = "\n".join(recent_logs_lines)
    
    return (
        f"=== LIVE FOREGROUND TELEMETRY ===\n"
        f"Current App: {current_app}\n"
        f"Current Window Title: {current_window}\n"
        f"Current Category: {current_category}\n"
        f"Current Reason: {current_reason}\n\n"
        f"{focus_summary}\n\n"
        f"=== RECENT TRACKED LOGS (LAST HOUR) ===\n"
        f"{recent_logs_str if recent_logs_str else 'No activity logged in the last hour.'}\n"
        f"======================================="
    )
