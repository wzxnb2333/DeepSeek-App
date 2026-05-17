[CmdletBinding()]
param(
  [string]$AppDir,
  [string]$MakeDir,
  [switch]$RequireMake,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json
$version = $packageJson.version
if (-not $AppDir) {
  $AppDir = Join-Path $desktopRoot "out\DeepSeek App-win32-x64"
}
if (-not $MakeDir) {
  $MakeDir = Join-Path $desktopRoot "out\make"
}

$checks = @(
  @{ Name = "desktop exe"; Path = Join-Path $AppDir "deepseek-app.exe"; MinBytes = 10000000; Required = $true },
  @{ Name = "runtime cli"; Path = Join-Path $AppDir "resources\bin\deepseek.exe"; MinBytes = 1000000; Required = $true },
  @{ Name = "runtime tui"; Path = Join-Path $AppDir "resources\bin\deepseek-tui.exe"; MinBytes = 1000000; Required = $true },
  @{ Name = "squirrel setup"; Path = Join-Path $MakeDir "squirrel.windows\x64\DeepSeekAppSetup.exe"; MinBytes = 10000000; Required = [bool]$RequireMake },
  @{ Name = "squirrel nupkg"; Path = Join-Path $MakeDir "squirrel.windows\x64\deepseek_app-$version-full.nupkg"; MinBytes = 10000000; Required = [bool]$RequireMake },
  @{ Name = "squirrel releases"; Path = Join-Path $MakeDir "squirrel.windows\x64\RELEASES"; MinBytes = 1; Required = [bool]$RequireMake },
  @{ Name = "zip artifact"; Path = Join-Path $MakeDir "zip\win32\x64\DeepSeek App-win32-x64-$version.zip"; MinBytes = 10000000; Required = [bool]$RequireMake }
)

$results = @(
  foreach ($check in $checks) {
    $exists = Test-Path -LiteralPath $check.Path
    $length = if ($exists) { (Get-Item -LiteralPath $check.Path).Length } else { 0 }
    $required = [bool]$check.Required
    [pscustomobject]@{
      Name = $check.Name
      Required = $required
      Exists = $exists
      Length = $length
      MinBytes = $check.MinBytes
      Ok = (-not $required -and -not $exists) -or ($exists -and $length -ge $check.MinBytes)
      Path = $check.Path
    }
  }
)

if ($RequireMake) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipPath = Join-Path $MakeDir "zip\win32\x64\DeepSeek App-win32-x64-$version.zip"
  $nupkgPath = Join-Path $MakeDir "squirrel.windows\x64\deepseek_app-$version-full.nupkg"
  $releasesPath = Join-Path $MakeDir "squirrel.windows\x64\RELEASES"
  $nupkgName = Split-Path -Leaf $nupkgPath
  $releaseReferencesNupkg = $false
  if (Test-Path -LiteralPath $releasesPath) {
    $releaseReferencesNupkg = (Get-Content -LiteralPath $releasesPath -Raw).Contains($nupkgName)
  }
  $results += [pscustomobject]@{
    Name = "releases references nupkg"
    Required = $true
    Exists = $releaseReferencesNupkg
    Length = 0
    MinBytes = 0
    Ok = $releaseReferencesNupkg
    Path = "$releasesPath::$nupkgName"
  }

  $exists = Test-Path -LiteralPath $zipPath
  $entryNames = @()
  if ($exists) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
      $entryNames = $zip.Entries | ForEach-Object { $_.FullName.Replace("\", "/") }
    } finally {
      $zip.Dispose()
    }
  }
  $zipChecks = @(
    @{ Name = "zip desktop exe"; Pattern = "*deepseek-app.exe" },
    @{ Name = "zip runtime cli"; Pattern = "*resources/bin/deepseek.exe" },
    @{ Name = "zip runtime tui"; Pattern = "*resources/bin/deepseek-tui.exe" }
  )
  foreach ($zipCheck in $zipChecks) {
    $matched = [bool]($entryNames | Where-Object { $_ -like $zipCheck.Pattern } | Select-Object -First 1)
    $results += [pscustomobject]@{
      Name = $zipCheck.Name
      Required = $true
      Exists = $matched
      Length = 0
      MinBytes = 0
      Ok = $matched
      Path = "$zipPath::$($zipCheck.Pattern)"
    }
  }

  $nupkgExists = Test-Path -LiteralPath $nupkgPath
  $nupkgEntryNames = @()
  $nuspecVersionMatches = $false
  if ($nupkgExists) {
    $nupkg = [System.IO.Compression.ZipFile]::OpenRead($nupkgPath)
    try {
      $nupkgEntryNames = $nupkg.Entries | ForEach-Object { $_.FullName.Replace("\", "/") }
      $nuspecEntry = $nupkg.GetEntry("deepseek_app.nuspec")
      if ($nuspecEntry) {
        $reader = New-Object System.IO.StreamReader($nuspecEntry.Open())
        try {
          $nuspecVersionMatches = $reader.ReadToEnd().Contains("<version>$version</version>")
        } finally {
          $reader.Dispose()
        }
      }
    } finally {
      $nupkg.Dispose()
    }
  }
  $results += [pscustomobject]@{
    Name = "nupkg nuspec version"
    Required = $true
    Exists = $nuspecVersionMatches
    Length = 0
    MinBytes = 0
    Ok = $nuspecVersionMatches
    Path = "$nupkgPath::deepseek_app.nuspec version $version"
  }
  $nupkgChecks = @(
    @{ Name = "nupkg desktop exe"; Pattern = "*/deepseek-app.exe" },
    @{ Name = "nupkg runtime cli"; Pattern = "*/resources/bin/deepseek.exe" },
    @{ Name = "nupkg runtime tui"; Pattern = "*/resources/bin/deepseek-tui.exe" }
  )
  foreach ($nupkgCheck in $nupkgChecks) {
    $matched = [bool]($nupkgEntryNames | Where-Object { $_ -like $nupkgCheck.Pattern } | Select-Object -First 1)
    $results += [pscustomobject]@{
      Name = $nupkgCheck.Name
      Required = $true
      Exists = $matched
      Length = 0
      MinBytes = 0
      Ok = $matched
      Path = "$nupkgPath::$($nupkgCheck.Pattern)"
    }
  }
}

$failed = $results | Where-Object { -not $_.Ok }
if ($Json) {
  $results | ConvertTo-Json -Depth 3
} else {
  $results | Format-Table Name, Required, Exists, Length, MinBytes, Ok, Path -AutoSize
}

if ($failed) {
  throw "Package artifact verification failed"
}
