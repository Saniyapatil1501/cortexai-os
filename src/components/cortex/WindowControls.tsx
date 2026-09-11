import { Minus, Square, X } from "lucide-react";

interface WindowControlsProps {
  className?: string;
}

export function WindowControls({ className = "" }: WindowControlsProps) {
  if (typeof window === "undefined" || !(window as any).cortexAPI) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1 no-drag-region ${className}`}>
      <button
        onClick={() => (window as any).cortexAPI.minimizeWindow()}
        className="h-8 w-8 rounded-md hover:bg-surface-2 grid place-items-center text-muted-foreground hover:text-foreground transition cursor-pointer"
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={() => (window as any).cortexAPI.maximizeWindow()}
        className="h-8 w-8 rounded-md hover:bg-surface-2 grid place-items-center text-muted-foreground hover:text-foreground transition cursor-pointer"
        title="Maximize"
      >
        <Square className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => (window as any).cortexAPI.closeWindow()}
        className="h-8 w-8 rounded-md hover:bg-red-500/25 grid place-items-center text-muted-foreground hover:text-red-400 transition cursor-pointer"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
