import { modelLabel } from "./settings";
import type {
  ModelId,
  ProviderId,
  SpeechSession,
  SpeechSessionHandlers,
  TranscriptSettings,
} from "./types";

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MEDIARECORDER_TIMESLICE_MS = 250;
const STARTUP_STOP_GRACE_RECORDING_MS = 650;

interface DesktopTranscribeRequest {
  audioData: ArrayBuffer;
  language: string;
  mimeType: string;
  modelId: ModelId;
  providerId: ProviderId;
}

interface DesktopTranscribeResult {
  audioSeconds?: number;
  computeType?: string;
  cpuThreads?: number;
  decodeMs?: number;
  device?: string;
  message: string;
  modelLoadMs?: number;
  ok: boolean;
  providerId?: ProviderId;
  text?: string;
}

interface DesktopWhisperSessionOptions {
  preserveStartupStop?: boolean;
}

interface DesktopBridge {
  transcribeAudio?: (request: DesktopTranscribeRequest) => Promise<DesktopTranscribeResult>;
}

type BrowserWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    MediaRecorder?: typeof MediaRecorder;
    auralisDesktop?: DesktopBridge;
    navigator: Navigator & {
      mediaDevices?: Pick<MediaDevices, "getUserMedia">;
    };
  };

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

function bestAudioMimeType(target: BrowserWindow): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];

  for (const candidate of candidates) {
    if (!target.MediaRecorder?.isTypeSupported || target.MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function blobMimeType(recorder: MediaRecorder | null, fallback: string | undefined): string {
  return recorder?.mimeType || fallback || "audio/webm";
}

function startAudioMeter(
  target: BrowserWindow,
  stream: MediaStream,
  handlers: SpeechSessionHandlers,
): () => void {
  const AudioContextConstructor = target.AudioContext ?? target.webkitAudioContext;

  if (!handlers.onAudioLevel || !AudioContextConstructor) {
    return () => {};
  }

  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let timer: number | null = null;

  try {
    audioContext = new AudioContextConstructor();
    source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    timer = target.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;

      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sumSquares += centered * centered;
      }

      const rms = Math.sqrt(sumSquares / samples.length);
      handlers.onAudioLevel?.(Math.min(1, rms * 5));
    }, 120);
  } catch {
    handlers.onAudioLevel?.(0);
    return () => {};
  }

  return () => {
    if (timer !== null) {
      target.clearInterval(timer);
    }

    try {
      source?.disconnect();
    } catch {}

    void audioContext?.close().catch(() => {});
    handlers.onAudioLevel?.(0);
  };
}

export function desktopWhisperSupported(target: BrowserWindow): boolean {
  return Boolean(
    target.auralisDesktop?.transcribeAudio &&
      target.MediaRecorder &&
      target.navigator.mediaDevices?.getUserMedia,
  );
}

function providerTranscribingNotice(providerId: ProviderId): string {
  return providerId === "openrouter-stt"
    ? "Transcribing with OpenRouter STT. The API key stays in Electron main and is never exposed to the renderer."
    : "Transcribing locally with Whisper. This can take a few seconds.";
}

function transcriptionStatsMessage(
  result: DesktopTranscribeResult,
  settings: TranscriptSettings,
): string {
  const parts = [modelLabel(settings.modelId)];

  if (typeof result.modelLoadMs === "number") {
    parts.push(`load ${Math.round(result.modelLoadMs).toLocaleString()} ms`);
  }
  if (typeof result.decodeMs === "number") {
    parts.push(`decode ${Math.round(result.decodeMs).toLocaleString()} ms`);
  }
  if (typeof result.audioSeconds === "number") {
    parts.push(`${result.audioSeconds.toFixed(1)}s audio`);
  }
  if (result.device) {
    parts.push(result.device);
  }
  if (result.computeType) {
    parts.push(result.computeType);
  }
  if (typeof result.cpuThreads === "number") {
    parts.push(`${result.cpuThreads} CPU threads`);
  }

  return parts.join(" • ");
}

