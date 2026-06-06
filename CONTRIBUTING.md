# Contributing to Auralis

Auralis is a desktop-first dictation app with sensitive surfaces: microphone audio, clipboard text, local transcript storage, global shortcuts, local Whisper setup, optional OpenRouter STT, and Windows update artifacts.

Keep changes small, tested, and honest about platform limits.

## Local setup

```bash
npm ci
npm run desktop
```

Use Node `22.x` and npm `>=10`. Python 3.11 or compatible Python 3.x is needed for first-run Local Whisper setup.

## Validation before a PR

Run the relevant focused test first, then the normal gates:

```bash
npm audit --audit-level=high
npm test -- --run
npm run typecheck
npm run lint
npm run build
npm run desktop:check
```

When changing desktop launch, Electron IPC, shortcuts, paste behavior, packaging, or release workflow, also run the closest desktop smoke available for your platform.

## Security and privacy rules

Do not add secrets, tokens, certificates, transcripts, or local private paths to the repository, docs, tests, issues, logs, screenshots, or release notes.

Sensitive changes need explicit tests or proof:

- Electron preload or IPC bridge changes.
- Microphone capture or transcription provider changes.
- Clipboard, paste, global shortcut, tray, or overlay changes.
- LocalStorage, history import/export, or personal text rules.
- OpenRouter or other network provider behavior.
- Windows signing, updater, installer, or GitHub Actions release behavior.

## Docs expectations

If behavior changes, update the docs in the same PR:

- `README.md` for user-facing setup and platform behavior.
- `SECURITY.md` for security-sensitive surfaces.
- `docs/privacy-data-flow.md` for storage, clipboard, audio, and provider boundaries.
- `docs/release-proof-checklist.md` for release/update trust changes.
- `CHANGELOG.md` for user-visible changes.

Do not overclaim. If a check is a dry run, call it a dry run. If a build is unsigned, call it unsigned. If a test uses fake microphone or headless paste, do not present it as real-device proof.

## Release discipline

Unsigned Windows builds are preview artifacts only. Stable updater-visible Windows releases require a signed `v*` tag build and the release proof checklist.

Do not publish updater-visible release assets from ordinary `main` builds.
