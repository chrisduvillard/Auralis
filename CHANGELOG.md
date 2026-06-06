# Changelog

## [0.1.14]

### Added

- Unsigned Windows preview posture documented for the no-cost public beta path.
- Privacy/data-flow documentation for microphone audio, clipboard, LocalStorage, Local Whisper setup, OpenRouter STT, and Browser Web Speech boundaries.
- Release proof checklist separating unsigned preview artifacts from stable signed updater-visible releases.
- Contributor guidance for validation, documentation, and secret-safe changes.

### Notes

- Windows preview builds are unsigned unless code signing is explicitly configured.
- Unsigned preview builds are for manual testing and are not the stable updater channel.
- A dry-run STT proof matrix does not prove real transcription; non-dry-run local Whisper proof is required for actual STT readiness claims.
