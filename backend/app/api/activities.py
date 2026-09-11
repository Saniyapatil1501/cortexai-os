from fastapi import APIRouter, Depends, Header
from sqlmodel import Session, select
from app.database import get_session
from app.api.auth import verify_user_access
from app.models import ActivityLog, UserSettings
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
import zoneinfo

router = APIRouter()

def get_start_of_today_utc(user_id: int, db_session: Session) -> datetime:
    # Query timezone from UserSettings
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = db_session.exec(statement).first()
    
    tz_name = "UTC"
    if settings and settings.timezone:
        tz_name = settings.timezone
        
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
        # Get current time in user's timezone
        now_tz = datetime.now(tz)
        # Get start of today in user's timezone
        start_of_today_tz = now_tz.replace(hour=0, minute=0, second=0, microsecond=0)
        # Convert start of today back to UTC
        return start_of_today_tz.astimezone(zoneinfo.ZoneInfo("UTC")).replace(tzinfo=None)
    except Exception as e:
        print(f"Error computing local timezone start_of_today (falling back to UTC): {str(e)}")
        # Fallback to simple UTC start of day
        return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

def to_user_timezone(utc_dt: datetime, tz_name: Optional[str]) -> datetime:
    if not tz_name:
        return utc_dt
    try:
        # Give the naive UTC dt timezone info
        utc_aware = utc_dt.replace(tzinfo=zoneinfo.ZoneInfo("UTC"))
        # Convert to local timezone and remove tzinfo (to keep it naive for comparison/formatting)
        return utc_aware.astimezone(zoneinfo.ZoneInfo(tz_name)).replace(tzinfo=None)
    except Exception:
        return utc_dt

class ActivityLogCreate(BaseModel):
    user_id: int
    app_name: str
    window_title: Optional[str] = None
    duration_seconds: int
    category: str
    productivity_score: int

