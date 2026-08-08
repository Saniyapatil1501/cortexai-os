from typing import List, Dict, Optional
from sqlmodel import Session
from app.rag.vector_store import vector_store
from app.nlp.embeddings import embedding_engine
from app.models import DocumentChunk, Document

class RAGRetriever:
    def __init__(self):
        pass

    def retrieve(self, session: Session, query: str, user_id: int, document_id: Optional[int] = None, top_k: int = 5, threshold: Optional[float] = None) -> List[Dict]:
        """
        Embeds a search query, retrieves similar vectors from FAISS,
        and joins results with sqlite DocumentChunk metadata.
        """
        import os
        if threshold is None:
            try:
                threshold = float(os.getenv("RAG_THRESHOLD", "0.35"))
            except ValueError:
                threshold = 0.35

        # 1. Generate query embedding
        query_vector = embedding_engine.embed_query(query)
        
        # 2. Search FAISS index
        search_results = vector_store.search(
            query_vector=query_vector, 
            user_id=user_id, 
            document_id=document_id, 
            top_k=top_k
        )
        
        # 3. Enrich output using SQLite metadata and filter by threshold
        retrieved_items = []
        rejected_items = []
        
        for chunk_id, score in search_results:
            chunk = session.get(DocumentChunk, chunk_id)
            if not chunk:
                continue
                
            doc = session.get(Document, chunk.document_id)
            filename = doc.original_filename if doc else "unknown"
            
            item = {
                "chunk_id": chunk.id,
                "document_id": chunk.document_id,
                "filename": filename,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "page_number": chunk.page_number,
                "similarity_score": round(score, 4)
            }
            
            if score >= threshold:
                retrieved_items.append(item)
            else:
                rejected_items.append(item)
                
        # Log similarity scoring and chunk allocation
        print(f"\n[RAG Retriever] Query: '{query}' (threshold={threshold})")
        print(f"  -> RETRIEVED CHUNKS ({len(retrieved_items)}):")
        for item in retrieved_items:
            print(f"     * [{item['filename']} | Page {item['page_number']} | Chunk {item['chunk_index']}] score={item['similarity_score']} | Preview: '{item['content'][:60]}...' ")
        print(f"  -> REJECTED CHUNKS ({len(rejected_items)}):")
        for item in rejected_items:
            print(f"     * [{item['filename']} | Page {item['page_number']} | Chunk {item['chunk_index']}] score={item['similarity_score']} | Preview: '{item['content'][:60]}...' ")
        print("-" * 50)
            
        return retrieved_items

    def build_rag_context(self, retrieved_items: List[Dict]) -> str:
        """
        Formats candidate chunks into a single structured string for Generative AI engine input.
        """
        if not retrieved_items:
            return "No relevant study material context found."
            
        context_parts = []
        for idx, item in enumerate(retrieved_items):
            page_info = f"Page: {item['page_number']}" if item.get('page_number') is not None else "Page: N/A"
            part = (
                f"SOURCE {idx + 1}\n"
                f"File: {item['filename']}\n"
                f"{page_info}\n"
                f"Section/Chunk: {item['chunk_index'] + 1}\n"
                f"Content:\n"
                f"{item['content']}\n"
            )
            context_parts.append(part)
            
        return "\n".join(context_parts)

# Singleton helper
retriever = RAGRetriever()
