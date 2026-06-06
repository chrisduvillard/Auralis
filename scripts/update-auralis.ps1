# Auralis Windows fallback updater.
# Downloads the latest public GitHub Release installer, verifies it against latest.yml,
# closes Auralis, installs silently, then relaunches the app unless -NoLaunch is set.

Param(
  [string]$Repo = "chrisduvillard/Auralis",
  [string]$TempDir = (Join-Path $env:TEMP "AuralisUpdate"),
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Convert-HexSha512ToBase64 {
  Param([Parameter(Mandatory = $true)][string]$HashHex)

  if ($HashHex.Length % 2 -ne 0) {
    throw "Invalid SHA512 hex digest length."
  }

  $hashBytes = for ($index = 0; $index -lt $HashHex.Length; $index += 2) {
    [Convert]::ToByte($HashHex.Substring($index, 2), 16)
  }

  return [Convert]::ToBase64String([byte[]]$hashBytes)
}

function Get-LatestYamlSha512 {
  Param([Parameter(Mandatory = $true)][string]$Metadata)

  $match = [regex]::Match($Metadata, '(?m)^sha512:\s*"?([^"\r\n]+)"?\s*$')
  if (-not $match.Success) {
    throw "Could not read sha512 from latest.yml."
  }

  return $match.Groups[1].Value.Trim()
}

function Get-LatestYamlInstallerPath {
  Param([Parameter(Mandatory = $true)][string]$Metadata)

  $match = [regex]::Match($Metadata, '(?m)^path:\s*"?([^"\r\n]+)"?\s*$')
  if (-not $match.Success) {
    throw "Could not read installer path from latest.yml."
  }

  return $match.Groups[1].Value.Trim()
}

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$headers = @{ "User-Agent" = "Auralis-PowerShell-Updater" }
$releaseApi = "https://api.github.com/repos/$Repo/releases/latest"

Write-Host "Checking latest Auralis release from $Repo..."
$release = Invoke-RestMethod -Headers $headers -Uri $releaseApi

$metadataAsset = $release.assets |
  Where-Object { $_.name -eq 'latest.yml' } |
  Select-Object -First 1

if (-not $metadataAsset) {
  throw "No latest.yml metadata found on the latest GitHub release."
}

$metadataPath = Join-Path $TempDir "latest.yml"

Write-Host "Latest release: $($release.tag_name)"
Write-Host "Downloading updater metadata..."
Invoke-WebRequest -Headers $headers -Uri $metadataAsset.browser_download_url -OutFile $metadataPath

$metadata = Get-Content $metadataPath -Raw
$installerFileName = Get-LatestYamlInstallerPath -Metadata $metadata

if ([IO.Path]::GetFileName($installerFileName) -ne $installerFileName) {
  throw "latest.yml points to installer outside the release root: $installerFileName"
}
if ($installerFileName -notmatch '^Auralis-Setup-[0-9]+\.[0-9]+\.[0-9]+\.exe$') {
  throw "latest.yml points to installer with unexpected name: $installerFileName"
}

$installerAssets = @($release.assets | Where-Object { $_.name -eq $installerFileName })
if ($installerAssets.Count -ne 1) {
  throw "Could not find exactly one GitHub Release installer asset named $installerFileName."
}

$installerAsset = $installerAssets[0]
$installerPath = Join-Path $TempDir $installerFileName

Write-Host "Downloading installer: $installerFileName"
Invoke-WebRequest -Headers $headers -Uri $installerAsset.browser_download_url -OutFile $installerPath

$expectedSha512 = Get-LatestYamlSha512 -Metadata $metadata
$actualSha512 = Convert-HexSha512ToBase64 -HashHex (Get-FileHash -Algorithm SHA512 -Path $installerPath).Hash

if ($actualSha512 -ne $expectedSha512) {
  throw "Installer SHA512 mismatch. Refusing to install."
}

Write-Host "Installer verified against latest.yml."
Write-Host "Closing Auralis if it is running..."
Stop-Process -Name "Auralis" -Force -ErrorAction SilentlyContinue

Write-Host "Installing Auralis silently..."
$process = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru
if ($process.ExitCode -ne 0) {
  throw "Auralis installer failed with exit code $($process.ExitCode)."
}

$appPath = Join-Path $env:LOCALAPPDATA "Programs\Auralis\Auralis.exe"
if (-not $NoLaunch -and (Test-Path $appPath)) {
  Write-Host "Relaunching Auralis..."
  Start-Process $appPath
}

Write-Host "Auralis updated successfully."
