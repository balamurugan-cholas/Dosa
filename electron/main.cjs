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
const https = require("https");
const { shell } = require("electron");

const isDev = !app.isPackaged;
const devUrl = "http://localhost:5173";
const MIN_WINDOW_HEIGHT = 120;
const WINDOW_SNAP_THRESHOLD = 24;
const RESUME_STORAGE_DIR = "resume";
const RESUME_STORAGE_FILE = "resume.json";
const GITHUB_OWNER = "balamurugan-cholas";
const GITHUB_REPO = "Dosa";        
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 3; // check update every 3 hours

let mainWindow = null;
let lastBroadcastWindowSnapPosition = "center";
let appQuitRequested = false;
let latestReleaseInfo = null; // { version, url, assetName, assetUrl, assetSize }
let activeDownloadAbort = null;

const UPDATE_DOWNLOAD_DIR = "updates";

function getUpdateProgressStatePath() {
  return path.join(app.getPath("userData"), UPDATE_DOWNLOAD_DIR, "download-state.json");
}

function getUpdateInstallerPath(assetName) {
  return path.join(app.getPath("userData"), UPDATE_DOWNLOAD_DIR, assetName);
}

async function ensureUpdateDownloadDir() {
  await fs.mkdir(path.join(app.getPath("userData"), UPDATE_DOWNLOAD_DIR), { recursive: true });
}

async function readDownloadState() {
  try {
    const raw = await fs.readFile(getUpdateProgressStatePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeDownloadState(state) {
  await ensureUpdateDownloadDir();
  await fs.writeFile(getUpdateProgressStatePath(), JSON.stringify(state, null, 2), "utf8");
}

async function deleteDownloadState() {
  try {
    await fs.unlink(getUpdateProgressStatePath());
  } catch {
    // ignore
  }
}

async function sweepStaleUpdateFiles(currentAssetName) {
  try {
    const dir = path.join(app.getPath("userData"), UPDATE_DOWNLOAD_DIR);
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file === "download-state.json") continue;
      if (file !== currentAssetName) {
        try {
          await fs.unlink(path.join(dir, file));
          console.log("[electron] deleted stale update file:", file);
        } catch {
          // ignore — file may already be gone
        }
      }
    }
  } catch {
    // ignore sweep errors
  }
}

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

function compareVersions(a, b) {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function fetchLatestGithubRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "api.github.com",
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        headers: { "User-Agent": "Dosa-App" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API responded ${res.statusCode}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const assets = Array.isArray(json.assets) ? json.assets : [];
            const exeAsset = assets.find((asset) =>
              String(asset.name || "").toLowerCase().endsWith(".exe")
            );

            resolve({
              version: String(json.tag_name || "").replace(/^v/, ""),
              url: json.html_url,
              assetName: exeAsset ? exeAsset.name : null,
              assetUrl: exeAsset ? exeAsset.browser_download_url : null,
              assetSize: exeAsset ? exeAsset.size : null,
              body: typeof json.body === "string" && json.body.trim() ? json.body.trim() : null,
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("GitHub request timed out")));
  });
}

async function checkForUpdates() {
  try {
    const release = await fetchLatestGithubRelease();
    if (!release.version) return;

    const currentVersion = app.getVersion();
    if (compareVersions(release.version, currentVersion) > 0) {
      latestReleaseInfo = release;
      if (release.assetName) {
        void sweepStaleUpdateFiles(release.assetName);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("app:update-available", release);
      }
    }
  } catch (error) {
    console.error("[electron] update check failed:", error);
  }
}

function sendDownloadProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app:update-download-progress", payload);
  }
}

function downloadUpdateAsset({ url, filePath, version, totalBytes, startByte, signal }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = { "User-Agent": "Dosa-App" };

    if (startByte > 0) {
      headers.Range = `bytes=${startByte}-`;
    }

    const req = https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res) => {
        // Follow redirects (GitHub release assets redirect to S3/objects.githubusercontent.com)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          downloadUpdateAsset({
            url: res.headers.location,
            filePath,
            version,
            totalBytes,
            startByte,
            signal,
          }).then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        const writeStream = require("fs").createWriteStream(filePath, {
          flags: startByte > 0 ? "a" : "w",
        });

        let downloaded = startByte;
        let lastEmit = 0;

        signal.addEventListener("abort", () => {
          req.destroy();
          writeStream.close();
        });

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 200) {
            lastEmit = now;
            sendDownloadProgress({
              status: "downloading",
              version,
              bytesDownloaded: downloaded,
              totalBytes,
              message: null,
            });
          }
        });

        res.pipe(writeStream);

        writeStream.on("finish", () => {
          sendDownloadProgress({
            status: "downloading",
            version,
            bytesDownloaded: downloaded,
            totalBytes,
            message: null,
          });
          resolve();
        });

        writeStream.on("error", reject);
        res.on("error", reject);
      }
    );

    req.on("error", reject);
  });
}

