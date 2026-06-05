import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../lib/settings";
import {
  appendTranscript,
  buildTranscriptEntry,
  formatDuration,
  formatTranscriptForOutput,
  normalizeTranscript,
} from "../lib/transcript";

describe("transcript helpers", () => {
  it("normalizes repeated whitespace", () => {
    expect(normalizeTranscript("  hello   world \n again ")).toBe("hello world again");
  });

  it("appends chunks with clean spacing", () => {
    expect(appendTranscript("hello there", "  general   kenobi ")).toBe(
      "hello there general kenobi",
    );
  });

  it("formats each output mode without changing the underlying STT engine", () => {
    expect(formatTranscriptForOutput(" um   ship  the patch , please ", "literal")).toBe(
      "um ship the patch , please",
    );
    expect(formatTranscriptForOutput(" um   ship  the patch , please ", "cleaned")).toBe(
      "Ship the patch, please.",
    );
    expect(
      formatTranscriptForOutput(
        "first decision period new paragraph second decision period",
        "markdown-notes",
      ),
    ).toBe("- First decision.\n- Second decision.");
    expect(
      formatTranscriptForOutput("quick update comma ship is green new line thanks", "message"),
    ).toBe("Quick update, ship is green\nThanks.");
    expect(
      formatTranscriptForOutput(
        "um const user underscore id equals request dot user dot id",
        "developer",
      ),
    ).toBe("const user_id = request.user.id");
  });

  it("builds a history entry with deterministic metadata", () => {
    const entry = buildTranscriptEntry(
      "  draft a launch note  ",
      DEFAULT_SETTINGS,
      1_000,
      5_300,
      () => "entry-fixed",
      "  um draft a launch note  ",
    );

    expect(entry).toEqual({
      id: "entry-fixed",
      text: "draft a launch note",
      createdAt: "1970-01-01T00:00:05.300Z",
      providerId: "browser-speech",
      modelId: "browser-default",
      language: "en-US",
      outputMode: "literal",
      rawText: "um draft a launch note",
      durationMs: 4300,
    });
  });

  it("formats durations for the history list", () => {
    expect(formatDuration(4_200)).toBe("4s");
    expect(formatDuration(75_000)).toBe("1m 15s");
  });
});
