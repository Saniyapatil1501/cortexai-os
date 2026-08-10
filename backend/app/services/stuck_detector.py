import os
from datetime import datetime, timedelta
from typing import Dict, List
from sqlmodel import Session, select
from app.models import ActivityLog, FocusSession

class StuckDetectionEngine:
    def __init__(self):
        # Configurable stuck threshold score (default 0.70)
        try:
            self.threshold = float(os.getenv("STUCK_THRESHOLD", "0.70"))
        except ValueError:
            self.threshold = 0.70

    def evaluate(
        self,
        session: Session,
        user_id: int,
        active_session: FocusSession,
        current_app: str,
        current_title: str
    ) -> Dict:
        """
        Evaluates active context history and logs to determine if the student
        is currently stuck.
        """
        # Fetch activity logs from the last 10 minutes to analyze patterns
        ten_minutes_ago = datetime.utcnow() - timedelta(minutes=10)
        stmt = select(ActivityLog).where(
            ActivityLog.user_id == user_id,
            ActivityLog.timestamp >= ten_minutes_ago
        ).order_by(ActivityLog.timestamp.desc())
        logs = session.exec(stmt).all()

        signals = {}
        reasons = []

        # 1. Context Stagnation (Time spent on the exact same title)
        same_context_secs = 0
        current_title_lower = current_title.lower() if current_title else ""
        
        for l in logs:
            l_title = l.window_title.lower() if l.window_title else ""
            if l_title == current_title_lower:
                same_context_secs += l.duration_seconds
            else:
                break # stopped matching chronologically

        stagnation_score = 0.0
        if same_context_secs >= 600:  # 10 minutes
            stagnation_score = 0.60
            reasons.append(f"Stagnated on same window context for {round(same_context_secs / 60, 1)}m (+0.60)")
        elif same_context_secs >= 300:  # 5 minutes
            stagnation_score = 0.40
            reasons.append(f"Stagnated on same window context for {round(same_context_secs / 60, 1)}m (+0.40)")
        elif same_context_secs >= 120:  # 2 minutes
            stagnation_score = 0.20
            reasons.append(f"Stagnated on same window context for {round(same_context_secs / 60, 1)}m (+0.20)")
            
        signals["context_stagnation"] = stagnation_score

        # 2. Inactivity / Idle Ratio
        # Check total idle duration in last 10 minutes
        total_tracked_secs = sum(l.duration_seconds for l in logs) or 1
        idle_secs = sum(l.duration_seconds for l in logs if l.category == "idle")
        idle_ratio = idle_secs / total_tracked_secs
        
        idle_score = 0.0
        if idle_ratio >= 0.50 and total_tracked_secs >= 120:
            idle_score = 0.30
            reasons.append(f"High idle time ratio ({round(idle_ratio * 100)}%) (+0.30)")
        elif idle_ratio >= 0.25 and total_tracked_secs >= 120:
            idle_score = 0.15
            reasons.append(f"Moderate idle time ratio ({round(idle_ratio * 100)}%) (+0.15)")
            
        signals["inactivity_idle"] = idle_score

        # 3. Repeated Context Switch Frequency (Swaps between app names)
        # Count unique switches in last 5 minutes
        five_minutes_ago = datetime.utcnow() - timedelta(minutes=5)
        recent_logs = [l for l in logs if l.timestamp >= five_minutes_ago]
        switches = 0
        last_app = None
        for l in reversed(recent_logs):
            if last_app and l.app_name != last_app:
                switches += 1
            last_app = l.app_name

        switch_score = 0.0
        if switches >= 8:
            switch_score = 0.25
            reasons.append(f"High app switching frequency ({switches} times) (+0.25)")
        elif switches >= 4:
            switch_score = 0.15
            reasons.append(f"Moderate app switching frequency ({switches} times) (+0.15)")
            
        signals["switching_frequency"] = switch_score

        # 4. Context Goal Category Boost
        # If studying coding/problems, trigger stuck help more eagerly
        title_lower = current_title.lower() if current_title else ""
        is_coding = "leetcode" in title_lower or "hackerrank" in title_lower or "code" in current_app.lower()
        is_reading = "pdf" in title_lower or "docs" in title_lower or "book" in title_lower

        context_boost = 0.0
        if is_coding:
            context_boost = 0.15
            reasons.append("Active coding/problem solving context (+0.15)")
        elif is_reading:
            # Apply reading-intensity discount (reading takes time without input)
            context_boost = -0.20
            reasons.append("Active reading-intensive document context (-0.20)")
            
        signals["context_boost"] = context_boost

        # 5. Calculate Stuck Score
        stuck_score = stagnation_score + idle_score + switch_score + context_boost
        stuck_score = min(1.0, max(0.0, stuck_score))
        
        is_stuck = stuck_score >= self.threshold
        trigger_reason = " + ".join(reasons) if reasons else "Normal study progress"

        return {
            "stuck_score": round(stuck_score, 4),
            "is_stuck": is_stuck,
            "threshold": self.threshold,
            "trigger_reason": trigger_reason,
            "signals": signals
        }

# Singleton helper
stuck_detection_engine = StuckDetectionEngine()
