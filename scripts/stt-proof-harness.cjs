#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const defaultAudioMimeType = "audio/webm;codecs=opus";
const openRouterEndpoint = "https://openrouter.ai/api/v1/audio/transcriptions";

const desktopWhisperChecks = [
  {
    id: "desktop-whisper-base",
    label: "Local Whisper base (recommended)",
    modelId: "desktop-whisper-base",
    providerId: "desktop-whisper",
    providerLabel: "Desktop local Whisper",
  },
  {
    id: "desktop-whisper-small",
    label: "Local Whisper small (better accuracy)",
    modelId: "desktop-whisper-small",
    providerId: "desktop-whisper",
    providerLabel: "Desktop local Whisper",
  },
  {
    id: "desktop-whisper-medium",
    label: "Local Whisper medium (highest accuracy, ~1.5 GB)",
    modelId: "desktop-whisper-medium",
    providerId: "desktop-whisper",
    providerLabel: "Desktop local Whisper",
  },
  {
    id: "desktop-whisper-tiny",
    label: "Local Whisper tiny (fastest first-run check)",
    modelId: "desktop-whisper-tiny",
    providerId: "desktop-whisper",
    providerLabel: "Desktop local Whisper",
  },
];

const openRouterChecks = [
  {
    apiModel: "openai/whisper-large-v3-turbo",
    id: "openrouter-whisper-large-v3-turbo",
    label: "OpenRouter Whisper Large v3 Turbo (fastest)",
    modelId: "openrouter-whisper-large-v3-turbo",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "openai/gpt-4o-mini-transcribe",
    id: "openrouter-gpt-4o-mini-transcribe",
    label: "OpenRouter GPT-4o Mini Transcribe (balanced)",
    modelId: "openrouter-gpt-4o-mini-transcribe",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "openai/gpt-4o-transcribe",
    id: "openrouter-gpt-4o-transcribe",
    label: "OpenRouter GPT-4o Transcribe (best quality)",
    modelId: "openrouter-gpt-4o-transcribe",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "nvidia/parakeet-tdt-0.6b-v3",
    id: "openrouter-parakeet-tdt-0.6b-v3",
    label: "OpenRouter NVIDIA Parakeet TDT 0.6B v3",
    modelId: "openrouter-parakeet-tdt-0.6b-v3",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "qwen/qwen3-asr-flash-2026-02-10",
    id: "openrouter-qwen3-asr-flash",
    label: "OpenRouter Qwen3 ASR Flash",
    modelId: "openrouter-qwen3-asr-flash",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "mistralai/voxtral-mini-transcribe",
    id: "openrouter-voxtral-mini-transcribe",
    label: "OpenRouter Voxtral Mini Transcribe",
    modelId: "openrouter-voxtral-mini-transcribe",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
  {
    apiModel: "openai/whisper-1",
    id: "openrouter-whisper-1",
    label: "OpenRouter Whisper 1",
    modelId: "openrouter-whisper-1",
    providerId: "openrouter-stt",
    providerLabel: "OpenRouter STT",
  },
];

const allChecks = [...desktopWhisperChecks, ...openRouterChecks];

function usage() {
  return `Auralis STT proof harness

Usage:
  npm run stt:proof -- --dry-run --format markdown
  npm run stt:proof -- --audio ./sample.webm --expected "hello world" --format json
  npm run stt:proof -- --audio ./sample.webm --provider openrouter-stt --allow-network

Options:
  --audio <path>          Audio fixture to transcribe. Without it checks are skipped.
  --expected <text>       Optional expected transcript; reports word error rate.
  --format <json|markdown> Output format. Default: markdown.
  --provider <id|all>     desktop-whisper, openrouter-stt, or all. Default: all.
  --model <id>            Restrict to one model. Can be repeated.
  --language <locale>     Language locale. Default: en-US.
  --mime-type <type>      Audio MIME type for OpenRouter. Default: ${defaultAudioMimeType}.
  --max-wer <number>      Failure threshold when --expected is set. Default: 0.35.
  --allow-network         Allow OpenRouter API calls. Otherwise cloud checks are skipped.
  --dry-run               Emit the full proof matrix without transcribing.
  --help                  Show this help.
`;
}

function parseArgs(argv) {
  const options = {
    allowNetwork: false,
    dryRun: false,
    format: "markdown",
    language: "en-US",
    maxWer: 0.35,
    mimeType: defaultAudioMimeType,
    models: new Set(),
    provider: "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === "--allow-network") {
      options.allowNetwork = true;
    } else if (arg === "--audio") {
      options.audio = next();
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--expected") {
      options.expected = next();
    } else if (arg === "--format") {
      options.format = next();
    } else if (arg === "--help") {
      options.help = true;
    } else if (arg === "--language") {
      options.language = next();
    } else if (arg === "--max-wer") {
      options.maxWer = Number(next());
    } else if (arg === "--mime-type") {
      options.mimeType = next();
    } else if (arg === "--model") {
      options.models.add(next());
    } else if (arg === "--provider") {
      options.provider = next();
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxWer) || options.maxWer < 0 || options.maxWer > 1) {
    throw new Error("--max-wer must be a number between 0 and 1.");
  }

  if (!["json", "markdown"].includes(options.format)) {
    throw new Error("--format must be json or markdown.");
  }

  if (!["all", "desktop-whisper", "openrouter-stt"].includes(options.provider)) {
    throw new Error("--provider must be all, desktop-whisper, or openrouter-stt.");
  }

  return options;
}

