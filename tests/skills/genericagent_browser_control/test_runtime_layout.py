import json
from pathlib import Path

from genericagent_browser_control import bridge_root, extension_root, skill_root, venv_root


def test_skill_roots_resolve_from_package():
    assert bridge_root().name == "genericagent_browser_control"
    assert extension_root().name == "tmwd_cdp_bridge"


def test_skill_bundle_uses_local_venv():
    assert skill_root().name == "genericagent-browser-control"
    assert extension_root().parent.parent == skill_root()
    assert venv_root() == skill_root() / ".venv"


def test_runtime_scripts_do_not_reference_repo_level_deps():
    for relpath in [
        "scripts/start_bridge.py",
        "scripts/scan_page.py",
        "scripts/exec_js.py",
        "scripts/doctor.ps1",
    ]:
        text = (skill_root() / relpath).read_text(encoding="utf-8")
        assert ".deps" not in text


def test_setup_and_usage_mentions_skill_local_venv_setup():
    text = (skill_root() / "references" / "setup-and-usage.md").read_text(encoding="utf-8")
    assert "setup_venv.ps1" in text
    assert ".venv" in text


def test_extension_popup_documents_external_control_toggle():
    extension = extension_root()
    manifest = json.loads((extension / "manifest.json").read_text(encoding="utf-8"))
    popup_html = (extension / "popup.html").read_text(encoding="utf-8")
    popup_js = (extension / "popup.js").read_text(encoding="utf-8")
    content_js = (extension / "content.js").read_text(encoding="utf-8")

    assert "storage" in manifest["permissions"]
    assert "allowExternalControl" in popup_html
    assert "controlState" in popup_js
    assert "ljq_driver: 已连接" not in content_js
