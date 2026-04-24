from __future__ import annotations

import sys
from pathlib import Path


def bootstrap() -> None:
    skill_root = Path(__file__).resolve().parents[1]
    src_root = skill_root / "src"
    src_root_str = str(src_root)
    if src_root_str not in sys.path:
        sys.path.insert(0, src_root_str)

    from genericagent_browser_control.runtime import ensure_skill_venv

    ensure_skill_venv()
