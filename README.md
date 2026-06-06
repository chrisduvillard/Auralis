<div align="center">
  <img src="build/icon.png" alt="Auralis icon" width="96" height="96" />

  # Auralis

  **Hold a shortcut. Talk. Release. Get text where your cursor already is.**

  <p>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/ci.yml?branch=main&label=CI&style=for-the-badge" /></a>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/windows-installer.yml"><img alt="Windows installer" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/windows-installer.yml?branch=main&label=Windows%20installer&style=for-the-badge" /></a>
    <img alt="Electron" src="https://img.shields.io/badge/Electron-39-47848F?style=for-the-badge&logo=electron&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/license-MIT-111827?style=for-the-badge" />
  </p>
</div>

---

## What it does

Auralis is a small desktop dictation app.

```text
Put cursor in any app -> hold Ctrl + Win -> speak -> release -> text is copied or pasted
```

It works best as a desktop app. It can transcribe locally with Whisper, or optionally use OpenRouter when cloud transcription speed matters.

## Quick start

### Requirements

- Node.js `22.x` (`>=22.12 <23`)
- npm `>=10`
- Microphone permission
- Python 3.11 or compatible Python 3.x for first-run local Whisper setup
- Optional on Linux/X11: `xdotool` for automatic paste into the previous app

Use the repo's `.nvmrc` / `.node-version` if your shell supports them.

### Run from source

```bash
git clone https://github.com/chrisduvillard/Auralis.git
cd Auralis
npm ci
npm run desktop
```

That opens the Electron desktop app. You do not need to open a browser URL.

