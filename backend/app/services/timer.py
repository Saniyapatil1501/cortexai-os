import os
from datetime import datetime
from sqlmodel import Session, select
from typing import Optional, Dict
from app.models import FocusSession, FocusSessionEvent

class StudyTimerStateMachine:
    def __init__(self):
        # Configurable grace confirmation window (default 5s)
        try:
            self.grace_seconds = int(os.getenv("TIMER_GRACE_SECONDS", "5"))
        except ValueError:
            self.grace_seconds = 5

    def update(
        self,
        session: Session,
        focus_session: FocusSession,
        classification: Dict,
        app_name: str,
        window_title: str,
        now: Optional[datetime] = None
    ):
        """
        Updates the timer state machine for the active focus session.
        Applies temporal smoothing, grace confirmation, and retrospective timestamps.
        """
        if not now:
            now = datetime.utcnow()
        category = classification["category"]  # 'study', 'distraction', 'idle', 'unknown'
        confidence = classification["confidence"]
        reason = classification["reason"]

        # Fetch the last event for this session to determine the current state
        stmt = select(FocusSessionEvent).where(FocusSessionEvent.session_id == focus_session.id).order_by(FocusSessionEvent.end_time.desc())
        last_event = session.exec(stmt).first()

        # If no event exists yet, start the session in STUDY state
        if not last_event:
            start_event = FocusSessionEvent(
                session_id=focus_session.id,
                state="STUDY",
                start_time=focus_session.started_at or now,
                end_time=now,
                duration=0,
                app_name=app_name,
                window_title=window_title,
                classification=category,
                confidence=confidence,
                classification_reason=reason
            )
            session.add(start_event)
            session.commit()
            return

        current_state = last_event.state
        
        # Check if the active segment is still open/running (meaning its end_time is close to now)
        # In our polling, we update end_time on every tick
        time_since_last_update = (now - last_event.end_time).total_seconds()
        
        # Handle state transitions
        if current_state == "STUDY":
            if category == "study":
                # Check if the active window app name or window title has changed
                if last_event.app_name != app_name or last_event.window_title != window_title:
                    # Close previous study segment
                    last_event.end_time = now
                    last_event.duration = int((now - last_event.start_time).total_seconds())
                    session.add(last_event)
                    
                    # Open fresh study segment with correct window details
                    new_study = FocusSessionEvent(
                        session_id=focus_session.id,
                        state="STUDY",
                        start_time=now,
                        end_time=now,
                        duration=0,
                        app_name=app_name,
                        window_title=window_title,
                        classification=category,
                        confidence=confidence,
                        classification_reason=reason
                    )
                    session.add(new_study)
                else:
                    # Continuous study on same context: update end_time and add duration
                    last_event.end_time = now
                    last_event.duration = int((now - last_event.start_time).total_seconds())
                    session.add(last_event)
                
                # Accumulate verified focus time on the session
                focus_session.duration_seconds += 1
                session.add(focus_session)
                session.commit()
            else:
                # User switched away from study: transition to PENDING confirmation state
                pending_event = FocusSessionEvent(
                    session_id=focus_session.id,
                    state="PENDING",
                    start_time=now,  # moment they switched
                    end_time=now,
                    duration=0,
                    app_name=app_name,
                    window_title=window_title,
                    classification=category,  # target state candidate
                    confidence=confidence,
                    classification_reason=reason
                )
                session.add(pending_event)
                session.commit()
                
        elif current_state == "PENDING":
            # Target state matches current classification: increment pending duration
            target_cat = last_event.classification
            pending_duration = int((now - last_event.start_time).total_seconds())
            
            if category == target_cat:
                last_event.end_time = now
                last_event.duration = pending_duration
                session.add(last_event)
                session.commit()
                
                if pending_duration >= self.grace_seconds:
                    # Grace period expired! Transition is CONFIRMED.
                    # 1. Retrieve previous STUDY segment that we left open when entering PENDING
                    stmt_prev = select(FocusSessionEvent).where(
                        FocusSessionEvent.session_id == focus_session.id,
                        FocusSessionEvent.state == "STUDY"
                    ).order_by(FocusSessionEvent.end_time.desc())
                    prev_study = session.exec(stmt_prev).first()
                    
                    if prev_study:
                        # Retrospective adjustment: set its end_time to when they switched (last_event.start_time)
                        # and deduct the grace period seconds from session focus count
                        prev_study.end_time = last_event.start_time
                        prev_study.duration = int((last_event.start_time - prev_study.start_time).total_seconds())
                        session.add(prev_study)
                    
                    # 2. Convert the PENDING event into the confirmed category state (DISTRACTION, IDLE, or UNKNOWN)
                    last_event.state = target_cat.upper()
                    last_event.end_time = now
                    last_event.duration = int((now - last_event.start_time).total_seconds())
                    session.add(last_event)
                    session.commit()
            elif category == "study":
                # User returned to study before grace confirmation: cancel PENDING.
                # Remove the PENDING record to keep timeline clean
                session.delete(last_event)
                session.commit()
                
                # Re-fetch and extend the previous STUDY segment
                stmt_prev = select(FocusSessionEvent).where(
                    FocusSessionEvent.session_id == focus_session.id,
                    FocusSessionEvent.state == "STUDY"
                ).order_by(FocusSessionEvent.end_time.desc())
                prev_study = session.exec(stmt_prev).first()
                if prev_study:
                    prev_study.end_time = now
                    prev_study.duration = int((now - prev_study.start_time).total_seconds())
                    # Accumulate elapsed time since we skipped the temporary transition
                    elapsed = int((now - last_event.start_time).total_seconds())
                    focus_session.duration_seconds += elapsed
                    session.add(prev_study)
                    session.add(focus_session)
                    session.commit()
            else:
                # User switched to a DIFFERENT distraction while in PENDING: reset target
                last_event.start_time = now
                last_event.end_time = now
                last_event.duration = 0
                last_event.app_name = app_name
                last_event.window_title = window_title
                last_event.classification = category
                last_event.confidence = confidence
                last_event.classification_reason = reason
                session.add(last_event)
                session.commit()
                
        elif current_state in ["DISTRACTION", "IDLE", "UNKNOWN"]:
            if category == "study":
                # User returned to confidently productive study: resume immediately
                new_study = FocusSessionEvent(
                    session_id=focus_session.id,
                    state="STUDY",
                    start_time=now,
                    end_time=now,
                    duration=0,
                    app_name=app_name,
                    window_title=window_title,
                    classification=category,
                    confidence=confidence,
                    classification_reason=reason
                )
                session.add(new_study)
                session.commit()
            elif category == current_state.lower():
                # Keep active paused segment running
                last_event.end_time = now
                last_event.duration = int((now - last_event.start_time).total_seconds())
                session.add(last_event)
                session.commit()
            else:
                # User switched to a different paused category (e.g. distraction -> idle)
                new_state = category.upper()
                new_event = FocusSessionEvent(
                    session_id=focus_session.id,
                    state=new_state,
                    start_time=now,
                    end_time=now,
                    duration=0,
                    app_name=app_name,
                    window_title=window_title,
                    classification=category,
                    confidence=confidence,
                    classification_reason=reason
                )
                session.add(new_event)
                session.commit()

# Singleton helper
timer_state_machine = StudyTimerStateMachine()
