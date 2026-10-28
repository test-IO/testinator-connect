# Test setup: runs the relay on this VM in the background, started at every boot, so a Mac on the
# EPAM VPN can reach the VM at http://<VM IP>:7420 after a reboot without anyone logging in.
# In the farm, the relay runs on the farm's server instead, and nothing of it is on the VM.
#
# Opens TCP 7420 for the EPAM VPN addresses, installs the vmfarmd service with a tunnel to this relay,
# then registers a hidden SYSTEM scheduled task for the relay. Run it again after `git pull` to update.
#Requires -RunAsAdministrator
param(
    [string]$InstallDir = (Join-Path ([IO.Path]::GetFullPath("$PSScriptRoot\..\..")) 'vmfarmd-service'),
    [switch]$SkipServiceInstall
)
$ErrorActionPreference = 'Stop'

$taskName = 'vmfarm-relay-test'
$relayDir = Join-Path $InstallDir 'relay'
$relayExe = Join-Path $relayDir 'vmfarm-relay.exe'
$relayConfig = Join-Path $relayDir 'relay.toml'
$relayLog = Join-Path $relayDir 'relay.log'

$rule = 'vmfarm relay test (TCP 7420)'
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort 7420 `
        -RemoteAddress 195.56.119.209, 195.56.119.212 -Action Allow | Out-Null
    "Opened TCP 7420 in the Windows firewall for 195.56.119.209 and 195.56.119.212 (EPAM VPN)."
}

if (-not $SkipServiceInstall) {
    & "$PSScriptRoot\install-service.ps1" -InstallDir $InstallDir -Config "$PSScriptRoot\config\windows-cua-local-relay.toml"
}

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Get-Process vmfarm-relay -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force $relayDir | Out-Null
Copy-Item "$PSScriptRoot\bin\vmfarm-relay.exe" $relayExe -Force
Copy-Item "$PSScriptRoot\config\relay-vm.toml" $relayConfig -Force

# The relay runs as SYSTEM, whose PATH may not have ffmpeg; it joins and encodes the relay's recordings.
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($ffmpeg) {
    Add-Content $relayConfig "`n[recordings]`nffmpeg = '$ffmpeg'"
} else {
    Write-Warning 'ffmpeg is not on PATH; relay recordings will fail when they stop.'
}

$command = '/c ""{0}" serve --config "{1}" >> "{2}" 2>&1"' -f $relayExe, $relayConfig, $relayLog
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $command -WorkingDirectory $relayDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$ip = try {
    Invoke-RestMethod -Headers @{ 'Metadata-Flavor' = 'Google' } `
        'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip'
} catch { '<VM IP>' }
''
"Relay task '$taskName' installed and started; it starts at every boot."
"  log:    $relayLog"
"  status: Get-ScheduledTask $taskName; Get-Process vmfarm-relay"
"  remove: Unregister-ScheduledTask $taskName -Confirm:`$false; Stop-Process -Name vmfarm-relay -Force"
''
"From the Mac:"
"  curl -s http://${ip}:7420/vms -H 'Authorization: Bearer dev-tenant-token'"
"  viewer: http://${ip}:7420/viewer?vm=local-vm#token=dev-tenant-token"