On Linux, `npm run desktop` may first require Electron sandbox setup. If Electron prints a `chrome-sandbox` warning, run the command it shows, or see [Linux sandbox](#linux-sandbox).

## First run

Auralis defaults fresh desktop profiles to:

- Provider: **Desktop local Whisper**
- Model: **Local Whisper base (recommended)**

If the local engine is missing, click **Install / repair local engine**.

First-run Local Whisper setup downloads Python packages and model artifacts. After setup, transcription runs locally without a cloud speech backend.

No `.env` file is needed for local Whisper.

## Daily use

1. Start Auralis with `npm run desktop`.
2. Put your cursor in the app where you want text.
3. Hold `Ctrl + Win`.
4. Speak.
5. Release either key.
6. Auralis transcribes, copies the text, and tries to paste it back.

If automatic paste is blocked, press `Ctrl+V`. The transcript is already on your clipboard.

In-app button start copies only; global-shortcut start can auto-paste.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Hold `Ctrl + Win` | Record while held, then transcribe and insert on release |
| `Ctrl + Alt + Space` | Fallback toggle if hold-to-talk is unavailable |
| `Ctrl/Command + Alt + C` | Copy current transcript |
| `Ctrl/Command + Alt + Enter` | Paste current transcript to the previous app again |

If a shortcut is already taken, Auralis tries a safer fallback and shows the active shortcut in the app.

## Transcription choices

| Provider | Best for | Notes |
| --- | --- | --- |
| **Desktop local Whisper** | Offline or private dictation | Uses app-managed `faster-whisper`; first run downloads packages and models |
| **OpenRouter STT** | Faster cloud transcription | Optional; sends recorded audio from Electron main to OpenRouter |
| **Browser Web Speech API** | Browser-only development | Chrome and Edge behavior varies; some browsers may use vendor cloud speech services |

### Local Whisper models

- `Local Whisper tiny (fastest first-run check)`
- `Local Whisper base (recommended)`
- `Local Whisper small (better accuracy)`
- `Local Whisper medium (highest accuracy, ~1.5 GB)`

### OpenRouter

Set the key before launching Auralis:

```bash
OPENROUTER_API_KEY=your-key npm run desktop
```

For an installed app, set `OPENROUTER_API_KEY` as an OS user environment variable, then fully restart Auralis.

The key is read by Electron main. Do not put it in renderer code, localStorage, exported history, issues, or logs.

Default model: `OpenRouter Whisper Large v3 Turbo (fastest)`.

## Platform notes

| Platform | Behavior |
| --- | --- |
| Windows | Uses Electron clipboard plus PowerShell/User32 to refocus the previous app and send paste |
| Linux/X11 | Uses Electron clipboard plus `xdotool` for direct paste |
| Linux/Wayland | Most compositors block synthetic keyboard input; Auralis falls back to clipboard copy |
| macOS | Electron shell can run; copy-to-clipboard is the safe documented behavior |

## Privacy and storage

- No required backend
- No required API key
- Local Whisper records microphone audio locally and deletes temporary audio files after transcription
- Local transcript history is opt-in
- History is stored only in the current browser or Electron profile
- OpenRouter STT is optional and sends recorded audio to OpenRouter when selected
- Browser Web Speech privacy depends on the browser engine
- See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and security-sensitive surfaces

## Updates and Windows installer

Build a Windows installer:

```bash
npm run package:win
```

Installer output:

```text
release/Auralis-Setup-*.exe
```

In the installed Windows app, **Update now** checks GitHub Releases for `chrisduvillard/Auralis`, then downloads and installs the latest updater-compatible Windows release when available.

The Windows installer workflow builds and smokes installer artifacts on `main`, but updater-visible public releases are published only from intentional signed `v*` tags. It publishes the signed NSIS installer, `Auralis-Setup-*.exe.blockmap`, and GitHub Release metadata files such as `latest.yml`.

If Windows signing secrets are absent on a `v*` tag, the workflow fails before GitHub Release publication instead of publishing an unsigned public update. Local Windows installer builds remain unsigned unless signing is explicitly enabled.

Private GitHub repositories are not a public update channel. Do not ship a GitHub token inside the app.

### PowerShell fallback updater

If the in-app **Update now** button is blocked or unreliable on your Windows machine, use the first-party PowerShell fallback updater from this repo. It downloads the latest public GitHub Release, verifies the installer SHA512 against `latest.yml`, closes Auralis, installs silently, and relaunches the app.

From a cloned checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/update-auralis.ps1
```

The SHA512 check verifies the installer matches the GitHub Release metadata. It is an integrity guard for the public release feed, not a substitute for publisher signing. This fallback still uses the same public updater-compatible release assets.

## Public release checklist

Before cutting a public Windows release:

- `package.json` version, release tag, installer filename, and `latest.yml` version all match
- `WINDOWS_CERTIFICATE_P12` and `WINDOWS_CERTIFICATE_PASSWORD` are configured as GitHub Actions secrets
- The Windows installer workflow reports a valid Authenticode signature before publishing
- CI and `build-windows-installer` are green for the release commit
- The GitHub Release is created from the intended signed `v*` tag and is not draft/prerelease unless explicitly intended
- Downloaded release assets include the installer, `.blockmap`, and `latest.yml`, and `latest.yml` SHA512 matches the installer
- A real Windows install/update smoke confirms launch, Update now, fallback updater, microphone, and target-app paste on an interactive desktop

## Validate locally

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

STT proof matrix:

```bash
npm run stt:proof -- --dry-run --format markdown
```

OpenRouter calls are skipped unless both `OPENROUTER_API_KEY` and `--allow-network` are present.

Headless tests use fake speech and recording implementations. They do not prove real microphone quality or real OS paste behavior on your machine.

The Windows workflow verifies silent install and installed-app launch, then attempts the uninstaller when it is present. It also runs a Notepad auto-paste mechanism smoke test.

## Linux sandbox

Auralis refuses to start on Linux if Electron's sandbox helper is not root-owned setuid.

Fix locally with the command printed by the launcher. It will look like:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

For a temporary smoke check only:

```bash
AURALIS_ALLOW_NO_SANDBOX=1 npm run desktop:smoke
```

Do not use `AURALIS_ALLOW_NO_SANDBOX=1` as the normal launch path.

## Advanced notes

<details>
<summary>Local Whisper tuning</summary>

Useful environment variables:

- `AURALIS_WHISPER_RUNTIME_DIR`: app-managed venv and model cache directory
- `AURALIS_WHISPER_PYTHON`: explicit Python interpreter for advanced debugging
- `AURALIS_WHISPER_MODEL_DIR`: explicit local model directory
- `AURALIS_WHISPER_DEVICE`: `auto`, `cpu`, or `cuda`
- `AURALIS_WHISPER_COMPUTE_TYPE`: faster-whisper compute type override
- `AURALIS_WHISPER_CPU_THREADS`: CPU thread override
- `AURALIS_WHISPER_DISABLE_WORKER=1`: disables the persistent local Whisper worker
- `AURALIS_WHISPER_USE_UV_CACHE=1`: advanced fallback that lets the helper inspect `~/.cache/uv/archive-v0`

</details>

<details>
<summary>Windows signing and packaging</summary>

The workflow can sign Windows builds when these GitHub secrets are configured:

- `WINDOWS_CERTIFICATE_P12`
- `WINDOWS_CERTIFICATE_PASSWORD`

Local unsigned package scripts disable certificate auto-discovery and pass `signAndEditExecutable=false` unless `AURALIS_WINDOWS_SIGNING=1` is set. Electron Builder's `toolsets.winCodeSign` is pinned to `1.1.0`.

If an older local Windows build fails with `Cannot create symbolic link`, clear Electron Builder's Windows signing cache:

```cmd
rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
```

</details>

<details>
<summary>Dependency hygiene</summary>

The repo uses npm `overrides` to keep installs warning-clean while Electron packaging tools catch up upstream. The local `vendor/rimraf-compat` shim preserves callback-style cleanup for older packaging dependencies.

Remove those overrides only after upstream packages no longer resolve `boolean`, `glob@7`, `inflight`, or `rimraf@2`.

</details>

## Known limits

- Linux and macOS packaged installers are not configured yet
- Linux Wayland usually blocks automatic paste
- Local Whisper first run can take time to download and warm up
- Browser Web Speech support and privacy behavior vary by browser
- OpenRouter STT is configured through `OPENROUTER_API_KEY`, not an in-app key field
- Unsigned local Windows builds are smoke artifacts only; updater-visible public releases require signed `v*` tag builds
