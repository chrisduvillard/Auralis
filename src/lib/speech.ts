import type {
  SpeechSession,
  SpeechSessionHandlers,
  SpeechUpdate,
  TranscriptSettings,
} from "./types";

type BrowserWindow = Window &
  typeof globalThis & {
    auralisDesktop?: unknown;
  };

function speechRecognitionConstructor(target: BrowserWindow): SpeechRecognitionConstructor | null {
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

export function browserSpeechSupported(target: BrowserWindow): boolean {
  return speechRecognitionConstructor(target) !== null;
}

export function browserSupportsLocalRecognition(target: BrowserWindow): boolean {
  const Recognition = speechRecognitionConstructor(target);

  if (!Recognition || target.auralisDesktop) {
    return false;
  }

  const recognition = new Recognition();
  return "processLocally" in recognition;
}

function buildSpeechUpdate(event: SpeechRecognitionEvent): SpeechUpdate {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = result[0]?.transcript.trim();

    if (!transcript) {
      continue;
    }

    if (result.isFinal) {
      finalParts.push(transcript);
      continue;
    }

    interimParts.push(transcript);
  }

  return {
    finalText: finalParts.join(" "),
    interimText: interimParts.join(" "),
  };
}

function speechErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case "audio-capture":
      return "No microphone audio was captured. Check the microphone input and browser permissions.";
    case "network":
      return "The browser speech service reported a network problem and could not connect. In Electron this can happen even when normal internet works because Chromium's remote Web Speech backend is unavailable; Electron on-device Web Speech is disabled because this Electron build cannot start it safely.";
    case "not-allowed":
      return "Microphone permission was denied. Allow microphone access and try again.";
    case "no-speech":
      return "No speech was detected. Try speaking a little closer to the microphone.";
    case "language-not-supported":
      return "The selected language is not available for this recognition mode. If you are using on-device recognition, install that language pack or switch back to Browser default engine.";
    default:
      return "Speech recognition stopped because the browser returned an unexpected error.";
  }
}

export function startBrowserSpeechSession(
  target: BrowserWindow,
  settings: TranscriptSettings,
  handlers: SpeechSessionHandlers,
): SpeechSession {
  const Recognition = speechRecognitionConstructor(target);

  if (!Recognition) {
    throw new Error("This browser does not expose the Web Speech recognition API.");
  }

  const RecognitionConstructor = Recognition;

  let activeRecognition: SpeechRecognition | null = null;
  let pendingLocalRetry = false;
  let sessionEnded = false;
  let stoppedByCaller = false;

  function finishOnce(): void {
    if (sessionEnded) {
      return;
    }

    sessionEnded = true;
    pendingLocalRetry = false;
    activeRecognition = null;
    handlers.onEnd();
  }

  function startRecognition({ forceLocal }: { forceLocal: boolean }): void {
    if (sessionEnded) {
      return;
    }

    const recognition = new RecognitionConstructor();
    activeRecognition = recognition;
    recognition.continuous = settings.continuous;
    recognition.interimResults = settings.interimResults;
    recognition.lang = settings.language;
    recognition.maxAlternatives = 1;

    const hasLocalRecognitionFlag = "processLocally" in recognition;
    const canUseLocalRecognition = hasLocalRecognitionFlag && !target.auralisDesktop;
    const shouldUseLocalRecognition = forceLocal || settings.modelId === "browser-local";

    if (shouldUseLocalRecognition) {
      // `processLocally` is an experimental Web Speech flag. Chrome/Edge variants may
      // expose it only when on-device recognition/language packs are available, so the
      // MVP treats it as a best-effort model preference rather than a guaranteed mode.
      if (canUseLocalRecognition) {
        recognition.processLocally = true;
      } else if (target.auralisDesktop && hasLocalRecognitionFlag) {
        handlers.onNotice(
          "Electron exposes on-device Web Speech, but this Electron build cannot start it safely; using the browser default speech engine.",
        );
      } else {
        handlers.onNotice(
          "This browser does not expose on-device speech recognition; falling back to the browser default engine.",
        );
      }
    }

    recognition.onstart = () => {
      if (recognition !== activeRecognition || sessionEnded) {
        return;
      }

      handlers.onStart();
    };

    recognition.onresult = (event) => {
      if (recognition !== activeRecognition || sessionEnded) {
        return;
      }

      handlers.onResult(buildSpeechUpdate(event));
    };

    recognition.onerror = (event) => {
      if (recognition !== activeRecognition || sessionEnded) {
        return;
      }

      if (
        event.error === "network" &&
        canUseLocalRecognition &&
        settings.modelId !== "browser-local" &&
        !forceLocal &&
        !stoppedByCaller
      ) {
        pendingLocalRetry = true;
        return;
      }

      handlers.onError(speechErrorMessage(event.error));
    };

    recognition.onend = () => {
      if (recognition !== activeRecognition) {
        return;
      }

      if (pendingLocalRetry && !stoppedByCaller) {
        pendingLocalRetry = false;
        handlers.onNotice(
          "The browser speech service reported a network problem. Retrying with on-device speech recognition.",
        );
        startRecognition({ forceLocal: true });
        return;
      }

      finishOnce();
    };

    recognition.start();
  }

  startRecognition({ forceLocal: false });

  return {
    stop: () => {
      stoppedByCaller = true;
      pendingLocalRetry = false;
      activeRecognition?.stop();
    },
  };
}
