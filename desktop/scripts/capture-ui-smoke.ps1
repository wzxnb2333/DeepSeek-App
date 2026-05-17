[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$Workspace,
  [string]$OutputPath,
  [string]$DumpPath,
  [string]$SmokeHome,
  [ValidateSet("", "approval", "activity", "conversation")]
  [string]$Fixture = "",
  [ValidateSet("", "threads", "tasks", "automations", "settings")]
  [string]$View = "",
  [string]$WorkspaceAlias = "",
  [ValidateSet("", "approval-allow", "approval-deny", "task-cancel", "automation-pause", "automation-resume", "rail-extensions", "rail-logs", "settings-runtime", "settings-extensions", "settings-logs", "settings-yolo", "right-collapse", "new-thread", "conversation-menu", "workspace-open-menu", "processed-history")]
  [string]$Click = "",
  [int]$Width = 1440,
  [int]$Height = 920,
  [int]$WaitSeconds = 8
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
if (-not $OutputPath) {
  $suffix = if ($Width -ne 1440 -or $Height -ne 920) { "-${Width}x${Height}" } else { "" }
  $stateParts = @()
  if ($Fixture) {
    $stateParts += $Fixture
  }
  if ($View) {
    $stateParts += $View
  }
  if ($Click) {
    $stateParts += $Click
  }
  if (-not $stateParts.Length) {
    $stateParts += "normal"
  }
  $stateName = $stateParts -join "-"
  $name = "smoke-$stateName$suffix.png"
  $OutputPath = Join-Path $repoRoot "outputs\desktop-ui\$name"
}
if (-not $DumpPath) {
  $DumpPath = [System.IO.Path]::ChangeExtension($OutputPath, ".json")
}
if (-not $SmokeHome) {
  $SmokeHome = Join-Path (Split-Path -Parent $OutputPath) "smoke-home"
}

if (-not (Test-Path -LiteralPath $AppPath)) {
  throw "App not found: $AppPath"
}
if (-not (Test-Path -LiteralPath $Workspace)) {
  throw "Workspace not found: $Workspace"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DumpPath) | Out-Null
New-Item -ItemType Directory -Force -Path $SmokeHome | Out-Null
if (Test-Path -LiteralPath $DumpPath) {
  Remove-Item -LiteralPath $DumpPath -Force
}

$oldWorkspace = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", "Process")
$oldFixture = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_FIXTURE", "Process")
$oldView = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_VIEW", "Process")
$oldWorkspaceAlias = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_WORKSPACE_ALIAS", "Process")
$oldDump = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", "Process")
$oldScreenshot = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_SCREENSHOT", "Process")
$oldClick = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_CLICK", "Process")
$oldSmokeHome = [Environment]::GetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", "Process")
$effectiveView = if ($View) { $View } else { "threads" }
$existingAppProcessIds = @(Get-Process deepseek-app -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$captureMutex = New-Object System.Threading.Mutex($false, "Global\DeepSeekAppUiSmokeCapture")
$captureMutexAcquired = $false

function Wait-ForSmokeDump {
  param(
    [string]$Path,
    [datetime]$AfterUtc
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    if (Test-Path -LiteralPath $Path) {
      $item = Get-Item -LiteralPath $Path
      if ($item.Length -gt 64 -and $item.LastWriteTimeUtc -ge $AfterUtc.AddMilliseconds(-250)) {
        return $item
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "UI smoke dump not written or stale: $Path"
}

function Wait-ForSmokeImage {
  param(
    [string]$Path,
    [datetime]$AfterUtc
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    if (Test-Path -LiteralPath $Path) {
      $item = Get-Item -LiteralPath $Path
      if ($item.Length -gt 4096 -and $item.LastWriteTimeUtc -ge $AfterUtc.AddMilliseconds(-250)) {
        return $item
      }
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "UI smoke screenshot not written or stale: $Path"
}

function Get-SmokeImageStats {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $colors = @{}
    $bright = 0
    $samples = 0
    $stepX = [Math]::Max(1, [int][Math]::Floor($bitmap.Width / 48))
    $stepY = [Math]::Max(1, [int][Math]::Floor($bitmap.Height / 32))
    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
        $color = $bitmap.GetPixel($x, $y)
        $colors[$color.ToArgb()] = $true
        $luminance = (0.2126 * $color.R) + (0.7152 * $color.G) + (0.0722 * $color.B)
        if ($luminance -gt 35) {
          $bright += 1
        }
        $samples += 1
      }
    }
    return [pscustomobject]@{
      SampledColors = $colors.Keys.Count
      BrightRatio = if ($samples) { $bright / $samples } else { 0 }
    }
  } finally {
    $bitmap.Dispose()
  }
}

function Save-WindowScreenshot {
  param(
    [int]$Left,
    [int]$Top,
    [int]$Width,
    [int]$Height,
    [string]$Path
  )

  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  $captureMutexAcquired = $captureMutex.WaitOne(0)
  if (-not $captureMutexAcquired) {
    throw "Another UI smoke capture is already running"
  }

  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $Workspace, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $SmokeHome, "Process")
  if ($Fixture) {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_FIXTURE", $Fixture, "Process")
  } else {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_FIXTURE", $null, "Process")
  }
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_VIEW", $effectiveView, "Process")
  if ($WorkspaceAlias) {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_WORKSPACE_ALIAS", $WorkspaceAlias, "Process")
  } else {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_WORKSPACE_ALIAS", $null, "Process")
  }
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $DumpPath, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_SCREENSHOT", $OutputPath, "Process")
  if ($Click) {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_CLICK", $Click, "Process")
  } else {
    [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_CLICK", $null, "Process")
  }

  Add-Type -AssemblyName System.Drawing
  if (-not ("DeepSeekSmokeCapture" -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DeepSeekSmokeCapture {
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint SWP_SHOWWINDOW = 0x0040;
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
  }

  function Get-SmokeWindow {
    Get-Process deepseek-app -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -ne 0 -and
        $existingAppProcessIds -notcontains $_.Id -and
        [DeepSeekSmokeCapture]::IsWindow($_.MainWindowHandle)
      } |
      Sort-Object Id -Descending |
      Select-Object -First 1
  }

  function Get-SmokeWindowRect {
    param(
      [System.Diagnostics.Process]$CurrentWindow
    )

    for ($attempt = 1; $attempt -le 12; $attempt += 1) {
      if (-not $CurrentWindow -or $CurrentWindow.HasExited -or -not [DeepSeekSmokeCapture]::IsWindow($CurrentWindow.MainWindowHandle)) {
        $CurrentWindow = Get-SmokeWindow
      }
      if ($CurrentWindow) {
        [DeepSeekSmokeCapture]::ShowWindow($CurrentWindow.MainWindowHandle, 9) | Out-Null
        [DeepSeekSmokeCapture]::MoveWindow($CurrentWindow.MainWindowHandle, 40, 40, $Width, $Height, $true) | Out-Null
        [DeepSeekSmokeCapture]::SetWindowPos($CurrentWindow.MainWindowHandle, [DeepSeekSmokeCapture]::HWND_TOPMOST, 40, 40, $Width, $Height, [DeepSeekSmokeCapture]::SWP_SHOWWINDOW) | Out-Null
        Start-Sleep -Milliseconds 200
        $currentRect = New-Object DeepSeekSmokeCapture+RECT
        $rectOk = [DeepSeekSmokeCapture]::GetWindowRect($CurrentWindow.MainWindowHandle, [ref]$currentRect)
        $currentWidth = $currentRect.Right - $currentRect.Left
        $currentHeight = $currentRect.Bottom - $currentRect.Top
        if ($rectOk -and $currentWidth -gt 0 -and $currentHeight -gt 0) {
          return [pscustomobject]@{
            Window = $CurrentWindow
            Rect = $currentRect
            Width = $currentWidth
            Height = $currentHeight
          }
        }
      }
      Start-Sleep -Milliseconds 500
    }

    throw "Invalid window size after retries"
  }

  $existingAppProcessIds = @(Get-Process deepseek-app -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $dumpAfterUtc = [DateTime]::UtcNow
  $process = Start-Process -FilePath $AppPath -PassThru
  Start-Sleep -Seconds $WaitSeconds

  $window = Get-SmokeWindow
  if (-not $window) {
    $windowDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      Start-Sleep -Milliseconds 250
      $window = Get-SmokeWindow
    } while (-not $window -and [DateTime]::UtcNow -lt $windowDeadline)
  }
  if (-not $window) {
    throw "deepseek-app window not found"
  }

  [DeepSeekSmokeCapture]::ShowWindow($window.MainWindowHandle, 9) | Out-Null
  [DeepSeekSmokeCapture]::MoveWindow($window.MainWindowHandle, 40, 40, $Width, $Height, $true) | Out-Null
  [DeepSeekSmokeCapture]::SetWindowPos($window.MainWindowHandle, [DeepSeekSmokeCapture]::HWND_TOPMOST, 40, 40, $Width, $Height, [DeepSeekSmokeCapture]::SWP_SHOWWINDOW) | Out-Null
  $currentThreadId = [DeepSeekSmokeCapture]::GetCurrentThreadId()
  $foregroundWindow = [DeepSeekSmokeCapture]::GetForegroundWindow()
  $foregroundProcessId = 0
  $foregroundThreadId = 0
  if ($foregroundWindow -ne [IntPtr]::Zero) {
    $foregroundThreadId = [DeepSeekSmokeCapture]::GetWindowThreadProcessId($foregroundWindow, [ref]$foregroundProcessId)
    if ($foregroundThreadId -ne 0) {
      [DeepSeekSmokeCapture]::AttachThreadInput($currentThreadId, $foregroundThreadId, $true) | Out-Null
    }
  }
  $targetProcessId = 0
  $targetThreadId = [DeepSeekSmokeCapture]::GetWindowThreadProcessId($window.MainWindowHandle, [ref]$targetProcessId)
  if ($targetThreadId -ne 0) {
    [DeepSeekSmokeCapture]::AttachThreadInput($currentThreadId, $targetThreadId, $true) | Out-Null
  }
  [DeepSeekSmokeCapture]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
  if ($targetThreadId -ne 0) {
    [DeepSeekSmokeCapture]::AttachThreadInput($currentThreadId, $targetThreadId, $false) | Out-Null
  }
  if ($foregroundThreadId -ne 0) {
    [DeepSeekSmokeCapture]::AttachThreadInput($currentThreadId, $foregroundThreadId, $false) | Out-Null
  }
  Start-Sleep -Milliseconds 1000

  $windowRect = Get-SmokeWindowRect -CurrentWindow $window
  $window = $windowRect.Window
  $rect = $windowRect.Rect
  if ($Click) {
    Start-Sleep -Milliseconds 1300
    $dumpAfterUtc = [DateTime]::UtcNow
    $windowRect = Get-SmokeWindowRect -CurrentWindow $window
    $window = $windowRect.Window
    $rect = $windowRect.Rect
  }
  $actualWidth = $windowRect.Width
  $actualHeight = $windowRect.Height

  $dumpItem = Wait-ForSmokeDump -Path $DumpPath -AfterUtc $dumpAfterUtc
  $imageItem = Wait-ForSmokeImage -Path $OutputPath -AfterUtc $dumpAfterUtc
  $imageStats = Get-SmokeImageStats -Path $OutputPath
  if ($imageStats.BrightRatio -lt 0.03 -and $imageItem.Length -lt 50000) {
    throw "UI smoke screenshot looks blank after retries: $OutputPath"
  }

  [DeepSeekSmokeCapture]::SetWindowPos($window.MainWindowHandle, [DeepSeekSmokeCapture]::HWND_NOTOPMOST, $rect.Left, $rect.Top, $actualWidth, $actualHeight, [DeepSeekSmokeCapture]::SWP_SHOWWINDOW) | Out-Null
  $window.CloseMainWindow() | Out-Null
  if (-not $window.WaitForExit(5000)) {
    Stop-Process -Id $window.Id -Force
  }
  Start-Sleep -Seconds 4

  $residual = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -in @("deepseek.exe", "deepseek-tui.exe", "deepseek-app.exe") -and
      ($_.Name -eq "deepseek-app.exe" -or $_.CommandLine -like "*serve --http*")
    }
  if ($residual) {
    $residual | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize
    throw "Residual desktop/runtime process detected"
  }

  [pscustomobject]@{
    Screenshot = (Get-Item -LiteralPath $OutputPath).FullName
    ScreenshotLength = $imageItem.Length
    BrightRatio = [Math]::Round($imageStats.BrightRatio, 4)
    Dump = $dumpItem.FullName
    DumpLength = $dumpItem.Length
  }
} finally {
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_WORKSPACE", $oldWorkspace, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_FIXTURE", $oldFixture, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_VIEW", $oldView, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_WORKSPACE_ALIAS", $oldWorkspaceAlias, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_DUMP", $oldDump, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_SMOKE_SCREENSHOT", $oldScreenshot, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_UI_CLICK", $oldClick, "Process")
  [Environment]::SetEnvironmentVariable("DEEPSEEK_DESKTOP_SMOKE_HOME", $oldSmokeHome, "Process")
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  if ($existingAppProcessIds.Count -gt 0) {
    $newAppProcesses = Get-Process deepseek-app -ErrorAction SilentlyContinue |
      Where-Object { $existingAppProcessIds -notcontains $_.Id }
  } else {
    $newAppProcesses = Get-Process deepseek-app -ErrorAction SilentlyContinue
  }
  if ($newAppProcesses) {
    $newAppProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  if ($captureMutexAcquired) {
    $captureMutex.ReleaseMutex()
  }
  $captureMutex.Dispose()
}
