param(
    [ValidateSet("chrome", "edge")]
    [string]$Browser = "chrome",
    [switch]$PrintOnly
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$skillRoot = Resolve-Path (Join-Path $scriptRoot "..")
$extensionPath = Resolve-Path (Join-Path $skillRoot "assets\\tmwd_cdp_bridge")
$manifestPath = Join-Path $extensionPath "manifest.json"

if (-not (Test-Path $manifestPath)) {
    throw "Extension manifest not found: $manifestPath"
}

$extensionsUrl = if ($Browser -eq "edge") { "edge://extensions" } else { "chrome://extensions" }

Write-Output "Extensions page: $extensionsUrl"
Write-Output "Extension path: $extensionPath"
Write-Output "Manifest path: $manifestPath"
Write-Output "Next step: enable developer mode"
Write-Output "Next step: click load unpacked"
Write-Output "Next step: choose the extension folder above"

if (-not $PrintOnly) {
    Start-Process $extensionsUrl
    Start-Process explorer.exe $extensionPath
}
