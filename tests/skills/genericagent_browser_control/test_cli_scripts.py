from subprocess import run


def test_setup_venv_script_supports_print_only():
    proc = run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "skills/genericagent-browser-control/scripts/setup_venv.ps1",
            "-PrintOnly",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert ".venv" in proc.stdout.lower()


def test_doctor_script_supports_quick_check():
    proc = run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "skills/genericagent-browser-control/scripts/doctor.ps1",
            "-Quick",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "bridge" in proc.stdout.lower()


def test_setup_extension_script_supports_print_only():
    proc = run(
        [
            "powershell",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            "skills/genericagent-browser-control/scripts/setup_extension.ps1",
            "-Browser",
            "chrome",
            "-PrintOnly",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "chrome://extensions" in proc.stdout.lower()
