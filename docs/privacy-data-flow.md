# Privacy and data flow

Auralis is local-first, but it is not magic privacy dust. This document names the data surfaces plainly so preview users can make an informed choice.

## Default posture

- No account is required.
- No required backend is used for Desktop local Whisper.
- No required API key is needed for local transcription.
- Transcript history is opt-in and is off by default.
- OpenRouter STT and Browser Web Speech are optional provider choices with different privacy boundaries.

## Microphone audio

### Desktop local Whisper

- Recording starts only after user action, such as hold-to-talk or the in-app record button.
- The renderer records microphone audio and sends bounded audio bytes to Electron main through the preload bridge.
- Electron main writes a temporary audio file for the local Whisper helper.
- The temporary directory is removed after normal transcription completion or handled failure.
- A crash or forced kill can still leave operating-system temporary files until normal OS cleanup.

### First-run Local Whisper setup

First-run Local Whisper setup downloads Python packages and model artifacts. After setup, normal local transcription is designed to run from local files without a cloud speech backend.

Current trust boundary:

- Python packages are downloaded during setup.
- Hugging Face model artifacts are downloaded during setup.
- This is a setup supply-chain boundary, not a transcript upload path.
- Future hardening should pin model revisions and stronger dependency hashes before broad stable release claims.

## Clipboard and paste

Auralis uses the operating-system clipboard for copy and paste workflows.

Clipboard text is visible to the operating system and clipboard managers. Other local applications with clipboard access may observe dictated text while it is on the clipboard.

Automatic paste is best-effort:

- Windows uses Electron clipboard plus PowerShell/User32 focus and paste.
- Linux/X11 uses Electron clipboard plus `xdotool`.
- Linux/Wayland and unsupported cases fall back to clipboard copy.

If automatic paste fails, the transcript stays on the clipboard and the user can press `Ctrl+V` manually.

## Local storage

Auralis stores settings, optional history, and personal text rules in the current browser or Electron profile.

LocalStorage is local plaintext profile storage, not encrypted vault storage.

Stored surfaces can include:

- Settings and provider choice.
- Optional transcript history when explicitly enabled.
- Optional personal text rules.

Do not store secrets, tokens, passwords, private keys, certificates, or recovery phrases in transcript history or personal text rules.

## Provider-specific network behavior

### Desktop local Whisper

After setup, Desktop local Whisper transcription is intended to run locally from cached model files.

### OpenRouter STT

OpenRouter STT sends recorded audio to OpenRouter only when selected. The API key is read by Electron main from the process environment and must not be placed in renderer code, localStorage, exported history, issues, or logs.

### Browser Web Speech

Browser Web Speech may use browser-vendor speech services. Behavior depends on the browser engine and platform.

## Deletion and retention

- Temporary local Whisper audio is deleted after normal transcription completion.
- Transcript history is not saved unless the user enables it.
- Disabling history does not erase text already copied to the operating-system clipboard.
- Exported history files are ordinary local files and must be handled by the user.
- Uninstall behavior may keep Electron app data unless manually removed.

## Safe preview guidance

For sensitive dictation:

1. Use Desktop local Whisper.
2. Keep transcript history off.
3. Avoid personal text rules containing private data.
4. Clear the clipboard after pasting if the transcript is sensitive.
5. Do not use OpenRouter or Browser Web Speech for audio you do not want sent to a provider.
