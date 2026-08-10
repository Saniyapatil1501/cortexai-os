from sqlmodel import Session, select
from app.models import ActivityLog, FocusSession

def get_recent_context(user_id: int, session: Session) -> str:
    """
    Retrieves the 5 most recent activity logs and active focus session intentions
    to provide context for the AI engine.
    """
    # Get last 5 active logs
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id).order_by(ActivityLog.timestamp.desc()).limit(5)
    logs = session.exec(statement).all()
    
    log_summary = ", ".join([f"{l.app_name} ({l.duration_seconds}s, {l.category})" for l in logs])
    
    # Get active session
    active_statement = select(FocusSession).where(FocusSession.user_id == user_id, FocusSession.completed == False)
    active_sess = session.exec(active_statement).first()
    
    intent_str = f"Active intention: '{active_sess.intention}'" if active_sess else "No active focus session."
    
    return f"Recent Activity: [{log_summary if log_summary else 'No recent logs'}]. {intent_str}"
