import lynxAvatarUrl from "./assets/auralis-lynx-avatar.png";
import { desktopWhisperSupported, startDesktopWhisperSession } from "./lib/desktopSpeech";
import {
  applyPersonalTextSettings,
  parsePersonalTextRules,
  serializePersonalTextRules,
} from "./lib/personal-text";
import {
  coerceModelForProvider,
  DEFAULT_SETTINGS,
  LANGUAGE_OPTIONS,
  modelLabel,
  modelOptionsForProvider,
  OUTPUT_MODE_OPTIONS,
  outputModeLabel,
  PROVIDER_OPTIONS,
  providerLabel,
} from "./lib/settings";
import {
  browserSpeechSupported,
  browserSupportsLocalRecognition,
  startBrowserSpeechSession,
} from "./lib/speech";
import {
  hasPersistedSettings,
  importHistoryFromJson,
  loadHistory,
  loadPersonalTextSettings,
  loadSettings,
  MAX_ENTRY_TEXT_LENGTH,
  MAX_HISTORY_ITEMS,
  MAX_IMPORT_FILE_BYTES,
  saveHistory,
  savePersonalTextSettings,
  saveSettings,
  trimHistory,
} from "./lib/storage";
import {
  appendTranscript,
  buildTranscriptEntry,
  countTranscriptCharacters,
  countTranscriptWords,
  formatDuration,
  formatTimestamp,
  formatTranscriptForOutput,
  summarizeHistory,
} from "./lib/transcript";
import type {
  PersonalTextSettings,
  SpeechSession,
  TranscriptEntry,
  TranscriptSettings,
} from "./lib/types";

interface DesktopTextActionResult {
  message: string;
  ok: boolean;
  pasted?: boolean;
}

interface DesktopTranscribeRequest {
  audioData: ArrayBuffer;
  language: string;
  mimeType: string;
  modelId: TranscriptSettings["modelId"];
  providerId: TranscriptSettings["providerId"];
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
  providerId?: TranscriptSettings["providerId"];
  text?: string;
}

type WhisperEngineState = "checking" | "error" | "installing" | "missing" | "ready" | "unknown";

interface DesktopWhisperEngineStatus {
  message: string;
  modelId?: TranscriptSettings["modelId"] | string;
  modelCached?: boolean;
  ok: boolean;
  python?: string;
  runtimeDir?: string;
  state: WhisperEngineState | string;
  version?: string;
}

interface DesktopInfo {
  appVersion?: string;
  copyShortcutLabel?: string;
  ok?: boolean;
  pasteShortcutLabel?: string;
  platform: string;
  shortcutLabel: string;
  shortcutWarnings?: string[];
  toggleShortcutLabel?: string | null;
}

interface DesktopCaptureStatePayload {
  micLevel: number;
  muteSystemAudio: boolean;
  status: AppStatus;
}

interface DesktopBridge {
  copyText?: (text: string) => Promise<DesktopTextActionResult>;
  getInfo?: () => Promise<DesktopInfo>;
  installUpdate?: () => Promise<DesktopTextActionResult>;
  notify?: (message: string) => Promise<DesktopTextActionResult>;
  pasteText?: (text: string, pasteTargetToken?: string | null) => Promise<DesktopTextActionResult>;
  platform: string;
  setCaptureState?: (payload: DesktopCaptureStatePayload) => void;
  setupWhisperRuntime?: (
    modelId: TranscriptSettings["modelId"],
  ) => Promise<DesktopWhisperEngineStatus>;
  shortcutLabel: string;
  toggleShortcutLabel?: string | null;
  transcribeAudio?: (request: DesktopTranscribeRequest) => Promise<DesktopTranscribeResult>;
  whisperStatus?: (modelId: TranscriptSettings["modelId"]) => Promise<DesktopWhisperEngineStatus>;
}

type BrowserWindow = Window &
  typeof globalThis & {
    auralisDesktop?: DesktopBridge;
  };
type FlashTone = "error" | "info" | "success";
type AppStatus = "idle" | "listening" | "recording" | "starting" | "transcribing" | "unsupported";
type TranscriptDeliveryMode = "copy" | "paste";

interface DesktopToggleDetail {
  action?: "start" | "stop";
  autoPaste?: boolean;
  holdToTalk?: boolean;
  pasteTargetToken?: string | null;
  startedFromShortcut?: boolean;
}

interface FlashState {
  text: string;
  tone: FlashTone;
}

const mountedAppDisposers = new WeakMap<BrowserWindow, () => void>();

interface AppState {
  activeSession: SpeechSession | null;
  awaitingClearAllConfirmation: boolean;
  desktopInfo: DesktopInfo | null;
  flash: FlashState | null;
  history: TranscriptEntry[];
  historyExpandedIds: Set<string>;
  historyLanguageFilter: string;
  historyPanelOpen: boolean;
  historySearch: string;
  interimText: string;
  micLevel: number;
  personalTextSettings: PersonalTextSettings;
  personalTextRulesDraft: string;
  sessionError: string | null;
  sessionDeliveryMode: TranscriptDeliveryMode | null;
  sessionPasteTargetToken: string | null;
  sessionSettings: TranscriptSettings | null;
  sessionStartedAt: number | null;
  sessionStartedFromHoldToTalk: boolean;
  sessionStartedFromShortcut: boolean;
  sessionTranscript: string;
  transcriptionStats: string | null;
  settings: TranscriptSettings;
  status: AppStatus;
  transcript: string;
  updateInstalling: boolean;
  whisperEngine: DesktopWhisperEngineStatus;
}

const WHISPER_ENGINE_BUSY_STATES = new Set<WhisperEngineState | string>(["checking", "installing"]);

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);

  if (className) {
    node.className = className;
  }

  return node;
}

function requiredQuery<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);

  if (!node) {
    throw new Error(`The app template is missing required element: ${selector}`);
  }

  return node;
}

function statusCopy(status: AppStatus): string {
  switch (status) {
    case "starting":
      return "Preparing microphone";
    case "listening":
      return "Listening live";
    case "recording":
      return "Recording locally";
    case "transcribing":
      return "Transcribing";
    case "unsupported":
      return "Speech recognition unavailable";
    default:
      return "Ready";
  }
}

function clampLevel(level: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
}

