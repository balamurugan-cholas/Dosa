interface Props {
  value: number;
  onChange: (v: number) => void;
}

const MIN_WIDTH = 600;
const MAX_WIDTH = 1000;

export function AppWidth({ value, onChange }: Props) {
  const nextValue = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
  const progress = ((nextValue - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH)) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          App Width
        </p>
        <span className="text-[11px] text-muted-foreground tabular-nums w-14 text-right">
          {nextValue}px
        </span>
      </div>
      <input
        type="range"
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        step={10}
        value={nextValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{
          accentColor: "#e0e0e0",
          height: "1px",
          WebkitAppearance: "none",
          appearance: "none",
          background: `linear-gradient(to right, #e0e0e0 ${progress}%, #2a2a2a ${progress}%)`,
          outline: "none",
          border: "none",
        }}
      />
    </div>
  );
}
