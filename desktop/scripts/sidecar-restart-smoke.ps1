[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$Workspace,
  [string]$DumpPath,
  [string]$ReportPath,
  [string]$SmokeHome,
  [int]$WaitSeconds = 8,
  [int]$RestartTimeoutSeconds = 20
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
if (-not $AppPath) {
  $AppPath = Join-Path $desktopRoot "out\DeepSeek App-win32-x64\deepseek-app.exe"
}
if (-not $Workspace) {
  $Workspace = Join-Path $repoRoot "outputs\desktop-ui\sample-workspace"
}
if (-not $DumpPath) {
  $DumpPath = Join-Path $repoRoot "outputs\desktop-ui\sidecar-restart-dump.json"
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $repoRoot "outputs\desktop-ui\sidecar-restart-smoke.json"
}
if (-not $SmokeHome) {
  $SmokeHome = Join-Path $repoRoot "outputs\desktop-ui\sidecar-restart-home"
}

if (-not (Test-Path -LiteralPath $AppPath)) {
  throw "App not found: $AppPath"
}
if (-not (Test-Path -LiteralPath $Workspace)) {
  throw "Workspace not found: $Workspace"
}

$resolvedSmokeHome = [System.IO.Path]::GetFullPath($SmokeHome)
$resolvedSmokeRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "outputs\desktop-ui"))
$resolvedSmokeRootWithSlash = $resolvedSmokeRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedSmokeHome.StartsWith($resolvedSmokeRootWithSlash, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke home must stay under outputs\desktop-ui: $SmokeHome"
}
if (Test-Path -LiteralPath $resolvedSmokeHome) {
  Remove-Item -LiteralPath $resolvedSmokeHome -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $resolvedSmokeHome | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DumpPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null

$oldWorkspace = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", "Process")
$oldSmokeHome = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", "Process")
$oldDump = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", "Process")
$process = $null

function Read-SmokeDump {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -le 64) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Wait-ForRuntimeReady {
  param(
    [string]$Path,
    [int]$PreviousPid = -1,
    [datetime]$AfterUtc,
    [int]$TimeoutSeconds
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $dump = Read-SmokeDump -Path $Path
    if ($dump -and $dump.runtime -and $dump.runtime.ready -and $dump.runtime.pid) {
      $capturedAt = [DateTime]::Parse($dump.capturedAt).ToUniversalTime()
      if ($capturedAt -ge $AfterUtc.AddMilliseconds(-250) -and ($PreviousPid -lt 0 -or [int]$dump.runtime.pid -ne $PreviousPid)) {
        return $dump
      }
    }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Timed out waiting for runtime ready dump"
}

try {
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $Workspace, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $resolvedSmokeHome, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $DumpPath, "Process")

  $startedAt = [DateTime]::UtcNow
  $process = Start-Process -FilePath $AppPath -PassThru
  Start-Sleep -Seconds $WaitSeconds

  if ($process.HasExited) {
    throw "Desktop app exited before runtime became ready"
  }

  $initial = Wait-ForRuntimeReady -Path $DumpPath -AfterUtc $startedAt -TimeoutSeconds 10
  $initialPid = [int]$initial.runtime.pid
  $initialPort = [int]$initial.runtime.port
  Stop-Process -Id $initialPid -Force
  try {
    Wait-Process -Id $initialPid -Timeout 5
  } catch {
    if (Get-Process -Id $initialPid -ErrorAction SilentlyContinue) {
      throw "Initial runtime process did not exit: $initialPid"
    }
  }

  $killedAt = [DateTime]::UtcNow
  $restarted = Wait-ForRuntimeReady -Path $DumpPath -PreviousPid $initialPid -AfterUtc $killedAt -TimeoutSeconds $RestartTimeoutSeconds
  $newPid = [int]$restarted.runtime.pid
  $newPort = [int]$restarted.runtime.port

  if ($newPid -eq $initialPid) {
    throw "Runtime pid did not change after forced exit"
  }

  $result = [pscustomobject]@{
    ok = $true
    initial_pid = $initialPid
    initial_port = $initialPort
    restarted_pid = $newPid
    restarted_port = $newPort
    dump = (Get-Item -LiteralPath $DumpPath).FullName
    report = (Join-Path (Resolve-Path -LiteralPath (Split-Path -Parent $ReportPath)) (Split-Path -Leaf $ReportPath))
    smoke_home = $resolvedSmokeHome
  }
  $json = $result | ConvertTo-Json -Depth 4
  $json | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $json
} finally {
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $oldWorkspace, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $oldSmokeHome, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $oldDump, "Process")
  if ($process -and -not $process.HasExited) {
    $process.CloseMainWindow() | Out-Null
    if (-not $process.WaitForExit(5000)) {
      Stop-Process -Id $process.Id -Force
    }
  }
  Start-Sleep -Seconds 3
  $residual = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("deepseek.exe", "deepseek-tui.exe", "deepseek-app.exe") -and
      ($_.Name -eq "deepseek-app.exe" -or $_.CommandLine -like "*serve --http*")
    }
  if ($residual) {
    $residual | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize
    throw "Residual desktop/runtime process detected"
  }
}
