const {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  screen,
  session,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  isAuralisMediaPermissionCheck,
  isAuralisMediaPermissionRequest,
  isRendererUrl: isRendererUrlForApp,
} = require("./permissions.cjs");
const { createHoldToTalkController, createUiohookBackend } = require("./hold-to-talk.cjs");

const TOGGLE_SHORTCUT = "Control+Alt+Space";
const TOGGLE_SHORTCUT_FALLBACKS = [TOGGLE_SHORTCUT, "Control+Shift+Alt+Space"];
const COPY_SHORTCUT = "CommandOrControl+Alt+C";
const COPY_SHORTCUT_FALLBACKS = [COPY_SHORTCUT, "CommandOrControl+Alt+K"];
const PASTE_SHORTCUT = "CommandOrControl+Alt+Enter";
const PASTE_SHORTCUT_FALLBACKS = [
  PASTE_SHORTCUT,
  "CommandOrControl+Shift+Enter",
  "CommandOrControl+Alt+V",
];
const MAX_DESKTOP_TEXT_LENGTH = 10_000;
const MAX_DESKTOP_AUDIO_BYTES = 30 * 1024 * 1024;
const PASTE_TARGET_TTL_MS = 45_000;
const PINNED_FASTER_WHISPER = "faster-whisper==1.2.1";
const DESKTOP_WHISPER_MODEL_NAMES = new Map([
  ["desktop-whisper-tiny", "tiny"],
  ["desktop-whisper-base", "base"],
  ["desktop-whisper-small", "small"],
  ["desktop-whisper-medium", "medium"],
]);
const OPENROUTER_TRANSCRIPTION_MODELS = new Map([
  ["openrouter-whisper-large-v3-turbo", "openai/whisper-large-v3-turbo"],
  ["openrouter-gpt-4o-mini-transcribe", "openai/gpt-4o-mini-transcribe"],
  ["openrouter-gpt-4o-transcribe", "openai/gpt-4o-transcribe"],
  ["openrouter-parakeet-tdt-0.6b-v3", "nvidia/parakeet-tdt-0.6b-v3"],
  ["openrouter-qwen3-asr-flash", "qwen/qwen3-asr-flash-2026-02-10"],
  ["openrouter-voxtral-mini-transcribe", "mistralai/voxtral-mini-transcribe"],
  ["openrouter-whisper-1", "openai/whisper-1"],
]);
function resourceScriptPath(scriptName) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "scripts", scriptName);
  }

  return path.join(__dirname, "..", "scripts", scriptName);
}

function whisperHelperPath() {
  return resourceScriptPath("transcribe-local-whisper.py");
}

function whisperBootstrapPath() {
  return resourceScriptPath("bootstrap-local-whisper.py");
}
const DESKTOP_WHISPER_MODELS = new Set(DESKTOP_WHISPER_MODEL_NAMES.keys());
const OPENROUTER_MODELS = new Set(OPENROUTER_TRANSCRIPTION_MODELS.keys());
const SUPPORTED_LANGUAGES = new Set(["en-US", "en-GB", "de-DE", "fr-FR", "es-ES"]);

let mainWindow = null;
let listeningOverlayWindow = null;
let listeningOverlayReady = false;
let listeningOverlayFlashTimer = null;
let listeningOverlayLastCapture = { muteSystemAudio: false, status: "idle" };
let listeningOverlayPendingPayload = null;
let lastExternalFocusTarget = null;
let cachedWhisperPython = null;
let rendererCaptureState = "idle";
let audioDuckingActive = false;
let audioDuckingDesiredMuted = false;
let audioDuckingPreviousMuted = null;
let audioDuckingDeviceKey = null;
let audioDuckingChangedSystemMute = false;
let audioDuckingUpdateQueue = Promise.resolve();
let audioDuckingPendingUpdates = 0;
let isRestoringAudioBeforeQuit = false;
let allowQuitAfterAudioRestore = false;
let holdToTalkController = null;
let holdToTalkWarning = null;
let registeredShortcuts = { copy: null, paste: null, toggle: null };
let shortcutWarnings = [];
let updateInstallInProgress = false;
let whisperWorker = null;
let whisperWorkerBuffer = "";
let whisperWorkerKey = null;
let whisperWorkerNextId = 1;
const whisperWorkerPending = new Map();
let whisperWorkerQueue = Promise.resolve();
let whisperWorkerStartPromise = null;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;
autoUpdater.setFeedURL({
  owner: "chrisduvillard",
  provider: "github",
  repo: "Auralis",
});

function rendererUrl() {
  return pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).toString();
}

const LISTENING_OVERLAY_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; user-select: none; }
  .bar { position: absolute; left: 16px; right: 16px; bottom: 12px; height: 28px; display: grid; place-items: center; opacity: 0; transform: translateY(8px) scale(.96); transition: opacity 160ms ease, transform 160ms ease; }
  body[data-visible="true"] .bar { opacity: 1; transform: translateY(0) scale(1); }
  .rail { width: 172px; height: 6px; overflow: hidden; border-radius: 999px; background: rgba(226, 232, 240, .16); box-shadow: 0 16px 40px rgba(15, 23, 42, .24), 0 0 0 1px rgba(255,255,255,.10) inset; }
  .fill { width: 100%; height: 100%; border-radius: inherit; transform-origin: left center; transform: scaleX(.26); background: linear-gradient(90deg, rgba(203,213,225,.76), rgba(241,245,249,.96)); }
  .label { margin-top: 7px; color: rgba(248,250,252,.72); font-size: 11px; font-weight: 600; letter-spacing: .08em; text-align: center; text-transform: uppercase; text-shadow: 0 1px 12px rgba(15, 23, 42, .4); }
  body[data-tone="preparing"] .fill { transform: scaleX(.38); animation: breathe 1.2s ease-in-out infinite; }
  body[data-tone="recording"] .fill { background: linear-gradient(90deg, rgba(125,211,252,.86), rgba(196,181,253,.96)); animation: breathe 900ms ease-in-out infinite; }
  body[data-tone="transcribing"] .fill { background: linear-gradient(90deg, rgba(96,165,250,.72), rgba(248,250,252,.98), rgba(96,165,250,.72)); animation: sweep 1s ease-in-out infinite; transform: scaleX(1); }
  body[data-tone="pasted"] .fill { background: linear-gradient(90deg, rgba(52,211,153,.86), rgba(187,247,208,.98)); transform: scaleX(1); }
  body[data-tone="copied"] .fill { background: linear-gradient(90deg, rgba(147,197,253,.82), rgba(219,234,254,.98)); transform: scaleX(1); }
  body[data-tone="error"] .fill { background: linear-gradient(90deg, rgba(251,191,36,.86), rgba(254,240,138,.98)); animation: pulse 700ms ease-in-out infinite; }
  @keyframes breathe { 0%,100% { transform: scaleX(.42); opacity: .62; } 50% { transform: scaleX(1); opacity: 1; } }
  @keyframes sweep { 0% { filter: brightness(.75); } 50% { filter: brightness(1.35); } 100% { filter: brightness(.75); } }
  @keyframes pulse { 0%,100% { transform: scaleX(.72); opacity: .72; } 50% { transform: scaleX(1); opacity: 1; } }
</style>
</head>
<body data-visible="false" data-tone="preparing">
  <div class="bar" role="status" aria-live="polite">
    <div class="rail"><div class="fill"></div></div>
    <div class="label" id="label">Preparing mic</div>
  </div>
<script>
  window.AuralisListeningOverlay = {
    setState(payload) {
      document.body.dataset.visible = String(Boolean(payload.visible));
      document.body.dataset.tone = payload.tone || "preparing";
      document.getElementById("label").textContent = payload.label || "Auralis";
    }
  };
</script>
</body>
</html>`;

function listeningOverlayUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(LISTENING_OVERLAY_HTML)}`;
}

function listeningOverlayBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 240;
  const height = 58;
  return {
    height,
    width,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 24),
  };
}

function createListeningOverlayWindow() {
  if (listeningOverlayWindow && !listeningOverlayWindow.isDestroyed()) {
    return listeningOverlayWindow;
  }

  listeningOverlayReady = false;
  listeningOverlayWindow = new BrowserWindow({
    ...listeningOverlayBounds(),
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    focusable: false,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  listeningOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  try {
    listeningOverlayWindow.setAlwaysOnTop(true, "floating");
  } catch {
    listeningOverlayWindow.setAlwaysOnTop(true);
  }
  listeningOverlayWindow.webContents.once("did-finish-load", () => {
    listeningOverlayReady = true;
    updateListeningOverlayRenderer(
      listeningOverlayPendingPayload ??
        listeningOverlayPayloadForCapture(listeningOverlayLastCapture),
    );
  });
  listeningOverlayWindow.on("closed", () => {
    listeningOverlayWindow = null;
    listeningOverlayReady = false;
  });
  listeningOverlayWindow.loadURL(listeningOverlayUrl());

  return listeningOverlayWindow;
}

function destroyListeningOverlay() {
  if (listeningOverlayFlashTimer !== null) {
    clearTimeout(listeningOverlayFlashTimer);
    listeningOverlayFlashTimer = null;
  }
  if (listeningOverlayWindow && !listeningOverlayWindow.isDestroyed()) {
    listeningOverlayWindow.destroy();
  }
  listeningOverlayWindow = null;
  listeningOverlayReady = false;
  listeningOverlayPendingPayload = null;
}

function listeningOverlayPayloadForCapture(payload) {
  switch (payload.status) {
    case "starting":
      return { label: "Preparing mic", tone: "preparing", visible: true };
    case "listening":
    case "recording":
      return { label: "Listening", tone: "recording", visible: true };
    case "transcribing":
      return { label: "Transcribing", tone: "transcribing", visible: true };
    default:
      return { label: "Auralis", tone: "preparing", visible: false };
  }
}

function updateListeningOverlayRenderer(payload) {
  if (!payload.visible && (!listeningOverlayWindow || listeningOverlayWindow.isDestroyed())) {
    listeningOverlayPendingPayload = payload;
    return;
  }

  listeningOverlayPendingPayload = payload;
  const overlay = payload.visible ? createListeningOverlayWindow() : listeningOverlayWindow;
  if (!overlay || overlay.isDestroyed()) {
    return;
  }

  overlay.setBounds(listeningOverlayBounds(), false);
  if (payload.visible) {
    overlay.showInactive();
  } else {
    overlay.hide();
  }

  if (!listeningOverlayReady) {
    return;
  }

  overlay.webContents
    .executeJavaScript(`window.AuralisListeningOverlay?.setState(${JSON.stringify(payload)})`, true)
    .catch(() => undefined);
}

function updateListeningOverlayFromCapture(payload) {
  listeningOverlayLastCapture = {
    muteSystemAudio: Boolean(payload.muteSystemAudio),
    status: payload.status,
  };

  if (listeningOverlayFlashTimer !== null) {
    if (["idle", "unsupported"].includes(payload.status)) {
      return;
    }
    clearTimeout(listeningOverlayFlashTimer);
    listeningOverlayFlashTimer = null;
  }

  updateListeningOverlayRenderer(listeningOverlayPayloadForCapture(listeningOverlayLastCapture));
}

function flashPayloadForMessage(message) {
  const body = typeof message === "string" ? message.trim().slice(0, 96) : "";
  if (/fail|could not|no speech|nothing|error/i.test(body)) {
    return { label: body || "Check mic", tone: "error", visible: true };
  }
  if (/paste|insert/i.test(body)) {
    return { label: "Pasted", tone: "pasted", visible: true };
  }
  if (/copy|clipboard/i.test(body)) {
    return { label: "Copied", tone: "copied", visible: true };
  }
  if (/transcrib/i.test(body)) {
    return { label: "Transcribing", tone: "transcribing", visible: true };
  }
  return { label: body || "Auralis", tone: "recording", visible: true };
}

function flashListeningOverlay(message) {
  updateListeningOverlayRenderer(flashPayloadForMessage(message));

  if (listeningOverlayFlashTimer !== null) {
    clearTimeout(listeningOverlayFlashTimer);
  }

  listeningOverlayFlashTimer = setTimeout(() => {
    listeningOverlayFlashTimer = null;
    updateListeningOverlayRenderer(listeningOverlayPayloadForCapture(listeningOverlayLastCapture));
  }, 1400);
  return true;
}

function isTrustedExternalUrl(url) {
  return url.startsWith("https://") || url.startsWith("mailto:");
}

function isRendererUrl(url) {
  return isRendererUrlForApp(url, rendererUrl());
}

function normalizeDesktopText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("There is no transcript to copy yet.");
  }

  if (text.length > MAX_DESKTOP_TEXT_LENGTH) {
    throw new Error(
      `Transcript is too long to copy from the desktop bridge. Keep it under ${MAX_DESKTOP_TEXT_LENGTH.toLocaleString()} characters.`,
    );
  }

  return text;
}

function successfulDesktopAction(message, extra = {}) {
  return { copied: false, ok: true, pasted: false, message, ...extra };
}

function failedDesktopAction(message, extra = {}) {
  return { copied: false, ok: false, pasted: false, message, ...extra };
}

function isTrustedAuralisSenderFrame(event) {
  if (!event) {
    return false;
  }

  const senderFrame = event.senderFrame;

  return Boolean(
    senderFrame &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      senderFrame === mainWindow.webContents.mainFrame &&
      isRendererUrl(senderFrame.url),
  );
}

function isAuralisIpcEvent(event) {
  return Boolean(
    mainWindow &&
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      isTrustedAuralisSenderFrame(event),
  );
}

function normalizePasteTextPayload(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      pasteTargetToken:
        typeof payload.pasteTargetToken === "string" ? payload.pasteTargetToken : null,
      text: normalizeDesktopText(payload.text),
    };
  }

  return { pasteTargetToken: null, text: normalizeDesktopText(payload) };
}

function powershellExecutable() {
  return process.platform === "win32"
    ? path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      )
    : "powershell.exe";
}

function execFileQuiet(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        timeout: 3000,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || "").trim();
          resolve({ ok: false, detail });
          return;
        }

        resolve({ ok: true, detail: String(stdout || "").trim() });
      },
    );
  });
}

function commandExists(command, args = ["--version"]) {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

function execFileCapture(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        maxBuffer: 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
        ...options,
      },
      (error, stdout, stderr) => {
        resolve({
          error,
          ok: !error,
          stderr: String(stderr || ""),
          stdout: String(stdout || ""),
        });
      },
    );
  });
}

async function getLinuxDefaultAudioMuteState() {
  if (!commandExists("pactl", ["--version"])) {
    return null;
  }

  const defaultSink = await execFileCapture("pactl", ["get-default-sink"], {
    timeout: 1500,
  });
  const deviceKey = defaultSink.ok ? defaultSink.stdout.trim() : "";
  if (!deviceKey) {
    return null;
  }

  const result = await execFileCapture("pactl", ["get-sink-mute", deviceKey], {
    timeout: 1500,
  });
  if (!result.ok) {
    return null;
  }

  const output = result.stdout.toLowerCase();
  if (output.includes("yes")) {
    return { deviceKey, muted: true };
  }
  if (output.includes("no")) {
    return { deviceKey, muted: false };
  }
  return null;
}

async function setLinuxDefaultAudioMute(muted, deviceKey = null) {
  if (!commandExists("pactl", ["--version"])) {
    return false;
  }

  const result = await execFileQuiet("pactl", [
    "set-sink-mute",
    deviceKey || "@DEFAULT_SINK@",
    muted ? "1" : "0",
  ]);
  return result.ok;
}

