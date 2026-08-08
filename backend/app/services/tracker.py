import time
import psutil
from threading import Thread
from datetime import datetime
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

class ActivityTracker(Thread):
    def __init__(self, engine, user_id: int):
        super().__init__()
        self.engine = engine
        self.user_id = user_id
        self.running = True
        self.daemon = True # Closes thread when main process exits
        
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
            return app_name, window_title
        except Exception:
            return "Unknown", "Background Work"

    def run(self):
        last_app, last_title = None, None
        start_time = time.time()
        print(f"Activity tracking daemon started for User ID: {self.user_id}")
        
        while self.running:
            try:
                time.sleep(1) # check interval: 1 second
                if not self.user_id:
                    continue
                
                # Check for idle state
                idle_sec = self.get_idle_seconds()
                if idle_sec >= 300: # 5 minutes
                    app_name, window_title = "Idle", "System Idle"
                else:
                    app_name, window_title = self.get_active_window_details()
                
                # Update Timer State Machine if Focus Session is active
                with Session(self.engine) as session:
                    stmt = select(FocusSession).where(
                        FocusSession.user_id == self.user_id,
                        FocusSession.completed == False
                    )
                    active_session = session.exec(stmt).first()
                    
                    if active_session:
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
            except Exception as e:
                print(f"Tracking daemon warning: {str(e)}")
                time.sleep(2)

    def save_activity(self, app_name: str, window_title: str, duration: int):
        if not self.user_id:
            print("ActivityTracker: No active user authenticated. Skipping log.")
            return
            
        with Session(self.engine) as session:
            stmt = select(FocusSession).where(
                FocusSession.user_id == self.user_id,
                FocusSession.completed == False
            )
            active_sess = session.exec(stmt).first()
            study_goal = active_sess.intention if active_sess else ""
            
            classification = context_classifier.classify(
                session=session,
                user_id=self.user_id,
                app_name=app_name,
                window_title=window_title,
                study_goal=study_goal
            )
            
            category = classification["category"]
            score = 0
            if category == "study":
                score = 1
            elif category == "distraction":
                score = -2
                
            log = ActivityLog(
                user_id=self.user_id,
                app_name=app_name,
                window_title=window_title,
                duration_seconds=duration,
                category=category,
                productivity_score=score,
                timestamp=datetime.utcnow()
            )
            session.add(log)
            session.commit()
            print(f"Logged: {app_name} | {window_title} | {duration}s | Category: {category}")

