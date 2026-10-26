$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:7410'

function Invoke-Daemon($command) {
    Invoke-RestMethod -Method Post -Uri "$base/control" -ContentType 'application/json' `
        -Body ($command | ConvertTo-Json -Depth 10)
}

'--- health'
Invoke-RestMethod "$base/health" | ConvertTo-Json

'--- session_start'
$start = Invoke-Daemon @{ op = 'session_start'; session_id = 'smoke' }
'Servers: ' + ($start.result.servers -join ', ')
'Tools:   ' + (($start.result.tools | ForEach-Object { $_.name }) -join ', ')
'cua-driver processes while the session runs: ' + @(Get-Process cua-driver -ErrorAction SilentlyContinue).Count

'--- get_vm_info'
(Invoke-Daemon @{ op = 'call_tool'; session_id = 'smoke'; name = 'get_vm_info' }).result.structuredContent | ConvertTo-Json

'--- get_screen_size (cua-driver)'
(Invoke-Daemon @{ op = 'call_tool'; session_id = 'smoke'; name = 'get_screen_size' }).result | ConvertTo-Json -Depth 10

'--- session_end'
Invoke-Daemon @{ op = 'session_end'; session_id = 'smoke' } | Out-Null
Start-Sleep -Seconds 2
'cua-driver processes after the session ended: ' + @(Get-Process cua-driver -ErrorAction SilentlyContinue).Count