function windowsAudioEndpointScript(body) {
  return `
Add-Type @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator {}

internal enum EDataFlow { eRender, eCapture, eAll }
internal enum ERole { eConsole, eMultimedia, eCommunications }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
  int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
  int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
  int GetState(out int pdwState);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out uint pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute(bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
"@
$enumerator = [Activator]::CreateInstance([type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E"))
$device = $null
if ($env:AURALIS_AUDIO_DEVICE_ID) {
  [void]([IMMDeviceEnumerator]$enumerator).GetDevice($env:AURALIS_AUDIO_DEVICE_ID, [ref]$device)
} else {
  [void]([IMMDeviceEnumerator]$enumerator).GetDefaultAudioEndpoint([EDataFlow]::eRender, [ERole]::eMultimedia, [ref]$device)
}
$iid = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
$volume = $null
[void]$device.Activate([ref]$iid, 23, [IntPtr]::Zero, [ref]$volume)
${body}
`;
}

async function getWindowsDefaultAudioMuteState() {
  const result = await execFileCapture(
    powershellExecutable(),
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      windowsAudioEndpointScript(
        "$deviceId = $null; [void]$device.GetId([ref]$deviceId); $muted = $false; [void]$volume.GetMute([ref]$muted); Write-Output ($deviceId + '|' + $muted)",
      ),
    ],
    { timeout: 3000 },
  );
  if (!result.ok) {
    return null;
  }

  const output = result.stdout.trim();
  const divider = output.lastIndexOf("|");
  if (divider <= 0) {
    return null;
  }

  const deviceKey = output.slice(0, divider);
  const mutedValue = output.slice(divider + 1);
  return { deviceKey, muted: mutedValue.trim().toLowerCase() === "true" };
}

async function setWindowsDefaultAudioMute(muted, deviceKey = null) {
  const result = await execFileQuiet(
    powershellExecutable(),
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      windowsAudioEndpointScript(
        "$targetMuted = $env:AURALIS_AUDIO_MUTE -eq '1'; [void]$volume.SetMute($targetMuted, [Guid]::Empty)",
      ),
    ],
    {
      env: {
        ...process.env,
        AURALIS_AUDIO_DEVICE_ID: deviceKey || "",
        AURALIS_AUDIO_MUTE: muted ? "1" : "0",
      },
      timeout: 3000,
    },
  );
  return result.ok;
}

async function getDefaultAudioMuteState() {
  if (process.platform === "linux") {
    return getLinuxDefaultAudioMuteState();
  }
  if (process.platform === "win32") {
    return getWindowsDefaultAudioMuteState();
  }
  return null;
}

async function setDefaultAudioMute(muted, deviceKey = null) {
  if (process.platform === "linux") {
    return setLinuxDefaultAudioMute(muted, deviceKey);
  }
  if (process.platform === "win32") {
    return setWindowsDefaultAudioMute(muted, deviceKey);
  }
  return false;
}

function shouldMuteSystemAudioForCapture(payload) {
  return (
    payload &&
    payload.muteSystemAudio === true &&
    ["listening", "recording", "starting"].includes(payload.status)
  );
}

async function applySystemAudioDucking(payload) {
  const shouldMute = shouldMuteSystemAudioForCapture(payload);

  if (shouldMute && audioDuckingActive) {
    return;
  }

  if (!shouldMute && !audioDuckingActive && !audioDuckingChangedSystemMute) {
    return;
  }

  if (shouldMute) {
    const currentMuteState = await getDefaultAudioMuteState();
    const previousMuted = currentMuteState?.muted ?? null;
    const deviceKey = currentMuteState?.deviceKey ?? null;
    audioDuckingPreviousMuted = previousMuted;
    audioDuckingDeviceKey = deviceKey;
    if (previousMuted !== false || !deviceKey) {
      audioDuckingActive = true;
      audioDuckingChangedSystemMute = false;
      return;
    }

    const changedMute = await setDefaultAudioMute(true, deviceKey);
    audioDuckingActive = changedMute;
    audioDuckingChangedSystemMute = changedMute;
    if (!changedMute) {
      audioDuckingPreviousMuted = null;
      audioDuckingDeviceKey = null;
    }
    return;
  }

  const previousMuted = audioDuckingPreviousMuted;
  const deviceKey = audioDuckingDeviceKey;
  const shouldRestore = audioDuckingChangedSystemMute && previousMuted === false && deviceKey;
  audioDuckingPreviousMuted = null;
  audioDuckingDeviceKey = null;
  audioDuckingActive = false;
  audioDuckingChangedSystemMute = false;
  if (shouldRestore) {
    const restored = await setDefaultAudioMute(false, deviceKey);
    if (!restored) {
      audioDuckingPreviousMuted = previousMuted;
      audioDuckingDeviceKey = deviceKey;
      audioDuckingActive = true;
      audioDuckingChangedSystemMute = true;
    }
  }
}

function updateSystemAudioDucking(payload) {
  const requestedShouldMute = shouldMuteSystemAudioForCapture(payload);
  const queuedPayload =
    isRestoringAudioBeforeQuit && requestedShouldMute
      ? { muteSystemAudio: false, status: "idle" }
      : payload;
  audioDuckingDesiredMuted = shouldMuteSystemAudioForCapture(queuedPayload);
  audioDuckingPendingUpdates += 1;
  audioDuckingUpdateQueue = audioDuckingUpdateQueue
    .catch(() => undefined)
    .then(() => applySystemAudioDucking(queuedPayload))
    .finally(() => {
      audioDuckingPendingUpdates = Math.max(0, audioDuckingPendingUpdates - 1);
    });
  return audioDuckingUpdateQueue;
}

function normalizeWhisperModelId(modelId) {
  return DESKTOP_WHISPER_MODELS.has(modelId) ? modelId : "desktop-whisper-base";
}

function whisperModelName(modelId) {
  return DESKTOP_WHISPER_MODEL_NAMES.get(normalizeWhisperModelId(modelId)) || "base";
}

function whisperRuntimeDir() {
  return (
    process.env.AURALIS_WHISPER_RUNTIME_DIR || path.join(app.getPath("userData"), "whisper-runtime")
  );
}

function whisperModelDir() {
  return path.join(whisperRuntimeDir(), "models");
}

