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
- Public Windows updater releases require signing certificate secrets before publication.

## Release integrity

Public updater releases are intended to be published from `v*` tags only, with Windows signing certificate secrets required before updater-visible publication. Unsigned local Windows installer builds are for development and smoke testing, not broad public distribution. Enforce protected or signed release tags with GitHub repository rulesets before relying on the GitHub Releases feed for public updates.
