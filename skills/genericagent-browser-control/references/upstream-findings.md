# Upstream Findings

- `ga.py:first_init_driver`
- `ga.py:web_scan`
- `ga.py:web_execute_js`
- `TMWebDriver.py`
- `simphtml.py:execute_js_rich`
- `assets/tmwd_cdp_bridge/background.js`

## Vendored boundaries

- Reuse the bridge and extension core needed to connect an existing Chromium session.
- Do not reuse GenericAgent memory/runtime integration as part of the public skill surface.
- Keep the Codex-facing API limited to `setup_extension`, `doctor`, `start_bridge`, `scan_page`, and `exec_js`.
