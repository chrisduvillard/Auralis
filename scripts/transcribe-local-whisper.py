#!/usr/bin/env python3
"""Local faster-whisper bridge for Auralis.

This helper is intentionally small and JSON-only: Electron writes an audio file,
executes this script with explicit arguments, and reads one JSON object from stdout.
It never contacts a network: models must already be present in the local Hugging Face cache
or supplied via AURALIS_WHISPER_MODEL_DIR.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, TextIO

MODEL_MAP = {
    "desktop-whisper-tiny": "tiny",
    "desktop-whisper-base": "base",
    "desktop-whisper-small": "small",
    "desktop-whisper-medium": "medium",
}

MODEL_CACHE: dict[tuple[str, str, str, int], tuple[Any, dict[str, Any]]] = {}

UNUSABLE_AUDIO_MESSAGE = (
    "No usable microphone audio was captured. Try recording a little longer "
    "and check that Auralis is receiving microphone input."
)

LANGUAGE_MAP = {
    "en-US": "en",
    "en-GB": "en",
    "de-DE": "de",
    "fr-FR": "fr",
    "es-ES": "es",
}


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    raise SystemExit(exit_code)


def elapsed_ms(start: float) -> int:
    return max(0, round((time.perf_counter() - start) * 1000))


def add_uv_cache_archives() -> None:
    if os.environ.get("AURALIS_WHISPER_USE_UV_CACHE", "0") != "1":
        return

    archive_root = Path.home() / ".cache" / "uv" / "archive-v0"
    if not archive_root.is_dir():
        return

    for path in sorted(archive_root.iterdir()):
        if path.is_dir():
            sys.path.append(str(path))


def import_faster_whisper():
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]

        return WhisperModel
    except Exception:
        add_uv_cache_archives()
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]

        return WhisperModel


def resolve_model(model_id: str) -> str:
    model_name = MODEL_MAP.get(model_id)
    if not model_name:
        raise ValueError("Unsupported local Whisper model.")

    model_dir = os.environ.get("AURALIS_WHISPER_MODEL_DIR")
    if model_dir:
        candidate = Path(model_dir).expanduser() / model_name
        if candidate.exists():
            return str(candidate)

    return model_name


def normalize_device_policy() -> str:
    device = os.environ.get("AURALIS_WHISPER_DEVICE", "auto").strip().lower()
    return device if device in {"auto", "cpu", "cuda"} else "auto"


def conservative_default_cpu_threads() -> int:
    logical_cpus = os.cpu_count()
    if not logical_cpus or logical_cpus <= 0:
        return 0

    if logical_cpus == 1:
        return 1

    # Most Windows/Linux laptops expose SMT/Hyper-Threading, so half the logical
    # count is the safer no-override default. Cap at 8 to avoid desktop
    # oversubscription while still giving base/small models enough parallelism.
    return max(1, min(8, logical_cpus // 2))


def parse_cpu_threads() -> int:
    raw_value = os.environ.get("AURALIS_WHISPER_CPU_THREADS", "").strip()
    if not raw_value:
        return conservative_default_cpu_threads()

    try:
        value = int(raw_value)
    except ValueError:
        return conservative_default_cpu_threads()

    if value <= 0:
        return conservative_default_cpu_threads()

    logical_cpus = os.cpu_count()
    if logical_cpus and logical_cpus > 0:
        return min(value, logical_cpus)

    return value


def compute_type_for_device(device: str) -> str:
    configured = os.environ.get("AURALIS_WHISPER_COMPUTE_TYPE", "").strip()
    if configured:
        return configured

    return "float16" if device == "cuda" else "int8"


def device_candidates() -> list[str]:
    policy = normalize_device_policy()
    if policy == "auto":
        return ["cuda", "cpu"]
    return [policy]


def load_model(model_id: str) -> tuple[Any, dict[str, Any]]:
    WhisperModel = import_faster_whisper()
    model_path = resolve_model(model_id)
    cpu_threads = parse_cpu_threads()
    attempts: list[str] = []

    for device in device_candidates():
        compute_type = compute_type_for_device(device)
        cache_key = (model_path, device, compute_type, cpu_threads)
        cached = MODEL_CACHE.get(cache_key)
        if cached is not None:
            model, metadata = cached
            return model, {**metadata, "cachedModel": True, "modelLoadMs": 0}

        start = time.perf_counter()
        try:
            model = WhisperModel(
                model_path,
                compute_type=compute_type,
                cpu_threads=cpu_threads,
                device=device,
                local_files_only=True,
            )
        except Exception as exc:
            attempts.append(f"{device}/{compute_type}: {exc}")
            if normalize_device_policy() != "auto":
                raise RuntimeError(
                    f"Could not initialize local Whisper on {device}/{compute_type}: {exc}"
                ) from exc
            continue

        metadata = {
            "cachedModel": False,
            "computeType": compute_type,
            "cpuThreads": cpu_threads,
            "device": device,
            "devicePolicy": normalize_device_policy(),
            "modelId": model_id,
            "modelLoadMs": elapsed_ms(start),
        }
        MODEL_CACHE[cache_key] = (model, metadata)
        return model, metadata

    raise RuntimeError(
        "Could not initialize local Whisper with CUDA or CPU fallback. " + "; ".join(attempts)
    )


def looks_like_undecodable_audio_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        phrase in message
        for phrase in (
            "end of file",
            "invalid data found when processing input",
            "moov atom not found",
            "could not find codec parameters",
        )
    )


def transcribe_audio(audio: str, language: str, model_id: str) -> dict[str, Any]:
    audio_path = Path(audio).expanduser()
    if not audio_path.is_file():
        return {"ok": False, "message": "Audio file was not found for local transcription."}

    if audio_path.stat().st_size <= 0:
        return {"ok": True, "message": "No audio was recorded.", "text": ""}

    model, model_metadata = load_model(model_id)
    try:
        decode_start = time.perf_counter()
        segments, info = model.transcribe(
            str(audio_path),
            beam_size=1,
            condition_on_previous_text=False,
            language=LANGUAGE_MAP.get(language, "en"),
            vad_filter=True,
            without_timestamps=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        decode_ms = elapsed_ms(decode_start)
    except Exception as exc:
        if looks_like_undecodable_audio_error(exc):
            return {"ok": False, "message": UNUSABLE_AUDIO_MESSAGE}
        raise

    return {
        "ok": True,
        "message": "Transcribed locally with Whisper.",
        "text": text,
        "language": getattr(info, "language", None),
        "languageProbability": getattr(info, "language_probability", None),
        "audioSeconds": getattr(info, "duration", None),
        "decodeMs": decode_ms,
        **model_metadata,
    }


def transcribe(args: argparse.Namespace) -> None:
    payload = transcribe_audio(args.audio, args.language, args.model_id)
    emit(payload, 0 if payload.get("ok") else 1)


def worker_error_payload(message: str, request_id: Any = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "message": message}
    if request_id is not None:
        payload["id"] = request_id
    return payload


def handle_worker_request(request: dict[str, Any]) -> dict[str, Any]:
    request_id = request.get("id")
    audio = request.get("audio")
    if not isinstance(audio, str) or not audio:
        return worker_error_payload("Missing audio path for local transcription.", request_id)

    raw_language = request.get("language")
    raw_model_id = request.get("modelId")
    language = raw_language if isinstance(raw_language, str) else "en-US"
    model_id = raw_model_id if isinstance(raw_model_id, str) else "desktop-whisper-tiny"

    try:
        payload = transcribe_audio(audio, language, model_id)
    except Exception as exc:
        payload = worker_error_payload(f"Local Whisper transcription failed: {exc}", request_id)

    if request_id is not None:
        payload["id"] = request_id
    return payload


def run_worker(input_stream: TextIO = sys.stdin, output_stream: TextIO = sys.stdout) -> None:
    for line in input_stream:
        if not line.strip():
            continue

        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Worker request must be a JSON object.")
            request_id = request.get("id")
            payload = handle_worker_request(request)
        except Exception as exc:
            payload = worker_error_payload(f"Local Whisper worker request failed: {exc}", request_id)

        print(json.dumps(payload, ensure_ascii=False), file=output_stream, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Auralis local faster-whisper bridge")
    parser.add_argument("--probe", action="store_true", help="verify runtime dependencies")
    parser.add_argument("--worker", action="store_true", help="run a persistent JSON-lines worker")
    parser.add_argument("--audio")
    parser.add_argument("--language", default="en-US")
    parser.add_argument("--model-id", default="desktop-whisper-tiny")
    args = parser.parse_args()

    try:
        WhisperModel = import_faster_whisper()
        if args.probe:
            import faster_whisper  # type: ignore[import-not-found]

            emit(
                {
                    "ok": True,
                    "message": "Local faster-whisper runtime is available.",
                    "python": sys.executable,
                    "version": getattr(faster_whisper, "__version__", "unknown"),
                }
            )

        if args.worker:
            _ = WhisperModel
            run_worker()
            return

        if not args.audio:
            emit({"ok": False, "message": "Missing audio path for local transcription."}, 2)

        # Keep the import alive for static analyzers and to fail early before work starts.
        _ = WhisperModel
        transcribe(args)
    except SystemExit:
        raise
    except Exception as exc:
        emit(
            {
                "ok": False,
                "message": f"Local Whisper transcription failed: {exc}",
            },
            1,
        )


if __name__ == "__main__":
    main()