export function startDesktopWhisperSession(
  target: BrowserWindow,
  settings: TranscriptSettings,
  handlers: SpeechSessionHandlers,
  options: DesktopWhisperSessionOptions = {},
): SpeechSession {
  const transcribeAudio = target.auralisDesktop?.transcribeAudio;

  if (typeof transcribeAudio !== "function") {
    throw new Error("Desktop local Whisper is only available inside the Auralis desktop app.");
  }

  const transcribeAudioFn: (request: DesktopTranscribeRequest) => Promise<DesktopTranscribeResult> =
    transcribeAudio;

  if (!target.navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is unavailable in this desktop renderer.");
  }

  const MediaRecorderConstructor = target.MediaRecorder;

  if (!MediaRecorderConstructor) {
    throw new Error("This desktop renderer cannot record microphone audio for local Whisper.");
  }

  let ended = false;
  let recorder: MediaRecorder | null = null;
  let recorderStartedAt = 0;
  let recorderStopping = false;
  let startCancelled = false;
  let startupStopTimer: number | null = null;
  let stream: MediaStream | null = null;
  let transcribing = false;
  let stopMeter: (() => void) | null = null;
  const chunks: Blob[] = [];
  const mimeType = bestAudioMimeType(target);

  function finishOnce(): void {
    if (ended) {
      return;
    }

    ended = true;
    if (startupStopTimer !== null) {
      target.clearTimeout(startupStopTimer);
      startupStopTimer = null;
    }
    stopMeter?.();
    stopMeter = null;
    stopStream(stream);
    stream = null;
    handlers.onEnd();
  }

  function failOnce(message: string): void {
    if (ended) {
      return;
    }

    handlers.onError(message);
    finishOnce();
  }

  function stopRecorderNow(activeRecorder: MediaRecorder): void {
    if (recorderStopping || transcribing || activeRecorder.state === "inactive") {
      return;
    }

    recorderStopping = true;
    try {
      activeRecorder.requestData();
    } catch {}
    activeRecorder.stop();
  }

  function stopRecorderAfterStartupGrace(activeRecorder: MediaRecorder): void {
    const elapsedMs = recorderStartedAt > 0 ? Date.now() - recorderStartedAt : 0;
    const remainingMs = Math.max(0, STARTUP_STOP_GRACE_RECORDING_MS - elapsedMs);

    if (remainingMs === 0) {
      stopRecorderNow(activeRecorder);
      return;
    }

    if (startupStopTimer !== null) {
      return;
    }

    startupStopTimer = target.setTimeout(() => {
      startupStopTimer = null;
      stopRecorderNow(activeRecorder);
    }, remainingMs);
  }

  async function transcribeRecordedAudio(): Promise<void> {
    if (ended || transcribing) {
      return;
    }

    transcribing = true;

    stopMeter?.();
    stopMeter = null;
    stopStream(stream);
    stream = null;

    const audioBlob = new Blob(chunks, { type: blobMimeType(recorder, mimeType) });

    if (audioBlob.size === 0) {
      finishOnce();
      return;
    }

    if (audioBlob.size > MAX_AUDIO_BYTES) {
      failOnce(
        `Recorded audio is too large for local transcription. Keep recordings under ${Math.round(
          MAX_AUDIO_BYTES / 1024 / 1024,
        )} MB.`,
      );
      return;
    }

    handlers.onTranscribing?.();
    handlers.onNotice(providerTranscribingNotice(settings.providerId));

    try {
      const audioData = await audioBlob.arrayBuffer();

      if (ended) {
        return;
      }

      const result = await transcribeAudioFn({
        audioData,
        language: settings.language,
        mimeType: audioBlob.type || blobMimeType(recorder, mimeType),
        modelId: settings.modelId,
        providerId: settings.providerId,
      });

      if (ended) {
        return;
      }

      if (!result.ok) {
        failOnce(result.message || "Local Whisper transcription failed.");
        return;
      }

      const text = result.text?.trim() ?? "";
      if (text) {
        handlers.onResult({ finalText: text, interimText: "" });
      }

      handlers.onTranscriptionStats?.(transcriptionStatsMessage(result, settings));

      finishOnce();
    } catch (error) {
      if (ended) {
        return;
      }

      failOnce(error instanceof Error ? error.message : "Local Whisper transcription failed.");
    }
  }

  async function startRecording(): Promise<void> {
    try {
      stream = await target.navigator.mediaDevices.getUserMedia({ audio: true });
      stopMeter = startAudioMeter(target, stream, handlers);

      if (ended) {
        stopMeter?.();
        stopMeter = null;
        stopStream(stream);
        return;
      }

      recorder = mimeType
        ? new MediaRecorderConstructor(stream, { mimeType })
        : new MediaRecorderConstructor(stream);

      recorder.ondataavailable = (event) => {
        if (event.data?.size && !ended) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        failOnce("The local microphone recorder failed before Whisper could transcribe audio.");
      };

      recorder.onstart = () => {
        if (ended) {
          return;
        }

        recorderStartedAt = Date.now();
        handlers.onStart();
        handlers.onNotice("Recording locally. Speak now, then click Stop & transcribe.");

        const activeRecorder = recorder;
        if (startCancelled && activeRecorder && activeRecorder.state !== "inactive") {
          stopRecorderAfterStartupGrace(activeRecorder);
        }
      };

      recorder.onstop = () => {
        recorderStopping = false;
        void transcribeRecordedAudio();
      };

      recorder.start(MEDIARECORDER_TIMESLICE_MS);
    } catch (error) {
      failOnce(
        error instanceof Error
          ? error.message
          : "Could not start local microphone recording for Whisper.",
      );
    }
  }

  void startRecording();

  return {
    stop: () => {
      startCancelled = true;

      if (ended) {
        return;
      }

      if (recorderStopping || transcribing) {
        return;
      }

      if (recorder && recorder.state !== "inactive") {
        if (options.preserveStartupStop && (recorderStartedAt === 0 || startupStopTimer !== null)) {
          return;
        }

        if (
          options.preserveStartupStop &&
          Date.now() - recorderStartedAt < STARTUP_STOP_GRACE_RECORDING_MS
        ) {
          stopRecorderAfterStartupGrace(recorder);
          return;
        }

        stopRecorderNow(recorder);
        return;
      }

      if (options.preserveStartupStop) {
        return;
      }

      finishOnce();
    },
  };
}
