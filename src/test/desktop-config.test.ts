import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const require = createRequire(import.meta.url);

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), "utf-8");
}

describe("desktop app packaging config", () => {
  it("exposes first-class desktop npm commands", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      build?: {
        asarUnpack?: string[];
        directories?: { output?: string };
        icon?: string;
        nsis?: Record<string, unknown>;
        productName?: string;
        publish?: Array<{ owner?: string; provider?: string; repo?: string }>;
        toolsets?: { winCodeSign?: string };
        win?: { target?: Array<{ target?: string }> };
      };
      engines?: { node?: string; npm?: string };
      main?: string;
      overrides?: Record<string, unknown>;
      scripts?: Record<string, string>;
      version?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.version).toBe("0.1.1");
    expect(packageJson.main).toBe("electron/main.cjs");
    expect(packageJson.engines?.node).toBe(">=22.12.0");
    expect(packageJson.engines?.npm).toBe(">=10");
    expect(packageJson.scripts?.desktop).toBe("npm run build && node scripts/run-electron.cjs .");
    expect(packageJson.scripts?.["desktop:dev"]).toBe("vite --host 127.0.0.1");
    expect(packageJson.scripts?.["desktop:check"]).toContain("AURALIS_ALLOW_NO_SANDBOX=1");
    expect(packageJson.scripts?.["desktop:check"]).toContain(
      "node scripts/run-electron.cjs --version",
    );
    expect(packageJson.scripts?.["desktop:smoke"]).toContain("AURALIS_SMOKE_QUIT_AFTER_READY=1");
    expect(packageJson.scripts?.["desktop:smoke"]).toContain("AURALIS_ALLOW_NO_SANDBOX=1");
    expect(packageJson.scripts?.["stt:proof"]).toBe("node scripts/stt-proof-harness.cjs");
    expect(packageJson.scripts?.["package:win"]).toContain("node scripts/package-windows.cjs nsis");
    expect(packageJson.scripts?.["package:win:dir"]).toContain(
      "node scripts/package-windows.cjs dir",
    );
    expect(packageJson.scripts?.lint).toContain("electron");
    expect(packageJson.scripts?.lint).toContain("scripts");
    expect(packageJson.scripts?.lint).toContain("vendor");
    expect(packageJson.devDependencies?.electron).toBeDefined();
    expect(packageJson.devDependencies?.["electron-builder"]).toBeDefined();
    expect(packageJson.build?.productName).toBe("Auralis");
    expect(packageJson.build?.icon).toBe("build/icon.png");
    expect(packageJson.build?.directories?.output).toBe("release");
    expect(packageJson.build?.toolsets?.winCodeSign).toBe("1.1.0");
    expect(packageJson.build?.asarUnpack).toContain("scripts/transcribe-local-whisper.py");
    expect(packageJson.build?.asarUnpack).toContain("scripts/bootstrap-local-whisper.py");
    expect(packageJson.build?.win?.target?.[0]?.target).toBe("nsis");
    expect(packageJson.build?.nsis?.oneClick).toBe(false);
    expect(packageJson.overrides?.["@electron/asar"]).toBe("4.2.0");
    expect(
      (packageJson.overrides?.electron as Record<string, string> | undefined)?.["@electron/get"],
    ).toBe("3.1.0");
    expect(packageJson.overrides?.["global-agent"]).toBe("4.1.3");
    expect(packageJson.overrides?.rimraf).toBe("$rimraf");
    expect(packageJson.overrides?.tmp).toBe("^0.2.6");
    expect(packageJson.devDependencies?.rimraf).toBe("file:vendor/rimraf-compat");
    expect(packageJson.dependencies?.["electron-updater"]).toBeDefined();
    expect(packageJson.build?.publish?.[0]).toEqual({
      owner: "chrisduvillard",
      provider: "github",
      repo: "auralis-public",
    });
  });

  it("emits a secret-safe STT proof matrix for local and OpenRouter models", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const harnessPath = join(projectRoot, "scripts/stt-proof-harness.cjs");
    const harness = readProjectFile("scripts/stt-proof-harness.cjs");

    expect(packageJson.scripts?.["stt:proof"]).toBe("node scripts/stt-proof-harness.cjs");
    expect(harness).toContain("OPENROUTER_API_KEY");
    expect(harness).toContain("redactSecret");
    expect(harness).toContain("desktop-whisper-base");
    expect(harness).toContain("openrouter-whisper-large-v3-turbo");
    expect(harness).toContain("openrouter-gpt-4o-mini-transcribe");

    const result = spawnSync(
      process.execPath,
      [harnessPath, "--dry-run", "--format", "json", "--expected", "hello world"],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        env: { ...process.env, OPENROUTER_API_KEY: "sk-test-secret-value" },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("sk-test-secret-value");
    expect(result.stdout).not.toContain("sk-test-secret-value");

    const payload = JSON.parse(result.stdout) as {
      checks: Array<{
        id: string;
        modelId: string;
        providerId: string;
        status: string;
      }>;
      summary: { skipped: number };
    };

    expect(payload.summary.skipped).toBeGreaterThan(0);
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        id: "desktop-whisper-base",
        modelId: "desktop-whisper-base",
        providerId: "desktop-whisper",
        status: "skipped",
      }),
    );
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        id: "openrouter-whisper-large-v3-turbo",
        modelId: "openrouter-whisper-large-v3-turbo",
        providerId: "openrouter-stt",
        status: "skipped",
      }),
    );
  });

  it("prints an operator-readable STT proof matrix in Markdown", () => {
    const result = spawnSync(
      process.execPath,
      [join(projectRoot, "scripts/stt-proof-harness.cjs"), "--dry-run", "--format", "markdown"],
      {
        cwd: projectRoot,
        encoding: "utf-8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Auralis STT proof matrix");
    expect(result.stdout).toContain("| Provider | Model | Status | Evidence |");
    expect(result.stdout).toContain("Desktop local Whisper");
    expect(result.stdout).toContain("OpenRouter STT");
  });

  it("requires Windows release asset assertions before upload or GitHub release", () => {
    const workflow = readProjectFile(".github/workflows/windows-installer.yml");
    const packageScript = readProjectFile("scripts/package-windows.cjs");
    const assetScript = readProjectFile("scripts/assert-windows-release-assets.cjs");

    expect(workflow).toContain("npm run package:win");
    expect(workflow).toContain("Assert Windows release assets");
    expect(workflow).toContain("node scripts/assert-windows-release-assets.cjs");
    expect(workflow).toContain("node scripts/write-windows-update-metadata.cjs");
    expect(workflow).toContain("release/Auralis-Setup-*.exe.blockmap");
    expect(workflow).toContain("AURALIS_REQUIRE_UPDATE_METADATA");
    expect(workflow).not.toContain("AURALIS_WINDOWS_PUBLISH");
    expect(packageScript).not.toContain("AURALIS_WINDOWS_PUBLISH");
    expect(packageScript).toContain("--publish");
    expect(packageScript).toContain('"never"');
    expect(assetScript).toContain("Auralis-Setup-*.exe");
    expect(assetScript).toContain(".blockmap");
    expect(assetScript).toContain("latest*.yml");
  });

  it("keeps public updater publication behind signed v-tag releases", () => {
    const workflow = readProjectFile(".github/workflows/windows-installer.yml");

    expect(workflow).not.toContain("Prepare auto-update version for main pushes");
    expect(workflow).not.toContain("npm version $autoUpdateVersion --no-git-tag-version");
    expect(workflow).not.toContain(
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(workflow).toContain("release-windows-installer:");
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflow).not.toContain("refs/heads/main");
    expect(workflow).not.toContain(
      ["tag_name: auralis-main-", "{{ github.run_number }}"].join("$"),
    );
    expect(workflow).toContain(["target_commitish: ", "{{ github.sha }}"].join("$"));
    expect(workflow).toContain("make_latest: true");
    expect(workflow).not.toContain("make_latest: false");
    expect(workflow).not.toContain(
      "This release is created for successful, non-canceled pushes to `main`",
    );
    expect(workflow).not.toContain("This release is created on every push to `main`");
    expect(workflow).toContain("group: windows-installer-update-channel");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("accepts actual NSIS installer outputs and requires valid update metadata when requested", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-release-assets-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe.blockmap"), "blockmap");

    try {
      const assertScript = join(projectRoot, "scripts/assert-windows-release-assets.cjs");
      const withoutMetadata = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
      });
      expect(withoutMetadata.status).toBe(0);
      expect(withoutMetadata.stdout).toContain("blockMapAssets");
      expect(withoutMetadata.stdout).not.toContain("nsisPayloadAssets");

      const missingRequiredMetadata = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
        env: { ...process.env, AURALIS_REQUIRE_UPDATE_METADATA: "1" },
      });
      expect(missingRequiredMetadata.status).not.toBe(0);
      expect(missingRequiredMetadata.stderr).toContain("latest*.yml");

      writeFileSync(join(releaseDir, "latest.yml"), "version: 0.1.0\n");
      const incompleteMetadata = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
        env: { ...process.env, AURALIS_REQUIRE_UPDATE_METADATA: "1" },
      });
      expect(incompleteMetadata.status).not.toBe(0);
      expect(incompleteMetadata.stderr).toContain("latest.yml");

      const sha512 = createHash("sha512").update("installer").digest("base64");
      writeFileSync(
        join(releaseDir, "latest.yml"),
        [
          "version: 0.1.0",
          "files:",
          '  - url: "Auralis-Setup-0.1.0.exe"',
          `    sha512: "${sha512}"`,
          "    size: 9",
          'path: "Auralis-Setup-0.1.0.exe"',
          `sha512: "${sha512}"`,
          'releaseDate: "2026-01-01T00:00:00.000Z"',
          "",
        ].join("\n"),
      );
      const validMetadata = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
        env: { ...process.env, AURALIS_REQUIRE_UPDATE_METADATA: "1" },
      });
      expect(validMetadata.status).toBe(0);
      expect(validMetadata.stdout).toContain("updateMetadataAssets");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("generates latest.yml metadata from the built Windows installer", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-update-metadata-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe.blockmap"), "blockmap");

    try {
      const metadataScript = join(projectRoot, "scripts/write-windows-update-metadata.cjs");
      const result = spawnSync(process.execPath, [metadataScript], {
        cwd: tempRoot,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      const latestYml = readFileSync(join(releaseDir, "latest.yml"), "utf-8");
      const sha512 = createHash("sha512").update("installer").digest("base64");
      expect(latestYml).toContain("version: 0.1.0");
      expect(latestYml).toContain("Auralis-Setup-0.1.0.exe");
      expect(latestYml).toContain(`sha512: "${sha512}"`);
      expect(latestYml).toContain("size: 9");
      expect(latestYml).toContain("releaseDate:");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects stale Windows blockmaps that do not match the selected installer", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-stale-blockmap-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.0.9.exe.blockmap"), "stale-blockmap");

    try {
      const metadataScript = join(projectRoot, "scripts/write-windows-update-metadata.cjs");
      const result = spawnSync(process.execPath, [metadataScript], {
        cwd: tempRoot,
        encoding: "utf-8",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Auralis-Setup-0.1.0.exe.blockmap");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects stale latest.yml metadata that points at a different installer", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-stale-update-metadata-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe.blockmap"), "blockmap");
    const sha512 = createHash("sha512").update("installer").digest("base64");
    writeFileSync(
      join(releaseDir, "latest.yml"),
      [
        "version: 0.1.0",
        "files:",
        '  - url: "Auralis-Setup-0.0.9.exe"',
        `    sha512: "${sha512}"`,
        "    size: 9",
        'path: "Auralis-Setup-0.0.9.exe"',
        `sha512: "${sha512}"`,
        'releaseDate: "2026-01-01T00:00:00.000Z"',
        "",
      ].join("\n"),
    );

    try {
      const assertScript = join(projectRoot, "scripts/assert-windows-release-assets.cjs");
      const result = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
        env: { ...process.env, AURALIS_REQUIRE_UPDATE_METADATA: "1" },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Auralis-Setup-0.1.0.exe");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects latest.yml metadata with a version that does not match the installer", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-stale-update-version-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe.blockmap"), "blockmap");
    const sha512 = createHash("sha512").update("installer").digest("base64");
    writeFileSync(
      join(releaseDir, "latest.yml"),
      [
        "version: 9.9.9",
        "files:",
        '  - url: "Auralis-Setup-0.1.0.exe"',
        `    sha512: "${sha512}"`,
        "    size: 9",
        'path: "Auralis-Setup-0.1.0.exe"',
        `sha512: "${sha512}"`,
        'releaseDate: "2026-01-01T00:00:00.000Z"',
        "",
      ].join("\n"),
    );

    try {
      const assertScript = join(projectRoot, "scripts/assert-windows-release-assets.cjs");
      const result = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
        env: { ...process.env, AURALIS_REQUIRE_UPDATE_METADATA: "1" },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("version");
      expect(result.stderr).toContain("0.1.0");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("rejects extra stale Windows blockmaps before upload", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "auralis-extra-stale-blockmap-"));
    const releaseDir = join(tempRoot, "release");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe"), "installer");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.1.0.exe.blockmap"), "blockmap");
    writeFileSync(join(releaseDir, "Auralis-Setup-0.0.9.exe.blockmap"), "stale-blockmap");

    try {
      const assertScript = join(projectRoot, "scripts/assert-windows-release-assets.cjs");
      const result = spawnSync(process.execPath, [assertScript], {
        cwd: tempRoot,
        encoding: "utf-8",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("stale Windows blockmap");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  it("keeps the npm install tree free of deprecated packages", () => {
    const packageLock = JSON.parse(readProjectFile("package-lock.json")) as {
      packages?: Record<string, { deprecated?: string; version?: string }>;
    };
    const deprecatedPackages = Object.entries(packageLock.packages ?? {})
      .filter(([, packageEntry]) => typeof packageEntry.deprecated === "string")
      .map(
        ([packagePath, packageEntry]) =>
          `${packagePath}@${packageEntry.version ?? "unknown"}: ${packageEntry.deprecated}`,
      );

    expect(deprecatedPackages).toEqual([]);
  });

  it("keeps overridden Electron packaging cleanup dependencies callback-compatible", async () => {
    const temp = require("temp") as {
      cleanup: (callback: (error: Error | null) => void) => void;
      mkdir: (prefix: string, callback: (error: Error | null, path: string) => void) => void;
      track: () => void;
    };
    temp.track();
    const tempDir = await new Promise<string>((resolve, reject) => {
      temp.mkdir("auralis-package-cleanup-", (error, path) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(path);
      });
    });

    await new Promise<void>((resolve, reject) => {
      temp.cleanup((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    expect(existsSync(tempDir)).toBe(false);
  });

  it("keeps desktop IPC and paste target consumption fail-closed", () => {
    const mainProcess = readProjectFile("electron/main.cjs");

    expect(mainProcess).toContain('ipcMain.handle("auralis:desktop-info", (event) =>');
    expect(mainProcess).toContain("Desktop info is only available to Auralis.");
    expect(mainProcess).toContain("const pasteTarget = lastExternalFocusTarget;");
    expect(mainProcess).toContain("clearExternalFocusTarget();");
    expect(mainProcess).toContain("return pasteTarget;");
    expect(mainProcess).toContain("GetForegroundWindow");
    expect(mainProcess).toContain("SetForegroundWindow($hwnd)");
    expect(mainProcess).toContain("GetForegroundWindow() -ne $hwnd");
    expect(mainProcess).toContain("automatic Windows paste failed");
  });

  it("keeps Electron isolated with a preload bridge instead of Node in the renderer", () => {
    const mainProcess = readProjectFile("electron/main.cjs");
    const preload = readProjectFile("electron/preload.cjs");
    const launcher = readProjectFile("scripts/run-electron.cjs");
    const permissions = readProjectFile("electron/permissions.cjs");

    expect(mainProcess).toContain("nodeIntegration: false");
    expect(mainProcess).toContain("contextIsolation: true");
    expect(mainProcess).toContain("globalShortcut.register");
    expect(mainProcess).toContain("PASTE_SHORTCUT");
    expect(mainProcess).toContain("clipboard.writeText");
    expect(mainProcess).toContain("auralis:desktop-paste-text");
    expect(mainProcess).toContain("auralis:desktop-transcribe-audio");
    expect(mainProcess).toContain("OPENROUTER_TRANSCRIPTION_MODELS");
    expect(mainProcess).toContain("OPENROUTER_API_KEY");
    expect(mainProcess).toContain("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(mainProcess).toContain("transcribeWithOpenRouter");
    expect(mainProcess).toContain("const trimmedApiKey = apiKey.trim()");
    expect(mainProcess).toContain("AbortSignal.timeout(120_000)");
    expect(mainProcess).toContain("input_audio");
    expect(mainProcess).toContain('audioBuffer.toString("base64")');
    expect(mainProcess).not.toContain("new FormData()");
    expect(mainProcess).toContain("openai/whisper-large-v3-turbo");
    expect(mainProcess).toContain("openai/gpt-4o-mini-transcribe");
    expect(mainProcess).toContain("openai/gpt-4o-transcribe");
    expect(mainProcess).toContain("auralis:desktop-whisper-status");
    expect(mainProcess).toContain("auralis:desktop-whisper-bootstrap");
    expect(mainProcess).toContain("transcribe-local-whisper.py");
    expect(mainProcess).toContain("bootstrap-local-whisper.py");
    expect(mainProcess).toContain("AURALIS_WHISPER_RUNTIME_DIR");
    expect(mainProcess).toContain("managedWhisperPythonUsable");
    expect(mainProcess).toContain("recreateManagedWhisperVenv");
    expect(mainProcess).toContain("faster-whisper==1.2.1");
    expect(mainProcess).toContain("app.asar.unpacked");
    expect(mainProcess).toContain("HF_HUB_OFFLINE");
    expect(mainProcess).toContain("recordExternalFocusTarget");
    expect(mainProcess).toContain('const TOGGLE_SHORTCUT = "Control+Alt+Space";');
    expect(mainProcess).toContain('"Control+Shift+Alt+Space"');
    expect(mainProcess).not.toContain('const TOGGLE_SHORTCUT = "Control+Super+Space";');
    expect(preload).toContain('shortcutLabel: "Hold Ctrl + Win to dictate from any app"');
    expect(preload).toContain('toggleShortcutLabel: "Ctrl + Alt + Space"');
    expect(mainProcess).toContain("toggleShortcutLabel");
    expect(mainProcess).not.toContain('const TOGGLE_SHORTCUT = "CommandOrControl+Alt+Space";');
    expect(mainProcess).toContain("TOGGLE_SHORTCUT_FALLBACKS");
    expect(mainProcess).toContain("COPY_SHORTCUT_FALLBACKS");
    expect(mainProcess).toContain("PASTE_SHORTCUT_FALLBACKS");
    expect(mainProcess).toContain('registerShortcut("toggle", TOGGLE_SHORTCUT_FALLBACKS');
    expect(mainProcess).toContain('registerShortcut("copy", COPY_SHORTCUT_FALLBACKS');
    expect(mainProcess).toContain('registerShortcut("paste", PASTE_SHORTCUT_FALLBACKS');
    expect(mainProcess).toContain("handleToggleShortcut");
    expect(mainProcess).toContain("rendererCaptureState");
    expect(mainProcess).toContain("auralis:desktop-capture-state");
    expect(mainProcess).toContain("auralis:desktop-notify");
    expect(mainProcess).toContain("auralis:desktop-info");
    expect(mainProcess).toContain("auralis:desktop-install-update");
    expect(mainProcess).toContain("electron-updater");
    expect(mainProcess).toContain("autoUpdater.setFeedURL");
    expect(mainProcess).toContain('provider: "github"');
    expect(mainProcess).toContain('owner: "chrisduvillard"');
    expect(mainProcess).toContain('repo: "auralis"');
    expect(mainProcess).toContain("autoUpdater.checkForUpdates()");
    expect(mainProcess).toContain("autoUpdater.quitAndInstall(false, true)");
    expect(mainProcess).toContain("appVersion: app.getVersion()");
    expect(preload).toContain(
      'installUpdate: () => ipcRenderer.invoke("auralis:desktop-install-update")',
    );
    expect(preload).not.toContain("openExternal: (url)");
    expect(preload).not.toContain("shell.openExternal");
    expect(preload).not.toContain("openUpdatePage");
    expect(mainProcess).not.toContain("auralis:desktop-open-external-url");
    expect(mainProcess).not.toContain("auralis:desktop-open-update-page");
    expect(mainProcess).not.toContain("git pull");
    expect(mainProcess).not.toContain("npm install");
    const doubleQuotedGitExec = `execFile(${JSON.stringify("git")}`;
    const singleQuotedGitExec = "execFile('" + "git" + "'";
    expect(mainProcess).not.toContain(doubleQuotedGitExec);
    expect(mainProcess).not.toContain(singleQuotedGitExec);
    expect(mainProcess).not.toContain("focusMainWindowFromShortcut");
    expect(mainProcess).toContain("xdotool");
    expect(mainProcess).toContain("powershell.exe");
    expect(mainProcess).toContain("pathToFileURL");
    expect(mainProcess).toContain("AURALIS_SMOKE_QUIT_AFTER_READY");
    expect(mainProcess).toContain("setPermissionRequestHandler");
    expect(mainProcess).toContain("setPermissionCheckHandler");
    expect(permissions).toContain("isMainFrame");
    expect(permissions).toContain("requestingUrl");
    expect(permissions).toContain("securityOrigin");
    expect(permissions).toContain("mediaTypes");
    expect(mainProcess).toContain("will-navigate");
    expect(mainProcess).toContain("assertRendererHealthyForSmoke");
    expect(mainProcess).toContain("focusMainWindow");
    expect(mainProcess).toContain("sendToRenderer(channel, payload)");
    expect(mainProcess).toContain("hasExternalFocusTarget");
    expect(mainProcess).toContain("autoPaste: shouldStart && hasExternalFocusTarget");
    expect(mainProcess).toContain("function isTrustedAuralisSenderFrame");
    expect(mainProcess).toContain("event.senderFrame");
    expect(mainProcess).toContain("mainWindow.webContents.mainFrame");
    expect(mainProcess).toContain("PASTE_TARGET_TTL_MS");
    expect(mainProcess).toContain("pasteTargetToken");
    expect(mainProcess).toContain("function normalizePasteTextPayload");
    expect(mainProcess).toContain("function consumePasteTarget");
    expect(mainProcess).toContain('reason: "stale-target"');
    expect(mainProcess).toContain("clearExternalFocusTarget");
    expect(mainProcess).toContain("copied: true");
    expect(mainProcess).toContain("pasted: false");
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).toContain("auralis:desktop-toggle-dictation");
    expect(preload).toContain('new CustomEvent("auralis:desktop-toggle-dictation", { detail })');
    expect(preload).toContain("auralis:desktop-copy-transcript");
    expect(preload).toContain("auralis:desktop-paste-transcript");
    expect(preload).toContain("copyText");
    expect(preload).toContain("pasteText");
    expect(preload).toContain("pasteText: (text, pasteTargetToken) =>");
    expect(preload).toContain(
      'ipcRenderer.invoke("auralis:desktop-paste-text", { pasteTargetToken, text })',
    );
    expect(preload).toContain("transcribeAudio");
    expect(preload).not.toContain("OPENROUTER_API_KEY");
    expect(preload).not.toContain("process.env");
    expect(preload).toContain("setupWhisperRuntime");
    expect(preload).toContain("whisperStatus");
    expect(preload).not.toContain("execFile");
    expect(preload).not.toContain('require("node:fs")');
    expect(launcher).toContain("chrome-sandbox");
    expect(launcher).toContain("AURALIS_ALLOW_NO_SANDBOX");
    expect(launcher).toContain("process.execPath");
    expect(launcher).toContain('"node_modules", "electron", "cli.js"');
    expect(launcher).not.toContain('process.platform === "win32" ? "electron.cmd" : "electron"');
    expect(launcher).not.toContain('canUseLinuxSandbox() ? args : ["--no-sandbox", ...args]');
  });

  it("keeps hold-to-talk native keyboard hooks isolated to Electron main", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      build?: { asarUnpack?: string[] };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const mainProcess = readProjectFile("electron/main.cjs");
    const preload = readProjectFile("electron/preload.cjs");
    const holdToTalk = readProjectFile("electron/hold-to-talk.cjs");
    const readme = readProjectFile("README.md");

    expect(packageJson.dependencies?.["uiohook-napi"]).toBe("1.5.5");
    expect(packageJson.devDependencies?.["uiohook-napi"]).toBeUndefined();
    expect(packageJson.build?.asarUnpack).not.toContain("node_modules/uiohook-napi/**/*");
    expect(mainProcess).toContain("createHoldToTalkController");
    expect(mainProcess).toContain("createUiohookBackend");
    expect(mainProcess).toContain("startHoldToTalk");
    expect(mainProcess).toContain("stopHoldToTalk");
    expect(mainProcess).toContain('action: "start"');
    expect(mainProcess).toContain('action: "stop"');
    expect(mainProcess).toContain('const TOGGLE_SHORTCUT = "Control+Alt+Space";');
    expect(holdToTalk).toContain("uiohook-napi");
    expect(holdToTalk).not.toContain("console.log");
    expect(holdToTalk).not.toContain("console.debug");
    expect(preload).not.toContain("uiohook-napi");
    expect(preload).not.toContain("keydown");
    expect(preload).not.toContain("keyup");
    expect(readme).toContain(
      "Hold `Ctrl + Win`: record while held, then transcribe and insert on release.",
    );
    expect(readme).toContain(
      "`Ctrl + Alt + Space`: fallback toggle if hold-to-talk is unavailable.",
    );
  });

  it("mutes default system audio during active desktop capture and restores the previous mute state", () => {
    const mainProcess = readProjectFile("electron/main.cjs");
    const preload = readProjectFile("electron/preload.cjs");

    expect(preload).toContain(
      'setCaptureState: (payload) => ipcRenderer.send("auralis:desktop-capture-state", payload)',
    );
    expect(mainProcess).toContain("audioDuckingPreviousMuted");
    expect(mainProcess).toContain("audioDuckingDeviceKey");
    expect(mainProcess).toContain("getDefaultAudioMuteState");
    expect(mainProcess).toContain("setDefaultAudioMute(true, deviceKey)");
    expect(mainProcess).toContain("setDefaultAudioMute(false, deviceKey)");
    expect(mainProcess).toContain("shouldMuteSystemAudioForCapture");
    expect(mainProcess).toContain("setWindowsDefaultAudioMute");
    expect(mainProcess).toContain("IAudioEndpointVolume");
    expect(mainProcess).toContain("AURALIS_AUDIO_MUTE");
    expect(mainProcess).toContain("AURALIS_AUDIO_DEVICE_ID");
    expect(mainProcess).toContain("setLinuxDefaultAudioMute");
    expect(mainProcess).toContain('"set-sink-mute"');
    expect(mainProcess).toContain(
      '["listening", "recording", "starting"].includes(payload.status)',
    );
  });

  it("keeps audio ducking fail-safe across unknown state, races, and app quit", () => {
    const mainProcess = readProjectFile("electron/main.cjs");

    expect(mainProcess).toContain("audioDuckingDesiredMuted");
    expect(mainProcess).toContain("audioDuckingUpdateQueue = Promise.resolve()");
    expect(mainProcess).toContain("audioDuckingPendingUpdates = 0");
    expect(mainProcess).toContain("allowQuitAfterAudioRestore = false");
    expect(mainProcess).toContain("audioDuckingPendingUpdates += 1");
    expect(mainProcess).toContain("Math.max(0, audioDuckingPendingUpdates - 1)");
    expect(mainProcess).toContain("audioDuckingPendingUpdates === 0");
    expect(mainProcess).toContain("isRestoringAudioBeforeQuit && requestedShouldMute");
    expect(mainProcess).toContain("function finishQuitAfterAudioRestore()");
    expect(mainProcess).toContain("if (allowQuitAfterAudioRestore)");
    expect(mainProcess).toContain("allowQuitAfterAudioRestore = true");
    expect(mainProcess).toContain("audioDuckingPendingUpdates > 0");
    expect(mainProcess).toContain("audioDuckingDesiredMuted || audioDuckingActive");
    expect(mainProcess).toContain("if (audioDuckingChangedSystemMute)");
    expect(mainProcess).toContain("isRestoringAudioBeforeQuit = false");
    expect(mainProcess).not.toContain(".finally(() => app.quit())");
    expect(mainProcess).toContain("audioDuckingUpdateQueue = audioDuckingUpdateQueue");
    expect(mainProcess).toContain(".then(() => applySystemAudioDucking(queuedPayload))");
    expect(mainProcess).toContain("!audioDuckingDesiredMuted &&");
    expect(mainProcess).toContain("!audioDuckingActive &&");
    expect(mainProcess).toContain("if (shouldMute && audioDuckingActive)");
    expect(mainProcess).toContain("previousMuted !== false || !deviceKey");
    expect(mainProcess).toContain("await setDefaultAudioMute(false, deviceKey)");
    expect(mainProcess).toContain('mainWindow.webContents.on("render-process-gone"');
    expect(mainProcess).toContain("restoreSystemAudioAfterRendererExit");
    expect(mainProcess).toContain("audioDuckingDeviceKey = null");
    expect(mainProcess).toContain('app.on("before-quit"');
    expect(mainProcess).toContain(
      'updateSystemAudioDucking({ muteSystemAudio: false, status: "idle" })',
    );
  });

  it("maps Whisper small and medium through every desktop local helper boundary", () => {
    const mainProcess = readProjectFile("electron/main.cjs");
    const transcribeHelper = readProjectFile("scripts/transcribe-local-whisper.py");
    const bootstrapHelper = readProjectFile("scripts/bootstrap-local-whisper.py");

    expect(mainProcess).toContain('["desktop-whisper-small", "small"]');
    expect(mainProcess).toContain('["desktop-whisper-medium", "medium"]');
    expect(mainProcess).toContain('modelId === "desktop-whisper-small"');
    expect(mainProcess).toContain('modelId === "desktop-whisper-medium"');
    expect(mainProcess).toContain("360_000");
    expect(transcribeHelper).toContain('"desktop-whisper-small": "small"');
    expect(transcribeHelper).toContain('"desktop-whisper-medium": "medium"');
    expect(bootstrapHelper).toContain('"desktop-whisper-small": "small"');
    expect(bootstrapHelper).toContain('"desktop-whisper-medium": "medium"');
    expect(bootstrapHelper).toContain('"small": "Systran/faster-whisper-small"');
    expect(bootstrapHelper).toContain('"medium": "Systran/faster-whisper-medium"');
  });

  it("documents a concise GitHub-style operator path", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("## Quick start");
    expect(readme).toContain("## Daily workflow");
    expect(readme).toContain("## Platform behavior");
    expect(readme).toContain("<summary>Advanced setup and troubleshooting</summary>");
    expect(readme).toContain(
      "Use Desktop local Whisper for the most reliable offline workflow, or OpenRouter STT when speed matters",
    );
    expect(readme).toContain("First-run readiness");
    expect(readme).toContain(
      "Auralis defaults first-run desktop installs to `Local Whisper base (recommended)`",
    );
    expect(readme).toContain(
      "OpenRouter STT models remain selectable for users who prefer cloud transcription speed",
    );
    expect(readme).toContain("### STT proof matrix");
    expect(readme).toContain("npm run stt:proof -- --dry-run --format markdown");
    expect(readme).toContain(
      "OpenRouter calls are skipped unless both `OPENROUTER_API_KEY` and `--allow-network` are present",
    );
    expect(readme).toContain(
      "In-app button start copies only; global-shortcut start can auto-paste.",
    );
    expect(readme).toContain("Hold `Ctrl + Win`: record while held");
    expect(readme).toContain(
      "`Ctrl + Alt + Space`: fallback toggle if hold-to-talk is unavailable.",
    );
    expect(readme).toContain("OPENROUTER_API_KEY");
    expect(readme).toContain("never goes into renderer storage or localStorage");
    expect(readme).toContain(
      "Leave local history saving off when transcripts should remain editor-only.",
    );
    expect(readme).toContain("Do not use it as the normal launch path.");
  });

  it("documents the higher-accuracy local Whisper small and medium options", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("Model mode: `Local Whisper small (better accuracy)`");
    expect(readme).toContain("Model mode: `Local Whisper medium (highest accuracy, ~1.5 GB)`");
    expect(readme).toContain(
      "Use `Local Whisper small (better accuracy)` when base is not accurate enough",
    );
    expect(readme).toContain(
      "Use `Local Whisper medium (highest accuracy, ~1.5 GB)` only when accuracy matters more than download size and CPU time",
    );
  });

  it("maps undecodable local Whisper recordings to a user-facing no-audio message", () => {
    const helperPath = join(projectRoot, "scripts/transcribe-local-whisper.py");
    const probe = `
import importlib.util
import sys
import tempfile
from pathlib import Path

helper_path = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("auralis_transcribe_local_whisper", helper_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class FakeWhisperModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, *args, **kwargs):
        raise OSError("[Errno 541478725] End of file: '/tmp/auralis-whisper-test/recording.webm'")

module.import_faster_whisper = lambda: FakeWhisperModel
with tempfile.TemporaryDirectory() as temp_dir:
    audio_path = Path(temp_dir) / "recording.webm"
    audio_path.write_bytes(b"webm header only")
    sys.argv = [str(helper_path), "--audio", str(audio_path), "--language", "en-US", "--model-id", "desktop-whisper-tiny"]
    module.main()
`;

    const result = spawnSync("python3", ["-c", probe, helperPath], {
      encoding: "utf-8",
    });
    const payload = JSON.parse(result.stdout.trim()) as { message?: string; ok?: boolean };

    expect(result.status).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.message).toContain("No usable microphone audio was captured");
    expect(payload.message).not.toContain("Errno 541478725");
    expect(payload.message).not.toContain("/tmp/auralis-whisper-test/recording.webm");
  });

  it("passes speed-oriented local Whisper options and returns timing diagnostics", () => {
    const helperPath = join(projectRoot, "scripts/transcribe-local-whisper.py");
    const probe = `
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

helper_path = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("auralis_transcribe_local_whisper", helper_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class Segment:
    text = " hello from local whisper "

class Info:
    language = "en"
    language_probability = 0.99
    duration = 1.25

class FakeWhisperModel:
    def __init__(self, model_path, **kwargs):
        assert kwargs["device"] == "cpu", kwargs
        assert kwargs["compute_type"] == "int8", kwargs
        assert kwargs["cpu_threads"] == 6, kwargs
        assert kwargs["local_files_only"] is True, kwargs

    def transcribe(self, audio_path, **kwargs):
        assert kwargs["beam_size"] == 1, kwargs
        assert kwargs["language"] == "en", kwargs
        assert kwargs["vad_filter"] is True, kwargs
        assert kwargs["without_timestamps"] is True, kwargs
        assert kwargs["condition_on_previous_text"] is False, kwargs
        return [Segment()], Info()

module.import_faster_whisper = lambda: FakeWhisperModel
module.os.cpu_count = lambda: 12
os.environ["AURALIS_WHISPER_DEVICE"] = "cpu"
os.environ["AURALIS_WHISPER_CPU_THREADS"] = "6"
with tempfile.TemporaryDirectory() as temp_dir:
    audio_path = Path(temp_dir) / "recording.webm"
    audio_path.write_bytes(b"fake audio bytes")
    sys.argv = [str(helper_path), "--audio", str(audio_path), "--language", "en-US", "--model-id", "desktop-whisper-tiny"]
    module.main()
`;

    const result = spawnSync("python3", ["-c", probe, helperPath], {
      encoding: "utf-8",
    });
    const payload = JSON.parse(result.stdout.trim()) as {
      audioSeconds?: number;
      computeType?: string;
      cpuThreads?: number;
      decodeMs?: number;
      device?: string;
      modelLoadMs?: number;
      ok?: boolean;
      text?: string;
    };

    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.text).toBe("hello from local whisper");
    expect(payload.device).toBe("cpu");
    expect(payload.computeType).toBe("int8");
    expect(payload.cpuThreads).toBe(6);
    expect(payload.audioSeconds).toBe(1.25);
    expect(typeof payload.modelLoadMs).toBe("number");
    expect(typeof payload.decodeMs).toBe("number");
  });

  it("auto-selects conservative CPU threads when no thread override is set", () => {
    const helperPath = join(projectRoot, "scripts/transcribe-local-whisper.py");
    const probe = `
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

helper_path = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("auralis_transcribe_local_whisper", helper_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class Segment:
    text = " auto threads "

class Info:
    language = "en"
    language_probability = 0.95
    duration = 1.0

class FakeWhisperModel:
    def __init__(self, model_path, **kwargs):
        assert kwargs["device"] == "cpu", kwargs
        assert kwargs["cpu_threads"] == 8, kwargs

    def transcribe(self, audio_path, **kwargs):
        return [Segment()], Info()

module.import_faster_whisper = lambda: FakeWhisperModel
module.os.cpu_count = lambda: 16
os.environ["AURALIS_WHISPER_DEVICE"] = "cpu"
os.environ.pop("AURALIS_WHISPER_CPU_THREADS", None)
with tempfile.TemporaryDirectory() as temp_dir:
    audio_path = Path(temp_dir) / "recording.webm"
    audio_path.write_bytes(b"fake audio bytes")
    sys.argv = [str(helper_path), "--audio", str(audio_path), "--language", "en-US", "--model-id", "desktop-whisper-tiny"]
    module.main()
`;

    const result = spawnSync("python3", ["-c", probe, helperPath], {
      encoding: "utf-8",
    });
    const payload = JSON.parse(result.stdout.trim()) as { cpuThreads?: number; ok?: boolean };

    expect(result.status).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.cpuThreads).toBe(8);
  });

  it("keeps a persistent local Whisper worker warm across transcription jobs", () => {
    const helperPath = join(projectRoot, "scripts/transcribe-local-whisper.py");
    const probe = `
import importlib.util
import io
import json
import os
import sys
import tempfile
from pathlib import Path

helper_path = Path(sys.argv[1])
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("auralis_transcribe_local_whisper", helper_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class Segment:
    def __init__(self, text):
        self.text = text

class Info:
    language = "en"
    language_probability = 0.98
    duration = 2.5

class FakeWhisperModel:
    load_count = 0

    def __init__(self, model_path, **kwargs):
        FakeWhisperModel.load_count += 1
        assert kwargs["device"] == "cpu", kwargs
        assert kwargs["compute_type"] == "int8", kwargs
        assert kwargs["cpu_threads"] == 4, kwargs

    def transcribe(self, audio_path, **kwargs):
        assert kwargs["without_timestamps"] is True, kwargs
        return [Segment(f" transcript for {Path(audio_path).stem} ")], Info()

module.import_faster_whisper = lambda: FakeWhisperModel
module.os.cpu_count = lambda: 8
os.environ["AURALIS_WHISPER_DEVICE"] = "cpu"
os.environ["AURALIS_WHISPER_CPU_THREADS"] = "4"
with tempfile.TemporaryDirectory() as temp_dir:
    first = Path(temp_dir) / "first.webm"
    second = Path(temp_dir) / "second.webm"
    first.write_bytes(b"first fake audio")
    second.write_bytes(b"second fake audio")
    stdin = io.StringIO(
        json.dumps({"id": "one", "audio": str(first), "language": "en-US", "modelId": "desktop-whisper-base"})
        + "\\n"
        + json.dumps({"id": "two", "audio": str(second), "language": "en-US", "modelId": "desktop-whisper-base"})
        + "\\n"
    )
    stdout = io.StringIO()
    module.run_worker(stdin, stdout)
    responses = [json.loads(line) for line in stdout.getvalue().splitlines()]
    print(json.dumps({"loadCount": FakeWhisperModel.load_count, "responses": responses}))
`;

    const result = spawnSync("python3", ["-c", probe, helperPath], {
      encoding: "utf-8",
    });
    const summary = JSON.parse(result.stdout.trim()) as {
      loadCount?: number;
      responses?: Array<{ id?: string; ok?: boolean; text?: string }>;
    };

    expect(result.status).toBe(0);
    expect(summary.loadCount).toBe(1);
    expect(summary.responses?.map((response) => response.id)).toEqual(["one", "two"]);
    expect(summary.responses?.every((response) => response.ok)).toBe(true);
    expect(summary.responses?.[0]?.text).toBe("transcript for first");
    expect(summary.responses?.[1]?.text).toBe("transcript for second");
  });

  it("routes desktop transcription through a restartable warm worker before falling back", () => {
    const mainProcess = readProjectFile("electron/main.cjs");
    const helper = readProjectFile("scripts/transcribe-local-whisper.py");

    expect(mainProcess).toContain("function startWhisperWorker");
    expect(mainProcess).toContain("transcribeWithWhisperWorker");
    expect(mainProcess).toContain("AURALIS_WHISPER_DISABLE_WORKER");
    expect(mainProcess).toContain("spawn(");
    expect(mainProcess).toContain("whisperWorkerQueue");
    expect(mainProcess).toContain("stopWhisperWorker");
    expect(helper).toContain('parser.add_argument("--worker"');
    expect(helper).toContain("def run_worker");
    expect(helper).toContain("MODEL_CACHE");
  });

  it("builds relative Vite assets for file:// desktop loading", () => {
    const viteConfig = readProjectFile("vite.config.ts");

    expect(viteConfig).toContain('base: "./"');
  });

  it("keeps the visual theme product-native and avoids decorative trend tokens", () => {
    const styles = readProjectFile("src/styles.css");

    expect(styles).toContain("--accent: #7c7cff");
    expect(styles).toContain("--success: #2bd576");
    expect(styles).not.toContain("--parrot-");
    expect(styles).not.toContain(".theme-atmosphere");
    expect(styles).not.toContain('[data-tone="green"]');
  });

  it("keeps dropdown popups readable on Windows native select menus", () => {
    const styles = readProjectFile("src/styles.css");

    expect(styles).toContain(".field select option");
    expect(styles).toContain("background: #11131a;");
    expect(styles).toContain("color: var(--ink);");
  });

  it("keeps public release hygiene files and local agent state separated", () => {
    const gitignore = readProjectFile(".gitignore");
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      files?: string[];
      license?: string;
    };
    const readme = readProjectFile("README.md");

    expect(packageJson.license).toBe("MIT");
    expect(packageJson.files).toEqual(["build", "dist", "electron", "scripts", "package.json"]);
    expect(readProjectFile("LICENSE")).toContain("MIT License");
    expect(readProjectFile("SECURITY.md")).toContain(
      "Please do not publish vulnerabilities publicly",
    );
    expect(gitignore).toContain(".hermes/");
    expect(gitignore).toContain(".Hermes/");
    expect(readme).not.toContain("CES_EVALUATION.md");
    expect(readme).toContain("SECURITY.md");
    expect(readme).toContain("release/Auralis-Setup-*.exe");
    expect(readme).not.toContain("release/Auralis-Setup-0.1.0.exe");
  });

  it("keeps CI least-privilege for public repository checks", () => {
    const workflow = readProjectFile(".github/workflows/ci.yml");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("uses generic public-safe local paths in tests and docs", () => {
    const trackedPublicText = [
      readProjectFile("README.md"),
      readProjectFile("src/test/app.test.ts"),
      readProjectFile("src/test/storage.test.ts"),
      readProjectFile("src/test/desktop-config.test.ts"),
    ].join("\n");

    const localPathPrefix = "/home/" + "chris/";

    expect(trackedPublicText).not.toContain(localPathPrefix);
  });

  it("documents first-run Whisper downloads before offline transcription", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain(
      "First-run Local Whisper setup downloads Python packages and model artifacts",
    );
    expect(readme).toContain("After setup, transcription runs locally");
  });

  it("defaults local transcript history to opt-in in public builds", () => {
    const settings = readProjectFile("src/lib/settings.ts");
    const readme = readProjectFile("README.md");

    expect(settings).toContain("saveTranscriptHistory: false");
    expect(readme).toContain("Local transcript history is opt-in");
    expect(readme).not.toContain("Auralis saves the transcript locally, copies it");
  });

  it("keeps internal dogfood evaluation out of public package archives", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as { files?: string[] };

    expect(packageJson.files).toBeDefined();
    expect(packageJson.files).not.toContain(".hermes");
    expect(packageJson.files).not.toContain(".ces");
    expect(packageJson.files).not.toContain("CES_EVALUATION.md");
  });

  it("keeps the hero headline smaller and compact for a desktop utility", () => {
    const styles = readProjectFile("src/styles.css");

    expect(styles).toContain("font-size: clamp(1.85rem, 4vw, 2.75rem);");
    expect(styles).not.toContain("font-size: clamp(2.15rem, 5vw, 3.4rem);");
    expect(styles).not.toContain("font-size: clamp(2.8rem, 7vw, 5rem);");
  });

  it("pastes on Windows without restoring or resizing the target window", () => {
    const mainProcess = readProjectFile("electron/main.cjs");

    expect(mainProcess).toContain("IsIconic");
    expect(mainProcess).toMatch(
      /\[AuralisWin32Paste\]::IsIconic\(\$hwnd\)[\s\S]{0,160}\[void\]\[AuralisWin32Paste\]::ShowWindowAsync\(\$hwnd, 9\)/,
    );
    expect(mainProcess).not.toMatch(
      /\[void\]\[AuralisWin32Paste\]::ShowWindowAsync\(\$hwnd, 9\)\s*\[void\]\[AuralisWin32Paste\]::SetForegroundWindow\(\$hwnd\)/,
    );
  });

  it("publishes a signed Windows installer artifact from tagged GitHub Actions releases only", () => {
    const workflow = readProjectFile(".github/workflows/windows-installer.yml");

    expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: "true"');
    expect(workflow).toContain("runs-on: windows-2025\n");
    expect(workflow).not.toContain("runs-on: windows-latest");
    expect(workflow).not.toContain("runs-on: windows-2025-vs2026");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("npm run package:win");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_P12");
    expect(workflow).toContain("CSC_LINK");
    expect(workflow).toContain("release-windows-installer");
    expect(workflow).toContain("needs: build-windows-installer");
    expect(workflow).toContain("permissions:\n      contents: write");
    expect(workflow).toContain("actions/upload-artifact@v5");
    expect(workflow).not.toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("actions/download-artifact@v5");
    expect(workflow).not.toContain("actions/download-artifact@v4");
    expect(workflow).toContain("softprops/action-gh-release@v2");
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflow).toContain("Validate release tag matches package version");
    expect(workflow).toContain('$env:GITHUB_REF_NAME -ne "v$packageVersion"');
    expect(workflow).toContain(
      "Signing certificate is required for public Windows release publication.",
    );
    expect(workflow).not.toContain(
      "No Windows signing certificate configured; building unsigned installer.",
    );
    expect(workflow).not.toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain(["auralis-main-", "{{ github.run_number }}"].join("$"));
    expect(workflow).toContain("Auralis-Windows-Installer");
    expect(workflow).toContain("release/Auralis-Setup-*.exe");
    expect(workflow).not.toContain("GH_TOKEN");
  });

  it("smokes the NSIS installer through the default per-user install path", () => {
    const workflow = readProjectFile(".github/workflows/windows-installer.yml");

    expect(workflow).toContain('Join-Path $env:LOCALAPPDATA "Programs\\Auralis"');
    expect(workflow).toContain('Start-Process -FilePath $installer.FullName -ArgumentList "/S"');
    expect(workflow).not.toContain('"/D=$installDir"');
  });

  it("disables Windows certificate auto-discovery for unsigned local installer builds", () => {
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const packager = readProjectFile("scripts/package-windows.cjs");

    expect(packageJson.scripts?.["package:win"]).toBe(
      "npm run build && node scripts/package-windows.cjs nsis",
    );
    expect(packageJson.scripts?.["package:win:dir"]).toBe(
      "npm run build && node scripts/package-windows.cjs dir",
    );
    expect(packager).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(packager).toContain('"false"');
    expect(packager).toContain('"--config.win.signAndEditExecutable=false"');
    expect(packager).toContain("AURALIS_WINDOWS_SIGNING");
    expect(packager).toContain("WIN_CSC_LINK");
    expect(packager).toContain("CSC_LINK");
    expect(packager).toContain("electron-builder/cli.js");
    expect(packager).toContain("process.execPath");
  });

  it("keeps CI signing opt-in for Windows certificate secrets", () => {
    const workflow = readProjectFile(".github/workflows/windows-installer.yml");

    expect(workflow).toContain("AURALIS_WINDOWS_SIGNING=1");
    expect(workflow).toContain("Windows signing certificate configured for electron-builder.");
  });

  it("documents local Windows installer cache recovery", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("Node.js `>=22.12.0`");
    expect(readme).toContain("npm `overrides`");
    expect(readme).toContain("vendor/rimraf-compat");
    expect(readme).toContain("callback-style cleanup");
    expect(readme).toContain("boolean`, `glob@7`, `inflight`, or `rimraf@2`");

    expect(readme).toContain("`toolsets.winCodeSign` is pinned to `1.1.0`");
    expect(readme).toContain("Cannot create symbolic link");
    expect(readme).toContain("certificate auto-discovery is disabled by the package script");
    expect(readme).toContain("signAndEditExecutable=false");
    expect(readme).toContain("AURALIS_WINDOWS_SIGNING=1");
    expect(readme).toContain('rmdir /s /q "%LOCALAPPDATA%\\electron-builder\\Cache\\winCodeSign"');
  });

  it("documents tag-only desktop updates with signed Windows installer assets", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("Update now");
    expect(readme).toContain("downloads and installs the latest published GitHub Release");
    expect(readme).toContain("GitHub Release metadata files such as `latest.yml`");
    expect(readme).toContain("Public updater releases are tag-only");
    expect(readme).toContain("Windows signing certificate secrets are configured");
    expect(readme).toContain(
      "Enforce protected or signed release tags with GitHub repository rulesets",
    );
    expect(readme).not.toContain("Pushing a signed `v*` tag publishes");
    expect(readme).not.toContain("Only signed `v*` tags publish assets");
    expect(readme).not.toContain(
      "successful, non-canceled `main` push workflow run creates an updater-visible GitHub Release",
    );
    expect(readme).not.toContain("Every push to `main` creates an updater-visible GitHub Release");
    expect(readme).toContain("Private GitHub repositories are not a public update channel");
  });

  it("keeps README release and smoke-proof claims aligned with workflows", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain(
      "On Linux, `npm run desktop` may first require Electron sandbox setup.",
    );
    expect(readme).toContain(
      "For `v*` tag releases with Windows signing secrets configured, the current Windows workflow publishes the signed NSIS installer, `Auralis-Setup-*.exe.blockmap`, and `latest*.yml` metadata so the in-app updater can discover and install releases.",
    );
    expect(readme).toContain(
      "The Windows workflow verifies silent install and installed-app launch, then attempts the uninstaller when it is present.",
    );
  });

  it("documents local Whisper performance tuning controls", () => {
    const readme = readProjectFile("README.md");

    expect(readme).toContain("persistent local Whisper worker");
    expect(readme).toContain("AURALIS_WHISPER_DEVICE");
    expect(readme).toContain("AURALIS_WHISPER_CPU_THREADS");
    expect(readme).toContain("AURALIS_WHISPER_DISABLE_WORKER");
  });

  it("declares a restrictive renderer content security policy", () => {
    const html = readProjectFile("index.html");

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("script-src 'self'");
    expect(html).not.toContain("unsafe-eval");
  });

  it("allows Chromium Web Speech audio permission requests without weakening video denial", () => {
    const { isAuralisMediaPermissionCheck, isAuralisMediaPermissionRequest } = require(
      join(projectRoot, "electron/permissions.cjs"),
    ) as {
      isAuralisMediaPermissionCheck: (input: unknown) => boolean;
      isAuralisMediaPermissionRequest: (input: unknown) => boolean;
    };
    const appUrl = "file:///tmp/auralis/dist/index.html";
    const mainWebContents = {};
    const trustedMainFrame = {
      isMainFrame: true,
      requestingUrl: appUrl,
      securityOrigin: "file:///",
    };

    expect(
      isAuralisMediaPermissionCheck({
        appUrl,
        details: trustedMainFrame,
        mainWebContents,
        permission: "media",
        requestingOrigin: "file:///",
        webContents: mainWebContents,
      }),
    ).toBe(true);
    expect(
      isAuralisMediaPermissionCheck({
        appUrl,
        details: {
          embeddingOrigin: appUrl,
          isMainFrame: true,
          mediaType: "audio",
          requestingUrl: "",
        },
        mainWebContents,
        permission: "media",
        requestingOrigin: "",
        webContents: mainWebContents,
      }),
    ).toBe(true);
    expect(
      isAuralisMediaPermissionRequest({
        appUrl,
        details: trustedMainFrame,
        mainWebContents,
        permission: "media",
        webContents: mainWebContents,
      }),
    ).toBe(true);
    expect(
      isAuralisMediaPermissionRequest({
        appUrl,
        details: { ...trustedMainFrame, mediaTypes: ["audio"] },
        mainWebContents,
        permission: "media",
        webContents: mainWebContents,
      }),
    ).toBe(true);
    expect(
      isAuralisMediaPermissionRequest({
        appUrl,
        details: { ...trustedMainFrame, mediaTypes: ["audio", "video"] },
        mainWebContents,
        permission: "media",
        webContents: mainWebContents,
      }),
    ).toBe(false);
    expect(
      isAuralisMediaPermissionCheck({
        appUrl,
        details: { ...trustedMainFrame, mediaType: "video" },
        mainWebContents,
        permission: "media",
        requestingOrigin: "file:///",
        webContents: mainWebContents,
      }),
    ).toBe(false);
    expect(
      isAuralisMediaPermissionCheck({
        appUrl,
        details: trustedMainFrame,
        mainWebContents,
        permission: "media",
        requestingOrigin: "file:///",
        webContents: {},
      }),
    ).toBe(false);
  });
});
