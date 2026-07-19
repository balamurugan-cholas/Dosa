const WebSocket = require("ws");

const VSCODE_BRIDGE_URL = "ws://localhost:4823";
const RECONNECT_DELAY_MS = 3000;

let socket = null;
let isConnected = false;
let reconnectTimer = null;
const pendingRequests = new Map();
let nextRequestId = 1;

function connect() {
  if (socket) return;

  socket = new WebSocket(VSCODE_BRIDGE_URL);

  socket.on("open", () => {
    isConnected = true;
    console.log("[vscode-bridge] connected to VS Code extension");
  });

  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Resolve the oldest pending request (extension replies in order, one at a time)
    const [oldestId] = pendingRequests.keys();
    if (oldestId !== undefined) {
      const resolver = pendingRequests.get(oldestId);
      pendingRequests.delete(oldestId);
      resolver(msg);
    }
  });

  const scheduleReconnect = () => {
    isConnected = false;
    socket = null;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  socket.on("close", scheduleReconnect);
  socket.on("error", scheduleReconnect);
}

function sendCodeToVSCode(code, mode = "instant", anchor = null) {
  return new Promise((resolve) => {
    if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
      resolve({ success: false, error: "VS Code is not connected. Is it open with the Dosa Bridge extension running?" });
      return;
    }

    const requestId = nextRequestId++;
    // Natural typing can take a while for long code blocks — give it a much
    // longer timeout than the instant-insert path so we don't time out mid-type.
    const timeoutMs = mode === "natural" ? 120000 : 5000;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "VS Code did not respond in time." });
    }, timeoutMs);

    pendingRequests.set(requestId, (msg) => {
      clearTimeout(timeout);
      if (msg.type === "ack" && msg.success) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: msg.error || "Unknown error from VS Code." });
      }
    });

    const payload = { type: "insertCode", code, mode };
    if (anchor && anchor.anchorLine) {
      payload.anchorLine = anchor.anchorLine;
      payload.anchorPosition = anchor.position || "end";
    }

    socket.send(JSON.stringify(payload));
  });
}

function getFileContentFromVSCode() {
  return new Promise((resolve) => {
    if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
      resolve({ success: false, error: "VS Code is not connected. Is it open with the Dosa Bridge extension running?" });
      return;
    }

    const requestId = nextRequestId++;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "VS Code did not respond in time." });
    }, 5000);

    pendingRequests.set(requestId, (msg) => {
      clearTimeout(timeout);
      if (msg.type === "fileContent" && msg.success) {
        resolve({ success: true, content: msg.content, languageId: msg.languageId, fileName: msg.fileName });
      } else {
        resolve({ success: false, error: msg.error || "Unknown error from VS Code." });
      }
    });

    socket.send(JSON.stringify({ type: "getFileContent" }));
  });
}

function applyInsertionsToVSCode(insertions, replacements = [], mode = "instant") {
  return new Promise((resolve) => {
    if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) {
      resolve({ success: false, error: "VS Code is not connected. Is it open with the Dosa Bridge extension running?" });
      return;
    }

    const requestId = nextRequestId++;
    // Multiple insertion blocks with natural typing can take a while.
    const timeoutMs = mode === "natural" ? 180000 : 8000;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "VS Code did not respond in time." });
    }, timeoutMs);

    pendingRequests.set(requestId, (msg) => {
      clearTimeout(timeout);
      if (msg.type === "ack" && msg.success) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: msg.error || "Unknown error from VS Code." });
      }
    });

    socket.send(JSON.stringify({ type: "applyInsertions", insertions, replacements, mode }));
  });
}

module.exports = { connect, sendCodeToVSCode, getFileContentFromVSCode, applyInsertionsToVSCode };