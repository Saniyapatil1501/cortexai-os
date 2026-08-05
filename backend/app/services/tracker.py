import time
import psutil
from threading import Thread
from datetime import datetime
from sqlmodel import Session
from app.models import ActivityLog

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

    def classify_activity(self, app_name: str, window_title: str):
        if app_name == "Idle":
            return "idle", 0
            
        # Premium heuristic classification
        app_lower = app_name.lower()
        title_lower = window_title.lower() if window_title else ""
        
        coding_execs = ["code.exe", "windowsterminal.exe", "cmd.exe", "powershell.exe", "idea64.exe"]
        distraction_execs = ["slack.exe", "discord.exe", "spotify.exe", "steam.exe"]
        browser_execs = ["chrome.exe", "firefox.exe", "msedge.exe", "browser.exe"]
        
        if any(c in app_lower for c in coding_execs):
            return "code", 2 # highly productive
        elif any(d in app_lower for d in distraction_execs):
            return "distraction", -2 # highly distracting
        elif any(b in app_lower for b in browser_execs):
            # Check context inside browser title
            distr_keywords = ["youtube", "facebook", "twitter", "reddit", "netflix", "instagram"]
            if any(k in title_lower for k in distr_keywords):
                return "distraction", -2
            study_keywords = ["docs", "github", "stack overflow", "google search", "notion", "medium"]
            if any(k in title_lower for k in study_keywords):
                return "study", 1
            return "study", 0 # neutral browsing
        else:
            return "unclassified", 0

    def run(self):
        last_app, last_title = None, None
        start_time = time.time()
        print(f"Activity tracking daemon started for User ID: {self.user_id}")
        
        while self.running:
            try:
                time.sleep(1) # check interval: 1 second
                
                # Check for idle state
                idle_sec = self.get_idle_seconds()
                if idle_sec >= 300: # 5 minutes
                    app_name, window_title = "Idle", "System Idle"
                else:
                    app_name, window_title = self.get_active_window_details()
                
                if app_name != last_app or window_title != last_title:
                    duration = int(time.time() - start_time)
                    
                    # Debounce/throttle logic:
                    # Require at least 5s for an app swap (app_name change)
                    # Require at least 15s for a same-app window title change
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
                        # If duration was too small to log:
                        # If it is an app change, let's switch targets immediately to prevent losing tracking time,
                        # but don't log the transient/temporary state to avoid inflation.
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
            
        category, score = self.classify_activity(app_name, window_title)
        
        with Session(self.engine) as session:
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
