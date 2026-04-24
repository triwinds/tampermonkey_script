param(
    [string]$Python = "python",
    [switch]$PrintOnly
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillRoot = Resolve-Path (Join-Path $scriptRoot "..")
$requirementsPath = Join-Path $skillRoot "requirements.txt"
$venvRoot = Join-Path $skillRoot ".venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"

if (-not (Test-Path $requirementsPath)) {
    throw "Requirements file not found: $requirementsPath"
}

Write-Output "Skill root: $skillRoot"
Write-Output "Venv path: $venvRoot"
Write-Output "Requirements file: $requirementsPath"
Write-Output "Python launcher: $Python"

if ($PrintOnly) {
    Write-Output "Next step: create or refresh the skill-local .venv"
    Write-Output "Next step: install requirements into the skill-local interpreter"
    return
}

if (-not (Test-Path $venvPython)) {
    & $Python -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create skill virtual environment with '$Python'"
    }
}

& $venvPython -m pip install -r $requirementsPath
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install requirements into $venvRoot"
}

Write-Output "Skill virtual environment ready: $venvPython"
