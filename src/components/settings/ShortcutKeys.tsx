import { SHORTCUTS } from "../../lib/constants";

export function ShortcutKeys() {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">
        Shortcut Keys
      </p>
      <div className="space-y-2">
        {SHORTCUTS.map(([action, key]) => (
          <div key={action} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{action}</span>
            <span className="text-[11px] text-foreground font-mono tracking-tight">
              {key}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
