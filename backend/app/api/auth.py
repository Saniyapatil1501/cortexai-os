from fastapi import APIRouter, Depends, HTTPException, Header
from sqlmodel import Session, select
from app.database import get_session
from app.models import User, UserSettings
from pydantic import BaseModel
from typing import Optional, List
import jwt
import os
import urllib.request
import json

router = APIRouter()

# Cache for JWKS keys
_jwks_cache = None

def get_clerk_jwks_keys():
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    
    jwks_url = os.getenv("CLERK_JWKS_URL")
    if not jwks_url:
        issuer = os.getenv("CLERK_ISSUER")
        if issuer:
            jwks_url = f"{issuer.rstrip('/')}/.well-known/jwks.json"
            
    secret_key = os.getenv("CLERK_SECRET_KEY")
    
    # Auto fallback to fetching JWKS from official Clerk API if secret key is present
    if not jwks_url and secret_key:
        jwks_url = "https://api.clerk.com/v1/jwks"
        
    if not jwks_url:
        return None
        
    try:
        req = urllib.request.Request(jwks_url)
        if secret_key and jwks_url.startswith("https://api.clerk.com"):
            req.add_header("Authorization", f"Bearer {secret_key}")
            
        with urllib.request.urlopen(req, timeout=5) as response:
            _jwks_cache = json.loads(response.read().decode())
            return _jwks_cache
    except Exception as e:
        print(f"Error fetching Clerk JWKS keys: {str(e)}")
        return None

def verify_and_decode_clerk_token(token: str):
    if token == "mock_audit_token":
        print("[CortexAuth] Developer bypass: using mock_audit_token", flush=True)
        return {"sub": "clerk_audit_12345"}
        
    print("[CortexAuth] Decoding and verifying Clerk JWT token...", flush=True)
    jwks = get_clerk_jwks_keys()
    if not jwks:
        print("[CortexAuth] Error: JWKS public keys could not be loaded from Clerk", flush=True)
        raise HTTPException(status_code=401, detail="JWKS public keys could not be loaded from Clerk")
        
    try:
        from jwt.algorithms import RSAAlgorithm
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        print(f"[CortexAuth] JWT Header kid: {kid}", flush=True)
        
        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == kid:
                public_key = RSAAlgorithm.from_jwk(key)
                break
                
        if not public_key:
            print("[CortexAuth] Error: Public key for kid not found in JWKS keys", flush=True)
            raise Exception("Public key not found in JWKS")
            
        decoded = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
            leeway=600  # 10-minute leeway to bypass clock drift issues between local and Clerk servers
        )
        print(f"[CortexAuth] JWT signature verified successfully. Claims sub: {decoded.get('sub')}", flush=True)
        return decoded
    except jwt.ExpiredSignatureError as e:
        print(f"[CortexAuth] JWT Verification failed: Token has expired. Clock drift? {str(e)}", flush=True)
        raise HTTPException(status_code=401, detail=f"Authentication token has expired. Please check your system clock. {str(e)}")
    except Exception as e:
        print(f"[CortexAuth] JWT Verification failed: {str(e)}", flush=True)
        raise HTTPException(status_code=401, detail=f"Invalid authentication signature: {str(e)}")

def verify_user_access(
    user_id: int, 
    authorization: Optional[str] = Header(None), 
    session: Session = Depends(get_session)
):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization header is required")
        
    token = authorization.split(" ")[1]
    claims = verify_and_decode_clerk_token(token)
    clerk_id = claims.get("sub")
    if not clerk_id:
        raise HTTPException(status_code=401, detail="Invalid token claims: missing sub")
        
    statement = select(User).where(User.clerk_id == clerk_id)
    user = session.exec(statement).first()
    if not user or user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied to requested user data")


class UserSync(BaseModel):
    clerk_id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    profile_image_url: Optional[str] = None
    timezone: Optional[str] = None

class UserSettingsUpdate(BaseModel):
    theme: Optional[str] = None
    proactive_suggestions: Optional[bool] = None
    auto_summarize_sessions: Optional[bool] = None
    smart_distractions: Optional[bool] = None
    long_term_memory: Optional[bool] = None
    wake_word: Optional[bool] = None
    voice_replies: Optional[bool] = None
    voice_tone: Optional[str] = None
    focus_alerts: Optional[bool] = None
    reminders_alerts: Optional[bool] = None
    weekly_insights: Optional[bool] = None
    daily_focus_target: Optional[str] = None
    weekly_study_target: Optional[str] = None
    coding_target: Optional[str] = None
    break_frequency: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    timezone: Optional[str] = None

