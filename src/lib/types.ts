export type TranscriptionBlock = {
  kind: "transcription";
  id: number;
  text: string;
};

export type AnswerBlock = {
  kind: "answer";
  id: number;
  text: string;
};

export type ContentBlock = TranscriptionBlock | AnswerBlock;

export type Phase = "idle" | "transcribing" | "ready" | "answering";

export type View = "main" | "settings" | "update";
export type WindowSnapPosition = "left" | "center" | "right";
export type AppShortcutAction = "listen" | "answer" | "analyze" | "scroll-bottom" | "clear";

export type TranscriptionProvider = "deepgram";

export type AudioTranscriptionStatus = "idle" | "starting" | "running" | "stopping" | "error";

export interface AudioTranscriptionState {
  status: AudioTranscriptionStatus;
  sessionId: number | null;
  provider: TranscriptionProvider | null;
  message: string | null;
  error: string | null;
}

export interface AudioTranscriptionWord {
  word: string;
  start?: number;
  end?: number;
  confidence?: number;
}

export type AudioTranscriptionUpdate =
  | {
      type: "status";
      sessionId: number;
      provider: TranscriptionProvider;
      status: AudioTranscriptionStatus;
      message: string | null;
      error: string | null;
    }
  | {
      type: "transcript";
      sessionId: number;
      provider: TranscriptionProvider;
      text: string;
      start?: number;
      end?: number;
      isFinal: boolean;
      words?: AudioTranscriptionWord[];
    }
  | {
      type: "audio_level";
      sessionId: number;
      provider: TranscriptionProvider;
      rms: number;
    }
  | {
      type: "error";
      sessionId: number | null;
      provider: TranscriptionProvider | null;
      status: "error";
      message: string;
      error: string;
    }
  | {
      type: "stopped";
      sessionId: number | null;
      provider: TranscriptionProvider | null;
      status: "idle";
      message: string;
      error: string | null;
    };

export interface AudioTranscriptionStartOptions {
  apiKey?: string;
  jobRole?: string;
}

export interface AudioTranscriptionStartResult {
  status: AudioTranscriptionStatus;
  sessionId: number | null;
  provider: TranscriptionProvider | null;
  message: string | null;
  error: string | null;
}

export type CodeInsertMode = "instant" | "natural";

export interface SettingsState {
  deepgramApiKey: string;
  openrouterApiKey: string;
  openrouterModel: string;
  geminiApiKey: string;
  transparency: number;
  appWidth: number;
  jobRole: string;
  answerMemory: number;
  resumeUploaded: boolean;
  resumeFileName: string;
  codeInsertMode: CodeInsertMode;
}

export interface ResumeRecord {
  fileName: string;
  fileType: string | null;
  text: string;
  updatedAt: number;
}

export type UpdateDownloadStatus =
  | "idle"
  | "downloading"
  | "paused"
  | "completed"
  | "error";

export interface UpdateInfo {
  version: string;
  url: string;
  assetName: string | null;
  assetSize: number | null;
  body: string | null;
}

export interface UpdateDownloadProgress {
  status: UpdateDownloadStatus;
  version: string;
  bytesDownloaded: number;
  totalBytes: number;
  message: string | null;
}