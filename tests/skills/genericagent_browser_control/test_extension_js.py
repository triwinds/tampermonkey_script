from pathlib import Path
from subprocess import run


def test_cookie_utils_node_suite_passes():
    test_file = Path(__file__).with_name("test_cookie_utils.js")
    proc = run(
        ["node", str(test_file)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
