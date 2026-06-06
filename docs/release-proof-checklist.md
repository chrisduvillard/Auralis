# Release proof checklist

This checklist separates no-cost preview builds from stable updater-visible releases.

## Current no-cost posture

Unsigned preview builds are not stable updater releases.

Auralis may publish source, CI artifacts, or GitHub prereleases for manual preview installs. Those artifacts are useful for testing, but Windows may show SmartScreen warnings and users should not treat them as the stable update channel.

Do not cut or publish a stable `v*` release without Windows signing secrets.

Required secrets for a signed Windows release:

- `WINDOWS_CERTIFICATE_P12`
- `WINDOWS_CERTIFICATE_PASSWORD`

Do not commit certificates, passwords, tokens, API keys, or private local paths.

## Before any public preview

- Confirm `main` is clean and synced.
- Run local validation:
  - `npm audit --audit-level=high`
  - `npm test -- --run`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run desktop:check`
- Confirm README still states unsigned Windows preview limitations.
- Confirm `docs/privacy-data-flow.md` still describes clipboard, LocalStorage, OpenRouter, Browser Web Speech, and Local Whisper setup boundaries.
- Confirm no release notes imply signed or stable Windows installer trust.

## Before a stable updater-visible Windows release

Stable release publication requires all preview checks plus:

- `package.json` version, release tag, installer filename, and `latest.yml` version match.
- Windows signing secrets are configured in GitHub Actions.
- The Windows installer workflow verifies a valid Authenticode signature before release publication.
- Public release assets include:
  - `Auralis-Setup-*.exe`
  - `Auralis-Setup-*.exe.blockmap`
  - `latest.yml`
- `latest.yml` SHA512 matches the installer.
- The GitHub Release is created from the intended signed `v*` tag.
- GitHub branch/tag protection or rulesets are active for the release path.

## Real-world proof required before broad claims

Real Windows interactive smoke:

- Install the downloaded Windows build on an interactive Windows desktop.
- Launch the installed app.
- Verify microphone permission and recording state.
- Run a real microphone to transcript flow.
- Verify target-app paste into a real app such as Notepad.
- Verify fallback copy behavior when auto-paste is unavailable.
- For signed releases only: verify Update now and the PowerShell fallback updater against public release assets.

STT proof:

- A dry-run STT proof matrix only proves command shape and provider coverage.
- A non-dry-run local Whisper proof is required before claiming actual local transcription works on a machine.
- OpenRouter proof requires explicit network approval and `OPENROUTER_API_KEY`; do not run it by default.

## Abort conditions

Abort release publication if any of these are true:

- A stable release would be unsigned.
- The workflow is about to publish updater-visible assets from `main` instead of an intentional signed `v*` tag.
- Authenticode verification is missing or invalid for a stable Windows release.
- Release notes imply privacy guarantees that exceed `docs/privacy-data-flow.md`.
- Any validation gate fails without a documented, accepted reason.
