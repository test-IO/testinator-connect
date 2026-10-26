# Installs vmfarmd as a Windows Service, or updates it when it is already installed.
#
# The service runs a copy of vmfarmd.exe in -InstallDir, never bin\ in this folder, so
# updating these files does not fight a running service. Put -InstallDir inside a folder
# the endpoint protection (SentinelOne) allows, because vmfarmd.exe starts cua-driver and ffmpeg.
#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,
    [string]$Config = "$PSScriptRoot\config\windows-cua.toml"
)
$ErrorActionPreference = 'Stop'

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$exe = Join-Path $InstallDir 'vmfarmd.exe'
$installedConfig = Join-Path $InstallDir 'vmfarmd.toml'

if (Get-Service vmfarmd -ErrorAction SilentlyContinue) {
    'Removing the installed service first...'
    sc.exe stop vmfarmd | Out-Null
    sc.exe delete vmfarmd | Out-Null
    while (Get-Service vmfarmd -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }
}
Get-Process vmfarmd -ErrorAction SilentlyContinue | Wait-Process -Timeout 30 -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force $InstallDir | Out-Null
Copy-Item "$PSScriptRoot\bin\vmfarmd.exe" $exe -Force
Copy-Item $Config $installedConfig -Force
$configDir = Split-Path $Config
foreach ($extra in 'relay-cert.pem', 'relay-key.txt') {
    $source = Join-Path $configDir $extra
    if (Test-Path $source) { Copy-Item $source (Join-Path $InstallDir $extra) -Force }
}

& $exe install --config $installedConfig
if ($LASTEXITCODE -ne 0) { throw "vmfarmd install failed with exit code $LASTEXITCODE" }

''
"Binary: $exe"
"Config: $installedConfig  (edit it, then: Restart-Service vmfarmd)"
"Logs:   $InstallDir\logs\  (vmfarmd-service.* is the supervisor, vmfarmd.* the desktop process)"
