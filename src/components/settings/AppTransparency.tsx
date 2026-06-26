interface Props {
  value: number;
  onChange: (v: number) => void;
}

export function AppTransparency({ value, onChange }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          App Transparency
        </p>
        <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={20}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{
          accentColor: "#e0e0e0",
          height: "1px",
          WebkitAppearance: "none",
          appearance: "none",
          background: `linear-gradient(to right, #e0e0e0 ${((value - 20) / 80) * 100}%, #2a2a2a ${((value - 20) / 80) * 100}%)`,
          outline: "none",
          border: "none",
        }}
      />
    </div>
  );
}
