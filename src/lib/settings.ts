import type { ModelId, OutputMode, ProviderId, TranscriptSettings } from "./types";

export const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = [
  { value: "browser-speech", label: "Browser Web Speech API" },
  { value: "desktop-whisper", label: "Desktop local Whisper" },
  { value: "openrouter-stt", label: "OpenRouter transcription" },
];

export const BROWSER_MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  { value: "browser-default", label: "Browser default engine" },
  { value: "browser-local", label: "Prefer on-device language pack" },
];

export const DESKTOP_WHISPER_MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  { value: "desktop-whisper-tiny", label: "Local Whisper tiny (fastest first-run check)" },
  { value: "desktop-whisper-base", label: "Local Whisper base (recommended)" },
  { value: "desktop-whisper-small", label: "Local Whisper small (better accuracy)" },
  { value: "desktop-whisper-medium", label: "Local Whisper medium (highest accuracy, ~1.5 GB)" },
];

export const OPENROUTER_TRANSCRIPTION_MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  {
    value: "openrouter-whisper-large-v3-turbo",
    label: "OpenRouter Whisper Large v3 Turbo (fastest)",
  },
  {
    value: "openrouter-gpt-4o-mini-transcribe",
    label: "OpenRouter GPT-4o Mini Transcribe (balanced)",
  },
  {
    value: "openrouter-gpt-4o-transcribe",
    label: "OpenRouter GPT-4o Transcribe (best quality)",
  },
  {
    value: "openrouter-parakeet-tdt-0.6b-v3",
    label: "OpenRouter NVIDIA Parakeet TDT 0.6B v3",
  },
  { value: "openrouter-qwen3-asr-flash", label: "OpenRouter Qwen3 ASR Flash" },
  {
    value: "openrouter-voxtral-mini-transcribe",
    label: "OpenRouter Voxtral Mini Transcribe",
  },
  { value: "openrouter-whisper-1", label: "OpenRouter Whisper 1" },
];

export const MODEL_OPTIONS: Array<{ value: ModelId; label: string }> = [
  ...BROWSER_MODEL_OPTIONS,
  ...DESKTOP_WHISPER_MODEL_OPTIONS,
  ...OPENROUTER_TRANSCRIPTION_MODEL_OPTIONS,
];

export const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "de-DE", label: "Deutsch" },
  { value: "fr-FR", label: "Francais" },
  { value: "es-ES", label: "Espanol" },
] as const;

export const OUTPUT_MODE_OPTIONS: Array<{ value: OutputMode; label: string }> = [
  { value: "literal", label: "Literal" },
  { value: "cleaned", label: "Clean dictation" },
  { value: "markdown-notes", label: "Markdown notes" },
  { value: "message", label: "Email / Slack" },
  { value: "developer", label: "Code / developer" },
];

const SUPPORTED_LANGUAGE_VALUES = new Set<string>(LANGUAGE_OPTIONS.map((option) => option.value));
const SUPPORTED_PROVIDER_VALUES = new Set<ProviderId>(
  PROVIDER_OPTIONS.map((option) => option.value),
);
const SUPPORTED_MODEL_VALUES = new Set<ModelId>(MODEL_OPTIONS.map((option) => option.value));
const SUPPORTED_OUTPUT_MODE_VALUES = new Set<OutputMode>(
  OUTPUT_MODE_OPTIONS.map((option) => option.value),
);

export const DEFAULT_SETTINGS: TranscriptSettings = {
  providerId: "browser-speech",
  modelId: "browser-default",
  language: "en-US",
  continuous: true,
  interimResults: true,
  muteSystemAudio: true,
  outputMode: "literal",
  saveTranscriptHistory: false,
};

export function isSupportedLanguage(language: string): boolean {
  return SUPPORTED_LANGUAGE_VALUES.has(language);
}

export function isSupportedProvider(providerId: string): providerId is ProviderId {
  return SUPPORTED_PROVIDER_VALUES.has(providerId as ProviderId);
}

export function isSupportedModel(modelId: string): modelId is ModelId {
  return SUPPORTED_MODEL_VALUES.has(modelId as ModelId);
}

export function isSupportedOutputMode(outputMode: string): outputMode is OutputMode {
  return SUPPORTED_OUTPUT_MODE_VALUES.has(outputMode as OutputMode);
}

export function modelOptionsForProvider(
  providerId: ProviderId,
): Array<{ value: ModelId; label: string }> {
  if (providerId === "desktop-whisper") {
    return DESKTOP_WHISPER_MODEL_OPTIONS;
  }

  if (providerId === "openrouter-stt") {
    return OPENROUTER_TRANSCRIPTION_MODEL_OPTIONS;
  }

  return BROWSER_MODEL_OPTIONS;
}

export function defaultModelForProvider(providerId: ProviderId): ModelId {
  if (providerId === "desktop-whisper") {
    return "desktop-whisper-base";
  }

  return modelOptionsForProvider(providerId)[0]?.value ?? DEFAULT_SETTINGS.modelId;
}

export function isModelSupportedForProvider(providerId: ProviderId, modelId: ModelId): boolean {
  return modelOptionsForProvider(providerId).some((option) => option.value === modelId);
}

export function coerceModelForProvider(providerId: ProviderId, modelId: ModelId): ModelId {
  return isModelSupportedForProvider(providerId, modelId)
    ? modelId
    : defaultModelForProvider(providerId);
}

export function providerLabel(providerId: ProviderId): string {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === providerId)?.label ?? "Unknown provider"
  );
}

export function modelLabel(modelId: ModelId): string {
  return MODEL_OPTIONS.find((option) => option.value === modelId)?.label ?? "Unknown model";
}

export function outputModeLabel(outputMode: OutputMode): string {
  return OUTPUT_MODE_OPTIONS.find((option) => option.value === outputMode)?.label ?? "Literal";
}
