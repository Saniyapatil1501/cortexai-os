from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional

class BaseLLM(ABC):
    @abstractmethod
    async def generate(self, prompt: str, context: str, history: List[Dict[str, str]], image_base64: Optional[str] = None) -> str:
        """
        Generates a text completion response.
        """
        pass

    @abstractmethod
    async def stream(self, prompt: str, context: str, history: List[Dict[str, str]], image_base64: Optional[str] = None) -> AsyncGenerator[str, None]:
        """
        Streams a completion response token-by-token.
        """
        pass

    @abstractmethod
    def health_check(self) -> bool:
        """
        Returns True if the provider service is running and accessible.
        """
        pass

    @abstractmethod
    def get_detailed_status(self) -> str:
        """
        Returns detailed connection/model status.
        """
        pass
