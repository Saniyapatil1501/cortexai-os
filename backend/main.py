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
from app.api import auth, sessions, activities, assistant, reminders
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

tracker = None

@app.on_event("startup")
def on_startup():
    global tracker
    from app.services.tracker import ActivityTracker
    from app.database import engine
    import google.generativeai as genai

    create_db_and_tables()
    
    # Launch tracker daemon on background thread with no initial user
    tracker = ActivityTracker(engine=engine, user_id=None)
    tracker.start()
    print("CortexAI DB initialized and ActivityTracker daemon started (waiting for user session sync).")

    # Console logging for Gemini configuration
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        print("Gemini key detected: YES")
        try:
            genai.configure(api_key=gemini_key)
            print("Gemini client initialized: YES")
        except Exception as e:
            print(f"Gemini client initialized: NO (Error: {str(e)})")
    else:
        print("Gemini key detected: NO")
        print("Gemini client initialized: NO")

@app.get("/")
def read_root():
    return {"status": "online", "service": "CortexAI Desktop Daemon"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
