import time
import psutil
from threading import Thread
from datetime import datetime, timedelta
from typing import Optional
from sqlmodel import Session, select
from app.models import ActivityLog, FocusSession
from app.services.classifier import context_classifier
from app.services.timer import timer_state_machine

# Graceful import for non-Windows platforms
try:
    import win32gui
    import win32process
    import win32con
    import win32api
    PLATFORM_WINDOWS = True
except ImportError:
    PLATFORM_WINDOWS = False

def get_chrome_active_tab_site_uia(hwnd):
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        uia = win32com.client.Dispatch("UIAutomationCore.CUIAutomation")
        element = uia.ElementFromHandle(hwnd)
        if not element:
            return None
        
        # UIA Control Type Edit = 50004
        condition = uia.CreatePropertyCondition(30003, 50004)
        edit_elements = element.FindAll(4, condition) # TreeScope_Descendants = 4
        
        if edit_elements and edit_elements.Length > 0:
            for i in range(edit_elements.Length):
                el = edit_elements.GetElement(i)
                try:
                    val_pattern = el.GetCurrentPattern(10002) # UIA_ValuePatternId = 10002
                    if val_pattern:
                        val = val_pattern.Value
                        if val:
                            val_lower = val.lower().strip()
                            if "github.com" in val_lower:
                                return "GitHub"
                            elif "linkedin.com" in val_lower:
                                return "LinkedIn"
                            elif "pinterest.com" in val_lower:
                                return "Pinterest"
                except Exception:
                    pass
    except Exception:
        pass
    return None