@router.post("/log")
def create_activity_log(data: ActivityLogCreate, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    verify_user_access(data.user_id, authorization, session)
    log = ActivityLog(
        user_id=data.user_id,
        app_name=data.app_name,
        window_title=data.window_title,
        duration_seconds=data.duration_seconds,
        category=data.category,
        productivity_score=data.productivity_score,
        timestamp=datetime.utcnow()
    )
    session.add(log)
    session.commit()
    session.refresh(log)
    return log

@router.get("/current")
def get_current_window(session: Session = Depends(get_session)):
    import sys
    from app.models import FocusSession
    for mod in list(sys.modules.values()):
        if mod and hasattr(mod, "tracker") and getattr(mod, "tracker") is not None:
            tracker_obj = getattr(mod, "tracker")
            from app.services.tracker import ActivityTracker
            if isinstance(tracker_obj, ActivityTracker):
                app_name, window_title = tracker_obj.get_active_window_details()
                
                # Resolve classification matching active user
                user_id = tracker_obj.user_id or 1
                stmt = select(FocusSession).where(
                    FocusSession.user_id == user_id,
                    FocusSession.ended_at == None
                )
                active_sess = session.exec(stmt).first()
                study_goal = active_sess.intention if active_sess else ""
                
                from app.services.classifier import context_classifier
                classification = context_classifier.classify(
                    session=session,
                    user_id=user_id,
                    app_name=app_name,
                    window_title=window_title,
                    study_goal=study_goal
                )
                
                return {
                    "app_name": app_name,
                    "window_title": window_title,
                    "category": classification["category"],
                    "reason": classification["reason"],
                    "confidence": classification["confidence"]
                }
            
    return {
        "app_name": "Idle",
        "window_title": "System Idle",
        "category": "idle",
        "reason": "Tracker not initialized",
        "confidence": 1.0
    }

@router.get("/summary/{user_id}")
def get_activity_summary(user_id: int, days: int = 7, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    limit_date = datetime.utcnow() - timedelta(days=days)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= limit_date)
    logs = session.exec(statement).all()
    
    # Calculate sum of productivity metrics
    total_duration = sum(l.duration_seconds for l in logs)
    code_duration = sum(l.duration_seconds for l in logs if l.category in ["code", "coding"])
    study_duration = sum(l.duration_seconds for l in logs if l.category == "study")
    distr_duration = sum(l.duration_seconds for l in logs if l.category == "distraction")
    
    # Calculate today's metrics
    start_of_today = get_start_of_today_utc(user_id, session)
    today_logs = [l for l in logs if l.timestamp >= start_of_today]
    today_code = sum(l.duration_seconds for l in today_logs if l.category in ["code", "coding"])
    today_study = sum(l.duration_seconds for l in today_logs if l.category == "study")
    today_distr = sum(l.duration_seconds for l in today_logs if l.category == "distraction")
    
    # Calculate today's distraction count using state-transition checks
    sorted_today_logs = sorted(today_logs, key=lambda x: x.timestamp)
    today_distr_count = 0
    last_was_distraction = False
    last_distraction_app = None
    for l in sorted_today_logs:
        if l.category == "distraction":
            if not last_was_distraction or (last_distraction_app and l.app_name != last_distraction_app):
                today_distr_count += 1
            last_was_distraction = True
            last_distraction_app = l.app_name
        else:
            last_was_distraction = False
            last_distraction_app = None
    
    # Today's focus sessions count
    from app.models import FocusSession
    focus_statement = select(FocusSession).where(
        FocusSession.user_id == user_id,
        FocusSession.started_at >= start_of_today
    )
    today_focus_sessions = session.exec(focus_statement).all()
    today_sessions_count = len([s for s in today_focus_sessions if s.completed])
    total_focus_count = len(today_focus_sessions)
    completed_focus_count = today_sessions_count

    # PRODUCTIVITY SCORE FORMULA DOCUMENTATION:
    # 1. active_seconds = sum of focus & distraction seconds today.
    # 2. base_score = ratio of productive focus seconds vs total active seconds.
    # 3. distraction_penalty = ratio of distraction time * 40.
    # 4. completion_bonus = multiplier scaling based on completion rate of started focus sessions.
    active_seconds = today_code + today_study + today_distr
    productive_seconds = today_code + today_study
    
    if active_seconds > 0:
        base_ratio = productive_seconds / active_seconds
        distr_ratio = today_distr / active_seconds
        
        # Raw score base
        raw_score = (base_ratio - (distr_ratio * 0.4)) * 100
        score = max(0, min(100, int(raw_score)))
        
        # Apply completion rate scaling if any sessions started
        if total_focus_count > 0:
            completion_rate = completed_focus_count / total_focus_count
            score = max(0, min(100, int(score * (0.8 + 0.2 * completion_rate))))
    else:
        score = 0
        
    return {
        "total_seconds": total_duration,
        "categories": {
            "code": code_duration,
            "study": study_duration,
            "distraction": distr_duration
        },
        "score": score,
        "today": {
            "focus_seconds": today_code + today_study,
            "distraction_seconds": today_distr,
            "distraction_count": today_distr_count,
            "sessions_count": today_sessions_count
        }
    }

@router.get("/analytics/productivity/{user_id}")
def get_productivity_analytics(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    limit_date = datetime.utcnow() - timedelta(days=14)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= limit_date)
    logs = session.exec(statement).all()
    
    if not logs or sum(l.duration_seconds for l in logs) == 0:
        return []
        
    # Get user settings timezone
    settings_statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(settings_statement).first()
    tz_name = settings.timezone if settings else "UTC"
    
    try:
        local_now = datetime.now(zoneinfo.ZoneInfo(tz_name))
    except Exception:
        local_now = datetime.utcnow()
    today = local_now.date()
    days = [today - timedelta(days=i) for i in range(13, -1, -1)]
    
    data = {d: {"focus": 0.0, "distraction": 0.0} for d in days}
    for log in logs:
        local_time = to_user_timezone(log.timestamp, tz_name)
        log_date = local_time.date()
        if log_date in data:
            hours = log.duration_seconds / 3600.0
            if log.category in ["code", "coding", "study"]:
                data[log_date]["focus"] += hours
            elif log.category == "distraction":
                data[log_date]["distraction"] += hours
                
    return [
        {
            "day": d.strftime("%b %d"),
            "focus": round(data[d]["focus"], 2),
            "distraction": round(data[d]["distraction"], 2)
        }
        for d in days
    ]

@router.get("/analytics/heatmap/{user_id}")
def get_heatmap_analytics(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id,
        ActivityLog.category.in_(["code", "study"])
    )
    logs = session.exec(statement).all()
    
    grid = [[0.0 for _ in range(24)] for _ in range(7)]
    for log in logs:
        w = log.timestamp.weekday()
        h = log.timestamp.hour
        grid[w][h] += log.duration_seconds
        
    max_val = max(max(row) for row in grid) if grid else 0
    if max_val > 0:
        normalized_grid = [[round(val / max_val, 2) for val in row] for row in grid]
    else:
        normalized_grid = grid
        
    return normalized_grid

@router.get("/analytics/apps/{user_id}")
def get_apps_analytics(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    from app.models import FocusSession
    
    # Query current active focus session
    stmt_active = select(FocusSession).where(
        FocusSession.user_id == user_id,
        FocusSession.ended_at == None
    )
    active_sess = session.exec(stmt_active).first()
    
    if active_sess:
        start_time = active_sess.started_at
        end_time = datetime.utcnow()
    else:
        return []
            
    statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id,
        ActivityLog.timestamp >= start_time,
        ActivityLog.timestamp <= end_time
    )
    logs = session.exec(statement).all()
    
    app_durations = {}
    app_categories = {}
    for log in logs:
        raw_name = log.app_name.lower()
        pretty_name = log.app_name
        if "code" in raw_name:
            pretty_name = "VS Code"
        elif "chrome" in raw_name:
            pretty_name = "Google Chrome"
        elif "firefox" in raw_name:
            pretty_name = "Firefox"
        elif "edge" in raw_name:
            pretty_name = "Microsoft Edge"
        elif "spotify" in raw_name:
            pretty_name = "Spotify"
        elif "discord" in raw_name:
            pretty_name = "Discord"
        elif "slack" in raw_name:
            pretty_name = "Slack"
        elif "terminal" in raw_name or "cmd.exe" in raw_name or "powershell" in raw_name:
            pretty_name = "Terminal"
            
        app_durations[pretty_name] = app_durations.get(pretty_name, 0) + log.duration_seconds
        app_categories[pretty_name] = log.category
        
    total_sec = sum(app_durations.values())
    
    result = []
    for name, secs in app_durations.items():
        hours = secs // 3600
        minutes = (secs % 3600) // 60
        time_str = ""
        if hours > 0:
            time_str += f"{hours}h "
        time_str += f"{minutes}m"
        
        pct = int(secs / max(total_sec, 1) * 100)
        
        result.append({
            "name": name,
            "time": time_str,
            "pct": pct,
            "type": app_categories[name]
        })
        
    result.sort(key=lambda x: x["pct"], reverse=True)
    return result

@router.get("/analytics/distractions/{user_id}")
def get_distractions_analytics(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    limit_date = datetime.utcnow() - timedelta(days=12)
    statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id,
        ActivityLog.timestamp >= limit_date,
        ActivityLog.category == "distraction"
    )
    logs = session.exec(statement).all()
    
    settings_statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(settings_statement).first()
    tz_name = settings.timezone if settings else "UTC"
    
    try:
        local_now = datetime.now(zoneinfo.ZoneInfo(tz_name))
    except Exception:
        local_now = datetime.utcnow()
    today = local_now.date()
    days = [today - timedelta(days=i) for i in range(11, -1, -1)]
    
    counts = {d: 0 for d in days}
    for log in logs:
        local_time = to_user_timezone(log.timestamp, tz_name)
        log_date = local_time.date()
        if log_date in counts:
            counts[log_date] += 1
            
    return [
        {
            "d": d.strftime("%b %d"),
            "v": counts[d]
        }
        for d in days
    ]
 
@router.get("/analytics/weekly_hours/{user_id}")
def get_weekly_hours_analytics(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    limit_date = datetime.utcnow() - timedelta(days=7)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= limit_date)
    logs = session.exec(statement).all()
    
    settings_statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(settings_statement).first()
    tz_name = settings.timezone if settings else "UTC"
    
    try:
        local_now = datetime.now(zoneinfo.ZoneInfo(tz_name))
    except Exception:
        local_now = datetime.utcnow()
    today = local_now.date()
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]
    
    data = {d: {"code": 0.0, "study": 0.0} for d in days}
    for log in logs:
        local_time = to_user_timezone(log.timestamp, tz_name)
        log_date = local_time.date()
        if log_date in data:
            hours = log.duration_seconds / 3600.0
            if log.category == "code":
                data[log_date]["code"] += hours
            elif log.category == "study":
                data[log_date]["study"] += hours
                
    return [
        {
            "d": d.strftime("%a"),
            "code": round(data[d]["code"], 2),
            "study": round(data[d]["study"], 2)
        }
        for d in days
    ]

