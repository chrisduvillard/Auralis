import type {
  OutputMode,
  PersonalTextRule,
  PersonalTextRuleKind,
  PersonalTextSettings,
} from "./types";

export const MAX_PERSONAL_TEXT_RULES = 50;
export const MAX_PERSONAL_TEXT_ID_LENGTH = 80;
export const MAX_PERSONAL_TEXT_TRIGGER_LENGTH = 80;
export const MAX_PERSONAL_TEXT_REPLACEMENT_LENGTH = 1_000;
export const MAX_PERSONAL_TEXT_OUTPUT_LENGTH = 10_000;
export const PERSONAL_TEXT_RULE_KINDS = ["vocabulary", "replacement", "snippet"] as const;

export const DEFAULT_PERSONAL_TEXT_SETTINGS: PersonalTextSettings = {
  enabled: true,
  rules: [],
};

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bghp_[A-Za-z0-9_]{12,}\b/,
  /\bAKIA[0-9A-Z]{12,}\b/,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

const RULE_LINE_PATTERN = /^(vocabulary|replacement|snippet):\s*(.+?)\s*=>\s*(.+)$/i;
const WORDISH_PATTERN = /^[\p{L}\p{N}_-]+$/u;

export function containsSecretLikeValue(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function isPersonalTextRuleKind(value: unknown): value is PersonalTextRuleKind {
  return (
    typeof value === "string" && PERSONAL_TEXT_RULE_KINDS.includes(value as PersonalTextRuleKind)
  );
}

export function normalizePersonalTextId(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PERSONAL_TEXT_ID_LENGTH);

  return normalized || "rule";
}

export function isPersistablePersonalTextRule(value: unknown): value is PersonalTextRule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (!isPersonalTextRuleKind(candidate.kind)) {
    return false;
  }

  if (
    typeof candidate.id !== "string" ||
    candidate.id.trim().length === 0 ||
    candidate.id.length > MAX_PERSONAL_TEXT_ID_LENGTH ||
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.trigger !== "string" ||
    candidate.trigger.trim().length === 0 ||
    candidate.trigger.length > MAX_PERSONAL_TEXT_TRIGGER_LENGTH ||
    typeof candidate.replacement !== "string" ||
    candidate.replacement.trim().length === 0 ||
    candidate.replacement.length > MAX_PERSONAL_TEXT_REPLACEMENT_LENGTH
  ) {
    return false;
  }

  return (
    !containsSecretLikeValue(candidate.trigger) && !containsSecretLikeValue(candidate.replacement)
  );
}

export function canonicalizePersonalTextRule(value: unknown): PersonalTextRule | null {
  if (!isPersistablePersonalTextRule(value)) {
    return null;
  }

  return {
    enabled: value.enabled,
    id: value.id.trim(),
    kind: value.kind,
    replacement: value.replacement.trim(),
    trigger: value.trigger.trim(),
  };
}

export function canonicalizePersonalTextSettings(value: unknown): PersonalTextSettings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_PERSONAL_TEXT_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;
  const rulesSource = Array.isArray(candidate.rules) ? candidate.rules : [];
  const rules: PersonalTextRule[] = [];
  const seenIds = new Set<string>();

  for (const rawRule of rulesSource) {
    const rule = canonicalizePersonalTextRule(rawRule);
    if (!rule || seenIds.has(rule.id)) {
      continue;
    }

    seenIds.add(rule.id);
    rules.push(rule);
    if (rules.length === MAX_PERSONAL_TEXT_RULES) {
      break;
    }
  }

  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
    rules,
  };
}

