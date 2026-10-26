# Calls a VM through the relay's tenant API, the way tooling will.
param(
    [string]$Relay = 'http://127.0.0.1:7420',
    [string]$Token = 'dev-tenant-token',
    [string]$VmId = 'dev-mac'
)
$ErrorActionPreference = 'Stop'
$headers = @{ Authorization = "Bearer $Token" }

function Invoke-Vm($command) {
    Invoke-RestMethod -Method Post -Uri "$Relay/vms/$VmId/control" -Headers $headers `
        -ContentType 'application/json' -Body ($command | ConvertTo-Json -Depth 10)
}

'--- VMs the relay knows'
(Invoke-RestMethod "$Relay/vms" -Headers $headers).vms | ConvertTo-Json -Depth 5

'--- daemon health, through the tunnel'
Invoke-RestMethod "$Relay/vms/$VmId/health" -Headers $headers | ConvertTo-Json

'--- session_start'
$start = Invoke-Vm @{ op = 'session_start'; session_id = 'relay-smoke' }
'Tools: ' + (($start.result.tools | ForEach-Object { $_.name }) -join ', ')

'--- get_screen_size (cua-driver), timed'
$timer = [Diagnostics.Stopwatch]::StartNew()
(Invoke-Vm @{ op = 'call_tool'; session_id = 'relay-smoke'; name = 'get_screen_size' }).result | ConvertTo-Json -Depth 10
"Round trip: $($timer.ElapsedMilliseconds) ms"

'--- session_end'
Invoke-Vm @{ op = 'session_end'; session_id = 'relay-smoke' } | Out-Null
'done'
