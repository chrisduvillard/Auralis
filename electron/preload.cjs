const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("auralisDesktop", {
  copyText: (text) => ipcRenderer.invoke("auralis:desktop-copy-text", text),
  getInfo: () => ipcRenderer.invoke("auralis:desktop-info"),
  notify: (message) => ipcRenderer.invoke("auralis:desktop-notify", message),
  installUpdate: () => ipcRenderer.invoke("auralis:desktop-install-update"),
  pasteText: (text, pasteTargetToken) =>
    ipcRenderer.invoke("auralis:desktop-paste-text", { pasteTargetToken, text }),
  platform: process.platform,
  setCaptureState: (payload) => ipcRenderer.send("auralis:desktop-capture-state", payload),
  setupWhisperRuntime: (modelId) =>
    ipcRenderer.invoke("auralis:desktop-whisper-bootstrap", modelId),
  shortcutLabel: "Hold Ctrl + Win to dictate from any app",
  toggleShortcutLabel: "Ctrl + Alt + Space",
  transcribeAudio: (request) => ipcRenderer.invoke("auralis:desktop-transcribe-audio", request),
  whisperStatus: (modelId) => ipcRenderer.invoke("auralis:desktop-whisper-status", modelId),
});

ipcRenderer.on("auralis:desktop-toggle-dictation", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("auralis:desktop-toggle-dictation", { detail }));
});

ipcRenderer.on("auralis:desktop-copy-transcript", () => {
  window.dispatchEvent(new CustomEvent("auralis:desktop-copy-transcript"));
});

ipcRenderer.on("auralis:desktop-paste-transcript", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("auralis:desktop-paste-transcript", { detail }));
});
