import argparse

from _bootstrap import bootstrap


def _bootstrap() -> None:
    bootstrap()


def main() -> None:
    _bootstrap()

    from genericagent_browser_control.bridge import BrowserBridge
    from genericagent_browser_control.cli_output import print_json
    from genericagent_browser_control.html_scan import scan_page

    parser = argparse.ArgumentParser(description="Scan the active browser page.")
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--text-only", action="store_true")
    parser.add_argument("--maxchars", type=int, default=35000)
    args = parser.parse_args()

    bridge = BrowserBridge(listen_port=args.port)
    bridge.start()
    result = scan_page(bridge, text_only=args.text_only, maxchars=args.maxchars)
    print_json(result)


if __name__ == "__main__":
    main()
