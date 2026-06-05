import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  browserSpeechSupported,
  browserSupportsLocalRecognition,
  startBrowserSpeechSession,
} from "../lib/speech";

class RecognitionWithLocalSupport {
  static latest: RecognitionWithLocalSupport | null = null;

  continuous = false;
  interimResults = false;
  lang = "en-US";
  maxAlternatives = 1;
  processLocally = false;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;

  constructor() {
    RecognitionWithLocalSupport.latest = this;
  }

  abort(): void {}

  start(): void {
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.onend?.(new Event("end"));
  }
}

class RecognitionWithoutLocalSupport {
  static latest: RecognitionWithoutLocalSupport | null = null;

  continuous = false;
  interimResults = false;
  lang = "en-US";
  maxAlternatives = 1;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;

  constructor() {
    RecognitionWithoutLocalSupport.latest = this;
  }

  abort(): void {}

  start(): void {
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.onend?.(new Event("end"));
  }
}

class RecognitionWithRetrySupport {
  static instances: RecognitionWithRetrySupport[] = [];

  continuous = false;
  interimResults = false;
  lang = "en-US";
  maxAlternatives = 1;
  processLocally = false;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;

  constructor() {
    RecognitionWithRetrySupport.instances.push(this);
  }

  abort(): void {
    this.onend?.(new Event("end"));
  }

  emitError(error: string): void {
    this.onerror?.({ error } as SpeechRecognitionErrorEvent);
  }

  emitFinal(text: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: {
        0: {
          0: { confidence: 0.99, transcript: text },
          isFinal: true,
          length: 1,
        },
        length: 1,
      },
    } as unknown as SpeechRecognitionEvent);
  }

  start(): void {
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.onend?.(new Event("end"));
  }
}

function fakeSpeechEvent(): SpeechRecognitionEvent {
  return {
    resultIndex: 0,
    results: {
      0: {
        0: { confidence: 0.91, transcript: "ship the release" },
        isFinal: true,
        length: 1,
      },
      1: {
        0: { confidence: 0.4, transcript: "drafting" },
        isFinal: false,
        length: 1,
      },
      length: 2,
    },
  } as unknown as SpeechRecognitionEvent;
}