function redactSecret(value) {
  const secret = process.env.OPENROUTER_API_KEY?.trim();
  if (!secret || typeof value !== "string") {
    return value;
  }

  return value.split(secret).join("[redacted:OPENROUTER_API_KEY]");
}

function normalizeWords(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordErrorRate(expected, actual) {
  const reference = normalizeWords(expected);
  const hypothesis = normalizeWords(actual);
  if (reference.length === 0) {
    return hypothesis.length === 0 ? 0 : 1;
  }

  const previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (let refIndex = 1; refIndex <= reference.length; refIndex += 1) {
    let diagonal = previous[0];
    previous[0] = refIndex;
    for (let hypIndex = 1; hypIndex <= hypothesis.length; hypIndex += 1) {
      const above = previous[hypIndex];
      const substitutionCost = reference[refIndex - 1] === hypothesis[hypIndex - 1] ? 0 : 1;
      previous[hypIndex] = Math.min(
        previous[hypIndex] + 1,
        previous[hypIndex - 1] + 1,
        diagonal + substitutionCost,
      );
      diagonal = above;
    }
  }

  return previous[hypothesis.length] / reference.length;
}

function summarizeResult(check, result, options, wallMs) {
  const transcript = typeof result.text === "string" ? result.text.trim() : "";
  const metrics = {
    audioSeconds: result.audioSeconds,
    computeType: result.computeType,
    cpuThreads: result.cpuThreads,
    decodeMs: result.decodeMs,
    device: result.device,
    modelLoadMs: result.modelLoadMs,
    wallMs,
  };

  if (!result.ok) {
    return {
      ...check,
      evidence: redactSecret(result.message || "Transcription failed."),
      metrics,
      status: "fail",
      transcript,
    };
  }

  if (options.expected) {
    const wer = wordErrorRate(options.expected, transcript);
    return {
      ...check,
      evidence:
        wer <= options.maxWer
          ? `Transcript within WER threshold (${wer.toFixed(3)} <= ${options.maxWer}).`
          : `Transcript above WER threshold (${wer.toFixed(3)} > ${options.maxWer}).`,
      matchedExpected: wer <= options.maxWer,
      metrics: { ...metrics, wer },
      status: wer <= options.maxWer ? "pass" : "fail",
      transcript,
    };
  }

  return {
    ...check,
    evidence: result.message || "Transcription completed.",
    metrics,
    status: "pass",
    transcript,
  };
}

function skipCheck(check, evidence) {
  return {
    ...check,
    evidence,
    metrics: {},
    status: "skipped",
    transcript: "",
  };
}

function audioPathFor(options) {
  return options.audio ? path.resolve(projectRoot, options.audio) : null;
}

function localWhisperPython() {
  return process.env.AURALIS_WHISPER_PYTHON || "python3";
}

function runLocalWhisper(check, options) {
  const audio = audioPathFor(options);
  if (options.dryRun) {
    return skipCheck(check, "Dry run: local helper invocation not executed.");
  }
  if (!audio) {
    return skipCheck(check, "No --audio fixture supplied.");
  }
  if (!existsSync(audio)) {
    return skipCheck(check, `Audio fixture not found: ${audio}`);
  }

  const startedAt = Date.now();
  const result = spawnSync(
    localWhisperPython(),
    [
      path.join(projectRoot, "scripts", "transcribe-local-whisper.py"),
      "--audio",
      audio,
      "--language",
      options.language,
      "--model-id",
      check.modelId,
    ],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      env: process.env,
      timeout: 180_000,
    },
  );
  const wallMs = Date.now() - startedAt;
  const raw = `${result.stdout || ""}\n${result.stderr || ""}`.trim();

  try {
    const parsed = JSON.parse(result.stdout || "{}");
    return summarizeResult(check, parsed, options, wallMs);
  } catch {
    return {
      ...check,
      evidence: redactSecret(raw || "Local Whisper helper did not return JSON."),
      metrics: { wallMs },
      status: "fail",
      transcript: "",
    };
  }
}

