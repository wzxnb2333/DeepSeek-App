[CmdletBinding()]
param(
  [switch]$SkipRuntimeApi,
  [switch]$SkipClippy
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
$rustup = Join-Path $repoRoot ".cargo-home\bin\rustup.exe"
$rustupHome = Join-Path $repoRoot ".rustup"
$cargoHome = Join-Path $repoRoot ".cargo-home"

if (-not (Test-Path -LiteralPath $rustup)) {
  throw "rustup not found: $rustup"
}

$msvcRootCandidates = @(
  "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.50.35717",
  "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC\14.50.35717"
)
$msvcRoot = $msvcRootCandidates |
  Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ "bin\HostX64\x64\cl.exe")) -and
    (Test-Path -LiteralPath (Join-Path $_ "include\stdint.h")) -and
    (Test-Path -LiteralPath (Join-Path $_ "lib\x64\msvcrt.lib"))
  } |
  Select-Object -First 1
if (-not $msvcRoot) {
  throw "MSVC x64 toolset with standard include/lib paths not found"
}

$windowsSdkRoot = "C:\Program Files (x86)\Windows Kits\10"
$windowsSdkVersion = Get-ChildItem -Path (Join-Path $windowsSdkRoot "Lib") -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1 -ExpandProperty Name
if (-not $windowsSdkVersion) {
  throw "Windows SDK lib directory not found"
}
$windowsSdkLib = Join-Path $windowsSdkRoot "Lib\$windowsSdkVersion"
$windowsSdkInclude = Join-Path $windowsSdkRoot "Include\$windowsSdkVersion"
foreach ($path in @(
  (Join-Path $windowsSdkLib "ucrt\x64"),
  (Join-Path $windowsSdkLib "um\x64"),
  (Join-Path $windowsSdkInclude "ucrt"),
  (Join-Path $windowsSdkInclude "shared"),
  (Join-Path $windowsSdkInclude "um"),
  (Join-Path $windowsSdkInclude "winrt")
)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Windows SDK path not found: $path"
  }
}

$toolchainBin = Join-Path $rustupHome "toolchains\stable-x86_64-pc-windows-msvc\bin"
$msvcBin = Join-Path $msvcRoot "bin\HostX64\x64"
$msvcInclude = Join-Path $msvcRoot "include"
$msvcLib = Join-Path $msvcRoot "lib\x64"

function Invoke-RustCommand {
  param(
    [Parameter(Mandatory = $true)][string]$CargoArgs,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Write-Host "== $Label =="
  $lib = "$msvcLib;$(Join-Path $windowsSdkLib "ucrt\x64");$(Join-Path $windowsSdkLib "um\x64");!LIB!"
  $include = "$msvcInclude;$(Join-Path $windowsSdkInclude "ucrt");$(Join-Path $windowsSdkInclude "shared");$(Join-Path $windowsSdkInclude "um");$(Join-Path $windowsSdkInclude "winrt");!INCLUDE!"
  $path = "$toolchainBin;$msvcBin;!PATH!"
  $cmd = "set `"PATH=$path`" && set `"LIB=$lib`" && set `"INCLUDE=$include`" && set `"RUSTUP_HOME=$rustupHome`" && set `"CARGO_HOME=$cargoHome`" && `"$rustup`" run stable cargo $CargoArgs"
  cmd /v:on /c $cmd
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed"
  }
}

if (-not $SkipRuntimeApi) {
  Invoke-RustCommand -Label "runtime_api tests" -CargoArgs "test -p deepseek-tui runtime_api --all-features"
}

Invoke-RustCommand -Label "workspace tests" -CargoArgs "test --workspace --all-features"

if (-not $SkipClippy) {
  Invoke-RustCommand -Label "workspace clippy" -CargoArgs "clippy --workspace --all-targets --all-features"
}
