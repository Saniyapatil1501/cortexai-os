import os
import re
import numpy as np
import cv2
from typing import Dict, List, Tuple, Optional
from PIL import Image

# Set environmental variables to disable oneDNN / MKLDNN acceleration which crashes on PIR executor
os.environ["FLAGS_use_onednn"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT"] = "0"

# Graceful PaddleOCR imports
PADDLE_AVAILABLE = False
try:
    from paddleocr import PaddleOCR
    PADDLE_AVAILABLE = True
except ImportError:
    pass

class ScreenVisionProcessor:
    def __init__(self):
        self.ocr_engine = None
        self.is_initialized = False

    def lazy_init(self):
        """Initializes PaddleOCR only when required to save memory."""
        if self.is_initialized:
            return
        if PADDLE_AVAILABLE:
            try:
                # Load English and Devanagari layout models
                self.ocr_engine = PaddleOCR(use_angle_cls=True, lang="en", enable_mkldnn=False)
                self.is_initialized = True
            except Exception as e:
                print(f"Failed to load PaddleOCR engine: {str(e)}", flush=True)
        else:
            print("PaddleOCR is not installed. Skipping OCR text extraction.", flush=True)

    def preprocess_image(self, pil_image: Image.Image) -> np.ndarray:
        """
        Applies resolution normalization, grayscale conversion, and adaptive
        threshold binarization to enhance OCR character clarity.
        """
        # Convert PIL to openCV format
        img_np = np.array(pil_image)
        if len(img_np.shape) == 3:
            img_cv = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        else:
            img_cv = img_np

        # 1. Resolution Normalization: standard width of 1280
        h, w = img_cv.shape[:2]
        target_w = 1280
        target_h = int((target_w / w) * h)
        resized = cv2.resize(img_cv, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

        # 2. Grayscale Conversion
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

        # 3. Adaptive preprocessing based on theme (estimate using mean pixel intensity)
        mean_intensity = np.mean(gray)
        if mean_intensity < 80:
            # Dark Mode theme (IDE, Terminal)
            # Enhance contrast for bright text on dark backgrounds
            processed = cv2.equalizeHist(gray)
        else:
            # Light Mode theme (Webpages, Forms)
            # Apply adaptive thresholding to binarize text contours
            processed = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                cv2.THRESH_BINARY, 11, 2
            )

        return cv2.cvtColor(processed, cv2.COLOR_GRAY2BGR)

    def redact_pii(self, text: str) -> str:
        """Redacts sensitive credentials like email, phone, and card sequences."""
        email_pattern = r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
        phone_pattern = r'\b(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b'
        card_pattern = r'\b(?:\d[ -]?){13,16}\b'
        
        redacted = re.sub(email_pattern, "[EMAIL_REDACTED]", text)
        redacted = re.sub(phone_pattern, "[PHONE_REDACTED]", redacted)
        redacted = re.sub(card_pattern, "[CARD_REDACTED]", redacted)
        return redacted

    def detect_language(self, text: str) -> str:
        """Identifies text language boundaries including English and Devanagari blocks."""
        has_english = bool(re.search(r'[a-zA-Z]', text))
        has_hindi = bool(re.search(r'[\u0900-\u097F]', text))
        if has_english and has_hindi:
            return "Mixed (Hindi/English)"
        elif has_hindi:
            return "Hindi"
        return "English"

    def run_ocr(self, processed_img: np.ndarray) -> List[Dict]:
        """Runs PaddleOCR character extraction returning words, coordinates and scores."""
        self.lazy_init()
        if not self.ocr_engine:
            print("[OCR] Warning: PaddleOCR engine is not initialized. Skipping text extraction.", flush=True)
            return []

        try:
            # PaddleOCR takes file path or numpy array
            result = self.ocr_engine.ocr(processed_img)
            if not result or not result[0]:
                return []
            
            ocr_items = []
            res_0 = result[0]
            
            # Detect formatting type (PaddleX vs classic PaddleOCR)
            is_paddlex = False
            try:
                if "rec_texts" in res_0:
                    is_paddlex = True
            except:
                pass
                
            if is_paddlex:
                texts = res_0.get("rec_texts", [])
                scores = res_0.get("rec_scores", [])
                polys = res_0.get("rec_polys", [])
                boxes = res_0.get("rec_boxes", None)
                
                for i in range(len(texts)):
                    text = texts[i]
                    score = scores[i] if i < len(scores) else 1.0
                    x1, y1, x2, y2 = 0, 0, 0, 0
                    if polys and i < len(polys):
                        poly = polys[i]
                        xs = [pt[0] for pt in poly]
                        ys = [pt[1] for pt in poly]
                        x1, y1 = min(xs), min(ys)
                        x2, y2 = max(xs), max(ys)
                    elif boxes is not None and i < len(boxes):
                        box = boxes[i]
                        if len(box) >= 4:
                            x1, y1, x2, y2 = box[0], box[1], box[2], box[3]
                    ocr_items.append({
                        "text": text,
                        "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        "score": float(score)
                    })
            else:
                for line in res_0:
                    if not line or len(line) < 2:
                        continue
                    box = line[0]  # [[x0,y0], [x1,y1], [x2,y2], [x3,y3]]
                    text, score = line[1]
                    
                    xs = [pt[0] for pt in box]
                    ys = [pt[1] for pt in box]
                    x1, y1 = min(xs), min(ys)
                    x2, y2 = max(xs), max(ys)
                    
                    ocr_items.append({
                        "text": text,
                        "bbox": [int(x1), int(y1), int(x2), int(y2)],
                        "score": float(score)
                    })
            return ocr_items
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"OCR execution failure: {str(e)}")
            return []

    def perform_spatial_clustering(self, ocr_items: List[Dict], img_shape: Tuple[int, int]) -> List[Dict]:
        """
        Clusters nearby text elements vertically and horizontally into distinct
        spatial layout regions using traditional computer vision guidelines.
        """
        if not ocr_items:
            return []

        # Sort elements top to bottom
        sorted_items = sorted(ocr_items, key=lambda x: x["bbox"][1])
        regions = []
        visited = set()

        # Vertical overlay distance threshold for paragraph clustering (e.g. 25px)
        vert_thresh = 25
        
        for i, item in enumerate(sorted_items):
            if i in visited:
                continue
                
            # Start new region cluster
            visited.add(i)
            cluster = [item]
            box = item["bbox"]
            rx1, ry1, rx2, ry2 = box[0], box[1], box[2], box[3]
            
            for j in range(i + 1, len(sorted_items)):
                if j in visited:
                    continue
                
                j_box = sorted_items[j]["bbox"]
                jx1, jy1, jx2, jy2 = j_box[0], j_box[1], j_box[2], j_box[3]
                
                # Check vertical proximity
                if jy1 - ry2 < vert_thresh:
                    # Overlaps horizontally or is close horizontally
                    h_overlap = not (jx2 < rx1 - 50 or jx1 > rx2 + 50)
                    if h_overlap:
                        cluster.append(sorted_items[j])
                        visited.add(j)
                        # Expand region bounds
                        rx1 = min(rx1, jx1)
                        ry1 = min(ry1, jy1)
                        rx2 = max(rx2, jx2)
                        ry2 = max(ry2, jy2)
            
            # Formulate text segment
            cluster_text = " ".join([c["text"] for c in sorted(cluster, key=lambda x: (x["bbox"][1], x["bbox"][0]))])
            regions.append({
                "text": cluster_text,
                "bbox": [rx1, ry1, rx2, ry2]
            })

        return regions

    def classify_screen(self, regions: List[Dict], app_name: str, window_title: str) -> Tuple[str, List[Dict]]:
        """
        Executes hybrid visual-layout screen classification, categorizing areas
        into coding problems, editors, terminals, or registration forms.
        """
        app_lower = app_name.lower()
        title_lower = window_title.lower() if window_title else ""
        
        screen_type = "UNKNOWN"
        labeled_regions = []
        
        # Concat all extracted text for keyword checking
        full_text = " ".join([r["text"] for r in regions]).lower()
        
        # Check trace errors
        is_traceback = (
            "traceback" in full_text or 
            "exception" in full_text or 
            "line" in full_text or 
            ("error" in full_text and ("cmd" in app_lower or "terminal" in app_lower or "powershell" in app_lower or "command prompt" in title_lower))
        )
        # Check editor indicators
        is_editor_code = "def " in full_text or "class " in full_text or "import " in full_text or "void " in full_text or "return " in full_text
        # Check problem targets
        is_problem = "leetcode" in title_lower or "hackerrank" in title_lower or "constraints" in full_text or "example 1" in full_text
        # Check forms
        is_form = "registration" in full_text or "form" in full_text or "विद्यार्थी" in full_text or "name" in full_text and "email" in full_text and "submit" in full_text

        # Screen Classification Logic
        if is_problem:
            screen_type = "CODING_PROBLEM"
        elif is_traceback:
            screen_type = "TERMINAL_ERROR"
        elif is_editor_code:
            screen_type = "CODE_EDITOR"
        elif is_form:
            screen_type = "FORM"
        elif "docs" in title_lower or "wikipedia" in title_lower:
            screen_type = "STUDY_WEBPAGE"
        elif "pdf" in title_lower or "notes" in title_lower:
            screen_type = "DOCUMENT"

        # Label regions based on spatial locations
        for r in regions:
            r_text = r["text"].lower()
            box = r["bbox"]
            
            # Simple spatial classification heuristics
            r_type = "general"
            if screen_type == "CODING_PROBLEM":
                # LeetCode description is typically on the left side of screen
                if box[2] < 640:
                    r_type = "problem_statement"
                else:
                    r_type = "code_editor"
            elif screen_type == "TERMINAL_ERROR":
                if "error" in r_text or "exception" in r_text or "traceback" in r_text:
                    r_type = "output"
                else:
                    r_type = "code_editor"
            elif screen_type == "FORM":
                r_type = "form_fields"
                
            labeled_regions.append({
                "type": r_type,
                "text": self.redact_pii(r["text"]),
                "bbox": r["bbox"]
            })

        return screen_type, labeled_regions

    def process_screenshot(self, pil_image: Image.Image, app_name: str, window_title: str) -> Dict:
        """
        Executes the full Computer Vision screen analysis pipeline, returning
        a Structured Screen Representation.
        """
        # 1. Preprocess
        processed = self.preprocess_image(pil_image)
        h, w = processed.shape[:2]
        
        # 2. Run OCR
        ocr_items = self.run_ocr(processed)
        
        # 3. Spatial Clustering
        raw_regions = self.perform_spatial_clustering(ocr_items, (h, w))
        
        # 4. Classify and Label Regions
        screen_type, labeled_regions = self.classify_screen(raw_regions, app_name, window_title)
        
        # Concatenate text for language detection
        combined_text = " ".join([r["text"] for r in raw_regions])
        detected_lang = self.detect_language(combined_text)
        
        return {
            "application": app_name,
            "window_title": window_title,
            "detected_language": detected_lang,
            "screen_type": screen_type,
            "regions": labeled_regions
        }



# Singleton helper
screen_vision_processor = ScreenVisionProcessor()