function managedWhisperPythonPath() {
  const venvDir = path.join(whisperRuntimeDir(), "venv");
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function pythonCommand(command, args = []) {
  return { args, command };
}

function pythonCommandKey(candidate) {
  return [candidate.command, ...candidate.args].join("\u0000");
}

function describePythonCommand(candidate) {
  return [candidate.command, ...candidate.args].join(" ");
}

function uniquePythonCandidates(candidates) {
  const seen = new Set();
  const unique = [];

  for (const candidate of candidates) {
    if (!candidate.command) {
      continue;
    }

    const key = pythonCommandKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  return unique;
}

function whisperEnv({ offline = true } = {}) {
  const env = {
    ...process.env,
    AURALIS_WHISPER_MODEL_DIR: process.env.AURALIS_WHISPER_MODEL_DIR || whisperModelDir(),
    AURALIS_WHISPER_RUNTIME_DIR: whisperRuntimeDir(),
    AURALIS_WHISPER_USE_UV_CACHE: process.env.AURALIS_WHISPER_USE_UV_CACHE || "0",
  };

  if (offline) {
    env.HF_HUB_OFFLINE = "1";
    env.TRANSFORMERS_OFFLINE = "1";
  } else {
    delete env.HF_HUB_OFFLINE;
    delete env.TRANSFORMERS_OFFLINE;
  }

  return env;
}

function whisperPythonCandidates() {
  const candidates = [
    pythonCommand(managedWhisperPythonPath()),
    process.env.AURALIS_WHISPER_PYTHON ? pythonCommand(process.env.AURALIS_WHISPER_PYTHON) : null,
    pythonCommand("python3.11"),
    pythonCommand("python3"),
    pythonCommand("python"),
  ];

  if (process.platform === "win32") {
    candidates.push(pythonCommand("py", ["-3.11"]), pythonCommand("py", ["-3"]));
  }

  return uniquePythonCandidates(candidates.filter(Boolean));
}

function bootstrapPythonCandidates() {
  const candidates = [
    process.env.AURALIS_WHISPER_PYTHON ? pythonCommand(process.env.AURALIS_WHISPER_PYTHON) : null,
    pythonCommand("python3.11"),
    pythonCommand("python3"),
    pythonCommand("python"),
  ];

  if (process.platform === "win32") {
    candidates.push(pythonCommand("py", ["-3.11"]), pythonCommand("py", ["-3"]));
  }

  return uniquePythonCandidates(candidates.filter(Boolean));
}

function execPythonCapture(candidate, args, options = {}) {
  return execFileCapture(candidate.command, [...candidate.args, ...args], options);
}

function parseWhisperJson(stdout) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

async function findWhisperPython() {
  if (cachedWhisperPython) {
    return cachedWhisperPython;
  }

  for (const candidate of whisperPythonCandidates()) {
    const result = await execPythonCapture(candidate, [whisperHelperPath(), "--probe"], {
      env: whisperEnv(),
      timeout: 8000,
    });
    const parsed = parseWhisperJson(result.stdout);

    if (result.ok && parsed?.ok) {
      cachedWhisperPython = candidate;
      return candidate;
    }
  }

  throw new Error(
    "Local faster-whisper runtime is unavailable. Click Install / repair local engine, install faster-whisper for Python 3.11, or set AURALIS_WHISPER_PYTHON to a working interpreter.",
  );
}

async function findBootstrapPython() {
  for (const candidate of bootstrapPythonCandidates()) {
    const result = await execPythonCapture(candidate, ["--version"], {
      env: process.env,
      timeout: 3000,
    });

    if (result.ok) {
      return candidate;
    }
  }

  throw new Error("No Python interpreter was found to create the local Whisper runtime.");
}

async function getWhisperEngineStatus(modelId = "desktop-whisper-base") {
  const normalizedModelId = normalizeWhisperModelId(modelId);
  const runtimeDir = whisperRuntimeDir();

  if (!fs.existsSync(whisperHelperPath())) {
    return failedDesktopAction("Auralis could not find its local Whisper helper script.", {
      runtimeDir,
      state: "error",
    });
  }

  const diagnostics = [];

  for (const candidate of whisperPythonCandidates()) {
    const result = await execPythonCapture(candidate, [whisperHelperPath(), "--probe"], {
      env: whisperEnv(),
      timeout: 8000,
    });
    const parsed = parseWhisperJson(result.stdout);

    if (result.ok && parsed?.ok) {
      cachedWhisperPython = candidate;
      return successfulDesktopAction("Local Whisper engine is ready.", {
        modelCached: fs.existsSync(
          path.join(whisperModelDir(), whisperModelName(normalizedModelId)),
        ),
        modelId: normalizedModelId,
        python: parsed.python || describePythonCommand(candidate),
        runtimeDir,
        state: "ready",
        version: parsed.version || "unknown",
      });
    }

    diagnostics.push(
      `${describePythonCommand(candidate)}: ${
        parsed?.message || result.stderr.trim() || result.error?.message || "probe failed"
      }`,
    );
  }

  return failedDesktopAction(
    "Local Whisper engine is not installed yet. Click Install / repair local engine to create an app-managed Python runtime with faster-whisper.",
    {
      diagnostics: diagnostics.slice(0, 4),
      modelId: normalizedModelId,
      runtimeDir,
      state: "missing",
    },
  );
}

let whisperBootstrapInProgress = false;

async function managedWhisperPythonUsable(managedPython) {
  const versionResult = await execPythonCapture(managedPython, ["--version"], {
    env: process.env,
    timeout: 5000,
  });

  if (!versionResult.ok) {
    return false;
  }

  const pipResult = await execPythonCapture(managedPython, ["-m", "pip", "--version"], {
    env: process.env,
    timeout: 5000,
  });

  return pipResult.ok;
}

async function recreateManagedWhisperVenv(runtimeDir) {
  const venvDir = path.join(runtimeDir, "venv");
  await fs.promises.rm(venvDir, { force: true, recursive: true });
  const bootstrapPython = await findBootstrapPython();
  const venvResult = await execPythonCapture(bootstrapPython, ["-m", "venv", venvDir], {
    env: process.env,
    maxBuffer: 5 * 1024 * 1024,
    timeout: 120_000,
  });

  if (!venvResult.ok) {
    throw new Error(
      `Could not create the app-managed Python runtime: ${
        venvResult.stderr.trim() ||
        venvResult.stdout.trim() ||
        venvResult.error?.message ||
        "unknown error"
      }`,
    );
  }
}

async function setupWhisperRuntime(modelId = "desktop-whisper-base") {
  const normalizedModelId = normalizeWhisperModelId(modelId);
  const runtimeDir = whisperRuntimeDir();

  if (whisperBootstrapInProgress) {
    return failedDesktopAction("Local Whisper setup is already running.", {
      runtimeDir,
      state: "installing",
    });
  }

  whisperBootstrapInProgress = true;

  try {
    await fs.promises.mkdir(runtimeDir, { recursive: true });
    const managedPython = pythonCommand(managedWhisperPythonPath());

    if (
      !fs.existsSync(managedPython.command) ||
      !(await managedWhisperPythonUsable(managedPython))
    ) {
      await recreateManagedWhisperVenv(runtimeDir);
      cachedWhisperPython = null;
    }

    const setupResult = await execPythonCapture(
      managedPython,
      [
        whisperBootstrapPath(),
        "--runtime-dir",
        runtimeDir,
        "--model-id",
        normalizedModelId,
        "--requirement",
        PINNED_FASTER_WHISPER,
      ],
      {
        env: whisperEnv({ offline: false }),
        maxBuffer: 5 * 1024 * 1024,
        timeout: 900_000,
      },
    );
    const parsed = parseWhisperJson(setupResult.stdout);

    if (!setupResult.ok || !parsed?.ok) {
      return failedDesktopAction(
        parsed?.message || setupResult.stderr.trim() || "Local Whisper setup failed.",
        { runtimeDir, state: "error" },
      );
    }

    cachedWhisperPython = managedPython;
    return successfulDesktopAction(parsed.message || "Local Whisper engine is ready.", {
      modelId: normalizedModelId,
      modelPath: parsed.modelPath,
      python: parsed.python || managedPython.command,
      runtimeDir,
      state: "ready",
      version: parsed.version || "unknown",
    });
  } catch (error) {
    return failedDesktopAction(
      error instanceof Error ? error.message : "Local Whisper setup failed.",
      { runtimeDir, state: "error" },
    );
  } finally {
    whisperBootstrapInProgress = false;
  }
}

function audioExtensionForMimeType(mimeType) {
  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "m4a";
  }

  return "webm";
}

function bufferFromAudioData(audioData) {
  if (Buffer.isBuffer(audioData)) {
    return audioData;
  }

  if (audioData instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(audioData));
  }

  if (ArrayBuffer.isView(audioData)) {
    return Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
  }

  throw new Error("Recorded audio payload was not a byte buffer.");
}

