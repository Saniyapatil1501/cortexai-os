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

@router.get("/summary/{user_id}")
def get_activity_summary(user_id: int, days: int = 7, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    limit_date = datetime.utcnow() - timedelta(days=days)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= limit_date)
    logs = session.exec(statement).all()
    
    # Calculate sum of productivity metrics
    total_duration = sum(l.duration_seconds for l in logs)
    code_duration = sum(l.duration_seconds for l in logs if l.category == "code")
    study_duration = sum(l.duration_seconds for l in logs if l.category == "study")
    distr_duration = sum(l.duration_seconds for l in logs if l.category == "distraction")
    
    # Calculate today's metrics
    start_of_today = get_start_of_today_utc(user_id, session)
    today_logs = [l for l in logs if l.timestamp >= start_of_today]
    today_code = sum(l.duration_seconds for l in today_logs if l.category == "code")
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
        FocusSession.started_at >= start_of_today,
        FocusSession.completed == True
    )
    today_sessions = session.exec(focus_statement).all()
    today_sessions_count = len(today_sessions)
    
    return {
        "total_seconds": total_duration,
        "categories": {
            "code": code_duration,
            "study": study_duration,
            "distraction": distr_duration
        },
        "score": 0 if total_duration == 0 else max(0, int((code_duration + study_duration - distr_duration) / max(total_duration, 1) * 100)),
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
            if log.category in ["code", "study"]:
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
    start_of_today = get_start_of_today_utc(user_id, session)
    statement = select(ActivityLog).where(ActivityLog.user_id == user_id, ActivityLog.timestamp >= start_of_today)
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
    code_sec = sum(l.duration_seconds for l in logs if l.category == "code")
    study_sec = sum(l.duration_seconds for l in logs if l.category == "study")
    distr_sec = sum(l.duration_seconds for l in logs if l.category == "distraction")
    
    suggestions = []
    
    # 1. Distraction alert
    if distr_sec > 1800: # > 30 minutes of distraction
        minutes = int(distr_sec // 60)
        suggestions.append(f"You spent {minutes}m on distracting apps today. Consider scheduling a deep-focus Pomodoro sprint to reset.")
    elif total_sec > 0 and (code_sec + study_sec) / total_sec >= 0.8:
        suggestions.append("Incredible focus ratio today! You've spent over 80% of your desktop time on productive work.")
        
    # 2. Focus suggestions
    if code_sec > 3600: # > 1 hour coding
        hours = round(code_sec / 3600.0, 1)
        suggestions.append(f"You've been coding for {hours}h today. Remember to follow the 20-20-20 rule to rest your eyes.")
        
    # 3. Time pattern suggestion
    if logs:
        focus_logs = [l for l in logs if l.category in ["code", "study"]]
        if focus_logs:
            hours = [l.timestamp.hour for l in focus_logs]
            from collections import Counter
            peak_hour = Counter(hours).most_common(1)[0][0]
            statement_settings = select(UserSettings).where(UserSettings.user_id == user_id)
            settings = session.exec(statement_settings).first()
            tz_name = settings.timezone if settings else "UTC"
            try:
                import zoneinfo
                dt_utc = datetime.utcnow().replace(hour=peak_hour, minute=0, second=0)
                dt_local = to_user_timezone(dt_utc, tz_name)
                peak_hour_str = dt_local.strftime("%I:%M %p")
                suggestions.append(f"Your deep-focus peaks around {peak_hour_str} — block that window tomorrow for your hardest tasks.")
            except Exception:
                suggestions.append(f"Your deep-focus peaks around {peak_hour}:00 today.")

    # Fallbacks if list is too short
    if len(suggestions) < 3:
        suggestions.append("Cortex is analyzing your workspace patterns. Add course materials in Study Materials to enable custom RAG tutoring suggestions.")
    if len(suggestions) < 3:
        suggestions.append("Declare a clear study target on the Focus page to help Cortex classify your active windows.")
    if len(suggestions) < 3:
        suggestions.append("Great job starting your Cortex journey. Keep focusing and track your progress daily!")
        
    return suggestions[:3]
