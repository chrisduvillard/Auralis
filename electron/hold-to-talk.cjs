const DEFAULT_MAX_HOLD_MS = 5 * 60 * 1000;
const IDLE_RENDERER_STATE = "idle";

function isCtrlKey(keycode, keys) {
  return keycode === keys.ctrl || keycode === keys.ctrlRight;
}

function isMetaKey(keycode, keys) {
  return keycode === keys.meta || keycode === keys.metaRight;
}

function removeHookListener(hook, eventName, handler) {
  if (typeof hook.off === "function") {
    hook.off(eventName, handler);
    return;
  }

  if (typeof hook.removeListener === "function") {
    hook.removeListener(eventName, handler);
  }
}

function createHoldToTalkController(options) {
  const { getRendererCaptureState, hook, keys, notify, onStart, onStop } = options;
  const maxHoldMs = Number.isFinite(options.maxHoldMs) ? options.maxHoldMs : DEFAULT_MAX_HOLD_MS;

  let active = false;
  let blockedUntilRelease = false;
  const ctrlDownKeys = new Set();
  let holdTimer = null;
  const metaDownKeys = new Set();
  let running = false;

  function clearHoldTimer() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function resetState() {
    ctrlDownKeys.clear();
    metaDownKeys.clear();
    blockedUntilRelease = false;
    clearHoldTimer();
  }

  function sendStopIfActive() {
    if (!active) {
      return;
    }

    active = false;
    clearHoldTimer();
    onStop();
  }

  function reset() {
    active = false;
    resetState();
  }

  function bothKeysDown() {
    return ctrlDownKeys.size > 0 && metaDownKeys.size > 0;
  }

  function rendererIsIdle() {
    try {
      return getRendererCaptureState() === IDLE_RENDERER_STATE;
    } catch {
      return false;
    }
  }

  function startWatchdog() {
    clearHoldTimer();
    if (maxHoldMs <= 0) {
      return;
    }

    holdTimer = setTimeout(() => {
      notify(
        "Ctrl + Win was held too long, so Auralis stopped recording to avoid a stuck session.",
      );
      resetState();
      sendStopIfActive();
    }, maxHoldMs);
    if (typeof holdTimer.unref === "function") {
      holdTimer.unref();
    }
  }

  function maybeStart() {
    if (!bothKeysDown() || active || blockedUntilRelease) {
      return;
    }

    if (!rendererIsIdle()) {
      blockedUntilRelease = true;
      notify("Auralis is already transcribing. Release Ctrl + Win and wait for delivery.");
      return;
    }

    active = true;
    startWatchdog();
    onStart();
  }

  function maybeStop() {
    if (bothKeysDown()) {
      return;
    }

    blockedUntilRelease = false;
    sendStopIfActive();
  }

  function handleKeyDown(event) {
    if (isCtrlKey(event?.keycode, keys)) {
      ctrlDownKeys.add(event.keycode);
    }
    if (isMetaKey(event?.keycode, keys)) {
      metaDownKeys.add(event.keycode);
    }
    maybeStart();
  }

  function handleKeyUp(event) {
    if (isCtrlKey(event?.keycode, keys)) {
      ctrlDownKeys.delete(event.keycode);
    }
    if (isMetaKey(event?.keycode, keys)) {
      metaDownKeys.delete(event.keycode);
    }
    maybeStop();
  }

  function handleHookError() {
    resetState();
    sendStopIfActive();
  }

  function start() {
    if (running) {
      return true;
    }

    hook.on("keydown", handleKeyDown);
    hook.on("keyup", handleKeyUp);
    hook.on("error", handleHookError);

    try {
      hook.start();
      running = true;
      return true;
    } catch (error) {
      removeHookListener(hook, "keydown", handleKeyDown);
      removeHookListener(hook, "keyup", handleKeyUp);
      removeHookListener(hook, "error", handleHookError);
      reset();
      throw error;
    }
  }

  function stop() {
    if (!running) {
      reset();
      return;
    }

    removeHookListener(hook, "keydown", handleKeyDown);
    removeHookListener(hook, "keyup", handleKeyUp);
    removeHookListener(hook, "error", handleHookError);
    sendStopIfActive();
    hook.stop();
    running = false;
    resetState();
  }

  return { reset, start, stop };
}

function createUiohookBackend() {
  const { uIOhook, UiohookKey } = require("uiohook-napi");

  return {
    hook: uIOhook,
    keys: {
      ctrl: UiohookKey.Ctrl,
      ctrlRight: UiohookKey.CtrlRight,
      meta: UiohookKey.Meta,
      metaRight: UiohookKey.MetaRight,
    },
  };
}

module.exports = { createHoldToTalkController, createUiohookBackend };