describe("speech provider", () => {
  it("detects vendor-prefixed browser support", () => {
    const target = {
      webkitSpeechRecognition: RecognitionWithoutLocalSupport,
    } as unknown as Window & typeof globalThis;

    expect(browserSpeechSupported(target)).toBe(true);
  });

  it("detects local recognition support when processLocally exists", () => {
    const target = { SpeechRecognition: RecognitionWithLocalSupport } as unknown as Window &
      typeof globalThis;

    expect(browserSupportsLocalRecognition(target)).toBe(true);
  });

  it("disables local recognition support inside Electron even when Chromium exposes the flag", () => {
    const target = {
      SpeechRecognition: RecognitionWithLocalSupport,
      auralisDesktop: { platform: "linux", shortcutLabel: "Ctrl + Alt + Space" },
    } as unknown as Window & typeof globalThis;

    expect(browserSupportsLocalRecognition(target)).toBe(false);
  });

  it("applies settings and forwards speech updates", () => {
    const target = { SpeechRecognition: RecognitionWithLocalSupport } as unknown as Window &
      typeof globalThis;
    const notices: string[] = [];
    const updates: Array<{ finalText: string; interimText: string }> = [];
    const onStart = vi.fn();
    const onEnd = vi.fn();

    const session = startBrowserSpeechSession(
      target,
      { ...DEFAULT_SETTINGS, modelId: "browser-local", language: "fr-FR" },
      {
        onEnd,
        onError: vi.fn(),
        onNotice: (message) => notices.push(message),
        onResult: (update) => updates.push(update),
        onStart,
      },
    );

    const recognition = RecognitionWithLocalSupport.latest;

    expect(recognition?.lang).toBe("fr-FR");
    expect(recognition?.processLocally).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(notices).toEqual([]);

    recognition?.onresult?.(fakeSpeechEvent());
    session.stop();

    expect(updates).toEqual([{ finalText: "ship the release", interimText: "drafting" }]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("announces fallback when local recognition is unavailable", () => {
    const target = { SpeechRecognition: RecognitionWithoutLocalSupport } as unknown as Window &
      typeof globalThis;
    const notices: string[] = [];

    startBrowserSpeechSession(
      target,
      { ...DEFAULT_SETTINGS, modelId: "browser-local" },
      {
        onEnd: vi.fn(),
        onError: vi.fn(),
        onNotice: (message) => notices.push(message),
        onResult: vi.fn(),
        onStart: vi.fn(),
      },
    );

    expect(notices[0]).toContain("falling back");
  });

  it("retries network failures with on-device recognition when the browser exposes it", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = { SpeechRecognition: RecognitionWithRetrySupport } as unknown as Window &
      typeof globalThis;
    const notices: string[] = [];
    const errors: string[] = [];
    const starts: string[] = [];
    const onEnd = vi.fn();

    const session = startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: (message) => notices.push(message),
      onResult: vi.fn(),
      onStart: () => starts.push("started"),
    });

    const firstRecognition = RecognitionWithRetrySupport.instances[0];
    expect(firstRecognition?.processLocally).toBe(false);

    firstRecognition?.emitError("network");
    firstRecognition?.stop();

    const retryRecognition = RecognitionWithRetrySupport.instances[1];
    expect(errors).toEqual([]);
    expect(notices[0]).toContain("Retrying with on-device speech recognition");
    expect(retryRecognition?.processLocally).toBe(true);
    expect(starts).toHaveLength(2);
    expect(onEnd).not.toHaveBeenCalled();

    session.stop();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not retry a network failure after the user explicitly stops", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = { SpeechRecognition: RecognitionWithRetrySupport } as unknown as Window &
      typeof globalThis;
    const notices: string[] = [];
    const errors: string[] = [];
    const onEnd = vi.fn();

    const session = startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: (message) => notices.push(message),
      onResult: vi.fn(),
      onStart: vi.fn(),
    });

    RecognitionWithRetrySupport.instances[0]?.emitError("network");
    session.stop();
    RecognitionWithRetrySupport.instances[0]?.stop();

    expect(RecognitionWithRetrySupport.instances).toHaveLength(1);
    expect(notices).toEqual([]);
    expect(errors).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("does not retry network failures with unsafe on-device recognition inside Electron", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = {
      SpeechRecognition: RecognitionWithRetrySupport,
      auralisDesktop: { platform: "linux", shortcutLabel: "Ctrl + Alt + Space" },
    } as unknown as Window & typeof globalThis;
    const notices: string[] = [];
    const errors: string[] = [];
    const onEnd = vi.fn();

    const session = startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: (message) => notices.push(message),
      onResult: vi.fn(),
      onStart: vi.fn(),
    });

    RecognitionWithRetrySupport.instances[0]?.emitError("network");
    session.stop();

    expect(RecognitionWithRetrySupport.instances).toHaveLength(1);
    expect(notices).toEqual([]);
    expect(errors[0]).toContain("on-device Web Speech is disabled");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores stale callbacks from the first recognizer after retry starts", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = { SpeechRecognition: RecognitionWithRetrySupport } as unknown as Window &
      typeof globalThis;
    const errors: string[] = [];
    const updates: string[] = [];
    const onEnd = vi.fn();

    startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: vi.fn(),
      onResult: (update) => updates.push(update.finalText),
      onStart: vi.fn(),
    });

    const firstRecognition = RecognitionWithRetrySupport.instances[0];
    firstRecognition?.emitError("network");
    firstRecognition?.stop();
    const retryRecognition = RecognitionWithRetrySupport.instances[1];

    firstRecognition?.emitError("network");
    firstRecognition?.emitFinal("stale first recognizer text");
    retryRecognition?.stop();

    expect(RecognitionWithRetrySupport.instances).toHaveLength(2);
    expect(errors).toEqual([]);
    expect(updates).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores callbacks after the session has ended", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = { SpeechRecognition: RecognitionWithRetrySupport } as unknown as Window &
      typeof globalThis;
    const errors: string[] = [];
    const updates: string[] = [];
    const onEnd = vi.fn();

    const session = startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: vi.fn(),
      onResult: (update) => updates.push(update.finalText),
      onStart: vi.fn(),
    });

    const recognition = RecognitionWithRetrySupport.instances[0];
    session.stop();
    recognition?.emitError("network");
    recognition?.emitFinal("late text");
    recognition?.stop();

    expect(RecognitionWithRetrySupport.instances).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(updates).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("surfaces the final error when the on-device retry cannot transcribe", () => {
    RecognitionWithRetrySupport.instances = [];
    const target = { SpeechRecognition: RecognitionWithRetrySupport } as unknown as Window &
      typeof globalThis;
    const errors: string[] = [];
    const onEnd = vi.fn();

    startBrowserSpeechSession(target, DEFAULT_SETTINGS, {
      onEnd,
      onError: (message) => errors.push(message),
      onNotice: vi.fn(),
      onResult: vi.fn(),
      onStart: vi.fn(),
    });

    RecognitionWithRetrySupport.instances[0]?.emitError("network");
    RecognitionWithRetrySupport.instances[0]?.stop();
    RecognitionWithRetrySupport.instances[1]?.emitError("language-not-supported");
    RecognitionWithRetrySupport.instances[1]?.stop();

    expect(RecognitionWithRetrySupport.instances).toHaveLength(2);
    expect(errors[0]).toContain("selected language is not available");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
