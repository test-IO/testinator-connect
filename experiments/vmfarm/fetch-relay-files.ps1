# Writes config\windows-cua-remote-relay.local.toml from the template and this VM's GCP metadata,
# so nothing has to be copied over RDP. The .local.toml is git-ignored, so `git pull` never conflicts with it.
#
# Reads these instance metadata keys, set from a machine with gcloud (see README.md):
#   vmfarm-relay-cert     the relay's certificate      -> config\relay-cert.pem
#   vmfarm-relay-key      the daemon key               -> config\relay-key.txt
#   vmfarm-relay-address  host:port of the relay       -> address in the .local.toml (optional)
# vm_id in the .local.toml is set to this VM's instance name.
$ErrorActionPreference = 'Stop'

$metadata = 'http://metadata.google.internal/computeMetadata/v1/instance'
$headers = @{ 'Metadata-Flavor' = 'Google' }
$configDir = Join-Path $PSScriptRoot 'config'
$template = Join-Path $configDir 'windows-cua-remote-relay.toml'
$toml = Join-Path $configDir 'windows-cua-remote-relay.local.toml'

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

$lines = Get-Content $template
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
"Wrote $toml; install it with: install-service.ps1 -Config $toml"
