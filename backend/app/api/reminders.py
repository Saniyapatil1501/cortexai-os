from fastapi import APIRouter, Depends, HTTPException, Header
from sqlmodel import Session, select
from app.database import get_session
from app.models import Reminder
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from app.api.auth import verify_user_access

router = APIRouter()

class ReminderCreate(BaseModel):
    user_id: int
    title: str
    description: Optional[str] = None
    recurrence_interval: str # e.g. 'every 45m'

class ReminderUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    title: Optional[str] = None
    description: Optional[str] = None
    recurrence_interval: Optional[str] = None

@router.post("/")
def create_reminder(data: ReminderCreate, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    # Enforce user authorization check
    verify_user_access(data.user_id, authorization, session)
    
    rem = Reminder(
        user_id=data.user_id,
        title=data.title,
        description=data.description,
        recurrence_interval=data.recurrence_interval,
        is_enabled=True
    )
    session.add(rem)
    session.commit()
    session.refresh(rem)
    return rem

@router.get("/{user_id}", response_model=List[Reminder])
def get_reminders(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    statement = select(Reminder).where(Reminder.user_id == user_id)
    return session.exec(statement).all()

@router.put("/{reminder_id}")
def update_reminder(reminder_id: int, data: ReminderUpdate, session: Session = Depends(get_session), authorization: Optional[str] = Header(None)):
    rem = session.get(Reminder, reminder_id)
    if not rem:
        raise HTTPException(status_code=404, detail="Reminder not found")
        
    # Enforce user authorization check on reminder owner
    verify_user_access(rem.user_id, authorization, session)
        
    if data.is_enabled is not None:
        rem.is_enabled = data.is_enabled
    if data.title is not None:
        rem.title = data.title
    if data.description is not None:
        rem.description = data.description
    if data.recurrence_interval is not None:
        rem.recurrence_interval = data.recurrence_interval
        
    session.add(rem)
    session.commit()
    session.refresh(rem)
    return rem
