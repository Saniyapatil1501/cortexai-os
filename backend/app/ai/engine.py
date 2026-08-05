import asyncio
from typing import AsyncGenerator, List

class AIEngine:
    def __init__(self):
        pass

    async def generate(self, prompt: str, context: str, history: List[dict]) -> str:
        """
        Generates a static response indicating the AI engine is undergoing upgrade.
        """
        return "AI engine is being upgraded for the CortexAI Vision final-year version."

    async def stream(self, prompt: str, context: str, history: List[dict]) -> AsyncGenerator[str, None]:
        """
        Streams a static response word-by-word with small delays to preserve UI streaming animations.
        """
        response_text = "AI engine is being upgraded for the CortexAI Vision final-year version."
        words = response_text.split(" ")
        for i, word in enumerate(words):
            yield (word + " " if i < len(words) - 1 else word)
            await asyncio.sleep(0.08)

    def health_check(self) -> bool:
        """
        Checks if the AI engine is responsive (always True for the upgraded placeholder).
        """
        return True

ai_engine = AIEngine()
