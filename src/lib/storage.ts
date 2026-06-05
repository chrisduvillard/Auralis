import {
  assertPersistablePersonalTextSettings,
  canonicalizePersonalTextSettings,
  DEFAULT_PERSONAL_TEXT_SETTINGS,
} from "./personal-text";
import {
  coerceModelForProvider,
  DEFAULT_SETTINGS,
  isModelSupportedForProvider,
  isSupportedLanguage,
  isSupportedModel,
  isSupportedOutputMode,
  isSupportedProvider,
} from "./settings";
import type { PersonalTextSettings, TranscriptEntry, TranscriptSettings } from "./types";

const SETTINGS_KEY = "auralis:settings:v1";
const HISTORY_KEY = "auralis:history:v1";
const PERSONAL_TEXT_SETTINGS_KEY = "auralis:personal-text:v1";
const LEGACY_SETTINGS_KEY = "voice-to-text-mvp:settings:v1";
const LEGACY_HISTORY_KEY = "voice-to-text-mvp:history:v1";
export const MAX_HISTORY_ITEMS = 24;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ENTRY_ID_LENGTH = 100;
export const MAX_ENTRY_TEXT_LENGTH = 10_000;
const MAX_ENTRY_LANGUAGE_LENGTH = 16;

function parseJson<T>(rawValue: string | null): T | null {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function hasPersistedSettings(storage: Storage = window.localStorage): boolean {
  return storage.getItem(SETTINGS_KEY) !== null || storage.getItem(LEGACY_SETTINGS_KEY) !== null;
}

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (!isRecord(value)) {
    return false;
  }

  const hasValidOutputMode =
    value.outputMode === undefined ||
    (typeof value.outputMode === "string" && isSupportedOutputMode(value.outputMode));
  const hasValidRawText =
    value.rawText === undefined ||
    (typeof value.rawText === "string" &&
      value.rawText.trim().length > 0 &&
      value.rawText.length <= MAX_ENTRY_TEXT_LENGTH);

  return (
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    value.id.length <= MAX_ENTRY_ID_LENGTH &&
    typeof value.text === "string" &&
    value.text.trim().length > 0 &&
    value.text.length <= MAX_ENTRY_TEXT_LENGTH &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.providerId === "string" &&
    isSupportedProvider(value.providerId) &&
    typeof value.modelId === "string" &&
    isSupportedModel(value.modelId) &&
    isModelSupportedForProvider(value.providerId, value.modelId) &&
    typeof value.language === "string" &&
    value.language.trim().length > 0 &&
    value.language.length <= MAX_ENTRY_LANGUAGE_LENGTH &&
    isSupportedLanguage(value.language) &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    hasValidOutputMode &&
    hasValidRawText
  );
}

function canonicalizeTranscriptEntry(value: unknown): TranscriptEntry | null {
  if (!isTranscriptEntry(value)) {
    return null;
  }

  const entry: TranscriptEntry = {
    id: value.id,
    text: value.text,
    createdAt: value.createdAt,
    providerId: value.providerId,
    modelId: value.modelId,
    language: value.language,
    durationMs: value.durationMs,
  };

  if (value.outputMode) {
    entry.outputMode = value.outputMode;
  }

  if (value.rawText) {
    entry.rawText = value.rawText;
  }

  return entry;
}

function canonicalizeHistory(values: unknown[]): TranscriptEntry[] {
  const seenIds = new Set<string>();
  const history: TranscriptEntry[] = [];

  for (const value of values) {
    const entry = canonicalizeTranscriptEntry(value);
    if (!entry || seenIds.has(entry.id)) {
      continue;
    }

    seenIds.add(entry.id);
    history.push(entry);

    if (history.length === MAX_HISTORY_ITEMS) {
      break;
    }
  }

  return history;
}

export function trimHistory(history: TranscriptEntry[]): TranscriptEntry[] {
  return history.slice(0, MAX_HISTORY_ITEMS);
}

function hasUniqueEntryIds(history: TranscriptEntry[]): boolean {
  return new Set(history.map((entry) => entry.id)).size === history.length;
}

function assertPersistableHistory(history: TranscriptEntry[]): void {
  if (!history.every(isTranscriptEntry)) {
    throw new Error("History contains invalid transcript entries.");
  }

  if (!hasUniqueEntryIds(history)) {
    throw new Error("History contains duplicate transcript IDs.");
  }
}

