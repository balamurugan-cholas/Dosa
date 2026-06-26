import type { CSSProperties } from "react";
import { Settings, X, ArrowLeft } from "lucide-react";
import { View } from "../lib/types";

const dragRegionStyle = {
  WebkitAppRegion: "drag",
} as CSSProperties & {
  WebkitAppRegion: "drag";
};

const noDragRegionStyle = {
  WebkitAppRegion: "no-drag",
} as CSSProperties & {
  WebkitAppRegion: "no-drag";
};

interface Props {
  view: View;
  resumeUploaded: boolean;
  onSettings: () => void;
  onBack: () => void;
  onClose: () => void;
}

export function Topbar({ view, resumeUploaded, onSettings, onBack, onClose }: Props) {
  return (
    <div
      className="flex items-center justify-between px-3 h-9 border-b border-border cursor-grab select-none shrink-0"
      style={dragRegionStyle}
    >
      <span className="text-[11px] font-semibold tracking-[0.18em] text-foreground">
        Dosa
      </span>
      <div className="flex items-center gap-1">
        <div
          className={`flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.14em] leading-none ${
            resumeUploaded
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/20 bg-amber-500/10 text-amber-300"
          }`}
          style={noDragRegionStyle}
        >
          <span
            className={`h-1.5 w-1.5 ${
              resumeUploaded ? "bg-emerald-300" : "bg-amber-300"
            }`}
          />
          <span>{resumeUploaded ? "Resume ready" : "Upload resume"}</span>
        </div>
        {view === "main" ? (
          <button
            onClick={onSettings}
            type="button"
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            style={noDragRegionStyle}
          >
            <Settings size={12} strokeWidth={1.75} />
          </button>
        ) : (
          <button
            onClick={onBack}
            type="button"
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            style={noDragRegionStyle}
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={onClose}
          type="button"
          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          style={noDragRegionStyle}
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
