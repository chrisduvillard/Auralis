import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PERSONAL_TEXT_SETTINGS } from "../lib/personal-text";
import { DEFAULT_SETTINGS } from "../lib/settings";
import {
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
} from "../lib/storage";
import type { TranscriptEntry } from "../lib/types";

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

describe("storage helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps local transcript history opt-in by default", () => {
    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ muteSystemAudio: true, saveTranscriptHistory: false });
  });

  it("loads empty personal text settings by default", () => {
    expect(loadPersonalTextSettings(localStorage)).toEqual(DEFAULT_PERSONAL_TEXT_SETTINGS);
  });

  it("persists and reloads personal text settings separately from recognition settings", () => {
    const personalText = {
      enabled: true,
      rules: [
        {
          enabled: true,
          id: "rule-openrouter",
          kind: "vocabulary" as const,
          replacement: "OpenRouter",
          trigger: "open router",
        },
        {
          enabled: true,
          id: "rule-signature",
          kind: "snippet" as const,
          replacement: "Thanks,\\nChris",
          trigger: ";sig",
        },
      ],
    };

    savePersonalTextSettings(personalText, localStorage);

    expect(loadPersonalTextSettings(localStorage)).toEqual(personalText);
    expect(localStorage.getItem("auralis:settings:v1")).toBeNull();
  });

  it("repairs malformed personal text settings and rejects secret-like values on save", () => {
    const openAiLikeToken = ["sk", "livevalueoken"].join("-");
    const githubLikeToken = ["ghp", "secretlikevalue1234567890"].join("_");

    localStorage.setItem(
      "auralis:personal-text:v1",
      JSON.stringify({
        enabled: true,
        rules: [
          {
            debugPayload: "drop me",
            enabled: true,
            id: "valid-rule",
            kind: "replacement",
            replacement: "OpenRouter",
            trigger: "open router",
          },
          { enabled: true, id: "bad-kind", kind: "regex", replacement: "x", trigger: "y" },
          {
            enabled: true,
            id: "bad-secret",
            kind: "snippet",
            replacement: openAiLikeToken,
            trigger: ";token",
          },
        ],
      }),
    );

    expect(loadPersonalTextSettings(localStorage)).toEqual({
      enabled: true,
      rules: [
        {
          enabled: true,
          id: "valid-rule",
          kind: "replacement",
          replacement: "OpenRouter",
          trigger: "open router",
        },
      ],
    });
    expect(JSON.parse(localStorage.getItem("auralis:personal-text:v1") ?? "{}")).toEqual({
      enabled: true,
      rules: [
        {
          enabled: true,
          id: "valid-rule",
          kind: "replacement",
          replacement: "OpenRouter",
          trigger: "open router",
        },
      ],
    });
    expect(() =>
      savePersonalTextSettings(
        {
          enabled: true,
          rules: [
            {
              enabled: true,
              id: "secret-rule",
              kind: "snippet",
              replacement: githubLikeToken,
              trigger: ";token",
            },
          ],
        },
        localStorage,
      ),
    ).toThrow("Personal text rules cannot contain secret-like values.");
  });

  it("persists and reloads settings", () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      modelId: "browser-local" as const,
      language: "de-DE",
      continuous: false,
      outputMode: "cleaned" as const,
      saveTranscriptHistory: false,
    };

    saveSettings(nextSettings, localStorage);

    expect(loadSettings(localStorage)).toEqual(nextSettings);
  });

  it("persists and reloads desktop local Whisper settings", () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      modelId: "desktop-whisper-base" as const,
      providerId: "desktop-whisper" as const,
    };

    saveSettings(nextSettings, localStorage);

    expect(loadSettings(localStorage)).toEqual(nextSettings);
  });

  it("migrates persisted settings without output mode to literal output", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        providerId: "openrouter-stt",
        modelId: "openrouter-whisper-large-v3-turbo",
        language: "en-US",
        continuous: true,
        interimResults: true,
        muteSystemAudio: true,
      }),
    );

    expect(loadSettings(localStorage)).toMatchObject({
      modelId: "openrouter-whisper-large-v3-turbo",
      outputMode: "literal",
      providerId: "openrouter-stt",
    });
  });

  it("persists and reloads the higher-accuracy desktop local Whisper small model", () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      modelId: "desktop-whisper-small" as typeof DEFAULT_SETTINGS.modelId,
      providerId: "desktop-whisper" as const,
    };

    saveSettings(nextSettings, localStorage);

    expect(loadSettings(localStorage)).toEqual(nextSettings);
  });

  it("persists and reloads the high-accuracy desktop local Whisper medium model", () => {
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      modelId: "desktop-whisper-medium" as typeof DEFAULT_SETTINGS.modelId,
      providerId: "desktop-whisper" as const,
    };

    saveSettings(nextSettings, localStorage);

    expect(loadSettings(localStorage)).toEqual(nextSettings);
  });

  it("coerces persisted models that do not belong to the selected provider", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        modelId: "browser-local",
        providerId: "desktop-whisper",
      }),
    );

    expect(loadSettings(localStorage)).toMatchObject({
      modelId: "desktop-whisper-base",
      providerId: "desktop-whisper",
    });
  });

  it("falls back to safe defaults for malformed settings", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        providerId: "unknown-provider",
        modelId: "paid-cloud-model",
        language: 42,
        continuous: "yes",
        interimResults: null,
      }),
    );

    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the default language for unsupported persisted language codes", () => {
    localStorage.setItem(
      "auralis:settings:v1",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        language: "xx-INVALID",
      }),
    );

    expect(loadSettings(localStorage)).toEqual(DEFAULT_SETTINGS);
  });

  it("filters malformed history rows", () => {
    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([sampleEntry(), { id: 12, text: "bad row" }]),
    );

    expect(loadHistory(localStorage)).toEqual([sampleEntry()]);
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual([sampleEntry()]);
  });

  it("deduplicates loaded history IDs and repairs persisted local storage", () => {
    const firstEntry = sampleEntry({ id: "duplicate-entry", text: "Keep the first copy" });
    const duplicateEntry = sampleEntry({ id: "duplicate-entry", text: "Drop the duplicate copy" });
    const nextEntry = sampleEntry({ id: "unique-entry", text: "Keep the unique copy" });

    localStorage.setItem(
      "auralis:history:v1",
      JSON.stringify([firstEntry, duplicateEntry, nextEntry]),
    );

    expect(loadHistory(localStorage)).toEqual([firstEntry, nextEntry]);
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual([
      firstEntry,
      nextEntry,
    ]);
  });

  it("canonicalizes loaded and imported history entries to known transcript fields", () => {
    const canonicalEntry = sampleEntry({ id: "canonical-entry" });
    const entryWithExtraFields = {
      ...canonicalEntry,
      debugPayload: "do not persist imported metadata",
      nested: { unexpected: true },
    };

    localStorage.setItem("auralis:history:v1", JSON.stringify([entryWithExtraFields]));

    expect(loadHistory(localStorage)).toEqual([canonicalEntry]);
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual([
      canonicalEntry,
    ]);
    expect(importHistoryFromJson(JSON.stringify([entryWithExtraFields]))).toEqual({
      history: [canonicalEntry],
    });
  });

  it("keeps the import byte cap large enough to re-import a maximum valid export", () => {
    const maximumValidExport = Array.from({ length: MAX_HISTORY_ITEMS }, (_, index) =>
      sampleEntry({
        id: `max-entry-${index}`,
        text: "\u0000".repeat(MAX_ENTRY_TEXT_LENGTH),
      }),
    );
    const exportBytes = new TextEncoder().encode(
      JSON.stringify(maximumValidExport, null, 2),
    ).byteLength;

    expect(MAX_IMPORT_FILE_BYTES).toBeGreaterThanOrEqual(exportBytes);
  });

  it("round-trips history entries", () => {
    const history = [
      sampleEntry({
        outputMode: "cleaned",
        rawText: "um ship the patch comma please",
        text: "Ship the patch, please.",
      }),
      sampleEntry({ id: "entry-2", modelId: "browser-local" }),
    ];

    saveHistory(history, localStorage);

    expect(loadHistory(localStorage)).toEqual(history);
  });

  it("round-trips desktop local Whisper history entries", () => {
    const history = [
      sampleEntry({
        id: "desktop-entry",
        modelId: "desktop-whisper-base",
        providerId: "desktop-whisper",
      }),
    ];

    saveHistory(history, localStorage);

    expect(loadHistory(localStorage)).toEqual(history);
  });

  it("round-trips desktop local Whisper small history entries", () => {
    const history = [
      sampleEntry({
        id: "desktop-small-entry",
        modelId: "desktop-whisper-small" as TranscriptEntry["modelId"],
        providerId: "desktop-whisper",
      }),
    ];

    saveHistory(history, localStorage);

    expect(loadHistory(localStorage)).toEqual(history);
  });

  it("migrates legacy MVP settings and history into Auralis storage keys", () => {
    const legacySettings = {
      ...DEFAULT_SETTINGS,
      modelId: "browser-local" as const,
      language: "fr-FR",
      continuous: false,
    };
    const legacyHistory = [sampleEntry({ id: "legacy-entry", text: "Keep my old note" })];

    localStorage.setItem("voice-to-text-mvp:settings:v1", JSON.stringify(legacySettings));
    localStorage.setItem("voice-to-text-mvp:history:v1", JSON.stringify(legacyHistory));

    expect(loadSettings(localStorage)).toEqual(legacySettings);
    expect(loadHistory(localStorage)).toEqual(legacyHistory);
    expect(JSON.parse(localStorage.getItem("auralis:settings:v1") ?? "{}")).toEqual(legacySettings);
    expect(JSON.parse(localStorage.getItem("auralis:history:v1") ?? "[]")).toEqual(legacyHistory);
  });

  it("imports validated history JSON", () => {
    const payload = JSON.stringify([
      sampleEntry(),
      sampleEntry({
        id: "entry-2",
        language: "fr-FR",
        modelId: "browser-local",
        text: "Bonjour a tous.",
      }),
    ]);

    expect(importHistoryFromJson(payload)).toEqual({
      history: [
        sampleEntry(),
        sampleEntry({
          id: "entry-2",
          language: "fr-FR",
          modelId: "browser-local",
          text: "Bonjour a tous.",
        }),
      ],
    });
  });

  it("rejects malformed imported history JSON", () => {
    const malformedRows = JSON.stringify([sampleEntry(), { id: 12, text: "bad row" }]);

    expect(importHistoryFromJson("not json")).toEqual({
      error: "Imported history must be valid JSON.",
    });
    expect(importHistoryFromJson(JSON.stringify({ entries: [] }))).toEqual({
      error: "Imported history must be a JSON array of transcript entries.",
    });
    expect(importHistoryFromJson(malformedRows)).toEqual({
      error: "Imported history contains invalid transcript entries.",
    });
    expect(
      importHistoryFromJson(
        JSON.stringify([
          sampleEntry({
            modelId: "browser-default",
            providerId: "desktop-whisper",
          }),
        ]),
      ),
    ).toEqual({ error: "Imported history contains invalid transcript entries." });
  });

  it("rejects imported history beyond the supported item limit", () => {
    const tooManyEntries = Array.from({ length: MAX_HISTORY_ITEMS + 1 }, (_, index) =>
      sampleEntry({ id: `entry-${index}` }),
    );

    expect(importHistoryFromJson(JSON.stringify(tooManyEntries))).toEqual({
      error: `Imported history can contain at most ${MAX_HISTORY_ITEMS} entries.`,
    });
  });

  it("rejects imported history entries with oversized fields", () => {
    expect(
      importHistoryFromJson(
        JSON.stringify([
          sampleEntry({
            id: "entry-oversized",
            text: "x".repeat(MAX_ENTRY_TEXT_LENGTH + 1),
          }),
        ]),
      ),
    ).toEqual({ error: "Imported history contains invalid transcript entries." });
  });

  it("refuses to persist history entries that would fail reload validation", () => {
    expect(() =>
      saveHistory([sampleEntry({ text: "x".repeat(MAX_ENTRY_TEXT_LENGTH + 1) })], localStorage),
    ).toThrow("History contains invalid transcript entries.");
    expect(localStorage.getItem("auralis:history:v1")).toBeNull();
  });
});
