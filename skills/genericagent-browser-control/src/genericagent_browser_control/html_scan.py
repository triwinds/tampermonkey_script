from bs4 import BeautifulSoup

SCAN_SCRIPT = """
(() => {
  const html = document.documentElement?.outerHTML ?? "";
  return { html };
})()
"""


def extract_html_snapshot(bridge, *, maxchars: int, text_only: bool = False) -> str:
    payload = bridge.execute_js(SCAN_SCRIPT)
    data = payload.get("data", payload)
    if isinstance(data, dict):
        html = str(data.get("html") or "")
    else:
        html = str(data or "")
    if text_only:
        html = BeautifulSoup(html, "html.parser").get_text("\n", strip=True)
    return html[:maxchars]


def format_scan_result(*, html: str, tabs: list[dict], maxchars: int) -> dict:
    clipped = html[:maxchars]
    return {"html": clipped, "tabs": tabs}


def scan_page(bridge, *, text_only: bool = False, maxchars: int = 35000) -> dict:
    html = extract_html_snapshot(bridge, maxchars=maxchars, text_only=text_only)
    tabs = bridge.list_tabs()
    return format_scan_result(html=html, tabs=tabs, maxchars=maxchars)
