from typing import AsyncGenerator, List, Dict, Optional
from app.ai.factory import ai_factory
from app.ai.prompts import AIPrompts

class AIEngine:
    def __init__(self):
        pass

    async def generate(self, prompt: str, context: str, history: List[dict], mode: str = "general", image_base64: Optional[str] = None) -> str:
        engine = ai_factory.get_engine()
        sys_prompt = AIPrompts.get_system_prompt(mode)
        full_context = f"{sys_prompt}\n\n{context}" if context else sys_prompt
        try:
            return await engine.generate(prompt, full_context, history, image_base64=image_base64)
        except Exception as e:
            print(f"[AIEngine] Generate error: {str(e)}")
            return "AI model is currently unavailable."

    async def stream(self, prompt: str, context: str, history: List[dict], mode: str = "general", image_base64: Optional[str] = None) -> AsyncGenerator[str, None]:
        engine = ai_factory.get_engine()
        sys_prompt = AIPrompts.get_system_prompt(mode)
        full_context = f"{sys_prompt}\n\n{context}" if context else sys_prompt
        
        try:
            async for chunk in engine.stream(prompt, full_context, history, image_base64=image_base64):
                yield chunk
        except Exception as e:
            print(f"[AIEngine] Stream error: {str(e)}")
            yield "AI model is currently unavailable."

    def health_check(self) -> bool:
        try:
            engine = ai_factory.get_engine()
            return engine.health_check()
        except Exception:
            return False

    def get_detailed_status(self) -> str:
        try:
            engine = ai_factory.get_engine()
            return engine.get_detailed_status()
        except Exception:
            return "OLLAMA_ERROR"

ai_engine = AIEngine()
