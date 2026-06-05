#!/usr/bin/env python3
"""Install and warm Auralis' app-managed local faster-whisper runtime.

Electron creates a private venv under the app's user data directory, then runs this
script with that venv's Python. This helper keeps all work inside the provided
runtime directory and emits exactly one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

MODEL_MAP = {
    "desktop-whisper-tiny": "tiny",
    "desktop-whisper-base": "base",
    "desktop-whisper-small": "small",
    "desktop-whisper-medium": "medium",
}

MODEL_REPOS = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
}


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    raise SystemExit(exit_code)


def run(command: list[str], timeout: int = 600) -> str:
    result = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=timeout,
    )
    output = result.stdout.strip()

    if result.returncode != 0:
        raise RuntimeError(output or f"Command failed: {' '.join(command)}")

    return output


def model_name_for_id(model_id: str) -> str:
    model_name = MODEL_MAP.get(model_id)
    if not model_name:
        emit({"ok": False, "message": "Unsupported local Whisper model."}, 2)
    assert model_name is not None
    return model_name


def install_requirement(requirement: str) -> None:
    run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--upgrade",
            requirement,
        ],
        timeout=900,
    )


def download_model(model_name: str, model_dir: Path) -> None:
    from huggingface_hub import snapshot_download  # type: ignore[import-not-found]

    repo_id = MODEL_REPOS[model_name]
    target_dir = model_dir / model_name
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        snapshot_download(
            repo_id=repo_id,
            local_dir=target_dir,
            local_dir_use_symlinks=False,
            resume_download=True,
        )
    except TypeError:
        snapshot_download(repo_id=repo_id, local_dir=target_dir, resume_download=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap Auralis local faster-whisper runtime")
    parser.add_argument("--runtime-dir", required=True)
    parser.add_argument("--model-id", default="desktop-whisper-base")
    parser.add_argument("--requirement", default="faster-whisper==1.2.1")
    parser.add_argument("--skip-model-download", action="store_true")
    args = parser.parse_args()

    runtime_dir = Path(args.runtime_dir).expanduser().resolve()
    model_dir = runtime_dir / "models"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    try:
        model_name = model_name_for_id(args.model_id)
        install_requirement(args.requirement)

        import faster_whisper  # type: ignore[import-not-found]

        if not args.skip_model_download:
            download_model(model_name, model_dir)

        emit(
            {
                "ok": True,
                "message": "Local Whisper engine is ready.",
                "python": sys.executable,
                "version": getattr(faster_whisper, "__version__", "unknown"),
                "modelId": args.model_id,
                "modelPath": str(model_dir / model_name),
            }
        )
    except SystemExit:
        raise
    except Exception as exc:
        emit(
            {
                "ok": False,
                "message": f"Local Whisper setup failed: {exc}",
                "python": sys.executable,
            },
            1,
        )


if __name__ == "__main__":
    main()
