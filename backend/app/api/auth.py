from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from app.database import get_session
from app.models import User
from pydantic import BaseModel

router = APIRouter()

class UserLogin(BaseModel):
    email: str

@router.post("/login")
def login(user_data: UserLogin, session: Session = Depends(get_session)):
    # Find existing user or create default local profile
    statement = select(User).where(User.email == user_data.email)
    user = session.exec(statement).first()
    
    if not user:
        user = User(email=user_data.email)
        session.add(user)
        session.commit()
        session.refresh(user)
        
    return {"status": "success", "user_id": user.id, "email": user.email}

@router.get("/profile/{user_id}")
def get_profile(user_id: int, session: Session = Depends(get_session)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
