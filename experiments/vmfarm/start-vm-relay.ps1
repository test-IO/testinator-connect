# Test setup: runs the relay on this VM, so a Mac on the EPAM VPN can call the VM at http://<VM IP>:7420.
#
# Opens TCP 7420 in the Windows firewall for the EPAM VPN addresses only, reinstalls the service
# with a tunnel to this relay, then runs the relay in this window. Close the window or press
# Ctrl+C to stop the relay; the service keeps running and reconnects when the relay is back.
#Requires -RunAsAdministrator
param(
    [switch]$SkipServiceInstall
)
$ErrorActionPreference = 'Stop'

$rule = 'vmfarm relay test (TCP 7420)'
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort 7420 `
        -RemoteAddress 195.56.119.209, 195.56.119.212 -Action Allow | Out-Null
    "Opened TCP 7420 in the Windows firewall for 195.56.119.209 and 195.56.119.212 (EPAM VPN)."
}

if (-not $SkipServiceInstall) {
    & "$PSScriptRoot\install-service.ps1" -Config "$PSScriptRoot\config\windows-cua-local-relay.toml"
}

$ip = try {
    Invoke-RestMethod -Headers @{ 'Metadata-Flavor' = 'Google' } `
        'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip'
} catch { '<VM IP>' }
''
"Relay starting. From the Mac:"
"  curl -s http://${ip}:7420/vms -H 'Authorization: Bearer dev-tenant-token'"
"  MCP: http://${ip}:7420/vms/local-vm/mcp  (header Authorization: Bearer dev-tenant-token)"
''
& "$PSScriptRoot\bin\vmfarm-relay.exe" serve --config "$PSScriptRoot\config\relay-vm.toml"
