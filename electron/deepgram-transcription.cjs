const { EventEmitter } = require("events");
const WebSocket = require("ws");

const PROVIDER = "deepgram";
const SAMPLE_RATE = 16000;
const AUDIO_LEVEL_INTERVAL_MS = 250;
const KEEPALIVE_INTERVAL_MS = 8000;

function createIdleState() {
  return {
    status: "idle",
    sessionId: null,
    provider: null,
    message: null,
    error: null,
  };
}

function getKeytermsForRole(jobRole = "") {
  const common = ["API", "REST", "GraphQL", "Docker", "Kubernetes", "CI/CD", "microservices"];
  const role = jobRole.toLowerCase();

  if (role.includes("software") || role.includes("engineer") || role.includes("developer")) {
    return [...common, "React", "TypeScript", "Node.js", "PostgreSQL", "Redis", "AWS", "Git"];
  }
  if (role.includes("data")) {
    return [...common, "Python", "pandas", "NumPy", "TensorFlow", "PyTorch", "SQL", "ETL"];
  }
  if (role.includes("devops") || role.includes("platform")) {
    return [...common, "Terraform", "Ansible", "Prometheus", "Grafana", "Helm", "Jenkins"];
  }
  if (role.includes("frontend") || role.includes("front-end") || role.includes("ui")) {
    return [...common, "React", "Vue", "CSS", "Tailwind", "Webpack", "Vite", "TypeScript"];
  }
  if (role.includes("backend") || role.includes("back-end")) {
    return [...common, "Node.js", "PostgreSQL", "MongoDB", "Redis", "Express", "Prisma", "AWS"];
  }
  if (role.includes("mobile") || role.includes("ios") || role.includes("android")) {
    return [...common, "React Native", "Swift", "Kotlin", "Xcode", "Android Studio", "Firebase"];
  }
  if (role.includes("machine learning") || role.includes("ml") || role.includes("ai")) {
    return [...common, "Python", "TensorFlow", "PyTorch", "scikit-learn", "LLM", "fine-tuning", "embeddings"];
  }

  return common;
}