function normalizeTranscriptionRequest(request) {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid local transcription request.");
  }

  const providerId = request.providerId === "openrouter-stt" ? "openrouter-stt" : "desktop-whisper";
  const modelId = request.modelId;
  if (providerId === "desktop-whisper" && !DESKTOP_WHISPER_MODELS.has(modelId)) {
    throw new Error("Unsupported local Whisper model.");
  }
  if (providerId === "openrouter-stt" && !OPENROUTER_MODELS.has(modelId)) {
    throw new Error("Unsupported OpenRouter transcription model.");
  }

  const language = SUPPORTED_LANGUAGES.has(request.language) ? request.language : "en-US";
  const mimeType =
    typeof request.mimeType === "string" ? request.mimeType.slice(0, 80) : "audio/webm";
  const audioBuffer = bufferFromAudioData(request.audioData);

  if (audioBuffer.length === 0) {
    throw new Error("No microphone audio was recorded for local transcription.");
  }

  if (audioBuffer.length > MAX_DESKTOP_AUDIO_BYTES) {
    throw new Error(
      `Recorded audio is too large for local transcription. Keep recordings under ${Math.round(
        MAX_DESKTOP_AUDIO_BYTES / 1024 / 1024,
      )} MB.`,
    );
  }

  return { audioBuffer, language, mimeType, modelId, providerId };
}

function transcriptionTimeoutForModel(modelId) {
  if (modelId === "desktop-whisper-medium") {
    return 360_000;
  }
  if (modelId === "desktop-whisper-small") {
    return 240_000;
  }
  if (modelId === "desktop-whisper-base") {
    return 180_000;
  }
  return 120_000;
}

function whisperWorkerProcessKey(python) {
  return JSON.stringify({
    args: python.args,
    command: python.command,
    helper: whisperHelperPath(),
  });
}

function rejectPendingWhisperWorkerRequests(message) {
  for (const pending of whisperWorkerPending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  whisperWorkerPending.clear();
}

function resetWhisperWorkerState(worker, message) {
  if (whisperWorker !== worker) {
    return;
  }

  whisperWorker = null;
  whisperWorkerBuffer = "";
  whisperWorkerKey = null;
  whisperWorkerStartPromise = null;
  rejectPendingWhisperWorkerRequests(message);
}

function stopWhisperWorker(message = "Local Whisper worker stopped.") {
  const worker = whisperWorker;
  if (!worker) {
    return;
  }

  resetWhisperWorkerState(worker, message);

  if (!worker.killed) {
    worker.kill();
  }
}

function handleWhisperWorkerLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  const id = parsed?.id === undefined ? null : String(parsed.id);
  if (!id) {
    return;
  }

  const pending = whisperWorkerPending.get(id);
  if (!pending) {
    return;
  }

  whisperWorkerPending.delete(id);
  clearTimeout(pending.timeout);
  pending.resolve(parsed);
}

function handleWhisperWorkerOutput(chunk) {
  whisperWorkerBuffer += String(chunk);
  const lines = whisperWorkerBuffer.split(/\r?\n/);
  whisperWorkerBuffer = lines.pop() || "";

  for (const line of lines) {
    if (line.trim()) {
      handleWhisperWorkerLine(line);
    }
  }
}

async function startWhisperWorker(python) {
  if (process.env.AURALIS_WHISPER_DISABLE_WORKER === "1") {
    throw new Error("Local Whisper worker disabled.");
  }

  const workerKey = whisperWorkerProcessKey(python);
  if (whisperWorker && whisperWorkerKey === workerKey && !whisperWorker.killed) {
    return whisperWorker;
  }

  if (whisperWorkerStartPromise) {
    return whisperWorkerStartPromise;
  }

  stopWhisperWorker("Local Whisper worker restarted.");

  whisperWorkerStartPromise = new Promise((resolve, reject) => {
    const worker = spawn(python.command, [...python.args, whisperHelperPath(), "--worker"], {
      env: whisperEnv(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let settled = false;

    const failStartup = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      whisperWorkerStartPromise = null;
      resetWhisperWorkerState(worker, "Local Whisper worker failed to start.");
      reject(error instanceof Error ? error : new Error("Local Whisper worker failed to start."));
    };

    const startupTimeout = setTimeout(() => {
      failStartup(new Error("Local Whisper worker did not start in time."));
      if (!worker.killed) {
        worker.kill();
      }
    }, 8000);

    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", handleWhisperWorkerOutput);
    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });

    worker.once("spawn", () => {
      clearTimeout(startupTimeout);
      settled = true;
      whisperWorker = worker;
      whisperWorkerBuffer = "";
      whisperWorkerKey = workerKey;
      whisperWorkerStartPromise = null;
      resolve(worker);
    });

    worker.once("error", failStartup);
    worker.once("exit", (code, signal) => {
      clearTimeout(startupTimeout);
      const detail = stderr.trim() || `exit ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`;
      resetWhisperWorkerState(worker, `Local Whisper worker exited: ${detail}`);
    });
  });

  return whisperWorkerStartPromise;
}

function transcribeWithWhisperWorker(python, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    startWhisperWorker(python)
      .then((worker) => {
        const id = String(whisperWorkerNextId++);
        const timeout = setTimeout(() => {
          whisperWorkerPending.delete(id);
          stopWhisperWorker("Local Whisper worker timed out.");
          reject(new Error("Local Whisper worker timed out."));
        }, timeoutMs);

        whisperWorkerPending.set(id, { reject, resolve, timeout });
        worker.stdin.write(`${JSON.stringify({ id, ...request })}\n`, (error) => {
          if (!error) {
            return;
          }

          const pending = whisperWorkerPending.get(id);
          if (pending) {
            whisperWorkerPending.delete(id);
            clearTimeout(pending.timeout);
          }
          stopWhisperWorker("Local Whisper worker stdin failed.");
          reject(error);
        });
      })
      .catch(reject);
  });
}

function enqueueWhisperWorkerTranscription(python, request, timeoutMs) {
  const next = whisperWorkerQueue
    .catch(() => undefined)
    .then(() => transcribeWithWhisperWorker(python, request, timeoutMs));
  whisperWorkerQueue = next.catch(() => undefined);
  return next;
}

async function transcribeWithOneShotLocalWhisper(python, request, timeoutMs) {
  const result = await execPythonCapture(
    python,
    [
      whisperHelperPath(),
      "--audio",
      request.audio,
      "--language",
      request.language,
      "--model-id",
      request.modelId,
    ],
    {
      env: whisperEnv(),
      timeout: timeoutMs,
    },
  );
  const parsed = parseWhisperJson(result.stdout);

  if (!parsed) {
    return failedDesktopAction("Local Whisper did not return a readable transcription result.");
  }

  if (!result.ok || !parsed.ok) {
    return failedDesktopAction(parsed.message || "Local Whisper transcription failed.");
  }

  return parsed;
}

function whisperSuccessPayload(parsed) {
  return {
    audioSeconds: parsed.audioSeconds,
    computeType: parsed.computeType,
    cpuThreads: parsed.cpuThreads,
    decodeMs: parsed.decodeMs,
    device: parsed.device,
    language: parsed.language,
    languageProbability: parsed.languageProbability,
    modelCached: parsed.cachedModel,
    modelId: parsed.modelId,
    modelLoadMs: parsed.modelLoadMs,
    text: typeof parsed.text === "string" ? parsed.text : "",
  };
}

async function transcribeWithLocalWhisper(request) {
  const { audioBuffer, language, mimeType, modelId } = normalizeTranscriptionRequest(request);
  const python = await findWhisperPython();
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "auralis-whisper-"));
  const audioPath = path.join(tempDir, `recording.${audioExtensionForMimeType(mimeType)}`);
  const timeoutMs = transcriptionTimeoutForModel(modelId);

  try {
    await fs.promises.writeFile(audioPath, audioBuffer);
    const helperRequest = { audio: audioPath, language, modelId };
    let parsed = null;

    if (process.env.AURALIS_WHISPER_DISABLE_WORKER !== "1") {
      try {
        parsed = await enqueueWhisperWorkerTranscription(python, helperRequest, timeoutMs);
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      parsed = await transcribeWithOneShotLocalWhisper(python, helperRequest, timeoutMs);
    }

    if (!parsed.ok) {
      return failedDesktopAction(parsed.message || "Local Whisper transcription failed.");
    }

    return successfulDesktopAction(
      parsed.message || "Transcribed locally with Whisper.",
      whisperSuccessPayload(parsed),
    );
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true });
  }
}

