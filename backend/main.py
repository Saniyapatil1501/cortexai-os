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

@app.on_event("startup")
def on_startup():
    from app.models import User
    from app.services.tracker import ActivityTracker
    from sqlmodel import Session, select
    from app.database import engine

    create_db_and_tables()
    
    # Pre-create default workspace profile
    with Session(engine) as session:
        statement = select(User).where(User.email == "alex@cortex.ai")
        user = session.exec(statement).first()
        if not user:
            user = User(email="alex@cortex.ai")
            session.add(user)
            session.commit()
            session.refresh(user)
        default_id = user.id
        
        # Pre-create default reminders if they don't exist
        from app.models import Reminder
        statement_rem = select(Reminder).where(Reminder.user_id == default_id)
        reminders = session.exec(statement_rem).all()
        if not reminders:
            session.add(Reminder(user_id=default_id, title="Hydrate", description="Drink a glass of water", recurrence_interval="every 45m"))
            session.add(Reminder(user_id=default_id, title="Posture check", description="Sit up straight and roll your shoulders", recurrence_interval="every 30m"))
            session.add(Reminder(user_id=default_id, title="Review PR #482", description="Check github pull request updates", recurrence_interval="at 3:30 PM"))
            session.commit()
        
    # Launch tracker daemon on background thread
    tracker = ActivityTracker(engine=engine, user_id=default_id)
    tracker.start()
    print("CortexAI DB initialized and ActivityTracker daemon started.")

@app.get("/")
def read_root():
    return {"status": "online", "service": "CortexAI Desktop Daemon"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
