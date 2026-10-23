# Finishes a release: builds the draft's commit, signs it with the USB token, uploads the
# Windows installer and publishes the draft. Run `npm run release:win`; see RELEASING.md.
param(
  # Defaults to the only draft release.
  [string] $Version,
  # Emergency build that stays on its version; see "Emergency" in RELEASING.md.
  [switch] $DisableAutoUpdate
)

$ErrorActionPreference = 'Stop'
$repo = 'test-IO/testinator-connect'
$installer = 'Agentic-QA-Connect-Setup-win-x64.exe'

# .env.local holds GH_TOKEN and the AIRBRAKE_* keys (the build reads AIRBRAKE_* from it too).
if (Test-Path .env.local) {
  foreach ($line in Get-Content .env.local) {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') { Set-Item "env:$($Matches[1])" ($Matches[2].Trim('"', "'")) }
  }
}
foreach ($name in 'GH_TOKEN', 'AIRBRAKE_PROJECT_ID', 'AIRBRAKE_PROJECT_KEY') {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is missing in .env.local" }
}
$headers = @{ Authorization = "Bearer $env:GH_TOKEN"; Accept = 'application/vnd.github+json' }

function Get-Draft {
  $drafts = @(Invoke-RestMethod -Headers $headers "https://api.github.com/repos/$repo/releases?per_page=30" |
    Where-Object { $_.draft -and (-not $Version -or $_.tag_name -eq "v$Version") })
  if ($drafts.Count -eq 0) { throw 'No draft release. CI creates it when main gets a new version.' }
  if ($drafts.Count -gt 1) { throw "Several drafts: $($drafts.tag_name -join ', '). Run with -Version." }
  $drafts[0]
}

$draft = Get-Draft
$tag = $draft.tag_name
Write-Host "Releasing $tag (commit $($draft.target_commitish))"

if (git status --porcelain) { throw 'Commit or stash local changes first.' }
$original = git rev-parse --abbrev-ref HEAD
if ($original -eq 'HEAD') { $original = git rev-parse HEAD }

git fetch --quiet origin
git checkout --quiet --detach $draft.target_commitish
try {
  # The lockfile only carries the macOS rollup binary (npm/cli#4828).
  npm install --no-package-lock
  if ($LASTEXITCODE) { throw 'npm install failed' }

  $zip = Join-Path $env:TEMP 'uv-win.zip'
  Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath (Join-Path $env:TEMP 'uv-win') -Force
  Move-Item (Join-Path $env:TEMP 'uv-win\uv.exe') 'resources\uv-windows-x64.exe' -Force

  $env:MAIN_VITE_AUTO_UPDATE = if ($DisableAutoUpdate) { 'false' } else { 'true' }
  npm run build
  if ($LASTEXITCODE) { throw 'npm run build failed' }

  # Signs with electron-builder.win-signed.yml and writes latest.yml from the signed files.
  npx electron-builder --win --publish always --config electron-builder.win-signed.yml `
    --config.forceCodeSigning=true --config.publish.releaseType=draft
  if ($LASTEXITCODE) { throw 'electron-builder failed' }

  $signature = Get-AuthenticodeSignature "dist\$installer"
  if ($signature.Status -ne 'Valid') { throw "$installer signature: $($signature.Status)" }
  Write-Host "Signed by: $($signature.SignerCertificate.Subject)"
}
finally {
  git checkout --quiet $original
}

$assets = (Get-Draft).assets.name
$missing = @($installer, 'latest.yml', 'latest-mac.yml') | Where-Object { $assets -notcontains $_ }
if ($missing) { throw "Draft $tag is missing $($missing -join ', '); not publishing. Check the macOS job." }

$body = @{ draft = $false; make_latest = 'true' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Headers $headers -Body $body "https://api.github.com/repos/$repo/releases/$($draft.id)" | Out-Null
Write-Host "$tag is published. Running apps update to it on their next check."
