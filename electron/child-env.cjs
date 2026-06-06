const BASE_CHILD_ENV_NAMES = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "ComSpec",
  "DBUS_SESSION_BUS_ADDRESS",
  "DISPLAY",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "Path",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XAUTHORITY",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
];

const WHISPER_CHILD_ENV_NAMES = [
  "AURALIS_WHISPER_COMPUTE_TYPE",
  "AURALIS_WHISPER_CPU_THREADS",
  "AURALIS_WHISPER_DEVICE",
  "AURALIS_WHISPER_MODEL_DIR",
  "AURALIS_WHISPER_RUNTIME_DIR",
  "AURALIS_WHISPER_USE_UV_CACHE",
  "CURL_CA_BUNDLE",
  "HF_HUB_OFFLINE",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
  "TRANSFORMERS_OFFLINE",
  "https_proxy",
  "http_proxy",
  "no_proxy",
];

const DENIED_NAME_PARTS = [
  "AUTH",
  "CERTIFICATE",
  "COOKIE",
  "CREDENTIAL",
  "GITHUB_TOKEN",
  "KEY",
  "OPENROUTER_API_KEY",
  "PASS",
  "PASSWORD",
  "SECRET",
  "TOKEN",
];

function normalizeEnvName(name) {
  return String(name || "").trim();
}

function isDeniedEnvName(name) {
  const normalized = normalizeEnvName(name).toUpperCase();
  return DENIED_NAME_PARTS.some((part) => normalized.includes(part));
}

function addEnvValue(target, source, name, options = {}) {
  const normalized = normalizeEnvName(name);
  if (!normalized || (!options.trustedName && isDeniedEnvName(normalized))) {
    return;
  }

  const value = source[normalized];
  if (typeof value !== "undefined") {
    target[normalized] = String(value);
  }
}

function extraAllowedEnvNames(baseEnv) {
  return String(baseEnv.AURALIS_CHILD_ENV_ALLOWLIST || "")
    .split(",")
    .map((name) => normalizeEnvName(name))
    .filter(Boolean);
}

function createChildProcessEnv(overrides = {}, options = {}) {
  const baseEnv = options.baseEnv || process.env;
  const names = new Set(BASE_CHILD_ENV_NAMES);

  if (options.includeWhisperEnv) {
    for (const name of WHISPER_CHILD_ENV_NAMES) {
      names.add(name);
    }
  }

  const trustedNames = new Set(names);

  for (const name of extraAllowedEnvNames(baseEnv)) {
    names.add(name);
  }

  const env = {};
  for (const name of names) {
    addEnvValue(env, baseEnv, name, { trustedName: trustedNames.has(name) });
  }

  for (const [name, value] of Object.entries(overrides)) {
    const normalized = normalizeEnvName(name);
    if (
      !normalized ||
      isDeniedEnvName(normalized) ||
      typeof value === "undefined" ||
      value === null
    ) {
      continue;
    }
    env[normalized] = String(value);
  }

  return env;
}

module.exports = { createChildProcessEnv, isDeniedEnvName };
