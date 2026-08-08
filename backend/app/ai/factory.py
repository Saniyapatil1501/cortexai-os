import os
from app.ai.providers.ollama import OllamaLLM

class AIEngineFactory:
    def __init__(self):
        self.provider = os.getenv("AI_PROVIDER", "ollama").lower()
        self.model_name = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b")
        self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    def get_engine(self):
        # In Phase 2, we support keyless local inference via Ollama
        if self.provider == "ollama":
            return OllamaLLM(model_name=self.model_name, base_url=self.base_url)
        else:
            return OllamaLLM(model_name=self.model_name, base_url=self.base_url)

ai_factory = AIEngineFactory()
