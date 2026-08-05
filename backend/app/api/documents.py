from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Form, BackgroundTasks
from sqlmodel import Session, select
from app.database import get_session, engine
from app.models import Document, DocumentChunk
from app.api.auth import verify_user_access
from typing import List, Optional
from datetime import datetime
from pathlib import Path
import os
import re

router = APIRouter()

# Size limit: 10MB
MAX_FILE_SIZE = 10 * 1024 * 1024

def get_documents_storage_dir() -> Path:
    app_data = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
    if app_data:
        doc_dir = Path(app_data) / "CortexAI" / "documents"
    else:
        doc_dir = Path("data") / "documents"
    doc_dir.mkdir(parents=True, exist_ok=True)
    return doc_dir

def sanitize_filename(filename: str) -> str:
    # Get base name to prevent directory traversal
    base_name = os.path.basename(filename)
    # Remove any non-alphanumeric, dots, hyphens, or underscores
    sanitized = re.sub(r"[^a-zA-Z0-9_.-]", "_", base_name)
    return sanitized

def process_document_background(doc_id: int, file_path: str, file_type: str, user_id: int):
    """
    Background worker function to extract text, clean, chunk and save to DB.
    """
    from app.nlp.document_processor import doc_processor
    
    with Session(engine) as session:
        doc = session.get(Document, doc_id)
        if not doc:
            return
        
        try:
            # Process the file using the NLP pipeline
            chunks = doc_processor.process_document(file_path, file_type)
            
            for c in chunks:
                chunk = DocumentChunk(
                    document_id=doc_id,
                    user_id=user_id,
                    chunk_index=c["chunk_index"],
                    content=c["content"],
                    token_count=c["token_count"]
                )
                session.add(chunk)
            
            doc.chunk_count = len(chunks)
            doc.status = "ready"
            doc.updated_at = datetime.utcnow()
            session.add(doc)
            session.commit()
            print(f"[DocProcessor] Document {doc_id} processed successfully. Created {len(chunks)} chunks.")
            
        except Exception as e:
            session.rollback()
            error_str = str(e)
            print(f"[DocProcessor] Error processing document {doc_id}: {error_str}")
            
            # Update status to failed
            doc.status = "failed"
            doc.updated_at = datetime.utcnow()
            session.add(doc)
            session.commit()

@router.post("/upload", response_model=Document)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: int = Form(...),
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(None)
):
    # Enforce user authorization check
    verify_user_access(user_id, authorization, session)
    
    # Validate file type
    filename = file.filename or "uploaded_file"
    ext = os.path.splitext(filename)[1].lower().strip(".")
    if ext not in ["pdf", "txt", "md"]:
        raise HTTPException(status_code=400, detail=f"Unsupported file format: .{ext}. Supported formats are: PDF, TXT, MD.")
    
    # Save upload file in memory buffer first to get actual size and validate
    file_bytes = await file.read()
    file_size = len(file_bytes)
    
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File is too large. Maximum supported size is 10MB.")
        
    if file_size == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")
        
    # Sanitize filename and construct local file path
    clean_name = sanitize_filename(filename)
    # Append timestamp to filename to prevent collisions/overwrites
    timestamp_prefix = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    stored_filename = f"{timestamp_prefix}_{clean_name}"
    
    user_storage_dir = get_documents_storage_dir() / str(user_id)
    user_storage_dir.mkdir(parents=True, exist_ok=True)
    
    stored_file_path = user_storage_dir / stored_filename
    
    try:
        # Write bytes to disk
        with open(stored_file_path, "wb") as f:
            f.write(file_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file to local disk: {str(e)}")
        
    # Create Document record in DB with status "processing"
    doc_record = Document(
        user_id=user_id,
        filename=stored_filename,
        original_filename=filename,
        file_type=ext,
        file_path=str(stored_file_path),
        file_size=file_size,
        status="processing",
        chunk_count=0
    )
    
    try:
        session.add(doc_record)
        session.commit()
        session.refresh(doc_record)
    except Exception as e:
        # Clean up local file on DB write failure
        if stored_file_path.exists():
            stored_file_path.unlink()
        raise HTTPException(status_code=500, detail=f"Database failure: {str(e)}")
        
    # Launch parsing in background worker thread
    background_tasks.add_task(
        process_document_background, 
        doc_record.id, 
        str(stored_file_path), 
        ext, 
        user_id
    )
    
    return doc_record

@router.get("/{user_id}", response_model=List[Document])
def get_user_documents(
    user_id: int, 
    session: Session = Depends(get_session), 
    _ = Depends(verify_user_access)
):
    statement = select(Document).where(Document.user_id == user_id).order_by(Document.created_at.desc())
    return session.exec(statement).all()

@router.get("/{document_id}/chunks", response_model=List[DocumentChunk])
def get_document_chunks(
    document_id: int,
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(None)
):
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Enforce document owner verification
    verify_user_access(doc.user_id, authorization, session)
    
    statement = select(DocumentChunk).where(DocumentChunk.document_id == document_id).order_by(DocumentChunk.chunk_index.asc())
    return session.exec(statement).all()

@router.get("/{document_id}/status")
def get_document_status(
    document_id: int,
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(None)
):
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Enforce document owner verification
    verify_user_access(doc.user_id, authorization, session)
    
    return {
        "id": doc.id,
        "status": doc.status,
        "chunk_count": doc.chunk_count,
        "updated_at": doc.updated_at
    }

@router.delete("/{document_id}")
def delete_document(
    document_id: int,
    session: Session = Depends(get_session),
    authorization: Optional[str] = Header(None)
):
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    # Enforce document owner verification
    verify_user_access(doc.user_id, authorization, session)
    
    # Delete chunks first
    chunks_statement = select(DocumentChunk).where(DocumentChunk.document_id == document_id)
    chunks = session.exec(chunks_statement).all()
    for c in chunks:
        session.delete(c)
        
    # Delete local file from disk
    try:
        file_path = Path(doc.file_path)
        if file_path.exists():
            file_path.unlink()
    except Exception as e:
        print(f"[DocAPI] Warning: Failed to delete document file from storage: {str(e)}")
        
    # Delete document record
    session.delete(doc)
    session.commit()
    
    return {"status": "success", "message": "Document deleted successfully"}