async function startUpdateDownload() {
  if (!latestReleaseInfo?.assetUrl || !latestReleaseInfo?.assetName) {
    sendDownloadProgress({
      status: "error",
      version: latestReleaseInfo?.version || "",
      bytesDownloaded: 0,
      totalBytes: 0,
      message: "No downloadable installer found for this release.",
    });
    return;
  }

  if (activeDownloadAbort) {
    return; // already downloading
  }

  const { version, assetUrl, assetName, assetSize } = latestReleaseInfo;
  const filePath = getUpdateInstallerPath(assetName);
  await ensureUpdateDownloadDir();

  let startByte = 0;
  const existingState = await readDownloadState();
  if (existingState && existingState.version === version && existingState.assetName === assetName) {
    try {
      const stat = await fs.stat(filePath);
      startByte = stat.size;
    } catch {
      startByte = 0;
    }
  }

  const controller = new AbortController();
  activeDownloadAbort = controller;

  await writeDownloadState({ version, assetName, assetUrl, totalBytes: assetSize });

  try {
    await downloadUpdateAsset({
      url: assetUrl,
      filePath,
      version,
      totalBytes: assetSize,
      startByte,
      signal: controller.signal,
    });

    await deleteDownloadState();
    sendDownloadProgress({
      status: "completed",
      version,
      bytesDownloaded: assetSize,
      totalBytes: assetSize,
      message: null,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      sendDownloadProgress({
        status: "paused",
        version,
        bytesDownloaded: startByte,
        totalBytes: assetSize,
        message: "Download paused.",
      });
    } else {
      console.error("[electron] update download failed:", error);
      sendDownloadProgress({
        status: "error",
        version,
        bytesDownloaded: startByte,
        totalBytes: assetSize,
        message: error.message || "Download failed.",
      });
    }
  } finally {
    activeDownloadAbort = null;
  }
}

async function runUpdateInstaller() {
  if (!latestReleaseInfo?.assetName) return;

  const filePath = getUpdateInstallerPath(latestReleaseInfo.assetName);

  try {
    await fs.access(filePath);
  } catch {
    sendDownloadProgress({
      status: "error",
      version: latestReleaseInfo.version,
      bytesDownloaded: 0,
      totalBytes: latestReleaseInfo.assetSize || 0,
      message: "Installer file not found. Please re-download.",
    });
    return;
  }

  const errorMessage = await shell.openPath(filePath);
  if (errorMessage) {
    console.error("[electron] failed to launch installer:", errorMessage);
    return;
  }

  // Give the installer 2 seconds to self-extract before we delete the source file
  setTimeout(async () => {
    try {
      await fs.unlink(filePath);
      await deleteDownloadState();
      console.log("[electron] deleted installer after launch:", filePath);
    } catch {
      // ignore — installer may have already cleaned up or file is locked
    }
    requestAppQuit();
  }, 2000);
}

async function getExistingDownloadStatus() {
  if (!latestReleaseInfo?.assetName) return null;

  const { version, assetName, assetSize } = latestReleaseInfo;
  const filePath = getUpdateInstallerPath(assetName);

  try {
    const stat = await fs.stat(filePath);

    if (assetSize && stat.size >= assetSize) {
      return {
        status: "completed",
        version,
        bytesDownloaded: stat.size,
        totalBytes: assetSize,
        message: null,
      };
    }

    if (stat.size > 0) {
      return {
        status: "paused",
        version,
        bytesDownloaded: stat.size,
        totalBytes: assetSize,
        message: "Download paused.",
      };
    }

    return null;
  } catch {
    return null;
  }
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
    ["Alt+Left", () => sendAppShortcut("prev-answer")],
    ["Alt+Right", () => sendAppShortcut("next-answer")],
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

  //mainWindow.setContentProtection(true);
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
    if (url.startsWith("http:") || url.startsWith("https:")) {
      const { shell } = require("electron");
      shell.openExternal(url).catch((err) => {
        console.error("[electron] Failed to launch system web browser:", err);
      });
      return { action: "deny" };
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

ipcMain.handle("app:get-update-info", async () => latestReleaseInfo);

ipcMain.on("app:open-update-url", () => {
  if (latestReleaseInfo?.url) {
    shell.openExternal(latestReleaseInfo.url).catch((err) => {
      console.error("[electron] failed to open update URL:", err);
    });
  }
});

ipcMain.handle("app:get-download-status", async () => getExistingDownloadStatus());

ipcMain.on("app:start-update-download", () => {
  void startUpdateDownload();
});

ipcMain.on("app:run-installer", () => {
  void runUpdateInstaller();
});

audioTranscriptionManager.on("update", broadcastAudioTranscriptionUpdate);

app.whenReady().then(() => {
  configureDesktopCapture();
  createWindow();
  registerGlobalShortcuts();

  setTimeout(checkForUpdates, 3000);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS);

  // Clean up any leftover installer from a previous successful update
  void (async () => {
    const state = await readDownloadState();
    if (!state?.assetName) {
      // No pending download — sweep everything in the updates folder
      void sweepStaleUpdateFiles("__nothing__");
    }
  })();

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