export function importHistoryFromJson(
  rawValue: string,
): { history: TranscriptEntry[] } | { error: string } {
  const parsed = parseJson<unknown>(rawValue);

  if (parsed === null) {
    return { error: "Imported history must be valid JSON." };
  }

  if (!Array.isArray(parsed)) {
    return { error: "Imported history must be a JSON array of transcript entries." };
  }

  if (parsed.length > MAX_HISTORY_ITEMS) {
    return { error: `Imported history can contain at most ${MAX_HISTORY_ITEMS} entries.` };
  }

  const canonicalHistory = parsed.map(canonicalizeTranscriptEntry);
  if (canonicalHistory.some((entry) => entry === null)) {
    return { error: "Imported history contains invalid transcript entries." };
  }

  const history = canonicalHistory as TranscriptEntry[];

  if (!hasUniqueEntryIds(history)) {
    return { error: "Imported history contains duplicate transcript IDs." };
  }

  return { history };
}

export function loadSettings(storage: Storage = window.localStorage): TranscriptSettings {
  const parsed = parseJson<Record<string, unknown>>(storage.getItem(SETTINGS_KEY));
  const legacyParsed = parsed
    ? null
    : parseJson<Record<string, unknown>>(storage.getItem(LEGACY_SETTINGS_KEY));
  const source = parsed ?? legacyParsed;

  if (!source) {
    return DEFAULT_SETTINGS;
  }

  const providerId =
    typeof source.providerId === "string" && isSupportedProvider(source.providerId)
      ? source.providerId
      : DEFAULT_SETTINGS.providerId;
  const modelId =
    typeof source.modelId === "string" && isSupportedModel(source.modelId)
      ? coerceModelForProvider(providerId, source.modelId)
      : coerceModelForProvider(providerId, DEFAULT_SETTINGS.modelId);

  const settings = {
    providerId,
    modelId,
    language:
      typeof source.language === "string" && isSupportedLanguage(source.language)
        ? source.language
        : DEFAULT_SETTINGS.language,
    continuous:
      typeof source.continuous === "boolean" ? source.continuous : DEFAULT_SETTINGS.continuous,
    interimResults:
      typeof source.interimResults === "boolean"
        ? source.interimResults
        : DEFAULT_SETTINGS.interimResults,
    muteSystemAudio:
      typeof source.muteSystemAudio === "boolean"
        ? source.muteSystemAudio
        : DEFAULT_SETTINGS.muteSystemAudio,
    outputMode:
      typeof source.outputMode === "string" && isSupportedOutputMode(source.outputMode)
        ? source.outputMode
        : DEFAULT_SETTINGS.outputMode,
    saveTranscriptHistory:
      typeof source.saveTranscriptHistory === "boolean"
        ? source.saveTranscriptHistory
        : DEFAULT_SETTINGS.saveTranscriptHistory,
  };

  if (!parsed && legacyParsed) {
    saveSettings(settings, storage);
  }

  return settings;
}

export function saveSettings(
  settings: TranscriptSettings,
  storage: Storage = window.localStorage,
): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadPersonalTextSettings(
  storage: Storage = window.localStorage,
): PersonalTextSettings {
  const parsed = parseJson<unknown>(storage.getItem(PERSONAL_TEXT_SETTINGS_KEY));

  if (parsed === null) {
    return DEFAULT_PERSONAL_TEXT_SETTINGS;
  }

  const settings = canonicalizePersonalTextSettings(parsed);
  if (JSON.stringify(parsed) !== JSON.stringify(settings)) {
    try {
      savePersonalTextSettings(settings, storage);
    } catch {
      // Loading should stay forgiving even when storage repair is blocked by quota or policy.
    }
  }

  return settings;
}

export function savePersonalTextSettings(
  settings: PersonalTextSettings,
  storage: Storage = window.localStorage,
): void {
  assertPersistablePersonalTextSettings(settings);
  const canonicalSettings = canonicalizePersonalTextSettings(settings);
  storage.setItem(PERSONAL_TEXT_SETTINGS_KEY, JSON.stringify(canonicalSettings));
}

export function loadHistory(storage: Storage = window.localStorage): TranscriptEntry[] {
  const parsed = parseJson<unknown>(storage.getItem(HISTORY_KEY));
  const legacyParsed =
    parsed === null ? parseJson<unknown>(storage.getItem(LEGACY_HISTORY_KEY)) : null;
  const source = parsed ?? legacyParsed;

  if (!Array.isArray(source)) {
    return [];
  }

  const history = canonicalizeHistory(source);
  const shouldRepairStorage =
    (parsed === null && legacyParsed !== null) ||
    JSON.stringify(source) !== JSON.stringify(history);
  if (shouldRepairStorage) {
    try {
      saveHistory(history, storage);
    } catch {
      // Loading should stay forgiving even when storage repair is blocked by quota or policy.
    }
  }

  return history;
}

export function saveHistory(
  history: TranscriptEntry[],
  storage: Storage = window.localStorage,
): void {
  const historyToSave = trimHistory(history);
  assertPersistableHistory(historyToSave);
  const canonicalHistory = historyToSave.map(canonicalizeTranscriptEntry) as TranscriptEntry[];
  storage.setItem(HISTORY_KEY, JSON.stringify(canonicalHistory));
}
