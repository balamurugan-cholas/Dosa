const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  screen,
  session,
} = require("electron");
const path = require("path");
const fs = require("fs/promises");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { AudioTranscriptionManager } = require("./deepgram-transcription.cjs");

const isDev = !app.isPackaged;
const devUrl = "http://localhost:5173";
const MIN_WINDOW_HEIGHT = 120;
const WINDOW_SNAP_THRESHOLD = 24;
const RESUME_STORAGE_DIR = "resume";
const RESUME_STORAGE_FILE = "resume.json";

let mainWindow = null;
let lastBroadcastWindowSnapPosition = "center";
let appQuitRequested = false;
const audioTranscriptionManager = new AudioTranscriptionManager();

function getResumeStoragePath() {
  return path.join(app.getPath("userData"), RESUME_STORAGE_DIR, RESUME_STORAGE_FILE);
}

function normalizeResumeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ensureResumeStorageDir() {
  await fs.mkdir(path.dirname(getResumeStoragePath()), { recursive: true });
}

async function readStoredResume() {
  try {
    const raw = await fs.readFile(getResumeStoragePath(), "utf8");
    const data = JSON.parse(raw);

    if (!data || typeof data !== "object") {
      return null;
    }

    const fileName = typeof data.fileName === "string" ? data.fileName : "";
    const fileType = typeof data.fileType === "string" ? data.fileType : null;
    const text = typeof data.text === "string" ? data.text : "";
    const updatedAt = Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now();

    if (!fileName || !text.trim()) {
      return null;
    }

    return {
      fileName,
      fileType,
      text,
      updatedAt,
    };
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.error("[electron] failed to read stored resume:", error);
    }

    return null;
  }
}

async function writeStoredResume(record) {
  await ensureResumeStorageDir();
  await fs.writeFile(getResumeStoragePath(), JSON.stringify(record, null, 2), "utf8");
}

async function deleteStoredResume() {
  try {
    await fs.unlink(getResumeStoragePath());
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function extractResumeFromPath(filePath) {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".pdf") {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });

    try {
      const parsed = await parser.getText();
      return {
        fileName,
        fileType: "application/pdf",
        text: normalizeResumeText(parsed.text),
      };
    } finally {
      await parser.destroy();
    }
  }

  if (extension === ".docx") {
    const parsed = await mammoth.extractRawText({ path: filePath });
    return {
      fileName,
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: normalizeResumeText(parsed.value),
    };
  }

  if ([".txt", ".md", ".markdown", ".rtf"].includes(extension)) {
    const text = await fs.readFile(filePath, "utf8");
    return {
      fileName,
      fileType: "text/plain",
      text: normalizeResumeText(text),
    };
  }

  throw new Error("Unsupported resume format. Please upload a PDF, DOCX, TXT, MD, or RTF file.");
}

async function selectAndStoreResume() {
  const dialogResult = await dialog.showOpenDialog(mainWindow || undefined, {
    title: "Select Resume",
    properties: ["openFile"],
    filters: [
      { name: "Resume files", extensions: ["pdf", "docx", "txt", "md", "rtf"] },
      { name: "All files", extensions: ["*"] },
    ],
  });

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return null;
  }

  const filePath = dialogResult.filePaths[0];
  const record = await extractResumeFromPath(filePath);

  if (!record.text.trim()) {
    throw new Error("Could not extract readable text from the selected resume.");
  }

  const storedRecord = {
    ...record,
    updatedAt: Date.now(),
  };

  await writeStoredResume(storedRecord);
  return storedRecord;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreenDataUrlForWindow(win) {
  if (!win || win.isDestroyed()) {
    return null;
  }

  const wasVisible = win.isVisible();

  if (wasVisible) {
    win.hide();
    await sleep(120);
  }

  try {
    const display = screen.getDisplayMatching(win.getBounds());
    const { workArea } = display;
    const thumbnailSize = {
      width: Math.max(1, Math.round(display.size.width || workArea.width)),
      height: Math.max(1, Math.round(display.size.height || workArea.height)),
    };
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
    });

    const displayId = String(display.id);
    const source =
      sources.find((item) => String(item.display_id) === displayId) || sources[0] || null;

    return source ? source.thumbnail.toDataURL() : null;
  } finally {
    if (wasVisible && !win.isDestroyed()) {
      win.showInactive();
    }
  }
}

function clampHeight(height, workAreaHeight) {
  return Math.min(Math.max(Math.round(height), MIN_WINDOW_HEIGHT), Math.max(MIN_WINDOW_HEIGHT, workAreaHeight));
}

