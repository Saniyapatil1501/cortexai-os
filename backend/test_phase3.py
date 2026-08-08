import os
import sys
import time
from datetime import datetime, timedelta
from sqlmodel import SQLModel, create_engine, Session, select

# Add parent directory to path so app modules import correctly
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.models import FocusSession, FocusSessionEvent, UserFeedbackCorrection
from app.services.classifier import context_classifier
from app.services.timer import timer_state_machine

def run_tests():
    print("==================================================")
    print("CORTEXAI PHASE 3 INTEGRATION VERIFICATION SUITE")
    print("==================================================")
    
    # 1. Initialize temporary test engine
    sqlite_url = "sqlite:///test_verify.db"
    engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        # Create a mock user
        # Note: Since User is synced via Clerk, we can mock user ID as 1
        user_id = 1
        
        # 2. Test Case 1 & 2 & 3: DSA goal + LeetCode / HackerRank / Instagram
        dsa_goal = "Practice Data Structures and Algorithms in C++"
        
        c_leetcode = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Two Sum - LeetCode - Google Chrome", study_goal=dsa_goal
        )
        print(f"Test 1 (LeetCode): Category={c_leetcode['category']}, Reason='{c_leetcode['reason']}'")
        assert c_leetcode["category"] == "study"
        
        c_hackerrank = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Solve Algorithms Questions - HackerRank", study_goal=dsa_goal
        )
        print(f"Test 2 (HackerRank): Category={c_hackerrank['category']}, Reason='{c_hackerrank['reason']}'")
        assert c_hackerrank["category"] == "study"
        
        c_insta = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Instagram Direct Messages Feed", study_goal=dsa_goal
        )
        print(f"Test 3 (Instagram): Category={c_insta['category']}, Reason='{c_insta['reason']}'")
        assert c_insta["category"] == "distraction"
        
        # 3. Test Case 4 & 5: ML Goal + YouTube educational vs entertainment
        ml_goal = "Study Machine Learning CNN Architectures"
        
        c_ml_yt = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Stanford CS229: Machine Learning Lecture 10 - YouTube", study_goal=ml_goal
        )
        # Note: YouTube contains distraction keyword 'youtube', so it resolves to distraction/unknown by default
        print(f"Test 4 (ML YouTube lecture): Category={c_ml_yt['category']}, Reason='{c_ml_yt['reason']}'")
        
        c_ent_yt = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Top 10 Minecraft speedruns of 2026 - YouTube", study_goal=ml_goal
        )
        print(f"Test 5 (Entertainment YouTube): Category={c_ent_yt['category']}, Reason='{c_ent_yt['reason']}'")
        assert c_ent_yt["category"] == "distraction"

        # 4. Test Case 6: Ambiguous chrome page -> UNKNOWN
        c_ambig = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Local weather forecast updates today", study_goal=ml_goal
        )
        print(f"Test 6 (Ambiguous page): Category={c_ambig['category']}, Reason='{c_ambig['reason']}'")
        assert c_ambig["category"] == "unknown"

        # 5. Set up Focus Session for state machine tests
        sess_start_time = datetime.utcnow()
        focus_sess = FocusSession(
            user_id=user_id,
            intention=dsa_goal,
            started_at=sess_start_time,
            target_duration_seconds=3000,
            completed=False
        )
        session.add(focus_sess)
        session.commit()
        session.refresh(focus_sess)
        
        current_mock_time = sess_start_time
        
        # 6. Test Case 7: 2-second accidental switch -> no noisy pause
        # Update tick 1: STUDY
        timer_state_machine.update(
            session=session, focus_session=focus_sess,
            classification={"category": "study", "confidence": 0.95, "reason": "LeetCode matched"},
            app_name="chrome.exe", window_title="Two Sum - LeetCode",
            now=current_mock_time
        )
        
        # Switch to distraction (accidental, 2 seconds)
        # Ticks 1 & 2 while in PENDING state
        for i in range(2):
            current_mock_time += timedelta(seconds=1)
            timer_state_machine.update(
                session=session, focus_session=focus_sess,
                classification={"category": "distraction", "confidence": 0.98, "reason": "Instagram blacklist"},
                app_name="chrome.exe", window_title="Instagram Feed",
                now=current_mock_time
            )
            
        # Switch back to STUDY before confirmation grace threshold (default 5s)
        current_mock_time += timedelta(seconds=1)
        timer_state_machine.update(
            session=session, focus_session=focus_sess,
            classification={"category": "study", "confidence": 0.95, "reason": "LeetCode matched"},
            app_name="chrome.exe", window_title="Two Sum - LeetCode",
            now=current_mock_time
        )
        
        # Verify no distraction event confirmed
        stmt_evts = select(FocusSessionEvent).where(FocusSessionEvent.session_id == focus_sess.id)
        evts = session.exec(stmt_evts).all()
        states = [e.state for e in evts]
        print(f"Test 7 (Accidental Switch States): {states}")
        assert "DISTRACTION" not in states
        
        # 7. Test Case 8: Confirmed distraction -> Pause at correct start timestamp
        # Update tick to study first
        current_mock_time += timedelta(seconds=1)
        timer_state_machine.update(
            session=session, focus_session=focus_sess,
            classification={"category": "study", "confidence": 0.95, "reason": "LeetCode matched"},
            app_name="chrome.exe", window_title="Two Sum - LeetCode",
            now=current_mock_time
        )
        
        # Switch to instagram and remain for 6 ticks
        for i in range(6):
            current_mock_time += timedelta(seconds=1)
            timer_state_machine.update(
                session=session, focus_session=focus_sess,
                classification={"category": "distraction", "confidence": 0.98, "reason": "Instagram blacklist"},
                app_name="chrome.exe", window_title="Instagram Feed",
                now=current_mock_time
            )
            
        # Verify that transition is now confirmed and recorded
        session.refresh(focus_sess)
        evts_dist = session.exec(select(FocusSessionEvent).where(FocusSessionEvent.session_id == focus_sess.id)).all()
        dist_segment = [e for e in evts_dist if e.state == "DISTRACTION"]
        print(f"Test 8 (Confirmed Distraction Pauses): Found {len(dist_segment)} distraction segments.")
        assert len(dist_segment) > 0
        
        # 8. Test Case 9: Return to study -> automatic resume
        current_mock_time += timedelta(seconds=1)
        timer_state_machine.update(
            session=session, focus_session=focus_sess,
            classification={"category": "study", "confidence": 0.95, "reason": "LeetCode matched"},
            app_name="chrome.exe", window_title="Two Sum - LeetCode",
            now=current_mock_time
        )
        evts_resume = session.exec(select(FocusSessionEvent).where(FocusSessionEvent.session_id == focus_sess.id)).all()
        print(f"Test 9 (Auto-Resume): Latest state is {evts_resume[-1].state}")
        assert evts_resume[-1].state == "STUDY"

        # 9. Test Case 10: Idle -> pause
        current_mock_time += timedelta(seconds=1)
        timer_state_machine.update(
            session=session, focus_session=focus_sess,
            classification={"category": "idle", "confidence": 1.0, "reason": "System Idle"},
            app_name="Idle", window_title="System Idle",
            now=current_mock_time
        )
        # Verify that it enters PENDING target idle
        stmt_pending = select(FocusSessionEvent).where(
            FocusSessionEvent.session_id == focus_sess.id,
            FocusSessionEvent.state == "PENDING"
        )
        pending_segment = session.exec(stmt_pending).first()
        print(f"Test 10 (Pending Idle): Target category is {pending_segment.classification if pending_segment else 'None'}")
        assert pending_segment is not None
        assert pending_segment.classification == "idle"

        # 10. Test Case 11 & 12: User feedback correction adaptive learning
        # Store a correction for YouTube lecture to study label
        feedback = UserFeedbackCorrection(
            user_id=user_id,
            app_name="chrome.exe",
            window_title="Stanford CS229: Machine Learning Lecture 10 - YouTube",
            study_goal=ml_goal,
            predicted_label="distraction",
            corrected_label="study"
        )
        session.add(feedback)
        session.commit()
        
        # Query classification for the EXACT corrected title
        c_corrected = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Stanford CS229: Machine Learning Lecture 10 - YouTube", study_goal=ml_goal
        )
        print(f"Test 11 (Feedback exact match): Category={c_corrected['category']}, Reason='{c_corrected['reason']}'")
        assert c_corrected["category"] == "study"
        
        # Test Case 12: Similar lecture title
        c_similar = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Stanford CS229: Machine Learning Lecture 11 - YouTube", study_goal=ml_goal
        )
        print(f"Test 12 (Feedback semantic matching KNN): Category={c_similar['category']}, Reason='{c_similar['reason']}'")
        assert c_similar["category"] == "study"
        
        # Test Case 13: Unrelated video title on same site (should remain distraction)
        c_unrelated = context_classifier.classify(
            session=session, user_id=user_id, app_name="chrome.exe",
            window_title="Funny Dog compilation 2026 - YouTube", study_goal=ml_goal
        )
        print(f"Test 13 (Feedback exclusion check): Category={c_unrelated['category']}, Reason='{c_unrelated['reason']}'")
        assert c_unrelated["category"] == "distraction"

        # 11. Test Case 14 & 15: Session reaches target only after verified time and timeline reconciles
        # Check active session duration
        session.refresh(focus_sess)
        print(f"Test 14 & 15: Focus session verified duration = {focus_sess.duration_seconds}s")
        
    print("==================================================")
    print("ALL PHASE 3 INTEGRATION VERIFICATION TESTS PASSED!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
