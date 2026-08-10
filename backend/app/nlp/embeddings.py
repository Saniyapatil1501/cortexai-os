from typing import List, Union
from sentence_transformers import SentenceTransformer

class EmbeddingEngine:
    def __init__(self):
        self.model = None
        self._dimension = 384

    def load_model(self):
        """
        Loads the SentenceTransformer model locally. Caches the model in memory.
        """
        if self.model is None:
            print("[EmbeddingEngine] Loading SentenceTransformer model 'all-MiniLM-L6-v2'...")
            # Automatically downloads from Hugging Face if not cached, requiring no API key
            self.model = SentenceTransformer("all-MiniLM-L6-v2")
            print(f"[EmbeddingEngine] Model loaded successfully. Dimension: {self._dimension}")

    def embed_text(self, text: str) -> List[float]:
        """
        Generates a 384-dimensional embedding vector for a single text.
        """
        self.load_model()
        embedding = self.model.encode(text, convert_to_numpy=True)
        return embedding.tolist()

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """
        Generates embedding vectors for a batch of texts.
        """
        self.load_model()
        embeddings = self.model.encode(texts, convert_to_numpy=True)
        return embeddings.tolist()

    def embed_query(self, query: str) -> List[float]:
        """
        Generates an embedding vector for a semantic query.
        """
        return self.embed_text(query)

    def get_dimension(self) -> int:
        return self._dimension

    def health_check(self) -> bool:
        try:
            self.load_model()
            test_vec = self.embed_text("health check")
            return len(test_vec) == self._dimension
        except Exception as e:
            print(f"[EmbeddingEngine] Health check failed: {str(e)}")
            return False

# Singleton instance
embedding_engine = EmbeddingEngine()
