import os
from app.ai.providers.ollama import OllamaLLM
from app.ai.providers.openai import OpenAILLM

class AIEngineFactory:
    def __init__(self):
        self.provider = os.getenv("AI_PROVIDER", "ollama").lower()
        self.model_name = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b")
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self._engine = None

    def get_engine(self):
        if self._engine is None:
            if self.provider == "openai":
                model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
                self._engine = OpenAILLM(model_name=model)
            else:
                self._engine = OllamaLLM(model_name=self.model_name, base_url=self.base_url)
        return self._engine

ai_factory = AIEngineFactory()
