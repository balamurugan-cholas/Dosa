interface Props {
  value: number;
  onChange: (v: number) => void;
}

export function AnswerMemory({ value, onChange }: Props) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-0.5">
        Answer Memory
      </p>
      <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
        How many previous messages the AI uses per answer
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-6 h-6 flex items-center justify-center bg-secondary text-foreground hover:bg-accent transition-colors text-sm leading-none select-none"
        >
          −
        </button>
        <span className="text-xs text-foreground w-5 text-center tabular-nums">
          {value}
        </span>
        <button
          onClick={() => onChange(Math.min(20, value + 1))}
          className="w-6 h-6 flex items-center justify-center bg-secondary text-foreground hover:bg-accent transition-colors text-sm leading-none select-none"
        >
          +
        </button>
        <span className="text-[10px] text-muted-foreground ml-1">/ 20</span>
      </div>
    </div>
  );
}