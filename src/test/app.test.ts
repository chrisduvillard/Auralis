import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mountVoiceToTextApp } from "../app";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { MAX_ENTRY_TEXT_LENGTH, MAX_HISTORY_ITEMS, MAX_IMPORT_FILE_BYTES } from "../lib/storage";
import type { TranscriptEntry, TranscriptSettings } from "../lib/types";

type MutableWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    auralisDesktop?: {
      copyText?: (text: string) => Promise<{ ok: boolean; message: string }>;
      getInfo?: () => Promise<{
        appVersion?: string;
        ok: boolean;
        platform: string;
        shortcutLabel: string;
        shortcutWarnings?: string[];
        toggleShortcutLabel?: string | null;
      }>;
      installUpdate?: () => Promise<{ ok: boolean; message: string }>;
      notify?: (message: string) => Promise<{ ok: boolean; message: string }>;
      pasteText?: (
        text: string,
        pasteTargetToken?: string | null,
      ) => Promise<{ ok: boolean; message: string; pasted: boolean }>;
      platform: string;
      setCaptureState?: (payload: { muteSystemAudio: boolean; status: string }) => void;
      shortcutLabel: string;
      transcribeAudio?: (request: {
        audioData: ArrayBuffer;
        language: string;
        mimeType: string;
        modelId: TranscriptSettings["modelId"];
        providerId: TranscriptSettings["providerId"];
      }) => Promise<{
        audioSeconds?: number;
        decodeMs?: number;
        message: string;
        modelLoadMs?: number;
        ok: boolean;
        providerId?: TranscriptSettings["providerId"];
        text?: string;
      }>;
      setupWhisperRuntime?: (modelId: string) => Promise<{
        ok: boolean;
        message: string;
        modelId?: string;
        python?: string;
        state: string;
        version?: string;
      }>;
      whisperStatus?: (modelId: string) => Promise<{
        ok: boolean;
        message: string;
        modelId?: string;
        python?: string;
        state: string;
        version?: string;
      }>;
    };
    MediaRecorder?: typeof MediaRecorder;
    navigator: Navigator & { clipboard?: { writeText: (text: string) => Promise<void> } };
  };

class FakeRecognition {
  static latest: FakeRecognition | null = null;

  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;
  started = false;
  stopped = false;

  constructor() {
    FakeRecognition.latest = this;
  }

  abort(): void {
    this.stopped = true;
  }

  addEventListener(): void {}

  dispatchEvent(_event: Event): boolean {
    return true;
  }

  removeEventListener(): void {}

  start(): void {
    this.started = true;
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.stopped = true;
    this.onend?.(new Event("end"));
  }

  emitFinal(text: string): void {
    this.onresult?.({
      resultIndex: 0,
      results: {
        0: {
          0: { confidence: 0.98, transcript: text },
          isFinal: true,
          length: 1,
        },
        length: 1,
      },
    } as unknown as SpeechRecognitionEvent);
  }

  emitError(error: string): void {
    this.onerror?.({ error } as SpeechRecognitionErrorEvent);
  }
}

class LocalRetryRecognition extends FakeRecognition {
  static instances: LocalRetryRecognition[] = [];

  processLocally = false;

  constructor() {
    super();
    LocalRetryRecognition.instances.push(this);
  }
}

class FakeMediaRecorder {
  static latest: FakeMediaRecorder | null = null;
  static isTypeSupported(): boolean {
    return true;
  }

  mimeType = "audio/webm";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  requestDataCalls = 0;
  startTimeslice: number | undefined;
  state: RecordingState = "inactive";

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.latest = this;
  }

  requestData(): void {
    this.requestDataCalls += 1;
  }

  start(timeslice?: number): void {
    this.startTimeslice = timeslice;
    this.state = "recording";
    this.onstart?.(new Event("start"));
  }

  stop(): void {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["fake local microphone audio"], { type: this.mimeType }),
    } as BlobEvent);
    this.onstop?.(new Event("stop"));
  }
}

function installFakeMediaRecorder(): { stoppedTracks: string[] } {
  const stoppedTracks: string[] = [];
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () =>
        ({
          getTracks: () => [
            {
              stop: () => {
                stoppedTracks.push("audio");
              },
            },
          ],
        }) as unknown as MediaStream,
    },
  });
  return { stoppedTracks };
}

function mountApp(
  options: {
    desktop?: boolean;
    failClipboard?: boolean;
    recognitionConstructor?: SpeechRecognitionConstructor;
  } = {},
): {
  root: HTMLDivElement;
  clipboardWrites: string[];
} {
  const root = document.createElement("div");
  const clipboardWrites: string[] = [];
  document.body.append(root);

  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    value: options.recognitionConstructor ?? FakeRecognition,
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (options.failClipboard) {
          throw new Error("clipboard blocked");
        }
        clipboardWrites.push(text);
      },
    },
  });
  if (options.desktop !== undefined) {
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: options.desktop
        ? {
            platform: "linux",
            shortcutLabel: "Ctrl + Alt + Space",
          }
        : undefined,
    });
  }

  mountVoiceToTextApp(root, window as MutableWindow);

  return { root, clipboardWrites };
}

function enableTranscriptHistory(overrides: Partial<TranscriptSettings> = {}): void {
  localStorage.setItem(
    "auralis:settings:v1",
    JSON.stringify({ ...DEFAULT_SETTINGS, saveTranscriptHistory: true, ...overrides }),
  );
}

function sampleEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    id: "entry-1",
    text: "Ship the patch after lunch.",
    createdAt: "2026-05-11T12:00:00.000Z",
    providerId: "browser-speech",
    modelId: "browser-default",
    language: "en-US",
    durationMs: 4200,
    ...overrides,
  };
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  );

  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${name}`);
  }

  return match;
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe("Auralis app UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: undefined,
    });
    FakeRecognition.latest = null;
    FakeMediaRecorder.latest = null;
    LocalRetryRecognition.instances = [];
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window.navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adapts primary guidance for browser-only use", () => {
    const { root } = mountApp({ desktop: false });

    expect(root.textContent).toContain("Dictate in the browser. Polish. Copy.");
    expect(root.textContent).toContain("Use the Start listening button in this window.");
    expect(root.textContent).toContain("Copy to clipboard");
    expect(root.textContent).not.toContain("Press the shortcut");
  });

  it("keeps the app shell understated instead of trend-led decorative chrome", () => {
    const { root } = mountApp({ desktop: false });
    const shell = root.querySelector<HTMLElement>('[data-field="shell"]');

    expect(shell?.dataset.theme).toBeUndefined();
    expect(root.querySelector('[data-field="theme-atmosphere"]')).toBeNull();
    expect(root.querySelector(".brand-mark__glyph")).toBeNull();
    expect(root.textContent).toContain("Private speech to text");
    expect(root.textContent).not.toContain("Secure local dictation");
    expect(root.querySelector(".flow-steps")).toBeNull();
    expect(root.querySelector(".command-strip")).toBeNull();
  });

  it("uses a clearer compact headline for desktop dictation", () => {
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
      },
    });

    const { root } = mountApp();
    const heroTitle = root.querySelector<HTMLElement>('[data-field="hero-title"]');

    expect(heroTitle?.textContent).toBe("Record. Transcribe. Paste.");
    expect(root.textContent).not.toContain("Stay put. Dictate. Insert.");
  });

  it("guides OpenRouter users toward fast and higher-quality transcription models", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        continuous: true,
        interimResults: true,
        language: "en-US",
        modelId: "openrouter-whisper-large-v3-turbo",
        muteSystemAudio: true,
        providerId: "openrouter-stt",
      }),
    );
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
      },
    });

    const { root } = mountApp();
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');
    const modelNote = root.querySelector<HTMLElement>('[data-field="model-note"]');
    const optionLabels = [...(model?.options ?? [])].map((option) => option.textContent);

    expect(optionLabels).toContain("OpenRouter Whisper Large v3 Turbo (fastest)");
    expect(optionLabels).toContain("OpenRouter GPT-4o Mini Transcribe (balanced)");
    expect(optionLabels).toContain("OpenRouter GPT-4o Transcribe (best quality)");
    expect(modelNote?.textContent).toContain("Recommended for speed: Whisper Large v3 Turbo");
    expect(modelNote?.textContent).toContain("GPT-4o Mini Transcribe");
    expect(modelNote?.textContent).toContain("OPENROUTER_API_KEY");
  });

  it("shows a compact first-run readiness card without expanding advanced settings", () => {
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
        whisperStatus: async (modelId: string) => ({
          message: "Local Whisper base is not installed yet.",
          modelId,
          ok: false,
          state: "missing",
        }),
      },
    });

    const { root } = mountApp();
    const engineSettings = root.querySelector<HTMLDetailsElement>('[data-field="engine-settings"]');
    const setupChecklist = root.querySelector<HTMLElement>('[data-field="setup-checklist"]');
    const provider = root.querySelector<HTMLSelectElement>('[data-setting="providerId"]');
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');

    expect(setupChecklist).toBeInstanceOf(HTMLElement);
    expect(setupChecklist?.textContent).toContain("First-run readiness");
    expect(setupChecklist?.textContent).toContain("Private offline");
    expect(setupChecklist?.textContent).toContain("Fast cloud");
    expect(setupChecklist?.textContent).toContain("Mic permission appears on first recording");
    expect(setupChecklist?.textContent).toContain("Shortcut and paste test");
    expect(provider?.value).toBe("desktop-whisper");
    expect(model?.value).toBe("desktop-whisper-base");
    expect(engineSettings).toBeInstanceOf(HTMLDetailsElement);
    expect(engineSettings?.open).toBe(false);
  });

  it("uses one primary capture button that toggles start and stop", () => {
    const { root } = mountApp();

    expect(root.querySelector('[data-action="stop"]')).toBeNull();
    button(root, "Start listening").click();
    expect(root.textContent).toContain("Listening live");
    button(root, "Stop").click();

    expect(FakeRecognition.latest?.stopped).toBe(true);
    expect(root.textContent).toContain("No speech was captured, so nothing was saved.");
  });

  it("keeps the default workspace focused with the archive tucked away", () => {
    const { root } = mountApp({ desktop: false });
    const workspace = root.querySelector<HTMLElement>('[data-field="workspace"]');
    const historySection = root.querySelector<HTMLDetailsElement>('[data-field="history-section"]');
    const historySummary = root.querySelector<HTMLElement>('[data-field="history-summary-copy"]');

    expect(workspace?.dataset.layout).toBe("focus");
    expect(historySection).toBeInstanceOf(HTMLDetailsElement);
    expect(historySection?.open).toBe(false);
    expect(historySummary?.textContent).toContain("0 saved");
  });

  it("opens the archive by default when saved transcripts exist", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "saved-default", text: "Keep this visible" })]),
    );

    const { root } = mountApp({ desktop: false });
    const workspace = root.querySelector<HTMLElement>('[data-field="workspace"]');
    const historySection = root.querySelector<HTMLDetailsElement>('[data-field="history-section"]');
    const historySummary = root.querySelector<HTMLElement>('[data-field="history-summary-copy"]');

    expect(workspace?.dataset.layout).toBe("review");
    expect(historySection?.open).toBe(true);
    expect(historySummary?.textContent).toContain("1 saved");
  });

  it("hides the first-run readiness card after saved settings exist", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        continuous: true,
        interimResults: true,
        language: "en-US",
        modelId: "desktop-whisper-base",
        muteSystemAudio: true,
        providerId: "desktop-whisper",
      }),
    );
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
      },
    });

    const { root } = mountApp();
    const engineSettings = root.querySelector<HTMLDetailsElement>('[data-field="engine-settings"]');

    expect(root.querySelector('[data-field="setup-checklist"]')).toBeNull();
    expect(root.textContent).not.toContain("Desktop setup checklist");
    expect(engineSettings).toBeInstanceOf(HTMLDetailsElement);
    expect(engineSettings?.open).toBe(false);
  });

  it("offers a desktop update button that installs the latest packaged release", async () => {
    const installUpdate = vi.fn(async () => ({
      message: "Update downloaded. Restarting Auralis to install.",
      ok: true,
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        installUpdate,
        platform: "win32",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root } = mountApp();
    const updateCard = root.querySelector<HTMLElement>('[data-field="app-update-card"]');

    expect(updateCard).toBeInstanceOf(HTMLElement);
    expect(updateCard?.hidden).toBe(false);
    expect(updateCard?.textContent).toContain("Update Auralis");

    button(root, "Update now").click();

    await vi.waitFor(() => expect(installUpdate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Update downloaded. Restarting Auralis to install."),
    );
  });

  it("shows the installed version returned by the desktop info bridge", async () => {
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        getInfo: async () => ({
          appVersion: "0.2.0",
          ok: true,
          platform: "win32",
          shortcutLabel: "Ctrl + Alt + Space toggles from any app",
          shortcutWarnings: [],
        }),
        installUpdate: async () => ({
          message: "Update downloaded. Restarting Auralis to install.",
          ok: true,
        }),
        platform: "win32",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root } = mountApp();

    await vi.waitFor(() =>
      expect(root.querySelector('[data-field="app-update-card"]')?.textContent).toContain("v0.2.0"),
    );
  });

  it("disables the desktop update button while installing the latest release", async () => {
    let resolveInstallUpdate: (value: { message: string; ok: boolean }) => void = () => undefined;
    const installUpdate = vi.fn(
      () =>
        new Promise<{ message: string; ok: boolean }>((resolve) => {
          resolveInstallUpdate = resolve;
        }),
    );
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        installUpdate,
        platform: "win32",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root } = mountApp();
    const updateButton = button(root, "Update now");

    updateButton.click();

    await vi.waitFor(() => expect(updateButton.disabled).toBe(true));
    expect(updateButton.textContent).toBe("Updating...");

    resolveInstallUpdate({
      message: "Update downloaded. Restarting Auralis to install.",
      ok: true,
    });

    await vi.waitFor(() => expect(updateButton.disabled).toBe(false));
    expect(updateButton.textContent).toBe("Update now");
  });

  it("keeps the update button out of browser-only mode", () => {
    const { root } = mountApp({ desktop: false });

    expect(root.querySelector('[data-field="app-update-card"]')).toBeNull();
    expect(root.textContent).not.toContain("Update now");
  });

  it("expands and collapses long saved transcript previews", () => {
    const longText = `${"Long saved transcript sentence. ".repeat(12)}Final sentence.`;
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "long-entry", text: longText })]),
    );

    const { root } = mountApp();

    expect(root.querySelector<HTMLElement>(".history-item__text")?.dataset.expanded).toBe("false");
    const expandButton = button(root, "Expand");
    expect(expandButton.getAttribute("aria-expanded")).toBe("false");
    expandButton.click();
    expect(root.querySelector<HTMLElement>(".history-item__text")?.dataset.expanded).toBe("true");
    const collapseButton = button(root, "Collapse");
    expect(collapseButton.getAttribute("aria-expanded")).toBe("true");
    collapseButton.click();
    expect(root.querySelector<HTMLElement>(".history-item__text")?.dataset.expanded).toBe("false");
  });

  it("captures speech, saves history, reloads history, and copies the transcript", async () => {
    enableTranscriptHistory();
    const { root, clipboardWrites } = mountApp();

    button(root, "Start listening").click();
    expect(root.textContent).toContain("Listening live");
    expect(button(root, "Stop").disabled).toBe(false);

    FakeRecognition.latest?.emitFinal("hello from the microphone");
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
      "hello from the microphone",
    );

    button(root, "Stop").click();
    expect(FakeRecognition.latest?.stopped).toBe(true);
    expect(root.textContent).toContain("Transcript saved locally.");
    expect(root.textContent).toContain("hello from the microphone");
    expect(root.textContent).toContain("Browser Web Speech API");
    expect(root.textContent).toContain("Browser default engine");

    button(root, "Copy").click();
    await vi.waitFor(() => expect(clipboardWrites).toContain("hello from the microphone"));
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Transcript copied to the clipboard."),
    );

    const historyCopyButton = root.querySelector<HTMLButtonElement>('[data-entry-action="copy"]');
    historyCopyButton?.click();
    await vi.waitFor(() => expect(clipboardWrites).toHaveLength(2));
    expect(clipboardWrites[1]).toBe("hello from the microphone");
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Saved transcript copied to the clipboard."),
    );

    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");
    if (!transcript) {
      throw new Error("Transcript area did not render");
    }
    transcript.value = "temporary editor text";
    transcript.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>('[data-entry-action="use"]')?.click();
    expect(transcript.value).toBe("hello from the microphone");
    expect(root.textContent).toContain("Saved transcript loaded into the editor.");

    root.querySelector<HTMLButtonElement>('[data-entry-action="delete"]')?.click();
    expect(root.textContent).toContain("Saved transcript removed.");
    expect(root.querySelector<HTMLDetailsElement>('[data-field="history-section"]')?.open).toBe(
      true,
    );
    expect(root.textContent).toContain(
      "Saved transcripts will appear here after you finish a recording.",
    );
    expect(root.textContent).not.toContain("Browser default engine • 1s");

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal("hello from the microphone");
    button(root, "Stop").click();

    const remounted = document.createElement("div");
    document.body.replaceChildren(remounted);
    mountVoiceToTextApp(remounted, window as MutableWindow);

    expect(remounted.textContent).toContain("hello from the microphone");
    expect(remounted.textContent).toContain("Browser Web Speech API");
  });

  it("captures speech without saving history when local archive is disabled", async () => {
    enableTranscriptHistory();
    const { root, clipboardWrites } = mountApp();
    const saveHistoryCheckbox = root.querySelector<HTMLInputElement>(
      '[data-setting="saveTranscriptHistory"]',
    );
    if (!saveHistoryCheckbox) {
      throw new Error("Missing save history checkbox");
    }
    expect(saveHistoryCheckbox.checked).toBe(true);

    saveHistoryCheckbox.checked = false;
    saveHistoryCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    const persistedSettings = JSON.parse(localStorage.getItem("auralis:settings:v1") ?? "{}");
    expect(persistedSettings.saveTranscriptHistory).toBe(false);

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal("private unsaved dictation");
    button(root, "Stop").click();

    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
      "private unsaved dictation",
    );
    expect(root.textContent).toContain("Transcript ready. History saving is off.");
    expect(root.textContent).toContain("0 saved transcripts");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();

    button(root, "Copy").click();
    await vi.waitFor(() => expect(clipboardWrites).toContain("private unsaved dictation"));
  });

  it("keeps oversized desktop transcripts editor-only when local archive is disabled", async () => {
    installFakeMediaRecorder();
    const longTranscript = "x".repeat(MAX_ENTRY_TEXT_LENGTH + 1);
    const copyText = vi.fn(async () => ({
      message: "Transcript copied to the clipboard.",
      ok: true,
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        copyText,
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: longTranscript,
        }),
      },
    });

    const { root } = mountApp();
    const saveHistoryCheckbox = root.querySelector<HTMLInputElement>(
      '[data-setting="saveTranscriptHistory"]',
    );
    if (!saveHistoryCheckbox) {
      throw new Error("Missing save history checkbox");
    }
    saveHistoryCheckbox.checked = false;
    saveHistoryCheckbox.dispatchEvent(new Event("change", { bubbles: true }));

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() =>
      expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
        longTranscript,
      ),
    );
    expect(root.textContent).toContain("Transcript ready. History saving is off.");
    expect(root.textContent).not.toContain("Transcript is too long to save locally");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
    expect(copyText).toHaveBeenCalledWith(longTranscript);
  });

  it("surfaces desktop app mode and responds to desktop shortcut events", async () => {
    enableTranscriptHistory();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        getInfo: async () => ({
          ok: true,
          platform: "linux",
          pasteShortcutLabel: "Ctrl+Shift+Enter",
          shortcutLabel: "Ctrl + Shift + Alt + Space toggles from any app",
          shortcutWarnings: [
            "Ctrl + Alt + Space was unavailable, so Auralis registered Ctrl + Shift + Alt + Space instead.",
          ],
        }),
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root, clipboardWrites } = mountApp();

    expect(root.textContent).toContain("Local desktop dictation");
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Ctrl + Shift + Alt + Space toggles from any app"),
    );
    expect(root.textContent).toContain("Ctrl + Alt + Space was unavailable");
    expect(root.textContent).toContain("Ctrl+Shift+Enter pastes again");

    window.dispatchEvent(new CustomEvent("auralis:desktop-toggle-dictation"));
    expect(root.textContent).toContain("Listening live");

    FakeRecognition.latest?.emitFinal("desktop shortcut text");
    window.dispatchEvent(new CustomEvent("auralis:desktop-toggle-dictation"));

    expect(FakeRecognition.latest?.stopped).toBe(true);
    expect(root.textContent).toContain("Transcript saved locally.");

    window.dispatchEvent(new CustomEvent("auralis:desktop-copy-transcript"));
    await vi.waitFor(() => expect(clipboardWrites).toContain("desktop shortcut text"));
  });

  it("uses the fallback toggle label in shortcut-start notifications when hold-to-talk is primary", async () => {
    const notify = vi.fn(async (message: string) => ({ message, ok: true }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        notify,
        platform: "linux",
        shortcutLabel: "Hold Ctrl + Win to dictate from any app",
        toggleShortcutLabel: "Ctrl + Alt + Space",
      },
    });

    mountApp();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: { autoPaste: false, startedFromShortcut: true },
      }),
    );

    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Press Ctrl + Alt + Space again to stop"),
      ),
    );
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("Press Hold Ctrl + Win"));
  });

  it("copies without pasting when the desktop shortcut has no fresh target", async () => {
    const copyText = vi.fn(async () => ({
      message: "Transcript copied to the clipboard.",
      ok: true,
    }));
    const pasteText = vi.fn(async () => ({
      message: "Should not paste without a fresh target.",
      ok: true,
      pasted: true,
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        copyText,
        pasteText,
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root } = mountApp();

    window.dispatchEvent(new CustomEvent("auralis:desktop-toggle-dictation"));
    FakeRecognition.latest?.emitFinal("copy only without a fresh target");
    window.dispatchEvent(new CustomEvent("auralis:desktop-toggle-dictation"));

    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("copy only without a fresh target"),
    );
    expect(pasteText).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Transcript copied to the clipboard."),
    );
  });

  it("automatically copies and pastes a completed desktop shortcut dictation", async () => {
    enableTranscriptHistory();
    const pasteText = vi.fn(async (text: string) => ({
      message: `Inserted: ${text}`,
      ok: true,
      pasted: true,
    }));
    const notify = vi.fn(async (message: string) => ({ message, ok: true }));
    const captureStates: Array<{ muteSystemAudio: boolean; status: string }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        notify,
        pasteText,
        platform: "linux",
        setCaptureState: (payload: { muteSystemAudio: boolean; status: string }) =>
          captureStates.push(payload),
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
      },
    });

    const { root } = mountApp();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: { autoPaste: true, startedFromShortcut: true },
      }),
    );
    await vi.waitFor(() =>
      expect(captureStates).toContainEqual({ muteSystemAudio: true, status: "listening" }),
    );
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.stringContaining("Recording")),
    );
    FakeRecognition.latest?.emitFinal("send this to the focused app");
    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: { autoPaste: false, startedFromShortcut: true },
      }),
    );

    await vi.waitFor(() => expect(pasteText).toHaveBeenCalledWith("send this to the focused app"));
    await vi.waitFor(() =>
      expect(captureStates.at(-1)).toEqual({ muteSystemAudio: false, status: "idle" }),
    );
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Inserted: send this to the focused app"),
    );
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith("Inserted: send this to the focused app"),
    );
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")[0]?.text).toBe(
      "send this to the focused app",
    );
  });

  it("automatically inserts local Whisper output after Stop & transcribe", async () => {
    installFakeMediaRecorder();
    const pasteText = vi.fn(async (text: string) => ({
      message: `Inserted locally: ${text}`,
      ok: true,
      pasted: true,
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        pasteText,
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "local whisper text for cursor",
        }),
      },
    });

    const { root } = mountApp();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", { detail: { autoPaste: true } }),
    );
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", { detail: { autoPaste: true } }),
    );

    await vi.waitFor(() => expect(pasteText).toHaveBeenCalledWith("local whisper text for cursor"));
    expect(root.textContent).toContain("Inserted locally: local whisper text for cursor");
  });

  it("does not turn duplicate hold-start events into stop events", async () => {
    installFakeMediaRecorder();
    const pasteText = vi.fn(async (text: string) => ({
      message: `Inserted: ${text}`,
      ok: true,
      pasted: true,
    }));
    const transcribeAudio = vi.fn(async () => ({
      message: "Transcribed locally with Whisper.",
      ok: true,
      text: "one held session",
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        pasteText,
        platform: "win32",
        shortcutLabel: "Hold Ctrl + Win to dictate from any app",
        transcribeAudio,
      },
    });

    const { root } = mountApp();
    const dispatchHoldStart = () =>
      window.dispatchEvent(
        new CustomEvent("auralis:desktop-toggle-dictation", {
          detail: {
            action: "start",
            autoPaste: true,
            holdToTalk: true,
            startedFromShortcut: true,
          },
        }),
      );

    dispatchHoldStart();
    dispatchHoldStart();

    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    expect(root.textContent).not.toContain("No speech was captured");
    expect(pasteText).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: {
          action: "stop",
          holdToTalk: true,
          startedFromShortcut: true,
        },
      }),
    );

    await vi.waitFor(() => expect(pasteText).toHaveBeenCalledWith("one held session"));
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
  });

  it("ignores hold-stop when no hold session is active", () => {
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "win32",
        shortcutLabel: "Hold Ctrl + Win to dictate from any app",
      },
    });

    const { root } = mountApp();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: {
          action: "stop",
          holdToTalk: true,
          startedFromShortcut: true,
        },
      }),
    );

    expect(root.querySelector<HTMLElement>('[data-field="status"]')?.textContent).toBe("Ready");
    expect(FakeRecognition.latest).toBeNull();
    expect(root.textContent).not.toContain("Listening live");
  });

  it("does not let a stale hold-stop end an unrelated active session", () => {
    const { root } = mountApp({ desktop: false });

    button(root, "Start listening").click();
    expect(root.querySelector<HTMLElement>('[data-field="status"]')?.textContent).toBe(
      "Listening live",
    );
    const activeRecognition = FakeRecognition.latest;
    expect(activeRecognition?.stopped).toBe(false);

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: {
          action: "stop",
          holdToTalk: true,
          startedFromShortcut: true,
        },
      }),
    );

    expect(root.querySelector<HTMLElement>('[data-field="status"]')?.textContent).toBe(
      "Listening live",
    );
    expect(activeRecognition?.stopped).toBe(false);
  });

  it("publishes the system-audio mute preference while desktop recording is active", async () => {
    installFakeMediaRecorder();
    const captureStates: Array<{ muteSystemAudio: boolean; status: string }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        pasteText: async (text: string) => ({
          message: `Inserted locally: ${text}`,
          ok: true,
          pasted: true,
        }),
        platform: "linux",
        setCaptureState: (payload: { muteSystemAudio: boolean; status: string }) =>
          captureStates.push(payload),
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "quiet background music",
        }),
      },
    });

    const { root } = mountApp();
    const muteSystemAudio = root.querySelector<HTMLInputElement>(
      '[data-setting="muteSystemAudio"]',
    );

    expect(muteSystemAudio?.checked).toBe(true);
    button(root, "Start recording").click();
    await vi.waitFor(() =>
      expect(captureStates).toContainEqual({ muteSystemAudio: true, status: "recording" }),
    );
    button(root, "Stop & transcribe").click();
    await vi.waitFor(() =>
      expect(captureStates).toContainEqual({ muteSystemAudio: false, status: "transcribing" }),
    );
    await vi.waitFor(() =>
      expect(captureStates.at(-1)).toEqual({ muteSystemAudio: false, status: "idle" }),
    );
  });

  it("copies without pasting when a desktop recording starts inside Auralis", async () => {
    installFakeMediaRecorder();
    const copyText = vi.fn(async () => ({
      message: "Transcript copied to the clipboard.",
      ok: true,
    }));
    const pasteText = vi.fn(async () => ({
      message: "Should not paste from an in-app recording.",
      ok: true,
      pasted: true,
    }));
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        copyText,
        pasteText,
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "copy only from in-app recording",
        }),
      },
    });

    const { root } = mountApp();

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("copy only from in-app recording"),
    );
    expect(pasteText).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Transcript copied to the clipboard."),
    );
  });

  it("prefers local Whisper base on first desktop launch while keeping tiny selectable", () => {
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "",
        }),
      },
    });

    const { root } = mountApp();
    const provider = root.querySelector<HTMLSelectElement>('[data-setting="providerId"]');
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');

    expect(provider?.value).toBe("desktop-whisper");
    expect(model?.value).toBe("desktop-whisper-base");
    expect([...(model?.options ?? [])]).toContainEqual(
      expect.objectContaining({
        label: "Local Whisper tiny (fastest first-run check)",
        value: "desktop-whisper-tiny",
      }),
    );
    expect(root.textContent).toContain("Desktop Whisper records microphone audio locally");
    expect(root.textContent).toContain(
      "No API key, cloud backend, or browser-vendor speech service is used",
    );
    expect(JSON.parse(localStorage.getItem("auralis:settings:v1") ?? "{}")).toMatchObject({
      providerId: "desktop-whisper",
      modelId: "desktop-whisper-base",
    });
  });

  it("offers local Whisper medium as an explicit high-accuracy desktop model", () => {
    installFakeMediaRecorder();
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "",
        }),
      },
    });

    const { root } = mountApp();
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');
    const options = [...(model?.options ?? [])].map((option) => ({
      label: option.textContent,
      value: option.value,
    }));

    expect(options).toContainEqual({
      label: "Local Whisper medium (highest accuracy, ~1.5 GB)",
      value: "desktop-whisper-medium",
    });
  });

  it("shows local Whisper engine health and repairs a missing runtime from the UI", async () => {
    installFakeMediaRecorder();
    let installed = false;
    const statusCalls: string[] = [];
    const setupCalls: string[] = [];

    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "",
        }),
        setupWhisperRuntime: async (modelId: string) => {
          setupCalls.push(modelId);
          installed = true;
          return {
            message: "Local Whisper engine is ready.",
            modelId,
            ok: true,
            python: "/home/user/.config/Auralis/whisper-runtime/venv/bin/python",
            state: "ready",
            version: "1.2.1",
          };
        },
        whisperStatus: async (modelId: string) => {
          statusCalls.push(modelId);
          return installed
            ? {
                message: "Local Whisper engine is ready.",
                modelId,
                ok: true,
                python: "/home/user/.config/Auralis/whisper-runtime/venv/bin/python",
                state: "ready",
                version: "1.2.1",
              }
            : {
                message: "Local Whisper engine is not installed yet.",
                modelId,
                ok: false,
                state: "missing",
              };
        },
      },
    });

    const { root } = mountApp();

    await vi.waitFor(() =>
      expect(root.textContent).toContain("Local Whisper engine is not installed yet."),
    );
    expect(statusCalls).toContain("desktop-whisper-base");
    expect(button(root, "Start recording").disabled).toBe(true);

    button(root, "Install / repair local engine").click();

    await vi.waitFor(() => expect(setupCalls).toEqual(["desktop-whisper-base"]));
    await vi.waitFor(() => expect(root.textContent).toContain("Local Whisper engine is ready."));
    expect(root.textContent).toContain("faster-whisper 1.2.1");
    expect(button(root, "Start recording").disabled).toBe(false);
  });

  it("keeps local Whisper readiness model-specific and ignores stale status responses", async () => {
    installFakeMediaRecorder();
    const statusRequests = new Map<
      string,
      ReturnType<
        typeof deferred<{
          message: string;
          modelId: string;
          ok: boolean;
          state: string;
        }>
      >
    >();

    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
        setupWhisperRuntime: async (modelId: string) => ({
          message: "Local Whisper engine is ready.",
          modelId,
          ok: true,
          state: "ready",
        }),
        whisperStatus: (modelId: string) => {
          const request = deferred<{
            message: string;
            modelId: string;
            ok: boolean;
            state: string;
          }>();
          statusRequests.set(modelId, request);
          return request.promise;
        },
      },
    });

    const { root } = mountApp();
    const provider = root.querySelector<HTMLSelectElement>('[data-setting="providerId"]');
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');

    await vi.waitFor(() => expect(statusRequests.has("desktop-whisper-base")).toBe(true));
    expect(provider?.disabled).toBe(true);
    expect(model?.disabled).toBe(true);

    if (!model) {
      throw new Error("Model select did not render");
    }
    model.value = "desktop-whisper-small";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(statusRequests.has("desktop-whisper-small")).toBe(true));

    statusRequests.get("desktop-whisper-base")?.resolve({
      message: "Base runtime ready but stale.",
      modelId: "desktop-whisper-base",
      ok: true,
      state: "ready",
    });
    await Promise.resolve();
    expect(root.textContent).not.toContain("Base runtime ready but stale.");
    expect(button(root, "Start recording").disabled).toBe(true);

    statusRequests.get("desktop-whisper-small")?.resolve({
      message: "Small runtime ready and current.",
      modelId: "desktop-whisper-small",
      ok: true,
      state: "ready",
    });
    await vi.waitFor(() => expect(root.textContent).toContain("Small runtime ready and current."));
    expect(button(root, "Start recording").disabled).toBe(false);
  });

  it("keeps local Whisper setup responses from unlocking a different selected model", async () => {
    installFakeMediaRecorder();
    const setupRequest = deferred<{
      message: string;
      modelId: string;
      ok: boolean;
      state: string;
    }>();
    const statusRequests = new Map<
      string,
      ReturnType<
        typeof deferred<{
          message: string;
          modelId: string;
          ok: boolean;
          state: string;
        }>
      >
    >();

    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
        setupWhisperRuntime: () => setupRequest.promise,
        whisperStatus: (modelId: string) => {
          const request = deferred<{
            message: string;
            modelId: string;
            ok: boolean;
            state: string;
          }>();
          statusRequests.set(modelId, request);
          return request.promise;
        },
      },
    });

    const { root } = mountApp();
    const provider = root.querySelector<HTMLSelectElement>('[data-setting="providerId"]');
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');

    await vi.waitFor(() => expect(statusRequests.has("desktop-whisper-base")).toBe(true));
    statusRequests.get("desktop-whisper-base")?.resolve({
      message: "Base runtime ready.",
      modelId: "desktop-whisper-base",
      ok: true,
      state: "ready",
    });
    await vi.waitFor(() => expect(button(root, "Start recording").disabled).toBe(false));

    button(root, "Install / repair local engine").click();
    await vi.waitFor(() => expect(button(root, "Installing local engine...").disabled).toBe(true));
    expect(provider?.disabled).toBe(true);
    expect(model?.disabled).toBe(true);

    if (!model) {
      throw new Error("Model select did not render");
    }
    model.value = "desktop-whisper-small";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(statusRequests.has("desktop-whisper-small")).toBe(true));

    setupRequest.resolve({
      message: "Base setup finished but stale.",
      modelId: "desktop-whisper-base",
      ok: true,
      state: "ready",
    });
    await Promise.resolve();
    expect(root.textContent).not.toContain("Base setup finished but stale.");

    statusRequests.get("desktop-whisper-small")?.resolve({
      message: "Small status controls the selected model.",
      modelId: "desktop-whisper-small",
      ok: true,
      state: "ready",
    });
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Small status controls the selected model."),
    );
    expect(button(root, "Start recording").disabled).toBe(false);
  });

  it("records microphone audio and transcribes through desktop local Whisper", async () => {
    const { stoppedTracks } = installFakeMediaRecorder();
    const transcribeRequests: Array<{
      audioData: ArrayBuffer;
      language: string;
      mimeType: string;
      modelId: string;
    }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async (request: {
          audioData: ArrayBuffer;
          language: string;
          mimeType: string;
          modelId: string;
        }) => {
          transcribeRequests.push(request);
          return {
            message: "Transcribed locally with Whisper.",
            ok: true,
            text: "local whisper transcript",
          };
        },
      },
    });
    enableTranscriptHistory({
      continuous: true,
      interimResults: true,
      language: "en-US",
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
    });

    const { root } = mountApp();

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    expect(FakeMediaRecorder.latest?.startTimeslice).toBe(250);
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() => expect(transcribeRequests).toHaveLength(1));
    await vi.waitFor(() => expect(root.textContent).toContain("Transcript saved locally."));

    expect(transcribeRequests[0]?.audioData.byteLength).toBeGreaterThan(0);
    expect(FakeMediaRecorder.latest?.requestDataCalls).toBe(1);
    expect(transcribeRequests[0]).toMatchObject({
      language: "en-US",
      mimeType: "audio/webm;codecs=opus",
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
    });
    expect(stoppedTracks).toContain("audio");
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
      "local whisper transcript",
    );
    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]).toMatchObject({
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
      text: "local whisper transcript",
    });
  });

  it("binds shortcut-started desktop paste delivery to the fresh target token", async () => {
    installFakeMediaRecorder();
    const pasteRequests: Array<{ text: string; pasteTargetToken?: string | null }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        pasteText: async (text: string, pasteTargetToken?: string | null) => {
          pasteRequests.push({ pasteTargetToken, text });
          return { message: "Transcript pasted into the previous app.", ok: true, pasted: true };
        },
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({
          message: "Transcribed locally with Whisper.",
          ok: true,
          text: "shortcut transcript",
        }),
      },
    });
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        continuous: true,
        interimResults: true,
        language: "en-US",
        modelId: "desktop-whisper-base",
        providerId: "desktop-whisper",
      }),
    );

    const { root } = mountApp();

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: {
          autoPaste: true,
          pasteTargetToken: "fresh-target-token",
          startedFromShortcut: true,
        },
      }),
    );
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    window.dispatchEvent(
      new CustomEvent("auralis:desktop-toggle-dictation", {
        detail: { action: "stop", startedFromShortcut: true },
      }),
    );

    await vi.waitFor(() => expect(pasteRequests).toHaveLength(1));
    expect(pasteRequests[0]).toEqual({
      pasteTargetToken: "fresh-target-token",
      text: "shortcut transcript",
    });
  });

  it("passes the fresh paste-again shortcut token instead of reusing stale target state", async () => {
    const pasteRequests: Array<{ text: string; pasteTargetToken?: string | null }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        pasteText: async (text: string, pasteTargetToken?: string | null) => {
          pasteRequests.push({ pasteTargetToken, text });
          return { message: "Transcript pasted into the previous app.", ok: true, pasted: true };
        },
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async () => ({ message: "ok", ok: true, text: "" }),
      },
    });

    const { root } = mountApp();
    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");
    if (!transcript) {
      throw new Error("Transcript area did not render");
    }
    transcript.value = "retry this transcript";
    transcript.dispatchEvent(new Event("input", { bubbles: true }));

    window.dispatchEvent(
      new CustomEvent("auralis:desktop-paste-transcript", {
        detail: { pasteTargetToken: "retry-target-token", startedFromShortcut: true },
      }),
    );

    await vi.waitFor(() => expect(pasteRequests).toHaveLength(1));
    expect(pasteRequests[0]).toEqual({
      pasteTargetToken: "retry-target-token",
      text: "retry this transcript",
    });
  });

  it("records through OpenRouter STT without exposing API-key fields to renderer storage", async () => {
    installFakeMediaRecorder();
    const transcribeRequests: Array<{ language: string; modelId: string; providerId: string }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async (request: {
          language: string;
          modelId: string;
          providerId: string;
        }) => {
          transcribeRequests.push(request);
          return {
            audioSeconds: 2.4,
            decodeMs: 320,
            message: "Transcribed with OpenRouter Whisper Large v3 Turbo.",
            ok: true,
            providerId: "openrouter-stt",
            text: "um fast openrouter transcript comma please",
          };
        },
      },
    });
    enableTranscriptHistory({
      continuous: true,
      interimResults: true,
      language: "en-US",
      modelId: "openrouter-whisper-large-v3-turbo",
      outputMode: "cleaned",
      providerId: "openrouter-stt",
    });

    const { root } = mountApp();

    expect(root.textContent).toContain("Recommended for speed: Whisper Large v3 Turbo");
    expect(root.textContent).toContain("OPENROUTER_API_KEY stays in Electron main");
    expect(root.textContent).toContain("Clean dictation");
    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() => expect(transcribeRequests).toHaveLength(1));
    expect(transcribeRequests[0]).toMatchObject({
      language: "en-US",
      modelId: "openrouter-whisper-large-v3-turbo",
      providerId: "openrouter-stt",
    });
    await vi.waitFor(() => expect(root.textContent).toContain("OpenRouter Whisper Large v3 Turbo"));
    expect(root.textContent).toContain("decode 320 ms");
    expect(root.textContent).toContain("Fast openrouter transcript, please.");
    expect(localStorage.getItem("auralis:settings:v1")).not.toContain("API_KEY");
    expect(localStorage.getItem("auralis:settings:v1")).not.toContain("OPENROUTER_API_KEY");
    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]).toMatchObject({
      modelId: "openrouter-whisper-large-v3-turbo",
      outputMode: "cleaned",
      providerId: "openrouter-stt",
      rawText: "um fast openrouter transcript comma please",
      text: "Fast openrouter transcript, please.",
    });
  });

  it("locks settings and saves desktop transcripts with the settings captured at session start", async () => {
    installFakeMediaRecorder();
    const transcribeRequests: Array<{ language: string; modelId: string }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async (request: { language: string; modelId: string }) => {
          transcribeRequests.push(request);
          return {
            message: "Transcribed locally with Whisper.",
            ok: true,
            text: "stable session metadata",
          };
        },
      },
    });
    enableTranscriptHistory({
      continuous: true,
      interimResults: true,
      language: "en-US",
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
    });

    const { root } = mountApp();
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');
    const language = root.querySelector<HTMLSelectElement>('[data-setting="language"]');

    if (!model || !language) {
      throw new Error("Settings controls did not render");
    }

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));

    expect(model.disabled).toBe(true);
    expect(language.disabled).toBe(true);

    model.value = "desktop-whisper-tiny";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    language.value = "fr-FR";
    language.dispatchEvent(new Event("change", { bubbles: true }));

    button(root, "Stop & transcribe").click();

    await vi.waitFor(() => expect(transcribeRequests).toHaveLength(1));
    await vi.waitFor(() => expect(root.textContent).toContain("Transcript saved locally."));

    expect(transcribeRequests[0]).toMatchObject({
      language: "en-US",
      modelId: "desktop-whisper-base",
    });
    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]).toMatchObject({
      language: "en-US",
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
      text: "stable session metadata",
    });
    expect(model.disabled).toBe(false);
    expect(language.disabled).toBe(false);
  });

  it("keeps a desktop Whisper session alive when Stop is pressed again while transcription is pending", async () => {
    installFakeMediaRecorder();
    let resolveTranscription: (value: { message: string; ok: boolean; text: string }) => void =
      () => {
        throw new Error("Transcription promise was not initialized");
      };
    const pendingTranscription = new Promise<{ message: string; ok: boolean; text: string }>(
      (resolve) => {
        resolveTranscription = resolve;
      },
    );
    const transcribeRequests: Array<{ audioData: ArrayBuffer }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async (request: { audioData: ArrayBuffer }) => {
          transcribeRequests.push(request);
          return pendingTranscription;
        },
      },
    });
    enableTranscriptHistory({
      continuous: true,
      interimResults: true,
      language: "en-US",
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
    });

    const { root } = mountApp();

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(root.textContent).toContain("Recording locally"));
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() => expect(transcribeRequests).toHaveLength(1));
    await vi.waitFor(() => expect(root.textContent).toContain("Transcribing locally with Whisper"));

    expect(button(root, "Transcribing...").disabled).toBe(true);

    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
    expect(root.textContent).not.toContain("No speech was captured");

    resolveTranscription({
      message: "Transcribed locally with Whisper.",
      ok: true,
      text: "resolved after repeated stop",
    });

    await vi.waitFor(() => expect(root.textContent).toContain("Transcript saved locally."));
    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]?.text).toBe("resolved after repeated stop");
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
      "resolved after repeated stop",
    );
  });

  it("stops a desktop local recording even when stop is requested before MediaRecorder onstart", async () => {
    class DelayedStartMediaRecorder extends FakeMediaRecorder {
      override start(): void {
        this.state = "recording";
      }
    }

    installFakeMediaRecorder();
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: DelayedStartMediaRecorder,
    });
    const transcribeRequests: Array<{ audioData: ArrayBuffer }> = [];
    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        platform: "linux",
        shortcutLabel: "Ctrl + Alt + Space toggles from any app",
        transcribeAudio: async (request: { audioData: ArrayBuffer }) => {
          transcribeRequests.push(request);
          return {
            message: "Transcribed locally with Whisper.",
            ok: true,
            text: "early stop transcript",
          };
        },
      },
    });
    enableTranscriptHistory({
      continuous: true,
      interimResults: true,
      language: "en-US",
      modelId: "desktop-whisper-tiny",
      providerId: "desktop-whisper",
    });

    const { root } = mountApp();

    button(root, "Start recording").click();
    await vi.waitFor(() => expect(FakeMediaRecorder.latest?.state).toBe("recording"));
    button(root, "Stop & transcribe").click();

    await vi.waitFor(() => expect(transcribeRequests).toHaveLength(1));
    await vi.waitFor(() => expect(root.textContent).toContain("Transcript saved locally."));
    expect(transcribeRequests[0]?.audioData.byteLength).toBeGreaterThan(0);
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(
      "early stop transcript",
    );
  });

  it("pastes the current transcript into the previous desktop app when the bridge supports it", async () => {
    const pastedTexts: string[] = [];

    Object.defineProperty(window, "auralisDesktop", {
      configurable: true,
      value: {
        copyText: async (text: string) => ({
          message: `Copied ${text.length} characters through Electron.`,
          ok: true,
        }),
        pasteText: async (text: string) => {
          pastedTexts.push(text);
          return {
            message: "Transcript pasted into the previous app.",
            ok: true,
            pasted: true,
          };
        },
        platform: "win32",
        shortcutLabel: "Ctrl + Alt + Space",
      },
    });

    const { root } = mountApp();
    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");

    if (!transcript) {
      throw new Error("Transcript area did not render");
    }

    transcript.value = "Paste this into VSCode.";
    transcript.dispatchEvent(new Event("input", { bubbles: true }));

    button(root, "Paste to previous app").click();

    await vi.waitFor(() => expect(pastedTexts).toEqual(["Paste this into VSCode."]));
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Transcript pasted into the previous app."),
    );
  });

  it("shows readable speech errors and remains usable after failed recordings", () => {
    const { root } = mountApp();

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitError("not-allowed");
    FakeRecognition.latest?.stop();

    expect(root.textContent).toContain("Microphone permission was denied");
    expect(button(root, "Start listening").disabled).toBe(false);

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitError("network");
    FakeRecognition.latest?.stop();

    expect(root.textContent).toContain("Chromium's remote Web Speech backend is unavailable");
    expect(button(root, "Start listening").disabled).toBe(false);
  });

  it("shows nothing saved when a user cancels after a retriable network failure", () => {
    const { root } = mountApp({ recognitionConstructor: LocalRetryRecognition });

    button(root, "Start listening").click();
    const firstSession =
      LocalRetryRecognition.instances[LocalRetryRecognition.instances.length - 1];
    firstSession?.emitError("network");
    button(root, "Stop").click();

    expect(LocalRetryRecognition.instances).toHaveLength(2);
    expect(root.textContent).toContain("No speech was captured, so nothing was saved.");
    expect(root.textContent).not.toContain("Retrying with on-device speech recognition");
  });

  it("does not attempt Electron on-device Web Speech after a network failure", () => {
    const { root } = mountApp({ desktop: true, recognitionConstructor: LocalRetryRecognition });

    button(root, "Start listening").click();
    const session = LocalRetryRecognition.instances[LocalRetryRecognition.instances.length - 1];
    session?.emitError("network");
    button(root, "Stop").click();

    expect(LocalRetryRecognition.instances).toHaveLength(1);
    expect(root.textContent).toContain("on-device Web Speech is disabled");
    expect(root.textContent).toContain(
      "Electron Web Speech still depends on Chromium's browser-default speech engine",
    );
    expect(button(root, "Start listening").disabled).toBe(false);
  });

  it("replaces a retry notice when an on-device retry finishes without speech", () => {
    const { root } = mountApp({ recognitionConstructor: LocalRetryRecognition });

    button(root, "Start listening").click();
    const firstSession =
      LocalRetryRecognition.instances[LocalRetryRecognition.instances.length - 1];
    firstSession?.emitError("network");
    firstSession?.stop();

    const retrySession =
      LocalRetryRecognition.instances[LocalRetryRecognition.instances.length - 1];
    expect(retrySession).not.toBe(firstSession);
    expect(retrySession?.processLocally).toBe(true);
    expect(root.textContent).toContain("Retrying with on-device speech recognition");

    retrySession?.stop();

    expect(root.textContent).toContain("No speech was captured, so nothing was saved.");
    expect(root.textContent).not.toContain("Retrying with on-device speech recognition");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
  });

  it("handles clipboard failures without losing the transcript", async () => {
    const { root } = mountApp({ failClipboard: true });
    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");

    if (!transcript) {
      throw new Error("Transcript area did not render");
    }

    transcript.value = "copy failure should preserve this text";
    transcript.dispatchEvent(new Event("input", { bubbles: true }));

    button(root, "Copy").click();

    await vi.waitFor(() => expect(root.textContent).toContain("clipboard blocked"));
    expect(transcript.value).toBe("copy failure should preserve this text");
  });

  it("does not save empty recordings and explains what happened", () => {
    const { root } = mountApp();

    button(root, "Start listening").click();
    button(root, "Stop").click();

    expect(root.textContent).toContain("No speech was captured, so nothing was saved.");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
  });

  it("does not save duplicate history entries for the same consecutive transcript", () => {
    enableTranscriptHistory();
    const { root } = mountApp();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      button(root, "Start listening").click();
      FakeRecognition.latest?.emitFinal("repeatable phrase");
      button(root, "Stop").click();
    }

    const persisted = JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]") as Array<{
      text: string;
    }>;

    expect(persisted.filter((entry) => entry.text === "repeatable phrase")).toHaveLength(1);
  });

  it("keeps distinct raw transcripts when cleanup produces the same output", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        outputMode: "cleaned",
        saveTranscriptHistory: true,
      }),
    );
    const { root } = mountApp();

    for (const phrase of ["um ship the patch comma please", "uh ship the patch comma please"]) {
      button(root, "Start listening").click();
      FakeRecognition.latest?.emitFinal(phrase);
      button(root, "Stop").click();
    }

    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];

    expect(persisted).toHaveLength(2);
    expect(persisted.map((entry) => entry.rawText)).toEqual([
      "uh ship the patch comma please",
      "um ship the patch comma please",
    ]);
    expect(persisted.every((entry) => entry.text === "Ship the patch, please.")).toBe(true);
  });

  it("applies personal text rules after output cleanup while preserving raw transcript text", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        outputMode: "cleaned",
        saveTranscriptHistory: true,
      }),
    );
    localStorage.setItem(
      "auralis:personal-text:v1",
      JSON.stringify({
        enabled: true,
        rules: [
          {
            enabled: true,
            id: "rule-openrouter",
            kind: "vocabulary",
            replacement: "OpenRouter",
            trigger: "Open router",
          },
        ],
      }),
    );
    const { root } = mountApp();

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal("um open router comma please");
    button(root, "Stop").click();

    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");
    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];

    expect(transcript?.value).toBe("OpenRouter, please.");
    expect(persisted[0]).toMatchObject({
      outputMode: "cleaned",
      rawText: "um open router comma please",
      text: "OpenRouter, please.",
    });
  });

  it("shows an error instead of saving oversized personal text expansions", () => {
    localStorage.setItem(
      "auralis:personal-text:v1",
      JSON.stringify({
        enabled: true,
        rules: [
          {
            enabled: true,
            id: "rule-expanded-snippet",
            kind: "snippet",
            replacement: Array.from({ length: 333 }, () => "xx").join(" "),
            trigger: ";x",
          },
        ],
      }),
    );
    const { root } = mountApp();

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal(";x ".repeat(12));
    button(root, "Stop").click();

    expect(root.textContent).toContain("Personal text rules would make this transcript too long.");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
  });

  it("persists settings selected in the UI", () => {
    const { root } = mountApp();
    const language = root.querySelector<HTMLSelectElement>('[data-setting="language"]');
    const model = root.querySelector<HTMLSelectElement>('[data-setting="modelId"]');
    const outputMode = root.querySelector<HTMLSelectElement>('[data-setting="outputMode"]');

    if (!language || !model || !outputMode) {
      throw new Error("Settings controls did not render");
    }

    language.value = "fr-FR";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    model.value = "browser-local";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    outputMode.value = "cleaned";
    outputMode.dispatchEvent(new Event("change", { bubbles: true }));

    const stored = JSON.parse(localStorage.getItem("auralis:settings:v1") ?? "{}");
    expect(stored).toMatchObject({
      language: "fr-FR",
      modelId: "browser-local",
      outputMode: "cleaned",
    });
  });

  it("saves personal vocabulary, replacement, and snippet rules from the local editor", () => {
    const { root } = mountApp();
    const enabled = root.querySelector<HTMLInputElement>('[data-setting="personal-text-enabled"]');
    const rules = root.querySelector<HTMLTextAreaElement>('[data-setting="personal-text-rules"]');

    if (!enabled || !rules) {
      throw new Error("Personal text controls did not render");
    }

    expect(root.textContent).toContain("Personal text rules");
    expect(enabled.checked).toBe(true);

    rules.value = [
      "vocabulary: open router => OpenRouter",
      "replacement: oralis => Auralis",
      "snippet: ;sig => Thanks,\\nChris",
    ].join("\n");
    rules.dispatchEvent(new Event("input", { bubbles: true }));
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rules.value).toContain("vocabulary: open router => OpenRouter");
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change", { bubbles: true }));
    button(root, "Save personal rules").click();

    expect(JSON.parse(localStorage.getItem("auralis:personal-text:v1") ?? "{}")).toEqual({
      enabled: true,
      rules: [
        {
          enabled: true,
          id: "vocabulary-open-router",
          kind: "vocabulary",
          replacement: "OpenRouter",
          trigger: "open router",
        },
        {
          enabled: true,
          id: "replacement-oralis",
          kind: "replacement",
          replacement: "Auralis",
          trigger: "oralis",
        },
        {
          enabled: true,
          id: "snippet-sig",
          kind: "snippet",
          replacement: "Thanks,\\nChris",
          trigger: ";sig",
        },
      ],
    });
    expect(root.textContent).toContain("Saved personal text rules locally.");

    const githubLikeToken = ["ghp", "secretlikevalue1234567890"].join("_");
    rules.value = `snippet: ;token => ${githubLikeToken}`;
    rules.dispatchEvent(new Event("input", { bubbles: true }));
    button(root, "Save personal rules").click();

    expect(root.textContent).toContain(
      "Personal text rules cannot be empty, oversized, malformed, or secret-like.",
    );
  });

  it("keeps provider-specific help text and microphone meter visibility accurate", () => {
    const { root } = mountApp();
    const provider = root.querySelector<HTMLSelectElement>('[data-setting="providerId"]');
    const micMeter = root.querySelector<HTMLElement>('[data-field="mic-meter"]');
    const modeCopy = root.querySelector<HTMLElement>('[data-field="mode-copy"]');

    if (!provider || !micMeter || !modeCopy) {
      throw new Error("Provider controls or mode copy did not render");
    }

    expect(modeCopy.textContent).toContain("Browser Web Speech can show live words");
    expect(micMeter.hidden).toBe(true);

    provider.value = "desktop-whisper";
    provider.dispatchEvent(new Event("change", { bubbles: true }));

    expect(modeCopy.textContent).toContain("Desktop Whisper records microphone audio locally");
    expect(micMeter.hidden).toBe(false);
    expect(button(root, "Start recording")).toBeDefined();
  });

  it("shows transcript stats and lets users search or filter saved history without deleting entries", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([
        sampleEntry({
          id: "entry-fr",
          createdAt: "2026-05-12T10:00:00.000Z",
          durationMs: 3300,
          language: "fr-FR",
          modelId: "browser-local",
          text: "Bonjour equipe produit",
        }),
        sampleEntry({
          id: "entry-en",
          createdAt: "2026-05-11T09:00:00.000Z",
          durationMs: 2200,
          text: "Daily standup summary",
        }),
      ]),
    );

    const { root } = mountApp();
    const transcript = root.querySelector<HTMLTextAreaElement>("#transcript-area");
    const historySearch = root.querySelector<HTMLInputElement>('[data-action="history-search"]');
    const historyLanguageFilter = root.querySelector<HTMLSelectElement>(
      '[data-action="history-language-filter"]',
    );

    if (!transcript || !historySearch || !historyLanguageFilter) {
      throw new Error("History search controls or transcript area did not render");
    }

    transcript.value = "Count these transcript words";
    transcript.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.textContent).toContain("4 words");
    expect(root.textContent).toContain("28 characters");
    expect(root.textContent).toContain("Showing 2 of 2 saved transcripts");

    historySearch.value = "bonjour";
    historySearch.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.textContent).toContain("Showing 1 of 2 saved transcripts");
    expect(root.textContent).toContain("Bonjour equipe produit");
    expect(root.textContent).not.toContain("Daily standup summary");

    historySearch.value = "missing phrase";
    historySearch.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.textContent).toContain('No saved transcripts match "missing phrase".');

    historySearch.value = "";
    historySearch.dispatchEvent(new Event("input", { bubbles: true }));
    historyLanguageFilter.value = "fr-FR";
    historyLanguageFilter.dispatchEvent(new Event("change", { bubbles: true }));

    expect(root.textContent).toContain("Showing 1 of 2 saved transcripts");
    expect(root.textContent).toContain("Bonjour equipe produit");
    expect(root.textContent).not.toContain("Daily standup summary");

    const stored = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(stored).toHaveLength(2);
  });

  it("exports history and imports validated JSON without corrupting saved transcripts", async () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "entry-export", text: "Export this entry" })]),
    );

    const exportedBlobs: Blob[] = [];
    const createObjectUrl = vi.fn((value: Blob) => {
      exportedBlobs.push(value);
      return "blob:history-export";
    });
    const revokeObjectUrl = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    const { root } = mountApp();
    const exportButton = button(root, "Export JSON");
    const importInput = root.querySelector<HTMLInputElement>('[data-action="import-history"]');

    if (!importInput) {
      throw new Error("Import input did not render");
    }

    exportButton.click();

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(await exportedBlobs[0]?.text()).toContain("Export this entry");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:history-export");

    const validImport = new File(
      [
        JSON.stringify([
          sampleEntry({
            id: "entry-import-1",
            createdAt: "2026-05-13T07:00:00.000Z",
            text: "Imported planning note",
          }),
          sampleEntry({
            id: "entry-import-2",
            createdAt: "2026-05-13T08:00:00.000Z",
            language: "de-DE",
            modelId: "browser-local",
            text: "Importierter Verlaufseintrag",
          }),
        ]),
      ],
      "history.json",
      { type: "application/json" },
    );

    Object.defineProperty(importInput, "files", {
      configurable: true,
      value: [validImport],
    });
    importInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(root.textContent).toContain("Imported 2 saved transcripts."));
    expect(root.textContent).toContain("Imported planning note");
    expect(root.textContent).toContain("Importierter Verlaufseintrag");

    const importedHistory = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(importedHistory).toHaveLength(3);
    expect(importedHistory.map((entry) => entry.id)).toEqual([
      "entry-import-1",
      "entry-import-2",
      "entry-export",
    ]);

    const invalidImport = new File(
      [JSON.stringify([{ id: 7, text: "bad row" }])],
      "history-invalid.json",
      { type: "application/json" },
    );

    Object.defineProperty(importInput, "files", {
      configurable: true,
      value: [invalidImport],
    });
    importInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(root.textContent).toContain("Imported history contains invalid transcript entries."),
    );
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual(importedHistory);

    anchorClick.mockRestore();
  });

  it("reports when bounded history imports skip older saved transcripts", async () => {
    const existingHistory = Array.from({ length: MAX_HISTORY_ITEMS }, (_, index) =>
      sampleEntry({
        id: `existing-${index}`,
        createdAt: `2026-05-${String(index + 1).padStart(2, "0")}T09:00:00.000Z`,
        text: `Existing transcript ${index}`,
      }),
    );
    localStorage.setItem("auralis:history:v1", JSON.stringify(existingHistory));

    const { root } = mountApp();
    const importInput = root.querySelector<HTMLInputElement>('[data-action="import-history"]');

    if (!importInput) {
      throw new Error("Import input did not render");
    }

    const validImport = new File(
      [
        JSON.stringify([
          sampleEntry({ id: "imported-1", text: "Imported first transcript" }),
          sampleEntry({ id: "imported-2", text: "Imported second transcript" }),
        ]),
      ],
      "history.json",
      { type: "application/json" },
    );

    Object.defineProperty(importInput, "files", {
      configurable: true,
      value: [validImport],
    });
    importInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(root.textContent).toContain(
        "2 existing saved transcripts were skipped to stay under 24.",
      ),
    );

    const importedHistory = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(importedHistory).toHaveLength(MAX_HISTORY_ITEMS);
    expect(importedHistory.map((entry) => entry.id).slice(0, 2)).toEqual([
      "imported-1",
      "imported-2",
    ]);
    expect(importedHistory.map((entry) => entry.id)).not.toContain("existing-22");
    expect(importedHistory.map((entry) => entry.id)).not.toContain("existing-23");
  });

  it("requires explicit confirmation before clearing all saved history", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([
        sampleEntry({ id: "entry-1", text: "First saved note" }),
        sampleEntry({
          id: "entry-2",
          createdAt: "2026-05-12T12:15:00.000Z",
          text: "Second saved note",
        }),
      ]),
    );

    const { root } = mountApp();

    button(root, "Clear all history").click();

    expect(root.textContent).toContain("Confirm clearing all saved transcripts.");
    expect(root.textContent).toContain("First saved note");
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toHaveLength(2);

    button(root, "Confirm clear all").click();

    expect(root.textContent).toContain("All saved transcripts were cleared.");
    expect(root.querySelector<HTMLDetailsElement>('[data-field="history-section"]')?.open).toBe(
      true,
    );
    expect(root.textContent).toContain(
      "Saved transcripts will appear here after you finish a recording.",
    );
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual([]);
  });

  it("records the actual session duration instead of the fallback duration", () => {
    enableTranscriptHistory();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T10:00:00.000Z"));

    const { root } = mountApp();

    button(root, "Start listening").click();
    vi.advanceTimersByTime(5_250);
    FakeRecognition.latest?.emitFinal("time this recording correctly");
    button(root, "Stop").click();

    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]?.durationMs).toBe(5_250);
    expect(root.textContent).toContain("5s");
  });

  it("does not save text that was cleared during an active recording", () => {
    const { root } = mountApp();

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal("private phrase to clear");
    button(root, "Clear").click();
    button(root, "Stop").click();

    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe("");
    expect(root.textContent).not.toContain("private phrase to clear");
  });

  it("does not silently persist transcripts beyond the local history text limit", () => {
    enableTranscriptHistory();
    const { root } = mountApp();
    const longTranscript = "x".repeat(MAX_ENTRY_TEXT_LENGTH + 1);

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal(longTranscript);
    button(root, "Stop").click();

    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>("#transcript-area")?.value).toBe(longTranscript);
    expect(root.textContent).toContain("Transcript is too long to save locally");
  });

  it("does not claim destructive history changes succeeded when local persistence fails", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "entry-clear-failure", text: "Keep if save fails" })]),
    );
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { root } = mountApp();

    try {
      button(root, "Clear all history").click();
      button(root, "Confirm clear all").click();

      expect(root.textContent).toContain("Could not save transcript history locally");
      expect(root.textContent).toContain("Keep if save fails");
      expect(root.textContent).not.toContain("All saved transcripts were cleared.");
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("lets a pending microphone start be cancelled before onstart fires", () => {
    class SlowRecognition extends FakeRecognition {
      override start(): void {
        this.started = true;
      }
    }

    const { root } = mountApp({
      recognitionConstructor: SlowRecognition as unknown as SpeechRecognitionConstructor,
    });

    button(root, "Start listening").click();

    const stopButton = button(root, "Stop");
    expect(root.textContent).toContain("Preparing microphone");
    expect(stopButton.disabled).toBe(false);

    stopButton.click();

    expect(FakeRecognition.latest?.stopped).toBe(true);
    expect(button(root, "Start listening").disabled).toBe(false);
  });

  it("keeps an error visible when saving a partial transcript after a speech failure", () => {
    enableTranscriptHistory();
    const { root } = mountApp();

    button(root, "Start listening").click();
    FakeRecognition.latest?.emitFinal("partial dictation before network loss");
    FakeRecognition.latest?.emitError("network");
    button(root, "Stop").click();

    const persisted = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(persisted[0]?.text).toBe("partial dictation before network loss");
    expect(root.textContent).toContain("Saved partial transcript after an error");
    expect(root.textContent).toContain("network problem");
  });

  it("merges imported history into existing saved transcripts", async () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "existing-entry", text: "Keep this existing note" })]),
    );

    const { root } = mountApp();
    const importInput = root.querySelector<HTMLInputElement>('[data-action="import-history"]');

    if (!importInput) {
      throw new Error("Import input did not render");
    }

    const validImport = new File(
      [
        JSON.stringify([
          sampleEntry({ id: "imported-entry-1", text: "First imported note" }),
          sampleEntry({ id: "imported-entry-2", text: "Second imported note" }),
        ]),
      ],
      "history.json",
      { type: "application/json" },
    );

    Object.defineProperty(importInput, "files", {
      configurable: true,
      value: [validImport],
    });
    importInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(root.textContent).toContain("Imported 2 saved transcripts."));
    expect(root.textContent).toContain("Keep this existing note");
    expect(root.textContent).toContain("First imported note");
    expect(root.textContent).toContain("Second imported note");

    const mergedHistory = JSON.parse(
      localStorage.getItem("auralis:history:v1") ?? "[]",
    ) as TranscriptEntry[];
    expect(mergedHistory.map((entry) => entry.id)).toEqual([
      "imported-entry-1",
      "imported-entry-2",
      "existing-entry",
    ]);
  });

  it("rejects oversized history import files before reading their contents", async () => {
    const { root } = mountApp();
    const importInput = root.querySelector<HTMLInputElement>('[data-action="import-history"]');

    if (!importInput) {
      throw new Error("Import input did not render");
    }

    const oversizedImport = new File([JSON.stringify([sampleEntry()])], "history-too-large.json", {
      type: "application/json",
    });
    Object.defineProperty(oversizedImport, "size", {
      configurable: true,
      value: MAX_IMPORT_FILE_BYTES + 1,
    });
    const textSpy = vi.spyOn(oversizedImport, "text");

    Object.defineProperty(importInput, "files", {
      configurable: true,
      value: [oversizedImport],
    });
    importInput.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(root.textContent).toContain(
        `Imported history file is too large. Choose a JSON export at most ${Math.round(
          MAX_IMPORT_FILE_BYTES / 1024,
        )} KiB.`,
      ),
    );
    expect(textSpy).not.toHaveBeenCalled();
  });

  it("adds live regions and contextual labels for dynamic status and history controls", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry({ id: "entry-a11y", text: "Accessible history controls" })]),
    );

    const { root } = mountApp();

    expect(root.querySelector('[data-field="status"]')?.getAttribute("role")).toBe("status");
    expect(root.querySelector('[data-field="flash"]')?.getAttribute("aria-live")).toBe("polite");
    expect(root.querySelector('[data-action="import-history-trigger"]')).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(root.querySelector('[data-entry-action="copy"]')?.getAttribute("aria-label")).toContain(
      "Copy saved transcript from",
    );
    expect(
      root.querySelector('[data-entry-action="delete"]')?.getAttribute("aria-label"),
    ).toContain("Delete saved transcript from");
  });
});
