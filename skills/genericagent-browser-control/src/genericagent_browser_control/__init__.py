from pathlib import Path

from genericagent_browser_control.runtime import skill_root, venv_python, venv_root


def bridge_root() -> Path:
    return Path(__file__).resolve().parent


def extension_root() -> Path:
    return skill_root() / "assets" / "tmwd_cdp_bridge"


__all__ = [
    "bridge_root",
    "extension_root",
    "skill_root",
    "venv_python",
    "venv_root",
]
