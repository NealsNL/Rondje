# Downloads the parts of BRouter that are too large to keep in git:
#   - the BRouter engine jar        -> brouter/brouter-1.7.9-all.jar
#   - the NL/BE map segments (.rd5) -> brouter/segments4/
#   - a portable Java runtime       -> brouter/jre/   (only if missing)
#
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts\download-brouter.ps1

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # much faster Invoke-WebRequest

$root = Split-Path -Parent $PSScriptRoot
$brouter = Join-Path $root "brouter"
$segments = Join-Path $brouter "segments4"
$tmp = Join-Path $env:TEMP "routeplanner-dl"

$brouterVersion = "1.7.9"
$zipUrl = "https://github.com/abrensch/brouter/releases/download/v$brouterVersion/brouter-$brouterVersion.zip"
$segmentBase = "https://brouter.de/brouter/segments4"
$segmentTiles = @("E0_N50", "E5_N50", "E0_N45", "E5_N45")
$jreUrl = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse"

New-Item -ItemType Directory -Force -Path $brouter, $segments, $tmp | Out-Null

# --- BRouter engine jar (extracted from the release zip) ---
$jar = Join-Path $brouter "brouter-$brouterVersion-all.jar"
if (-not (Test-Path $jar)) {
  Write-Host "BRouter jar downloaden..."
  $zip = Join-Path $tmp "brouter.zip"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zip
  $extract = Join-Path $tmp "brouter-zip"
  if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
  Expand-Archive -Path $zip -DestinationPath $extract
  $foundJar = Get-ChildItem -Path $extract -Recurse -Filter "*-all.jar" | Select-Object -First 1
  Copy-Item $foundJar.FullName $jar
  Write-Host "  -> $jar"
} else {
  Write-Host "BRouter jar staat er al."
}

# --- Map segments (NL + BE) ---
foreach ($tile in $segmentTiles) {
  $dest = Join-Path $segments "$tile.rd5"
  if (Test-Path $dest) {
    Write-Host "Segment $tile staat er al."
    continue
  }
  Write-Host "Segment $tile downloaden (kan groot zijn)..."
  Invoke-WebRequest -Uri "$segmentBase/$tile.rd5" -OutFile $dest
  Write-Host "  -> $dest"
}

# --- Portable Java runtime (only if not already bundled) ---
$java = Join-Path $brouter "jre\bin\java.exe"
if (-not (Test-Path $java)) {
  Write-Host "Java-runtime downloaden..."
  $jreZip = Join-Path $tmp "jre.zip"
  Invoke-WebRequest -Uri $jreUrl -OutFile $jreZip
  $jreExtract = Join-Path $tmp "jre-zip"
  if (Test-Path $jreExtract) { Remove-Item -Recurse -Force $jreExtract }
  Expand-Archive -Path $jreZip -DestinationPath $jreExtract
  $inner = Get-ChildItem -Path $jreExtract -Directory | Select-Object -First 1
  $jreDest = Join-Path $brouter "jre"
  if (Test-Path $jreDest) { Remove-Item -Recurse -Force $jreDest }
  Copy-Item $inner.FullName $jreDest -Recurse
  Write-Host "  -> $jreDest"
} else {
  Write-Host "Java-runtime staat er al."
}

Write-Host ""
Write-Host "Klaar. Start de routeserver met:  npm run brouter"
