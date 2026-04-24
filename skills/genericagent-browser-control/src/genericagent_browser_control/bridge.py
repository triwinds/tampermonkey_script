import time
from typing import Any

from genericagent_browser_control.tmwebdriver import TMWebDriver

DEFAULT_LISTEN_PORT = 18765


def create_driver(listen_port: int = DEFAULT_LISTEN_PORT) -> TMWebDriver:
    return TMWebDriver(port=listen_port)


def wait_for_first_session(driver: TMWebDriver, timeout_seconds: int = 20) -> str:
    for _ in range(timeout_seconds):
        sessions = driver.get_all_sessions()
        if sessions:
            first = sessions[0]
            if isinstance(first, dict):
                return str(first["id"])
            return str(first)
        time.sleep(1)
    raise RuntimeError("No browser session connected within timeout")


class BrowserBridge:
    def __init__(self, listen_port: int = DEFAULT_LISTEN_PORT):
        self.listen_port = listen_port
        self.driver: TMWebDriver | None = None

    def start(self) -> None:
        if self.driver is None:
            self.driver = create_driver(self.listen_port)

    def wait_for_session(self, timeout_seconds: int = 20) -> str:
        self.start()
        assert self.driver is not None
        return wait_for_first_session(self.driver, timeout_seconds=timeout_seconds)

    def require_session(self) -> str:
        return self.wait_for_session()

    def list_tabs(self) -> list[dict[str, Any]]:
        self.start()
        assert self.driver is not None
        tabs = []
        for session in self.driver.get_all_sessions():
            tabs.append(
                {
                    "id": str(session.get("id", "")),
                    "title": session.get("title", ""),
                    "url": session.get("url", ""),
                }
            )
        return tabs

    def execute_js(
        self,
        code: str,
        *,
        session_id: str | None = None,
        timeout: int = 15,
    ) -> dict[str, Any]:
        self.start()
        assert self.driver is not None
        active_session = session_id or self.require_session()
        result = self.driver.execute_js(code, timeout=timeout, session_id=active_session)
        if isinstance(result, dict):
            return result
        return {"data": result}
