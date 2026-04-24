import argparse
import time

from _bootstrap import bootstrap


def _bootstrap() -> None:
    bootstrap()


def main() -> None:
    _bootstrap()

    from genericagent_browser_control.bridge import BrowserBridge
    from genericagent_browser_control.cli_output import print_json

    parser = argparse.ArgumentParser(description="Start the local browser bridge.")
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()

    bridge = BrowserBridge(listen_port=args.port)
    bridge.start()
    print_json({"status": "listening", "port": args.port})

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print_json({"status": "stopped"})


if __name__ == "__main__":
    main()
