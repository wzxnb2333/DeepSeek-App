[CmdletBinding()]
param(
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
$checks = New-Object System.Collections.Generic.List[object]

function Get-VsInstallRoots {
  $roots = New-Object System.Collections.Generic.List[string]
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path -LiteralPath $vswhere) {
    $instances = & $vswhere -products * -format json | ConvertFrom-Json
    foreach ($instance in @($instances)) {
      foreach ($path in @($instance.installationPath, $instance.resolvedInstallationPath)) {
        if ($path -and (Test-Path -LiteralPath $path)) {
          $roots.Add($path)
        }
      }
    }
  }
  if ($roots.Count -eq 0) {
    foreach ($fallback in @(
      "C:\Program Files\Microsoft Visual Studio",
      "C:\Program Files (x86)\Microsoft Visual Studio"
    )) {
      if (Test-Path -LiteralPath $fallback) {
        $roots.Add($fallback)
      }
    }
  }
  return $roots | Sort-Object -Unique
}

function Add-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Ok,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  $checks.Add([pscustomobject]@{
      name   = $Name
      ok     = $Ok
      detail = $Detail
    })
}

function First-File {
  param(
    [Parameter(Mandatory = $true)][string[]]$Roots,
    [Parameter(Mandatory = $true)][string]$Filter
  )
  foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }
    $match = Get-ChildItem -LiteralPath $root -Recurse -Filter $Filter -File -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($match) {
      return $match.FullName
    }
  }
  return $null
}

$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargo) {
  $localCargo = Join-Path $repoRoot ".cargo-home\bin\cargo.exe"
  if (Test-Path -LiteralPath $localCargo) {
    $cargo = [pscustomobject]@{ Source = $localCargo }
  }
}
Add-Check "cargo" ([bool]$cargo) ($(if ($cargo) { $cargo.Source } else { "not found on PATH or .cargo-home" }))

$rustfmt = First-File -Roots @(
  (Join-Path $repoRoot ".rustup\toolchains"),
  "$env:USERPROFILE\.rustup\toolchains"
) -Filter "rustfmt.exe"
Add-Check "rustfmt" ([bool]$rustfmt) ($(if ($rustfmt) { $rustfmt } else { "not found" }))

$vsRoots = @(Get-VsInstallRoots)
$kitRoots = @(
  "C:\Program Files (x86)\Windows Kits\10\Include",
  "C:\Program Files\Windows Kits\10\Include"
)

$vsDevCmd = First-File -Roots $vsRoots -Filter "VsDevCmd.bat"
Add-Check "vsdevcmd" ([bool]$vsDevCmd) ($(if ($vsDevCmd) { $vsDevCmd } else { "Visual Studio DevCmd not found" }))

$stdint = First-File -Roots @($vsRoots + $kitRoots) -Filter "stdint.h"
Add-Check "ucrt-stdint" ([bool]$stdint) ($(if ($stdint) { $stdint } else { "stdint.h not found under Visual Studio or Windows Kits" }))

$vcruntime = First-File -Roots $vsRoots -Filter "vcruntime.h"
Add-Check "msvc-vcruntime" ([bool]$vcruntime) ($(if ($vcruntime) { $vcruntime } else { "vcruntime.h not found under Visual Studio" }))

$msvcrt = First-File -Roots $vsRoots -Filter "msvcrt.lib"
Add-Check "msvc-msvcrt" ([bool]$msvcrt) ($(if ($msvcrt) { $msvcrt } else { "msvcrt.lib not found under Visual Studio" }))

foreach ($binary in @("deepseek.exe", "deepseek-tui.exe")) {
  $releasePath = Join-Path $repoRoot "target\release\$binary"
  $debugPath = Join-Path $repoRoot "target\debug\$binary"
  $found = if (Test-Path -LiteralPath $releasePath) {
    $releasePath
  } elseif (Test-Path -LiteralPath $debugPath) {
    $debugPath
  } else {
    $null
  }
  Add-Check "runtime-$binary" ([bool]$found) ($(if ($found) { $found } else { "not found in target\\release or target\\debug" }))
}

if ($Json) {
  $checks | ConvertTo-Json -Depth 4
} else {
  foreach ($check in $checks) {
    $mark = if ($check.ok) { "OK" } else { "MISSING" }
    Write-Host ("[{0}] {1}: {2}" -f $mark, $check.name, $check.detail)
  }
}

if ($checks.Where({ -not $_.ok }).Count -gt 0) {
  exit 1
}
