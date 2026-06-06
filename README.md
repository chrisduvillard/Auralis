<div align="center">
  <img src="src/assets/auralis-lynx-hero.png" alt="Auralis full lynx hero artwork" />

  # Auralis

  **Transcript-first desktop dictation. Hold a shortcut, speak, and keep writing.**

  <p>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/ci.yml?branch=main&label=CI&style=flat-square" /></a>
    <a href="https://github.com/chrisduvillard/Auralis/actions/workflows/windows-installer.yml"><img alt="Windows installer" src="https://img.shields.io/github/actions/workflow/status/chrisduvillard/Auralis/windows-installer.yml?branch=main&label=Windows%20installer&style=flat-square" /></a>
    <img alt="Electron 39" src="https://img.shields.io/badge/Electron-39-47848F?style=flat-square&logo=electron&logoColor=white" />
    <img alt="TypeScript 6" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript&logoColor=white" />
    <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-111827?style=flat-square" />
  </p>

  <p>
    <a href="#why-auralis">Why</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#daily-use">Daily use</a> ·
    <a href="#transcription-choices">Providers</a> ·
    <a href="#privacy-and-storage">Privacy</a> ·
    <a href="#proof-not-promises">Proof</a>
  </p>
</div>

---

Auralis is a quiet desktop dictation app for people who want text, not another workspace to manage. Keep your cursor where the work is, hold a shortcut, speak, and let the transcript land back where you were writing.

It can transcribe locally with Whisper, or optionally use OpenRouter when cloud transcription speed matters. The default posture is local-first, transcript-first, and honest about what has actually been proven.

> **Current public posture: open beta, unsigned Windows preview, signed stable releases only.**
>
> The repository is public and the app is usable from source. Windows preview builds are intentionally manual and unsigned until a signing certificate exists.

```text
Target app focused -> hold Ctrl + Win -> speak -> release -> Auralis copies or inserts the transcript
```

## Why Auralis

- **Keep your cursor where the work is.** Auralis is designed around the previous app, not a separate transcription inbox.
- **No meeting bot, no dashboard, no transcription inbox to manage.** The core loop is capture, transcribe, edit, continue.
- **Use local Whisper by default.** Fresh desktop profiles can run without a backend or API key after first-run setup.
- **Choose cloud speed deliberately.** OpenRouter STT is available, but the provider boundary stays explicit and documented.
- **Ship only what is proven.** Automated tests, installer smokes, unsigned preview caveats, and real-device gaps are separated on purpose.

## At a glance

| Surface | Current state |
| --- | --- |
| **Transcript-first desktop dictation** | The main surface is the text you just created, not a chatbot or recorder dashboard. |
| **Local-first by default** | Fresh desktop profiles default to app-managed local Whisper with no required backend or API key. |
| **Provider boundary** | OpenRouter STT is explicit and optional; Browser Web Speech remains a browser-dependent fallback. |
| **Cursor-aware workflow** | Global-shortcut recordings can attempt paste into the previous app; button-started recordings copy only. |
| **Windows preview** | Unsigned manual artifacts are acceptable for beta testers, but they are not the stable updater channel. |
| **Signed stable releases** | Updater-visible public releases require signed `v*` tag builds and matching release metadata. |

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

| Provider | Best for | Requires API key | Audio leaves device? | Notes |
| --- | --- | --- | --- | --- |
| **Desktop local Whisper** | Offline or private dictation | No | No after first-run setup | Uses app-managed `faster-whisper`; first run downloads packages and models |
| **OpenRouter STT** | Faster cloud transcription | Yes | Yes, to OpenRouter | Optional; sends recorded audio from Electron main to OpenRouter |
| **Browser Web Speech API** | Browser-only development | No app key | Browser-dependent | Chrome and Edge behavior varies; some browsers may use vendor cloud speech services |

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

Linux Wayland usually blocks automatic paste. In that case, Auralis still copies the transcript so you can press `Ctrl+V` yourself.

## Privacy and storage

Auralis does not require a backend. Privacy depends on the selected provider and on operating-system surfaces such as the clipboard.

- No required backend
- No required API key
- Local Whisper records microphone audio locally and deletes temporary audio files after normal transcription completion
- Local transcript history is opt-in
- History is stored only in the current browser or Electron profile
- Clipboard text is visible to the operating system and clipboard managers while copied
- OpenRouter STT is optional and sends recorded audio to OpenRouter when selected
- Browser Web Speech privacy depends on the browser engine
- See [`docs/privacy-data-flow.md`](./docs/privacy-data-flow.md) for the full microphone, clipboard, LocalStorage, provider, and deletion boundary
- See [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and security-sensitive surfaces

## Proof, not promises

Auralis keeps distribution and validation claims scoped to evidence.

| Proof surface | What it proves | What it does not prove |
| --- | --- | --- |
| `npm test -- --run` | Renderer, settings, storage, Electron contract, and README behavior regressions | Real microphone quality or physical OS paste on your machine |
| `npm run desktop:check` | Electron shell can start far enough to report version under the smoke environment | Full interactive dictation |
| `xvfb-run -a npm run desktop:smoke` | Headless desktop launch path under Xvfb | Real display-manager focus behavior |
| Windows installer workflow | Silent install, installed-app launch, Notepad paste mechanism smoke, and release asset assertions | Broad physical-device proof across user machines |

Headless tests use fake speech and recording implementations. They do not prove real microphone quality or real OS paste behavior on your machine.

The Windows workflow verifies silent install and installed-app launch, then attempts the uninstaller when it is present. It also runs a Notepad auto-paste mechanism smoke test.

## Project docs

- [`CONTRIBUTING.md`](./CONTRIBUTING.md): setup, validation, and secret-safe contribution rules
- [`CHANGELOG.md`](./CHANGELOG.md): user-visible changes
- [`docs/privacy-data-flow.md`](./docs/privacy-data-flow.md): privacy and local data-flow boundary
- [`docs/release-proof-checklist.md`](./docs/release-proof-checklist.md): preview vs stable release proof requirements

## Updates and Windows installer

Build a Windows installer:

```bash
npm run package:win
```

Installer output:

```text
release/Auralis-Setup-*.exe
```

### Windows preview build

Windows builds are currently unsigned because Auralis does not pay for a code-signing certificate yet. Windows SmartScreen may warn on first install.

Use GitHub prereleases or workflow artifacts for manual preview installs only; they are not the stable updater channel.

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

Auralis keeps a persistent local Whisper worker warm across transcription jobs unless disabled.

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
