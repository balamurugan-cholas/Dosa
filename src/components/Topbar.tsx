import type { CSSProperties } from "react";
import { Settings, X, ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { View } from "../lib/types";

const dragRegionStyle = {
  WebkitAppRegion: "drag",
} as CSSProperties & { WebkitAppRegion: "drag" };

const noDragRegionStyle = {
  WebkitAppRegion: "no-drag",
} as CSSProperties & { WebkitAppRegion: "no-drag" };

interface Props {
  view: View;
  resumeUploaded: boolean;
  onSettings: () => void;
  onBack: () => void;
  onClose: () => void;
  isTranscribing: boolean;
  isAnswering: boolean;
  onListen: () => void;
  onAnswer: () => void;
  onClear: () => void;
  onAnalyze: () => void;
  answerCount: number;
  answerIndex: number;
  onPrevAnswer: () => void;
  onNextAnswer: () => void;
  autoAnswer: boolean;
  onToggleAutoAnswer: () => void;
  updateAvailable?: boolean;
  updateVersion?: string | null;
  onUpdateClick?: () => void;
}

export function Topbar({
  view,
  resumeUploaded,
  onSettings,
  onBack,
  onClose,
  isTranscribing,
  isAnswering,
  onListen,
  onAnswer,
  onClear,
  onAnalyze,
  answerCount,
  answerIndex,
  onPrevAnswer,
  onNextAnswer,
  autoAnswer,
  onToggleAutoAnswer,
  updateAvailable = false,
  updateVersion = null,
  onUpdateClick,
}: Props) {
  const hasPrev = answerIndex > 0;
  const hasNext = answerIndex < answerCount - 1;

  return (
    <div
      className="flex items-center justify-between px-3 h-10 border-b border-border shrink-0 cursor-grab select-none"
      style={dragRegionStyle}
    >
      {/* Left: title + action buttons */}
      <div className="flex items-center gap-2" style={noDragRegionStyle}>
        <span className="text-[11px] font-semibold tracking-[0.18em] text-foreground mr-1">
          Dosa
        </span>

        {updateAvailable && (
          <button
            onClick={onUpdateClick}
            className="relative flex items-center justify-center w-5 h-5 -ml-1 mr-1 text-emerald-300 hover:text-emerald-200 transition-colors"
            aria-label="Update available"
          >
            <Download size={12} strokeWidth={2} />
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </button>
        )}

        <button
          onClick={onListen}
          className="text-xs px-2.5 py-[5px] bg-secondary text-secondary-foreground hover:bg-accent transition-colors leading-none"
        >
          {isTranscribing ? "Stop" : "Listen"}
        </button>
        <button
          onClick={onAnswer}
          disabled={isAnswering}
          className="text-xs px-2.5 py-[5px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed transition-opacity leading-none"
        >
          Answer
        </button>
        <button
          onClick={onToggleAutoAnswer}
          className={`text-xs px-2.5 py-[5px] transition-colors leading-none ${
            autoAnswer
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          Auto
        </button>
        <button
          onClick={onClear}
          className="text-xs px-2.5 py-[5px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors leading-none"
        >
          Clear
        </button>

        {answerCount > 0 && (
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={onPrevAnswer}
              disabled={!hasPrev}
              className="p-[3px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous answer"
            >
              <ChevronLeft size={13} strokeWidth={2} />
            </button>
            <span className="text-[10px] tabular-nums text-muted-foreground min-w-[28px] text-center leading-none">
              {answerIndex + 1}/{answerCount}
            </span>
            <button
              onClick={onNextAnswer}
              disabled={!hasNext}
              className="p-[3px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Next answer"
            >
              <ChevronRight size={13} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      {/* Right: resume badge + analyze + settings/back + close */}
      <div className="flex items-center gap-1" style={noDragRegionStyle}>
        <button
          onClick={onAnalyze}
          className="text-xs px-2.5 py-[5px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors leading-none"
        >
          Analyze
        </button>

        <div
          className={`flex items-center gap-1 border px-2 py-1 text-[9px] uppercase tracking-[0.14em] leading-none ${
            resumeUploaded
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/20 bg-amber-500/10 text-amber-300"
          }`}
        >
          <span className={`h-1.5 w-1.5 ${resumeUploaded ? "bg-emerald-300" : "bg-amber-300"}`} />
          <span>{resumeUploaded ? "Resume ready" : "Upload resume"}</span>
        </div>

        {view === "main" ? (
          <button
            onClick={onSettings}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Settings size={12} strokeWidth={1.75} />
          </button>
        ) : (
          <button
            onClick={onBack}
            className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft size={12} strokeWidth={1.75} />
          </button>
        )}

        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}