import type { OutputMode, TranscriptEntry, TranscriptSettings } from "./types";

function defaultIdFactory(): string {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `tx-${Date.now()}`;
}

export function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sentenceCase(text: string): string {
  if (!text) {
    return text;
  }

  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function stripFillers(text: string): string {
  return text.replace(/\b(um|uh|erm|hmm)\b\s*/gi, "").trim();
}

function replaceNaturalDictationCommands(text: string): string {
  return stripFillers(normalizeTranscript(text))
    .replace(/\bnew paragraph\b/gi, "\n\n")
    .replace(/\bnew line\b/gi, "\n")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bperiod\b/gi, ".")
    .replace(/\bfull stop\b/gi, ".")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanDictationText(text: string): string {
  const cleaned = replaceNaturalDictationCommands(text);

  if (!cleaned) {
    return "";
  }

  const cased = cleaned
    .split("\n")
    .map((line) => sentenceCase(line.trim()))
    .join("\n");

  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

function formatMarkdownNotes(text: string): string {
  return cleanDictationText(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((sentence) => `- ${sentence}`)
    .join("\n");
}

function formatDeveloperText(text: string): string {
  return stripFillers(normalizeTranscript(text))
    .replace(/\bopen paren\b/gi, "(")
    .replace(/\bclose paren\b/gi, ")")
    .replace(/\bopen bracket\b/gi, "[")
    .replace(/\bclose bracket\b/gi, "]")
    .replace(/\bopen brace\b/gi, "{")
    .replace(/\bclose brace\b/gi, "}")
    .replace(/\bunderscore\b/gi, "_")
    .replace(/\b(dot|period)\b/gi, ".")
    .replace(/\bcomma\b/gi, ",")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bsemicolon\b/gi, ";")
    .replace(/\bslash\b/gi, "/")
    .replace(/\bbackslash\b/gi, "\\")
    .replace(/\b(equals|equal sign)\b/gi, "=")
    .replace(/\b(plus|plus sign)\b/gi, "+")
    .replace(/\b(dash|hyphen|minus)\b/gi, "-")
    .replace(/\s*([._/\\])\s*/g, "$1")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .replace(/\s*([(){}[\]])\s*/g, "$1")
    .replace(/\s*([=+\-*<>])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatTranscriptForOutput(text: string, outputMode: OutputMode): string {
  const normalized = normalizeTranscript(text);

  if (!normalized) {
    return "";
  }

  if (outputMode === "literal") {
    return normalized;
  }

  if (outputMode === "markdown-notes") {
    return formatMarkdownNotes(normalized);
  }

  if (outputMode === "developer") {
    return formatDeveloperText(normalized);
  }

  return cleanDictationText(normalized);
}

export function appendTranscript(baseText: string, chunk: string): string {
  const trimmedBase = baseText.trim();
  const trimmedChunk = normalizeTranscript(chunk);

  if (!trimmedChunk) {
    return trimmedBase;
  }

  if (!trimmedBase) {
    return trimmedChunk;
  }

  return `${trimmedBase} ${trimmedChunk}`;
}

export function countTranscriptWords(text: string): number {
  const normalized = normalizeTranscript(text);

  if (!normalized) {
    return 0;
  }

  return normalized.split(" ").length;
}

export function countTranscriptCharacters(text: string): number {
  return normalizeTranscript(text).length;
}

export function summarizeHistory(entries: TranscriptEntry[]): {
  characterCount: number;
  wordCount: number;
} {
  return entries.reduce(
    (summary, entry) => ({
      characterCount: summary.characterCount + countTranscriptCharacters(entry.text),
      wordCount: summary.wordCount + countTranscriptWords(entry.text),
    }),
    { characterCount: 0, wordCount: 0 },
  );
}

export function buildTranscriptEntry(
  text: string,
  settings: TranscriptSettings,
  startedAt: number,
  endedAt: number,
  idFactory: () => string = defaultIdFactory,
  rawText: string = text,
): TranscriptEntry {
  return {
    id: idFactory(),
    text: normalizeTranscript(text),
    createdAt: new Date(endedAt).toISOString(),
    providerId: settings.providerId,
    modelId: settings.modelId,
    language: settings.language,
    outputMode: settings.outputMode,
    rawText: normalizeTranscript(rawText),
    durationMs: Math.max(endedAt - startedAt, 0),
  };
}

export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
