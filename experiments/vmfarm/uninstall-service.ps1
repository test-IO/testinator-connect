# Stops and removes the vmfarmd Windows Service. The files in its install folder stay.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

if (-not (Get-Service vmfarmd -ErrorAction SilentlyContinue)) {
    'The vmfarmd service is not installed.'
    return
}
sc.exe stop vmfarmd | Out-Null
sc.exe delete vmfarmd | Out-Null
while (Get-Service vmfarmd -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }
'Removed the vmfarmd service. Its vmfarmd desktop process and cua-driver stopped with it.'
