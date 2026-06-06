# Security Policy

## Supported versions

Auralis is pre-1.0. Security fixes target the latest `main` branch and the latest published release assets.

## Reporting a vulnerability

Please do not publish vulnerabilities publicly before a fix is available.

Report security issues privately to the repository owner through GitHub Security Advisories if the feature is available, or by opening a private contact channel with the maintainer.

Please include:

- affected Auralis version or commit
- operating system and install method
- whether Desktop local Whisper, OpenRouter STT, or Browser Web Speech was active
- reproduction steps
- impact assessment
- any logs with credentials, transcript content, and local usernames redacted

## Security-sensitive surfaces

Auralis handles microphone audio, transcript text, clipboard writes, global shortcuts, optional OpenRouter API credentials, local Whisper runtime bootstrap, and desktop auto-updates.

Important expectations:

- Do not put API keys or tokens in renderer code, exported history, issues, or logs.
- Local transcript history is opt-in and stored in the current browser or Electron profile.
- OpenRouter STT sends recorded audio to OpenRouter from Electron main when selected.
- Browser Web Speech privacy behavior depends on the browser engine.
- Desktop local Whisper setup may download Python packages and model artifacts before offline transcription is available.
- Public Windows updater releases are signed `v*` tag releases. Unsigned local builds are smoke artifacts only and are not published as updater-visible public releases.

## Release integrity

GitHub Actions are pinned to full commit SHAs, with the upstream tag noted in comments.

Updater-visible Windows releases are published from intentional signed `v*` tag pushes only. The release body records the signed release status and the workflow verifies the installer Authenticode signature before GitHub Release publication.

Public `main` pushes build, smoke, and upload unsigned installer artifacts for CI evidence, but they do not publish updater-visible GitHub Releases. If signing secrets are missing on a `v*` tag, the workflow fails before publication instead of publishing an unsigned public update.

Enforce branch protection, protected or signed release tags, and repository rulesets before relying on the GitHub Releases feed for public updates.
