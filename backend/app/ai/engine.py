from typing import AsyncGenerator, List, Dict
from app.ai.factory import ai_factory
from app.ai.prompts import AIPrompts

class AIEngine:
    def __init__(self):
        pass

    async def generate(self, prompt: str, context: str, history: List[dict], mode: str = "general") -> str:
        engine = ai_factory.get_engine()
        sys_prompt = AIPrompts.get_system_prompt(mode)
        full_context = f"{sys_prompt}\n\n{context}" if context else sys_prompt
        try:
            return await engine.generate(prompt, full_context, history)
        except Exception as e:
            print(f"[AIEngine] Generate error: {str(e)}")
            return "AI model is currently unavailable."

    async def stream(self, prompt: str, context: str, history: List[dict], mode: str = "general") -> AsyncGenerator[str, None]:
        engine = ai_factory.get_engine()
        sys_prompt = AIPrompts.get_system_prompt(mode)
        full_context = f"{sys_prompt}\n\n{context}" if context else sys_prompt
        
        try:
            async for chunk in engine.stream(prompt, full_context, history):
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

ai_engine = AIEngine()
