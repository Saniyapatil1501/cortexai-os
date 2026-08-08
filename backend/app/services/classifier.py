import os
import json
import numpy as np
from typing import List, Dict, Optional, Tuple
from sqlmodel import Session, select
from app.models import UserFeedbackCorrection
from app.nlp.embeddings import embedding_engine

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    if not v1 or not v2:
        return 0.0
    arr1 = np.array(v1, dtype=np.float32)
    arr2 = np.array(v2, dtype=np.float32)
    dot = np.dot(arr1, arr2)
    norm1 = np.linalg.norm(arr1)
    norm2 = np.linalg.norm(arr2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot / (norm1 * norm2))

class ContextClassifier:
    def __init__(self):
        # Cache category prototype embeddings to save calculation time
        self.study_prototype = embedding_engine.embed_query("coding programming learning lecture mathematics tutorial computer science research documentation")
        self.distr_prototype = embedding_engine.embed_query("social media entertainment gameplay movie music chatting memes shopping video games")
        # In-memory feedback embedding cache to prevent DB/model overhead
        self._feedback_embed_cache = {}

    def get_feedback_embedding(self, feedback_id: int, title: str) -> List[float]:
        if feedback_id in self._feedback_embed_cache:
            return self._feedback_embed_cache[feedback_id]
        vector = embedding_engine.embed_query(title)
        self._feedback_embed_cache[feedback_id] = vector
        return vector

    def classify(
        self,
        session: Session,
        user_id: int,
        app_name: str,
        window_title: str,
        study_goal: str,
        previous_state: Optional[str] = None
    ) -> Dict:
        """
        Classifies active desktop context using direct rules, semantic goal mapping,
        category similarity, and historical feedback corrections.
        """
        if not app_name or app_name.lower() == "idle" or window_title == "System Idle":
            return {
                "category": "idle",
                "study_score": 0.0,
                "distraction_score": 1.0,
                "confidence": 1.0,
                "reason": "System input idle detected."
            }

        app_lower = app_name.lower().strip()
        title_lower = window_title.lower().strip() if window_title else ""
        
        # 1. Rule signals
        rule_study = 0.0
        rule_distr = 0.0
        
        coding_apps = ["code.exe", "windowsterminal.exe", "cmd.exe", "powershell.exe", "idea64.exe", "pycharm64.exe", "eclipse.exe", "vscode"]
        distr_apps = ["spotify.exe", "steam.exe", "discord.exe", "slack.exe", "whatsapp.exe", "telegram.exe"]
        browser_apps = ["chrome.exe", "firefox.exe", "msedge.exe", "browser.exe", "safari"]

        if any(c in app_lower for c in coding_apps):
            rule_study = 0.85
        elif any(d in app_lower for d in distr_apps):
            if "discord" in app_lower or "slack" in app_lower:
                rule_distr = 0.55
            else:
                rule_distr = 0.90
        elif any(b in app_lower for b in browser_apps):
            distr_titles = ["youtube", "facebook", "twitter", "reddit", "netflix", "instagram", "twitch", "tiktok"]
            study_titles = ["github", "stackoverflow", "notion", "docs", "google search", "medium", "arxiv", "leetcode", "hackerrank", "coursera"]
            
            if any(k in title_lower for k in distr_titles):
                rule_distr = 0.90
            elif any(k in title_lower for k in study_titles):
                rule_study = 0.80

        # 2. Goal Semantic Similarity
        goal_sim = 0.0
        if study_goal and window_title:
            goal_vector = embedding_engine.embed_query(study_goal)
            title_vector = embedding_engine.embed_query(window_title)
            goal_sim = cosine_similarity(goal_vector, title_vector)

        semantic_study_score = max(0.0, goal_sim)

        # 3. Category Semantic Prototype Similarity
        cat_study = 0.0
        cat_distr = 0.0
        if window_title:
            title_vec = embedding_engine.embed_query(window_title)
            cat_study = cosine_similarity(title_vec, self.study_prototype)
            cat_distr = cosine_similarity(title_vec, self.distr_prototype)

        # 4. User Feedback Learning (KNN Memory Matching)
        fb_study = 0.0
        fb_distr = 0.0
        feedback_matched = False
        
        statement = select(UserFeedbackCorrection).where(UserFeedbackCorrection.user_id == user_id)
        corrections = session.exec(statement).all()
        
        if corrections and window_title:
            current_vector = embedding_engine.embed_query(window_title)
            best_sim = 0.0
            best_correction = None
            
            for c in corrections:
                if c.app_name.lower().strip() == app_lower:
                    c_vector = self.get_feedback_embedding(c.id if c.id is not None else hash(c.window_title), c.window_title)
                    sim = cosine_similarity(current_vector, c_vector)
                    if sim > best_sim:
                        best_sim = sim
                        best_correction = c
            
            if best_correction and best_sim >= 0.70:
                feedback_matched = True
                lbl = best_correction.corrected_label.lower().strip()
                if lbl == "study":
                    fb_study = min(0.95, best_sim * 1.1)
                elif lbl == "distraction":
                    fb_distr = min(0.95, best_sim * 1.1)

        # 5. Hybrid Weighting & Confidence Evaluation
        if feedback_matched:
            study_score = (rule_study * 0.15) + (semantic_study_score * 0.15) + (cat_study * 0.1) + (fb_study * 0.6)
            distraction_score = (rule_distr * 0.15) + (cat_distr * 0.15) + (fb_distr * 0.7)
        else:
            study_score = (rule_study * 0.45) + (semantic_study_score * 0.35) + (cat_study * 0.2)
            distraction_score = (rule_distr * 0.50) + (cat_distr * 0.50)

        # Apply prior rule boosts when no conflicting rule is present and no user feedback is matched
        if not feedback_matched:
            if rule_study > 0.50 and rule_distr == 0:
                study_score = max(study_score, rule_study)
            elif rule_distr > 0.50 and rule_study == 0:
                distraction_score = max(distraction_score, rule_distr)

        study_score = min(1.0, max(0.0, study_score))
        distraction_score = min(1.0, max(0.0, distraction_score))
        
        # Decide category label
        reasons = []
        if study_score >= 0.55 and study_score > distraction_score:
            category = "study"
            confidence = round(study_score, 4)
            if rule_study > 0: reasons.append("Rule Whitelist")
            if semantic_study_score > 0: reasons.append(f"Goal Semantic Match ({round(goal_sim, 2)})")
            if cat_study > 0: reasons.append("Study Category Prototype Match")
            if fb_study > 0: reasons.append("Historical User Correction Memory")
        elif distraction_score >= 0.55 and distraction_score > study_score:
            category = "distraction"
            confidence = round(distraction_score, 4)
            if rule_distr > 0: reasons.append("Rule Blacklist")
            if cat_distr > 0: reasons.append("Distraction Category Prototype Match")
            if fb_distr > 0: reasons.append("Historical User Correction Memory")
        else:
            category = "unknown"
            confidence = round(1.0 - abs(study_score - distraction_score), 4)
            reasons.append("Unclear signals (low confidence)")
            
        reason_str = " + ".join(reasons) if reasons else "No dominant signals"
        
        return {
            "category": category,
            "study_score": round(study_score, 4),
            "distraction_score": round(distraction_score, 4),
            "confidence": confidence,
            "reason": reason_str
        }

# Singleton helper
context_classifier = ContextClassifier()