function createDeepgramUrl(options = {}) {
  const params = new URLSearchParams({
    model: "nova-3",
    language: "en-US",
    encoding: "linear16",
    sample_rate: String(SAMPLE_RATE),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    endpointing: "300",
    utterance_end_ms: "1500",
    filler_words: "false",
    profanity_filter: "false",
    diarize: "false",
    numerals: "true",
    no_delay: "true",
  });

  const keyterms = getKeytermsForRole(options.jobRole);
  for (const term of keyterms) {
    params.append("keyterm", term);
  }

  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function normalizeApiKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWord(word) {
  const text = word?.punctuated_word || word?.word || "";
  if (!text) {
    return null;
  }

  return {
    word: text,
    start: typeof word.start === "number" ? word.start : undefined,
    end: typeof word.end === "number" ? word.end : undefined,
    confidence: typeof word.confidence === "number" ? word.confidence : undefined,
  };
}

function calculateRms(buffer) {
  if (!buffer || buffer.byteLength < 2) {
    return 0;
  }

  let sum = 0;
  const samples = Math.floor(buffer.byteLength / 2);

  for (let offset = 0; offset < samples * 2; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples);
}

class AudioTranscriptionManager extends EventEmitter {
  constructor() {
    super();
    this.state = createIdleState();
    this.currentSessionId = 0;
    this.socket = null;
    this.keepAliveTimer = null;
    this.lastAudioAt = 0;
    this.lastAudioLevelAt = 0;
  }

  getState() {
    return { ...this.state };
  }

  async start(options = {}) {
    if (this.state.status === "running" || this.state.status === "starting") {
      return this.getState();
    }

    const apiKey = normalizeApiKey(options.apiKey) || normalizeApiKey(process.env.DEEPGRAM_API_KEY);
    const sessionId = ++this.currentSessionId;

    if (!apiKey) {
      this.state = {
        status: "error",
        sessionId,
        provider: PROVIDER,
        message: "Deepgram API key is missing",
        error: "Add a Deepgram API key in settings before listening.",
      };
      this.emit("update", { type: "error", ...this.state });
      return this.getState();
    }

    await this.stop({ silent: true });

    this.state = {
      status: "starting",
      sessionId,
      provider: PROVIDER,
      message: "Connecting to Deepgram...",
      error: null,
    };
    this.emit("update", { type: "status", ...this.state });

    const socket = new WebSocket(createDeepgramUrl({ jobRole: options.jobRole }), {
      headers: {
        Authorization: `Token ${apiKey}`,
      },
    });

    this.socket = socket;

    socket.on("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.state = {
        status: "running",
        sessionId,
        provider: PROVIDER,
        message: "Listening...",
        error: null,
      };
      this.emit("update", { type: "status", ...this.state });
      this.#startKeepAlive();
    });

    socket.on("message", (data) => {
      if (this.socket !== socket) {
        return;
      }

      this.#handleMessage(data);
    });

    socket.on("error", (error) => {
      if (this.socket !== socket) {
        return;
      }

      this.#setError(error?.message || String(error));
    });

    socket.on("close", () => {
      if (this.socket !== socket) {
        return;
      }

      this.socket = null;
      this.#clearKeepAlive();

      if (this.state.status !== "stopping" && this.state.status !== "error") {
        this.state = createIdleState();
        this.emit("update", {
          type: "stopped",
          sessionId,
          provider: PROVIDER,
          status: "idle",
          message: "Stopped",
          error: null,
        });
      }
    });

    return this.getState();
  }

  receiveAudio(chunk) {
    if (!chunk || this.state.status !== "running" || !this.socket) {
      return;
    }

    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.byteLength === 0) {
      return;
    }

    this.socket.send(buffer);
    this.lastAudioAt = Date.now();

    if (this.lastAudioAt - this.lastAudioLevelAt >= AUDIO_LEVEL_INTERVAL_MS) {
      this.lastAudioLevelAt = this.lastAudioAt;
      this.emit("update", {
        type: "audio_level",
        sessionId: this.state.sessionId,
        provider: PROVIDER,
        rms: calculateRms(buffer),
      });
    }
  }

  async captureError(message) {
    this.#setError(message || "System audio capture failed");
    await this.stop({ silent: true });
    return this.getState();
  }

  async stop(options = {}) {
    const socket = this.socket;
    const sessionId = this.state.sessionId;

    this.#clearKeepAlive();

    if (!socket) {
      this.state = createIdleState();

      if (!options.silent) {
        this.emit("update", {
          type: "stopped",
          sessionId,
          provider: PROVIDER,
          status: "idle",
          message: "Stopped",
          error: null,
        });
      }

      return this.getState();
    }

    this.state = {
      status: "stopping",
      sessionId,
      provider: PROVIDER,
      message: "Stopping...",
      error: null,
    };

    if (!options.silent) {
      this.emit("update", { type: "status", ...this.state });
    }

    this.socket = null;

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: "CloseStream" }));
      } catch {
        // The socket may already be closing; close() below is enough.
      }
    }

    try {
      socket.close();
    } catch {
      // Ignore close races.
    }

    this.state = createIdleState();

    if (!options.silent) {
      this.emit("update", {
        type: "stopped",
        sessionId,
        provider: PROVIDER,
        status: "idle",
        message: "Stopped",
        error: null,
      });
    }

    return this.getState();
  }

  #handleMessage(data) {
    let payload;

    try {
      payload = JSON.parse(String(data));
    } catch (error) {
      console.warn("[audio] failed to parse Deepgram message:", error);
      return;
    }

    if (payload.type === "Error") {
      this.#setError(payload.description || payload.message || "Deepgram transcription failed");
      return;
    }

    if (payload.type !== "Results") {
      return;
    }

    const alternative = payload.channel?.alternatives?.[0];
    const words = Array.isArray(alternative?.words)
      ? alternative.words.map(normalizeWord).filter(Boolean)
      : [];
    const wordText = words.map((word) => word.word).join(" ").trim();
    const fallbackText = typeof alternative?.transcript === "string" ? alternative.transcript.trim() : "";
    const text = wordText || fallbackText;

    if (!text) {
      return;
    }

    const start = typeof payload.start === "number" ? payload.start : undefined;
    const duration = typeof payload.duration === "number" ? payload.duration : undefined;

    this.emit("update", {
      type: "transcript",
      sessionId: this.state.sessionId,
      provider: PROVIDER,
      text,
      start,
      end: start != null && duration != null ? start + duration : undefined,
      isFinal: Boolean(payload.is_final || payload.speech_final),
      words,
    });
  }

  #setError(message) {
    const sessionId = this.state.sessionId;

    this.state = {
      status: "error",
      sessionId,
      provider: PROVIDER,
      message,
      error: message,
    };

    this.emit("update", { type: "error", ...this.state });
  }

  #startKeepAlive() {
    this.#clearKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const idleMs = Date.now() - this.lastAudioAt;
      if (idleMs >= KEEPALIVE_INTERVAL_MS / 2) {
        this.socket.send(JSON.stringify({ type: "KeepAlive" }));
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  #clearKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

module.exports = {
  AudioTranscriptionManager,
};