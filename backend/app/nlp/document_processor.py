import re
import unicodedata
from typing import List, Dict
import pypdf

class DocumentProcessor:
    def __init__(self):
        pass

    def extract_text(self, file_path: str, file_type: str) -> str:
        """
        Extracts raw text from a document (PDF, TXT, MD).
        Raises ValueError for scanned PDFs with no text or password/encryption errors.
        """
        file_type = file_type.lower().strip(".")
        
        if file_type == "pdf":
            try:
                reader = pypdf.PdfReader(file_path)
                if reader.is_encrypted:
                    raise ValueError("Password-protected or encrypted PDF documents are not supported.")
                
                text_runs = []
                for i, page in enumerate(reader.pages):
                    page_text = page.extract_text()
                    if page_text:
                        text_runs.append(page_text)
                
                full_text = "\n\n".join(text_runs).strip()
                if not full_text:
                    raise ValueError("Scanned/image-based document detected. OCR support will be added in the Computer Vision phase.")
                
                return full_text
            except Exception as e:
                if "scanned" in str(e).lower() or "image-based" in str(e).lower() or "protected" in str(e).lower():
                    raise e
                raise ValueError(f"Failed to parse PDF document: {str(e)}")
                
        elif file_type in ["txt", "md"]:
            try:
                with open(file_path, "rb") as f:
                    content_bytes = f.read()
                try:
                    return content_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    # Fallback decoding
                    return content_bytes.decode("latin-1", errors="ignore")
            except Exception as e:
                raise ValueError(f"Failed to read text file: {str(e)}")
        else:
            raise ValueError(f"Unsupported file format: {file_type}")

    def clean_text(self, text: str) -> str:
        """
        Applies basic NLP cleanup to text without altering headings, punctuation, casing, or code blocks.
        """
        if not text:
            return ""
        
        # Normalize Unicode representations
        text = unicodedata.normalize("NFKC", text)
        
        # Replace Windows carriage returns
        text = text.replace("\r\n", "\n")
        
        # Clean line-ending hyphens commonly found in PDFs
        text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", text)
        
        # Replace vertical tabs or form feeds
        text = re.sub(r"[\v\f]", "\n", text)
        
        # Normalize horizontal spacing (avoid duplicate spaces/tabs, keep linebreaks)
        lines = []
        for line in text.split("\n"):
            cleaned_line = re.sub(r"[ \t]+", " ", line).strip()
            lines.append(cleaned_line)
            
        text = "\n".join(lines)
        
        # Normalize excessive vertical spacing (max two consecutive linebreaks)
        text = re.sub(r"\n{3,}", "\n\n", text)
        
        return text.strip()

    def chunk_text(self, text: str, chunk_size: int = 600, overlap: int = 80) -> List[Dict]:
        """
        Splits clean text semantically prioritizing paragraph breaks, heading lines, and sentence limits.
        Approximate token counts are based on word count (1 word ≈ 1.3 tokens).
        """
        if not text:
            return []

        # Split text into paragraphs
        paragraphs = text.split("\n\n")
        
        # Sub-split long paragraphs into sentences
        semantic_units = []
        for p in paragraphs:
            p_trimmed = p.strip()
            if not p_trimmed:
                continue
                
            # If paragraph itself is small, keep it contiguous
            word_count = len(p_trimmed.split())
            approx_tokens = int(word_count * 1.3)
            
            if approx_tokens <= chunk_size:
                semantic_units.append(p_trimmed)
            else:
                # Split large paragraphs by sentence boundary
                # Matches periods, question marks, and exclamation marks followed by spaces/ends
                sentences = re.split(r"(?<=[.!?])\s+", p_trimmed)
                current_sent_group = []
                current_group_tokens = 0
                
                for s in sentences:
                    s_words = s.split()
                    s_tokens = int(len(s_words) * 1.3)
                    
                    if current_group_tokens + s_tokens > chunk_size and current_sent_group:
                        semantic_units.append(" ".join(current_sent_group))
                        current_sent_group = [s]
                        current_group_tokens = s_tokens
                    else:
                        current_sent_group.append(s)
                        current_group_tokens += s_tokens
                        
                if current_sent_group:
                    semantic_units.append(" ".join(current_sent_group))

        chunks = []
        current_chunk_words = []
        current_chunk_tokens = 0
        chunk_idx = 0

        # We combine semantic units into target sized chunks with overlapping structures
        # For simplicity, we step through the semantic units.
        # We can implement a sliding window over units.
        i = 0
        while i < len(semantic_units):
            unit = semantic_units[i]
            unit_words = unit.split()
            unit_tokens = int(len(unit_words) * 1.3)
            
            # If a single semantic unit is somehow larger than chunk_size, we force split it
            if unit_tokens > chunk_size:
                # Force split word-by-word
                sub_chunk_words = []
                sub_chunk_tokens = 0
                for word in unit_words:
                    word_tokens = 2 # safe word token approximation
                    if sub_chunk_tokens + word_tokens > chunk_size:
                        chunk_content = " ".join(sub_chunk_words)
                        chunks.append({
                            "chunk_index": chunk_idx,
                            "content": chunk_content,
                            "token_count": sub_chunk_tokens
                        })
                        chunk_idx += 1
                        # Retain overlap words
                        overlap_words = sub_chunk_words[-max(1, int(overlap / 1.3)):]
                        sub_chunk_words = list(overlap_words) + [word]
                        sub_chunk_tokens = int(len(sub_chunk_words) * 1.3)
                    else:
                        sub_chunk_words.append(word)
                        sub_chunk_tokens += word_tokens
                if sub_chunk_words:
                    chunks.append({
                        "chunk_index": chunk_idx,
                        "content": " ".join(sub_chunk_words),
                        "token_count": sub_chunk_tokens
                    })
                    chunk_idx += 1
                i += 1
                continue

            if current_chunk_tokens + unit_tokens > chunk_size:
                # Complete the chunk
                chunk_content = "\n\n".join(current_chunk_words)
                chunks.append({
                    "chunk_index": chunk_idx,
                    "content": chunk_content,
                    "token_count": current_chunk_tokens
                })
                chunk_idx += 1
                
                # Backtrack to start the next chunk with overlap
                # We find how many units from the end of the current chunk fit within the overlap threshold
                overlap_units = []
                overlap_tokens = 0
                for rev_unit in reversed(current_chunk_words):
                    rev_tokens = int(len(rev_unit.split()) * 1.3)
                    if overlap_tokens + rev_tokens <= overlap:
                        overlap_units.insert(0, rev_unit)
                        overlap_tokens += rev_tokens
                    else:
                        break
                
                current_chunk_words = list(overlap_units) + [unit]
                current_chunk_tokens = int(sum(len(u.split()) for u in current_chunk_words) * 1.3)
            else:
                current_chunk_words.append(unit)
                current_chunk_tokens += unit_tokens
            
            i += 1

        if current_chunk_words:
            chunk_content = "\n\n".join(current_chunk_words)
            chunks.append({
                "chunk_index": chunk_idx,
                "content": chunk_content,
                "token_count": current_chunk_tokens
            })

        return chunks

    def process_document(self, file_path: str, file_type: str) -> List[Dict]:
        """
        Runs text extraction, cleaning, and semantic chunking on a local file path.
        """
        raw_text = self.extract_text(file_path, file_type)
        cleaned_text = self.clean_text(raw_text)
        return self.chunk_text(cleaned_text)

# Singleton helper
doc_processor = DocumentProcessor()
