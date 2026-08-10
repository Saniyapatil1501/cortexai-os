import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import {
  Plus,
  Trash2,
  Eye,
  BookOpen,
  FileText,
  FileCode,
  Upload,
  AlertCircle,
  Loader2,
  CheckCircle2,
  X,
  FileUp,
  Search,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cortexClient, DocumentItem, DocumentChunkItem, SearchResultItem } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/materials")({
  head: () => ({
    meta: [
      { title: "Study Materials — CortexAI" },
      {
        name: "description",
        content: "Manage your local course materials, papers, and text documents.",
      },
    ],
  }),
  component: StudyMaterialsPage,
});

function getDocIcon(type: string) {
  const t = type.toLowerCase();
  if (t === "pdf") return BookOpen;
  if (t === "md") return FileCode;
  return FileText;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function StudyMaterialsPage() {
  const { user, isBackendOffline } = useCortexAuth();
  const userId = user?.user_id;

  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Semantic Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDocId, setSearchDocId] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  // Chunk Viewer State
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [highlightedChunkIndex, setHighlightedChunkIndex] = useState<number | null>(null);

  const highlightedRef = useRef<HTMLDivElement>(null);

  const fetchDocuments = () => {
    if (!userId) return;
    cortexClient
      .getDocuments(userId)
      .then((data) => {
        setDocuments(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load documents:", err);
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isBackendOffline) {
      setLoading(false);
      return;
    }
    fetchDocuments();
  }, [userId, isBackendOffline]);

  // Polling for processing or embedding documents
  useEffect(() => {
    if (!userId || isBackendOffline) return;

    const needsPolling = documents.some(
      (d) => d.status === "processing" || d.status === "embedding",
    );
    if (!needsPolling) return;

    const interval = setInterval(async () => {
      try {
        const data = await cortexClient.getDocuments(userId);
        const hasStatusChange = data.some((newDoc) => {
          const oldDoc = documents.find((d) => d.id === newDoc.id);
          return oldDoc && oldDoc.status !== newDoc.status;
        });

        if (hasStatusChange) {
          setDocuments(data);
        }
      } catch (err) {
        console.error("Error polling documents:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [userId, documents, isBackendOffline]);

  // Smooth scroll to highlighted chunk inside modal
  useEffect(() => {
    if (modalOpen && highlightedChunkIndex !== null && !chunksLoading) {
      const timer = setTimeout(() => {
        highlightedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [modalOpen, highlightedChunkIndex, chunksLoading]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processUploadedFile(e.target.files[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    if (!userId) {
      toast.error("User session not synced yet. Please wait.");
      return;
    }

    const filename = file.name;
    const ext = filename.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "txt", "md"].includes(ext)) {
      toast.error("Unsupported file format. Please upload PDF, TXT or MD files.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File exceeds maximum supported size (10MB).");
      return;
    }

    setUploading(true);
    const toastId = toast.loading(`Uploading "${filename}"...`);

    try {
      const newDoc = await cortexClient.uploadDocument(userId, file);
      toast.dismiss(toastId);
      toast.success(`"${filename}" uploaded successfully. Parsing and embedding text...`);
      setDocuments((prev) => [newDoc, ...prev]);
    } catch (err: any) {
      toast.dismiss(toastId);
      const errorMsg = err.message || "Failed to upload document.";
      toast.error(errorMsg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = async (docId: number, filename: string) => {
    const confirmDelete = window.confirm(`Are you sure you want to delete "${filename}"?`);
    if (!confirmDelete) return;

    try {
      await cortexClient.deleteDocument(docId);
      toast.success("Document and its vectors deleted");
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setSearchResults((prev) => prev.filter((r) => r.document_id !== docId));
      if (selectedDoc?.id === docId) {
        setModalOpen(false);
        setSelectedDoc(null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
      toast.error("Failed to delete document.");
    }
  };

  const handleViewChunks = async (doc: DocumentItem, highlightIdx: number | null = null) => {
    setSelectedDoc(doc);
    setChunksLoading(true);
    setHighlightedChunkIndex(highlightIdx);
    setModalOpen(true);
    try {
      const chunkData = await cortexClient.getDocumentChunks(doc.id);
      setChunks(chunkData);
    } catch (err) {
      console.error("Failed to retrieve document chunks:", err);
      toast.error("Failed to load document text chunks.");
      setModalOpen(false);
    } finally {
      setChunksLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!userId || !searchQuery.trim()) return;

    setSearching(true);
    const targetDocId = searchDocId === "all" ? undefined : Number(searchDocId);

    try {
      const response = await cortexClient.semanticSearch(userId, searchQuery, targetDocId, 5);
      setSearchResults(response.results);
    } catch (err) {
      console.error("Semantic search failed:", err);
      toast.error("Semantic search query failed.");
    } finally {
      setSearching(false);
    }
  };

  const handleReindex = async () => {
    const confirmReindex = window.confirm(
      "Are you sure you want to rebuild the entire vector index from current database chunks?",
    );
    if (!confirmReindex) return;

    setReindexing(true);
    const toastId = toast.loading("Rebuilding vector store indices...");
    try {
      await cortexClient.reindex();
      toast.dismiss(toastId);
      toast.success("Index rebuild completed successfully.");
    } catch (err) {
      toast.dismiss(toastId);
      console.error("Reindexing failed:", err);
      toast.error("Rebuilding vector indexes failed.");
    } finally {
      setReindexing(false);
    }
  };

  if (isBackendOffline) {
    return (
      <AppLayout>
        <PageHeader
          title="Study Materials"
          description="Manage your course notes, textbook PDFs, or text documents."
        />
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-lg font-medium text-destructive">Daemon Offline</div>
          <div className="max-w-md text-sm text-muted-foreground">
            The CortexAI Desktop Daemon is currently offline. Please ensure the backend is running
            and try again.
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageHeader
        title="Study Materials"
        description="Upload course notes, textbook PDFs, or text documents to train Cortex as your personalized tutor."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Zone & Diagnostics Column */}
        <div className="lg:col-span-1 space-y-6">
          <Card
            padded={false}
            className="border border-dashed border-border/80 hover:border-foreground/30 transition overflow-hidden"
          >
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center py-10 px-4 text-center cursor-pointer transition select-none ${
                dragActive ? "bg-surface-2/80" : "bg-surface-1/40 hover:bg-surface-2/30"
              }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInput}
                accept=".pdf,.txt,.md"
                className="hidden"
                disabled={uploading}
              />
              {uploading ? (
                <Loader2 className="h-10 w-10 text-muted-foreground animate-spin mb-3" />
              ) : (
                <FileUp className="h-10 w-10 text-muted-foreground/80 mb-3" />
              )}
              <div className="text-sm font-medium">
                {uploading
                  ? "Uploading document..."
                  : "Drag & drop study material here or click to browse"}
              </div>
              <div className="text-xs text-muted-foreground mt-1.5">
                Supports PDF, TXT, MD up to 10MB
              </div>
            </div>
          </Card>

          {/* RAG Information & Diagnostics */}
          <Card>
            <h3 className="text-sm font-semibold text-foreground">NLP System Diagnostics</h3>
            <div className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Embedding Model:</span>
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
                  all-MiniLM-L6-v2
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Dimension:</span>
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
                  384
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Vector DB Store:</span>
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
                  FAISS (L2 Flat)
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Ready Files:</span>
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
                  {documents.filter((d) => d.status === "ready").length}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Total Vectors:</span>
                <span className="font-mono bg-surface-2 px-1.5 py-0.5 rounded text-foreground">
                  {documents.reduce(
                    (acc, d) => acc + (d.status === "ready" ? d.chunk_count : 0),
                    0,
                  )}
                </span>
              </div>
              <div className="pt-2 border-t border-border/40">
                <Button
                  onClick={handleReindex}
                  disabled={reindexing || documents.length === 0}
                  className="w-full text-xs py-1.5 justify-center hover:opacity-90 transition"
                >
                  {reindexing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Reindexing...
                    </>
                  ) : (
                    "Rebuild Vector Index"
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Semantic Search Dashboard Area */}
        <div className="lg:col-span-2">
          <Card className="h-full flex flex-col justify-between">
            <div>
              <h3 className="text-base font-medium">Search Your Study Materials</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Query your local database semantically. Matches are retrieved from your uploaded
                files.
              </p>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2 shrink-0">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Ask a question (e.g., 'What is deadlock?')"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full rounded-md border border-border bg-surface-2/60 pl-3 pr-10 py-2 text-sm text-foreground outline-none transition focus:border-foreground/30 focus:bg-surface-2"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className="absolute right-3 top-2.5 p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30 transition cursor-pointer"
                >
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </button>
              </div>

              <select
                value={searchDocId}
                onChange={(e) => setSearchDocId(e.target.value)}
                className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-foreground outline-none cursor-pointer transition focus:border-foreground/30"
              >
                <option value="all">All Documents</option>
                {documents
                  .filter((d) => d.status === "ready")
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.original_filename}
                    </option>
                  ))}
              </select>

              <Button
                onClick={handleSearch}
                disabled={
                  searching ||
                  !searchQuery.trim() ||
                  documents.filter((d) => d.status === "ready").length === 0
                }
                className="text-xs shrink-0 py-2 sm:px-4 justify-center hover:opacity-90 transition"
              >
                Semantic Search
              </Button>
            </div>

            {/* Search Results list container */}
            <div className="mt-4 flex-1 overflow-y-auto max-h-[350px] min-h-[180px] pr-1.5 space-y-3">
              {searching ? (
                <div className="flex h-32 flex-col items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mb-2" /> Searching database...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-xs text-muted-foreground border border-border/30 rounded-lg bg-surface-1/10 p-6 text-center">
                  {documents.filter((d) => d.status === "ready").length === 0
                    ? "Upload study documents first to make them searchable."
                    : "No search results. Enter a query above to retrieve matching content."}
                </div>
              ) : (
                searchResults.map((res, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border border-border bg-surface-1/30 p-4 transition hover:border-foreground/20"
                  >
                    <div className="flex items-center justify-between text-xs mb-2">
                      <div className="flex items-center gap-1.5 font-medium truncate max-w-xs sm:max-w-md">
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate" title={res.filename}>
                          {res.filename}
                        </span>
                        <span className="text-[10px] text-muted-foreground bg-surface-2 px-1.5 py-0.5 rounded border border-border/50 shrink-0">
                          Chunk #{res.chunk_index + 1}
                        </span>
                      </div>
                      <span className="font-semibold text-emerald-400 shrink-0 ml-2">
                        Relevance: {Math.round(res.similarity_score * 100)}%
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground/80 line-clamp-3 select-text font-sans">
                      {res.content}
                    </p>
                    <div className="mt-3 text-right">
                      <button
                        onClick={() => {
                          const doc = documents.find((d) => d.id === res.document_id);
                          if (doc) {
                            handleViewChunks(doc, res.chunk_index);
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition font-medium"
                      >
                        <Eye className="h-3.5 w-3.5" /> View Source Chunk
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Documents List */}
      <div className="mt-6">
        <Card>
          <div className="mb-4">
            <h3 className="text-base font-medium">Your Knowledge Base</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Documents will be processed locally and chunked ready for RAG query context.
            </p>
          </div>

          {loading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading documents...
            </div>
          ) : documents.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-sm text-muted-foreground border border-border/40 rounded-lg bg-surface-1/10">
              No documents uploaded yet. Upload your first PDF, TXT or Markdown file above.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/80 text-muted-foreground font-medium text-xs uppercase tracking-wider">
                    <th className="pb-3 pl-3">Document Name</th>
                    <th className="pb-3">File Type</th>
                    <th className="pb-3">Upload Date</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Chunks</th>
                    <th className="pb-3 text-right pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {documents.map((doc) => {
                    const DocIcon = getDocIcon(doc.file_type);
                    const formattedDate = new Date(doc.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });

                    return (
                      <tr key={doc.id} className="hover:bg-surface-2/20 transition-colors">
                        <td
                          className="py-3.5 pl-3 font-medium flex items-center gap-2.5 truncate max-w-xs md:max-w-sm"
                          title={doc.original_filename}
                        >
                          <DocIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{doc.original_filename}</span>
                        </td>
                        <td className="py-3.5">
                          <span className="uppercase text-xs font-semibold text-muted-foreground bg-surface-2 px-1.5 py-0.5 rounded border border-border/60">
                            {doc.file_type}
                          </span>
                        </td>
                        <td className="py-3.5 text-muted-foreground text-xs">{formattedDate}</td>
                        <td className="py-3.5">
                          {doc.status === "ready" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                            </span>
                          )}
                          {doc.status === "processing" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
                            </span>
                          )}
                          {doc.status === "embedding" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Embedding
                            </span>
                          )}
                          {doc.status === "failed" && (
                            <span
                              className="inline-flex items-center gap-1 text-xs font-medium text-rose-400"
                              title="Processing error occurred. Scanned files require OCR."
                            >
                              <AlertCircle className="h-3.5 w-3.5" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 font-mono text-xs">
                          {doc.status === "ready" ? doc.chunk_count : "-"}
                        </td>
                        <td className="py-3.5 text-right pr-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              disabled={doc.status !== "ready"}
                              onClick={() => handleViewChunks(doc)}
                              className="p-1.5 rounded-md hover:bg-surface-2 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                              title="View text chunks"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id, doc.original_filename)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition cursor-pointer"
                              title="Delete document"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Chunk Viewer Modal */}
      {modalOpen && selectedDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl h-[80vh] flex flex-col rounded-lg border border-border bg-surface-1/95 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-4 shrink-0 bg-surface-2/30">
              <div>
                <h3 className="text-base font-semibold tracking-tight text-foreground truncate max-w-md">
                  {selectedDoc.original_filename}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Chunks parsed: {selectedDoc.chunk_count} | Size:{" "}
                  {formatFileSize(selectedDoc.file_size)}
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Contents */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {chunksLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading text chunks...
                </div>
              ) : chunks.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground p-8">
                  No chunks generated. The document may be empty or failed to parse.
                </div>
              ) : (
                chunks.map((chunk, idx) => {
                  const isHighlighted = chunk.chunk_index === highlightedChunkIndex;
                  return (
                    <div
                      key={chunk.id}
                      ref={isHighlighted ? highlightedRef : null}
                      className={`rounded-lg border transition-all duration-300 overflow-hidden ${
                        isHighlighted
                          ? "border-amber-500 bg-amber-500/5 shadow-lg shadow-amber-500/5 scale-[1.01] ring-1 ring-amber-500/30"
                          : "border-border bg-surface-1/30"
                      }`}
                    >
                      <div
                        className={`flex items-center justify-between border-b px-4 py-2 text-xs transition-colors ${
                          isHighlighted
                            ? "border-amber-500/30 bg-amber-500/10"
                            : "border-border/50 bg-surface-2/20"
                        }`}
                      >
                        <span
                          className={`font-semibold ${isHighlighted ? "text-amber-400" : "text-muted-foreground"}`}
                        >
                          Chunk #{idx + 1}
                          {chunk.page_number !== undefined && chunk.page_number !== null
                            ? ` · Page ${chunk.page_number}`
                            : ""}{" "}
                          {isHighlighted && "(Matched Source)"}
                        </span>
                        <span className="font-mono text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">
                          {chunk.token_count} Tokens (approx)
                        </span>
                      </div>
                      <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap select-text font-sans text-foreground/90">
                        {chunk.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border/80 px-5 py-3 text-right bg-surface-2/30 shrink-0">
              <Button onClick={() => setModalOpen(false)}>Close Viewer</Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
