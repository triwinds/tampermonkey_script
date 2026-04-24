import json
import sys


def print_json(payload, *, stream=None) -> None:
    target = stream or sys.stdout
    text = json.dumps(payload, ensure_ascii=False)
    binary = getattr(target, "buffer", None)
    if binary is not None:
        binary.write(text.encode("utf-8"))
        binary.write(b"\n")
        binary.flush()
        return
    target.write(text + "\n")
    target.flush()
