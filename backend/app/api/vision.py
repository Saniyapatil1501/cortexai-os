import time
import base64
import json
from io import BytesIO
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel
from typing import List, Dict, Optional
from PIL import Image

from app.database import get_session
from app.models import FocusSession, FocusSessionEvent
from app.services.vision_ocr import screen_vision_processor
from app.services.stuck_detector import stuck_detection_engine
from app.ai.factory import ai_factory
from app.rag.retriever import RAGRetriever

router = APIRouter()

class ScreenAnalysisRequest(BaseModel):
    user_id: int
    app_name: str
    window_title: str
    study_goal: str
    image_base64: Optional[str] = None

@router.get("/stuck-check/{user_id}")
def check_stuck_status(user_id: int, session: Session = Depends(get_session)):
    import main as main_module
    if not main_module.tracker:
        raise HTTPException(status_code=503, detail="Activity tracker daemon not running")
        
    app_name, window_title = main_module.tracker.get_active_window_details()
    
    # Check if user has active focus session
    stmt = select(FocusSession).where(
        FocusSession.user_id == user_id,
        FocusSession.completed == False
    )
    active_sess = session.exec(stmt).first()
    if not active_sess:
        return {"is_stuck": False, "stuck_score": 0.0, "message": "No active focus session"}
        
    res = stuck_detection_engine.evaluate(
        session=session,
        user_id=user_id,
        active_session=active_sess,
        current_app=app_name,
        current_title=window_title
    )
    return res