function ensureTrailingDictationSpace(text: string): string {
  const value = text.trimEnd();
  return value ? `${value} ` : "";
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function uniqueHistoryLanguages(history: TranscriptEntry[]): string[] {
  return [...new Set(history.map((entry) => entry.language))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function filterHistory(
  history: TranscriptEntry[],
  search: string,
  languageFilter: string,
): TranscriptEntry[] {
  const query = normalizedSearch(search);

  return history.filter((entry) => {
    const matchesLanguage = languageFilter === "all" || entry.language === languageFilter;
    const haystack =
      `${entry.text} ${entry.rawText ?? ""} ${entry.language} ${providerLabel(entry.providerId)} ${modelLabel(
        entry.modelId,
      )} ${entry.outputMode ? outputModeLabel(entry.outputMode) : "Literal"}`.toLocaleLowerCase();
    const matchesSearch = !query || haystack.includes(query);

    return matchesLanguage && matchesSearch;
  });
}

async function copyText(target: BrowserWindow, text: string): Promise<void> {
  if (!text.trim()) {
    throw new Error("There is no transcript to copy yet.");
  }

  if (target.auralisDesktop?.copyText) {
    const result = await target.auralisDesktop.copyText(text);

    if (!result.ok) {
      throw new Error(result.message || "Copy failed.");
    }

    return;
  }

  if (!target.navigator.clipboard) {
    throw new Error("Clipboard access is unavailable in this browser context.");
  }

  await target.navigator.clipboard.writeText(text);
}

async function pasteText(
  target: BrowserWindow,
  text: string,
  pasteTargetToken?: string | null,
): Promise<DesktopTextActionResult> {
  if (!text.trim()) {
    throw new Error("There is no transcript to paste yet.");
  }

  if (target.auralisDesktop?.pasteText) {
    const result = pasteTargetToken
      ? await target.auralisDesktop.pasteText(text, pasteTargetToken)
      : await target.auralisDesktop.pasteText(text);

    if (!result.ok) {
      throw new Error(result.message || "Paste failed.");
    }

    return result;
  }

  await copyText(target, text);
  return {
    message: "Transcript copied to the clipboard. Press Ctrl+V in your target app.",
    ok: true,
    pasted: false,
  };
}

function exportHistory(target: BrowserWindow, history: TranscriptEntry[]): void {
  const payload = JSON.stringify(history, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = target.URL.createObjectURL(blob);
  const anchor = target.document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  anchor.href = url;
  anchor.download = `auralis-history-${date}.json`;
  anchor.click();
  target.URL.revokeObjectURL(url);
}

export function mountVoiceToTextApp(root: HTMLDivElement, target: BrowserWindow): void {
  mountedAppDisposers.get(target)?.();
  mountedAppDisposers.delete(target);

  const supportsSpeech = browserSpeechSupported(target);
  const supportsDesktopWhisper = desktopWhisperSupported(target);
  const supportsAnyProvider = supportsSpeech || supportsDesktopWhisper;
  const supportsLocalModel = browserSupportsLocalRecognition(target);
  const desktopBridge = target.auralisDesktop ?? null;
  const initialDesktopInfo: DesktopInfo | null = desktopBridge
    ? {
        platform: desktopBridge.platform,
        shortcutLabel: desktopBridge.shortcutLabel,
        shortcutWarnings: [],
        toggleShortcutLabel: desktopBridge.toggleShortcutLabel ?? null,
      }
    : null;
  const savedSettings = loadSettings();
  const initialHistory = loadHistory();
  const initialPersonalTextSettings = loadPersonalTextSettings();
  const hasSavedSettings = hasPersistedSettings(target.localStorage);
  const initialSettings: TranscriptSettings =
    supportsDesktopWhisper && !hasSavedSettings
      ? {
          ...savedSettings,
          providerId: "desktop-whisper",
          modelId: "desktop-whisper-base",
        }
      : savedSettings;
  const state: AppState = {
    activeSession: null,
    awaitingClearAllConfirmation: false,
    desktopInfo: initialDesktopInfo,
    flash: supportsAnyProvider
      ? null
      : {
          tone: "error",
          text: "No speech provider is available. Use Chrome or Edge for Web Speech, or run the Auralis desktop app with local Whisper configured.",
        },
    history: initialHistory,
    historyExpandedIds: new Set<string>(),
    historyLanguageFilter: "all",
    historyPanelOpen: initialHistory.length > 0,
    historySearch: "",
    interimText: "",
    micLevel: 0,
    personalTextSettings: initialPersonalTextSettings,
    personalTextRulesDraft: serializePersonalTextRules(initialPersonalTextSettings.rules),
    sessionError: null,
    sessionDeliveryMode: null,
    sessionPasteTargetToken: null,
    sessionSettings: null,
    sessionStartedAt: null,
    sessionStartedFromHoldToTalk: false,
    sessionStartedFromShortcut: false,
    sessionTranscript: "",
    transcriptionStats: null,
    settings: initialSettings,
    status: supportsAnyProvider ? "idle" : "unsupported",
    transcript: "",
    updateInstalling: false,
    whisperEngine:
      supportsDesktopWhisper && desktopBridge?.whisperStatus
        ? {
            message: "Checking local Whisper engine...",
            modelId: initialSettings.modelId,
            ok: false,
            state: "checking",
          }
        : {
            message: "Local Whisper engine status is managed by the desktop bridge.",
            modelId: initialSettings.modelId,
            ok: true,
            state: "ready",
          },
  };
  let whisperEngineRequestId = 0;
  let transcriptDeliveryRequestId = 0;
  let lastPublishedCaptureStateKey: string | null = null;

  function shortcutToggleLabel(): string {
    return (
      state.desktopInfo?.toggleShortcutLabel ??
      state.desktopInfo?.shortcutLabel.replace(" toggles from any app", "") ??
      "the shortcut"
    );
  }

  function notifyDesktop(message: string): void {
    if (!desktopBridge?.notify || !message.trim()) {
      return;
    }

    void desktopBridge.notify(message).catch(() => undefined);
  }

  async function installUpdate(): Promise<void> {
    if (state.updateInstalling) {
      return;
    }

    if (!desktopBridge?.installUpdate) {
      setFlash("error", "Automatic Auralis updates are only available in the desktop app.");
      render();
      return;
    }

    state.updateInstalling = true;
    render();

    try {
      const result = await desktopBridge.installUpdate();
      setFlash(result.ok ? "success" : "error", result.message);
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : "Could not install the update.");
    } finally {
      state.updateInstalling = false;
      render();
    }
  }

  function shouldMuteSystemAudioForStatus(): boolean {
    return (
      state.settings.muteSystemAudio &&
      ["listening", "recording", "starting"].includes(state.status)
    );
  }

  function publishCaptureState(): void {
    if (!desktopBridge?.setCaptureState) {
      return;
    }

    const micLevel = state.status === "recording" ? clampLevel(state.micLevel) : 0;
    const payload: DesktopCaptureStatePayload = {
      micLevel,
      muteSystemAudio: shouldMuteSystemAudioForStatus(),
      status: state.status,
    };
    const payloadKey = `${payload.status}:${payload.muteSystemAudio}:${payload.micLevel.toFixed(2)}`;
    if (lastPublishedCaptureStateKey === payloadKey) {
      return;
    }

    lastPublishedCaptureStateKey = payloadKey;
    desktopBridge.setCaptureState(payload);
  }

  async function refreshDesktopInfo(): Promise<void> {
    if (!desktopBridge?.getInfo) {
      return;
    }

    try {
      const info = await desktopBridge.getInfo();
      if (!info?.shortcutLabel || !info.platform) {
        return;
      }
      state.desktopInfo = {
        ...state.desktopInfo,
        ...info,
        shortcutWarnings: info.shortcutWarnings ?? [],
      };
      render();
    } catch {
      // The static preload label remains usable if the dynamic info call fails.
    }
  }

  root.innerHTML = `
    <main class="shell" data-field="shell">
      <header class="app-topbar" aria-label="Auralis app header">
        <div class="brand-lockup">
          <span class="brand-mark brand-mark--avatar" data-field="brand-avatar" aria-hidden="true">
            <img src="${lynxAvatarUrl}" alt="" draggable="false" decoding="async" />
          </span>
          <div class="brand-copy">
            <p class="brand-name">Auralis <span class="brand-version" data-field="brand-version"></span></p>
            <p class="brand-subtitle">Local desktop dictation</p>
          </div>
        </div>
        <div class="topbar-status" data-field="status-pill" role="status" aria-live="polite">Ready</div>
      </header>

      <section class="recorder-card" aria-labelledby="recorder-title">
        <div class="recorder-card__copy">
          <p class="eyebrow">Private speech to text</p>
          <h1 id="recorder-title" data-field="hero-title">Record. Transcribe. Paste.</h1>
          <p class="hero__lede" data-field="mode-copy">
            Desktop Whisper records microphone audio locally, then copies or inserts the transcript after you stop.
          </p>
          <p class="status-card__meta" data-field="support"></p>
          <div class="hero__actions">
            <button class="button button--primary button--record" data-action="start" type="button">Start recording</button>
          </div>
          <p class="keyboard-hint" data-field="desktop-status-card" hidden>
            <span data-field="desktop-status"></span>
          </p>
        </div>

        <div class="capture-strip" data-field="capture-strip" aria-label="Current recording status">
          <div class="capture-strip__state">
            <p class="status-card__label">Current state</p>
            <p class="status-card__value" data-field="status" role="status" aria-live="polite"></p>
          </div>
          <div class="mic-meter" data-field="mic-meter" aria-label="Microphone activity">
            <span class="mic-meter__bar" data-field="meter-fill"></span>
          </div>
          <p class="status-card__value status-card__value--small" data-field="interim" role="status" aria-live="polite"></p>
        </div>
        <p class="status-card__meta flow-hint" data-field="flow-hint"></p>
      </section>

      ${
        supportsDesktopWhisper && !hasSavedSettings
          ? `<section class="setup-checklist panel" data-field="setup-checklist" aria-labelledby="setup-checklist-title">
        <div>
          <p class="eyebrow">First-run readiness</p>
          <h2 id="setup-checklist-title">Start private, keep options open.</h2>
          <p class="panel__note">
            Auralis starts on Desktop local Whisper base so the default path is local-first. OpenRouter STT models remain selectable when you prefer faster cloud transcription.
          </p>
        </div>
        <ol class="setup-checklist__items" aria-label="First-run readiness steps">
          <li><strong>Private offline:</strong> install or refresh the local engine if the base model is missing.</li>
          <li><strong>Fast cloud:</strong> choose OpenRouter STT in Advanced settings when speed matters and your API key is configured in Electron main.</li>
          <li><strong>Mic permission appears on first recording:</strong> grant it once, then use the global shortcut.</li>
          <li><strong>Shortcut and paste test:</strong> place the cursor in another app, record, stop, and confirm copy or paste delivery.</li>
        </ol>
      </section>`
          : ""
      }

      <section class="workspace" data-field="workspace">
        <article class="panel panel--large transcript-panel">
          <div class="panel__header">
            <div>
              <p class="eyebrow">Transcript</p>
              <h2>Transcript</h2>
              <p class="panel__note">Edit lightly, then copy or paste again.</p>
            </div>
            <div class="toolbar">
              <button class="button button--secondary" data-action="copy-current" type="button">Copy</button>
              <button class="button button--primary" data-action="paste-current" type="button">Paste to previous app</button>
              <button class="button button--ghost" data-action="clear-current" type="button">Clear</button>
            </div>
          </div>
          <details class="shortcut-map-disclosure" data-field="shortcut-map-disclosure">
            <summary>Shortcuts</summary>
            <div class="shortcut-map" data-field="shortcut-map" aria-label="Keyboard shortcuts"></div>
          </details>
          <label class="sr-only" for="transcript-area">Transcript</label>
          <textarea
            id="transcript-area"
            class="transcript-area"
            data-field="transcript"
            placeholder="Your transcript appears here after you stop recording. You can edit it before copying."
          ></textarea>
          <div class="editor-footer">
            <details class="flash flash--compact" data-field="flash-details" hidden>
              <summary data-field="flash-summary" role="status" aria-live="polite"></summary>
              <p data-field="flash" role="status" aria-live="polite"></p>
            </details>
            <p class="transcript-stats" data-field="transcript-stats"></p>
          </div>
        </article>
      </section>

      <details class="panel advanced-settings" data-field="advanced-settings">
        <summary class="advanced-settings__summary">
          <span>
            <span class="eyebrow">Settings</span>
            <span class="advanced-settings__title">Advanced settings</span>
          </span>
          <small>Engine, output, local history, updates, and personal text rules</small>
        </summary>
        <div class="advanced-settings__content">
          <details class="engine-settings" data-field="engine-settings">
            <summary>
              <span>Engine settings</span>
              <small>Provider, model, language, and repair tools</small>
            </summary>
            <div class="settings-grid">
              <label class="field">
                <span>Provider</span>
                <select data-setting="providerId"></select>
              </label>
              <label class="field">
                <span>Model</span>
                <select data-setting="modelId"></select>
              </label>
              <label class="field">
                <span>Language</span>
                <select data-setting="language"></select>
              </label>
              <label class="field">
                <span>Output</span>
                <select data-setting="outputMode"></select>
              </label>
              <label class="field field--checkbox">
                <input data-setting="continuous" type="checkbox" />
                <span>Keep browser Web Speech listening until I stop</span>
              </label>
              <label class="field field--checkbox">
                <input data-setting="interimResults" type="checkbox" />
                <span>Show browser interim text while speaking</span>
              </label>
              <label class="field field--checkbox">
                <input data-setting="muteSystemAudio" type="checkbox" />
                <span>Mute system audio while recording</span>
              </label>
              <label class="field field--checkbox">
                <input data-setting="saveTranscriptHistory" type="checkbox" />
                <span>Save completed transcripts in local history</span>
              </label>
            </div>
            <p class="panel__note" data-field="model-note"></p>
            <div class="engine-card" data-field="whisper-engine-card" hidden>
              <div>
                <p class="eyebrow">Local engine</p>
                <p class="engine-card__status" data-field="whisper-engine-status" role="status" aria-live="polite"></p>
                <p class="engine-card__meta" data-field="whisper-engine-meta"></p>
              </div>
              <div class="toolbar">
                <button class="button button--secondary" data-action="refresh-whisper-engine" type="button">Refresh engine</button>
                <button class="button button--primary" data-action="setup-whisper-engine" type="button">Install / repair local engine</button>
              </div>
            </div>
          </details>
          <details class="engine-settings" data-field="personal-text-settings">
            <summary>
              <span>Personal text rules</span>
              <small>Local vocabulary, replacements, and snippets after transcription</small>
            </summary>
            <div class="settings-grid">
              <label class="field field--checkbox">
                <input data-setting="personal-text-enabled" type="checkbox" />
                <span>Apply personal rules to completed transcripts</span>
              </label>
              <label class="field">
                <span>Rules</span>
                <textarea
                  class="personal-text-rules"
                  data-setting="personal-text-rules"
                  spellcheck="false"
                  placeholder="vocabulary: open router => OpenRouter&#10;replacement: oralis => Auralis&#10;snippet: ;sig => Thanks,\\nChris"
                ></textarea>
              </label>
            </div>
            <p class="panel__note">Stored locally on this device in browser storage. Do not store passwords, API keys, or tokens.</p>
            <div class="toolbar">
              <button class="button button--secondary" data-action="save-personal-text" type="button">Save personal rules</button>
            </div>
          </details>
          ${
            desktopBridge
              ? `<div class="engine-card app-update-card" data-field="app-update-card">
              <div>
                <p class="eyebrow">App update</p>
                <p class="engine-card__status" data-field="app-update-status">Update Auralis</p>
                <p class="engine-card__meta" data-field="app-update-meta"></p>
              </div>
              <div class="toolbar">
                <button class="button button--secondary" data-action="install-update" type="button">Update now</button>
              </div>
            </div>`
              : ""
          }
        </div>
      </details>

      <details class="panel history-panel" data-field="history-section">
        <summary class="history-summary" data-field="history-summary">
          <span>
            <span class="eyebrow">Archive</span>
            <span class="history-summary__title">History</span>
          </span>
          <span class="history-summary__copy" data-field="history-summary-copy">0 saved transcripts</span>
        </summary>
        <div class="history-panel__content">
        <div class="panel__header">
          <div>
            <p class="eyebrow">History</p>
            <h2>Saved transcriptions</h2>
          </div>
          <div class="toolbar">
            <button class="button button--secondary" data-action="export-history" type="button">Export JSON</button>
            <button class="button button--ghost import-control" data-action="import-history-trigger" type="button">Import JSON</button>
            <input class="sr-only" data-action="import-history" type="file" accept="application/json,.json" aria-label="Import saved transcript history JSON" />
            <button class="button button--ghost button--danger" data-action="clear-all-history" type="button">Clear all history</button>
          </div>
        </div>
        <div class="history-tools">
          <label class="field">
            <span>Search saved transcripts</span>
            <input data-action="history-search" type="search" placeholder="Search text, language, provider, or model" />
          </label>
          <label class="field">
            <span>Language filter</span>
            <select data-action="history-language-filter"></select>
          </label>
        </div>
        <p class="panel__note" data-field="history-stats"></p>
        <ul class="history-list" data-field="history"></ul>
        </div>
      </details>
    </main>
  `;

  const startButton = requiredQuery<HTMLButtonElement>(root, '[data-action="start"]');
  const shell = requiredQuery<HTMLElement>(root, '[data-field="shell"]');
  const workspace = requiredQuery<HTMLElement>(root, '[data-field="workspace"]');
  const statusPill = requiredQuery<HTMLElement>(root, '[data-field="status-pill"]');
  const brandVersion = requiredQuery<HTMLElement>(root, '[data-field="brand-version"]');
  const heroTitle = requiredQuery<HTMLElement>(root, '[data-field="hero-title"]');
  const copyCurrentButton = requiredQuery<HTMLButtonElement>(root, '[data-action="copy-current"]');
  const pasteCurrentButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="paste-current"]',
  );
  const clearCurrentButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="clear-current"]',
  );
  const transcriptArea = requiredQuery<HTMLTextAreaElement>(root, '[data-field="transcript"]');
  const statusField = requiredQuery<HTMLElement>(root, '[data-field="status"]');
  const supportField = requiredQuery<HTMLElement>(root, '[data-field="support"]');
  const modeCopy = requiredQuery<HTMLElement>(root, '[data-field="mode-copy"]');
  const interimField = requiredQuery<HTMLElement>(root, '[data-field="interim"]');
  const micMeter = requiredQuery<HTMLElement>(root, '[data-field="mic-meter"]');
  const meterFill = requiredQuery<HTMLElement>(root, '[data-field="meter-fill"]');
  const flowHint = requiredQuery<HTMLElement>(root, '[data-field="flow-hint"]');
  const transcriptStatsField = requiredQuery<HTMLElement>(root, '[data-field="transcript-stats"]');
  const desktopStatusCard = requiredQuery<HTMLElement>(root, '[data-field="desktop-status-card"]');
  const desktopStatusField = requiredQuery<HTMLElement>(root, '[data-field="desktop-status"]');
  const flashDetails = requiredQuery<HTMLDetailsElement>(root, '[data-field="flash-details"]');
  const flashSummary = requiredQuery<HTMLElement>(root, '[data-field="flash-summary"]');
  const flashField = requiredQuery<HTMLElement>(root, '[data-field="flash"]');
  const shortcutMap = requiredQuery<HTMLElement>(root, '[data-field="shortcut-map"]');
  const advancedSettings = requiredQuery<HTMLDetailsElement>(
    root,
    '[data-field="advanced-settings"]',
  );
  const engineSettings = requiredQuery<HTMLDetailsElement>(root, '[data-field="engine-settings"]');
  const historySection = requiredQuery<HTMLDetailsElement>(root, '[data-field="history-section"]');
  const historySummaryCopy = requiredQuery<HTMLElement>(
    root,
    '[data-field="history-summary-copy"]',
  );
  const historyField = requiredQuery<HTMLUListElement>(root, '[data-field="history"]');
  const historyStatsField = requiredQuery<HTMLElement>(root, '[data-field="history-stats"]');
  const historySearchInput = requiredQuery<HTMLInputElement>(
    root,
    '[data-action="history-search"]',
  );
  const historyLanguageFilter = requiredQuery<HTMLSelectElement>(
    root,
    '[data-action="history-language-filter"]',
  );
  const exportHistoryButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="export-history"]',
  );
  const importHistoryTrigger = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="import-history-trigger"]',
  );
  const importHistoryInput = requiredQuery<HTMLInputElement>(
    root,
    '[data-action="import-history"]',
  );
  const clearAllHistoryButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="clear-all-history"]',
  );
  const modelNoteField = requiredQuery<HTMLElement>(root, '[data-field="model-note"]');
  const whisperEngineCard = requiredQuery<HTMLElement>(root, '[data-field="whisper-engine-card"]');
  const whisperEngineStatus = requiredQuery<HTMLElement>(
    root,
    '[data-field="whisper-engine-status"]',
  );
  const whisperEngineMeta = requiredQuery<HTMLElement>(root, '[data-field="whisper-engine-meta"]');
  const refreshWhisperEngineButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="refresh-whisper-engine"]',
  );
  const setupWhisperEngineButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="setup-whisper-engine"]',
  );
  const appUpdateCard = root.querySelector<HTMLElement>('[data-field="app-update-card"]');
  const appUpdateMeta = root.querySelector<HTMLElement>('[data-field="app-update-meta"]');
  const installUpdateButton = root.querySelector<HTMLButtonElement>(
    '[data-action="install-update"]',
  );
  const providerSelect = requiredQuery<HTMLSelectElement>(root, '[data-setting="providerId"]');
  const modelSelect = requiredQuery<HTMLSelectElement>(root, '[data-setting="modelId"]');
  const languageSelect = requiredQuery<HTMLSelectElement>(root, '[data-setting="language"]');
  const outputModeSelect = requiredQuery<HTMLSelectElement>(root, '[data-setting="outputMode"]');
  const continuousCheckbox = requiredQuery<HTMLInputElement>(root, '[data-setting="continuous"]');
  const interimCheckbox = requiredQuery<HTMLInputElement>(root, '[data-setting="interimResults"]');
  const muteSystemAudioCheckbox = requiredQuery<HTMLInputElement>(
    root,
    '[data-setting="muteSystemAudio"]',
  );
  const saveTranscriptHistoryCheckbox = requiredQuery<HTMLInputElement>(
    root,
    '[data-setting="saveTranscriptHistory"]',
  );
  const personalTextEnabledCheckbox = requiredQuery<HTMLInputElement>(
    root,
    '[data-setting="personal-text-enabled"]',
  );
  const personalTextRulesInput = requiredQuery<HTMLTextAreaElement>(
    root,
    '[data-setting="personal-text-rules"]',
  );
  const savePersonalTextButton = requiredQuery<HTMLButtonElement>(
    root,
    '[data-action="save-personal-text"]',
  );

  function flashSummaryText(text: string, tone: FlashTone): string {
    if (tone === "error") {
      return "Needs attention";
    }

    const normalizedText = text.toLowerCase();
    if (normalizedText.includes("pasted")) {
      return "Pasted";
    }
    if (normalizedText.includes("copied")) {
      return "Copied";
    }
    if (normalizedText.includes("ready")) {
      return "Ready";
    }
    if (normalizedText.includes("saved")) {
      return "Saved";
    }

    return text ? "Status" : "";
  }

  function setFlash(tone: FlashTone, text: string): void {
    state.flash = { tone, text };
  }

  function persistHistory(): boolean {
    try {
      saveHistory(state.history);
      return true;
    } catch {
      setFlash(
        "error",
        "Could not save transcript history locally. Export important transcripts before closing Auralis.",
      );
      return false;
    }
  }

  function persistSettings(): boolean {
    try {
      saveSettings(state.settings);
      return true;
    } catch {
      setFlash("error", "Could not save settings locally. This change may reset after restart.");
      return false;
    }
  }

  function persistPersonalTextSettings(): boolean {
    try {
      savePersonalTextSettings(state.personalTextSettings);
      return true;
    } catch (error) {
      setFlash(
        "error",
        error instanceof Error
          ? error.message
          : "Could not save personal text rules locally. This change may reset after restart.",
      );
      return false;
    }
  }

  async function deliverFinishedTranscript(
    text: string,
    completionMessage: string,
    completionTone: FlashTone,
    deliveryMode: TranscriptDeliveryMode,
    pasteTargetToken: string | null = null,
    notifyWhenDone = false,
  ): Promise<void> {
    if (!desktopBridge) {
      return;
    }

    const deliveryRequestId = ++transcriptDeliveryRequestId;

    try {
      if (deliveryMode === "paste" && typeof desktopBridge.pasteText === "function") {
        const result = await pasteText(target, text, pasteTargetToken);

        if (deliveryRequestId !== transcriptDeliveryRequestId || state.activeSession) {
          return;
        }

        const deliveryTone =
          completionTone === "error" ? "error" : result.pasted ? "success" : "info";
        setFlash(deliveryTone, `${completionMessage} ${result.message}`);
        if (notifyWhenDone) {
          notifyDesktop(result.message);
        }
      } else {
        await copyText(target, text);

        if (deliveryRequestId !== transcriptDeliveryRequestId || state.activeSession) {
          return;
        }

        const copyMessage = `${completionMessage} Transcript copied to the clipboard.`;
        setFlash(completionTone, copyMessage);
        if (notifyWhenDone) {
          notifyDesktop(copyMessage);
        }
      }
    } catch (error) {
      if (deliveryRequestId !== transcriptDeliveryRequestId || state.activeSession) {
        return;
      }

      const message = error instanceof Error ? error.message : "Automatic paste failed.";
      const deliveryError = `${completionMessage} Automatic paste failed: ${message}`;
      setFlash("error", deliveryError);
      if (notifyWhenDone) {
        notifyDesktop(deliveryError);
      }
    }

    render();
  }

  function currentWhisperModelId(): TranscriptSettings["modelId"] {
    return state.settings.modelId;
  }

  function whisperEngineMatchesCurrentModel(): boolean {
    return state.whisperEngine.modelId === currentWhisperModelId();
  }

  function whisperEngineBusy(): boolean {
    return WHISPER_ENGINE_BUSY_STATES.has(state.whisperEngine.state);
  }

  function desktopWhisperEngineReady(): boolean {
    if (!supportsDesktopWhisper) {
      return false;
    }

    if (!desktopBridge?.whisperStatus) {
      return true;
    }

    return (
      state.whisperEngine.ok &&
      state.whisperEngine.state === "ready" &&
      whisperEngineMatchesCurrentModel()
    );
  }

  function currentProviderAvailable(): boolean {
    if (state.settings.providerId === "desktop-whisper") {
      return desktopWhisperEngineReady();
    }

    if (state.settings.providerId === "openrouter-stt") {
      return supportsDesktopWhisper;
    }

    return supportsSpeech;
  }

  function engineMetaCopy(): string {
    const parts = [];

    if (state.whisperEngine.version) {
      parts.push(`faster-whisper ${state.whisperEngine.version}`);
    }

    if (state.whisperEngine.python) {
      parts.push(state.whisperEngine.python);
    }

    if (state.whisperEngine.modelCached) {
      parts.push("managed model cached");
    }

    if (state.whisperEngine.runtimeDir && state.whisperEngine.state !== "ready") {
      parts.push(`runtime: ${state.whisperEngine.runtimeDir}`);
    }

    return parts.join(" • ");
  }

  function normalizeEngineStatus(
    status: DesktopWhisperEngineStatus,
    requestedModelId: TranscriptSettings["modelId"],
  ): DesktopWhisperEngineStatus {
    return {
      ...status,
      message:
        status.message ||
        (status.ok ? "Local Whisper engine is ready." : "Local Whisper engine is unavailable."),
      modelId: status.modelId || requestedModelId,
      state: status.state || (status.ok ? "ready" : "error"),
    };
  }

  function shouldApplyWhisperEngineResponse(
    requestId: number,
    requestedModelId: TranscriptSettings["modelId"],
  ): boolean {
    return (
      requestId === whisperEngineRequestId &&
      state.settings.providerId === "desktop-whisper" &&
      currentWhisperModelId() === requestedModelId
    );
  }

  async function refreshWhisperEngineStatus(
    requestedModelId: TranscriptSettings["modelId"] = currentWhisperModelId(),
  ): Promise<void> {
    if (!desktopBridge?.whisperStatus || state.settings.providerId !== "desktop-whisper") {
      return;
    }

    const requestId = ++whisperEngineRequestId;
    state.whisperEngine = {
      message: "Checking local Whisper engine...",
      modelId: requestedModelId,
      ok: false,
      state: "checking",
    };
    render();

    try {
      const status = normalizeEngineStatus(
        await desktopBridge.whisperStatus(requestedModelId),
        requestedModelId,
      );
      if (!shouldApplyWhisperEngineResponse(requestId, requestedModelId)) {
        return;
      }
      state.whisperEngine = status;
    } catch (error) {
      if (!shouldApplyWhisperEngineResponse(requestId, requestedModelId)) {
        return;
      }
      state.whisperEngine = {
        message: error instanceof Error ? error.message : "Local Whisper status check failed.",
        modelId: requestedModelId,
        ok: false,
        state: "error",
      };
    }

    render();
  }

  async function setupWhisperEngine(): Promise<void> {
    if (!desktopBridge?.setupWhisperRuntime) {
      setFlash(
        "error",
        "This Auralis build cannot install the local Whisper engine automatically.",
      );
      render();
      return;
    }

    const requestedModelId = currentWhisperModelId();
    const requestId = ++whisperEngineRequestId;
    state.whisperEngine = {
      message: "Installing local Whisper engine. This can take several minutes on first run...",
      modelId: requestedModelId,
      ok: false,
      state: "installing",
    };
    setFlash("info", "Installing local Whisper engine. Keep Auralis open.");
    render();

    try {
      const status = normalizeEngineStatus(
        await desktopBridge.setupWhisperRuntime(requestedModelId),
        requestedModelId,
      );
      if (!shouldApplyWhisperEngineResponse(requestId, requestedModelId)) {
        return;
      }
      state.whisperEngine = status;
      setFlash(state.whisperEngine.ok ? "success" : "error", state.whisperEngine.message);
    } catch (error) {
      if (!shouldApplyWhisperEngineResponse(requestId, requestedModelId)) {
        return;
      }
      state.whisperEngine = {
        message: error instanceof Error ? error.message : "Local Whisper setup failed.",
        modelId: requestedModelId,
        ok: false,
        state: "error",
      };
      setFlash("error", state.whisperEngine.message);
    }

    render();
  }

  function unavailableProviderMessage(): string {
    if (state.settings.providerId === "desktop-whisper") {
      return (
        state.whisperEngine.message ||
        "Desktop local Whisper needs the Auralis desktop app, microphone recording support, and a working local faster-whisper runtime."
      );
    }

    if (state.settings.providerId === "openrouter-stt") {
      return "OpenRouter transcription needs the Auralis desktop app, microphone recording support, and OPENROUTER_API_KEY configured in Electron main.";
    }

    return "This browser does not expose the Web Speech recognition API.";
  }

  function openRouterModelGuidance(): string {
    return "Recommended for speed: Whisper Large v3 Turbo. Try GPT-4o Mini Transcribe for a stronger speed/quality balance, GPT-4o Transcribe for difficult audio, or Local Whisper when offline privacy matters. OPENROUTER_API_KEY stays in Electron main and is never stored by the renderer.";
  }

  function mergeImportedHistory(importedHistory: TranscriptEntry[]): {
    history: TranscriptEntry[];
    skippedExistingCount: number;
  } {
    const importedIds = new Set(importedHistory.map((entry) => entry.id));
    const existingCandidates = state.history.filter((entry) => !importedIds.has(entry.id));
    const history = trimHistory([...importedHistory, ...existingCandidates]);
    const keptIds = new Set(history.map((entry) => entry.id));
    const skippedExistingCount = existingCandidates.filter(
      (entry) => !keptIds.has(entry.id),
    ).length;

    return { history, skippedExistingCount };
  }

  function renderHistoryLanguageFilter(): void {
    const selectedValue = state.historyLanguageFilter;
    historyLanguageFilter.replaceChildren();

    const allOption = el("option");
    allOption.value = "all";
    allOption.textContent = "All languages";
    historyLanguageFilter.append(allOption);

    for (const language of uniqueHistoryLanguages(state.history)) {
      const option = el("option");
      option.value = language;
      option.textContent = language;
      historyLanguageFilter.append(option);
    }

    const availableValues = new Set(
      [...historyLanguageFilter.options].map((option) => option.value),
    );
    state.historyLanguageFilter = availableValues.has(selectedValue) ? selectedValue : "all";
    historyLanguageFilter.value = state.historyLanguageFilter;
  }

  function renderHistory(): void {
    renderHistoryLanguageFilter();
    historyField.replaceChildren();

    const filteredHistory = filterHistory(
      state.history,
      state.historySearch,
      state.historyLanguageFilter,
    );
    const historySummary = summarizeHistory(state.history);
    const filteredSummary = summarizeHistory(filteredHistory);

    historySection.open = state.historyPanelOpen;
    workspace.dataset.layout = state.historyPanelOpen ? "review" : "focus";
    historySummaryCopy.textContent = `${pluralize(
      state.history.length,
      "saved transcript",
    )} • ${pluralize(historySummary.wordCount, "word")}`;

    historySearchInput.value = state.historySearch;
    historyStatsField.textContent = `Showing ${filteredHistory.length} of ${state.history.length} saved transcripts • ${pluralize(
      filteredSummary.wordCount,
      "word",
    )} visible • ${pluralize(historySummary.wordCount, "word")} total`;

    if (state.history.length === 0) {
      const empty = el("li", "history-item history-item--empty");
      empty.textContent = "Saved transcripts will appear here after you finish a recording.";
      historyField.append(empty);
      return;
    }

    if (filteredHistory.length === 0) {
      const empty = el("li", "history-item history-item--empty");
      const searchLabel = state.historySearch.trim()
        ? ` "${state.historySearch.trim()}"`
        : " the selected filters";
      empty.textContent = state.historySearch.trim()
        ? `No saved transcripts match "${state.historySearch.trim()}".`
        : `No saved transcripts match${searchLabel}.`;
      historyField.append(empty);
      return;
    }

    for (const entry of filteredHistory) {
      const item = el("li", "history-item");
      const body = el("div", "history-item__body");
      const meta = el("p", "history-item__meta");
      meta.textContent = `${formatTimestamp(entry.createdAt)} • ${providerLabel(entry.providerId)} • ${modelLabel(entry.modelId)} • ${entry.language} • ${entry.outputMode ? outputModeLabel(entry.outputMode) : "Literal"} • ${formatDuration(entry.durationMs)}`;

      const text = el("p", "history-item__text");
      const isExpanded = state.historyExpandedIds.has(entry.id);
      const isExpandable = entry.text.length > 260;
      text.id = `history-preview-${entry.id}`;
      text.textContent = entry.text;
      text.title = entry.text;
      text.dataset.expanded = String(isExpanded);

      body.append(meta, text);

      const actions = el("div", "history-item__actions");
      const actionContext = `saved transcript from ${formatTimestamp(entry.createdAt)}`;

      const useButton = el("button", "button button--secondary");
      useButton.type = "button";
      useButton.dataset.entryAction = "use";
      useButton.dataset.entryId = entry.id;
      useButton.textContent = "Load";
      useButton.setAttribute("aria-label", `Load ${actionContext}`);

      const copyButton = el("button", "button button--ghost");
      copyButton.type = "button";
      copyButton.dataset.entryAction = "copy";
      copyButton.dataset.entryId = entry.id;
      copyButton.textContent = "Copy";
      copyButton.setAttribute("aria-label", `Copy ${actionContext}`);

      const expandButton = el("button", "button button--ghost");
      expandButton.type = "button";
      expandButton.dataset.entryAction = "toggle-preview";
      expandButton.dataset.entryId = entry.id;
      expandButton.textContent = isExpanded ? "Collapse" : "Expand";
      expandButton.setAttribute(
        "aria-label",
        `${isExpanded ? "Collapse" : "Expand"} preview for ${actionContext}`,
      );
      expandButton.setAttribute("aria-expanded", String(isExpanded));
      expandButton.setAttribute("aria-controls", text.id);
      expandButton.hidden = !isExpandable;

      const deleteButton = el("button", "button button--ghost button--danger");
      deleteButton.type = "button";
      deleteButton.dataset.entryAction = "delete";
      deleteButton.dataset.entryId = entry.id;
      deleteButton.textContent = "Delete";
      deleteButton.setAttribute("aria-label", `Delete ${actionContext}`);

      actions.append(useButton, copyButton, expandButton, deleteButton);
      item.append(body, actions);
      historyField.append(item);
    }
  }

  function render(): void {
    const isLocalWhisperProvider = state.settings.providerId === "desktop-whisper";
    const isDesktopProvider =
      isLocalWhisperProvider || state.settings.providerId === "openrouter-stt";
    const isActiveCapture = state.status === "listening" || state.status === "recording";
    const isCaptureStartingOrActive = state.status === "starting" || isActiveCapture;
    const isEngineBusy = isLocalWhisperProvider && whisperEngineBusy();
    const isLocked =
      state.status === "starting" ||
      isActiveCapture ||
      state.status === "transcribing" ||
      isEngineBusy;
    const level = state.status === "recording" ? clampLevel(state.micLevel) : 0;

    shell.dataset.status = state.status;
    statusPill.textContent = statusCopy(state.status);
    statusPill.dataset.status = state.status;
    brandVersion.textContent = state.desktopInfo?.appVersion
      ? `v${state.desktopInfo.appVersion}`
      : "";
    statusField.textContent = statusCopy(state.status);
    startButton.dataset.capture = isCaptureStartingOrActive ? "active" : "idle";

    if (isDesktopProvider && desktopBridge) {
      heroTitle.textContent = "Record. Transcribe. Paste.";
    } else if (desktopBridge) {
      heroTitle.textContent = "Choose the speech engine. Then copy or paste.";
    } else {
      heroTitle.textContent = "Dictate in the browser. Polish. Copy.";
    }

    modeCopy.textContent = isDesktopProvider
      ? isLocalWhisperProvider
        ? "Desktop Whisper records microphone audio locally. Global-shortcut sessions keep your target app focused, then copy or insert the transcript after Stop."
        : "OpenRouter STT records microphone audio in the desktop app, then sends it from Electron main for fast transcription after Stop."
      : "Browser Web Speech can show live words while you speak. Use the Start listening button in this window. Then Copy to clipboard when done.";
    supportField.textContent = currentProviderAvailable()
      ? isDesktopProvider
        ? isLocalWhisperProvider
          ? "Put the cursor in any app, press the global shortcut, speak, press it again. Auralis stays out of the way, copies the transcript, and inserts it where possible."
          : "Use OpenRouter when speed matters. Your API key remains in Electron main, not renderer storage."
        : desktopBridge
          ? "Embedded Chromium Web Speech is best-effort. Prefer Desktop local Whisper for reliable desktop dictation."
          : "Best on Chrome or Edge. Clipboard copy requires localhost or HTTPS."
      : unavailableProviderMessage();

    meterFill.style.transform = `scaleX(${Math.max(0.04, level).toFixed(3)})`;
    micMeter.hidden = !isDesktopProvider;

    if (isDesktopProvider) {
      if (state.status === "recording") {
        interimField.textContent =
          level > 0.04
            ? "Microphone input detected. Keep speaking, then click Stop & transcribe."
            : "Recording. If this meter stays flat, check that your microphone is unmuted.";
        flowHint.textContent = isLocalWhisperProvider
          ? "Local Whisper does not stream live words. The shortcut flow keeps focus in your target app and notifies when delivery is done."
          : "OpenRouter STT transcribes after you stop recording. The shortcut flow keeps focus in your target app and notifies when delivery is done.";
      } else if (state.status === "transcribing") {
        interimField.textContent = isLocalWhisperProvider
          ? "Transcribing the recording locally now..."
          : "Transcribing the recording with OpenRouter now...";
        flowHint.textContent = isLocalWhisperProvider
          ? "Keep Auralis open while the local Whisper model finishes."
          : "Keep Auralis open while Electron main sends the recording to OpenRouter.";
      } else if (state.status === "starting") {
        interimField.textContent = "Opening the microphone...";
        flowHint.textContent = "Grant microphone permission if the operating system asks.";
      } else {
        interimField.textContent =
          "Ready. Click Start recording, speak, then click Stop & transcribe.";
        flowHint.textContent =
          "No audio is stored permanently. Temporary recording files are deleted after transcription.";
      }
    } else {
      interimField.textContent = state.interimText || "Waiting for browser speech input.";
      flowHint.textContent =
        "Browser Web Speech may show interim words while speaking, depending on the browser engine.";
    }

    if (transcriptArea.value !== state.transcript) {
      transcriptArea.value = state.transcript;
    }

    const currentWordCount = countTranscriptWords(state.transcript);
    const currentCharacterCount = countTranscriptCharacters(state.transcript);
    transcriptStatsField.textContent = `${pluralize(currentWordCount, "word")} • ${pluralize(
      currentCharacterCount,
      "character",
    )}`;

    desktopStatusCard.hidden = desktopBridge === null;
    if (appUpdateCard && appUpdateMeta && installUpdateButton) {
      appUpdateCard.hidden = desktopBridge === null;
      appUpdateMeta.textContent =
        "Downloads and installs the latest packaged release if available.";
      installUpdateButton.disabled =
        state.updateInstalling || typeof desktopBridge?.installUpdate !== "function";
      installUpdateButton.textContent = state.updateInstalling ? "Updating..." : "Update now";
    }
    engineSettings.dataset.provider = state.settings.providerId;
    if (desktopBridge && state.desktopInfo) {
      const shortcutWarnings = state.desktopInfo.shortcutWarnings?.length
        ? ` • ${state.desktopInfo.shortcutWarnings.join(" ")}`
        : "";
      const pasteShortcutHint = state.desktopInfo.pasteShortcutLabel
        ? `${state.desktopInfo.pasteShortcutLabel} pastes again`
        : "paste-again shortcut unavailable";
      desktopStatusField.textContent = `${state.desktopInfo.shortcutLabel} • stays in your target app while recording • ${pasteShortcutHint} • ${state.desktopInfo.platform}${shortcutWarnings}`;
    } else {
      desktopStatusField.textContent = "";
    }

    shortcutMap.replaceChildren();
    const shortcutItems: Array<[string, string]> = [
      [
        "Record",
        state.desktopInfo?.shortcutLabel ?? (desktopBridge ? desktopBridge.shortcutLabel : "Enter"),
      ],
      ["Copy", state.desktopInfo?.copyShortcutLabel ?? "Ctrl/⌘ + Alt + C"],
      ["Paste", state.desktopInfo?.pasteShortcutLabel ?? "Ctrl/⌘ + Alt + Enter"],
      ["Clear", "Ctrl+Alt+Backspace"],
      ["Settings", "Ctrl+,"],
    ];
    for (const [label, shortcut] of shortcutItems) {
      const item = el("span", "shortcut-map__item");
      const action = el("strong");
      const key = el("kbd");
      action.textContent = label;
      key.textContent = shortcut;
      item.append(action, key);
      shortcutMap.append(item);
    }

    const flashText = state.flash?.text ?? "";
    const flashTone = state.flash?.tone ?? "info";
    flashDetails.hidden = flashText.length === 0;
    flashDetails.open = false;
    flashDetails.dataset.tone = flashTone;
    flashSummary.textContent = flashSummaryText(flashText, flashTone);
    flashSummary.setAttribute("role", flashTone === "error" ? "alert" : "status");
    flashSummary.setAttribute("aria-live", flashTone === "error" ? "assertive" : "polite");
    flashField.setAttribute("role", flashTone === "error" ? "alert" : "status");
    flashField.setAttribute("aria-live", flashTone === "error" ? "assertive" : "polite");
    flashField.textContent = flashText;

    providerSelect.replaceChildren();
    for (const option of PROVIDER_OPTIONS) {
      const node = el("option");
      node.value = option.value;
      node.textContent = option.label;
      providerSelect.append(node);
    }

    modelSelect.replaceChildren();
    for (const option of modelOptionsForProvider(state.settings.providerId)) {
      const node = el("option");
      node.value = option.value;
      node.textContent = option.label;
      modelSelect.append(node);
    }

    languageSelect.replaceChildren();
    for (const option of LANGUAGE_OPTIONS) {
      const node = el("option");
      node.value = option.value;
      node.textContent = option.label;
      languageSelect.append(node);
    }

    outputModeSelect.replaceChildren();
    for (const option of OUTPUT_MODE_OPTIONS) {
      const node = el("option");
      node.value = option.value;
      node.textContent = option.label;
      outputModeSelect.append(node);
    }

    providerSelect.value = state.settings.providerId;
    modelSelect.value = state.settings.modelId;
    languageSelect.value = state.settings.language;
    outputModeSelect.value = state.settings.outputMode;
    continuousCheckbox.checked = state.settings.continuous;
    interimCheckbox.checked = state.settings.interimResults;
    muteSystemAudioCheckbox.checked = state.settings.muteSystemAudio;
    saveTranscriptHistoryCheckbox.checked = state.settings.saveTranscriptHistory;
    personalTextEnabledCheckbox.checked = state.personalTextSettings.enabled;
    if (personalTextRulesInput.value !== state.personalTextRulesDraft) {
      personalTextRulesInput.value = state.personalTextRulesDraft;
    }

    modelNoteField.textContent =
      state.settings.providerId === "desktop-whisper"
        ? supportsDesktopWhisper
          ? "No API key, cloud backend, or browser-vendor speech service is used. Audio is recorded locally, sent to Electron, and transcribed by the local faster-whisper runtime."
          : "Desktop local Whisper is unavailable in this renderer. Run Auralis as the desktop app and configure faster-whisper locally."
        : state.settings.providerId === "openrouter-stt"
          ? supportsDesktopWhisper
            ? openRouterModelGuidance()
            : "OpenRouter STT is available only in the Auralis desktop app with microphone recording support and OPENROUTER_API_KEY configured."
          : state.settings.modelId === "browser-local" && !supportsLocalModel
            ? desktopBridge
              ? "No API key is required. Electron currently cannot start Chromium on-device Web Speech safely, so Auralis uses the browser default engine."
              : "No API key is required. This browser does not expose on-device recognition, so the app will fall back to the browser default engine."
            : state.settings.modelId === "browser-local"
              ? "No API key is required. Auralis will ask the browser to use on-device recognition if the selected language pack is available."
              : desktopBridge
                ? "No app-managed API key, backend, or paid service is required. Electron Web Speech still depends on Chromium's browser-default speech engine."
                : "No app-managed API key, backend, or paid service is required. The default browser engine may still use a browser-vendor remote speech service.";

    const showEngineCard = isLocalWhisperProvider && Boolean(desktopBridge?.whisperStatus);
    whisperEngineCard.hidden = !showEngineCard;
    whisperEngineStatus.textContent = showEngineCard ? state.whisperEngine.message : "";
    whisperEngineStatus.dataset.state = String(state.whisperEngine.state);
    whisperEngineMeta.textContent = showEngineCard ? engineMetaCopy() : "";
    refreshWhisperEngineButton.disabled =
      isLocked ||
      state.whisperEngine.state === "checking" ||
      state.whisperEngine.state === "installing";
    setupWhisperEngineButton.disabled =
      isLocked ||
      state.whisperEngine.state === "checking" ||
      state.whisperEngine.state === "installing";
    setupWhisperEngineButton.textContent =
      state.whisperEngine.state === "installing"
        ? "Installing local engine..."
        : "Install / repair local engine";

    if (state.status === "transcribing") {
      startButton.textContent = "Transcribing...";
    } else if (isCaptureStartingOrActive) {
      startButton.textContent = isDesktopProvider ? "Stop & transcribe" : "Stop";
    } else {
      startButton.textContent = isDesktopProvider ? "Start recording" : "Start listening";
    }
    startButton.disabled =
      state.status === "transcribing" ||
      isEngineBusy ||
      (!isCaptureStartingOrActive && !currentProviderAvailable());
    startButton.dataset.captureAction = isCaptureStartingOrActive ? "stop" : "start";
    startButton.setAttribute("aria-pressed", String(isCaptureStartingOrActive));
    providerSelect.disabled = isLocked;
    modelSelect.disabled = isLocked;
    languageSelect.disabled = isLocked;
    outputModeSelect.disabled = isLocked;
    continuousCheckbox.disabled = isLocked;
    interimCheckbox.disabled = isLocked;
    muteSystemAudioCheckbox.disabled = isLocked;
    saveTranscriptHistoryCheckbox.disabled = isLocked;
    personalTextEnabledCheckbox.disabled = isLocked;
    personalTextRulesInput.disabled = isLocked;
    savePersonalTextButton.disabled = isLocked;
    copyCurrentButton.disabled = state.transcript.trim().length === 0;
    pasteCurrentButton.disabled = state.transcript.trim().length === 0;
    exportHistoryButton.disabled = state.history.length === 0;
    clearAllHistoryButton.disabled = state.history.length === 0;
    clearAllHistoryButton.textContent = state.awaitingClearAllConfirmation
      ? "Confirm clear all"
      : "Clear all history";

    publishCaptureState();
    renderHistory();
  }

  function finishSession(): void {
    const sessionFinishedAt = Date.now();
    const sessionStartedAt = state.sessionStartedAt ?? sessionFinishedAt - 1000;
    const sessionDeliveryMode = state.sessionDeliveryMode ?? "copy";
    const sessionError = state.sessionError;
    const sessionPasteTargetToken = state.sessionPasteTargetToken;
    const sessionSettings = state.sessionSettings ?? state.settings;
    const sessionStartedFromShortcut = state.sessionStartedFromShortcut;
    const transcriptionStats = state.transcriptionStats;
    const finalRawSessionText = state.sessionTranscript.trim();
    const formattedSessionText = formatTranscriptForOutput(
      finalRawSessionText,
      sessionSettings.outputMode,
    ).trim();
    let finalSessionText = "";
    let personalTextError: string | null = null;
    try {
      finalSessionText = ensureTrailingDictationSpace(
        applyPersonalTextSettings(
          formattedSessionText,
          state.personalTextSettings,
          sessionSettings.outputMode,
        ),
      );
    } catch (error) {
      personalTextError = error instanceof Error ? error.message : "Personal text rules failed.";
    }

    state.activeSession = null;
    state.sessionDeliveryMode = null;
    state.sessionError = null;
    state.sessionPasteTargetToken = null;
    state.sessionSettings = null;
    state.sessionStartedAt = null;
    state.sessionStartedFromHoldToTalk = false;
    state.sessionStartedFromShortcut = false;
    state.sessionTranscript = "";
    state.transcriptionStats = null;
    state.interimText = "";
    state.micLevel = 0;
    state.status = currentProviderAvailable() ? "idle" : "unsupported";

    if (personalTextError) {
      setFlash("error", personalTextError);
      render();
      return;
    }

    if (!finalRawSessionText || !finalSessionText) {
      if (!state.flash || state.flash.tone !== "error") {
        setFlash("info", "No speech was captured, so nothing was saved.");
        if (sessionStartedFromShortcut) {
          notifyDesktop("No speech was captured, so nothing was copied or inserted.");
        }
      }
      render();
      return;
    }

    state.transcript = finalSessionText;

    if (
      sessionSettings.saveTranscriptHistory &&
      (finalSessionText.length > MAX_ENTRY_TEXT_LENGTH ||
        finalRawSessionText.length > MAX_ENTRY_TEXT_LENGTH)
    ) {
      setFlash(
        "error",
        `Transcript is too long to save locally. Copy or shorten it to ${MAX_ENTRY_TEXT_LENGTH.toLocaleString()} characters before saving.`,
      );
      render();
      return;
    }

    const latestEntry = state.history[0];
    const duplicateLatestEntry =
      latestEntry?.text.trim() === finalSessionText.trim() &&
      (latestEntry.rawText ?? latestEntry.text).trim() === finalRawSessionText &&
      (latestEntry.outputMode ?? "literal") === sessionSettings.outputMode;
    let completionTone: FlashTone = sessionError ? "error" : "success";
    let completionMessage = sessionError
      ? `Saved partial transcript after an error: ${sessionError}`
      : transcriptionStats
        ? `Transcript saved locally. ${transcriptionStats}`
        : "Transcript saved locally.";

    if (!sessionSettings.saveTranscriptHistory) {
      completionTone = sessionError ? "error" : "info";
      completionMessage = sessionError
        ? `Partial transcript ready after an error: ${sessionError} History saving is off.`
        : transcriptionStats
          ? `Transcript ready. History saving is off. ${transcriptionStats}`
          : "Transcript ready. History saving is off.";
      setFlash(completionTone, completionMessage);
    } else if (duplicateLatestEntry) {
      completionTone = "info";
      completionMessage = "Transcript already exists as the latest history item.";
      setFlash(completionTone, completionMessage);
    } else {
      const previousHistory = state.history;
      const previousHistoryPanelOpen = state.historyPanelOpen;
      const nextEntry = buildTranscriptEntry(
        finalSessionText,
        sessionSettings,
        sessionStartedAt,
        sessionFinishedAt,
        undefined,
        finalRawSessionText,
      );
      nextEntry.text = finalSessionText;
      state.history = trimHistory([nextEntry, ...state.history]);
      if (persistHistory()) {
        state.historyPanelOpen = true;
        setFlash(completionTone, completionMessage);
      } else {
        state.history = previousHistory;
        state.historyPanelOpen = previousHistoryPanelOpen;
        completionTone = "error";
        completionMessage =
          state.flash?.text ??
          "Could not save transcript history locally. Export important transcripts before closing Auralis.";
      }
    }

    void deliverFinishedTranscript(
      finalSessionText,
      completionMessage,
      completionTone,
      sessionDeliveryMode,
      sessionPasteTargetToken,
      sessionStartedFromShortcut,
    );
    render();
  }

  function startListening(
    deliveryMode: TranscriptDeliveryMode = "copy",
    options: {
      holdToTalk?: boolean;
      pasteTargetToken?: string | null;
      startedFromShortcut?: boolean;
    } = {},
  ): void {
    if (!currentProviderAvailable()) {
      state.status = "unsupported";
      setFlash("error", unavailableProviderMessage());
      render();
      return;
    }

    state.flash = null;
    transcriptDeliveryRequestId += 1;
    state.awaitingClearAllConfirmation = false;
    state.interimText = "";
    state.micLevel = 0;
    state.sessionError = null;
    state.sessionDeliveryMode = deliveryMode;
    state.sessionPasteTargetToken = options.pasteTargetToken ?? null;
    state.sessionSettings = { ...state.settings };
    state.sessionStartedFromHoldToTalk = options.holdToTalk === true;
    state.sessionStartedFromShortcut = Boolean(options.startedFromShortcut);
    state.sessionTranscript = "";
    state.transcriptionStats = null;
    state.sessionStartedAt = Date.now();
    state.status = "starting";
    render();

    try {
      const sessionHandlers = {
        onAudioLevel: (level: number) => {
          const nextLevel = clampLevel(level);
          if (Math.abs(nextLevel - state.micLevel) < 0.03 && nextLevel !== 0) {
            return;
          }

          state.micLevel = nextLevel;
          render();
        },
        onEnd: () => {
          finishSession();
        },
        onError: (message: string) => {
          state.sessionError = message;
          setFlash("error", message);
        },
        onNotice: (message: string) => {
          setFlash("info", message);
          render();
        },
        onResult: (update: { finalText: string; interimText: string }) => {
          if (update.finalText) {
            state.transcript = appendTranscript(state.transcript, update.finalText);
            state.sessionTranscript = appendTranscript(state.sessionTranscript, update.finalText);
          }

          state.interimText = update.interimText;
          render();
        },
        onStart: () => {
          state.status =
            sessionSettings.providerId === "desktop-whisper" ||
            sessionSettings.providerId === "openrouter-stt"
              ? "recording"
              : "listening";
          if (state.sessionStartedFromShortcut) {
            const deliveryCopy =
              state.sessionDeliveryMode === "paste"
                ? "Auralis will insert the transcript when you stop."
                : "Auralis will copy the transcript when you stop.";
            const shortcutCopy = state.sessionStartedFromHoldToTalk
              ? "Release Ctrl + Win to stop."
              : `Press ${shortcutToggleLabel()} again to stop.`;
            notifyDesktop(`Recording. ${shortcutCopy} ${deliveryCopy}`);
          }
          render();
        },
        onTranscriptionStats: (message: string) => {
          state.transcriptionStats = message;
        },
        onTranscribing: () => {
          state.status = "transcribing";
          state.micLevel = 0;
          if (state.sessionStartedFromShortcut) {
            notifyDesktop(
              "Transcribing locally. Keep speaking target ready; Auralis will deliver the transcript when done.",
            );
          }
          render();
        },
      };
      const sessionSettings = state.sessionSettings ?? state.settings;
      state.activeSession =
        sessionSettings.providerId === "desktop-whisper" ||
        sessionSettings.providerId === "openrouter-stt"
          ? startDesktopWhisperSession(target, sessionSettings, sessionHandlers, {
              preserveStartupStop: options.startedFromShortcut === true,
            })
          : startBrowserSpeechSession(target, sessionSettings, sessionHandlers);
      render();
    } catch (error) {
      state.activeSession = null;
      state.sessionDeliveryMode = null;
      state.sessionPasteTargetToken = null;
      state.sessionSettings = null;
      state.sessionStartedFromHoldToTalk = false;
      state.sessionStartedFromShortcut = false;
      state.micLevel = 0;
      state.status = currentProviderAvailable() ? "idle" : "unsupported";
      setFlash(
        "error",
        error instanceof Error ? error.message : "Speech recognition failed to start.",
      );
      render();
    }
  }

  function toggleDictationFromDesktop(event?: Event): void {
    const detail =
      event instanceof CustomEvent ? (event.detail as DesktopToggleDetail | null) : null;
    const isActive =
      state.status === "listening" || state.status === "recording" || state.status === "starting";

    if (detail?.action === "start") {
      if (state.status === "idle") {
        startListening(detail.autoPaste ? "paste" : "copy", {
          holdToTalk: detail.holdToTalk === true,
          pasteTargetToken: detail.pasteTargetToken ?? null,
          startedFromShortcut: detail.startedFromShortcut === true,
        });
      }
      return;
    }

    if (detail?.action === "stop") {
      if (isActive && (detail.holdToTalk !== true || state.sessionStartedFromHoldToTalk)) {
        state.activeSession?.stop();
      }
      return;
    }

    if (isActive) {
      state.activeSession?.stop();
      return;
    }

    if (state.status === "idle") {
      startListening(detail?.autoPaste ? "paste" : "copy", {
        holdToTalk: detail?.holdToTalk === true,
        pasteTargetToken: detail?.pasteTargetToken ?? null,
        startedFromShortcut: detail?.startedFromShortcut === true,
      });
    }
  }

  async function copyCurrentTranscript(): Promise<void> {
    try {
      await copyText(target, state.transcript);
      setFlash("success", "Transcript copied to the clipboard.");
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : "Copy failed.");
    }

    render();
  }

  async function pasteCurrentTranscript(pasteTargetToken?: string | null): Promise<void> {
    try {
      const result = await pasteText(target, state.transcript, pasteTargetToken ?? null);
      setFlash(result.pasted ? "success" : "info", result.message);
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : "Paste failed.");
    }

    render();
  }

  startButton.addEventListener("click", () => {
    if (
      state.status === "listening" ||
      state.status === "recording" ||
      state.status === "starting"
    ) {
      state.activeSession?.stop();
      return;
    }

    if (state.status === "idle" || state.status === "unsupported") {
      startListening();
    }
  });

  refreshWhisperEngineButton.addEventListener("click", () => {
    void refreshWhisperEngineStatus();
  });

  setupWhisperEngineButton.addEventListener("click", () => {
    void setupWhisperEngine();
  });

  installUpdateButton?.addEventListener("click", () => {
    void installUpdate();
  });

  copyCurrentButton.addEventListener("click", () => {
    void copyCurrentTranscript();
  });

  pasteCurrentButton.addEventListener("click", () => {
    void pasteCurrentTranscript();
  });

  clearCurrentButton.addEventListener("click", () => {
    state.transcript = "";
    state.interimText = "";
    state.sessionTranscript = "";
    state.awaitingClearAllConfirmation = false;
    setFlash("info", "Current transcript cleared.");
    render();
  });

  transcriptArea.addEventListener("input", () => {
    state.transcript = transcriptArea.value;
    render();
  });

  providerSelect.addEventListener("change", () => {
    const providerId = providerSelect.value as TranscriptSettings["providerId"];
    state.settings = {
      ...state.settings,
      providerId,
      modelId: coerceModelForProvider(providerId, state.settings.modelId),
    };
    persistSettings();
    render();
    if (providerId === "desktop-whisper") {
      void refreshWhisperEngineStatus();
    }
  });

  modelSelect.addEventListener("change", () => {
    state.settings = {
      ...state.settings,
      modelId: modelSelect.value as TranscriptSettings["modelId"],
    };
    persistSettings();
    render();
    if (state.settings.providerId === "desktop-whisper") {
      void refreshWhisperEngineStatus();
    }
  });

  languageSelect.addEventListener("change", () => {
    state.settings = { ...state.settings, language: languageSelect.value };
    persistSettings();
    render();
  });

  outputModeSelect.addEventListener("change", () => {
    state.settings = {
      ...state.settings,
      outputMode: outputModeSelect.value as TranscriptSettings["outputMode"],
    };
    persistSettings();
    render();
  });

  continuousCheckbox.addEventListener("change", () => {
    state.settings = { ...state.settings, continuous: continuousCheckbox.checked };
    persistSettings();
    render();
  });

  interimCheckbox.addEventListener("change", () => {
    state.settings = { ...state.settings, interimResults: interimCheckbox.checked };
    persistSettings();
    render();
  });

  muteSystemAudioCheckbox.addEventListener("change", () => {
    state.settings = { ...state.settings, muteSystemAudio: muteSystemAudioCheckbox.checked };
    persistSettings();
    render();
  });

  saveTranscriptHistoryCheckbox.addEventListener("change", () => {
    state.settings = {
      ...state.settings,
      saveTranscriptHistory: saveTranscriptHistoryCheckbox.checked,
    };
    if (persistSettings()) {
      setFlash(
        "success",
        saveTranscriptHistoryCheckbox.checked
          ? "Completed transcripts will be saved in local history."
          : "Completed transcripts will stay in the editor only; local history saving is off.",
      );
    }
    render();
  });

  personalTextEnabledCheckbox.addEventListener("change", () => {
    state.personalTextSettings = {
      ...state.personalTextSettings,
      enabled: personalTextEnabledCheckbox.checked,
    };
    if (persistPersonalTextSettings()) {
      setFlash(
        "success",
        personalTextEnabledCheckbox.checked
          ? "Personal text rules enabled."
          : "Personal text rules disabled.",
      );
    }
    render();
  });

  personalTextRulesInput.addEventListener("input", () => {
    state.personalTextRulesDraft = personalTextRulesInput.value;
  });

  savePersonalTextButton.addEventListener("click", () => {
    const parsed = parsePersonalTextRules(state.personalTextRulesDraft);
    if ("error" in parsed) {
      setFlash("error", parsed.error);
      render();
      return;
    }

    state.personalTextSettings = {
      enabled: personalTextEnabledCheckbox.checked,
      rules: parsed.rules,
    };
    state.personalTextRulesDraft = serializePersonalTextRules(parsed.rules);
    if (persistPersonalTextSettings()) {
      setFlash("success", "Saved personal text rules locally.");
    }
    render();
  });

  historySearchInput.addEventListener("input", () => {
    state.historySearch = historySearchInput.value;
    state.awaitingClearAllConfirmation = false;
    render();
  });

  historyLanguageFilter.addEventListener("change", () => {
    state.historyLanguageFilter = historyLanguageFilter.value;
    state.awaitingClearAllConfirmation = false;
    render();
  });

  exportHistoryButton.addEventListener("click", () => {
    try {
      exportHistory(target, state.history);
      setFlash("success", "Saved transcript history exported as JSON.");
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : "History export failed.");
    }

    render();
  });

  importHistoryTrigger.addEventListener("click", () => {
    importHistoryInput.click();
  });

  importHistoryInput.addEventListener("change", async () => {
    const file = importHistoryInput.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        setFlash(
          "error",
          `Imported history file is too large. Choose a JSON export at most ${Math.round(
            MAX_IMPORT_FILE_BYTES / 1024,
          )} KiB.`,
        );
        return;
      }

      const rawValue = await file.text();
      const result = importHistoryFromJson(rawValue);

      if ("error" in result) {
        setFlash("error", result.error);
      } else {
        const importedCount = result.history.length;
        const previousHistory = state.history;
        const previousHistoryPanelOpen = state.historyPanelOpen;
        const mergeResult = mergeImportedHistory(result.history);
        state.history = mergeResult.history;
        if (persistHistory()) {
          state.historyPanelOpen = true;
          state.historySearch = "";
          state.historyLanguageFilter = "all";
          state.awaitingClearAllConfirmation = false;
          const skippedCopy = mergeResult.skippedExistingCount
            ? ` ${pluralize(
                mergeResult.skippedExistingCount,
                "existing saved transcript was skipped",
                "existing saved transcripts were skipped",
              )} to stay under ${MAX_HISTORY_ITEMS}.`
            : "";
          setFlash(
            "success",
            `Imported ${importedCount} saved transcripts. ${state.history.length} total saved.${skippedCopy}`,
          );
        } else {
          state.history = previousHistory;
          state.historyPanelOpen = previousHistoryPanelOpen;
        }
      }
    } catch (error) {
      setFlash("error", error instanceof Error ? error.message : "History import failed.");
    } finally {
      importHistoryInput.value = "";
      render();
    }
  });

  clearAllHistoryButton.addEventListener("click", () => {
    if (!state.awaitingClearAllConfirmation) {
      state.awaitingClearAllConfirmation = true;
      setFlash("info", "Confirm clearing all saved transcripts.");
      render();
      return;
    }

    const previousHistory = state.history;
    const previousHistoryPanelOpen = state.historyPanelOpen;
    state.history = [];
    state.historyExpandedIds.clear();
    state.historyPanelOpen = true;
    state.historySearch = "";
    state.historyLanguageFilter = "all";
    state.awaitingClearAllConfirmation = false;
    if (persistHistory()) {
      setFlash("success", "All saved transcripts were cleared.");
    } else {
      state.history = previousHistory;
      state.historyPanelOpen = previousHistoryPanelOpen;
    }
    render();
  });

  historySection.addEventListener("toggle", () => {
    state.historyPanelOpen = historySection.open;
    workspace.dataset.layout = historySection.open ? "review" : "focus";
  });

  historyField.addEventListener("click", async (event) => {
    const targetElement = event.target;

    if (!(targetElement instanceof HTMLButtonElement)) {
      return;
    }

    const entryId = targetElement.dataset.entryId;
    const action = targetElement.dataset.entryAction;
    const entry = state.history.find((candidate) => candidate.id === entryId);

    if (!entry) {
      return;
    }

    state.awaitingClearAllConfirmation = false;

    if (action === "use") {
      state.transcript = entry.text;
      setFlash("info", "Saved transcript loaded into the editor.");
      render();
      return;
    }

    if (action === "copy") {
      try {
        await copyText(target, entry.text);
        setFlash("success", "Saved transcript copied to the clipboard.");
      } catch (error) {
        setFlash("error", error instanceof Error ? error.message : "Copy failed.");
      }

      render();
      return;
    }

    if (action === "toggle-preview") {
      if (state.historyExpandedIds.has(entry.id)) {
        state.historyExpandedIds.delete(entry.id);
      } else {
        state.historyExpandedIds.add(entry.id);
      }
      render();
      return;
    }

    if (action === "delete") {
      const previousHistory = state.history;
      const previousHistoryPanelOpen = state.historyPanelOpen;
      state.history = state.history.filter((candidate) => candidate.id !== entry.id);
      state.historyExpandedIds.delete(entry.id);
      state.historyPanelOpen = true;
      if (persistHistory()) {
        setFlash("info", "Saved transcript removed.");
      } else {
        state.history = previousHistory;
        state.historyPanelOpen = previousHistoryPanelOpen;
      }
      render();
    }
  });

  const handleDesktopCopyTranscript = () => {
    void copyCurrentTranscript();
  };
  const handleDesktopPasteTranscript = (event: Event) => {
    const detail =
      event instanceof CustomEvent ? (event.detail as DesktopToggleDetail | null) : null;
    void pasteCurrentTranscript(detail?.pasteTargetToken ?? null);
  };

  const handleKeyboardShortcut = (event: KeyboardEvent) => {
    const hasCommandChord = (event.ctrlKey || event.metaKey) && event.altKey;
    if (!hasCommandChord) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "c") {
      event.preventDefault();
      void copyCurrentTranscript();
      return;
    }

    if (key === "enter") {
      event.preventDefault();
      void pasteCurrentTranscript();
      return;
    }

    if (key === "backspace") {
      event.preventDefault();
      state.transcript = "";
      state.interimText = "";
      state.sessionTranscript = "";
      state.awaitingClearAllConfirmation = false;
      setFlash("info", "Current transcript cleared.");
      render();
      return;
    }

    if (key === ",") {
      event.preventDefault();
      advancedSettings.open = true;
      advancedSettings.focus();
    }
  };

  target.addEventListener("auralis:desktop-toggle-dictation", toggleDictationFromDesktop);
  target.addEventListener("auralis:desktop-copy-transcript", handleDesktopCopyTranscript);
  target.addEventListener("auralis:desktop-paste-transcript", handleDesktopPasteTranscript);
  target.addEventListener("keydown", handleKeyboardShortcut);

  const disposeMountedApp = () => {
    target.removeEventListener("auralis:desktop-toggle-dictation", toggleDictationFromDesktop);
    target.removeEventListener("auralis:desktop-copy-transcript", handleDesktopCopyTranscript);
    target.removeEventListener("auralis:desktop-paste-transcript", handleDesktopPasteTranscript);
    target.removeEventListener("keydown", handleKeyboardShortcut);
    if (mountedAppDisposers.get(target) === disposeMountedApp) {
      mountedAppDisposers.delete(target);
    }
  };
  mountedAppDisposers.set(target, disposeMountedApp);

  if (state.settings.providerId !== DEFAULT_SETTINGS.providerId) {
    persistSettings();
  }

  render();
  void refreshDesktopInfo();
  void refreshWhisperEngineStatus();
}