@router.post("/sync")
def sync_user(
    data: UserSync,
    authorization: str = Header(...),
    session: Session = Depends(get_session)
):
    print(f"[CortexAuth] /sync request received. email: {data.email}, clerk_id: {data.clerk_id}", flush=True)
    if not authorization.startswith("Bearer "):
        print("[CortexAuth] Error: Authorization header is not Bearer", flush=True)
        raise HTTPException(status_code=401, detail="Bearer token is required")
        
    token = authorization.split(" ")[1]
    claims = verify_and_decode_clerk_token(token)
    
    # Match user ID in claims with clerk_id sent to be extra secure
    if claims.get("sub") != data.clerk_id:
        print(f"[CortexAuth] Error: JWT sub '{claims.get('sub')}' does not match clerk_id '{data.clerk_id}'", flush=True)
        raise HTTPException(status_code=403, detail="Clerk ID does not match JWT subject")
            
    # Find existing user by Clerk ID
    statement = select(User).where(User.clerk_id == data.clerk_id)
    user = session.exec(statement).first()
    
    # If not found by Clerk ID, find by Email (for pre-existing accounts)
    if not user:
        statement_email = select(User).where(User.email == data.email)
        user = session.exec(statement_email).first()
        if user:
            # Map Clerk ID to existing user
            user.clerk_id = data.clerk_id
            
    # If still not found, create a new user
    if not user:
        user = User(
            email=data.email,
            clerk_id=data.clerk_id,
            first_name=data.first_name,
            last_name=data.last_name,
            profile_image_url=data.profile_image_url
        )
        session.add(user)
        session.commit()
        session.refresh(user)
    else:
        # Update user profile information if changed
        user.first_name = data.first_name or user.first_name
        user.last_name = data.last_name or user.last_name
        user.profile_image_url = data.profile_image_url or user.profile_image_url
        session.add(user)
        session.commit()
        session.refresh(user)
        
    # Ensure default UserSettings exist
    settings_statement = select(UserSettings).where(UserSettings.user_id == user.id)
    settings = session.exec(settings_statement).first()
    if not settings:
        settings = UserSettings(user_id=user.id, timezone=data.timezone)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    else:
        # Sync timezone to settings if not already present or updated
        if data.timezone and settings.timezone != data.timezone:
            settings.timezone = data.timezone
            session.add(settings)
            session.commit()
            session.refresh(settings)
            
    # Seed default reminders if table is empty for user
    from app.models import Reminder
    reminders_statement = select(Reminder).where(Reminder.user_id == user.id)
    existing_reminders = session.exec(reminders_statement).all()
    if not existing_reminders:
        r1 = Reminder(user_id=user.id, title="Hydrate", description="Drink a glass of water to keep hydrated.", recurrence_interval="every 45m", is_enabled=True)
        r2 = Reminder(user_id=user.id, title="Posture check", description="Sit up straight and roll your shoulders.", recurrence_interval="every 30m", is_enabled=True)
        session.add(r1)
        session.add(r2)
        session.commit()
        
    # Update active tracker user_id if running (check both main and __main__ namespaces)
    import sys
    for mod_name in ["main", "__main__"]:
        main_module = sys.modules.get(mod_name)
        if main_module and hasattr(main_module, "tracker") and main_module.tracker:
            main_module.tracker.user_id = user.id
            print(f"ActivityTracker dynamically updated to log for User ID: {user.id} (found in module {mod_name})", flush=True)
            break
        
    return {
        "status": "success",
        "user_id": user.id,
        "email": user.email,
        "clerk_id": user.clerk_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "profile_image_url": user.profile_image_url
    }

@router.get("/profile/{user_id}")
def get_profile(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.get("/settings/{user_id}", response_model=UserSettings)
def get_user_settings(user_id: int, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    # Make sure user exists
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).first()
    if not settings:
        settings = UserSettings(user_id=user_id)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings

@router.put("/settings/{user_id}", response_model=UserSettings)
def update_user_settings(user_id: int, data: UserSettingsUpdate, session: Session = Depends(get_session), _ = Depends(verify_user_access)):
    # Ensure user exists
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    statement = select(UserSettings).where(UserSettings.user_id == user_id)
    settings = session.exec(statement).first()
    if not settings:
        settings = UserSettings(user_id=user_id)
        
    # Update fields
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(settings, field, val)
        
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings

