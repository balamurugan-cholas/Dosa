import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Topbar } from "../components/Topbar";
import { MainView } from "../components/MainView";
import { CaptureStatusModal } from "../components/CaptureStatusModal";
import { SettingsView } from "../components/SettingsView";
import { UpdateView } from "../components/UpdateView";
import type {
  AudioTranscriptionUpdate,
  AudioTranscriptionWord,
  ContentBlock,
  SettingsState,
  WindowSnapPosition,
  View,
  UpdateInfo,
  UpdateDownloadProgress,
} from "../lib/types";
import {
  closeAppWindow,
  captureScreenImage,
  resizeAppWindow,
  setAppClickThrough,
  subscribeToAppShortcuts,
  subscribeToWindowSnapPosition,
} from "../lib/window-controls";
import {
  buildOpenRouterMessages,
  detectAnswerIntent,
  detectResumeRelevance,
  normalizeWhitespace,
  resolveOpenRouterModel,
  streamOpenRouterAnswer,
  type OpenRouterMemoryPair,
} from "../lib/openrouter";
import {
  detectQuestionKind,
  transcriptHasPriorCode,
  getMaxTokensForKind,
} from "../lib/openrouter-system-prompt";
import { streamGeminiAnalyzeScreenAnswer } from "../lib/analyze-screen";
import { deleteStoredResume, loadStoredResume, uploadStoredResume } from "../lib/resume";
import {
  startAudioTranscription,
  stopAudioTranscription,
  subscribeToAudioTranscriptionUpdates,
} from "../lib/audio-transcription-deepgram";
import type { ResumeRecord } from "../lib/types";

const DEFAULT_SETTINGS: SettingsState = {
  deepgramApiKey:
    typeof window === "undefined" ? "" : window.localStorage.getItem("dosa.deepgramApiKey") ?? "",
  openrouterApiKey:
    typeof window === "undefined" ? "" : window.localStorage.getItem("dosa.openrouterApiKey") ?? "",
  openrouterModel:
    typeof window === "undefined" ? "openrouter/free" : window.localStorage.getItem("dosa.openrouterModel") ?? "openrouter/free",
  geminiApiKey:
    typeof window === "undefined"
      ? ""
      : window.localStorage.getItem("dosa.geminiApiKey") ?? "",
  transparency: 100,
  appWidth:
    typeof window === "undefined"
      ? 980
      : Math.min(
          1000,
          Math.max(760, Number(window.localStorage.getItem("dosa.appWidth") ?? "980") || 980)
        ),
  jobRole: "Software Engineer",
  answerMemory: 5,
  resumeUploaded: false,
  resumeFileName: "",
  codeInsertMode:
    typeof window === "undefined"
      ? "instant"
      : (window.localStorage.getItem("dosa.codeInsertMode") as "instant" | "natural") ?? "instant",
};