class ActivityTracker(Thread):
    def __init__(self, engine, user_id: int):
        super().__init__()
        self.engine = engine
        self.user_id = user_id
        self.running = True
        self.daemon = True # Closes thread when main process exits
        
    def stop(self):
        self.running = False
        
    def get_idle_seconds(self):
        if not PLATFORM_WINDOWS:
            return 0
        try:
            last_input_tick = win32api.GetLastInputInfo()
            current_tick = win32api.GetTickCount()
            elapsed_ms = current_tick - last_input_tick
            return elapsed_ms / 1000.0
        except Exception:
            return 0
            
    def get_active_window_details(self):
        if not PLATFORM_WINDOWS:
            # Fallback mock for non-Windows platforms in development
            # Alternate active app to generate realistic analytics
            tick = int(time.time()) % 60
            if tick < 20:
                return "code.exe", "tracker.py - cortexai-desktop-main - VS Code"
            elif tick < 40:
                return "chrome.exe", "FastAPI Documentation - Google Chrome"
            else:
                return "spotify.exe", "Ambient Lo-Fi Focus Beats"
        if getattr(self, "_mock_app", None):
            return self._mock_app, self._mock_title
            
        try:
            hwnd = win32gui.GetForegroundWindow()
            if hwnd == 0:
                return "Idle", "System Idle"
                
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            if pid == 0:
                return "Idle", "System Idle"
                
            process = psutil.Process(pid)
            app_name = process.name()
            window_title = win32gui.GetWindowText(hwnd)
            
            # If active app is Chrome, resolve specific sites (LinkedIn, GitHub, Pinterest)
            if "chrome" in app_name.lower():
                site = get_chrome_active_tab_site_uia(hwnd)
                
                # Fallback to window title scanning
                if not site:
                    wt_lower = window_title.lower()
                    if "github" in wt_lower:
                        site = "GitHub"
                    elif "linkedin" in wt_lower:
                        site = "LinkedIn"
                    elif "pinterest" in wt_lower:
                        site = "Pinterest"
                
                if site:
                    app_name = site
                
                # Clean browser suffixes from window title
                for suffix in [" - Google Chrome", " - Microsoft Edge", " - Firefox"]:
                    if window_title.endswith(suffix):
                        window_title = window_title[:-len(suffix)]
                        
            return app_name, window_title
        except Exception:
            return "Unknown", "Background Work"
            
    def close_stale_sessions(self, session: Session):
        if not self.user_id:
            return
        stmt = select(FocusSession).where(
            FocusSession.user_id == self.user_id,
            FocusSession.ended_at == None
        )
        active_sessions = session.exec(stmt).all()
        for active_sess in active_sessions:
            elapsed = (datetime.utcnow() - active_sess.started_at).total_seconds()
            limit = max(14400, active_sess.target_duration_seconds + 7200)
            if elapsed > limit:
                active_sess.completed = True
                active_sess.ended_at = datetime.utcnow()
                session.add(active_sess)
                
                stmt_evt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == active_sess.id).order_by(FocusSessionEvent.id.desc())
                last_evt = session.exec(stmt_evt).first()
                if last_evt:
                    last_evt.end_time = active_sess.ended_at
                    last_evt.duration = int((active_sess.ended_at - last_evt.start_time).total_seconds())
                    session.add(last_evt)
                    
                end_event = FocusSessionEvent(
                    session_id=active_sess.id,
                    state="SESSION_ENDED",
                    start_time=active_sess.ended_at,
                    end_time=active_sess.ended_at,
                    duration=0,
                    app_name="System",
                    window_title="Session Ended",
                    classification="idle",
                    confidence=1.0,
                    classification_reason="Session closed automatically due to inactivity."
                )
                session.add(end_event)
                session.commit()

    def run(self):
        current_user_id = self.user_id
        last_app, last_title = None, None
        start_time = time.time()
        print(f"Activity tracking daemon started for User ID: {self.user_id}")
        
        sleep_time = 5
        while self.running:
            try:
                time.sleep(sleep_time)
                
                # Check for user ID changes dynamically
                if self.user_id != current_user_id:
                    print(f"ActivityTracker: User changed from {current_user_id} to {self.user_id}", flush=True)
                    if current_user_id and last_app:
                        duration = int(time.time() - start_time)
                        if duration >= 5: # Save if it has been running for at least 5s
                            try:
                                self.save_activity(last_app, last_title, duration, user_id=current_user_id)
                            except Exception as ex:
                                print(f"ActivityTracker warning (flushing old user {current_user_id}): {ex}", flush=True)
                    # Reset tracking state for the new user ID
                    last_app, last_title = None, None
                    start_time = time.time()
                    current_user_id = self.user_id
                
                if not self.user_id:
                    sleep_time = 8
                    continue
                
                # Check for idle state
                idle_sec = self.get_idle_seconds()
                if idle_sec >= 300 and not getattr(self, "_mock_app", None): # 5 minutes
                    app_name, window_title = "Idle", "System Idle"
                else:
                    app_name, window_title = self.get_active_window_details()
                
                # Update Timer State Machine if Focus Session is active
                has_active_session = False
                with Session(self.engine) as session:
                    self.close_stale_sessions(session)
                    stmt = select(FocusSession).where(
                        FocusSession.user_id == self.user_id,
                        FocusSession.ended_at == None
                    )
                    active_session = session.exec(stmt).first()
                    
                    if active_session:
                        has_active_session = True
                        classification = context_classifier.classify(
                            session=session,
                            user_id=self.user_id,
                            app_name=app_name,
                            window_title=window_title,
                            study_goal=active_session.intention
                        )
                        timer_state_machine.update(
                            session=session,
                            focus_session=active_session,
                            classification=classification,
                            app_name=app_name,
                            window_title=window_title
                        )
                
                sleep_time = 3
                
                # Save standard ActivityLog if context changed and debounce matches
                if app_name != last_app or window_title != last_title:
                    duration = int(time.time() - start_time)
                    is_app_change = (app_name != last_app)
                    required_duration = 5 if is_app_change else 15
                    
                    if last_app and duration >= required_duration:
                        self.save_activity(last_app, last_title, duration)
                        last_app, last_title = app_name, window_title
                        start_time = time.time()
                    elif not last_app:
                        last_app, last_title = app_name, window_title
                        start_time = time.time()
                    else:
                        if is_app_change:
                            last_app, last_title = app_name, window_title
                            start_time = time.time()
                else:
                    # Periodic flush: if we stay on the same app for >= 60 seconds, write log and reset start_time
                    duration = int(time.time() - start_time)
                    if last_app and duration >= 60:
                        self.save_activity(last_app, last_title, duration)
                        start_time = time.time()
            except Exception as e:
                print(f"Tracking daemon warning: {str(e)}")
                time.sleep(2)

    def save_activity(self, app_name: str, window_title: str, duration: int, user_id: Optional[int] = None):
        target_user_id = user_id or self.user_id
        if not target_user_id:
            print("ActivityTracker: No active user authenticated. Skipping log.")
            return
            
        with Session(self.engine) as session:
            stmt = select(FocusSession).where(
                FocusSession.user_id == target_user_id,
                FocusSession.ended_at == None
            )
            active_sess = session.exec(stmt).first()
            study_goal = active_sess.intention if active_sess else ""
            
            classification = context_classifier.classify(
                session=session,
                user_id=target_user_id,
                app_name=app_name,
                window_title=window_title,
                study_goal=study_goal
            )
            
            category = classification["category"]
            score = 0
            if category in ["code", "coding", "study"]:
                score = 1
            elif category == "distraction":
                score = -2
                
            now_utc = datetime.utcnow()
            start_utc = now_utc - timedelta(seconds=duration)
            
            log = ActivityLog(
                user_id=target_user_id,
                app_name=app_name,
                window_title=window_title,
                duration_seconds=duration,
                category=category,
                productivity_score=score,
                timestamp=start_utc,
                end_timestamp=now_utc,
                active_state="idle" if app_name == "Idle" else "active",
                focus_session_id=active_sess.id if active_sess else None,
                reason=classification.get("reason")
            )
            session.add(log)
            session.commit()
            print(f"Logged: {app_name} | {window_title} | {duration}s | Category: {category} | FocusSession: {log.focus_session_id} (User ID: {target_user_id})")

