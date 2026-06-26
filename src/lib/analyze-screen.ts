import { buildAnalyzeScreenSystemPrompt } from "./analyze-screen-system-prompt";

export interface AnalyzeScreenMemoryPair {
  transcript: string;
  answer: string;
}

const ANALYZE_SCREEN_PROMPT =
  "Analyze this screenshot from a coding interview and answer like the candidate. " +
  "Focus on the visible question, code, error, or prompt on the screen.";

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
] as const;
const GEMINI_STREAM_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";

class GeminiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
  }
}

function buildAnalyzeScreenMemoryText(memory: AnalyzeScreenMemoryPair[]) {
  if (memory.length === 0) {
    return "";
  }

  return memory
    .map(
      (pair, index) =>
        `Memory ${index + 1}\nTranscript:\n${pair.transcript}\n\nAnswer:\n${pair.answer}`
    )
    .join("\n\n---\n\n");
}

function parseDataUrl(value: string) {
  const trimmed = value.trim();
  const match = /^data:([^;]+);base64,(.*)$/s.exec(trimmed);

  if (match) {
    return {
      mimeType: match[1],
      base64Data: match[2],
    };
  }

  return {
    mimeType: "image/png",
    base64Data: trimmed,
  };
}

function base64ToBytes(base64Data: string) {
  if (typeof atob === "function") {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64Data, "base64"));
  }

  throw new Error("This environment cannot decode base64 image data.");
}

function dataUrlToBlob(dataUrl: string) {
  const { mimeType, base64Data } = parseDataUrl(dataUrl);
  const bytes = base64ToBytes(base64Data);
  return new Blob([bytes], { type: mimeType });
}

function extractErrorText(response: Response) {
  return response
    .text()
    .then((text) => {
      const trimmed = text.trim();
      return trimmed || null;
    })
    .catch(() => null);
}

async function createGeminiHttpError(response: Response, fallback: string) {
  const errorText = await extractErrorText(response);
  return new GeminiHttpError(
    response.status,
    errorText ?? fallback
  );
}

function extractInteractionDeltaText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const eventType = (payload as { event_type?: unknown }).event_type;
  if (eventType !== "step.delta") {
    return "";
  }

  const delta = (payload as { delta?: { type?: unknown; text?: unknown } }).delta;
  if (!delta || delta.type !== "text") {
    return "";
  }

  return typeof delta.text === "string" ? delta.text : "";
}

async function readSseStream(
  response: Response,
  onEvent: (eventName: string, data: string) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Gemini did not return a readable stream.");
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

        const lines = eventBlock.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            continue;
          }

          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^\s/, ""));
          }
        }

        if (dataLines.length > 0) {
          onEvent(eventName, dataLines.join("\n"));
        }

        splitIndex = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, "\n");
    const trailing = buffer.trim();
    if (trailing) {
      const lines = trailing.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^\s/, ""));
        }
      }

      if (dataLines.length > 0) {
        onEvent(eventName, dataLines.join("\n"));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function uploadScreenshotForGemini(apiKey: string, screenshotDataUrl: string) {
  const blob = dataUrlToBlob(screenshotDataUrl);
  const startResponse = await fetch(GEMINI_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size),
      "X-Goog-Upload-Header-Content-Type": blob.type || "image/png",
    },
    body: JSON.stringify({
      file: {
        display_name: "dosa-screen.png",
      },
    }),
  });

  if (!startResponse.ok) {
    throw await createGeminiHttpError(
      startResponse,
      `Gemini upload failed with status ${startResponse.status}`
    );
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini upload did not return an upload URL.");
  }

  const finalizeResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: blob,
  });

  if (!finalizeResponse.ok) {
    throw await createGeminiHttpError(
      finalizeResponse,
      `Gemini file finalize failed with status ${finalizeResponse.status}`
    );
  }

  const payload = await finalizeResponse.json().catch(() => null);
  const file = payload && typeof payload === "object" ? (payload as { file?: unknown }).file : null;
  const uri = file && typeof file === "object" ? (file as { uri?: unknown }).uri : null;
  const fileMimeType =
    file && typeof file === "object"
      ? ((file as { mime_type?: unknown }).mime_type as string | undefined)
      : undefined;
  const mimeType = fileMimeType || blob.type || "image/png";

  if (typeof uri !== "string" || !uri) {
    throw new Error("Gemini upload did not return a file URI.");
  }

  return { uri, mimeType };
}

