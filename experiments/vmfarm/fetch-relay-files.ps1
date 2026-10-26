# Prepares config\windows-cua-remote-relay.toml from this VM's GCP metadata, so nothing has to be copied over RDP.
#
# Reads these instance metadata keys, set from a machine with gcloud (see README.md):
#   vmfarm-relay-cert     the relay's certificate      -> config\relay-cert.pem
#   vmfarm-relay-key      the daemon key               -> config\relay-key.txt
#   vmfarm-relay-address  host:port of the relay       -> address in the toml (optional)
# vm_id in the toml is set to this VM's instance name.
$ErrorActionPreference = 'Stop'

$metadata = 'http://metadata.google.internal/computeMetadata/v1/instance'
$headers = @{ 'Metadata-Flavor' = 'Google' }
$configDir = Join-Path $PSScriptRoot 'config'
$toml = Join-Path $configDir 'windows-cua-remote-relay.toml'

function Get-Metadata($path) {
    try { Invoke-RestMethod -Headers $headers "$metadata/$path" } catch { $null }
}

$cert = Get-Metadata 'attributes/vmfarm-relay-cert'
$key = Get-Metadata 'attributes/vmfarm-relay-key'
if (-not $cert -or -not $key) {
    throw "vmfarm-relay-cert and vmfarm-relay-key are not set in this VM's metadata."
}
[IO.File]::WriteAllText((Join-Path $configDir 'relay-cert.pem'), $cert)
[IO.File]::WriteAllText((Join-Path $configDir 'relay-key.txt'), $key.Trim())
'Wrote config\relay-cert.pem and config\relay-key.txt'

$lines = Get-Content $toml
$name = (Get-Metadata 'name').Trim()
$lines = $lines -replace '^vm_id = .*', "vm_id = `"$name`""
"vm_id = $name"

$address = Get-Metadata 'attributes/vmfarm-relay-address'
if ($address) {
    $lines = $lines -replace '^address = .*', "address = `"$($address.Trim())`""
    "address = $($address.Trim())"
} else {
    'vmfarm-relay-address is not set; edit address in the toml by hand.'
}
$lines | Set-Content $toml -Encoding ascii
"Updated $toml"
