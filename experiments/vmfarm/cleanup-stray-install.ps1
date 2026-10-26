# One-off: removes the service that was installed into C:\User\... by a typo, cleans up,
# reinstalls into this checkout with the remote-relay config, and prints the diagnosis.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$stray = 'C:\User'
$strayLogs = 'C:\User\jiayi_zheng\Downloads\testinator-connect\testinator-connect-main\vmfarmd-service\logs'

''
'=== cua-driver processes before cleanup'
Get-CimInstance Win32_Process -Filter "Name='cua-driver.exe'" | ForEach-Object {
    "pid $($_.ProcessId), parent $($_.ParentProcessId), started $($_.CreationDate)"
    "    $($_.CommandLine)"
}

''
'=== what the stray install logged about MCP servers and sessions'
if (Test-Path $strayLogs) {
    $lines = Select-String -Path "$strayLogs\vmfarmd.*" -Pattern 'started MCP server|session started|session ended' | ForEach-Object { $_.Line }
    if ($lines) { $lines | Select-Object -Last 10 } else { 'nothing: it never started cua-driver' }
} else {
    "no logs at $strayLogs"
}

''
'=== removing the service and leftover cua-driver'
& "$PSScriptRoot\uninstall-service.ps1"
Get-Process cua-driver -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process vmfarmd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

if (Test-Path $stray) {
    $top = @(Get-ChildItem $stray -Force | Select-Object -ExpandProperty Name)
    if ($top.Count -eq 1 -and $top[0] -eq 'jiayi_zheng') {
        Remove-Item -Recurse -Force $stray
        "Removed $stray"
    } else {
        "Left $stray in place, because it contains: $($top -join ', ')"
    }
}

''
'=== installing into this checkout'
& "$PSScriptRoot\install-service.ps1" -Config "$PSScriptRoot\config\windows-cua-remote-relay.toml"

''
'Waiting 15 s for the tunnel...'
Start-Sleep -Seconds 15
& "$PSScriptRoot\diagnose.ps1"
