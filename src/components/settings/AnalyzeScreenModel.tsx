interface Props {
  model: string;
  onChange: (value: string) => void;
}

export function AnalyzeScreenModel({ model, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Analyze Screen
        </p>
        <span className="text-[10px] text-muted-foreground">Model</span>
      </div>

      <input
        type="text"
        value={model}
        onChange={(event) => onChange(event.target.value)}
        placeholder="openrouter/free"
        className="w-full bg-secondary border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:bg-accent transition-colors"
      />
    </div>
  );
}
