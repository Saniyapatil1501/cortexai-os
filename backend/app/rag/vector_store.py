import os
import json
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import numpy as np
import faiss
from sqlmodel import Session, select
from app.nlp.embeddings import embedding_engine
from app.models import DocumentChunk

class FAISSVectorStore:
    def __init__(self):
        self.dimension = 384
        self.storage_dir = self.get_storage_dir()
        self.index_path = self.storage_dir / "index.faiss"
        self.mappings_path = self.storage_dir / "mappings.json"
        self.index = None
        self.mappings = []  # List of dicts: [{"chunk_id": int, "user_id": int, "document_id": int, "chunk_index": int, "filename": str}]

    def get_storage_dir(self) -> Path:
        app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
        if app_data:
            dir_path = Path(app_data) / "CortexAI" / "vector_store"
        else:
            dir_path = Path("data") / "vector_store"
        dir_path.mkdir(parents=True, exist_ok=True)
        return dir_path

    def load(self):
        """
        Loads FAISS index and mappings from local storage.
        """
        if self.index_path.exists() and self.mappings_path.exists():
            try:
                self.index = faiss.read_index(str(self.index_path))
                with open(self.mappings_path, "r", encoding="utf-8") as f:
                    self.mappings = json.load(f)
                print(f"[VectorStore] Index loaded. Total vectors: {self.index.ntotal}")
            except Exception as e:
                print(f"[VectorStore] Failed to load index files: {str(e)}")
                self.index = None
                self.mappings = []
        else:
            self.index = None
            self.mappings = []

    def save(self):
        """
        Saves FAISS index and mappings to disk.
        """
        if self.index is not None:
            faiss.write_index(self.index, str(self.index_path))
            with open(self.mappings_path, "w", encoding="utf-8") as f:
                json.dump(self.mappings, f, ensure_ascii=False, indent=2)

    def add_chunks(self, chunks: List[DocumentChunk], filename: str, embeddings: List[List[float]]):
        """
        Appends chunks and their vector embeddings to the index.
        """
        self.load()
        if self.index is None:
            self.index = faiss.IndexFlatL2(self.dimension)
            self.mappings = []
            
        vectors = np.array(embeddings, dtype=np.float32)
        self.index.add(vectors)
        
        for idx, chunk in enumerate(chunks):
            self.mappings.append({
                "chunk_id": chunk.id,
                "user_id": chunk.user_id,
                "document_id": chunk.document_id,
                "chunk_index": chunk.chunk_index,
                "filename": filename
            })
            
        self.save()

    def delete_document_vectors(self, document_id: int):
        """
        Safely deletes vectors corresponding to a specific document ID.
        Rebuilds index using remaining vectors to keep it clean.
        """
        self.load()
        if self.index is None or not self.mappings:
            return
            
        remaining_indices = []
        new_mappings = []
        
        for i, m in enumerate(self.mappings):
            if m["document_id"] != document_id:
                remaining_indices.append(i)
                new_mappings.append(m)
                
        if not remaining_indices:
            # All vectors were from this document; clear store files
            if self.index_path.exists():
                self.index_path.unlink()
            if self.mappings_path.exists():
                self.mappings_path.unlink()
            self.index = None
            self.mappings = []
            print("[VectorStore] Index cleared as all vectors belonged to deleted document.")
            return
            
        # Reconstruct remaining vectors directly from Flat index (no model load needed!)
        raw_vectors = np.zeros((self.index.ntotal, self.dimension), dtype=np.float32)
        for i in range(self.index.ntotal):
            raw_vectors[i] = self.index.reconstruct(i)
            
        remaining_vectors = raw_vectors[remaining_indices]
        
        # Build fresh index
        new_index = faiss.IndexFlatL2(self.dimension)
        new_index.add(remaining_vectors)
        
        self.index = new_index
        self.mappings = new_mappings
        self.save()
        print(f"[VectorStore] Cleaned document {document_id} vectors. Remaining: {self.index.ntotal}")

    def search(self, query_vector: List[float], user_id: int, document_id: Optional[int] = None, top_k: int = 5) -> List[Tuple[int, float]]:
        """
        Searches the FAISS index for relevant vectors, enforcing user isolation filters.
        """
        self.load()
        if self.index is None or self.index.ntotal == 0:
            return []
            
        q_vec = np.array([query_vector], dtype=np.float32)
        # Search a wider pool of candidates first so we can filter post-search for user ownership and document target
        candidate_count = min(self.index.ntotal, max(top_k * 5, 50))
        distances, indices = self.index.search(q_vec, candidate_count)
        
        results = []
        for i, offset in enumerate(indices[0]):
            if offset == -1:
                continue
            mapping = self.mappings[offset]
            
            # Enforce strict user isolation
            if mapping["user_id"] != user_id:
                continue
                
            # Optional document level filtering
            if document_id is not None and mapping["document_id"] != document_id:
                continue
                
            l2_dist = float(distances[0][i])
            # Convert L2 distance into a normalized similarity score
            similarity = 1.0 / (1.0 + l2_dist)
            
            results.append((mapping["chunk_id"], similarity))
            if len(results) >= top_k:
                break
                
        return results

    def rebuild_index(self, session: Session):
        """
        Rebuilds the entire index from scratch using all chunks currently in SQLite.
        """
        # Fetch all chunks
        statement = select(DocumentChunk)
        chunks = session.exec(statement).all()
        
        if not chunks:
            # Clear files
            if self.index_path.exists():
                self.index_path.unlink()
            if self.mappings_path.exists():
                self.mappings_path.unlink()
            self.index = None
            self.mappings = []
            print("[VectorStore] Index cleared as database is empty.")
            return
            
        from app.models import Document
        
        print(f"[VectorStore] Reindexing {len(chunks)} chunks from database...")
        contents = [c.content for c in chunks]
        embeddings = embedding_engine.embed_texts(contents)
        
        # Build new index
        new_index = faiss.IndexFlatL2(self.dimension)
        new_index.add(np.array(embeddings, dtype=np.float32))
        
        # Build mappings
        new_mappings = []
        for idx, chunk in enumerate(chunks):
            doc = session.get(Document, chunk.document_id)
            filename = doc.original_filename if doc else "unknown"
            new_mappings.append({
                "chunk_id": chunk.id,
                "user_id": chunk.user_id,
                "document_id": chunk.document_id,
                "chunk_index": chunk.chunk_index,
                "filename": filename
            })
            
        self.index = new_index
        self.mappings = new_mappings
        self.save()
        print(f"[VectorStore] Index rebuilt successfully. Total vectors: {self.index.ntotal}")

# Singleton helper
vector_store = FAISSVectorStore()