export default function App() {
  const [view, setView] = useState<View>("main");
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [activeTranscriptionId, setActiveTranscriptionId] = useState<number | null>(null);
  const [activeAnswerId, setActiveAnswerId] = useState<number | null>(null);
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [windowSnapPosition, setWindowSnapPosition] = useState<WindowSnapPosition>("center");
  const [scrollToBottomSignal, setScrollToBottomSignal] = useState(0);
  const [answerIndex, setAnswerIndex] = useState(0);
  const [autoAnswer, setAutoAnswer] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<UpdateDownloadProgress | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const autoAnswerRef = useRef(false);
  const autoAnswerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAnswerRetryCount = useRef(0);
  const MAX_AUTO_ANSWER_RETRIES = 10;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedHeight = useRef<number | null>(null);
  const lastClickThrough = useRef<boolean | null>(null);
  const currentAudioSessionId = useRef<number | null>(null);
  const liveTranscriptBlockId = useRef<number | null>(null);
  const committedTranscriptText = useRef("");
  const transcriptResetBoundary = useRef("");
  const transcriptBoundaryEnd = useRef<number | null>(null);
  const latestTranscriptEnd = useRef<number | null>(null);
  const answerAbortController = useRef<AbortController | null>(null);
  const answerRawText = useRef("");
  const answerMemory = useRef<OpenRouterMemoryPair[]>([]);
  const resumeRecord = useRef<ResumeRecord | null>(null);
  const shortcutHandlersRef = useRef({
    listen: async () => {},
    answer: () => {},
    analyze: async () => {},
    clear: () => {},
  });

  const idCounter = useRef(0);
  const answerRunId = useRef(0);
  const availableScreenHeight =
    typeof window === "undefined" ? 0 : window.screen.availHeight || window.innerHeight;
  const maxShellHeight = Math.max(120, availableScreenHeight - 48);
  const maxWindowHeight = Math.max(120, availableScreenHeight);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node || maxWindowHeight === 0) return;

    const nextHeight = Math.min(Math.ceil(node.getBoundingClientRect().height), maxWindowHeight);
    if (nextHeight <= 0 || lastRequestedHeight.current === nextHeight) return;

    lastRequestedHeight.current = nextHeight;
    resizeAppWindow(nextHeight);
  }, [view, blocks, isTranscribing, isAnswering, settings, maxWindowHeight, answerIndex]);

  function nextId() {
    return ++idCounter.current;
  }

  function getTranscriptDisplayText(currentSegment: string) {
    return normalizeWhitespace(
      [committedTranscriptText.current, currentSegment].filter(Boolean).join(" ")
    );
  }

  function normalizeTranscriptToken(value: string) {
    return value
      .toLowerCase()
      .replace(/^[^a-z0-9'#+.-]+|[^a-z0-9'#+.-]+$/gi, "");
  }

  function normalizeTranscriptWord(word: AudioTranscriptionWord) {
    return normalizeTranscriptToken(word.word || "");
  }

  function stripTranscriptResetBoundary(text: string) {
    const boundary = normalizeWhitespace(transcriptResetBoundary.current);
    const normalizedText = normalizeWhitespace(text);

    if (!boundary || !normalizedText) return normalizedText;

    const boundaryTokens = boundary.split(" ").map(normalizeTranscriptToken).filter(Boolean);
    const textTokens = normalizedText.split(" ").filter(Boolean);

    if (boundaryTokens.length === 0 || textTokens.length === 0) return normalizedText;
    if (textTokens.length < boundaryTokens.length) return normalizedText;

    for (let index = 0; index < boundaryTokens.length; index += 1) {
      if (normalizeTranscriptToken(textTokens[index]) !== boundaryTokens[index]) {
        return normalizedText;
      }
    }

    return normalizeWhitespace(textTokens.slice(boundaryTokens.length).join(" "));
  }

  function getTranscriptTextFromEvent(event: Extract<AudioTranscriptionUpdate, { type: "transcript" }>) {
    const boundaryEnd = transcriptBoundaryEnd.current;

    if (boundaryEnd == null) return normalizeWhitespace(event.text);

    const epsilon = 0.05;
    const words = Array.isArray(event.words) ? event.words : [];

    if (words.length > 0) {
      const filteredWords = words.filter((word) => {
        const wordEnd = typeof word.end === "number" ? word.end
          : typeof word.start === "number" ? word.start
            : null;
        return wordEnd != null && wordEnd > boundaryEnd + epsilon;
      });

      if (filteredWords.length === 0) return "";

      return normalizeWhitespace(
        filteredWords.map((word) => normalizeTranscriptWord(word)).filter(Boolean).join(" ")
      );
    }

    const eventEnd = typeof event.end === "number" ? event.end : null;
    if (eventEnd != null && eventEnd <= boundaryEnd + epsilon) return "";

    return "";
  }

  function getTranscriptSnapshot() {
    for (let index = blocks.length - 1; index >= 0; index -= 1) {
      const block = blocks[index];
      if (block.kind === "transcription" && block.text.trim().length > 0) {
        return normalizeWhitespace(block.text);
      }
    }
    return "";
  }

  function getLatestTranscriptQuestion(transcript: string) {
    const cleaned = String(transcript || "").replace(/\r\n/g, "\n").trim();
    if (!cleaned) return "";

    const paragraphs = cleaned.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const latestParagraph = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : cleaned;
    const sentences = latestParagraph.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);

    return normalizeWhitespace(sentences.length > 0 ? sentences[sentences.length - 1] : latestParagraph);
  }

  function stopActiveAnswerStream() {
    answerRunId.current += 1;
    answerAbortController.current?.abort();
    answerAbortController.current = null;
    answerRawText.current = "";
    if (autoAnswerTimer.current) {
      clearTimeout(autoAnswerTimer.current);
      autoAnswerTimer.current = null;
    }
  }

  function finishAnswerSession(transcript: string, answer: string) {
    const maxMemory = Math.max(0, settings.answerMemory);
    const nextMemory = [...answerMemory.current, { transcript, answer }];
    answerMemory.current = maxMemory > 0 ? nextMemory.slice(-maxMemory) : [];
  }

  function applyResumeRecord(record: ResumeRecord | null) {
    resumeRecord.current = record;
    setSettings((prev) => ({
      ...prev,
      resumeUploaded: Boolean(record),
      resumeFileName: record?.fileName ?? "",
    }));
  }

  function handleTranscriptUpdate(event: AudioTranscriptionUpdate) {
    if (event.type !== "transcript") return false;

    const eventEnd =
      typeof event.end === "number"
        ? event.end
        : Array.isArray(event.words) && event.words.length > 0
          ? event.words[event.words.length - 1]?.end ?? null
          : null;

    if (eventEnd != null) {
      latestTranscriptEnd.current =
        latestTranscriptEnd.current == null
          ? eventEnd
          : Math.max(latestTranscriptEnd.current, eventEnd);
    }

    const text = getTranscriptTextFromEvent(event);
    if (!text) return true;

    let existingId = liveTranscriptBlockId.current;

    if (existingId == null) {
      const id = nextId();
      existingId = id;
      liveTranscriptBlockId.current = id;
      setActiveTranscriptionId(id);
      setBlocks((prev) => [...prev, { kind: "transcription", id, text: "" }]);
    }

    const nextText = getTranscriptDisplayText(text);

    if (event.isFinal) {
      committedTranscriptText.current = nextText;

      if (autoAnswerRef.current) {
        if (autoAnswerTimer.current) clearTimeout(autoAnswerTimer.current);
        autoAnswerTimer.current = setTimeout(() => {
          autoAnswerTimer.current = null;
          shortcutHandlersRef.current.answer();
        }, 2000);
      }
    }

    setBlocks((prev) =>
      prev.map((block) =>
        block.kind === "transcription" && block.id === existingId
          ? { ...block, text: nextText }
          : block
      )
    );

    setActiveTranscriptionId(existingId);
    setIsTranscribing(true);
    return true;
  }

  useEffect(() => {
    const unsubscribe = subscribeToAudioTranscriptionUpdates((event) => {
      if (event.sessionId != null && currentAudioSessionId.current !== event.sessionId) return;

      if (handleTranscriptUpdate(event)) return;

      if (event.type === "status") {
        if (event.status === "running" || event.status === "starting") {
          setIsTranscribing(true);
        }

        if (event.status === "error") {
          setIsTranscribing(false);
          setActiveTranscriptionId(null);
          liveTranscriptBlockId.current = null;
          committedTranscriptText.current = "";
          transcriptResetBoundary.current = "";
          transcriptBoundaryEnd.current = null;
          latestTranscriptEnd.current = null;
          currentAudioSessionId.current = null;
          setCaptureError(event.error || event.message || "Listening failed for an unknown reason.");
        }

        return;
      }

      if (event.type === "error") {
        setIsTranscribing(false);
        setActiveTranscriptionId(null);
        liveTranscriptBlockId.current = null;
        committedTranscriptText.current = "";
        transcriptResetBoundary.current = "";
        transcriptBoundaryEnd.current = null;
        latestTranscriptEnd.current = null;
        currentAudioSessionId.current = null;
        setCaptureError(event.error || event.message || "Listening failed for an unknown reason.");
        return;
      }

      if (event.type === "stopped") {
        setIsTranscribing(false);
        setActiveTranscriptionId(null);
        liveTranscriptBlockId.current = null;
        committedTranscriptText.current = "";
        transcriptResetBoundary.current = "";
        transcriptBoundaryEnd.current = null;
        latestTranscriptEnd.current = null;
        currentAudioSessionId.current = null;
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const updateClickThrough = (enabled: boolean) => {
      if (lastClickThrough.current === enabled) return;
      lastClickThrough.current = enabled;
      setAppClickThrough(enabled);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (captureError) { updateClickThrough(false); return; }
      const shell = shellRef.current;
      if (!shell) { updateClickThrough(true); return; }
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const isInsideShell = !!target && shell.contains(target);
      updateClickThrough(!isInsideShell);
    };

    const handleBlur = () => updateClickThrough(true);

    updateClickThrough(true);
    document.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("blur", handleBlur);
      updateClickThrough(false);
    };
  }, [captureError]);

  useEffect(() => {
    const unsubscribe = subscribeToWindowSnapPosition((event) => {
      setWindowSnapPosition((prev) => (prev === event.position ? prev : event.position));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAppShortcuts((event) => {
      if (event.action === "listen") { setView("main"); void shortcutHandlersRef.current.listen(); return; }
      if (event.action === "answer") { setView("main"); void shortcutHandlersRef.current.answer(); return; }
      if (event.action === "analyze") { setView("main"); void shortcutHandlersRef.current.analyze(); return; }
      if (event.action === "scroll-bottom") { setScrollToBottomSignal((prev) => prev + 1); return; }
      if (event.action === "clear") { setView("main"); shortcutHandlersRef.current.clear(); return; }
      if (event.action === "prev-answer") { setAnswerIndex((prev) => Math.max(0, prev - 1)); return; }
      if (event.action === "next-answer") {
        setBlocks((prev) => {
          const count = prev.filter((b) => b.kind === "answer").length;
          setAnswerIndex((i) => Math.min(count - 1, i + 1));
          return prev;
        });
        return;
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void loadStoredResume().then((record) => { applyResumeRecord(record); });
  }, []);

  useEffect(() => {
    const appUpdater = (window as any).appUpdater;
    if (!appUpdater) return;

    void appUpdater.getInfo().then((info: UpdateInfo | null) => {
      if (info?.version) {
        setUpdateAvailable(true);
        setUpdateVersion(info.version);
        setUpdateInfo(info);

        void appUpdater.getDownloadStatus?.().then((status: UpdateDownloadProgress | null) => {
          if (status) setDownloadProgress(status);
        });
      }
    });

    const subscriptionId = appUpdater.onUpdateAvailable((info: UpdateInfo) => {
      setUpdateAvailable(true);
      setUpdateVersion(info.version);
      setUpdateInfo(info);

      void appUpdater.getDownloadStatus?.().then((status: UpdateDownloadProgress | null) => {
        if (status) setDownloadProgress(status);
      });
    });

    return () => {
      appUpdater.offUpdateAvailable(subscriptionId);
    };
  }, []);

  useEffect(() => {
    const appUpdater = (window as any).appUpdater;
    if (!appUpdater?.onDownloadProgress) return;

    const subscriptionId = appUpdater.onDownloadProgress((progress: UpdateDownloadProgress) => {
      setDownloadProgress(progress);
    });

    return () => {
      appUpdater.offDownloadProgress?.(subscriptionId);
    };
  }, []);

  useEffect(() => {
    return () => {
      void stopAudioTranscription();
      stopActiveAnswerStream();
    };
  }, []);

  function updateAnswerBlockText(blockId: number, text: string) {
    setBlocks((prev) =>
      prev.map((block) =>
        block.kind === "answer" && block.id === blockId ? { ...block, text } : block
      )
    );
  }

  async function handleListen() {
    if (isTranscribing) {
      await stopAudioTranscription();
      setIsTranscribing(false);
      setActiveTranscriptionId(null);
      liveTranscriptBlockId.current = null;
      committedTranscriptText.current = "";
      transcriptResetBoundary.current = "";
      transcriptBoundaryEnd.current = null;
      latestTranscriptEnd.current = null;
      currentAudioSessionId.current = null;
      return;
    }

    setIsTranscribing(true);
    setActiveTranscriptionId(null);
    liveTranscriptBlockId.current = null;
    committedTranscriptText.current = "";
    transcriptResetBoundary.current = "";
    transcriptBoundaryEnd.current = null;
    latestTranscriptEnd.current = null;

    const started = await startAudioTranscription({
      apiKey: settings.deepgramApiKey,
      jobRole: settings.jobRole,
    });
    if (!started) {
      setIsTranscribing(false);
      setCaptureError("Couldn't reach the audio capture bridge. Try restarting the app.");
      return;
    }

    currentAudioSessionId.current = started.sessionId;

    if (started.status === "error") {
      setIsTranscribing(false);
      setActiveTranscriptionId(null);
      liveTranscriptBlockId.current = null;
      committedTranscriptText.current = "";
      transcriptResetBoundary.current = "";
      transcriptBoundaryEnd.current = null;
      latestTranscriptEnd.current = null;
      currentAudioSessionId.current = null;
      setCaptureError(started.error || started.message || "Listening failed for an unknown reason.");
    }
  }

  async function handleResumeUpload() {
    const record = await uploadStoredResume();
    if (record) applyResumeRecord(record);
  }

  async function handleResumeDelete() {
    const deleted = await deleteStoredResume();
    if (deleted) applyResumeRecord(null);
  }

  async function handleAnalyze() {
    stopActiveAnswerStream();

    const geminiApiKey = settings.geminiApiKey.trim();
    const memoryLimit = Math.max(0, settings.answerMemory);
    const memory = memoryLimit > 0 ? answerMemory.current.slice(-memoryLimit) : [];
    const id = nextId();
    const requestId = answerRunId.current;

    setBlocks((prev) => {
      const currentAnswerCount = prev.filter((b) => b.kind === "answer").length;
      setAnswerIndex(currentAnswerCount);
      return [...prev, { kind: "answer", id, text: "" }];
    });
    setActiveAnswerId(id);
    setIsAnswering(true);

    try {
      if (!geminiApiKey) {
        updateAnswerBlockText(id, "Add your Gemini API key in settings to analyze the screen.");
        return;
      }

      const screenshotDataUrl = await captureScreenImage();
      if (answerRunId.current !== requestId) return;

      if (!screenshotDataUrl) {
        throw new Error("Could not capture the screen. Please try again after the app finishes redrawing.");
      }

      const controller = new AbortController();
      answerAbortController.current = controller;
      answerRawText.current = "";

      const { text } = await streamGeminiAnalyzeScreenAnswer({
        apiKey: geminiApiKey,
        jobRole: settings.jobRole,
        memory,
        screenshotDataUrl,
        signal: controller.signal,
        onTextChunk: (chunk) => {
          if (answerRunId.current !== requestId) return;
          answerRawText.current += chunk;
          updateAnswerBlockText(id, answerRawText.current);
        },
        onAttemptReset: () => {
          if (answerRunId.current !== requestId) return;
          answerRawText.current = "";
          updateAnswerBlockText(id, "");
        },
      });

      if (answerRunId.current !== requestId) return;

      const finalAnswer = text || answerRawText.current;
      updateAnswerBlockText(id, finalAnswer || "Gemini returned an empty response.");
    } catch (error) {
      if (answerRunId.current !== requestId) return;
      if (error instanceof DOMException && error.name === "AbortError") return;

      const message = error instanceof Error ? error.message : String(error);
      if (message === "All Gemini models are currently busy, please try again in a moment.") {
        updateAnswerBlockText(id, message);
        return;
      }

      updateAnswerBlockText(id, `Analyze Screen failed: ${message}`);
    } finally {
      if (answerRunId.current !== requestId) return;
      answerAbortController.current = null;
      answerRawText.current = "";
      setIsAnswering(false);
      setActiveAnswerId(null);
    }
  }

  function handleAnswer() {
    if (isAnswering) return;
    stopActiveAnswerStream();

    const transcriptText = getTranscriptSnapshot();
    const latestTranscriptText = getLatestTranscriptQuestion(transcriptText) || transcriptText;
    const apiKey = settings.openrouterApiKey.trim();
    const resolvedModel = resolveOpenRouterModel(settings.openrouterModel);
    const memoryLimit = Math.max(0, settings.answerMemory);
    const memory = memoryLimit > 0 ? answerMemory.current.slice(-memoryLimit) : [];
    const intent = detectAnswerIntent(latestTranscriptText, memory);
    const questionKind = detectQuestionKind(latestTranscriptText);
    const resumeRelevant = detectResumeRelevance(latestTranscriptText) || questionKind === "personal";
    const resume = resumeRelevant ? resumeRecord.current : null;
    const transcriptionSeparatorId = nextId();
    const answerId = nextId();

    transcriptResetBoundary.current = latestTranscriptText;
    transcriptBoundaryEnd.current = latestTranscriptEnd.current;
    liveTranscriptBlockId.current = null;
    committedTranscriptText.current = "";
    setActiveTranscriptionId(null);

    setBlocks((prev) => {
      const currentAnswerCount = prev.filter((b) => b.kind === "answer").length;
      setAnswerIndex(currentAnswerCount);
      return [
        ...prev,
        { kind: "transcription", id: transcriptionSeparatorId, text: "" },
        { kind: "answer", id: answerId, text: "" },
      ];
    });

    setActiveAnswerId(answerId);
    setIsAnswering(true);

    function rollbackAnswerBlock() {
      setBlocks((prev) => {
        const next = prev.filter(
          (b) => b.id !== answerId && b.id !== transcriptionSeparatorId
        );
        const rolledBackCount = next.filter((b) => b.kind === "answer").length;
        setAnswerIndex(Math.max(0, rolledBackCount - 1));
        return next;
      });
      setIsAnswering(false);
      setActiveAnswerId(null);
    }

    if (!apiKey) { rollbackAnswerBlock(); return; }
    if (!transcriptText) { rollbackAnswerBlock(); return; }
    if (resumeRelevant && !resume) { rollbackAnswerBlock(); return; }

    const requestId = answerRunId.current;
    const controller = new AbortController();
    answerAbortController.current = controller;
    answerRawText.current = "";

    const messages = buildOpenRouterMessages({
      transcript: latestTranscriptText,
      memory,
      jobRole: settings.jobRole,
      intent,
      resume,
      resumeRelevant,
    });

    const fullTranscriptForCodeCheck = memory.map((p) => p.transcript).join("\n");
    const isCodingContinuation =
      questionKind === "coding" &&
      transcriptHasPriorCode(fullTranscriptForCodeCheck) &&
      intent.isFollowUp;
    const maxTokens = getMaxTokensForKind(questionKind, isCodingContinuation);

    void streamOpenRouterAnswer({
      apiKey,
      model: resolvedModel,
      messages,
      maxTokens,
      signal: controller.signal,
      onTextChunk: (chunk) => {
        if (answerRunId.current !== requestId) return;
        answerRawText.current += chunk;
        updateAnswerBlockText(answerId, answerRawText.current);
      },
    })
      .then(({ text }) => {
        if (answerRunId.current !== requestId) return;

        const finalAnswer = text || answerRawText.current;

        if (!finalAnswer) {
          // Silently drop — same treatment as a failed request.
          setBlocks((prev) => {
            const next = prev.filter(
              (b) => b.id !== answerId && b.id !== transcriptionSeparatorId
            );
            const rolledBackCount = next.filter((b) => b.kind === "answer").length;
            setAnswerIndex(Math.max(0, rolledBackCount - 1));
            return next;
          });

          if (autoAnswerRef.current && autoAnswerRetryCount.current < MAX_AUTO_ANSWER_RETRIES) {
            autoAnswerRetryCount.current += 1;
            autoAnswerTimer.current = setTimeout(() => {
              autoAnswerTimer.current = null;
              shortcutHandlersRef.current.answer();
            }, 500);
          }
          return;
        }

        updateAnswerBlockText(answerId, finalAnswer);
        finishAnswerSession(latestTranscriptText, finalAnswer);
        autoAnswerRetryCount.current = 0; // reset retry count on success
      })
      .catch((error: unknown) => {
        if (answerRunId.current !== requestId) return;
        if (error instanceof DOMException && error.name === "AbortError") return;

        // Remove the failed answer block + its separator
        setBlocks((prev) => {
          const next = prev.filter(
            (b) => b.id !== answerId && b.id !== transcriptionSeparatorId
          );
          const rolledBackCount = next.filter((b) => b.kind === "answer").length;
          setAnswerIndex(Math.max(0, rolledBackCount - 1));
          return next;
        });

        // Auto-mode: retry immediately (500ms) up to MAX_AUTO_ANSWER_RETRIES times
        if (autoAnswerRef.current && autoAnswerRetryCount.current < MAX_AUTO_ANSWER_RETRIES) {
          autoAnswerRetryCount.current += 1;
          autoAnswerTimer.current = setTimeout(() => {
            autoAnswerTimer.current = null;
            shortcutHandlersRef.current.answer();
          }, 500);
        }
      })
      .finally(() => {
        if (answerRunId.current !== requestId) return;

        answerAbortController.current = null;
        answerRawText.current = "";
        setIsAnswering(false);
        setActiveAnswerId(null);

        // If auto-answer is on and there's new transcript waiting, arm the 2s silence timer
        if (autoAnswerRef.current && committedTranscriptText.current.trim()) {
          if (autoAnswerTimer.current) clearTimeout(autoAnswerTimer.current);
          autoAnswerTimer.current = setTimeout(() => {
            autoAnswerTimer.current = null;
            shortcutHandlersRef.current.answer();
          }, 2000);
        }
      });
  }

  function handleClear() {
    autoAnswerRetryCount.current = 0;
    stopActiveAnswerStream();
    if (autoAnswerTimer.current) {
      clearTimeout(autoAnswerTimer.current);
      autoAnswerTimer.current = null;
    }
    answerMemory.current = [];
    liveTranscriptBlockId.current = null;
    committedTranscriptText.current = "";
    transcriptResetBoundary.current = "";
    transcriptBoundaryEnd.current = null;
    latestTranscriptEnd.current = null;
    setBlocks([]);
    setIsAnswering(false);
    setActiveTranscriptionId(null);
    setActiveAnswerId(null);
    setAnswerIndex(0);
  }

  function handlePrevAnswer() {
    setAnswerIndex((prev) => Math.max(0, prev - 1));
  }

  function handleUpdateClick() {
    setView("update");
  }

  function handleStartDownload() {
    (window as any).appUpdater?.startDownload();
  }

  function handleInstall() {
    (window as any).appUpdater?.runInstaller();
  }

  function handleNextAnswer() {
    const answerCount = blocks.filter((b) => b.kind === "answer").length;
    setAnswerIndex((prev) => Math.min(answerCount - 1, prev + 1));
  }

  shortcutHandlersRef.current = {
    listen: handleListen,
    answer: handleAnswer,
    analyze: handleAnalyze,
    clear: handleClear,
  };

  const shellAlignmentClass =
    windowSnapPosition === "left"
      ? "justify-start px-0"
      : windowSnapPosition === "right"
        ? "justify-end px-0"
        : "justify-center px-4";

  function handleSettingChange<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    if (typeof value === "string") {
      if (key === "deepgramApiKey") window.localStorage.setItem("dosa.deepgramApiKey", value);
      if (key === "openrouterApiKey") window.localStorage.setItem("dosa.openrouterApiKey", value);
      if (key === "openrouterModel") window.localStorage.setItem("dosa.openrouterModel", value);
      if (key === "geminiApiKey") window.localStorage.setItem("dosa.geminiApiKey", value);
    }

    if (key === "appWidth" && typeof value === "number") {
      window.localStorage.setItem("dosa.appWidth", String(value));
    }

    if (key === "answerMemory" && typeof value === "number") {
      const nextLimit = Math.max(0, value);
      answerMemory.current = nextLimit > 0 ? answerMemory.current.slice(-nextLimit) : [];
    }

    if (key === "codeInsertMode" && typeof value === "string") {
      window.localStorage.setItem("dosa.codeInsertMode", value);
    }

    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  const answerCount = blocks.filter((b) => b.kind === "answer").length;

  return (
    <div
      ref={rootRef}
      className={`bg-transparent flex items-start pt-12 overflow-hidden ${shellAlignmentClass}`}
    >
      <div
  ref={shellRef}
  className="w-full border border-border flex flex-col overflow-hidden"
  style={{
    width: `min(${settings.appWidth}px, calc(100vw - 32px))`,
    backgroundColor: `color-mix(in srgb, var(--background) ${settings.transparency}%, transparent)`,
    maxHeight: `${maxShellHeight}px`,
  }}
>
        <Topbar
          view={view}
          resumeUploaded={settings.resumeUploaded}
          onSettings={() => setView("settings")}
          onBack={() => setView("main")}
          onClose={closeAppWindow}
          isTranscribing={isTranscribing}
          isAnswering={isAnswering}
          onListen={handleListen}
          onAnswer={handleAnswer}
          onClear={handleClear}
          onAnalyze={handleAnalyze}
          answerCount={answerCount}
          answerIndex={answerIndex}
          onPrevAnswer={handlePrevAnswer}
          onNextAnswer={handleNextAnswer}
          autoAnswer={autoAnswer}
          onToggleAutoAnswer={() => {
            setAutoAnswer((prev) => {
              const next = !prev;
              autoAnswerRef.current = next;
              if (!next && autoAnswerTimer.current) {
                clearTimeout(autoAnswerTimer.current);
                autoAnswerTimer.current = null;
              }
              return next;
            });
          }}
          updateAvailable={updateAvailable}
          updateVersion={updateVersion}
          onUpdateClick={handleUpdateClick}
        />

        {view === "main" ? (
          <MainView
            blocks={blocks}
            isTranscribing={isTranscribing}
            isAnswering={isAnswering}
            activeTranscriptionId={activeTranscriptionId}
            activeAnswerId={activeAnswerId}
            scrollToBottomSignal={scrollToBottomSignal}
            answerIndex={answerIndex}
            codeInsertMode={settings.codeInsertMode}
            openrouterApiKey={settings.openrouterApiKey}
            openrouterModel={settings.openrouterModel}
          />
        ) : view === "settings" ? (
          <SettingsView
            settings={settings}
            onChange={handleSettingChange}
            onResumeUpload={handleResumeUpload}
            onResumeDelete={handleResumeDelete}
          />
        ) : (
          <UpdateView
            updateInfo={updateInfo}
            progress={downloadProgress}
            onStartDownload={handleStartDownload}
            onInstall={handleInstall}
          />
        )}
      </div>

      <CaptureStatusModal
        open={!!captureError}
        message={captureError ?? ""}
        onRetry={() => {
          setCaptureError(null);
          void handleListen();
        }}
        onClose={() => setCaptureError(null)}
      />
    </div>
  );
}