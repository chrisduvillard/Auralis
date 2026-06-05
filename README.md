<div align="center">
  <img src="build/icon.png" alt="Auralis icon" width="96" height="96" />
  <h1>Auralis</h1>
  <p><strong>Local desktop dictation that stays out of your way.</strong></p>
  <p>
    Press a global shortcut, speak, stop, and let Auralis copy or insert the transcript back into the app you were already using.
  </p>
  <p>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/ci.yml?branch=main&label=CI&style=for-the-badge" /></a>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/windows-installer.yml"><img alt="Windows installer" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/windows-installer.yml?branch=main&label=Windows%20installer&style=for-the-badge" /></a>
    <img alt="Electron" src="https://img.shields.io/badge/Electron-39-47848F?style=for-the-badge&logo=electron&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-111827?style=for-the-badge" />
  </p>
  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#daily-workflow">Daily workflow</a> ·
    <a href="#platform-behavior">Platform behavior</a> ·
    <a href="#validation">Validation</a> ·
    <a href="#advanced-setup-and-troubleshooting">Advanced setup</a>
  </p>
</div>

---

## What Auralis is

Auralis is a desktop-first speech-to-text app built with Electron, Vite, and TypeScript.

It is designed for one simple loop:

1. Put your cursor where you want text to land.
2. Hold `Ctrl + Win`.
3. Speak.
4. Release either key.
5. Auralis transcribes, copies, and inserts the text when the desktop allows it.

Use Desktop local Whisper for the most reliable offline workflow, or OpenRouter STT when speed matters and you provide an API key through Electron main.

Auralis has no required backend, database, API key, or paid speech service. OpenRouter is optional. Local transcript history is opt-in and stored in the current app profile only when enabled. Audio files are not stored permanently.

## Highlights

- **Desktop local Whisper** for deterministic local transcription through an app-managed `faster-whisper` runtime.
- **OpenRouter STT** as an optional fast cloud transcription path, with the API key read only by Electron main.
- **Browser Web Speech fallback** for Chrome and Edge development or browser-only experiments.
- **Global shortcuts** for start/stop, copy, and paste-again.
- **Target-app workflow** that can keep focus in VS Code, Chrome, Obsidian, terminal, or another app while recording.
- **Best-effort auto-paste** on Windows and Linux/X11, with safe clipboard fallback elsewhere.
- **Opt-in local history** with search, language filtering, validated JSON import/export, load, copy, and delete.
- **Engine repair tools** for local Whisper setup, model checks, and app-managed runtime recovery.
- **System audio muting** while recording, then restore after stop, transcription, renderer crash, or quit.
- **Direct desktop updates** through GitHub Releases with the in-app **Update now** action.
- **Secure Electron boundary** with context isolation, sandboxed renderer, no Node integration, and a narrow preload bridge.

## Quick start

### Requirements

- Node.js `>=22.12.0`
- npm `>=10`
- A microphone and OS permission to use it
- Python 3.11 or a compatible Python 3.x for first-run Desktop local Whisper setup
- Optional on Linux/X11: `xdotool` for automatic paste into the previous app

### Run from source

```bash
git clone https://github.com/chrisduvillard/Auralis.git
cd auralis
npm ci
npm run desktop
```

That opens the Electron desktop app. You do not need to open a browser URL.

