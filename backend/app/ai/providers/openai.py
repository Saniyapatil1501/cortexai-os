import os
import json
import urllib.request
import urllib.error
import asyncio
from typing import AsyncGenerator, List, Dict, Optional
from app.ai.base import BaseLLM

class OpenAILLM(BaseLLM):
    def __init__(self, model_name: str = "gpt-4o-mini", api_key: Optional[str] = None):
        self.model_name = os.getenv("OPENAI_MODEL", model_name)
        self.api_key = os.getenv("OPENAI_API_KEY", api_key or "")
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    def _build_messages(self, prompt: str, context: str, history: List[Dict[str, str]], image_base64: Optional[str] = None) -> List[Dict[str, str]]:
        messages = []
        system_content = "You are Cortex, a helpful context-aware academic study assistant overlay."
        if context:
            system_content += f"\n\nCURRENT CONTEXT:\n{context}"
        messages.append({"role": "system", "content": system_content})
        
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
            
        if image_base64:
            # Strip base64 metadata headers if present to get clean base64 payload
            raw_base64 = image_base64.split(",", 1)[-1] if "," in image_base64 else image_base64
            user_content = [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{raw_base64}"
                    }
                }
            ]
            messages.append({"role": "user", "content": user_content})
        else:
            messages.append({"role": "user", "content": prompt})
            
        return messages

    async def generate(self, prompt: str, context: str, history: List[Dict[str, str]], image_base64: Optional[str] = None) -> str:
        messages = self._build_messages(prompt, context, history, image_base64=image_base64)
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            "temperature": 0.2
        }
        
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        def run_post():
            req = urllib.request.Request(
                url, 
                data=json.dumps(payload).encode("utf-8"), 
                headers=headers, 
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))

        try:
            response_json = await asyncio.to_thread(run_post)
            return response_json.get("choices", [{}])[0].get("message", {}).get("content", "")
        except Exception as e:
            print(f"[OpenAIProvider] Error: {str(e)}")
            raise e

    async def stream(self, prompt: str, context: str, history: List[Dict[str, str]], image_base64: Optional[str] = None) -> AsyncGenerator[str, None]:
        messages = self._build_messages(prompt, context, history, image_base64=image_base64)
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": True,
            "temperature": 0.2
        }
        
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        def start_stream():
            req = urllib.request.Request(
                url, 
                data=json.dumps(payload).encode("utf-8"), 
                headers=headers, 
                method="POST"
            )
            return urllib.request.urlopen(req, timeout=30)

        try:
            response = await asyncio.to_thread(start_stream)
            
            while True:
                line_bytes = await asyncio.to_thread(response.readline)
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8").strip()
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data_json = json.loads(data_str)
                        chunk = data_json.get("choices", [{}])[0].get("delta", {}).get("content", "")
                        if chunk:
                            yield chunk
                    except Exception:
                        pass
        except Exception as e:
            print(f"[OpenAIProvider] Streaming failed: {str(e)}")
            raise e

    def health_check(self) -> bool:
        return len(self.api_key) > 0

    def get_detailed_status(self) -> str:
        return "OPENAI_AVAILABLE" if len(self.api_key) > 0 else "OPENAI_NOT_CONFIGURED"
