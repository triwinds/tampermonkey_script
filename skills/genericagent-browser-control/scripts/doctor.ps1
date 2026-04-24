param([switch]$Quick)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillRoot = Resolve-Path (Join-Path $scriptRoot "..")
$extensionRoot = Resolve-Path (Join-Path $skillRoot "assets\\tmwd_cdp_bridge")
$manifestPath = Join-Path $extensionRoot "manifest.json"
$bridgeModulePath = Join-Path $skillRoot "src\\genericagent_browser_control\\bridge.py"
$requirementsPath = Join-Path $skillRoot "requirements.txt"
$setupVenvScript = Join-Path $scriptRoot "setup_venv.ps1"
$venvRoot = Join-Path $skillRoot ".venv"
$venvPython = Join-Path $venvRoot "Scripts\\python.exe"

if (-not (Test-Path $bridgeModulePath)) {
    throw "Bridge package not found: $bridgeModulePath"
}

if (-not (Test-Path $manifestPath)) {
    throw "Extension manifest not found: $manifestPath"
}

if (-not (Test-Path $requirementsPath)) {
    throw "Requirements file not found: $requirementsPath"
}

Write-Output "Bridge package source: OK"
Write-Output "Extension folder: OK"
Write-Output "Extension manifest: OK"
Write-Output "Requirements file: OK"

if (-not (Test-Path $venvPython)) {
    Write-Output "Skill virtual environment: MISSING"
    Write-Output "Run: powershell -ExecutionPolicy Bypass -File `"$setupVenvScript`""
    Write-Output "Bridge package import: skipped until .venv is created"
    if (-not $Quick) {
        throw "Skill virtual environment not found: $venvPython"
    }
    return
}

Write-Output "Skill virtual environment: OK"

$env:PYTHONPATH = "$skillRoot\\src"
$null = & $venvPython -c "from genericagent_browser_control.bridge import BrowserBridge; print(BrowserBridge.__name__)"
if ($LASTEXITCODE -ne 0) {
    throw "Bridge package import failed using the skill-local .venv"
}

Write-Output "Bridge package import: OK"

if ($Quick) {
    Write-Output "Session probe skipped in quick mode"
}
else {
    Write-Output "Session probe skipped (no running browser session required)"
}
