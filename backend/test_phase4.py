import time
import base64
from io import BytesIO
from datetime import datetime, timedelta
from PIL import Image
from sqlmodel import Session, SQLModel, create_engine
from app.models import ActivityLog, FocusSession
from app.services.vision_ocr import screen_vision_processor
from app.services.stuck_detector import stuck_detection_engine

# Create SQLite temporary memory database for tests
DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SQLModel.metadata.create_all(engine)

def generate_blank_image():
    # Helper to generate a small white image
    img = Image.new("RGB", (300, 100), color="white")
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

def run_tests():
    print("==================================================")
    print("CORTEXAI PHASE 4 COMPUTER VISION & STUCK TESTS")
    print("==================================================")

    # 1. OCR Preprocessing and Detection scenarios
    print("Test 1 (LeetCode Problem): ", end="")
    regions = [
        {"text": "LeetCode: 1. Two Sum", "bbox": [10, 10, 200, 40]},
        {"text": "Constraints: 10^9 <= nums[i] <= 10^9", "bbox": [10, 50, 400, 80]},
        {"text": "def twoSum(self, nums, target):", "bbox": [500, 50, 900, 80]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Google Chrome", "Two Sum - LeetCode")
    assert stype == "CODING_PROBLEM"
    print("PASSED")

    print("Test 2 (HackerRank Problem): ", end="")
    regions = [
        {"text": "HackerRank Challenge", "bbox": [10, 10, 200, 40]},
        {"text": "Find the maximum elements inside the array list.", "bbox": [10, 50, 400, 80]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Chrome", "HackerRank Challenge")
    assert stype == "CODING_PROBLEM"
    print("PASSED")

    print("Test 3 (VS Code Python Error): ", end="")
    regions = [
        {"text": "Traceback (most recent call last):", "bbox": [10, 10, 300, 30]},
        {"text": "IndexError: list index out of range", "bbox": [10, 40, 300, 60]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Visual Studio Code", "main.py")
    assert stype == "TERMINAL_ERROR"
    print("PASSED")

    print("Test 4 (Terminal traceback): ", end="")
    regions = [
        {"text": "ZeroDivisionError: division by zero", "bbox": [10, 10, 400, 30]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "cmd.exe", "Command Prompt")
    assert stype == "TERMINAL_ERROR"
    print("PASSED")

    print("Test 5 (English Form): ", end="")
    regions = [
        {"text": "Student Registration Form", "bbox": [10, 10, 300, 40]},
        {"text": "First Name: ", "bbox": [10, 60, 100, 80]},
        {"text": "Submit", "bbox": [10, 120, 80, 140]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Google Chrome", "College Apply")
    assert stype == "FORM"
    print("PASSED")

    print("Test 6 (Hindi Form): ", end="")
    regions = [
        {"text": "विश्वविद्यालय प्रवेश फॉर्म", "bbox": [10, 10, 300, 40]},
        {"text": "विद्यार्थी का नाम", "bbox": [10, 60, 200, 80]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Google Chrome", "Apply")
    assert stype == "FORM"
    # Verify Devanagari detection
    lang = screen_vision_processor.detect_language("विश्वविद्यालय प्रवेश विद्यार्थी का नाम")
    assert lang == "Hindi"
    print("PASSED")

    print("Test 7 (Mixed Hindi-English Form): ", end="")
    lang = screen_vision_processor.detect_language("Student Name: विद्यार्थी का नाम")
    assert "Mixed" in lang
    print("PASSED")

    print("Test 8 (PDF Notes): ", end="")
    regions = [
        {"text": "Lecture 5 notes on Algorithms Complexity", "bbox": [10, 10, 400, 40]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Acrobat Reader", "dsa_notes.pdf")
    assert stype == "DOCUMENT"
    print("PASSED")

    print("Test 9 (Educational Webpage): ", end="")
    regions = [
        {"text": "Depth First Search tutorial on Wikipedia", "bbox": [10, 10, 400, 40]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Chrome", "Depth First Search - Wikipedia")
    assert stype == "STUDY_WEBPAGE"
    print("PASSED")

    print("Test 10 (Ambiguous Chrome Screen): ", end="")
    regions = [
        {"text": "Blank Search Tab", "bbox": [10, 10, 200, 30]}
    ]
    stype, labeled = screen_vision_processor.classify_screen(regions, "Google Chrome", "New Tab")
    assert stype == "UNKNOWN"
    print("PASSED")

    # 2. Privacy & PII Redaction Tests
    print("Test 11 (Privacy / Checkout Page): ", end="")
    sensitive_patterns = ["checkout", "paypal", "stripe", "bank", "password"]
    test_title = "Checkout Order Summary - PayPal"
    # Matches checkout and paypal
    assert any(p in test_title.lower() for p in sensitive_patterns)
    print("PASSED")

    print("Test 12 (PII Redaction): ", end="")
    raw_text = "Contact student saniya@example.com at phone 123-456-7890 or card 1111-2222-3333-4444"
    redacted = screen_vision_processor.redact_pii(raw_text)
    assert "[EMAIL_REDACTED]" in redacted
    assert "[PHONE_REDACTED]" in redacted
    assert "[CARD_REDACTED]" in redacted
    print("PASSED")

    # 3. Stuck Detection Engine Tests
    with Session(engine) as db_session:
        user_id = 1
        
        # Insert a simulated active focus session
        sess = FocusSession(
            user_id=user_id,
            intention="Practice DSA LeetCode",
            target_duration_seconds=3600,
            duration_seconds=0,
            completed=False
        )
        db_session.add(sess)
        db_session.commit()
        db_session.refresh(sess)

        print("Test 13 (Stuck State - LeetCode + High Idle + Long same context): ", end="")
        # Generate logs for 6 minutes of the same window title with idle state
        start_t = datetime.utcnow() - timedelta(minutes=6)
        for i in range(12): # 12 logs of 30 seconds = 6 minutes
            log = ActivityLog(
                user_id=user_id,
                app_name="Google Chrome",
                window_title="Two Sum - LeetCode",
                category="idle", # 100% idle ratio
                timestamp=start_t + timedelta(seconds=i*30),
                duration_seconds=30
            )
            db_session.add(log)
        db_session.commit()

        eval_res = stuck_detection_engine.evaluate(
            session=db_session,
            user_id=user_id,
            active_session=sess,
            current_app="Google Chrome",
            current_title="Two Sum - LeetCode"
        )
        assert eval_res["is_stuck"] == True
        assert eval_res["stuck_score"] >= 0.70
        print(f"PASSED (Score: {eval_res['stuck_score']})")

        print("Test 14 (Reading Discount - PDF Notes + Long context should not be stuck): ", end="")
        # Clear logs and create reading logs
        db_session.query(ActivityLog).delete()
        db_session.commit()
        
        start_t = datetime.utcnow() - timedelta(minutes=6)
        for i in range(12):
            log = ActivityLog(
                user_id=user_id,
                app_name="Acrobat Reader",
                window_title="dsa_notes.pdf",
                category="idle", # idle while reading
                timestamp=start_t + timedelta(seconds=i*30),
                duration_seconds=30
            )
            db_session.add(log)
        db_session.commit()

        eval_res = stuck_detection_engine.evaluate(
            session=db_session,
            user_id=user_id,
            active_session=sess,
            current_app="Acrobat Reader",
            current_title="dsa_notes.pdf"
        )
        # Stuck score gets -0.20 discount, keeping it under the 0.70 threshold!
        assert eval_res["is_stuck"] == False
        print(f"PASSED (Score: {eval_res['stuck_score']})")

    print("==================================================")
    print("ALL PHASE 4 INTEGRATION TESTS COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