On Linux, `npm run desktop` may first require Electron sandbox setup. If Electron prints a `chrome-sandbox` warning, use the command in [Advanced setup and troubleshooting](#advanced-setup-and-troubleshooting).

### First run

Auralis shows a compact **First-run readiness** card on a fresh desktop profile. Auralis defaults first-run desktop installs to `Local Whisper base (recommended)`. First-run Local Whisper setup downloads Python packages and model artifacts when the local engine is missing. After setup, transcription runs locally without a cloud speech backend. OpenRouter STT models remain selectable for users who prefer cloud transcription speed.

1. Open **Engine settings**.
2. Keep **Desktop local Whisper** selected, or choose **OpenRouter STT** if you have `OPENROUTER_API_KEY` configured in Electron main.
3. Keep **Local Whisper base (recommended)** unless you need a different speed or accuracy tradeoff.
4. If the local engine is missing, click **Install / repair local engine**.
5. Grant microphone permission when the first recording asks for it.
6. Test the shortcut and paste path once from another app.

No `.env` file is needed for Desktop local Whisper.

## Daily workflow

1. Run `npm run desktop` and leave Auralis open.
2. Put your cursor in the target app.
3. Hold `Ctrl + Win`.
4. Speak normally.
5. Release either key.
6. Wait for **Transcribing**.
7. Auralis copies the transcript and tries to insert it back into the target app. If you enabled local history, it also saves a local history entry.
8. If direct paste is blocked, press `Ctrl+V` manually. The transcript is already on the clipboard.

In-app button start copies only; global-shortcut start can auto-paste.

### Shortcuts

- Hold `Ctrl + Win`: record while held, then transcribe and insert on release.
- `Ctrl + Alt + Space`: fallback toggle if hold-to-talk is unavailable.
- `Ctrl/Command + Alt + C`: copy the current transcript.
- `Ctrl/Command + Alt + Enter`: paste the current transcript to the previous app again.

If a shortcut is already taken, Auralis tries a safer fallback and shows the active shortcut in the desktop status card.

## Platform behavior

### Windows

- Uses Electron clipboard plus PowerShell/User32 to focus the previous app and send paste.
- Builds an unsigned Windows x64 NSIS installer by default.
- Optional certificate secrets enable signed installer builds in GitHub Actions.
- The Windows installer workflow also runs an installed-app smoke test and a real Notepad auto-paste mechanism smoke.

### Linux/X11

- Uses Electron clipboard plus `xdotool` for direct paste.
- Install `xdotool` if you want automatic insertion into the previous app.
- Without `xdotool`, Auralis still copies the transcript and asks you to press `Ctrl+V`.

### Linux/Wayland

- Most Wayland compositors block synthetic keyboard input by design.
- Auralis falls back to clipboard copy and clear instructions.

### macOS

- The desktop shell can run through Electron.
- The current direct paste path is not documented as fully supported on macOS, so treat copy-to-clipboard as the safe behavior.

### Browser development mode

```bash
npm run dev
```

Open the Vite URL in Chrome or Edge only when debugging the renderer. For normal use, prefer `npm run desktop`.

## Providers and models

### Provider: `Desktop local Whisper`

Desktop local Whisper records microphone audio locally, sends it through the Electron bridge, transcribes it with `faster-whisper`, deletes temporary audio files, and saves transcript text plus metadata only when local history is enabled.

Model modes:

- Model mode: `Local Whisper base (recommended)`
- Model mode: `Local Whisper small (better accuracy)`
- Model mode: `Local Whisper medium (highest accuracy, ~1.5 GB)`
- Model mode: `Local Whisper tiny (faster)`

Use `Local Whisper small (better accuracy)` when base is not accurate enough and you can tolerate a slower CPU transcription pass.

Use `Local Whisper medium (highest accuracy, ~1.5 GB)` only when accuracy matters more than download size and CPU time, and confirm there is enough disk space for the larger model cache.

Use `Local Whisper tiny (faster)` only when speed matters more than accuracy.

Desktop local Whisper uses a persistent local Whisper worker after first use, so the selected model can stay warm between dictations.

### Provider: `OpenRouter STT`

OpenRouter STT records microphone audio in the desktop app, then sends it from Electron main to OpenRouter for faster cloud transcription after Stop.

Set the key in the process environment before launching Auralis:

```bash
OPENROUTER_API_KEY=your-key npm run desktop
```

For an installed desktop app, set `OPENROUTER_API_KEY` as an OS user environment variable, then fully restart Auralis so Electron main inherits it. Do not put the key in renderer code, localStorage, exported history, or the README.

Default model mode: `OpenRouter Whisper large-v3 turbo (fast default)`.

### Provider: `Browser Web Speech API`

Browser Web Speech can show live words while you speak. It is useful for browser-only development, but support varies by browser.

Model modes:

- Model mode: `Browser default engine`
- Model mode: `Prefer on-device language pack`

Important caveats:

- Chrome and Edge are the practical browser targets.
- Some browser engines may send audio to the browser vendor for processing.
- On-device recognition depends on browser support and installed language packs.
- Electron currently disables Chromium on-device Web Speech because the current Electron build can terminate the renderer when that path is requested.

## Features in detail

### Transcription

- Explicit start and stop only.
- Desktop recording state with microphone activity meter.
- Local transcribing state after stop.
- Browser interim transcript preview where supported.
- Empty or silent recordings end safely with a visible message.
- Duplicate consecutive transcripts are not saved twice.

### Transcript editor

- Edit the final transcript before copying or pasting again.
- Copy, paste to previous app, and clear actions.
- Word and character counts.
- Clipboard fallback when direct paste is not possible.

### History

- Local transcript history is opt-in.
- Up to 24 saved transcripts when history is enabled.
- Leave local history saving off when transcripts should remain editor-only.
- Search by transcript text, language, provider, or model.
- Filter by language.
- Load, copy, expand, and delete individual items.
- Export JSON.
- Import JSON with validation before merge.
- Two-step **Clear all history** confirmation.

### Privacy and storage

- No required cloud backend.
- No required API credentials.
- Optional OpenRouter STT uses `OPENROUTER_API_KEY` from the Electron main process environment; it never goes into renderer storage or localStorage.
- No permanent audio storage.
- Local state is stored in the current browser or Electron profile.
- Local transcript history is opt-in, and local history entries are validated before load, save, and import.
- See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and the supported security model.
- Future paid cloud providers should keep credentials outside the renderer, preferably behind Electron main or a backend proxy.

### App updates

The desktop **Update now** action checks `chrisduvillard/Auralis` GitHub Releases, downloads and installs the latest published GitHub Release when available, and uses a narrow Electron IPC surface.

Publish the NSIS installer plus GitHub Release metadata files such as `latest.yml` so installed clients can discover updates. For successful, non-canceled public `main` push workflow runs and for `v*` tag releases with Windows signing secrets configured, the current Windows workflow publishes the NSIS installer, `Auralis-Setup-*.exe.blockmap`, and `latest*.yml` metadata so the in-app updater can discover and install releases.

On the public `chrisduvillard/Auralis` repository, each successful, non-canceled `main` push workflow run creates an updater-visible GitHub Release with a monotonic generated version based on the workflow run number and marks it latest. Intentional `v*` tag releases still require Windows signing certificate secrets. Enforce protected or signed release tags with GitHub repository rulesets before relying on tagged releases as a public update channel.

Private GitHub repositories are not a public update channel. If Auralis must update every external user without GitHub authentication, the release assets and `latest.yml` feed need to be public, either by publishing from the public `chrisduvillard/Auralis` repository or by publishing the same assets to another public update host. Do not ship a GitHub token inside the app.

## Install and package

### Install dependencies

```bash
npm ci
```

Use `npm install` only when intentionally updating dependencies.

### Run desktop app

```bash
npm run desktop
```

### Run renderer only

```bash
npm run dev
```

### Build Windows installer

```bash
npm run package:win
```

The Windows installer is written to:

```text
release/Auralis-Setup-*.exe
```

The GitHub Actions workflow at `.github/workflows/windows-installer.yml` builds and uploads an `Auralis-Windows-Installer` artifact on pushes to `main`, `v*` tags, and manual dispatch. Public `main` pushes in `chrisduvillard/Auralis` publish updater-visible release assets after the Windows installer smoke passes; `v*` tag publication still requires Windows signing certificate secrets.

## Validation

Run the same core checks used by CI:

```bash
npm ci
npm audit --audit-level=high
npm test -- --run
npm run typecheck
npm run lint
npm run build
npm run desktop:check
xvfb-run -a npm run desktop:smoke
```

Useful local commands:

```bash
npm run test
npm run coverage
npm run package:win:dir
npm run stt:proof -- --dry-run --format markdown
```

### STT proof matrix

`npm run stt:proof` prints an operator-readable STT proof matrix for Desktop local Whisper and the selectable OpenRouter STT models. It is safe by default: without `--audio` it skips execution, and OpenRouter calls are skipped unless both `OPENROUTER_API_KEY` and `--allow-network` are present.

Examples:

```bash
npm run stt:proof -- --dry-run --format markdown
npm run stt:proof -- --audio ./fixtures/dictation.webm --expected "hello world" --provider desktop-whisper --format json
OPENROUTER_API_KEY=*** npm run stt:proof -- --audio ./fixtures/dictation.webm --provider openrouter-stt --allow-network --format markdown
```

The harness records pass/fail/skipped status, transcript text, decode timing, model-load timing where available, audio duration, device/compute metadata, and word error rate when `--expected` is supplied. It redacts `OPENROUTER_API_KEY` from output and never stores credentials.

Headless tests use fake `SpeechRecognition` and `MediaRecorder` implementations. A real microphone, target-app focus, OS-level paste, and live STT quality still need a physical desktop check or an explicit `stt:proof` run against an audio fixture.

## Manual desktop smoke

Use this after `npm run desktop` on a real desktop session:

1. Confirm the Auralis window opens without a browser URL.
2. Confirm status is **Ready**.
3. Open a target app and place the cursor in a text field.
4. Press `Ctrl + Alt + Space`.
5. Confirm the target app remains focused while Auralis starts recording.
6. Speak a short phrase.
7. Press the same shortcut again.
8. Confirm Auralis transcribes and copies the text. If local history is enabled, confirm the text appears in **Saved transcriptions**.
9. On Windows or Linux/X11 with `xdotool`, confirm the text appears in the target app.
10. On Wayland or unsupported desktops, confirm Auralis asks you to press `Ctrl+V` and the clipboard paste works.
11. If local history is enabled, close and reopen Auralis, then confirm history remains available.

## Advanced setup and troubleshooting

<details>
<summary>Advanced setup and troubleshooting</summary>

### Local Whisper environment variables

None are required for normal use. These are optional controls for debugging or tuning:

- `AURALIS_WHISPER_RUNTIME_DIR`: directory for the app-managed venv and model cache. Defaults to Electron `userData` / `whisper-runtime`.
- `AURALIS_WHISPER_PYTHON`: path or command for an existing Python interpreter that can import `faster_whisper`, or the Python used to bootstrap the app-managed runtime.
- `AURALIS_WHISPER_MODEL_DIR`: explicit local model directory instead of the app-managed model cache or normal Hugging Face cache lookup.
- `AURALIS_WHISPER_DEVICE`: `auto`, `cpu`, or `cuda`. Defaults to `auto`, which tries CUDA first and falls back to CPU.
- `AURALIS_WHISPER_COMPUTE_TYPE`: optional faster-whisper compute type override. By default Auralis uses `float16` on CUDA and `int8` on CPU.
- `AURALIS_WHISPER_CPU_THREADS`: optional positive integer passed to faster-whisper `cpu_threads` for CPU tuning.
- `AURALIS_WHISPER_DISABLE_WORKER=1`: disables the persistent local Whisper worker and returns to the one-shot helper path for troubleshooting.
- `AURALIS_WHISPER_USE_UV_CACHE=1`: lets the helper add packages from `~/.cache/uv/archive-v0` to `PYTHONPATH` when available.

### Linux Electron sandbox

Auralis refuses to start on Linux if Electron's sandbox helper is not root-owned setuid.

Fix locally with the command printed by the launcher. It will look like this:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

For a temporary smoke check only, set `AURALIS_ALLOW_NO_SANDBOX=1`. Do not use it as the normal launch path.

### Dependency hygiene

The repo uses npm `overrides` to keep the install tree warning-clean while Electron packaging tools still reference older dependency ranges.

The local `vendor/rimraf-compat` shim preserves callback-style cleanup for `temp@0.9.4` without reinstalling deprecated `rimraf@2`.

Remove these overrides only after upstream packages no longer resolve `boolean`, `glob@7`, `inflight`, or `rimraf@2`.

### Windows installer and signing

- `toolsets.winCodeSign` is pinned to `1.1.0` so Electron Builder uses split Windows signing/resource-editing tool archives instead of the legacy archive that can require local symlink privileges.
- Windows certificate auto-discovery is disabled by the package script for unsigned local builds.
- The package wrapper clears ambient signing variables and passes `signAndEditExecutable=false` unless explicit signing is enabled.
- Explicit signing works when certificate variables are present and `AURALIS_WINDOWS_SIGNING=1` is set.
- GitHub Actions sets `AURALIS_WINDOWS_SIGNING=1` automatically when `WINDOWS_CERTIFICATE_P12` and `WINDOWS_CERTIFICATE_PASSWORD` secrets exist. Signed `v*` tag releases fail closed when those secrets are missing.

Optional GitHub Actions Windows signing secrets:

- `WINDOWS_CERTIFICATE_P12`: base64-encoded `.p12` or `.pfx` signing certificate.
- `WINDOWS_CERTIFICATE_PASSWORD`: password for that certificate.

If a previous local Windows build failed with `Cannot create symbolic link`, clear the stale Electron Builder cache from Command Prompt, then rerun `npm run package:win`:

```cmd
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
```

If you are building an older branch without the `1.1.0` toolset pin, enable Windows Developer Mode or run the terminal as Administrator.

### What CI proves

`.github/workflows/ci.yml` proves install, audit, tests, typecheck, lint, build, desktop shell check, and headless desktop launch on Ubuntu.

`.github/workflows/windows-installer.yml` proves Windows installer build, silent install, installed app launch, and a Notepad auto-paste mechanism smoke. The Windows workflow verifies silent install and installed-app launch, then attempts the uninstaller when it is present.

Neither workflow proves real microphone audio quality on your physical machine. Use the manual desktop smoke for that.

</details>

## Project structure

```text
auralis/
├── .github/workflows/       # CI and Windows installer workflows
├── build/icon.*             # app and installer icon assets
├── electron/
│   ├── main.cjs             # Electron shell, shortcuts, paste, updates, local Whisper IPC
│   ├── permissions.cjs      # media permission and renderer-origin checks
│   └── preload.cjs          # narrow context-isolated bridge
├── scripts/
│   ├── bootstrap-local-whisper.py
│   ├── package-windows.cjs
│   ├── run-electron.cjs
│   ├── smoke-windows-autopaste.ps1
│   └── transcribe-local-whisper.py
├── src/
│   ├── app.ts               # UI and dictation state machine
│   ├── lib/                 # providers, settings, storage, transcript helpers
│   ├── main.ts              # renderer mount
│   ├── styles.css           # product-native desktop styling
│   └── test/                # Vitest tests
├── README.md
├── package.json
└── vite.config.ts
```

## Known limitations

- Desktop local Whisper needs Python for first-run bootstrap unless a compatible runtime is already configured.
- The local Whisper runtime and selected model can take time to download and warm on first use.
- Browser Web Speech availability and privacy behavior depend on the browser engine.
- Linux Wayland usually blocks automatic paste, so clipboard copy is the safe fallback.
- Local Windows installer builds and public main-push updater builds are unsigned unless signing is explicitly enabled. Signed `v*` tag releases require signing secrets.
- Linux and macOS packaged installers are not yet configured.
- OpenRouter STT is optional and currently configured through `OPENROUTER_API_KEY`, not through an in-app key field.

## Related notes

- App source is intentionally small and local-first: Electron main, a narrow preload bridge, one Vite renderer, plain CSS, and Vitest coverage for the risky desktop contracts.
- Security reports and sensitive findings belong in [`SECURITY.md`](./SECURITY.md), not in public issues.
