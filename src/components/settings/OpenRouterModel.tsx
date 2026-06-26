interface Props {
  apiKey: string;
  model: string;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

export function OpenRouterModel({
  apiKey,
  model,
  onApiKeyChange,
  onModelChange,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          OpenRouter
        </p>
        <span className="text-[10px] text-muted-foreground">Answers</span>
      </div>

      <div className="space-y-2">
        <input
          type="password"
          value={apiKey}
          onChange={(event) => onApiKeyChange(event.target.value)}
          placeholder="OpenRouter API key"
          className="w-full bg-secondary border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:bg-accent transition-colors"
        />
        <input
          type="text"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder="openrouter/free"
          className="w-full bg-secondary border border-border px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:bg-accent transition-colors"
        />
      </div>
    </div>
  );
}
