import { buildOpenRouterSystemPrompt } from "./openrouter-system-prompt";
import type { ResumeRecord } from "./types";

export interface OpenRouterMemoryPair {
  transcript: string;
  answer: string;
}

export type OpenRouterTextContentPart = {
  type: "text";
  text: string;
};

export type OpenRouterImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

export type OpenRouterMessageContent =
  | string
  | Array<OpenRouterTextContentPart | OpenRouterImageContentPart>;

export interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: OpenRouterMessageContent;
}

export type AnswerIntentKind =
  | "new_question"
  | "follow_up_explain_previous"
  | "follow_up_refine_previous"
  | "follow_up_continue_previous";

export interface AnswerIntent {
  kind: AnswerIntentKind;
  isFollowUp: boolean;
  // Raw transcript only — no meta-instruction wrapping.
  // The system prompt already tells the model how to handle each intent kind.
  transcript: string;
}

export interface StreamOpenRouterAnswerOptions {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onTextChunk: (chunk: string) => void;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TITLE = "Dosa";

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function resolveOpenRouterModel(model: string) {
  const trimmed = model.trim();
  return trimmed || "openrouter/free";
}

function normalizeIntentText(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\w\s'#+.-]/g, " ");
}

function matchesAnyPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function referencesPreviousTurn(value: string) {
  return /\b(this|that|it|the code|the answer|previous|last|above|earlier)\b/.test(
    value
  );
}

const EXPLAIN_PATTERNS = [
  /\bexplain\b/,
  /\bwhat does\b/,
  /\bhow does\b/,
  /\bbreak (?:this|that|it|the code|the answer)\b/,
  /\bwalk(?: me)? through\b/,
  /\bsummar(?:ize|ise)\b/,
  /\bin simple terms\b/,
  /\bwhat is this\b/,
  /\bwhat's this\b/,
  /\bwhat does it mean\b/,
];

const REFINEMENT_PATTERNS = [
  /\brewrite\b/,
  /\bshorten\b/,
  /\bmake (?:it|this|that|the answer) shorter\b/,
  /\bmore concise\b/,
  /\brefactor\b/,
  /\bconvert\b/,
  /\bchange (?:it|this|that) to\b/,
  /\bfix\b/,
  /\bimprove\b/,
  /\brephrase\b/,
];

const CONTINUE_PATTERNS = [
  /\bcontinue\b/,
  /\bkeep going\b/,
  /\bgo on\b/,
  /\bmore detail\b/,
  /\belaborate\b/,
  /\bexpand\b/,
  /\bfinish\b/,
  /\bcomplete\b/,
];

const RESUME_PATTERNS = [
  /\bresume\b/,
  /\bcv\b/,
  /\bwork experience\b/,
  /\bwork history\b/,
  /\bbackground\b/,
  /\bprojects?\b/,
  /\beducation\b/,
  /\bskills?\b/,
  /\bexperience\b/,
  /\bintroduce yourself\b/,
  /\bintroduce me\b/,
  /\bself[- ]?introduction\b/,
  /\bshort introduction\b/,
  /\bbrief introduction\b/,
  /\bintroduction of yourself\b/,
  /\byour introduction\b/,
  /\bcan you introduce\b/,
  /\bplease introduce\b/,
  /\bshare.*introduction\b/,
  /\bgive.*introduction\b/,
  /\babout yourself\b/,
  /\babout you\b/,
  /\bwho are you\b/,
  /\btell me about yourself\b/,
  /\btell us about yourself\b/,
  /\btell me about you\b/,
  /\btell us about you\b/,
  /\bwalk me through (?:your )?(?:resume|experience|background)\b/,
  /\bwalk us through (?:your )?(?:resume|experience|background)\b/,
  /\bwhat have you worked on\b/,
  /\bwhere have you worked\b/,
  /\bwhat companies have you worked at\b/,
  /\bwhat is your greatest achievement\b/,
  /\bwhy should we hire you\b/,
  /\bqualifications\b/,
  /\bstrengths\b/,
  /\bachievements?\b/,
];

export function detectAnswerIntent(
  transcript: string,
  memory: OpenRouterMemoryPair[]
): AnswerIntent {
  const normalized = normalizeIntentText(transcript);
  const hasMemory = memory.length > 0;

  if (!hasMemory || !normalized) {
    return { kind: "new_question", isFollowUp: false, transcript };
  }

  const explainRequested = matchesAnyPattern(normalized, EXPLAIN_PATTERNS);
  const refineRequested = matchesAnyPattern(normalized, REFINEMENT_PATTERNS);
  const continueRequested = matchesAnyPattern(normalized, CONTINUE_PATTERNS);
  const referencesPriorContext =
    referencesPreviousTurn(normalized) ||
    /\b(code|answer|previous|last)\b/.test(normalized);

  if (explainRequested && referencesPriorContext) {
    return { kind: "follow_up_explain_previous", isFollowUp: true, transcript };
  }

  if (refineRequested && referencesPriorContext) {
    return { kind: "follow_up_refine_previous", isFollowUp: true, transcript };
  }

  if (continueRequested && referencesPriorContext) {
    return { kind: "follow_up_continue_previous", isFollowUp: true, transcript };
  }

  return { kind: "new_question", isFollowUp: false, transcript };
}

export function detectResumeRelevance(transcript: string) {
  const normalized = normalizeIntentText(transcript);
  if (!normalized) return false;
  return matchesAnyPattern(normalized, RESUME_PATTERNS);
}

export function buildOpenRouterMessages({
  transcript,
  memory,
  jobRole,
  intent,
  resume,
  resumeRelevant,
}: {
  transcript: string;
  memory: OpenRouterMemoryPair[];
  jobRole: string;
  intent: AnswerIntent;
  resume: ResumeRecord | null;
  resumeRelevant: boolean;
}): OpenRouterChatMessage[] {
  const messages: OpenRouterChatMessage[] = [
    {
      role: "system",
      // FIX 2: pass transcript + latestQuestion so the system prompt can
      // detect question kind and interviewer type correctly
      content: buildOpenRouterSystemPrompt({
        jobRole,
        intent,
        resume,
        resumeRelevant,
        transcript: memory.map((p) => p.transcript).join("\n"),
        latestQuestion: transcript,
      }),
    },
  ];

  // Inject memory pairs as prior conversation turns
  for (const pair of memory) {
    messages.push({ role: "user", content: pair.transcript });
    messages.push({ role: "assistant", content: pair.answer });
  }

  // FIX 3: resume is already in the system prompt when resumeRelevant — don't
  // send it again as a user message. That caused the model to get two
  // conflicting sources and wasted tokens on every resume-related question.

  // FIX 4: send the raw transcript only — no meta-instruction wrapper.
  // The system prompt already tells the model exactly how to handle each
  // intent kind. Wrapping it in "Treat the following as a new interview
  // question..." nudged the model back into assistant-brain right before
  // answering.
  messages.push({ role: "user", content: transcript });

  return messages;
}

function extractEventData(eventBlock: string) {
  const lines = eventBlock.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    dataLines.push(line.slice(5).replace(/^\s/, ""));
  }

  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function extractDeltaText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";

