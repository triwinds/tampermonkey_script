def summarize_exec_result(
    *,
    result,
    page_reload: bool,
    new_tabs: list[dict],
    changed_elements: list[str],
) -> dict:
    return {
        "result": result,
        "page_reload": page_reload,
        "new_tabs": new_tabs,
        "changed_elements": changed_elements,
    }
