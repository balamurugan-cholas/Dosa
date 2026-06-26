import type { AppShortcutAction, WindowSnapPosition } from "./types";

type WindowSnapPositionUpdate = {
  position: WindowSnapPosition;
};

type AppShortcutUpdate = {
  action: AppShortcutAction;
};

type ElectronWindowBridge = {
  close: () => void;
  resizeToContent: (height: number) => void;
  setClickThrough: (enabled: boolean) => void;
  captureScreen: () => Promise<string | null>;
  onSnapPosition: (listener: (event: WindowSnapPositionUpdate) => void) => number;
  offSnapPosition: (subscriptionId: number) => void;
  onAppShortcut: (listener: (event: AppShortcutUpdate) => void) => number;
  offAppShortcut: (subscriptionId: number) => void;
};

type WindowWithElectronBridge = Window & {
  dosaWindow?: ElectronWindowBridge;
};

export function closeAppWindow() {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (bridge?.close) {
    bridge.close();
    return;
  }

  window.close();
}

export function resizeAppWindow(height: number) {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (bridge?.resizeToContent) {
    bridge.resizeToContent(height);
  }
}

export function setAppClickThrough(enabled: boolean) {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (bridge?.setClickThrough) {
    bridge.setClickThrough(enabled);
  }
}

export async function captureScreenImage() {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (!bridge?.captureScreen) {
    return null;
  }

  try {
    return await bridge.captureScreen();
  } catch {
    return null;
  }
}

export function subscribeToWindowSnapPosition(
  listener: (event: WindowSnapPositionUpdate) => void
) {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (!bridge?.onSnapPosition || !bridge?.offSnapPosition) {
    return () => {};
  }

  const subscriptionId = bridge.onSnapPosition(listener);
  return () => bridge.offSnapPosition(subscriptionId);
}

export function subscribeToAppShortcuts(listener: (event: AppShortcutUpdate) => void) {
  const bridge = (window as WindowWithElectronBridge).dosaWindow;

  if (!bridge?.onAppShortcut || !bridge?.offAppShortcut) {
    return () => {};
  }

  const subscriptionId = bridge.onAppShortcut(listener);
  return () => bridge.offAppShortcut(subscriptionId);
}
