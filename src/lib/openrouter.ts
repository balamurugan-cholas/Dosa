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

export type OpenRouterMessageContent = string | Array<OpenRouterTextContentPart | OpenRouterImageContentPart>;

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
  instruction: string;
}

export interface StreamOpenRouterAnswerOptions {
  apiKey: string;
  model: string;
  messages: OpenRouterChatMessage[];
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
  return /\b(this|that|it|the code|the answer|previous|last|above|earlier)\b/.test(value);
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
  /\bself introduction\b/,
  /\babout yourself\b/,
  /\bwho are you\b/,
  /\btell me about yourself\b/,
  /\btell us about yourself\b/,
  /\bwalk me through (?:your )?(?:resume|experience|background)\b/,
  /\bwalk us through (?:your )?(?:resume|experience|background)\b/,
  /\bwhat have you worked on\b/,
  /\bwhere have you worked\b/,
  /\bwhat companies have you worked at\b/,
  /\bwhat is your greatest achievement\b/,
  /\bwhy should we hire you\b/,
];

function buildIntentInstruction(kind: AnswerIntentKind, transcript: string) {
  if (kind === "follow_up_explain_previous") {
    return (
      "The user is asking for an explanation of the most recent answer or code. " +
      "Explain the previous answer directly, in plain language, and do not invent a fresh unrelated example unless the user asks for one.\n\n" +
      `User request:\n${transcript}`
    );
  }

  if (kind === "follow_up_refine_previous") {
    return (
      "The user is asking to revise the most recent answer or code. " +
      "Apply the requested change to the previous answer instead of generating a new unrelated example.\n\n" +
      `User request:\n${transcript}`
    );
  }

  if (kind === "follow_up_continue_previous") {
    return (
      "The user is asking to continue from the most recent answer. " +
      "Resume from the previous response and complete the thought.\n\n" +
      `User request:\n${transcript}`
    );
  }

  return `Treat the following as a new interview question and answer it directly:\n${transcript}`;
}

export function detectAnswerIntent(
  transcript: string,
  memory: OpenRouterMemoryPair[]
): AnswerIntent {
  const normalized = normalizeIntentText(transcript);
  const hasMemory = memory.length > 0;

  if (!hasMemory || !normalized) {
    return {
      kind: "new_question",
      isFollowUp: false,
      instruction: buildIntentInstruction("new_question", transcript),
    };
  }

  const explainRequested = matchesAnyPattern(normalized, EXPLAIN_PATTERNS);
  const refineRequested = matchesAnyPattern(normalized, REFINEMENT_PATTERNS);
  const continueRequested = matchesAnyPattern(normalized, CONTINUE_PATTERNS);
  const referencesPriorContext =
    referencesPreviousTurn(normalized) || /\b(code|answer|previous|last)\b/.test(normalized);

  if (explainRequested && referencesPriorContext) {
    return {
      kind: "follow_up_explain_previous",
      isFollowUp: true,
      instruction: buildIntentInstruction("follow_up_explain_previous", transcript),
    };
  }

  if (refineRequested && referencesPriorContext) {
    return {
      kind: "follow_up_refine_previous",
      isFollowUp: true,
      instruction: buildIntentInstruction("follow_up_refine_previous", transcript),
    };
  }

  if (continueRequested && referencesPriorContext) {
    return {
      kind: "follow_up_continue_previous",
      isFollowUp: true,
      instruction: buildIntentInstruction("follow_up_continue_previous", transcript),
    };
  }

  return {
    kind: "new_question",
    isFollowUp: false,
    instruction: buildIntentInstruction("new_question", transcript),
  };
}

export function detectResumeRelevance(transcript: string) {
  const normalized = normalizeIntentText(transcript);

  if (!normalized) {
    return false;
  }

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
      content: buildOpenRouterSystemPrompt({
        jobRole,
        intent,
        resume,
        resumeRelevant,
      }),
    },
  ];

  for (const pair of memory) {
    messages.push({
      role: "user",
      content: `Transcript:\n${pair.transcript}`,
    });
    messages.push({
      role: "assistant",
      content: pair.answer,
    });
  }

  if (resumeRelevant && resume?.text.trim()) {
    messages.push({
      role: "user",
      content:
        "Candidate resume (factual source). Use only facts from this resume when answering resume-related questions:\n\n" +
        resume.text.trim(),
    });
  }

  messages.push({
    role: "user",
    content: intent.instruction,
  });

  return messages;
}

function extractEventData(eventBlock: string) {
  const lines = eventBlock.split(/\r?\n/);
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    dataLines.push(line.slice(5).replace(/^\s/, ""));
  }

  return dataLines.length > 0 ? dataLines.join("\n") : null;
}

function extractDeltaText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const maybeChoices = (payload as { choices?: Array<Record<string, unknown>> }).choices;
  if (!Array.isArray(maybeChoices) || maybeChoices.length === 0) {
    return "";
  }

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
  if (!reader) {
    throw new Error("OpenRouter did not return a readable stream.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex >= 0) {
        const eventBlock = buffer.slice(0, splitIndex);
        buffer = buffer.slice(splitIndex + 2);
        const data = extractEventData(eventBlock);
        if (data) {
          onData(data);
        }
        splitIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    const trailing = buffer.trim();
    if (trailing) {
      const data = extractEventData(trailing);
      if (data) {
        onData(data);
      }
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
      temperature: 0.2,
      messages,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      await createErrorMessage(response, `OpenRouter request failed with status ${response.status}`)
    );
  }

  let finalText = "";

  await readSseStream(response, (data) => {
    if (data === "[DONE]") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    const deltaText = extractDeltaText(payload);
    if (!deltaText) {
      return;
    }

    finalText += deltaText;
    onTextChunk(deltaText);
  });

  return { text: finalText };
}