@router.get("/suggestions/{user_id}", response_model=List[str])
def get_activity_suggestions(
    user_id: int, 
    session: Session = Depends(get_session), 
    _ = Depends(verify_user_access)
):
    # Query today's logs
    start_of_today = get_start_of_today_utc(user_id, session)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= start_of_today)
    logs = session.exec(statement).all()
    
    total_sec = sum(l.duration_seconds for l in logs)
    code_sec = sum(l.duration_seconds for l in logs if l.category in ["code", "coding"])
    study_sec = sum(l.duration_seconds for l in logs if l.category == "study")
    
    suggestions = []
    
    # 1. Coding time suggestion
    if code_sec > 0:
        minutes = int(code_sec // 60)
        suggestions.append(f"You spent {minutes} minutes coding in VS Code today.")
        
    # 2. No study/coding activity alert
    if code_sec == 0 and study_sec == 0:
        suggestions.append("You have no study activity recorded today.")
        
    # 3. Context switches during last focus session
    from app.models import FocusSession
    stmt_last = select(FocusSession).where(
        FocusSession.user_id == user_id,
        FocusSession.ended_at != None
    ).order_by(FocusSession.ended_at.desc()).limit(1)
    last_sess = session.exec(stmt_last).first()
    if last_sess:
        switches = last_sess.distraction_count or 0
        suggestions.append(f"You switched away from your focus context {switches} times during the last session.")
        
    # Fallback to general productivity score message
    if total_sec > 0:
        # Recompute score for today's logs
        active_seconds = code_sec + study_sec + sum(l.duration_seconds for l in logs if l.category == "distraction")
        if active_seconds > 0:
            score = int((code_sec + study_sec) / active_seconds * 100)
            suggestions.append(f"Your productivity score is {score}% today.")
            
    # Generic learning fallbacks if suggestions count is low
    if len(suggestions) < 3:
        suggestions.append("Cortex is analyzing your workspace patterns. Add course materials in Study Materials to enable custom RAG tutoring suggestions.")
    if len(suggestions) < 3:
        suggestions.append("Declare a clear study target on the Focus page to help Cortex classify your active windows.")
    if len(suggestions) < 3:
        suggestions.append("Great job starting your Cortex journey. Keep focusing and track your progress daily!")
        
    return suggestions[:3]

@router.post("/mock_active_window")
def mock_active_window(app_name: str, window_title: str):
    import sys
    found = False
    for mod in list(sys.modules.values()):
        if mod and hasattr(mod, "tracker") and getattr(mod, "tracker") is not None:
            tracker_obj = getattr(mod, "tracker")
            tracker_obj._mock_app = app_name
            tracker_obj._mock_title = window_title
            print(f"[CortexMock] Foreground window mocked to: {app_name} | {window_title} in module {getattr(mod, '__name__', str(mod))}", flush=True)
            found = True
    if found:
        return {"status": "success", "mocked_app": app_name, "mocked_title": window_title}
    return {"status": "failed", "message": "Tracker not found"}

@router.get("/logs/recent/{user_id}")
def get_recent_activity_logs(
    user_id: int,
    limit: int = 15,
    session: Session = Depends(get_session),
    _ = Depends(verify_user_access)
):
    statement = select(ActivityLog).where(
        ActivityLog.user_id == user_id
    ).order_by(ActivityLog.timestamp.desc()).limit(limit)
    return session.exec(statement).all()

