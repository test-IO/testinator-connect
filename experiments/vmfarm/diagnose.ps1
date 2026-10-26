# Prints what is needed to debug vmfarmd on this VM: service, processes, installed config, relay reachability, logs.
param(
    [string]$InstallDir = (Join-Path ([IO.Path]::GetFullPath("$PSScriptRoot\..\..")) 'vmfarmd-service')
)

function Section($title) { ''; "=== $title" }

Section 'service'
$service = Get-Service vmfarmd -ErrorAction SilentlyContinue
if ($service) { "$($service.Status), start type $($service.StartType)" } else { 'not installed' }

Section 'processes (vmfarmd, cua-driver)'
Get-CimInstance Win32_Process -Filter "Name='vmfarmd.exe' OR Name='cua-driver.exe'" | ForEach-Object {
    $parent = Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue
    $parentText = if ($parent) { "$($parent.ProcessName) ($($_.ParentProcessId))" } else { "gone ($($_.ParentProcessId))" }
    "{0} pid {1}, session {2}, started {3:HH:mm:ss}, parent {4}" -f $_.Name, $_.ProcessId, $_.SessionId, $_.CreationDate, $parentText
    "    $($_.CommandLine)"
}

Section "install folder $InstallDir"
Get-ChildItem $InstallDir -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name)  $($_.Length)" }

$toml = Join-Path $InstallDir 'vmfarmd.toml'
Section 'installed config'
if (Test-Path $toml) {
    Select-String -Path $toml -Pattern '^(listen|address|tls|server_name|ca_file|vm_id|key_file) ' | ForEach-Object { $_.Line }
} else {
    "no config at $toml"
}

Section 'relay reachable from here?'
$match = if (Test-Path $toml) { Select-String -Path $toml -Pattern '^address = "([^"]+)"' } else { $null }
if ($match) {
    $address = $match.Matches[0].Groups[1].Value
    $hostName, $port = $address.Split(':')
    $test = Test-NetConnection $hostName -Port $port -WarningAction SilentlyContinue
    "$address  TCP connect: $($test.TcpTestSucceeded)"
} else {
    'no relay address configured'
}

foreach ($log in 'vmfarmd-service', 'vmfarmd') {
    Section "$log log (last 20 lines)"
    $file = Get-ChildItem "$InstallDir\logs\$log.*" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^$log\.\d" } | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($file) { Get-Content $file.FullName -Tail 20 } else { 'no log yet' }
}
