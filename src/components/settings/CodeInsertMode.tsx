import { CodeInsertMode as CodeInsertModeType } from "../../lib/types";

interface Props {
  value: CodeInsertModeType;
  onChange: (value: CodeInsertModeType) => void;
}

export function CodeInsertMode({ value, onChange }: Props) {
  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-sm font-medium text-foreground">VS Code Insert Style</p>
        <p className="text-xs text-muted-foreground">
          Choose how code is written into VS Code when you click "Send to VS Code".
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange("instant")}
          className={`flex-1 rounded border px-3 py-2 text-xs text-left transition-colors ${
            value === "instant"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-secondary"
          }`}
        >
          <span className="block font-medium">Instant</span>
          <span className="block text-[11px] opacity-80">Pastes all at once</span>
        </button>

        <button
          type="button"
          onClick={() => onChange("natural")}
          className={`flex-1 rounded border px-3 py-2 text-xs text-left transition-colors ${
            value === "natural"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-secondary"
          }`}
        >
          <span className="block font-medium">Natural Typing</span>
          <span className="block text-[11px] opacity-80">Types it out like a real person</span>
        </button>
      </div>
    </div>
  );
}