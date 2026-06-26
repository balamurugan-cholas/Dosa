import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const waitOn = require("wait-on");

const isWindows = process.platform === "win32";
const shellCommand = isWindows ? "cmd.exe" : "/bin/sh";
const rendererArgs = isWindows
  ? ["/c", "npm run dev:renderer"]
  : ["-lc", "npm run dev:renderer"];
const electronArgs = isWindows
  ? ["/c", "electron ."]
  : ["-lc", "electron ."];

let rendererProcess = null;
let electronProcess = null;
let shuttingDown = false;

process.env.DOSA_DEV_LAUNCHER_PID = String(process.pid);

function spawnCommand(label, args) {
  const child = spawn(shellCommand, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  child.on("error", (error) => {
    console.error(`[dev] failed to start ${label}:`, error);
    shutdown(1);
  });

  return child;
}

function killRendererTree() {
  if (!rendererProcess || rendererProcess.killed) {
    return;
  }

  if (isWindows && rendererProcess.pid) {
    const killer = spawn("taskkill", ["/PID", String(rendererProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });

    killer.on("error", () => {
      rendererProcess.kill();
    });
    return;
  }

  rendererProcess.kill();
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killRendererTree();

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

rendererProcess = spawnCommand("renderer", rendererArgs);
rendererProcess.on("exit", (code) => {
  if (!shuttingDown && code !== null && code !== 0 && !electronProcess) {
    console.error(`[dev] renderer exited before Electron started with code ${code}`);
    shutdown(code);
  }
});

try {
  await waitOn({
    resources: ["http://localhost:5173"],
    timeout: 30000,
  });
} catch (error) {
  console.error("[dev] renderer did not become ready:", error);
  shutdown(1);
}

electronProcess = spawnCommand("electron", electronArgs);

electronProcess.on("exit", (code) => {
  shutdown(code ?? 0);
});
