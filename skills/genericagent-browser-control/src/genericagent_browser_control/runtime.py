from __future__ import annotations

import os
import sys
from pathlib import Path


def package_root() -> Path:
    return Path(__file__).resolve().parent


def skill_root() -> Path:
    return package_root().parents[1]


def src_root() -> Path:
    return skill_root() / "src"


def venv_root() -> Path:
    return skill_root() / ".venv"


def venv_python() -> Path:
    scripts_dir = "Scripts" if os.name == "nt" else "bin"
    python_name = "python.exe" if os.name == "nt" else "python"
    return venv_root() / scripts_dir / python_name


def install_venv_command() -> str:
    setup_script = skill_root() / "scripts" / "setup_venv.ps1"
    return f'powershell -ExecutionPolicy Bypass -File "{setup_script}"'


def running_under_skill_venv() -> bool:
    expected = venv_python()
    try:
        return expected.exists() and Path(sys.executable).resolve() == expected.resolve()
    except OSError:
        return False


def ensure_skill_venv(argv: list[str] | None = None) -> None:
    expected = venv_python()
    if running_under_skill_venv():
        return

    if not expected.exists():
        raise SystemExit(
            "Skill virtual environment not found at "
            f"{expected}. Run {install_venv_command()} first."
        )

    command_argv = list(sys.argv if argv is None else argv)
    os.execv(str(expected), [str(expected), *command_argv])
