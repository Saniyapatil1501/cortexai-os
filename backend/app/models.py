from typing import Optional
from sqlmodel import SQLModel, Field
from datetime import datetime

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    clerk_id: Optional[str] = Field(default=None, unique=True, index=True)
    first_name: Optional[str] = Field(default=None)
    last_name: Optional[str] = Field(default=None)
    profile_image_url: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class FocusSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    intention: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    duration_seconds: int = Field(default=0)
    target_duration_seconds: int = Field(default=1500) # Default to 25 minutes (1500s)
    distraction_count: int = Field(default=0)
    completed: bool = Field(default=False)

class UserSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", unique=True, index=True)
    theme: str = Field(default="matte_black")
    proactive_suggestions: bool = Field(default=True)
    auto_summarize_sessions: bool = Field(default=True)
    smart_distractions: bool = Field(default=True)
    long_term_memory: bool = Field(default=False)
    wake_word: bool = Field(default=True)
    voice_replies: bool = Field(default=False)
    voice_tone: str = Field(default="Calm")
    focus_alerts: bool = Field(default=True)
    reminders_alerts: bool = Field(default=True)
    weekly_insights: bool = Field(default=True)
    daily_focus_target: str = Field(default="5h")
    weekly_study_target: str = Field(default="20h")
    coding_target: str = Field(default="25h")
    break_frequency: str = Field(default="every 50 min")
    name: Optional[str] = Field(default=None)
    role: Optional[str] = Field(default=None)
    timezone: Optional[str] = Field(default=None)

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

class Document(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    filename: str
    original_filename: str
    file_type: str  # 'pdf', 'txt', 'md'
    file_path: str
    file_size: int
    status: str = Field(default="processing")  # 'processing', 'ready', 'failed'
    chunk_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class DocumentChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="document.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    chunk_index: int
    content: str
    token_count: int
    page_number: Optional[int] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FocusSessionEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key="focussession.id", index=True)
    state: str  # 'STUDY', 'DISTRACTION', 'IDLE', 'PENDING', 'TARGET_COMPLETED', 'SESSION_CANCELLED', 'SESSION_ENDED'
    start_time: datetime
    end_time: datetime
    duration: int
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    classification: Optional[str] = None
    confidence: Optional[float] = None
    classification_reason: Optional[str] = None


class UserFeedbackCorrection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    app_name: str
    window_title: str
    study_goal: str
    predicted_label: str
    corrected_label: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