@router.post("/analyze")
async def analyze_screen(data: ScreenAnalysisRequest, session: Session = Depends(get_session)):
    start_time = time.time()
    
    # 1. Privacy Pre-filter
    sensitive_patterns = ["checkout", "paypal", "stripe", "bank", "password", "signin", "login", "incognito"]
    title_lower = data.window_title.lower()
    app_lower = data.app_name.lower()
    if any(p in title_lower for p in sensitive_patterns) or any(p in app_lower for p in sensitive_patterns):
        return {
            "status": "blocked",
            "message": "Screen analysis blocked for privacy reasons."
        }
        
    # Check active focus session
    stmt = select(FocusSession).where(
        FocusSession.user_id == data.user_id,
        FocusSession.completed == False
    )
    active_sess = session.exec(stmt).first()
    
    # Log SCREEN_ANALYSIS_REQUESTED segment event
    if active_sess:
        req_evt = FocusSessionEvent(
            session_id=active_sess.id,
            state="PENDING",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            duration=0,
            app_name=data.app_name,
            window_title=data.window_title,
            classification="unknown",
            confidence=1.0,
            classification_reason="SCREEN_ANALYSIS_REQUESTED"
        )
        session.add(req_evt)
        session.commit()

    # 2. Capture Time & Decode / Win32 Grab active window bounds
    t_start_decode = time.time()
    image = None
    if data.image_base64:
        try:
            header, encoded = data.image_base64.split(",", 1) if "," in data.image_base64 else ("", data.image_base64)
            image_data = base64.b64decode(encoded)
            image = Image.open(BytesIO(image_data))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image format: {str(e)}")
    else:
        try:
            import mss
            from app.services.tracker import PLATFORM_WINDOWS
            if PLATFORM_WINDOWS:
                import win32gui
                hwnd = win32gui.GetForegroundWindow()
                if hwnd != 0:
                    rect = win32gui.GetWindowRect(hwnd)  # (left, top, right, bottom)
                    x = rect[0]
                    y = rect[1]
                    w = rect[2] - rect[0]
                    h = rect[3] - rect[1]
                    if w > 0 and h > 0:
                        with mss.mss() as sct:
                            monitor = {"left": x, "top": y, "width": w, "height": h}
                            sct_img = sct.grab(monitor)
                            image = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            # Fail closed: Do NOT capture full screen silently if active window bounds are missing
            if not image:
                raise HTTPException(
                    status_code=400, 
                    detail="Unable to safely identify the active window. Screen analysis was cancelled."
                )
        except HTTPException as he:
            raise he
        except Exception as e:
            print(f"Active window MSS capture failed: {str(e)}")
            raise HTTPException(
                status_code=400, 
                detail="Unable to safely identify the active window. Screen analysis was cancelled."
            )
        
    capture_latency = time.time() - t_start_decode

    # 3. Preprocessing
    t_preprocess = time.time()
    processed_np = screen_vision_processor.preprocess_image(image)
    preprocess_latency = time.time() - t_preprocess

    # 4. OCR
    t_ocr = time.time()
    raw_ocr = screen_vision_processor.run_ocr(processed_np)
    ocr_latency = time.time() - t_ocr

    # 5. Layout regions / Classification
    raw_regions = screen_vision_processor.perform_spatial_clustering(raw_ocr, processed_np.shape)
    screen_type, labeled_regions = screen_vision_processor.classify_screen(raw_regions, data.app_name, data.window_title)
    
    # Concatenate text for language detection
    combined_text = " ".join([r["text"] for r in labeled_regions])
    detected_lang = screen_vision_processor.detect_language(combined_text)

    # 6. Conditional RAG query (Semantic Relevance Routing)
    t_fusion = time.time()
    rag_context = ""
    try:
        import os
        from app.rag.retriever import retriever as rag_retriever
        try:
            rag_rel_thresh = float(os.getenv("RAG_RELEVANCE_THRESHOLD", "0.35"))
        except ValueError:
            rag_rel_thresh = 0.35
            
        results = rag_retriever.retrieve(
            session=session, 
            query=combined_text, 
            user_id=data.user_id, 
            top_k=2, 
            threshold=rag_rel_thresh
        )
        if results:
            rag_context = rag_retriever.build_rag_context(results)
    except Exception as e:
        print(f"RAG Semantic Routing warning: {str(e)}")
        
    context_fusion_latency = time.time() - t_fusion

    # 7. Progressive coaching prompts
    progressive_prompt = (
        "Analyze the structured screen coordinates, application context, and study goal.\n"
        "Provide assistance based on the detected screen type.\n"
        f"Screen Type: {screen_type}\n"
        f"Study Intention: {data.study_goal}\n"
        f"Detected Language: {detected_lang}\n"
    )
    
    if screen_type == "CODING_PROBLEM":
        progressive_prompt += (
            "Provide progressive tutor response: Level 1 (problem breakdown), Level 2 (algorithmic hint), Level 3 (concept/pseudocode).\n"
            "Do NOT immediately output the full solution code unless specifically asked.\n"
        )
    elif screen_type == "FORM":
        progressive_prompt += (
            "Explain translation labels (especially Devanagari Hindi translation fields) to English and guide field entries.\n"
            "Do NOT enter payment, bank, password, or sensitive details.\n"
        )
    elif screen_type == "TERMINAL_ERROR":
        progressive_prompt += (
            "Identify the traceback lines, explain what the compiler/runtime error means, and outline debugging steps.\n"
        )
    else:
        progressive_prompt += (
            "Provide helpful concept hints matching the active screen layout.\n"
        )
    
    # 8. Calling local Ollama LLM
    t_llm = time.time()
    try:
        engine = ai_factory.get_engine()
        response_text = await engine.generate(
            prompt=progressive_prompt,
            context=f"Structured Screen Regions:\n{json.dumps(labeled_regions)}\n\nRAG Material:\n{rag_context}",
            history=[]
        )
    except Exception as e:
        response_text = f"Local model inference failed: {str(e)}"
        
    llm_latency = time.time() - t_llm

    # Log SCREEN_ANALYSIS_COMPLETED event segment
    if active_sess:
        comp_evt = FocusSessionEvent(
            session_id=active_sess.id,
            state="PENDING",
            start_time=datetime.utcnow(),
            end_time=datetime.utcnow(),
            duration=0,
            app_name=data.app_name,
            window_title=data.window_title,
            classification="unknown",
            confidence=1.0,
            classification_reason="SCREEN_ANALYSIS_COMPLETED"
        )
        session.add(comp_evt)
        session.commit()

    total_latency = time.time() - start_time

    return {
        "status": "success",
        "screen_type": screen_type,
        "detected_language": detected_lang,
        "analysis": response_text,
        "structured_regions": labeled_regions,
        "performance": {
            "capture_time_ms": int(capture_latency * 1000),
            "preprocessing_time_ms": int(preprocess_latency * 1000),
            "ocr_time_ms": int(ocr_latency * 1000),
            "context_fusion_time_ms": int(context_fusion_latency * 1000),
            "genai_latency_ms": int(llm_latency * 1000),
            "total_latency_ms": int(total_latency * 1000)
        }
    }
