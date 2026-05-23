from typing import Optional
from sqlmodel import SQLModel, Field
from datetime import datetime

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class FocusSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    intention: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    duration_seconds: int = Field(default=0)
    distraction_count: int = Field(default=0)
    completed: bool = Field(default=False)

class ActivityLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    app_name: str
    window_title: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    duration_seconds: int
    category: str = Field(default="unclassified") # 'code', 'study', 'distraction', 'idle'
    productivity_score: int = Field(default=0) # -2 to +2

class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    title: str
    description: Optional[str] = None
    recurrence_interval: str # 'every 45m', 'session_start'
    is_enabled: bool = Field(default=True)
    last_triggered_at: Optional[datetime] = None

class ChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    role: str # 'user' or 'assistant'
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