  const maybeChoices = (
    payload as { choices?: Array<Record<string, unknown>> }
  ).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) return "";

  const firstChoice = maybeChoices[0];
  const delta = firstChoice?.delta as { content?: unknown } | undefined;
  const message = firstChoice?.message as { content?: unknown } | undefined;
  const content = delta?.content ?? message?.content;

  return typeof content === "string" ? content : "";
}

async function readSseStream(
  response: Response,
  onData: (data: string) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenRouter did not return a readable stream.");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex >= 0) {
        const eventBlock = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        const data = extractEventData(eventBlock);
        if (data) onData(data);
        splitIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    const trailing = buffer.trim();
    if (trailing) {
      const data = extractEventData(trailing);
      if (data) onData(data);
    }
  } finally {
    reader.releaseLock();
  }
}

function createErrorMessage(response: Response, fallback: string) {
  return response
    .text()
    .then((text) => {
      const trimmed = text.trim();
      return trimmed ? `${fallback}: ${trimmed}` : fallback;
    })
    .catch(() => fallback);
}

export async function streamOpenRouterAnswer({
  apiKey,
  model,
  messages,
  maxTokens,
  signal,
  onTextChunk,
}: StreamOpenRouterAnswerOptions): Promise<{ text: string }> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Title": OPENROUTER_TITLE,
    },
    body: JSON.stringify({
      model,
      stream: true,
      // 0.7 gives natural variation in word choice and sentence rhythm
      // without hallucinating. 0.8 is the ceiling for interview answers
      // where factual accuracy still matters.
      temperature: 0.7,
      max_tokens: maxTokens,
      messages,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      await createErrorMessage(
        response,
        `OpenRouter request failed with status ${response.status}`
      )
    );
  }

  let finalText = "";

  await readSseStream(response, (data) => {
    if (data === "[DONE]") return;

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    const deltaText = extractDeltaText(payload);
    if (!deltaText) return;

    finalText += deltaText;
    onTextChunk(deltaText);
  });

  return { text: finalText };
}