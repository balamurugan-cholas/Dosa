import type { ResumeRecord } from "./types";

type ResumeBridge = {
  load: () => Promise<ResumeRecord | null>;
  upload: () => Promise<ResumeRecord | null>;
  remove: () => Promise<boolean>;
};

type WindowWithResumeBridge = Window & {
  resumeStore?: ResumeBridge;
};

function getBridge() {
  return (window as WindowWithResumeBridge).resumeStore;
}

export async function loadStoredResume() {
  const bridge = getBridge();

  if (!bridge?.load) {
    return null;
  }

  try {
    return await bridge.load();
  } catch {
    return null;
  }
}

export async function uploadStoredResume() {
  const bridge = getBridge();

  if (!bridge?.upload) {
    return null;
  }

  try {
    return await bridge.upload();
  } catch {
    return null;
  }
}

export async function deleteStoredResume() {
  const bridge = getBridge();

  if (!bridge?.remove) {
    return false;
  }

  try {
    return await bridge.remove();
  } catch {
    return false;
  }
}
