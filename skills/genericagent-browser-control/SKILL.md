---
name: genericagent-browser-control
description: Use when Codex needs to control a live Chromium browser session through a local bridge for page scanning, DOM inspection, or JavaScript execution, especially when preserving the user's logged-in browser session matters.
---

# GenericAgent Browser Control

Use this skill to inspect or operate the user's current Chromium tab without launching a separate browser profile.

## Workflow

1. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/setup_venv.ps1`.
2. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/setup_extension.ps1 -Browser chrome` or `-Browser edge`.
3. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/doctor.ps1`.
4. If the bridge is not already running, start `python skills/genericagent-browser-control/scripts/start_bridge.py`.
5. Run `python skills/genericagent-browser-control/scripts/scan_page.py` before risky DOM mutations or when you need a structural page snapshot.
6. Run `python skills/genericagent-browser-control/scripts/exec_js.py` for targeted actions and inspect the structured JSON result.
7. If the local `.venv` is missing, or if no session is found, read [references/setup-and-usage.md](references/setup-and-usage.md).

## References

- Use [references/setup-and-usage.md](references/setup-and-usage.md) for installation, update, and troubleshooting steps.
- Use [references/upstream-findings.md](references/upstream-findings.md) for the trimmed upstream map and vendoring boundaries.
