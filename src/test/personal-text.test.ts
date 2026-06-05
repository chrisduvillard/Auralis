import { describe, expect, it } from "vitest";

import {
  applyPersonalTextSettings,
  DEFAULT_PERSONAL_TEXT_SETTINGS,
  parsePersonalTextRules,
  serializePersonalTextRules,
} from "../lib/personal-text";
import type { PersonalTextSettings } from "../lib/types";

function settings(overrides: Partial<PersonalTextSettings> = {}): PersonalTextSettings {
  return {
    ...DEFAULT_PERSONAL_TEXT_SETTINGS,
    rules: [],
    ...overrides,
  };
}

describe("personal text rules", () => {
  it("keeps empty or disabled settings as a no-op", () => {
    expect(applyPersonalTextSettings("Open router is ready.", DEFAULT_PERSONAL_TEXT_SETTINGS)).toBe(
      "Open router is ready.",
    );
    expect(
      applyPersonalTextSettings(
        "Open router is ready.",
        settings({
          enabled: false,
          rules: [
            {
              enabled: true,
              id: "rule-1",
              kind: "replacement",
              replacement: "OpenRouter",
              trigger: "Open router",
            },
          ],
        }),
      ),
    ).toBe("Open router is ready.");
  });

  it("applies vocabulary, replacements, and snippets in user order without recursion", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-vocabulary",
          kind: "vocabulary",
          replacement: "OpenRouter",
          trigger: "open router",
        },
        {
          enabled: true,
          id: "rule-replacement",
          kind: "replacement",
          replacement: "Auralis",
          trigger: "oralis",
        },
        {
          enabled: true,
          id: "rule-snippet",
          kind: "snippet",
          replacement: "Thanks,\\nChris",
          trigger: ";sig",
        },
        {
          enabled: true,
          id: "rule-recursive-guard",
          kind: "replacement",
          replacement: "SHOULD NOT RECURSE",
          trigger: "Chris",
        },
      ],
    });

    expect(applyPersonalTextSettings("open router and oralis are ready. ;sig", personalText)).toBe(
      "OpenRouter and Auralis are ready. Thanks,\nChris",
    );
  });

  it("protects prior replacements from later numeric triggers", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-foo",
          kind: "replacement",
          replacement: "bar",
          trigger: "foo",
        },
        {
          enabled: true,
          id: "rule-zero",
          kind: "replacement",
          replacement: "zero",
          trigger: "0",
        },
      ],
    });

    expect(applyPersonalTextSettings("foo 0", personalText)).toBe("bar zero");
  });

  it("restores dollar-sign replacement text literally", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-dollar-snippet",
          kind: "snippet",
          replacement: "$& $1 $$",
          trigger: ";money",
        },
      ],
    });

    expect(applyPersonalTextSettings("Please add ;money", personalText)).toBe(
      "Please add $& $1 $$",
    );
  });

  it("preserves placeholder-shaped source text literally", () => {
    const placeholderShapedText = `\uE000${String.fromCharCode(0xe100)}\uE001`;
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-foo",
          kind: "replacement",
          replacement: "bar",
          trigger: "foo",
        },
      ],
    });

    expect(applyPersonalTextSettings(`${placeholderShapedText} foo`, personalText)).toBe(
      `${placeholderShapedText} bar`,
    );
  });

  it("rejects personal text expansion before producing oversized output", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-expanded-snippet",
          kind: "snippet",
          replacement: Array.from({ length: 333 }, () => "xx").join(" "),
          trigger: ";x",
        },
      ],
    });

    expect(() => applyPersonalTextSettings(`${";x ".repeat(12)}`, personalText)).toThrow(
      "Personal text rules would make this transcript too long.",
    );
  });

  it("uses phrase boundaries and escapes regex-like triggers", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-boundary",
          kind: "replacement",
          replacement: "API",
          trigger: "api",
        },
        {
          enabled: true,
          id: "rule-regex-looking",
          kind: "replacement",
          replacement: "C++",
          trigger: "see plus plus",
        },
      ],
    });

    expect(applyPersonalTextSettings("capitan api see plus plus", personalText)).toBe(
      "capitan API C++",
    );
  });

  it("skips vocabulary and replacements in developer mode while allowing snippets", () => {
    const personalText = settings({
      rules: [
        {
          enabled: true,
          id: "rule-vocab",
          kind: "vocabulary",
          replacement: "OpenRouter",
          trigger: "open router",
        },
        {
          enabled: true,
          id: "rule-snippet",
          kind: "snippet",
          replacement: "console.log(value)",
          trigger: ";log",
        },
      ],
    });

    expect(applyPersonalTextSettings("open router ;log", personalText, "developer")).toBe(
      "open router console.log(value)",
    );
  });

  it("deduplicates long normalized rule IDs without hanging", () => {
    const sharedPrefix = Array.from({ length: 23 }, () => "aa").join(" ");
    const parsed = parsePersonalTextRules(
      [
        `vocabulary: ${sharedPrefix} one => First`,
        `vocabulary: ${sharedPrefix} two => Second`,
      ].join("\n"),
    );

    if ("error" in parsed) {
      throw new Error(parsed.error);
    }

    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules[0]?.id).toHaveLength(80);
    expect(parsed.rules[1]?.id).toHaveLength(80);
    expect(parsed.rules[1]?.id).toMatch(/-2$/);
    expect(new Set(parsed.rules.map((rule) => rule.id)).size).toBe(2);
  });

  it("parses and serializes the compact settings editor format", () => {
    const parsed = parsePersonalTextRules(
      [
        "vocabulary: open router => OpenRouter",
        "replacement: oralis => Auralis",
        "snippet: ;sig => Thanks,\\nChris",
      ].join("\n"),
    );

    if ("error" in parsed) {
      throw new Error(parsed.error);
    }

    expect(parsed).toEqual({
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
    expect(serializePersonalTextRules(parsed.rules)).toBe(
      "vocabulary: open router => OpenRouter\nreplacement: oralis => Auralis\nsnippet: ;sig => Thanks,\\nChris",
    );
    expect(parsePersonalTextRules("bad line")).toEqual({
      error: "Use one rule per line: vocabulary|replacement|snippet: trigger => replacement.",
    });
  });
});
