from genericagent_browser_control.result_format import summarize_exec_result
from genericagent_browser_control.exec_js import collect_execution_outcome


def test_summarize_exec_result_reports_reload_and_new_tabs():
    summary = summarize_exec_result(
        result={"value": 1},
        page_reload=True,
        new_tabs=[{"id": "tab-2", "title": "Done"}],
        changed_elements=["#submit"],
    )
    assert summary["page_reload"] is True
    assert summary["new_tabs"][0]["id"] == "tab-2"
    assert "#submit" in summary["changed_elements"]


def test_collect_execution_outcome_skips_tab_sampling_when_no_monitor():
    class FakeBridge:
        def __init__(self):
            self.list_tabs_calls = 0

        def list_tabs(self):
            self.list_tabs_calls += 1
            raise AssertionError("list_tabs should not be called when no_monitor=True")

        def execute_js(self, code, session_id=None):
            assert code == "document.title"
            return {"data": "Example Title", "newTabs": [{"id": "tab-2", "title": "Done"}]}

    outcome = collect_execution_outcome(FakeBridge(), code="document.title", no_monitor=True)
    assert outcome["result"] == "Example Title"
    assert outcome["new_tabs"][0]["id"] == "tab-2"
    assert outcome["page_reload"] is False
