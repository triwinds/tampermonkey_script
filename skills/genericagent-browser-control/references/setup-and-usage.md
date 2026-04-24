# Setup And Usage

## Create the skill-local Python environment

1. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/setup_venv.ps1`.
2. The script creates or refreshes `skills/genericagent-browser-control/.venv`.
3. The runtime dependencies for the bridge are installed into that local `.venv`, not into the repo root.
4. Re-run this setup script whenever you want to refresh the skill's Python dependencies.

## Install the extension

1. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/setup_extension.ps1 -Browser chrome`.
2. The script opens the extensions page and reveals `skills/genericagent-browser-control/assets/tmwd_cdp_bridge`.
3. Enable developer mode in the browser.
4. Click "Load unpacked".
5. Choose the opened extension folder.
6. Confirm the extension appears without `manifest.json` or permission errors.
7. If the browser asks for `debugger`, `scripting`, or `tabs` permissions, accept them.
8. Pin the extension to the toolbar if you want to observe its state while debugging.
9. Use the extension popup to verify the status and toggle whether external control is allowed.

## Update the extension

1. After editing files under `assets/tmwd_cdp_bridge`, go back to the browser extension page.
2. Refresh the unpacked extension.
3. Re-enable the extension if the service worker does not come back automatically.

## Use the bridge

1. Run `powershell -ExecutionPolicy Bypass -File skills/genericagent-browser-control/scripts/doctor.ps1`.
2. Start `python skills/genericagent-browser-control/scripts/start_bridge.py`.
3. If you launch a Python entrypoint from outside the skill-local environment, the script re-launches itself with `skills/genericagent-browser-control/.venv`.
4. Wait for the browser extension to connect a session to the local bridge.
5. Run `python skills/genericagent-browser-control/scripts/scan_page.py` to inspect the current page.
6. Pipe JavaScript into `python skills/genericagent-browser-control/scripts/exec_js.py` for targeted actions.

## Notes

- The bridge defaults to port `18765` to match the vendored upstream extension.
- The skill-local virtual environment lives at `skills/genericagent-browser-control/.venv`.
- `setup_extension.ps1` is intentionally semi-automated. It opens the right pages, but the browser still requires manual confirmation for developer mode and unpacked extension loading.
- If `doctor.ps1` reports that `.venv` is missing, run `setup_venv.ps1` and then run `doctor.ps1` again.
