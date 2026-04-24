import argparse
import sys

from _bootstrap import bootstrap


def _bootstrap() -> None:
    bootstrap()


def main() -> None:
    _bootstrap()

    from genericagent_browser_control.bridge import BrowserBridge
    from genericagent_browser_control.cli_output import print_json
    from genericagent_browser_control.exec_js import exec_js

    parser = argparse.ArgumentParser(description="Execute JavaScript in the active browser tab.")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--no-monitor", action="store_true")
    parser.add_argument("--code", help="Inline JavaScript. Defaults to stdin when omitted.")
    args = parser.parse_args()

    code = args.code if args.code is not None else sys.stdin.read()
    bridge = BrowserBridge(listen_port=args.port)
    bridge.start()
    result = exec_js(bridge, code=code, no_monitor=args.no_monitor)
    print_json(result)


if __name__ == "__main__":
    main()
