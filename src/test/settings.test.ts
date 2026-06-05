import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  DESKTOP_WHISPER_MODEL_OPTIONS,
  defaultModelForProvider,
  isSupportedModel,
  isSupportedProvider,
  modelLabel,
  modelOptionsForProvider,
  OPENROUTER_TRANSCRIPTION_MODEL_OPTIONS,
  OUTPUT_MODE_OPTIONS,
} from "../lib/settings";

describe("recognition model settings", () => {
  it("uses Whisper base as the local desktop default while keeping tiny available for speed", () => {
    const smallModel = "desktop-whisper-small" as Parameters<typeof modelLabel>[0];
    const mediumModel = "desktop-whisper-medium" as Parameters<typeof modelLabel>[0];

    expect(defaultModelForProvider("desktop-whisper")).toBe("desktop-whisper-base");
    expect(modelOptionsForProvider("desktop-whisper").map((option) => option.value)).toEqual([
      "desktop-whisper-tiny",
      "desktop-whisper-base",
      "desktop-whisper-small",
      "desktop-whisper-medium",
    ]);
    expect(DESKTOP_WHISPER_MODEL_OPTIONS).toContainEqual({
      label: "Local Whisper tiny (fastest first-run check)",
      value: "desktop-whisper-tiny",
    });
    expect(DESKTOP_WHISPER_MODEL_OPTIONS).toContainEqual({
      label: "Local Whisper small (better accuracy)",
      value: smallModel,
    });
    expect(DESKTOP_WHISPER_MODEL_OPTIONS).toContainEqual({
      label: "Local Whisper medium (highest accuracy, ~1.5 GB)",
      value: mediumModel,
    });
    expect(isSupportedModel("desktop-whisper-small")).toBe(true);
    expect(isSupportedModel("desktop-whisper-medium")).toBe(true);
    expect(modelLabel(smallModel)).toBe("Local Whisper small (better accuracy)");
    expect(modelLabel(mediumModel)).toBe("Local Whisper medium (highest accuracy, ~1.5 GB)");
  });

  it("offers OpenRouter transcription models with a fast dictation default and quality fallbacks", () => {
    expect(isSupportedProvider("openrouter-stt")).toBe(true);
    expect(defaultModelForProvider("openrouter-stt")).toBe("openrouter-whisper-large-v3-turbo");
    expect(modelOptionsForProvider("openrouter-stt").map((option) => option.value)).toEqual([
      "openrouter-whisper-large-v3-turbo",
      "openrouter-gpt-4o-mini-transcribe",
      "openrouter-gpt-4o-transcribe",
      "openrouter-parakeet-tdt-0.6b-v3",
      "openrouter-qwen3-asr-flash",
      "openrouter-voxtral-mini-transcribe",
      "openrouter-whisper-1",
    ]);
    expect(OPENROUTER_TRANSCRIPTION_MODEL_OPTIONS[0]).toEqual({
      label: "OpenRouter Whisper Large v3 Turbo (fastest)",
      value: "openrouter-whisper-large-v3-turbo",
    });
    expect(isSupportedModel("openrouter-whisper-large-v3-turbo")).toBe(true);
    expect(modelLabel("openrouter-whisper-large-v3-turbo")).toBe(
      "OpenRouter Whisper Large v3 Turbo (fastest)",
    );
    expect(modelLabel("openrouter-gpt-4o-mini-transcribe")).toBe(
      "OpenRouter GPT-4o Mini Transcribe (balanced)",
    );
    expect(modelLabel("openrouter-gpt-4o-transcribe")).toBe(
      "OpenRouter GPT-4o Transcribe (best quality)",
    );
  });

  it("keeps output cleanup modes separate from provider and model selection", () => {
    expect(DEFAULT_SETTINGS.outputMode).toBe("literal");
    expect(OUTPUT_MODE_OPTIONS).toEqual([
      { value: "literal", label: "Literal" },
      { value: "cleaned", label: "Clean dictation" },
      { value: "markdown-notes", label: "Markdown notes" },
      { value: "message", label: "Email / Slack" },
      { value: "developer", label: "Code / developer" },
    ]);
    expect(modelOptionsForProvider("openrouter-stt").map((option) => option.value)).toEqual([
      "openrouter-whisper-large-v3-turbo",
      "openrouter-gpt-4o-mini-transcribe",
      "openrouter-gpt-4o-transcribe",
      "openrouter-parakeet-tdt-0.6b-v3",
      "openrouter-qwen3-asr-flash",
      "openrouter-voxtral-mini-transcribe",
      "openrouter-whisper-1",
    ]);
  });
});
