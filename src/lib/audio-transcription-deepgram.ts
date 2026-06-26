import {
  AudioTranscriptionStartOptions,
  AudioTranscriptionStartResult,
  AudioTranscriptionUpdate,
} from "./types";

const TARGET_SAMPLE_RATE = 16000;
const PROCESSOR_BUFFER_SIZE = 2048;

type AudioTranscriptionBridge = {
  start: (options: AudioTranscriptionStartOptions) => Promise<AudioTranscriptionStartResult>;
  stop: () => Promise<AudioTranscriptionStartResult | void>;
  state: () => Promise<AudioTranscriptionStartResult | null>;
  sendAudio: (chunk: ArrayBuffer) => void;
  captureError: (message: string) => Promise<AudioTranscriptionStartResult | void>;
  onUpdate: (listener: (event: AudioTranscriptionUpdate) => void) => number;
  offUpdate: (subscriptionId: number) => void;
};

type CaptureSession = {
  stream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  pendingInput: Float32Array;
};

type WindowWithAudioBridge = Window & {
  audioTranscription?: AudioTranscriptionBridge;
};

let captureSession: CaptureSession | null = null;

function getBridge() {
  return (window as WindowWithAudioBridge).audioTranscription;
}

function concatFloat32(left: Float32Array, right: Float32Array) {
  if (left.length === 0) {
    return right;
  }

  const output = new Float32Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function downsampleTo16BitPcm(input: Float32Array, sourceSampleRate: number) {
  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new ArrayBuffer(outputLength * 2);
  const view = new DataView(output);
  let inputOffset = 0;

  for (let i = 0; i < outputLength; i += 1) {
    const nextOffset = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (; inputOffset < nextOffset && inputOffset < input.length; inputOffset += 1) {
      sum += input[inputOffset];
      count += 1;
    }

    const sample = Math.max(-1, Math.min(1, count > 0 ? sum / count : 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return {
    pcm: output,
    consumedSamples: Math.floor(outputLength * ratio),
  };
}

function stopRendererCapture() {
  if (!captureSession) {
    return;
  }

  captureSession.processor.disconnect();
  captureSession.source.disconnect();
  captureSession.stream.getTracks().forEach((track) => track.stop());
  void captureSession.audioContext.close();
  captureSession = null;
}

async function startRendererCapture(bridge: AudioTranscriptionBridge) {
  stopRendererCapture();

  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: {
      width: 1,
      height: 1,
      frameRate: 1,
    },
  });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("No system audio track was captured.");
  }

  const audioStream = new MediaStream(audioTracks);
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(audioStream);
  const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  const session: CaptureSession = {
    stream,
    audioContext,
    source,
    processor,
    pendingInput: new Float32Array(0),
  };

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    session.pendingInput = concatFloat32(session.pendingInput, new Float32Array(input));

    const { pcm, consumedSamples } = downsampleTo16BitPcm(
      session.pendingInput,
      audioContext.sampleRate
    );

    if (consumedSamples > 0) {
      session.pendingInput = session.pendingInput.slice(consumedSamples);
    }

    if (pcm.byteLength > 0) {
      bridge.sendAudio(pcm);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  captureSession = session;
}

export async function startAudioTranscription(
  options: AudioTranscriptionStartOptions
): Promise<AudioTranscriptionStartResult | null> {
  const bridge = getBridge();
  if (!bridge?.start || !bridge?.sendAudio) {
    return null;
  }

  try {
    const started = await bridge.start(options);
    if (started.status === "error") {
      return started;
    }

    await startRendererCapture(bridge);
    return started;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stopRendererCapture();

    if (bridge.captureError) {
      try {
        return (await bridge.captureError(message)) ?? null;
      } catch {
        return null;
      }
    }

    return null;
  }
}

export async function stopAudioTranscription() {
  const bridge = getBridge();
  stopRendererCapture();

  if (!bridge?.stop) {
    return null;
  }

  try {
    return await bridge.stop();
  } catch {
    return null;
  }
}

export async function getAudioTranscriptionState() {
  const bridge = getBridge();
  if (!bridge?.state) {
    return null;
  }

  try {
    return await bridge.state();
  } catch {
    return null;
  }
}

export function subscribeToAudioTranscriptionUpdates(
  listener: (event: AudioTranscriptionUpdate) => void
) {
  const bridge = getBridge();
  if (!bridge?.onUpdate || !bridge?.offUpdate) {
    return () => {};
  }

  const subscriptionId = bridge.onUpdate((event) => {
    if (event.type === "error" || event.type === "stopped") {
      stopRendererCapture();
    }

    listener(event);
  });
  return () => bridge.offUpdate(subscriptionId);
}