async function transcribeWithOpenRouter(request) {
  const { audioBuffer, language, mimeType, modelId } = normalizeTranscriptionRequest(request);
  const openRouterModel = OPENROUTER_TRANSCRIPTION_MODELS.get(modelId);
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!openRouterModel) {
    return failedDesktopAction("Unsupported OpenRouter transcription model.");
  }

  if (!apiKey?.trim()) {
    return failedDesktopAction(
      "OpenRouter transcription needs OPENROUTER_API_KEY configured in the Auralis desktop environment.",
    );
  }
  const trimmedApiKey = apiKey.trim();

  const startedAt = Date.now();
  const format = audioExtensionForMimeType(mimeType);
  const requestBody = {
    input_audio: {
      data: audioBuffer.toString("base64"),
      format,
    },
    language: language.slice(0, 2),
    model: openRouterModel,
    temperature: 0,
  };

  let response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${trimmedApiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Auralis",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    return failedDesktopAction(
      "OpenRouter transcription request failed. Check your connection and try again.",
    );
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const message =
      typeof parsed?.error?.message === "string"
        ? parsed.error.message
        : typeof parsed?.message === "string"
          ? parsed.message
          : "OpenRouter transcription failed.";
    return failedDesktopAction(message);
  }

  const text = typeof parsed?.text === "string" ? parsed.text.trim() : "";
  if (!text) {
    return failedDesktopAction("OpenRouter did not return any transcript text.");
  }

  return successfulDesktopAction("Transcribed with OpenRouter.", {
    audioSeconds: typeof parsed?.usage?.seconds === "number" ? parsed.usage.seconds : undefined,
    decodeMs: Date.now() - startedAt,
    generationId: response.headers?.get?.("X-Generation-Id") ?? undefined,
    language,
    modelId,
    openRouterModel,
    providerId: "openrouter-stt",
    text,
    usage: parsed?.usage,
  });
}

function captureLinuxActiveWindow() {
  if (process.env.XDG_SESSION_TYPE === "wayland") {
    return null;
  }

  if (!commandExists("xdotool")) {
    return null;
  }

  try {
    const windowId = execFileSync("xdotool", ["getactivewindow"], {
      encoding: "utf8",
      timeout: 1000,
    }).trim();

    if (!/^\d+$/.test(windowId)) {
      return null;
    }

    return { platform: "linux-x11", windowId };
  } catch {
    return null;
  }
}

