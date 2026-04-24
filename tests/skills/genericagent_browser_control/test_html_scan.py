from genericagent_browser_control.html_scan import format_scan_result


def test_format_scan_result_limits_html_and_reports_tabs():
    result = format_scan_result(
        html="<main>" + ("x" * 500) + "</main>",
        tabs=[{"id": "tab-1", "title": "Inbox"}],
        maxchars=120,
    )
    assert result["html"].startswith("<main>")
    assert len(result["html"]) <= 120
    assert result["tabs"][0]["id"] == "tab-1"
