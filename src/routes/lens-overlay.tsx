import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { X, Check } from "lucide-react";

export const Route = createFileRoute("/lens-overlay")({
  component: LensOverlayComponent,
});

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function LensOverlayComponent() {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load fullscreen screenshot base64 on mount from Electron main process
  useEffect(() => {
    const api = (window as any).cortexAPI;
    if (api && api.getLensScreenshot) {
      api.getLensScreenshot().then((data: string | null) => {
        if (data) {
          setScreenshot(data);
        }
      }).catch(console.error);
    }

    // Escape key listener to close overlay
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      } else if (e.key === "Enter" && selection) {
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selection]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    const x = e.clientX;
    const y = e.clientY;
    setDragStart({ x, y });
    setCurrentPos({ x, y });
    setSelection(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || !currentPos) return;
    const x = e.clientX;
    const y = e.clientY;
    setCurrentPos({ x, y });
  };

  const handleMouseUp = () => {
    if (!dragStart || !currentPos) return;

    const x = Math.min(dragStart.x, currentPos.x);
    const y = Math.min(dragStart.y, currentPos.y);
    const w = Math.abs(dragStart.x - currentPos.x);
    const h = Math.abs(dragStart.y - currentPos.y);

    if (w > 10 && h > 10) {
      console.log(`[LENS] Selection completed`);
      console.log(`[LENS] x=${x}`);
      console.log(`[LENS] y=${y}`);
      console.log(`[LENS] width=${w}`);
      console.log(`[LENS] height=${h}`);
      const newSelection = { x, y, w, h };
      setSelection(newSelection);
      
      // Auto-capture on release
      setTimeout(() => {
        handleConfirm(newSelection);
      }, 50);
    }

    setDragStart(null);
    setCurrentPos(null);
  };

  const handleCancel = () => {
    const api = (window as any).cortexAPI;
    if (api && api.cancelLens) {
      api.cancelLens();
    }
  };

  const handleConfirm = async (overrideSelection?: SelectionRect) => {
    const sel = overrideSelection || selection;
    if (!sel || !screenshot) return;

    try {
      const cropped = await cropBase64(screenshot, sel);
      console.log(`[LENS] Screenshot captured`);
      console.log(`[LENS] image exists: ${!!cropped}`);
      console.log(`[LENS] image dimensions: ${sel.w}x${sel.h}`);
      console.log(`[LENS] base64 exists: ${!!cropped}`);
      console.log(`[LENS] base64 length: ${cropped ? cropped.length : 0}`);
      
      const api = (window as any).cortexAPI;
      if (api && api.completeLens) {
        api.completeLens(cropped);
      }
    } catch (err) {
      console.error("Failed to crop selection:", err);
      handleCancel();
    }
  };

  // Helper function to crop screen base64 with DPI factor correction
  const cropBase64 = (
    base64Str: string,
    rect: SelectionRect,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = rect.w;
        canvas.height = rect.h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get 2d context"));
          return;
        }

        // Apply DPI scaling factor
        const scaleX = img.width / window.innerWidth;
        const scaleY = img.height / window.innerHeight;

        const cropX = rect.x * scaleX;
        const cropY = rect.y * scaleY;
        const cropW = rect.w * scaleX;
        const cropH = rect.h * scaleY;

        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, rect.w, rect.h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = reject;
      img.src = base64Str;
    });
  };

  // Calculate coordinates for drag overlay rendering
  let dragRect: SelectionRect | null = null;
  if (dragStart && currentPos) {
    dragRect = {
      x: Math.min(dragStart.x, currentPos.x),
      y: Math.min(dragStart.y, currentPos.y),
      w: Math.abs(dragStart.x - currentPos.x),
      h: Math.abs(dragStart.y - currentPos.y),
    };
  }

  const activeRect = selection || dragRect;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-screen h-screen overflow-hidden cursor-crosshair select-none bg-black"
    >
      {/* Background Screenshot */}
      {screenshot && (
        <img
          src={screenshot}
          alt="screen"
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}

      {/* Darkened overlay for non-selected regions */}
      <div className="absolute inset-0 bg-black/50 pointer-events-none" />

      {/* Selected region cut-out */}
      {activeRect && screenshot && (
        <div
          className="absolute border border-white bg-transparent pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
          style={{
            left: activeRect.x,
            top: activeRect.y,
            width: activeRect.w,
            height: activeRect.h,
          }}
        />
      )}

      {/* Guide text overlay */}
      {!selection && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-4 py-2 border border-border/40 text-xs text-white pointer-events-none tracking-wide backdrop-blur font-sans">
          {dragStart ? "Release to capture region" : "Drag a box to select screen region · Esc to cancel"}
        </div>
      )}

      {/* Action panel pinned directly next to selection box */}
      {selection && (
        <div
          className="absolute flex items-center gap-1.5 rounded-lg border border-border bg-surface-1/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in duration-200"
          style={{
            left: Math.max(10, selection.x + selection.w - 120),
            top: selection.y + selection.h + 8 + (selection.y + selection.h + 40 > window.innerHeight ? -70 : 0),
          }}
        >
          <button
            onClick={handleCancel}
            className="flex items-center justify-center gap-1 rounded bg-surface-2 hover:bg-surface-3 px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition border border-border"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex items-center justify-center gap-1 rounded bg-foreground text-background px-2 py-1 text-[11px] font-semibold cursor-pointer transition hover:opacity-90"
          >
            <Check className="h-3 w-3" /> Capture
          </button>
        </div>
      )}
    </div>
  );
}