function getHorizontalBounds(workArea, desiredHeight, desiredWidth, position) {
  const margin = 0;
  const width = Math.min(Math.round(desiredWidth), Math.max(1, workArea.width));
  const height = clampHeight(desiredHeight, workArea.height);
  const centerX = Math.max(workArea.x, Math.round(workArea.x + (workArea.width - width) / 2));
  const leftX = Math.max(workArea.x, workArea.x + margin);
  const rightX = Math.max(workArea.x, workArea.x + workArea.width - width - margin);
  const x =
    position === "left"
      ? leftX
      : position === "right"
        ? rightX
        : centerX;

  return { x, y: workArea.y, width, height };
}

function getTopCenteredBounds(workArea, desiredHeight) {
  return getHorizontalBounds(workArea, desiredHeight, Math.min(1024, Math.max(900, workArea.width - 32)), "center");
}

function getWindowHorizontalPosition(win, workArea) {
  const { x: currentX } = win.getBounds();
  const [width] = win.getSize();
  const positions = {
    left: getHorizontalBounds(workArea, MIN_WINDOW_HEIGHT, width, "left").x,
    center: getHorizontalBounds(workArea, MIN_WINDOW_HEIGHT, width, "center").x,
    right: getHorizontalBounds(workArea, MIN_WINDOW_HEIGHT, width, "right").x,
  };

  return Object.entries(positions).reduce((closest, [position, x]) => {
    const distance = Math.abs(currentX - x);
    if (!closest || distance < closest.distance) {
      return { position, distance };
    }

    return closest;
  }, null)?.position || "center";
}

function getWindowSnapPosition(win) {
  if (!win || win.isDestroyed()) {
    return "center";
  }

  const bounds = win.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  const leftDistance = Math.abs(bounds.x - workArea.x);
  const rightDistance = Math.abs(bounds.x + bounds.width - (workArea.x + workArea.width));

  if (leftDistance <= WINDOW_SNAP_THRESHOLD) {
    return "left";
  }

  if (rightDistance <= WINDOW_SNAP_THRESHOLD) {
    return "right";
  }

  return "center";
}

function emitWindowSnapPosition(win, forcedPosition = null) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const nextPosition = forcedPosition || getWindowSnapPosition(win);

  if (lastBroadcastWindowSnapPosition === nextPosition) {
    return;
  }

  lastBroadcastWindowSnapPosition = nextPosition;
  win.webContents.send("window:snap-position", { position: nextPosition });
}

function snapWindowToEdgeIfNeeded(win) {
  if (!win || win.isDestroyed()) {
    return;
  }

  const nextPosition = getWindowSnapPosition(win);
  if (nextPosition === "center") {
    emitWindowSnapPosition(win, nextPosition);
    return;
  }

  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const [width, height] = win.getSize();
  const targetBounds = getHorizontalBounds(workArea, height, width, nextPosition);
  const currentBounds = win.getBounds();

  if (
    currentBounds.x !== targetBounds.x ||
    currentBounds.y !== targetBounds.y ||
    currentBounds.width !== targetBounds.width ||
    currentBounds.height !== targetBounds.height
  ) {
    win.setBounds(targetBounds);
  }

  emitWindowSnapPosition(win, nextPosition);
}

function moveWindowToHorizontalPosition(position) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const [width, height] = mainWindow.getSize();
  mainWindow.setBounds(getHorizontalBounds(workArea, height, width, position));
  emitWindowSnapPosition(mainWindow, position);
}

function moveWindowOneStep(direction) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const currentPosition = getWindowHorizontalPosition(mainWindow, workArea);

  if (direction === "left") {
    if (currentPosition === "right") {
      moveWindowToHorizontalPosition("center");
      return;
    }

    moveWindowToHorizontalPosition("left");
    return;
  }

  if (currentPosition === "left") {
    moveWindowToHorizontalPosition("center");
    return;
  }

  moveWindowToHorizontalPosition("right");
}

function sendAppShortcut(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:shortcut", { action });
}

function requestAppQuit() {
  if (appQuitRequested) {
    return;
  }

  appQuitRequested = true;

  const devLauncherPid = Number(process.env.DOSA_DEV_LAUNCHER_PID || 0);
  if (Number.isInteger(devLauncherPid) && devLauncherPid > 0) {
    try {
      process.kill(devLauncherPid, "SIGTERM");
    } catch {
      // Ignore if the dev launcher is already gone.
    }
  }

  try {
    globalShortcut.unregisterAll();
  } catch {
    // Ignore shutdown races.
  }

  void audioTranscriptionManager.stop({ silent: true });
  app.exit(0);
}

function toggleAppWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function registerGlobalShortcuts() {
  globalShortcut.unregisterAll();

  const registrations = [
    ["Alt+Q", () => sendAppShortcut("listen")],
    ["Alt+W", () => sendAppShortcut("answer")],
    ["Alt+Enter", () => sendAppShortcut("analyze")],
    ["Alt+Down", () => sendAppShortcut("scroll-bottom")],
    ["Alt+C", () => sendAppShortcut("clear")],
    ["Alt+X", () => toggleAppWindow()],
    ["CommandOrControl+Shift+Left", () => moveWindowOneStep("left")],
    ["CommandOrControl+Shift+Right", () => moveWindowOneStep("right")],
  ];

  let failed = false;

  for (const [accelerator, handler] of registrations) {
    const registered = globalShortcut.register(accelerator, handler);
    if (!registered) {
      failed = true;
      console.warn("[electron] failed to register shortcut:", accelerator);
    }
  }

  if (failed) {
    console.warn("[electron] one or more global shortcuts were not registered");
  }
}

function createWindow() {
  lastBroadcastWindowSnapPosition = "center";
  const { workArea } = screen.getPrimaryDisplay();
  const { x, y, width, height } = getTopCenteredBounds(workArea, 240);

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 900,
    minHeight: MIN_WINDOW_HEIGHT,
    resizable: false,
    skipTaskbar: true,
    show: true,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setContentProtection(true);
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setSkipTaskbar(true);

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  if (isDev) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  }

  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.on("move", () => {
    snapWindowToEdgeIfNeeded(mainWindow);
  });
  mainWindow.on("resize", () => {
    snapWindowToEdgeIfNeeded(mainWindow);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (isDev) {
      console.log("[electron] renderer loaded:", devUrl);
    }
    emitWindowSnapPosition(mainWindow, "center");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[electron] failed to load:", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // If the link is an external web page, hijack it and send it to the native OS browser
    if (url.startsWith("http:") || url.startsWith("https:")) {
      const { shell } = require("electron");
      shell.openExternal(url).catch((err) => {
        console.error("[electron] Failed to launch system web browser:", err);
      });
      return { action: "deny" }; // Blocks Electron from opening it as a layout window internally
    }
    return { action: "allow" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    requestAppQuit();
  });

  mainWindow.on("close", () => {
    requestAppQuit();
  });
}

function broadcastAudioTranscriptionUpdate(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("audio-transcription:update", payload);
    }
  }
}

function configureDesktopCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 },
      })
      .then((sources) => {
        const [source] = sources;

        if (!source) {
          callback({});
          return;
        }

        callback({
          video: source,
          audio: "loopback",
        });
      })
      .catch((error) => {
        console.error("[electron] failed to resolve desktop capture source:", error);
        callback({});
      });
  }, { useSystemPicker: false });
}

ipcMain.on("window:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    requestAppQuit();
  }
});

ipcMain.on("window:resize-to-content", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !payload || typeof payload.height !== "number") {
    return;
  }

  const { workArea } = screen.getDisplayMatching(win.getBounds());
  const targetHeight = clampHeight(payload.height, workArea.height);

  const [width, currentHeight] = win.getContentSize();
  const { x: currentX, y: currentY } = win.getBounds();
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - targetHeight;
  const nextX = Math.min(Math.max(currentX, workArea.x), Math.max(workArea.x, maxX));
  const nextY = Math.min(Math.max(currentY, workArea.y), Math.max(workArea.y, maxY));

  if (currentHeight === targetHeight && currentX === nextX && currentY === nextY) {
    return;
  }

  win.setBounds({
    x: nextX,
    y: nextY,
    width,
    height: targetHeight,
  });
  snapWindowToEdgeIfNeeded(win);
});

ipcMain.on("window:set-click-through", (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !payload || typeof payload.enabled !== "boolean") {
    return;
  }

  win.setIgnoreMouseEvents(payload.enabled, { forward: true });
});

ipcMain.handle("screen:capture", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return captureScreenDataUrlForWindow(win);
});

ipcMain.handle("audio-transcription:start", async (_event, options) =>
  audioTranscriptionManager.start(options)
);

ipcMain.handle("audio-transcription:stop", async () => audioTranscriptionManager.stop());

ipcMain.handle("audio-transcription:state", async () => audioTranscriptionManager.getState());

ipcMain.handle("audio-transcription:capture-error", async (_event, message) =>
  audioTranscriptionManager.captureError(String(message || "System audio capture failed"))
);

ipcMain.on("audio-transcription:audio", (_event, chunk) => {
  audioTranscriptionManager.receiveAudio(chunk);
});

ipcMain.handle("resume:load", async () => readStoredResume());

ipcMain.handle("resume:upload", async () => selectAndStoreResume());

ipcMain.handle("resume:delete", async () => {
  await deleteStoredResume();
  return true;
});

audioTranscriptionManager.on("update", broadcastAudioTranscriptionUpdate);

app.whenReady().then(() => {
  configureDesktopCapture();
  createWindow();
  registerGlobalShortcuts();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    requestAppQuit();
  }
});
