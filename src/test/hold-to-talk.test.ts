import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

const { createHoldToTalkController } = require("../../electron/hold-to-talk.cjs") as {
  createHoldToTalkController: (options: HoldToTalkOptions) => HoldToTalkController;
};

interface HoldToTalkController {
  reset: () => void;
  start: () => boolean;
  stop: () => void;
}

interface HoldToTalkOptions {
  getRendererCaptureState: () => string;
  hook: EventEmitter & { start: () => void; stop: () => void };
  keys: typeof keys;
  notify: (message: string) => void;
  onStart: () => void;
  onStop: () => void;
}

class FakeHook extends EventEmitter {
  start = vi.fn();
  stop = vi.fn();
}

const keys = {
  ctrl: 29,
  ctrlRight: 3613,
  meta: 3675,
  metaRight: 3676,
};

function createScenario(rendererState = "idle"): {
  controller: HoldToTalkController;
  hook: FakeHook;
  notify: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  setRendererState: (state: string) => void;
} {
  const hook = new FakeHook();
  const notify = vi.fn();
  const sendCommand = vi.fn();
  let currentRendererState = rendererState;
  const controller = createHoldToTalkController({
    getRendererCaptureState: () => currentRendererState,
    hook,
    keys,
    notify,
    onStart: () => sendCommand({ action: "start", holdToTalk: true }),
    onStop: () => sendCommand({ action: "stop", holdToTalk: true }),
  });

  return {
    controller,
    hook,
    notify,
    sendCommand,
    setRendererState: (state: string) => {
      currentRendererState = state;
    },
  };
}

function keydown(hook: FakeHook, keycode: number): void {
  hook.emit("keydown", { keycode });
}

function keyup(hook: FakeHook, keycode: number): void {
  hook.emit("keyup", { keycode });
}

describe("hold-to-talk controller", () => {
  it("starts once when Ctrl then Win are both down", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.meta);
    keydown(hook, keys.meta);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith({ action: "start", holdToTalk: true });
  });

  it("starts once when Win then Ctrl are both down", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.metaRight);
    keydown(hook, keys.ctrlRight);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith({ action: "start", holdToTalk: true });
  });

  it("stops exactly once when either held key is released", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.meta);
    keyup(hook, keys.ctrl);
    keyup(hook, keys.meta);

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { action: "start", holdToTalk: true });
    expect(sendCommand).toHaveBeenNthCalledWith(2, { action: "stop", holdToTalk: true });
  });

  it("keeps recording when one side of a duplicated modifier pair is released", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.ctrlRight);
    keydown(hook, keys.meta);
    keyup(hook, keys.ctrl);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { action: "start", holdToTalk: true });

    keyup(hook, keys.ctrlRight);

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(2, { action: "stop", holdToTalk: true });
  });

  it("does not stop when release happens before a hold session starts", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keyup(hook, keys.ctrl);

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not start while the renderer is transcribing", () => {
    const { controller, hook, notify, sendCommand } = createScenario("transcribing");

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.meta);

    expect(sendCommand).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Auralis is already transcribing. Release Ctrl + Win and wait for delivery.",
    );
  });

  it("sends no raw key payload to the renderer command callbacks", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    hook.emit("keydown", { ctrlKey: true, keycode: keys.ctrl, metaKey: false });
    hook.emit("keydown", { ctrlKey: true, keycode: keys.meta, metaKey: true });
    hook.emit("keyup", { ctrlKey: true, keycode: keys.meta, metaKey: false });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { action: "start", holdToTalk: true });
    expect(sendCommand).toHaveBeenNthCalledWith(2, { action: "stop", holdToTalk: true });
    for (const [payload] of sendCommand.mock.calls) {
      expect(payload).not.toHaveProperty("keycode");
      expect(payload).not.toHaveProperty("ctrlKey");
      expect(payload).not.toHaveProperty("metaKey");
    }
  });

  it("resets active holds on hook error and avoids duplicate stops", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.meta);
    hook.emit("error", new Error("native hook failed"));
    keyup(hook, keys.ctrl);
    keyup(hook, keys.meta);

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { action: "start", holdToTalk: true });
    expect(sendCommand).toHaveBeenNthCalledWith(2, { action: "stop", holdToTalk: true });
  });

  it("sends stop when the controller is stopped during an active hold", () => {
    const { controller, hook, sendCommand } = createScenario();

    controller.start();
    keydown(hook, keys.ctrl);
    keydown(hook, keys.meta);
    controller.stop();
    keyup(hook, keys.ctrl);

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, { action: "start", holdToTalk: true });
    expect(sendCommand).toHaveBeenNthCalledWith(2, { action: "stop", holdToTalk: true });
    expect(hook.stop).toHaveBeenCalledTimes(1);
  });
});
