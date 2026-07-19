import { createContext, useContext, useEffect, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { FileCode2, Check, Loader2, GitMerge } from "lucide-react";
import { ContentBlock } from "../lib/types";
import { resolveFullFileRewrite, resolveOpenRouterModel } from "../lib/openrouter";
import { computeInsertionPlan } from "../lib/diff";

// Context lets markdownComponents.code (defined outside the component) read
// the current setting synchronously on every render — no effect, no window
// global, no stale-until-remount timing gap.
const CodeInsertModeContext = createContext<"instant" | "natural">("instant");

interface OpenRouterCreds {
  apiKey: string;
  model: string;
}
const OpenRouterCredsContext = createContext<OpenRouterCreds>({ apiKey: "", model: "" });

type AnswerNode =
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "code";
      language: string;
      code: string;
      open: boolean;
    };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseAnswerNodes(text: string): AnswerNode[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const nodes: AnswerNode[] = [];
  let paragraphLines: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";

  const flushParagraph = () => {
    const paragraph = paragraphLines
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");

    if (paragraph) {
      nodes.push({ kind: "paragraph", text: paragraph });
    }

    paragraphLines = [];
  };

  const flushCode = (open: boolean) => {
    const code = codeLines.join("\n");

    if (code.trim().length > 0 || open) {
      nodes.push({
        kind: "code",
        language: codeLanguage || "plaintext",
        code,
        open,
      });
    }

    codeLines = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```([\w.+#-]*)\s*$/);
    if (fenceMatch) {
      if (inCodeBlock) {
        flushCode(false);
        inCodeBlock = false;
      } else {
        flushParagraph();
        inCodeBlock = true;
        codeLanguage = fenceMatch[1].trim().toLowerCase();
      }

      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    flushCode(true);
  } else {
    flushParagraph();
  }

  return nodes;
}

function highlightCode(code: string, language: string) {
  const normalizedLanguage = language.trim().toLowerCase();

  // Never syntax-highlight plain text — just escape and return as-is
  if (!normalizedLanguage || normalizedLanguage === "plaintext" || normalizedLanguage === "text") {
    return { html: escapeHtml(code), language: "plaintext" };
  }

  try {
    if (hljs.getLanguage(normalizedLanguage)) {
      return {
        html: hljs.highlight(code, {
          language: normalizedLanguage,
          ignoreIllegals: true,
        }).value,
        language: normalizedLanguage,
      };
    }

    const auto = hljs.highlightAuto(code);
    // If auto-detect falls back to plaintext, don't highlight
    if (!auto.language || auto.language === "plaintext") {
      return { html: escapeHtml(code), language: "plaintext" };
    }

    return {
      html: auto.value,
      language: auto.language,
    };
  } catch {
    return {
      html: escapeHtml(code),
      language: normalizedLanguage,
    };
  }
}

function getCodeLanguage(className?: string) {
  const match = className?.match(/language-([\w.+#-]+)/i);
  return match?.[1]?.toLowerCase() || "plaintext";
}

type SendState = "idle" | "sending" | "sent";

function SendToVSCodeButton({ code, mode }: { code: string; mode: "instant" | "natural" }) {
  const [state, setState] = useState<SendState>("idle");

  const handleClick = async () => {
    if (state === "sending") return;

    const bridge = (window as any).vscodeBridge;
    if (!bridge?.sendCode) {
      toast.error("VS Code integration not available in this build.");
      return;
    }

    setState("sending");
    try {
      const result = await bridge.sendCode(code, mode);
      if (result?.success) {
        setState("sent");
        toast.success("Sent to VS Code");
        setTimeout(() => setState("idle"), 1500);
      } else {
        setState("idle");
        toast.error(result?.error || "Could not send code to VS Code");
      }
    } catch {
      setState("idle");
      toast.error("Could not send code to VS Code");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "sending"}
      className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
      title="Insert at cursor in VS Code"
    >
      {state === "sending" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state === "sent" ? (
        <Check className="h-3 w-3" />
      ) : (
        <FileCode2 className="h-3 w-3" />
      )}
      {state === "sent" ? "Sent" : "VS Code"}
    </button>
  );
}

function ContinueInVSCodeButton({ code, mode }: { code: string; mode: "instant" | "natural" }) {
  const [state, setState] = useState<SendState>("idle");
  const creds = useContext(OpenRouterCredsContext);

  const handleClick = async () => {
    if (state === "sending") return;

    const bridge = (window as any).vscodeBridge;
    if (!bridge?.sendCode || !bridge?.getFileContent) {
      toast.error("VS Code integration not available in this build.");
      return;
    }

    const apiKey = creds.apiKey.trim();
    if (!apiKey) {
      toast.error("Add your OpenRouter API key in settings to use Continue.");
      return;
    }

    setState("sending");
    try {
      const fileResult = await bridge.getFileContent();
      if (!fileResult?.success) {
        setState("idle");
        toast.error(fileResult?.error || "Could not read the current VS Code file.");
        return;
      }

      const rewrittenContent = await resolveFullFileRewrite({
        apiKey,
        model: resolveOpenRouterModel(creds.model),
        fileContent: fileResult.content,
        languageId: fileResult.languageId,
        newCode: code,
      });

      const plan = computeInsertionPlan(fileResult.content, rewrittenContent);
      console.log("[continue] ORIGINAL:\n" + fileResult.content);
      console.log("[continue] REWRITTEN:\n" + rewrittenContent);
      console.log("[continue] plan.safe:", plan.safe, "reason:", plan.reason);
      console.log("[continue] plan.offendingLine:", JSON.stringify(plan.offendingLine));
      console.log("[continue] plan.insertions:", plan.insertions);

      if (!plan.safe) {
        setState("idle");
        toast.error(
          `Refused to apply — ${plan.reason || "the model altered existing code."} Try again or insert manually.`
        );
        return;
      }

      if (plan.insertions.length === 0) {
        setState("idle");
        toast.message("Nothing new to add — this already exists in the file.");
        return;
      }

      const bridgeAny = bridge as {
        applyInsertions?: (insertions: unknown, mode: string, replacements: unknown) => Promise<any>;
      };
      if (!bridgeAny.applyInsertions) {
        setState("idle");
        toast.error("VS Code integration is out of date — restart the app.");
        return;
      }

      const result = await bridgeAny.applyInsertions(plan.insertions, mode, plan.replacements);
      if (result?.success) {
        setState("sent");
        toast.success("Placed in VS Code");
        setTimeout(() => setState("idle"), 1500);
      } else {
        setState("idle");
        toast.error(result?.error || "Could not place code in VS Code");
      }
    } catch (err) {
      setState("idle");
      toast.error(err instanceof Error ? err.message : "Could not determine placement");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === "sending"}
      className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60"
      title="Sends the full file to the model for precise placement — uses more tokens than the VS Code button"
    >
      {state === "sending" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : state === "sent" ? (
        <Check className="h-3 w-3" />
      ) : (
        <GitMerge className="h-3 w-3" />
      )}
      {state === "sent" ? "Placed" : "Continue"}
    </button>
  );
}

// Small wrapper so markdownComponents (a module-level object) can still
// read the current mode via context at render time.
function SendToVSCodeButtonConnected({ code }: { code: string }) {
  const mode = useContext(CodeInsertModeContext);
  return (
    <div className="flex items-center gap-1.5">
      <SendToVSCodeButton code={code} mode={mode} />
      <ContinueInVSCodeButton code={code} mode={mode} />
    </div>
  );
}

const markdownComponents: Components = {
  p({ children }) {
    return (
      <p className="text-base leading-7 text-foreground break-words whitespace-normal">
        {children}
      </p>
    );
  },
  h1({ children }) {
    return <h1 className="text-xl font-semibold leading-8 text-foreground">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-semibold leading-8 text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold leading-7 text-foreground">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="text-sm font-semibold leading-7 text-foreground">{children}</h4>;
  },
  ul({ children }) {
    return <ul className="my-1 ml-5 list-disc space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-1 ml-5 list-decimal space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-base leading-7 text-foreground break-words">{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-base leading-7 text-muted-foreground">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-3 border-border" />;
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        className="text-primary underline decoration-primary/60 underline-offset-2"
        rel="noreferrer"
        target="_blank"
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded border border-border">
        <table className="min-w-full border-collapse text-left text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-secondary/50">{children}</thead>;
  },
  tbody({ children }) {
    return <tbody>{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="border-b border-border">{children}</tr>;
  },
  th({ children }) {
    return (
      <th className="border border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border border-border px-3 py-2 align-top text-foreground">{children}</td>
    );
  },
  code({ inline, className, children }: any) {
    if (children == null || children === "") return null;
    const rawCode = String(children).replace(/\n$/, "");
    if (rawCode.trim().toLowerCase() === "undefined") return null;
    const isMultiline = rawCode.includes("\n");
    const language = getCodeLanguage(className);

    // Treat as inline if: explicitly inline, or no language specified and single line
    if (inline || (!isMultiline && !className)) {
      return (
        <code className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[0.95em] text-foreground">
          {children}
        </code>
      );
    }

    const highlighted = highlightCode(rawCode, language);

    return (
      <div className="overflow-hidden rounded border border-border bg-[#101010]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {highlighted.language}
          </span>
          <SendToVSCodeButtonConnected code={rawCode} />
        </div>
        <pre className="overflow-x-auto px-3 py-3 text-xs leading-[1.65]">
          <code
            className="hljs block whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        </pre>
      </div>
    );
  },
};

function MarkdownAnswer({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const content = text.trim();

  if (!content) {
    return active ? <p className="text-xs text-muted-foreground">Thinking...</p> : null;
  }

  return (
    <div className="space-y-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
      {active && <span className="inline-block h-[13px] w-[2px] animate-pulse bg-muted-foreground" />}
    </div>
  );
}

function renderInlineText(text: string) {
  const parts = text.split(/(`[^`]*`)/g);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={`${index}-${part}`}
          className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[0.95em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

function AnswerText({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  const nodes = parseAnswerNodes(text);

  if (nodes.length === 0) {
    return active ? <p className="text-xs text-muted-foreground">Thinking...</p> : null;
  }

  return (
    <div className="space-y-3">
      {nodes.map((node, index) => {
        if (node.kind === "paragraph") {
          return (
            <p
              key={`${index}-${node.text.slice(0, 24)}`}
              className="text-sm text-foreground leading-[1.65] whitespace-pre-wrap break-words"
            >
              {renderInlineText(node.text)}
              {active && index === nodes.length - 1 && (
                <span className="inline-block w-[2px] h-[13px] bg-muted-foreground ml-0.5 align-middle animate-pulse" />
              )}
            </p>
          );
        }

        const highlighted = highlightCode(node.code, node.language);

        return (
          <div
            key={`${index}-${node.language}-${node.code.slice(0, 24)}`}
            className="overflow-hidden rounded border border-border bg-[#101010]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {highlighted.language}
              </span>
              <div className="flex items-center gap-2">
                {node.open && active && (
                  <span className="text-[9px] text-muted-foreground">streaming</span>
                )}
                {!node.open && <SendToVSCodeButtonConnected code={node.code} />}
              </div>
            </div>
            <pre className="overflow-x-auto px-3 py-3 text-xs leading-[1.65]">
              <code
                className="hljs block whitespace-pre"
                dangerouslySetInnerHTML={{ __html: highlighted.html }}
              />
            </pre>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  blocks: ContentBlock[];
  isTranscribing: boolean;
  isAnswering: boolean;
  activeTranscriptionId: number | null;
  activeAnswerId: number | null;
  scrollToBottomSignal: number;
  // Answer navigation
  answerIndex: number;
  codeInsertMode: "instant" | "natural";
  openrouterApiKey: string;
  openrouterModel: string;
}

export function ContentArea({
  blocks,
  isTranscribing,
  isAnswering,
  activeTranscriptionId,
  activeAnswerId,
  scrollToBottomSignal,
  answerIndex,
  codeInsertMode,
  openrouterApiKey,
  openrouterModel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [scrollToBottomSignal]);

  // Derive merged transcription text from all transcription blocks
  const transcriptionText = blocks
    .filter((b) => b.kind === "transcription" && b.text.trim().length > 0)
    .map((b) => b.text)
    .join(" ")
    .trim();

  // Active transcription block (for live cursor)
  const liveTranscriptionBlock = blocks.find(
    (b) => b.kind === "transcription" && b.id === activeTranscriptionId
  );

  // Auto-scroll transcription line to the right as new text arrives
  const transcriptLineRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = transcriptLineRef.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [transcriptionText]);

  // All answer blocks in order
  const answerBlocks = blocks.filter((b) => b.kind === "answer");

  // The answer to show (clamped to valid range)
  const clampedIndex = Math.max(0, Math.min(answerIndex, answerBlocks.length - 1));
  const visibleAnswer = answerBlocks[clampedIndex] ?? null;

  const isEmpty = blocks.length === 0;

  return (
    <CodeInsertModeContext.Provider value={codeInsertMode}>
    <OpenRouterCredsContext.Provider value={{ apiKey: openrouterApiKey, model: openrouterModel }}>
    {/* Outer: fixed height, no scroll — just a flex column container */}
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 py-3">
      {isEmpty ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isTranscribing ? "Listening..." : "Listening for speech..."}
        </p>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 gap-3">

          {/* Transcription — pinned, never scrolls vertically */}
          <div
            ref={transcriptLineRef}
            className="shrink-0 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {transcriptionText ? (
              <p className="text-sm text-foreground leading-[1.65] whitespace-nowrap">
                {transcriptionText}
                {liveTranscriptionBlock && isTranscribing && (
                  <span className="inline-block w-[2px] h-[13px] bg-muted-foreground ml-0.5 align-middle animate-pulse" />
                )}
              </p>
            ) : isTranscribing ? (
              <p className="text-xs text-muted-foreground">Listening...</p>
            ) : null}
          </div>

          {/* Answer — takes remaining space and scrolls internally */}
          {visibleAnswer && (
            <div ref={scrollRef} className="min-h-0 overflow-y-auto">
              <div className="flex items-center gap-2.5 py-2.5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                  Answer
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <MarkdownAnswer
                text={visibleAnswer.text}
                active={visibleAnswer.id === activeAnswerId && isAnswering}
              />
            </div>
          )}

          {/* Thinking state */}
          {isAnswering && answerBlocks.length === 0 && (
            <div className="shrink-0">
              <div className="flex items-center gap-2.5 py-2.5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                  Answer
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <p className="text-xs text-muted-foreground">Thinking...</p>
            </div>
          )}

        </div>
      )}
    </div>
    </OpenRouterCredsContext.Provider>
    </CodeInsertModeContext.Provider>
  );
}