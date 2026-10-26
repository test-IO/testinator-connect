$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command cua-driver -ErrorAction SilentlyContinue)) {
    throw 'cua-driver is not on PATH.'
}

& "$PSScriptRoot\bin\vmfarmd.exe" desktop --config "$PSScriptRoot\config\windows-cua.toml"