function captureWindowsActiveWindow() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AuralisWin32Focus {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
[AuralisWin32Focus]::GetForegroundWindow().ToInt64()
`;

  try {
    const handle = execFileSync(
      powershellExecutable(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: 1500, windowsHide: true },
    ).trim();

    if (!/^\d+$/.test(handle) || handle === "0") {
      return null;
    }

    return { handle, platform: "win32" };
  } catch {
    return null;
  }
}

function captureExternalFocusTarget() {
  if (process.platform === "linux") {
    return captureLinuxActiveWindow();
  }

  if (process.platform === "win32") {
    return captureWindowsActiveWindow();
  }

  return null;
}

function createPasteTarget(focusTarget) {
  if (!focusTarget) {
    return null;
  }

  return {
    ...focusTarget,
    capturedAt: Date.now(),
    pasteTargetToken: randomUUID(),
  };
}

function clearExternalFocusTarget() {
  lastExternalFocusTarget = null;
}

function currentPasteTargetToken() {
  if (!lastExternalFocusTarget) {
    return null;
  }

  if (Date.now() - lastExternalFocusTarget.capturedAt > PASTE_TARGET_TTL_MS) {
    clearExternalFocusTarget();
    return null;
  }

  return lastExternalFocusTarget.pasteTargetToken;
}

function consumePasteTarget(pasteTargetToken) {
  if (!lastExternalFocusTarget || !pasteTargetToken) {
    return null;
  }

  if (Date.now() - lastExternalFocusTarget.capturedAt > PASTE_TARGET_TTL_MS) {
    clearExternalFocusTarget();
    return null;
  }

  if (lastExternalFocusTarget.pasteTargetToken !== pasteTargetToken) {
    return null;
  }

  const pasteTarget = lastExternalFocusTarget;
  clearExternalFocusTarget();
  return pasteTarget;
}

function recordExternalFocusTarget() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isFocused()) {
    return false;
  }

  const focusTarget = createPasteTarget(captureExternalFocusTarget());

  if (focusTarget) {
    lastExternalFocusTarget = focusTarget;
    return true;
  }

  clearExternalFocusTarget();
  return false;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
  return true;
}

function isActiveCaptureState() {
  return ["listening", "recording", "starting"].includes(rendererCaptureState);
}

function desktopShortcutLabel(accelerator) {
  return String(accelerator || TOGGLE_SHORTCUT)
    .replace("CommandOrControl", "Ctrl/⌘")
    .replace("Control", "Ctrl")
    .replace("Super", "Win")
    .replaceAll("+", " + ");
}

function desktopInfo() {
  const toggleShortcut = registeredShortcuts.toggle;
  const copyShortcut = registeredShortcuts.copy;
  const pasteShortcut = registeredShortcuts.paste;

  return {
    appVersion: app.getVersion(),
    copyShortcutLabel: copyShortcut ? desktopShortcutLabel(copyShortcut) : null,
    ok: Boolean(toggleShortcut),
    pasteShortcutLabel: pasteShortcut ? desktopShortcutLabel(pasteShortcut) : null,
    platform: process.platform,
    shortcutLabel:
      holdToTalkWarning === null
        ? "Hold Ctrl + Win to dictate from any app"
        : toggleShortcut
          ? `${desktopShortcutLabel(toggleShortcut)} toggles from any app`
          : "No global toggle shortcut registered",
    shortcutWarnings: [...shortcutWarnings, holdToTalkWarning].filter(Boolean),
    toggleShortcutLabel: toggleShortcut ? desktopShortcutLabel(toggleShortcut) : null,
  };
}

async function installLatestUpdate() {
  if (!app.isPackaged && process.env.AURALIS_ALLOW_DEV_UPDATES !== "1") {
    return failedDesktopAction(
      "Automatic updates are available from the installed Auralis app after a release is published.",
    );
  }

  if (updateInstallInProgress) {
    return failedDesktopAction("An Auralis update is already in progress.");
  }

  updateInstallInProgress = true;

  try {
    const updateCheck = await autoUpdater.checkForUpdates();
    if (!updateCheck?.downloadPromise) {
      return successfulDesktopAction("Auralis is already up to date.");
    }

    await updateCheck.downloadPromise;
    autoUpdater.quitAndInstall(false, true);
    return successfulDesktopAction("Update downloaded. Restarting Auralis to install.");
  } catch {
    return failedDesktopAction(
      "Could not install the latest Auralis update. Check your connection and try again.",
    );
  } finally {
    updateInstallInProgress = false;
  }
}

function notifyDesktop(message) {
  const body = typeof message === "string" ? message.trim().slice(0, 240) : "";

  if (!body || !Notification.isSupported()) {
    return false;
  }

  try {
    new Notification({ body, title: "Auralis" }).show();
    return true;
  } catch {
    return false;
  }
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function restoreSystemAudioAfterRendererExit() {
  rendererCaptureState = "idle";
  updateListeningOverlayFromCapture({ muteSystemAudio: false, status: "idle" });
  void updateSystemAudioDucking({ muteSystemAudio: false, status: "idle" }).catch(() => undefined);
}

async function assertRendererHealthyForSmoke() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Auralis smoke check failed: main window was destroyed before load.");
  }

  const rendererHealthy = await mainWindow.webContents.executeJavaScript(
    "Boolean(document.querySelector('[data-action=\"start\"]') && document.querySelector('[data-field=\"transcript\"]'))",
  );

  if (!rendererHealthy) {
    throw new Error("Auralis smoke check failed: renderer controls did not mount.");
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 920,
    minHeight: 680,
    title: "Auralis",
    backgroundColor: "#0f172a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.loadURL(rendererUrl());

  if (process.env.AURALIS_SMOKE_QUIT_AFTER_READY === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      assertRendererHealthyForSmoke()
        .then(() => {
          setTimeout(() => app.quit(), 250);
        })
        .catch((error) => {
          console.error(error instanceof Error ? error.message : error);
          app.exit(1);
        });
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isRendererUrl(url)) {
      return;
    }

    event.preventDefault();

    if (isTrustedExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("render-process-gone", restoreSystemAudioAfterRendererExit);

  mainWindow.on("closed", () => {
    restoreSystemAudioAfterRendererExit();
    destroyListeningOverlay();
    mainWindow = null;
  });
}

function registerShortcut(role, accelerators, callback) {
  for (const accelerator of accelerators) {
    if (globalShortcut.register(accelerator, callback)) {
      registeredShortcuts[role] = accelerator;
      if (accelerator !== accelerators[0]) {
        shortcutWarnings.push(
          `${desktopShortcutLabel(accelerators[0])} was unavailable, so Auralis registered ${desktopShortcutLabel(accelerator)} instead.`,
        );
      }
      return true;
    }
  }

  registeredShortcuts[role] = null;
  shortcutWarnings.push(
    `Auralis could not register the ${role} global shortcut. Use the app buttons until another app releases that key combination.`,
  );
  return false;
}

function handleToggleShortcut() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (rendererCaptureState === "transcribing") {
    notifyDesktop(
      "Auralis is already transcribing. It will copy or insert the transcript when finished.",
    );
    return;
  }

  const shouldStart = !isActiveCaptureState();
  const hasExternalFocusTarget = shouldStart ? recordExternalFocusTarget() : false;
  const pasteTargetToken = shouldStart ? currentPasteTargetToken() : null;

  sendToRenderer("auralis:desktop-toggle-dictation", {
    autoPaste: shouldStart && hasExternalFocusTarget,
    hasExternalFocusTarget: hasExternalFocusTarget || Boolean(lastExternalFocusTarget),
    keepFocus: true,
    pasteTargetToken,
    startedFromShortcut: true,
  });
}

function handleCopyShortcut() {
  sendToRenderer("auralis:desktop-copy-transcript");
}

function handlePasteShortcut() {
  if (!isActiveCaptureState() && rendererCaptureState !== "transcribing") {
    recordExternalFocusTarget();
  }

  sendToRenderer("auralis:desktop-paste-transcript", {
    pasteTargetToken: currentPasteTargetToken(),
    startedFromShortcut: true,
  });
}

function startHoldToTalk() {
  if (holdToTalkController) {
    return true;
  }

  if (process.env.AURALIS_DISABLE_HOLD_TO_TALK === "1") {
    holdToTalkWarning =
      "Ctrl + Win hold-to-dictate is disabled. Use Ctrl + Alt + Space to toggle dictation.";
    return false;
  }

  if (process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland") {
    holdToTalkWarning =
      "Ctrl + Win hold-to-dictate is unavailable on Wayland. Use Ctrl + Alt + Space to toggle dictation.";
    return false;
  }

  try {
    const { hook, keys } = createUiohookBackend();
    holdToTalkController = createHoldToTalkController({
      getRendererCaptureState: () => rendererCaptureState,
      hook,
      keys,
      notify: notifyDesktop,
      onStart: () => {
        const hasExternalFocusTarget = recordExternalFocusTarget();
        const pasteTargetToken = currentPasteTargetToken();
        sendToRenderer("auralis:desktop-toggle-dictation", {
          action: "start",
          autoPaste: hasExternalFocusTarget,
          hasExternalFocusTarget: hasExternalFocusTarget || Boolean(lastExternalFocusTarget),
          holdToTalk: true,
          keepFocus: true,
          pasteTargetToken,
          startedFromShortcut: true,
        });
      },
      onStop: () => {
        sendToRenderer("auralis:desktop-toggle-dictation", {
          action: "stop",
          holdToTalk: true,
          keepFocus: true,
          startedFromShortcut: true,
        });
      },
    });
    holdToTalkController.start();
    holdToTalkWarning = null;
    return true;
  } catch {
    holdToTalkController = null;
    holdToTalkWarning =
      "Ctrl + Win hold-to-dictate is unavailable. Use Ctrl + Alt + Space to toggle dictation.";
    return false;
  }
}

function stopHoldToTalk() {
  holdToTalkController?.stop();
  holdToTalkController = null;
}

function registerShortcuts() {
  registeredShortcuts = { copy: null, paste: null, toggle: null };
  shortcutWarnings = [];
  registerShortcut("toggle", TOGGLE_SHORTCUT_FALLBACKS, handleToggleShortcut);
  registerShortcut("copy", COPY_SHORTCUT_FALLBACKS, handleCopyShortcut);
  registerShortcut("paste", PASTE_SHORTCUT_FALLBACKS, handlePasteShortcut);
}

function installAppMenu() {
  const template = [
    {
      label: "Auralis",
      submenu: [
        {
          accelerator: registeredShortcuts.toggle || TOGGLE_SHORTCUT,
          click: () => sendToRenderer("auralis:desktop-toggle-dictation"),
          label: "Toggle Dictation",
        },
        {
          accelerator: registeredShortcuts.copy || COPY_SHORTCUT,
          click: () => sendToRenderer("auralis:desktop-copy-transcript"),
          label: "Copy Transcript",
        },
        {
          accelerator: registeredShortcuts.paste || PASTE_SHORTCUT,
          click: () => sendToRenderer("auralis:desktop-paste-transcript"),
          label: "Paste Transcript to Previous App",
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function configureSessionPermissions() {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      isAuralisMediaPermissionCheck({
        appUrl: rendererUrl(),
        details,
        mainWebContents: mainWindow?.webContents,
        permission,
        requestingOrigin,
        webContents,
      }),
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        isAuralisMediaPermissionRequest({
          appUrl: rendererUrl(),
          details,
          mainWebContents: mainWindow?.webContents,
          permission,
          webContents,
        }),
      );
    },
  );
}

async function pasteWithLinuxXdotool(pasteTarget) {
  if (process.env.XDG_SESSION_TYPE === "wayland") {
    return successfulDesktopAction(
      "Transcript copied to the clipboard. Automatic paste is blocked on most Wayland desktops, so press Ctrl+V in the target app.",
      { copied: true, pasted: false },
    );
  }

  if (!commandExists("xdotool")) {
    return successfulDesktopAction(
      "Transcript copied to the clipboard. Install xdotool on X11 Linux to enable one-step paste into the previous app.",
      { copied: true, pasted: false },
    );
  }

  if (pasteTarget?.platform !== "linux-x11") {
    return successfulDesktopAction(
      "Transcript copied to the clipboard. Start dictation with the global shortcut from your target app to enable automatic paste.",
      { copied: true, pasted: false },
    );
  }

  const activate = await execFileQuiet("xdotool", [
    "windowactivate",
    "--sync",
    pasteTarget.windowId,
  ]);

  if (!activate.ok) {
    return successfulDesktopAction(
      "Transcript copied to the clipboard, but Auralis could not refocus the previous app. Press Ctrl+V there manually.",
      { copied: true, pasted: false },
    );
  }

  const paste = await execFileQuiet("xdotool", ["key", "--clearmodifiers", "ctrl+v"]);

  if (!paste.ok) {
    return successfulDesktopAction(
      "Transcript copied to the clipboard, but automatic paste failed. Press Ctrl+V in the target app.",
      { copied: true, pasted: false },
    );
  }

  return successfulDesktopAction("Transcript pasted into the previous app.", {
    copied: true,
    pasted: true,
  });
}

async function pasteWithWindowsPowerShell(pasteTarget) {
  if (pasteTarget?.platform !== "win32") {
    return successfulDesktopAction(
      "Transcript copied to the clipboard. Start dictation with the global shortcut from your target app to enable automatic paste.",
      { copied: true, pasted: false },
    );
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AuralisWin32Paste {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@
$hwnd = [IntPtr]::new([Int64]::Parse($env:AURALIS_TARGET_HWND))
if ([AuralisWin32Paste]::IsIconic($hwnd)) {
  [void][AuralisWin32Paste]::ShowWindowAsync($hwnd, 9)
}
[void][AuralisWin32Paste]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 120
if ([AuralisWin32Paste]::GetForegroundWindow() -ne $hwnd) {
  exit 2
}
[System.Windows.Forms.SendKeys]::SendWait("^v")
`;

  const paste = await execFileQuiet(
    powershellExecutable(),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      env: {
        ...process.env,
        AURALIS_TARGET_HWND: pasteTarget.handle,
      },
      timeout: 3000,
    },
  );

  if (!paste.ok) {
    return successfulDesktopAction(
      "Transcript copied to the clipboard, but automatic Windows paste failed. Press Ctrl+V in the target app.",
      { copied: true, pasted: false },
    );
  }

  return successfulDesktopAction("Transcript pasted into the previous app.", {
    copied: true,
    pasted: true,
  });
}