async function runOpenRouter(check, options) {
  const audio = audioPathFor(options);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (options.dryRun) {
    return skipCheck(check, "Dry run: OpenRouter request not executed.");
  }
  if (!audio) {
    return skipCheck(check, "No --audio fixture supplied.");
  }
  if (!existsSync(audio)) {
    return skipCheck(check, `Audio fixture not found: ${audio}`);
  }
  if (!apiKey) {
    return skipCheck(check, "OPENROUTER_API_KEY is not configured.");
  }
  if (!options.allowNetwork) {
    return skipCheck(check, "Network checks require --allow-network.");
  }

  const startedAt = Date.now();
  try {
    const audioBuffer = readFileSync(audio);
    const body = JSON.stringify({
      input_audio: {
        data: audioBuffer.toString("base64"),
        format: audioExtensionForMimeType(options.mimeType),
      },
      language: options.language.slice(0, 2),
      model: check.apiModel,
      temperature: 0,
    });
    const response = await fetch(openRouterEndpoint, {
      body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Auralis STT proof harness",
      },
      method: "POST",
      signal: AbortSignal.timeout(120_000),
    });
    const parsed = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        parsed?.error?.message || parsed?.message || "OpenRouter transcription failed.";
      return summarizeResult(
        check,
        { message: redactSecret(message), ok: false },
        options,
        Date.now() - startedAt,
      );
    }

    return summarizeResult(
      check,
      {
        audioSeconds: parsed?.usage?.seconds,
        decodeMs: Date.now() - startedAt,
        generationId: response.headers?.get?.("X-Generation-Id") ?? undefined,
        message: "Transcribed with OpenRouter.",
        ok: true,
        text: typeof parsed?.text === "string" ? parsed.text.trim() : "",
      },
      options,
      Date.now() - startedAt,
    );
  } catch (error) {
    return summarizeResult(
      check,
      {
        message: redactSecret(
          error instanceof Error ? error.message : "OpenRouter request failed.",
        ),
        ok: false,
      },
      options,
      Date.now() - startedAt,
    );
  }
}

function audioExtensionForMimeType(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("wav")) {
    return "wav";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }
  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "mp4";
  }
  if (normalized.includes("ogg")) {
    return "ogg";
  }
  return "webm";
}

function selectedChecks(options) {
  return allChecks.filter((check) => {
    if (options.provider !== "all" && check.providerId !== options.provider) {
      return false;
    }
    if (options.models.size > 0 && !options.models.has(check.modelId)) {
      return false;
    }
    return true;
  });
}

function summarize(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { fail: 0, pass: 0, skipped: 0 },
  );
}

function renderMarkdown(payload) {
  const lines = [
    "# Auralis STT proof matrix",
    "",
    `Generated: ${payload.generatedAt}`,
    `Mode: ${payload.mode}`,
    "",
    "| Provider | Model | Status | Evidence |",
    "| --- | --- | --- | --- |",
  ];

  for (const check of payload.checks) {
    lines.push(
      `| ${escapeMarkdown(check.providerLabel)} | ${escapeMarkdown(check.label)} | ${check.status} | ${escapeMarkdown(check.evidence)} |`,
    );
  }

  lines.push(
    "",
    `Summary: ${payload.summary.pass} pass, ${payload.summary.fail} fail, ${payload.summary.skipped} skipped.`,
  );

  return `${lines.join("\n")}\n`;
}

function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

async function run(options) {
  const checks = [];
  for (const check of selectedChecks(options)) {
    if (check.providerId === "desktop-whisper") {
      checks.push(runLocalWhisper(check, options));
    } else {
      checks.push(await runOpenRouter(check, options));
    }
  }

  const payload = {
    audio: options.audio ? path.resolve(projectRoot, options.audio) : null,
    checks,
    expected: options.expected || null,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? "dry-run" : "execute",
    ok: checks.every((check) => check.status !== "fail"),
    summary: summarize(checks),
  };

  return payload;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
      return;
    }

    const payload = await run(options);
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      process.stdout.write(renderMarkdown(payload));
    }
    process.exitCode = payload.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${redactSecret(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exitCode = 2;
  }
}

void main();
