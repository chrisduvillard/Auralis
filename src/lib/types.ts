export type ProviderId = "browser-speech" | "desktop-whisper" | "openrouter-stt";
export type OutputMode = "literal" | "cleaned" | "markdown-notes" | "message" | "developer";
export type PersonalTextRuleKind = "vocabulary" | "replacement" | "snippet";
export type ModelId =
  | "browser-default"
  | "browser-local"
  | "desktop-whisper-tiny"
  | "desktop-whisper-base"
  | "desktop-whisper-small"
  | "desktop-whisper-medium"
  | "openrouter-whisper-large-v3-turbo"
  | "openrouter-gpt-4o-mini-transcribe"
  | "openrouter-gpt-4o-transcribe"
  | "openrouter-parakeet-tdt-0.6b-v3"
  | "openrouter-qwen3-asr-flash"
  | "openrouter-voxtral-mini-transcribe"
  | "openrouter-whisper-1";

export interface TranscriptSettings {
  providerId: ProviderId;
  modelId: ModelId;
  language: string;
  continuous: boolean;
  interimResults: boolean;
  muteSystemAudio: boolean;
  outputMode: OutputMode;
  saveTranscriptHistory: boolean;
}

export interface TranscriptEntry {
  id: string;
  text: string;
  createdAt: string;
  providerId: ProviderId;
  modelId: ModelId;
  language: string;
  durationMs: number;
  outputMode?: OutputMode;
  rawText?: string;
}

export interface PersonalTextRule {
  enabled: boolean;
  id: string;
  kind: PersonalTextRuleKind;
  replacement: string;
  trigger: string;
}

export interface PersonalTextSettings {
  enabled: boolean;
  rules: PersonalTextRule[];
}

export interface SpeechUpdate {
  finalText: string;
  interimText: string;
}

export interface SpeechSessionHandlers {
  onAudioLevel?: (level: number) => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onResult: (update: SpeechUpdate) => void;
  onStart: () => void;
  onTranscriptionStats?: (message: string) => void;
  onTranscribing?: () => void;
}

export interface SpeechSession {
  stop: () => void;
}
