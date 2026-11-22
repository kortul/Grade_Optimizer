$ErrorActionPreference = "Stop"

$modulePath = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
$current = [Environment]::GetEnvironmentVariable("MAYA_MODULE_PATH", "User")
$entries = @()
if (-not [string]::IsNullOrWhiteSpace($current)) {
    $entries = @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

$alreadyAdded = $false
foreach ($entry in $entries) {
    $normalized = $entry.Trim().TrimEnd('\', '/')
    if ($normalized.Equals($modulePath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $alreadyAdded = $true
        break
    }
}

if (-not $alreadyAdded) {
    $entries += $modulePath
    [Environment]::SetEnvironmentVariable("MAYA_MODULE_PATH", ($entries -join ';'), "User")
    Write-Host "Added Maya module path:" -ForegroundColor Green
} else {
    Write-Host "Maya module path is already installed:" -ForegroundColor Yellow
}
Write-Host "  $modulePath"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Close every running Maya window."
Write-Host "  2. Start Maya again."
Write-Host "  3. Open Windows > Settings/Preferences > Plug-in Manager."
Write-Host "  4. Find grade_optimizer.py and enable Loaded + Auto load."
Write-Host "  5. Use the Grade Optimizer menu at the top of Maya."
