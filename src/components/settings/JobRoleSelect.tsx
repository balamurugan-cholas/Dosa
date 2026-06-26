import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}

export function JobRoleSelect({ value, onChange, options }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function normalizeSearchText(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isFuzzyMatch(option: string, searchValue: string) {
    const normalizedOption = normalizeSearchText(option);
    const normalizedQuery = normalizeSearchText(searchValue);

    if (!normalizedQuery) {
      return true;
    }

    const compactOption = normalizedOption.replace(/\s+/g, "");
    const compactQuery = normalizedQuery.replace(/\s+/g, "");

    if (
      normalizedOption.includes(normalizedQuery) ||
      compactOption.includes(compactQuery)
    ) {
      return true;
    }

    let optionIndex = 0;
    for (const char of compactQuery) {
      optionIndex = compactOption.indexOf(char, optionIndex);
      if (optionIndex === -1) {
        return false;
      }
      optionIndex += 1;
    }

    return true;
  }

  function getMatchRank(option: string, searchValue: string) {
    const normalizedOption = normalizeSearchText(option);
    const normalizedQuery = normalizeSearchText(searchValue);

    if (!normalizedQuery) {
      return 0;
    }

    const compactOption = normalizedOption.replace(/\s+/g, "");
    const compactQuery = normalizedQuery.replace(/\s+/g, "");

    if (
      normalizedOption === normalizedQuery ||
      compactOption === compactQuery
    ) {
      return 0;
    }

    if (
      normalizedOption.startsWith(normalizedQuery) ||
      compactOption.startsWith(compactQuery)
    ) {
      return 1;
    }

    if (
      normalizedOption.includes(normalizedQuery) ||
      compactOption.includes(compactQuery)
    ) {
      return 2;
    }

    return 3;
  }

  const filteredOptions = query.trim()
    ? [...options]
        .filter((option) => isFuzzyMatch(option, query))
        .sort(
          (left, right) =>
            getMatchRank(left, query) - getMatchRank(right, query) ||
            left.localeCompare(right)
        )
    : options;

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });

    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handleClick);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-3">
        Job Role
      </p>
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-xs bg-secondary border border-border px-2.5 py-[7px] text-foreground hover:bg-accent transition-colors"
        >
          <span>{value}</span>
          <ChevronDown
            size={11}
            strokeWidth={1.75}
            className={`text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-[2px] overflow-hidden border border-border bg-card z-50 shadow-lg shadow-black/40">
            <div className="border-b border-border p-2">
              <div className="flex items-center gap-2 rounded border border-border bg-background px-2 py-1.5">
                <Search size={12} strokeWidth={1.75} className="text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setOpen(false);
                    }
                  }}
                  placeholder="Search roles..."
                  className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
                />
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto">
              {filteredOptions.length > 0 ? (
                filteredOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={`w-full text-left text-xs px-2.5 py-[6px] transition-colors hover:bg-accent ${
                      opt === value ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {opt}
                  </button>
                ))
              ) : (
                <div className="px-2.5 py-3 text-xs text-muted-foreground">
                  No matching job roles.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