export function assertPersistablePersonalTextSettings(settings: PersonalTextSettings): void {
  if (typeof settings.enabled !== "boolean" || !Array.isArray(settings.rules)) {
    throw new Error("Personal text settings are invalid.");
  }

  if (settings.rules.length > MAX_PERSONAL_TEXT_RULES) {
    throw new Error(`Personal text can contain at most ${MAX_PERSONAL_TEXT_RULES} rules.`);
  }

  if (
    settings.rules.some(
      (rule) => containsSecretLikeValue(rule.trigger) || containsSecretLikeValue(rule.replacement),
    )
  ) {
    throw new Error("Personal text rules cannot contain secret-like values.");
  }

  if (!settings.rules.every(isPersistablePersonalTextRule)) {
    throw new Error("Personal text rules are invalid.");
  }

  if (new Set(settings.rules.map((rule) => rule.id)).size !== settings.rules.length) {
    throw new Error("Personal text rules contain duplicate IDs.");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeSnippetValue(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function boundaryPatternForTrigger(trigger: string): RegExp {
  const escaped = escapeRegExp(trigger.trim()).replace(/\s+/g, "\\s+");
  const first = trigger.trim().charAt(0);
  const last = trigger.trim().charAt(trigger.trim().length - 1);
  const prefix = WORDISH_PATTERN.test(first) ? "(?<![\\p{L}\\p{N}_-])" : "";
  const suffix = WORDISH_PATTERN.test(last) ? "(?![\\p{L}\\p{N}_-])" : "";

  return new RegExp(`${prefix}${escaped}${suffix}`, "giu");
}

type PersonalTextSegment = {
  isProtected: boolean;
  text: string;
};

function assertPersonalTextOutputLength(length: number): void {
  if (length > MAX_PERSONAL_TEXT_OUTPUT_LENGTH) {
    throw new Error("Personal text rules would make this transcript too long.");
  }
}

export function applyPersonalTextSettings(
  text: string,
  settings: PersonalTextSettings,
  outputMode: OutputMode = "literal",
): string {
  if (!settings.enabled || settings.rules.length === 0 || !text) {
    return text;
  }

  const activeRules = settings.rules.filter((rule) => rule.enabled);
  if (activeRules.length === 0) {
    return text;
  }

  let outputLength = text.length;
  assertPersonalTextOutputLength(outputLength);

  let segments: PersonalTextSegment[] = [{ isProtected: false, text }];
  for (const rule of activeRules) {
    if (outputMode === "developer" && rule.kind !== "snippet") {
      continue;
    }

    const pattern = boundaryPatternForTrigger(rule.trigger);
    const replacement = unescapeSnippetValue(rule.replacement);
    const nextSegments: PersonalTextSegment[] = [];

    for (const segment of segments) {
      if (segment.isProtected) {
        nextSegments.push(segment);
        continue;
      }

      pattern.lastIndex = 0;
      let cursor = 0;
      let match = pattern.exec(segment.text);
      while (match) {
        const matchedText = match[0];
        const matchedStart = match.index;
        const matchedEnd = matchedStart + matchedText.length;
        const before = segment.text.slice(cursor, matchedStart);
        if (before) {
          nextSegments.push({ isProtected: false, text: before });
        }

        outputLength += replacement.length - matchedText.length;
        assertPersonalTextOutputLength(outputLength);
        nextSegments.push({ isProtected: true, text: replacement });
        cursor = matchedEnd;
        match = pattern.exec(segment.text);
      }

      const after = segment.text.slice(cursor);
      if (after) {
        nextSegments.push({ isProtected: false, text: after });
      }
    }

    segments = nextSegments;
  }

  return segments.map((segment) => segment.text).join("");
}

export function parsePersonalTextRules(
  rawValue: string,
): { rules: PersonalTextRule[] } | { error: string } {
  const rules: PersonalTextRule[] = [];
  const seenIds = new Set<string>();

  for (const rawLine of rawValue.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = RULE_LINE_PATTERN.exec(line);
    if (!match) {
      return {
        error: "Use one rule per line: vocabulary|replacement|snippet: trigger => replacement.",
      };
    }

    const kind = match[1].toLocaleLowerCase() as PersonalTextRuleKind;
    const trigger = match[2].trim();
    const replacement = match[3].trim();
    const baseId = normalizePersonalTextId(`${kind}-${trigger}`);
    let id = baseId;
    let suffix = 2;
    while (seenIds.has(id)) {
      const suffixText = `-${suffix}`;
      id = `${baseId.slice(0, MAX_PERSONAL_TEXT_ID_LENGTH - suffixText.length)}${suffixText}`;
      suffix += 1;
    }

    const rule: PersonalTextRule = {
      enabled: true,
      id,
      kind,
      replacement,
      trigger,
    };

    if (!isPersistablePersonalTextRule(rule)) {
      return {
        error: "Personal text rules cannot be empty, oversized, malformed, or secret-like.",
      };
    }

    seenIds.add(id);
    rules.push(rule);
    if (rules.length > MAX_PERSONAL_TEXT_RULES) {
      return { error: `Personal text can contain at most ${MAX_PERSONAL_TEXT_RULES} rules.` };
    }
  }

  return { rules };
}

export function serializePersonalTextRules(rules: PersonalTextRule[]): string {
  return rules.map((rule) => `${rule.kind}: ${rule.trigger} => ${rule.replacement}`).join("\n");
}
