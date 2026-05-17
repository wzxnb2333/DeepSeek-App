[CmdletBinding()]
param(
  [string]$SetupPath,
  [string]$InstallRoot,
  [string]$Workspace,
  [string]$SmokeHome,
  [string]$ReportPath,
  [switch]$NoReinstall
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
if (-not $SetupPath) {
  $SetupPath = Join-Path $desktopRoot "out\make\squirrel.windows\x64\DeepSeekAppSetup.exe"
}
if (-not $InstallRoot) {
  $InstallRoot = Join-Path $env:LOCALAPPDATA "deepseek_app"
}
if (-not $Workspace) {
  $Workspace = Join-Path $repoRoot "outputs\desktop-ui\sample-workspace"
}
if (-not $SmokeHome) {
  $SmokeHome = Join-Path $repoRoot "outputs\desktop-ui\installer-smoke-home"
}
if (-not $ReportPath) {
  $ReportPath = Join-Path $repoRoot "outputs\desktop-ui\installer-smoke.json"
}

if (-not (Test-Path -LiteralPath $SetupPath)) {
  throw "Setup not found: $SetupPath"
}
if (-not (Test-Path -LiteralPath $Workspace)) {
  throw "Workspace not found: $Workspace"
}

$startMenu = [Environment]::GetFolderPath("StartMenu")
$desktop = [Environment]::GetFolderPath("Desktop")
$dumpPath = Join-Path (Split-Path -Parent $ReportPath) "installer-smoke-dump.json"

function Stop-InstalledProcesses {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("deepseek-app.exe", "deepseek.exe", "deepseek-tui.exe") -and
      ($_.ExecutablePath -like "$InstallRoot*" -or $_.CommandLine -like "*serve --http*")
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-InstalledAppProcessIds {
  @(Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "deepseek-app.exe" -and $_.ExecutablePath -like "$InstallRoot*"
    } |
    ForEach-Object { [int]$_.ProcessId })
}

function Get-InstalledShortcuts {
  @($startMenu, $desktop) |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    ForEach-Object {
      Get-ChildItem -Path $_ -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*DeepSeek*" -or $_.Name -like "*deepseek*" }
    }
}

function Wait-Until {
  param(
    [scriptblock]$Condition,
    [string]$Label,
    [int]$Seconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    if (& $Condition) {
      return
    }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Timed out waiting for $Label"
}

function Invoke-Uninstall {
  $updateExe = Join-Path $InstallRoot "Update.exe"
  if (-not (Test-Path -LiteralPath $updateExe)) {
    return
  }
  Stop-InstalledProcesses
  Start-Process -FilePath $updateExe -ArgumentList @("--uninstall", "-s") -Wait -WindowStyle Hidden
  Start-Sleep -Seconds 3
  Stop-InstalledProcesses
}

function Invoke-Install {
  Start-Process -FilePath $SetupPath -ArgumentList @("--silent") -Wait -WindowStyle Hidden
  Wait-Until -Label "installed application" -Seconds 60 -Condition {
    Test-Path -LiteralPath (Join-Path $InstallRoot "deepseek-app.exe")
  }
}

function Get-InstallState {
  $appDir = Get-ChildItem -Path $InstallRoot -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1
  $appExe = Join-Path $InstallRoot "deepseek-app.exe"
  $packagedExe = if ($appDir) { Join-Path $appDir.FullName "deepseek-app.exe" } else { "" }
  $runtimeCli = if ($appDir) { Join-Path $appDir.FullName "resources\bin\deepseek.exe" } else { "" }
  $runtimeTui = if ($appDir) { Join-Path $appDir.FullName "resources\bin\deepseek-tui.exe" } else { "" }
  [pscustomobject]@{
    install_root = $InstallRoot
    app_dir = if ($appDir) { $appDir.FullName } else { $null }
    update_exists = Test-Path -LiteralPath (Join-Path $InstallRoot "Update.exe")
    app_stub_exists = Test-Path -LiteralPath $appExe
    app_exe_exists = $packagedExe -and (Test-Path -LiteralPath $packagedExe)
    runtime_cli_exists = $runtimeCli -and (Test-Path -LiteralPath $runtimeCli)
    runtime_tui_exists = $runtimeTui -and (Test-Path -LiteralPath $runtimeTui)
    shortcut_count = @(Get-InstalledShortcuts).Count
  }
}

function Test-Cleaned {
  $appExe = Join-Path $InstallRoot "deepseek-app.exe"
  $packagedApps = @(Get-ChildItem -Path $InstallRoot -Recurse -Filter "deepseek-app.exe" -ErrorAction SilentlyContinue)
  $residualProcesses = @(Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("deepseek-app.exe", "deepseek.exe", "deepseek-tui.exe") -and
      ($_.ExecutablePath -like "$InstallRoot*" -or $_.CommandLine -like "*serve --http*")
    })
  return $packagedApps.Count -eq 0 -and
    -not (Test-Path -LiteralPath $appExe) -and
    @(Get-InstalledShortcuts).Count -eq 0 -and
    $residualProcesses.Count -eq 0
}

function Invoke-LaunchSmoke {
  if (Test-Path -LiteralPath $dumpPath) {
    Remove-Item -LiteralPath $dumpPath -Force
  }
  if (Test-Path -LiteralPath $SmokeHome) {
    Remove-Item -LiteralPath $SmokeHome -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $SmokeHome | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dumpPath) | Out-Null

  $oldWorkspace = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", "Process")
  $oldSmokeHome = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", "Process")
  $oldDump = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", "Process")
  try {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $Workspace, "Process")
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $SmokeHome, "Process")
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $dumpPath, "Process")
    $appExe = Join-Path $InstallRoot "deepseek-app.exe"
    $shortcut = Get-InstalledShortcuts | Select-Object -First 1
    $launchPath = if ($shortcut) { $shortcut.FullName } else { $appExe }
    $process = Start-Process -FilePath $launchPath -PassThru
    Wait-Until -Label "UI smoke dump" -Seconds 45 -Condition {
      (Test-Path -LiteralPath $dumpPath) -and (Get-Item -LiteralPath $dumpPath).Length -gt 64
    }
    Start-Sleep -Seconds 2
    $appProcessIds = @(Get-InstalledAppProcessIds)
    if ($process -and -not $process.HasExited -and $appProcessIds -notcontains $process.Id) {
      $appProcessIds += $process.Id
    }
    foreach ($processId in ($appProcessIds | Sort-Object -Unique)) {
      $running = Get-Process -Id $processId -ErrorAction SilentlyContinue
      if (-not $running -or $running.HasExited) {
        continue
      }
      $closed = $running.CloseMainWindow()
      if (-not $closed) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      } elseif (-not $running.WaitForExit(10000)) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      }
    }
    Start-Sleep -Seconds 4
    $residual = @(Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -in @("deepseek-app.exe", "deepseek.exe", "deepseek-tui.exe") -and
        ($_.ExecutablePath -like "$InstallRoot*" -or $_.CommandLine -like "*serve --http*")
      })
    if ($residual.Count -gt 0) {
      $residual | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize
      throw "Residual installed app/runtime process detected"
    }
    return [pscustomobject]@{
      launch_path = $launchPath
      launch_from_shortcut = [bool]$shortcut
      dump = (Get-Item -LiteralPath $dumpPath).FullName
      dump_length = (Get-Item -LiteralPath $dumpPath).Length
      process_exited = $true
    }
  } finally {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $oldWorkspace, "Process")
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $oldSmokeHome, "Process")
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $oldDump, "Process")
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
Stop-InstalledProcesses
Invoke-Uninstall
Wait-Until -Label "prior install cleanup" -Seconds 30 -Condition { Test-Cleaned }

Invoke-Install
$installedState = Get-InstallState
if (-not ($installedState.update_exists -and $installedState.app_stub_exists -and $installedState.app_exe_exists -and $installedState.runtime_cli_exists -and $installedState.runtime_tui_exists)) {
  throw "Installed app is missing required files"
}
$launch = Invoke-LaunchSmoke

Invoke-Uninstall
Wait-Until -Label "post-smoke uninstall cleanup" -Seconds 30 -Condition { Test-Cleaned }
$uninstallCleaned = Test-Cleaned
$uninstallResidualItems = @(Get-ChildItem -Path $InstallRoot -Force -ErrorAction SilentlyContinue | Select-Object Name, Length)

if (-not $NoReinstall) {
  Invoke-Install
}
$finalState = Get-InstallState

$report = [pscustomobject]@{
  ok = $true
  setup = (Get-Item -LiteralPath $SetupPath).FullName
  install_root = $InstallRoot
  installed = $installedState
  launch = $launch
  uninstall_cleaned = $uninstallCleaned
  uninstall_residual_items = $uninstallResidualItems
  reinstalled = -not [bool]$NoReinstall
  final = $finalState
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 8
