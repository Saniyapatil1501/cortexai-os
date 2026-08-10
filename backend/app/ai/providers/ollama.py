import os
import json
import urllib.request
import urllib.error
import asyncio
from typing import AsyncGenerator, List, Dict
from app.ai.base import BaseLLM

class OllamaLLM(BaseLLM):
    def __init__(self, model_name: str = "qwen2.5-coder:3b", base_url: str = "http://localhost:11434"):
        self.model_name = os.getenv("OLLAMA_MODEL", model_name)
        self.base_url = os.getenv("OLLAMA_BASE_URL", base_url).rstrip("/")

    def _build_messages(self, prompt: str, context: str, history: List[Dict[str, str]]) -> List[Dict[str, str]]:
        messages = []
        
        # 1. System Prompt (will be overridden by chat modes if needed, otherwise default)
        system_content = "You are Cortex, a helpful context-aware academic study assistant overlay."
        if context:
            system_content += f"\n\nCURRENT CONTEXT:\n{context}"
            
        messages.append({"role": "system", "content": system_content})
        
        # 2. History
        for msg in history:
            messages.append({"role": msg["role"], "content": msg["content"]})
            
        # 3. User Message
        messages.append({"role": "user", "content": prompt})
        
        return messages

    async def generate(self, prompt: str, context: str, history: List[Dict[str, str]]) -> str:
        messages = self._build_messages(prompt, context, history)
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.2
            }
        }
        
        url = f"{self.base_url}/api/chat"
        headers = {"Content-Type": "application/json"}
        
        def run_post():
            req = urllib.request.Request(
                url, 
                data=json.dumps(payload).encode("utf-8"), 
                headers=headers, 
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as res:
                return json.loads(res.read().decode("utf-8"))

        try:
            response_json = await asyncio.to_thread(run_post)
            return response_json.get("message", {}).get("content", "")
        except urllib.error.URLError as e:
            print(f"[OllamaProvider] Connection failed: {str(e)}")
            raise ConnectionError("Local Ollama service is unreachable. Please make sure Ollama is running.")
        except Exception as e:
            print(f"[OllamaProvider] Error: {str(e)}")
            raise e

    async def stream(self, prompt: str, context: str, history: List[Dict[str, str]]) -> AsyncGenerator[str, None]:
        messages = self._build_messages(prompt, context, history)
        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.2
            }
        }
        
        url = f"{self.base_url}/api/chat"
        headers = {"Content-Type": "application/json"}
        
        def start_stream():
            req = urllib.request.Request(
                url, 
                data=json.dumps(payload).encode("utf-8"), 
                headers=headers, 
                method="POST"
            )
            return urllib.request.urlopen(req, timeout=10)

        try:
            # Open the stream in a background thread to avoid blocking the event loop
            response = await asyncio.to_thread(start_stream)
            
            # Read lines from response stream
            while True:
                # Read a line from standard HTTP response connection in a thread
                line_bytes = await asyncio.to_thread(response.readline)
                if not line_bytes:
                    break
                    
                line = line_bytes.decode("utf-8").strip()
                if not line:
                    continue
                    
                data = json.loads(line)
                token = data.get("message", {}).get("content", "")
                if token:
                    yield token
                    
                if data.get("done", False):
                    break
        except urllib.error.URLError as e:
            print(f"[OllamaProvider] Connection failed during stream: {str(e)}")
            yield "AI model is currently unavailable. Please check if local Ollama is running and has the model installed."
        except Exception as e:
            print(f"[OllamaProvider] Stream error: {str(e)}")
            yield f"\n[Incomplete response: {str(e)}]"

    def health_check(self) -> bool:
        url = f"{self.base_url}/api/tags"
        try:
            with urllib.request.urlopen(url, timeout=2) as res:
                data = json.loads(res.read().decode("utf-8"))
                models = [m["name"] for m in data.get("models", [])]
                # Match name exactly or by prefix (e.g. qwen2.5-coder:3b matches qwen2.5-coder:3b)
                model_exists = any(self.model_name in m or m in self.model_name for m in models)
                if not model_exists:
                    print(f"[OllamaProvider] Warning: Model '{self.model_name}' is not downloaded in Ollama. Models present: {models}")
                return len(models) > 0
        except Exception as e:
            print(f"[OllamaProvider] Health check failed: {str(e)}")
            return False
