import { useEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ContentBlock } from "../lib/types";

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

  try {
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return {
        html: hljs.highlight(code, {
          language: normalizedLanguage,
          ignoreIllegals: true,
        }).value,
        language: normalizedLanguage,
      };
    }

    const auto = hljs.highlightAuto(code);
    return {
      html: auto.value,
      language: auto.language || normalizedLanguage || "plaintext",
    };
  } catch {
    return {
      html: escapeHtml(code),
      language: normalizedLanguage || "plaintext",
    };
  }
}

function getCodeLanguage(className?: string) {
  const match = className?.match(/language-([\w.+#-]+)/i);
  return match?.[1]?.toLowerCase() || "plaintext";
}

const markdownComponents: Components = {
  p({ children }) {
    return (
      <p className="text-sm leading-7 text-foreground break-words whitespace-normal">
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
    return <li className="text-sm leading-7 text-foreground break-words">{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-border pl-3 text-sm leading-7 text-muted-foreground">
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
    if (inline) {
      return (
        <code className="rounded border border-border bg-secondary px-1 py-0.5 font-mono text-[0.95em] text-foreground">
          {children}
        </code>
      );
    }

    const language = getCodeLanguage(className);
    const rawCode = String(children).replace(/\n$/, "");
    const highlighted = highlightCode(rawCode, language);

    return (
      <div className="overflow-hidden rounded border border-border bg-[#101010]">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {highlighted.language}
          </span>
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
              {node.open && active && (
                <span className="text-[9px] text-muted-foreground">streaming</span>
              )}
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
}

export function ContentArea({
  blocks,
  isTranscribing,
  isAnswering,
  activeTranscriptionId,
  activeAnswerId,
  scrollToBottomSignal,
}: Props) {
  const isEmpty = blocks.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({
      top: node.scrollHeight,
      behavior: "smooth",
    });
  }, [scrollToBottomSignal]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
      {isEmpty ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isTranscribing ? "Listening..." : "Listening for speech..."}
        </p>
      ) : (
        <div className="space-y-px">
          {blocks.map((block, idx) => {
            if (block.kind === "transcription") {
              const hasText = block.text.trim().length > 0;

              return (
                <div key={block.id} className={idx > 0 ? "pt-3" : ""}>
                  {hasText ? (
                    <p className="text-sm text-foreground leading-[1.65] whitespace-pre-wrap break-words">
                      {block.text}
                      {block.id === activeTranscriptionId && isTranscribing && (
                        <span className="inline-block w-[2px] h-[13px] bg-muted-foreground ml-0.5 align-middle animate-pulse" />
                      )}
                    </p>
                  ) : null}
                  {block.id === activeTranscriptionId &&
                    isTranscribing &&
                    !hasText && (
                      <p className="text-xs text-muted-foreground">Listening...</p>
                    )}
                </div>
              );
            }

            return (
              <div key={block.id}>
                <div className="flex items-center gap-2.5 py-2.5">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                    Answer
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <MarkdownAnswer
                  text={block.text}
                  active={block.id === activeAnswerId && isAnswering}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
