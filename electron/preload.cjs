const { contextBridge, ipcRenderer } = require("electron");

const audioTranscriptionListeners = new Map();
let nextAudioTranscriptionListenerId = 1;
const windowSnapPositionListeners = new Map();
let nextWindowSnapPositionListenerId = 1;
const appShortcutListeners = new Map();
let nextAppShortcutListenerId = 1;

ipcRenderer.on("audio-transcription:update", (_event, payload) => {
  for (const listener of audioTranscriptionListeners.values()) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[preload] audio transcription listener failed:", error);
    }
  }
});

ipcRenderer.on("window:snap-position", (_event, payload) => {
  for (const listener of windowSnapPositionListeners.values()) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[preload] window snap position listener failed:", error);
    }
  }
});

ipcRenderer.on("app:shortcut", (_event, payload) => {
  for (const listener of appShortcutListeners.values()) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[preload] app shortcut listener failed:", error);
    }
  }
});

contextBridge.exposeInMainWorld("dosaWindow", {
  close: () => ipcRenderer.send("window:close"),
  resizeToContent: (height) => ipcRenderer.send("window:resize-to-content", { height }),
  setClickThrough: (enabled) =>
    ipcRenderer.send("window:set-click-through", { enabled: Boolean(enabled) }),
  captureScreen: () => ipcRenderer.invoke("screen:capture"),
  onSnapPosition: (listener) => {
    const subscriptionId = nextWindowSnapPositionListenerId++;
    windowSnapPositionListeners.set(subscriptionId, listener);
    return subscriptionId;
  },
  offSnapPosition: (subscriptionId) => {
    windowSnapPositionListeners.delete(Number(subscriptionId));
  },
  onAppShortcut: (listener) => {
    const subscriptionId = nextAppShortcutListenerId++;
    appShortcutListeners.set(subscriptionId, listener);
    return subscriptionId;
  },
  offAppShortcut: (subscriptionId) => {
    appShortcutListeners.delete(Number(subscriptionId));
  },
});

contextBridge.exposeInMainWorld("audioTranscription", {
  start: (options) => ipcRenderer.invoke("audio-transcription:start", options),
  stop: () => ipcRenderer.invoke("audio-transcription:stop"),
  state: () => ipcRenderer.invoke("audio-transcription:state"),
  sendAudio: (chunk) => ipcRenderer.send("audio-transcription:audio", chunk),
  captureError: (message) => ipcRenderer.invoke("audio-transcription:capture-error", message),
  onUpdate: (listener) => {
    const subscriptionId = nextAudioTranscriptionListenerId++;
    audioTranscriptionListeners.set(subscriptionId, listener);
    return subscriptionId;
  },
  offUpdate: (subscriptionId) => {
    audioTranscriptionListeners.delete(Number(subscriptionId));
  },
});

contextBridge.exposeInMainWorld("resumeStore", {
  load: () => ipcRenderer.invoke("resume:load"),
  upload: () => ipcRenderer.invoke("resume:upload"),
  remove: () => ipcRenderer.invoke("resume:delete"),
});