function isRetryableGeminiError(error: unknown) {
  return error instanceof GeminiHttpError && (error.status === 429 || error.status === 503);
}

async function streamGeminiAnalyzeScreenForModel({
  apiKey,
  model,
  jobRole,
  memory,
  screenshotDataUrl,
  signal,
  onTextChunk,
}: {
  apiKey: string;
  model: string;
  jobRole: string;
  memory: AnalyzeScreenMemoryPair[];
  screenshotDataUrl: string;
  signal?: AbortSignal;
  onTextChunk: (chunk: string) => void;
}): Promise<{ text: string }> {
  const uploadedFile = await uploadScreenshotForGemini(apiKey, screenshotDataUrl);
  const memoryText = buildAnalyzeScreenMemoryText(memory);

  const response = await fetch(GEMINI_STREAM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      stream: true,
      system_instruction: buildAnalyzeScreenSystemPrompt({ jobRole }),
      input: [
        ...(memoryText
          ? [
              {
                type: "text",
                text:
                  "Previous interview memory:\n\n" +
                  memoryText +
                  "\n\nUse this context if it helps answer the current screen.",
              },
            ]
          : []),
        {
          type: "text",
          text: ANALYZE_SCREEN_PROMPT,
        },
        {
          type: "image",
          uri: uploadedFile.uri,
          mime_type: uploadedFile.mimeType,
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw await createGeminiHttpError(
      response,
      `Gemini request failed with status ${response.status}`
    );
  }

  let finalText = "";

  await readSseStream(response, (eventName, data) => {
    if (data === "[DONE]") {
      return;
    }

    if (eventName !== "step.delta") {
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }

    const deltaText = extractInteractionDeltaText(payload);
    if (!deltaText) {
      return;
    }

    finalText += deltaText;
    onTextChunk(deltaText);
  });

  const text = finalText.trim();
  if (!text) {
    throw new GeminiHttpError(503, "Gemini returned an empty response.");
  }

  return { text };
}

export async function streamGeminiAnalyzeScreenAnswer({
  apiKey,
  jobRole,
  memory,
  screenshotDataUrl,
  signal,
  onTextChunk,
  onAttemptReset,
}: {
  apiKey: string;
  jobRole: string;
  memory: AnalyzeScreenMemoryPair[];
  screenshotDataUrl: string;
  signal?: AbortSignal;
  onTextChunk: (chunk: string) => void;
  onAttemptReset?: () => void;
}): Promise<{ text: string }> {
  let lastRetryableError: GeminiHttpError | null = null;

  for (let index = 0; index < GEMINI_MODELS.length; index += 1) {
    if (index > 0) {
      onAttemptReset?.();
    }

    const model = GEMINI_MODELS[index];

    try {
      return await streamGeminiAnalyzeScreenForModel({
        apiKey,
        model,
        jobRole,
        memory,
        screenshotDataUrl,
        signal,
        onTextChunk,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (!isRetryableGeminiError(error)) {
        throw error;
      }

      lastRetryableError = error;

      if (index === GEMINI_MODELS.length - 1) {
        onAttemptReset?.();
        throw new Error("All Gemini models are currently busy, please try again in a moment.");
      }
    }
  }

  if (lastRetryableError) {
    throw new Error("All Gemini models are currently busy, please try again in a moment.");
  }

  throw new Error("Gemini returned an empty response.");
}
