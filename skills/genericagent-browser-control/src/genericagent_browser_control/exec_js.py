import time

from genericagent_browser_control.result_format import summarize_exec_result


def _merge_new_tabs(*tab_groups: list[dict]) -> list[dict]:
    seen = set()
    merged = []
    for group in tab_groups:
        for tab in group:
            tab_id = str(tab.get("id", ""))
            if tab_id in seen:
                continue
            seen.add(tab_id)
            merged.append(tab)
    return merged


def collect_execution_outcome(
    bridge,
    code: str,
    *,
    no_monitor: bool,
    session_id: str | None = None,
) -> dict:
    before_tabs = [] if no_monitor else bridge.list_tabs()
    before_ids = {tab["id"] for tab in before_tabs}
    raw_result = bridge.execute_js(code, session_id=session_id)
    if no_monitor:
        observed_new_tabs = []
    else:
        time.sleep(1)
        after_tabs = bridge.list_tabs()
        observed_new_tabs = [tab for tab in after_tabs if tab["id"] not in before_ids]
    bridge_new_tabs = raw_result.get("newTabs", [])
    page_reload = bool(raw_result.get("closed")) or "reloaded" in str(raw_result.get("result", "")).lower()
    return {
        "result": raw_result.get("data", raw_result.get("result", raw_result)),
        "page_reload": page_reload,
        "new_tabs": _merge_new_tabs(bridge_new_tabs, observed_new_tabs),
        "changed_elements": [],
    }


def exec_js(
    bridge,
    code: str,
    *,
    no_monitor: bool = False,
    session_id: str | None = None,
) -> dict:
    outcome = collect_execution_outcome(
        bridge,
        code=code,
        no_monitor=no_monitor,
        session_id=session_id,
    )
    return summarize_exec_result(
        result=outcome["result"],
        page_reload=outcome["page_reload"],
        new_tabs=outcome["new_tabs"],
        changed_elements=outcome["changed_elements"],
    )
