interface Props {
  isTranscribing: boolean;
  isAnswering: boolean;
  onListen: () => void;
  onAnswer: () => void;
  onClear: () => void;
  onAnalyze: () => void;
}

export function BottomBar({
  isTranscribing,
  isAnswering,
  onListen,
  onAnswer,
  onClear,
  onAnalyze,
}: Props) {
  const answerDisabled = isAnswering;

  return (
    <div className="flex items-center justify-between px-3 h-10 border-t border-border shrink-0">
      <div className="flex items-center gap-1.5">
        <button
          onClick={onListen}
          className="text-xs px-2.5 py-[5px] bg-secondary text-secondary-foreground hover:bg-accent transition-colors leading-none"
        >
          {isTranscribing ? "Stop" : "Listen"}
        </button>
        <button
          onClick={onAnswer}
          disabled={answerDisabled}
          className="text-xs px-2.5 py-[5px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed transition-opacity leading-none"
        >
          Answer
        </button>
        <button
          onClick={onClear}
          className="text-xs px-2.5 py-[5px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors leading-none"
        >
          Clear
        </button>
      </div>
      <button
        onClick={onAnalyze}
        className="text-xs px-2.5 py-[5px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors leading-none"
      >
        Analyze Screen
      </button>
    </div>
  );
}
