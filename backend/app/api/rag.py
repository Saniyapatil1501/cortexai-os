from fastapi import APIRouter, Depends, HTTPException, Header
from sqlmodel import Session
from app.database import get_session
from app.api.auth import verify_user_access
from app.rag.retriever import retriever
from pydantic import BaseModel
from typing import Optional, List

router = APIRouter()

class SearchRequest(BaseModel):
    user_id: int
    query: str
    document_id: Optional[int] = None
    top_k: int = 5

class SearchResultItem(BaseModel):
    document_id: int
    filename: str
    chunk_index: int
    content: str
    similarity_score: float

class SearchResponse(BaseModel):
    query: str
    results: List[SearchResultItem]
    context: str

@router.post("/search", response_model=SearchResponse)
def semantic_search(
    request: SearchRequest,
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(None)
):
    # Enforce strict user verification
    verify_user_access(request.user_id, authorization, session)
    
    try:
        # Retrieve context matches from retriever layer
        results = retriever.retrieve(
            session=session,
            query=request.query,
            user_id=request.user_id,
            document_id=request.document_id,
            top_k=request.top_k
        )
        
        # Format the RAG context string
        context_block = retriever.build_rag_context(results)
        
        formatted_results = [
            SearchResultItem(
                document_id=item["document_id"],
                filename=item["filename"],
                chunk_index=item["chunk_index"],
                content=item["content"],
                similarity_score=item["similarity_score"]
            ) for item in results
        ]
        
        return SearchResponse(
            query=request.query,
            results=formatted_results,
            context=context_block
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Semantic search processing failed: {str(e)}")
