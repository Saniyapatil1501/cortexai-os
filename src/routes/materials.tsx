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
  FileUp
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cortexClient, DocumentItem, DocumentChunkItem } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { toast } from "sonner";

export const Route = createFileRoute("/materials")({
  head: () => ({
    meta: [
      { title: "Study Materials — CortexAI" },
      { name: "description", content: "Manage your local course materials, papers, and text documents." },
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

  // Chunk Viewer State
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
  const [chunks, setChunks] = useState<DocumentChunkItem[]>([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchDocuments = () => {
    if (!userId) return;
    cortexClient.getDocuments(userId)
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

  // Polling for processing documents
  useEffect(() => {
    if (!userId || isBackendOffline) return;

    const needsPolling = documents.some(d => d.status === "processing");
    if (!needsPolling) return;

    const interval = setInterval(async () => {
      try {
        const data = await cortexClient.getDocuments(userId);
        // Compare status to see if changes occurred to prevent unnecessary state triggers
        const hasStatusChange = data.some((newDoc) => {
          const oldDoc = documents.find(d => d.id === newDoc.id);
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
      toast.success(`"${filename}" uploaded successfully. Processing text...`);
      setDocuments(prev => [newDoc, ...prev]);
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
      toast.success("Document deleted");
      setDocuments(prev => prev.filter(d => d.id !== docId));
      if (selectedDoc?.id === docId) {
        setModalOpen(false);
        setSelectedDoc(null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
      toast.error("Failed to delete document.");
    }
  };

  const handleViewChunks = async (doc: DocumentItem) => {
    setSelectedDoc(doc);
    setChunksLoading(true);
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

  if (isBackendOffline) {
    return (
      <AppLayout>
        <PageHeader title="Study Materials" description="Manage your course notes, textbook PDFs, or text documents." />
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-lg font-medium text-destructive">Daemon Offline</div>
          <div className="max-w-md text-sm text-muted-foreground">
            The CortexAI Desktop Daemon is currently offline. Please ensure the backend is running and try again.
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

      <div className="grid grid-cols-1 gap-6">
        {/* Upload Zone */}
        <Card padded={false} className="border border-dashed border-border/80 hover:border-foreground/30 transition overflow-hidden">
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
              {uploading ? "Uploading document..." : "Drag & drop study material here or click to browse"}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">
              Supports PDF, TXT, MD up to 10MB
            </div>
          </div>
        </Card>

        {/* Documents List */}
        <Card>
          <div className="mb-4">
            <h3 className="text-base font-medium">Your Knowledge Base</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Documents will be processed locally and chunked ready for RAG query context.</p>
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
                      year: "numeric"
                    });
                    
                    return (
                      <tr key={doc.id} className="hover:bg-surface-2/20 transition-colors">
                        <td className="py-3.5 pl-3 font-medium flex items-center gap-2.5 truncate max-w-xs md:max-w-sm" title={doc.original_filename}>
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
                          {doc.status === "failed" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-400" title="Scanned PDFs require Computer Vision OCR support.">
                              <AlertCircle className="h-3.5 w-3.5" /> Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 font-mono text-xs">{doc.status === "ready" ? doc.chunk_count : "-"}</td>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
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
                  Chunks parsed: {selectedDoc.chunk_count} | Size: {formatFileSize(selectedDoc.file_size)}
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
                chunks.map((chunk, idx) => (
                  <div key={chunk.id} className="rounded-lg border border-border bg-surface-1/30 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-border/50 bg-surface-2/20 px-4 py-2 text-xs">
                      <span className="font-semibold text-muted-foreground">Chunk #{idx + 1}</span>
                      <span className="font-mono text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-muted-foreground">
                        {chunk.token_count} Tokens (approx)
                      </span>
                    </div>
                    <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap select-text font-sans text-foreground/90">
                      {chunk.content}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-border/80 px-5 py-3 text-right bg-surface-2/30 shrink-0">
              <Button onClick={() => setModalOpen(false)}>
                Close Viewer
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