async function pasteClipboardToPreviousApp(pasteTargetToken) {
  const pasteTarget = consumePasteTarget(pasteTargetToken);

  if (!pasteTarget) {
    return successfulDesktopAction(
      "Transcript copied to the clipboard. Start dictation with the global shortcut from your target app to enable automatic paste.",
      { copied: true, pasted: false, reason: "stale-target" },
    );
  }

  let result;

  if (process.platform === "linux") {
    result = await pasteWithLinuxXdotool(pasteTarget);
  } else if (process.platform === "win32") {
    result = await pasteWithWindowsPowerShell(pasteTarget);
  } else {
    result = successfulDesktopAction(
      "Transcript copied to the clipboard. Automatic paste is currently supported on Windows and Linux/X11 only.",
      { copied: true, pasted: false },
    );
  }

  clearExternalFocusTarget();

  return result;
}

ipcMain.handle("auralis:desktop-info", (event) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Desktop info is only available to Auralis.");
  }

  return desktopInfo();
});

ipcMain.handle("auralis:desktop-install-update", async (event) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Auralis updates are only available to Auralis.");
  }

  return installLatestUpdate();
});

ipcMain.on("auralis:desktop-capture-state", (event, payload) => {
  if (!isAuralisIpcEvent(event) || !payload || typeof payload !== "object") {
    return;
  }

  if (
    ["idle", "listening", "recording", "starting", "transcribing", "unsupported"].includes(
      payload.status,
    )
  ) {
    rendererCaptureState = payload.status;
    updateListeningOverlayFromCapture(payload);
    void updateSystemAudioDucking(payload).catch(() => undefined);
  }
});

ipcMain.handle("auralis:desktop-notify", (event, message) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Desktop notifications are only available to Auralis.");
  }

  flashListeningOverlay(message);
  return successfulDesktopAction("Notification sent.");
});

ipcMain.handle("auralis:desktop-copy-text", (event, text) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Desktop clipboard access is only available to Auralis.");
  }

  try {
    clipboard.writeText(normalizeDesktopText(text));
    return successfulDesktopAction("Transcript copied to the clipboard.", { copied: true });
  } catch (error) {
    return failedDesktopAction(error instanceof Error ? error.message : "Copy failed.");
  }
});

ipcMain.handle("auralis:desktop-paste-text", async (event, payload) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Desktop paste is only available to Auralis.", { pasted: false });
  }

  try {
    const { pasteTargetToken, text } = normalizePasteTextPayload(payload);
    clipboard.writeText(normalizeDesktopText(text));
    return await pasteClipboardToPreviousApp(pasteTargetToken);
  } catch (error) {
    return failedDesktopAction(error instanceof Error ? error.message : "Paste failed.", {
      copied: false,
      pasted: false,
    });
  }
});

ipcMain.handle("auralis:desktop-whisper-status", async (event, modelId) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Local Whisper status is only available to Auralis.", {
      state: "error",
    });
  }

  try {
    return await getWhisperEngineStatus(modelId);
  } catch (error) {
    return failedDesktopAction(
      error instanceof Error ? error.message : "Local Whisper status check failed.",
      { state: "error" },
    );
  }
});

ipcMain.handle("auralis:desktop-whisper-bootstrap", async (event, modelId) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Local Whisper setup is only available to Auralis.", {
      state: "error",
    });
  }

  try {
    return await setupWhisperRuntime(modelId);
  } catch (error) {
    return failedDesktopAction(
      error instanceof Error ? error.message : "Local Whisper setup failed.",
      { state: "error" },
    );
  }
});

ipcMain.handle("auralis:desktop-transcribe-audio", async (event, request) => {
  if (!isAuralisIpcEvent(event)) {
    return failedDesktopAction("Desktop transcription is only available to Auralis.");
  }

  try {
    return request?.providerId === "openrouter-stt"
      ? await transcribeWithOpenRouter(request)
      : await transcribeWithLocalWhisper(request);
  } catch (error) {
    return failedDesktopAction(
      error instanceof Error ? error.message : "Desktop transcription failed.",
    );
  }
});

app.whenReady().then(() => {
  configureSessionPermissions();
  createMainWindow();
  startHoldToTalk();
  registerShortcuts();
  installAppMenu();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    } else {
      focusMainWindow();
    }
  });
});

function finishQuitAfterAudioRestore() {
  if (audioDuckingPendingUpdates > 0) {
    audioDuckingUpdateQueue.catch(() => undefined).then(finishQuitAfterAudioRestore);
    return;
  }

  if (audioDuckingChangedSystemMute) {
    isRestoringAudioBeforeQuit = false;
    notifyDesktop(
      "Auralis could not restore system audio automatically. Please unmute system audio manually, then quit again.",
    );
    return;
  }

  if (audioDuckingDesiredMuted || audioDuckingActive) {
    updateSystemAudioDucking({ muteSystemAudio: false, status: "idle" })
      .catch(() => undefined)
      .then(finishQuitAfterAudioRestore);
    return;
  }

  allowQuitAfterAudioRestore = true;
  app.quit();
}

app.on("before-quit", (event) => {
  if (allowQuitAfterAudioRestore) {
    allowQuitAfterAudioRestore = false;
    return;
  }

  if (
    !audioDuckingDesiredMuted &&
    !audioDuckingActive &&
    !audioDuckingChangedSystemMute &&
    audioDuckingPendingUpdates === 0
  ) {
    return;
  }

  event.preventDefault();
  if (isRestoringAudioBeforeQuit) {
    return;
  }

  isRestoringAudioBeforeQuit = true;
  updateSystemAudioDucking({ muteSystemAudio: false, status: "idle" })
    .catch(() => undefined)
    .then(finishQuitAfterAudioRestore);
});

app.on("will-quit", () => {
  stopHoldToTalk();
  destroyListeningOverlay();
  stopWhisperWorker("Auralis is quitting.");
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
