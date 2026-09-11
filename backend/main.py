import os
from dotenv import load_dotenv

# Load env variables from .env file in the backend folder
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        integrations=[FastApiIntegration()],
        traces_sample_rate=1.0,
    )


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn


# We will initialize routers in separate files
from app.api import auth, sessions, activities, assistant, reminders, documents, rag, vision
from app.database import create_db_and_tables

app = FastAPI(
    title="CortexAI Desktop API Daemon",
    description="Local service tracking focus, windows, reminders, and LLM completions.",
    version="1.0.0"
)

@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# Enable CORS for React frontend (Vite/TanStack Start Dev server port)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["Focus Sessions"])
app.include_router(activities.router, prefix="/api/activities", tags=["Activity Monitor"])
app.include_router(assistant.router, prefix="/api/assistant", tags=["AI Assistant"])
app.include_router(reminders.router, prefix="/api/reminders", tags=["Reminders"])
app.include_router(documents.router, prefix="/api/documents", tags=["Study Materials"])
app.include_router(rag.router, prefix="/api/rag", tags=["Semantic Search"])
app.include_router(vision.router, prefix="/api/vision", tags=["Computer Vision"])

tracker = None

@app.on_event("startup")
def on_startup():
    global tracker
    from app.services.tracker import ActivityTracker
    from app.database import engine, get_session
    from sqlmodel import Session, select
    from app.models import FocusSession
    from datetime import datetime

    create_db_and_tables()
    
    # Bounded Cleanup: Mark any abandoned, un-ended focus sessions from prior runs as cancelled/closed (if they are stale)
    try:
        with Session(engine) as session:
            stmt = select(FocusSession).where(FocusSession.ended_at == None)
            abandoned = session.exec(stmt).all()
            cleaned_count = 0
            for s in abandoned:
                elapsed = (datetime.utcnow() - s.started_at).total_seconds()
                limit = max(14400, s.target_duration_seconds + 7200)
                if elapsed > limit:
                    s.ended_at = datetime.utcnow()
                    s.status = "cancelled"
                    session.add(s)
                    cleaned_count += 1
            session.commit()
            if cleaned_count:
                print(f"CortexAPI Startup: Cleaned up {cleaned_count} abandoned focus sessions.", flush=True)
    except Exception as e:
        print(f"CortexAPI Startup: Warning: Failed to clean up abandoned sessions: {str(e)}", flush=True)
    
    # Launch tracker daemon on background thread with no initial user
    tracker = ActivityTracker(engine=engine, user_id=None)
    tracker.start()
    print("CortexAI DB initialized and ActivityTracker daemon started (waiting for user session sync).")

    # Start Ollama if offline
    import urllib.request
    import subprocess
    try:
        urllib.request.urlopen("http://127.0.0.1:11434", timeout=1)
    except Exception:
        print("Ollama is offline. Starting Ollama daemon...", flush=True)
        try:
            # We use creationflags=0x08000000 (CREATE_NO_WINDOW) to hide the console on Windows
            subprocess.Popen(["ollama", "serve"], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000))
        except Exception as e:
            print(f"Warning: Could not auto-start Ollama: {e}", flush=True)

@app.get("/")
def read_root():
    return {"status": "online", "service": "CortexAI Desktop Daemon"}

@app.on_event("shutdown")
def on_shutdown():
    global tracker
    if tracker:
        print("Stopping ActivityTracker thread...", flush=True)
        tracker.stop()

@app.post("/api/shutdown")
def shutdown():
    import os
    import signal
    print("[CortexAPI] Graceful shutdown requested.", flush=True)
    global tracker
    if tracker:
        tracker.stop()
    os.kill(os.getpid(), signal.SIGINT)
    return {"status": "shutdown initiated"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
