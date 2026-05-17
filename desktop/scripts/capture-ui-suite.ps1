[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$Workspace,
  [string]$ManifestPath,
  [string]$ContactSheetPath,
  [string]$SmokeHome,
  [int]$MinImageBytes = 50000,
  [int]$MinSampledColors = 8,
  [int]$WaitSeconds = 8
)

$ErrorActionPreference = "Stop"

$smokeScript = Join-Path $PSScriptRoot "capture-ui-smoke.ps1"
if (-not (Test-Path -LiteralPath $smokeScript)) {
  throw "Smoke script not found: $smokeScript"
}
$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
if (-not $AppPath) {
  $AppPath = Join-Path $desktopRoot "out\DeepSeek App-win32-x64\deepseek-app.exe"
}
if (-not $Workspace) {
  $Workspace = Join-Path $repoRoot "outputs\desktop-ui\sample-workspace"
}
if (-not $ManifestPath) {
  $ManifestPath = Join-Path $repoRoot "outputs\desktop-ui\smoke-manifest.json"
}
if (-not $ContactSheetPath) {
  $ContactSheetPath = Join-Path $repoRoot "outputs\desktop-ui\smoke-contact-sheet.png"
}
if (-not $SmokeHome) {
  $SmokeHome = Join-Path $repoRoot "outputs\desktop-ui\smoke-home"
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

$cases = @(
  @{ Name = "normal"; Args = @{} },
  @{ Name = "conversation"; Args = @{ Fixture = "conversation" } },
  @{ Name = "conversation-new-thread"; Args = @{ Fixture = "conversation"; Click = "new-thread" } },
  @{ Name = "approval"; Args = @{ Fixture = "approval" } },
  @{ Name = "conversation-1024x768"; Args = @{ Fixture = "conversation"; Width = 1024; Height = 768 } },
  @{ Name = "normal-1024x768"; Args = @{ Width = 1024; Height = 768 } },
  @{ Name = "approval-1024x768"; Args = @{ Fixture = "approval"; Width = 1024; Height = 768 } },
  @{ Name = "tasks-1024x768"; Args = @{ View = "tasks"; Width = 1024; Height = 768 } },
  @{ Name = "automations-1024x768"; Args = @{ View = "automations"; Width = 1024; Height = 768 } },
  @{ Name = "settings-1024x768"; Args = @{ View = "settings"; Width = 1024; Height = 768 } },
  @{ Name = "normal-narrow"; Args = @{ Width = 1180; Height = 720 } },
  @{ Name = "normal-right-collapse-narrow"; Args = @{ Click = "right-collapse"; Width = 1180; Height = 720 } },
  @{ Name = "conversation-narrow"; Args = @{ Fixture = "conversation"; Width = 1180; Height = 720 } },
  @{ Name = "conversation-processed-open-narrow"; Args = @{ Fixture = "conversation"; Click = "processed-history"; Width = 1180; Height = 720 } },
  @{ Name = "conversation-menu-narrow"; Args = @{ Fixture = "conversation"; Click = "conversation-menu"; Width = 1180; Height = 720 } },
  @{ Name = "workspace-open-menu-narrow"; Args = @{ Fixture = "conversation"; Click = "workspace-open-menu"; Width = 1180; Height = 720 } },
  @{ Name = "workspace-alias-narrow"; Args = @{ Fixture = "conversation"; WorkspaceAlias = "Desktop App"; Width = 1180; Height = 720 } },
  @{ Name = "settings-extensions-narrow"; Args = @{ View = "settings"; Click = "settings-extensions"; Width = 1180; Height = 720 } },
  @{ Name = "settings-logs-narrow"; Args = @{ View = "settings"; Click = "settings-logs"; Width = 1180; Height = 720 } },
  @{ Name = "settings-yolo-narrow"; Args = @{ View = "settings"; Click = "settings-yolo"; Width = 1180; Height = 720 } },
  @{ Name = "approval-narrow"; Args = @{ Fixture = "approval"; Width = 1180; Height = 720 } },
  @{ Name = "approval-allow-narrow"; Args = @{ Fixture = "approval"; Click = "approval-allow"; Width = 1180; Height = 720 } },
  @{ Name = "approval-deny-narrow"; Args = @{ Fixture = "approval"; Click = "approval-deny"; Width = 1180; Height = 720 } },
  @{ Name = "tasks-narrow"; Args = @{ View = "tasks"; Width = 1180; Height = 720 } },
  @{ Name = "tasks-activity-narrow"; Args = @{ Fixture = "activity"; View = "tasks"; Width = 1180; Height = 720 } },
  @{ Name = "tasks-activity-cancel-narrow"; Args = @{ Fixture = "activity"; View = "tasks"; Click = "task-cancel"; Width = 1180; Height = 720 } },
  @{ Name = "automations-narrow"; Args = @{ View = "automations"; Width = 1180; Height = 720 } },
  @{ Name = "automations-activity-narrow"; Args = @{ Fixture = "activity"; View = "automations"; Width = 1180; Height = 720 } },
  @{ Name = "automations-activity-pause-narrow"; Args = @{ Fixture = "activity"; View = "automations"; Click = "automation-pause"; Width = 1180; Height = 720 } },
  @{ Name = "settings"; Args = @{ View = "settings" } }
)

Add-Type -AssemblyName System.Drawing

function Get-SampledColorCount {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $colors = @{}
    $stepX = [Math]::Max(1, [int][Math]::Floor($bitmap.Width / 24))
    $stepY = [Math]::Max(1, [int][Math]::Floor($bitmap.Height / 16))
    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
        $colors[$bitmap.GetPixel($x, $y).ToArgb()] = $true
      }
    }
    return $colors.Keys.Count
  } finally {
    $bitmap.Dispose()
  }
}

function Get-BrightPixelRatio {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $bright = 0
    $samples = 0
    $stepX = [Math]::Max(1, [int][Math]::Floor($bitmap.Width / 48))
    $stepY = [Math]::Max(1, [int][Math]::Floor($bitmap.Height / 32))
    for ($x = 0; $x -lt $bitmap.Width; $x += $stepX) {
      for ($y = 0; $y -lt $bitmap.Height; $y += $stepY) {
        $color = $bitmap.GetPixel($x, $y)
        $luminance = (0.2126 * $color.R) + (0.7152 * $color.G) + (0.0722 * $color.B)
        if ($luminance -gt 35) {
          $bright += 1
        }
        $samples += 1
      }
    }
    if ($samples) {
      return $bright / $samples
    }
    return 0
  } finally {
    $bitmap.Dispose()
  }
}

function Get-ImageSize {
  param([string]$Path)

  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    return [pscustomobject]@{
      Width = $bitmap.Width
      Height = $bitmap.Height
    }
  } finally {
    $bitmap.Dispose()
  }
}

function New-SmokeContactSheet {
  param(
    [array]$Results,
    [string]$Path
  )

  $columns = 4
  $thumbWidth = 360
  $thumbHeight = 230
  $labelHeight = 30
  $padding = 12
  $rows = [int][Math]::Ceiling($Results.Count / $columns)
  $sheetWidth = ($columns * $thumbWidth) + (($columns + 1) * $padding)
  $sheetHeight = ($rows * ($thumbHeight + $labelHeight)) + (($rows + 1) * $padding)
  $sheet = New-Object System.Drawing.Bitmap $sheetWidth, $sheetHeight
  $graphics = [System.Drawing.Graphics]::FromImage($sheet)
  $graphics.Clear([System.Drawing.Color]::FromArgb(13, 17, 23))
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $font = New-Object System.Drawing.Font "Segoe UI", 10
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 237, 243))
  $mutedBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 162, 175))
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(42, 52, 67))

  try {
    for ($index = 0; $index -lt $Results.Count; $index += 1) {
      $result = $Results[$index]
      $column = $index % $columns
      $row = [int][Math]::Floor($index / $columns)
      $x = $padding + ($column * ($thumbWidth + $padding))
      $y = $padding + ($row * ($thumbHeight + $labelHeight + $padding))
      $image = [System.Drawing.Bitmap]::FromFile($result.FullName)
      try {
        $scale = [Math]::Min($thumbWidth / $image.Width, $thumbHeight / $image.Height)
        $drawWidth = [int][Math]::Round($image.Width * $scale)
        $drawHeight = [int][Math]::Round($image.Height * $scale)
        $drawX = $x + [int][Math]::Floor(($thumbWidth - $drawWidth) / 2)
        $drawY = $y + [int][Math]::Floor(($thumbHeight - $drawHeight) / 2)
        $graphics.DrawRectangle($borderPen, $x, $y, $thumbWidth, $thumbHeight)
        $graphics.DrawImage($image, $drawX, $drawY, $drawWidth, $drawHeight)
      } finally {
        $image.Dispose()
      }
      $graphics.DrawString($result.Name, $font, $brush, $x, $y + $thumbHeight + 4)
      $graphics.DrawString("$($result.Width)x$($result.Height)", $font, $mutedBrush, $x + 230, $y + $thumbHeight + 4)
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    $sheet.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $borderPen.Dispose()
    $mutedBrush.Dispose()
    $brush.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $sheet.Dispose()
  }
}

function ConvertFrom-UiTextBase64 {
  param([string]$Value)

  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function Get-UiText {
  param([string]$Name)

  $values = @{
    ApprovalQueue = "5a6h5om56Zif5YiX"
    RuntimeOverview = "6L+Q6KGM5qaC6KeI"
    CurrentThread = "5b2T5YmN5Lya6K+d"
    NewThread = "5paw5Lya6K+d"
    InterruptTurn = "57uI5q2i5b2T5YmNIHR1cm4="
    Tasks = "5Lu75Yqh"
    TaskQueue = "5Lu75Yqh6Zif5YiX"
    Create = "5Yib5bu6"
    Automations = "6Ieq5Yqo5YyW"
    Enabled = "5ZCv55So"
    ModelPermissions = "5qih5Z6L5LiO5p2D6ZmQ"
    ApiKeySource = "QVBJIGtleSDmnaXmupA="
    ApprovalOnRequest = "5oyJ6ZyA5a6h5om5"
    ReasoningMax = "5pyA5aSn"
    RuntimeLogs = "6L+Q6KGM5pel5b+X"
    ApprovalPrompt = "6K+35rGC56Gu6K6k"
    AllowOnce = "5YWB6K645LiA5qyh"
    Deny = "5ouS57ud"
    Allowed = "5bey5YWB6K64"
    Denied = "5bey5ouS57ud"
    ExtensionsStatus = "5omp5bGV54q25oCB"
    Mcp = "TUNQ"
    Logs = "5pel5b+X"
    McpStatus = "TUNQIOeKtuaAgQ=="
    Skills = "5oqA6IO9"
    ConversationReply = "546w5Zyo5Lya6K+d5q2j5paH"
    ConversationPrompt = "5Li65LuA5LmI5LmL5YmN55yL5LiN5Yiw5a+56K+d77yf"
    EmptyPrompt = "6KaB5YGa5LuA5LmI77yf"
    SetupPrompt = "6YWN572u5a+G6ZKl5ZCO5byA5aeL5Lya6K+d"
    CanceledStatus = "5Y+W5raI"
    PausedStatus = "5pqC5YGc"
    ActiveStatus = "5ZCv55So"
  }

  return ConvertFrom-UiTextBase64 -Value $values[$Name]
}

function Get-SmokeExpectations {
  param($Case)

  $expectedText = @((Get-UiText "NewThread"))
  $selectedTabId = ""
  $expectedView = if ($Case.Args.ContainsKey("View")) { $Case.Args.View } else { "threads" }
  $fixture = if ($Case.Args.ContainsKey("Fixture")) { $Case.Args.Fixture } else { "" }
  $click = if ($Case.Args.ContainsKey("Click")) { $Case.Args.Click } else { "" }
  $compactRail = $expectedView -eq "settings"

  switch ($expectedView) {
    "tasks" { $expectedText += @((Get-UiText "TaskQueue"), (Get-UiText "Create")) }
    "automations" { $expectedText += @((Get-UiText "Automations"), (Get-UiText "Enabled")) }
    "settings" {
      switch ($click) {
        "settings-extensions" { $expectedText += @((Get-UiText "McpStatus"), (Get-UiText "Skills")) }
        "settings-logs" { $expectedText += @(Get-UiText "RuntimeLogs") }
        default { $expectedText += @((Get-UiText "ModelPermissions"), (Get-UiText "ApiKeySource"), (Get-UiText "ApprovalOnRequest"), (Get-UiText "ReasoningMax")) }
      }
    }
  }
  if ($Case.Args.ContainsKey("Fixture") -and $Case.Args.Fixture -eq "approval" -and -not $Case.Args.ContainsKey("Click")) {
    $expectedText += @((Get-UiText "ApprovalPrompt"), (Get-UiText "AllowOnce"), (Get-UiText "Deny"))
  }
  if ($Case.Args.ContainsKey("Fixture") -and $Case.Args.Fixture -eq "conversation" -and $click -ne "new-thread") {
    $expectedText += @(Get-UiText "ConversationReply")
  }
  if ($Case.Args.ContainsKey("WorkspaceAlias")) {
    $expectedText += @([string]$Case.Args.WorkspaceAlias)
  }
  if ($Case.Args.ContainsKey("Click")) {
    switch ($Case.Args.Click) {
      "approval-allow" { }
      "approval-deny" { }
      "task-cancel" { $expectedText += @(Get-UiText "CanceledStatus") }
      "automation-pause" { $expectedText += @(Get-UiText "PausedStatus") }
      "automation-resume" { $expectedText += @(Get-UiText "ActiveStatus") }
      "rail-extensions" {
        $expectedText += @((Get-UiText "ExtensionsStatus"), (Get-UiText "Mcp"))
        $selectedTabId = "rail-tab-extensions"
      }
      "rail-logs" {
        $expectedText += @(Get-UiText "Logs")
        $selectedTabId = "rail-tab-logs"
      }
      "settings-extensions" { }
      "settings-logs" { }
      "settings-yolo" { }
      "right-collapse" { $compactRail = $true }
      "new-thread" { $expectedText += @(Get-UiText "EmptyPrompt") }
    }
  }

  [pscustomobject]@{
    Text = $expectedText
    SelectedTabId = $selectedTabId
    View = $expectedView
    CompactRail = $compactRail
    Click = $click
  }
}

function Assert-SmokeDump {
  param(
    [string]$Name,
    $Dump,
    [string[]]$ExpectedText,
    [string]$SelectedTabId,
    [string]$ExpectedView,
    [bool]$ExpectedCompactRail,
    [string]$ExpectedClick
  )

  $text = [string]$Dump.normalizedText
  if (-not $text -or $text.Length -lt 80) {
    throw "UI smoke dump text is too small for $Name"
  }

  foreach ($expected in $ExpectedText) {
    if ($text -notlike "*$expected*") {
      throw "UI smoke dump for $Name is missing text: $expected"
    }
  }

  if ($ExpectedView -and $Dump.initialView -ne $ExpectedView) {
    throw "UI smoke dump for $Name initial view mismatch. Expected $ExpectedView, got $($Dump.initialView)"
  }

  if (-not $Dump.runtime.ready) {
    throw "UI smoke dump for $Name runtime is not ready"
  }

  if ($Dump.leakSignals.hasOpenAiStyleKey -or $Dump.leakSignals.hasDeepseekToken -or $Dump.leakSignals.hasRuntimeTokenShape) {
    throw "UI smoke dump for $Name contains a key-shaped token"
  }

  if ($SelectedTabId) {
    $selectedTabs = @($Dump.tabs | Where-Object { $_.selected -eq $true })
    if (-not ($selectedTabs | Where-Object { $_.id -eq $SelectedTabId })) {
      $actual = ($selectedTabs | ForEach-Object { $_.id }) -join ", "
      throw "UI smoke dump for $Name selected tab mismatch. Expected $SelectedTabId, got $actual"
    }
  }

  if ($Dump.layout.horizontalOverflow) {
    throw "UI smoke dump for $Name has horizontal overflow"
  }

  if (-not $Dump.layout.statusFooter) {
    throw "UI smoke dump for $Name is missing status footer metrics"
  }

  if ([int]$Dump.layout.statusFooter.height -gt 24) {
    throw "UI smoke dump for $Name status footer is too tall: $($Dump.layout.statusFooter.height)"
  }

  if ([int]$Dump.layout.statusFooter.itemCount -lt 7) {
    throw "UI smoke dump for $Name expected compact footer items"
  }

  if ($Dump.layout.topBar -and [int]$Dump.layout.topBar.height -gt 40) {
    throw "UI smoke dump for $Name top bar is too tall: $($Dump.layout.topBar.height)"
  }

  if (($ExpectedView -eq "tasks" -or $ExpectedView -eq "automations") -and [int]$Dump.layout.statusBadges -lt 1) {
    throw "UI smoke dump for $Name expected compact status badges"
  }

  if (($ExpectedView -eq "tasks" -or $ExpectedView -eq "automations") -and $Dump.layout.operationRows -and [int]$Dump.layout.operationRows.count -gt 0) {
    if ([int]$Dump.layout.operationRows.maxHeight -gt 54) {
      throw "UI smoke dump for $Name operation rows are too tall: $($Dump.layout.operationRows.maxHeight)"
    }
  }

  if ($Dump.layout.threadRows -and [int]$Dump.layout.threadRows.count -gt 0 -and [int]$Dump.layout.threadRows.maxHeight -gt 30) {
    throw "UI smoke dump for $Name thread rows are too tall: $($Dump.layout.threadRows.maxHeight)"
  }

  if ($ExpectedClick -eq "settings-yolo") {
    $switches = @($Dump.switches | Where-Object { $_.visible })
    $yoloSwitch = $switches | Where-Object { $_.id -eq "settings-yolo" } | Select-Object -First 1
    $shellSwitch = $switches | Where-Object { $_.id -eq "settings-allow-shell" } | Select-Object -First 1
    if (-not $yoloSwitch -or $yoloSwitch.checked -ne $true) {
      throw "UI smoke dump for $Name expected YOLO switch to turn on"
    }
    if (-not $shellSwitch -or $shellSwitch.checked -ne $true) {
      throw "UI smoke dump for $Name expected shell switch to be enabled with YOLO"
    }
  }

  if ($Dump.layout.composer -and $Dump.layout.composer.height -gt 120) {
    throw "UI smoke dump for $Name composer is too tall: $($Dump.layout.composer.height)"
  }

  if ($Dump.layout.composer -and $Dump.layout.mainSurface) {
    $bottomGap = [Math]::Abs([int]$Dump.layout.mainSurface.bottom - [int]$Dump.layout.composer.bottom)
    if ($bottomGap -gt 24) {
      throw "UI smoke dump for $Name composer is not pinned to bottom. Gap: $bottomGap"
    }
  }

  if ($Dump.layout.composer -and $Dump.layout.composerControls -and [int]$Dump.layout.composerControls.count -gt 0) {
    if ([int]$Dump.layout.composerControls.count -ne 4) {
      throw "UI smoke dump for $Name expected four compact composer controls"
    }
    if ([int]$Dump.layout.composerControls.maxWidth -gt 112) {
      throw "UI smoke dump for $Name composer controls are too wide: $($Dump.layout.composerControls.maxWidth)"
    }
    if ([int]$Dump.layout.composerControls.stripHeight -gt 30) {
      throw "UI smoke dump for $Name composer control strip is too tall: $($Dump.layout.composerControls.stripHeight)"
    }
  }

  if ($Name -like "conversation*" -and $ExpectedClick -ne "new-thread") {
    if (
      -not $Dump.layout.markdown -or
      $Dump.layout.markdown.headings -lt 1 -or
      $Dump.layout.markdown.lists -lt 1 -or
      $Dump.layout.markdown.codeBlocks -lt 1 -or
      $Dump.layout.markdown.tables -lt 1
    ) {
      throw "UI smoke dump for $Name is missing rendered markdown structure"
    }
    if (-not $Dump.layout.turnItems -or [int]$Dump.layout.turnItems.chatArticles -lt 2) {
      throw "UI smoke dump for $Name expected the user message and final reply to remain expanded"
    }
    if (-not $Dump.layout.processedHistory -or [int]$Dump.layout.processedHistory.count -ne 1) {
      throw "UI smoke dump for $Name expected one processed history group"
    }
    if ($ExpectedClick -eq "processed-history") {
      if ([int]$Dump.layout.processedHistory.openCount -ne 1 -or [int]$Dump.layout.turnItems.detailItems -lt 1) {
        throw "UI smoke dump for $Name expected processed history to expand"
      }
    } elseif ([int]$Dump.layout.processedHistory.openCount -ne 0) {
      throw "UI smoke dump for $Name expected processed history to stay folded"
    }
    if ($ExpectedClick -ne "processed-history" -and [int]$Dump.layout.turnItems.openDetails -ne 0) {
      throw "UI smoke dump for $Name expected completed detail items to stay folded"
    }
  }

  if ($ExpectedClick -eq "conversation-menu" -and (-not $Dump.layout.menus -or [int]$Dump.layout.menus.contextMenus -lt 1)) {
    throw "UI smoke dump for $Name expected conversation context menu"
  }

  if ($ExpectedClick -eq "workspace-open-menu" -and (-not $Dump.layout.menus -or [int]$Dump.layout.menus.workspaceMenus -lt 1)) {
    throw "UI smoke dump for $Name expected workspace open menu"
  }

  if ($ExpectedClick -and -not $Dump.smokeClick.performed) {
    throw "UI smoke dump for $Name did not perform requested click: $ExpectedClick"
  }

  if ($ExpectedCompactRail -and -not ([string]$Dump.layout.rightRail.className).Contains("compact")) {
    throw "UI smoke dump for $Name expected compact right rail"
  }

  if ($ExpectedView -eq "settings" -and ($ExpectedClick -eq "" -or $ExpectedClick -eq "settings-logs")) {
    $settingsLayout = $Dump.layout.settingsLayout
    if (-not $settingsLayout) {
      throw "UI smoke dump for $Name is missing settings layout metrics"
    }
    if (-not ([string]$settingsLayout.className).Contains("single-panel")) {
      throw "UI smoke dump for $Name expected single-panel settings layout"
    }
    if ([int]$settingsLayout.panelCount -ne 1) {
      throw "UI smoke dump for $Name expected one visible settings panel, got $($settingsLayout.panelCount)"
    }
    $panelWidth = @($settingsLayout.panelWidths | Select-Object -First 1)[0]
    if ($panelWidth -lt ([double]$settingsLayout.width * 0.8)) {
      throw "UI smoke dump for $Name settings panel is too narrow: $panelWidth / $($settingsLayout.width)"
    }
  }

  if ($ExpectedView -eq "settings" -and $Dump.layout.settingRows -and [int]$Dump.layout.settingRows.count -gt 0) {
    if ([int]$Dump.layout.settingRows.maxHeight -gt 44) {
      throw "UI smoke dump for $Name settings rows are too tall: $($Dump.layout.settingRows.maxHeight)"
    }
  }

  $rootOverlaps = @($Dump.layout.rootOverlaps)
  if ($rootOverlaps.Count -gt 0) {
    $first = $rootOverlaps[0]
    throw "UI smoke dump for $Name has root layout overlap: $($first.a) / $($first.b)"
  }

  $textOverflows = @($Dump.layout.textOverflows)
  if ($textOverflows.Count -gt 0) {
    $first = $textOverflows[0]
    throw "UI smoke dump for $Name has text overflow in $($first.selector): $($first.text)"
  }
}

$results = @()
foreach ($case in $cases) {
  Write-Host "Capturing $($case.Name)..."
  $outputPathSuffix = if ($case.Args.ContainsKey("Width") -and $case.Args.ContainsKey("Height") -and ($case.Args.Width -ne 1440 -or $case.Args.Height -ne 920)) {
    "-$($case.Args.Width)x$($case.Args.Height)"
  } else {
    ""
  }
  $stateParts = @()
  if ($case.Args.ContainsKey("Fixture")) {
    $stateParts += $case.Args.Fixture
  }
  if ($case.Args.ContainsKey("View")) {
    $stateParts += $case.Args.View
  }
  if ($case.Args.ContainsKey("Click")) {
    $stateParts += $case.Args.Click
  }
  if ($case.Args.ContainsKey("WorkspaceAlias")) {
    $stateParts += "workspace-alias"
  }
  if (-not $stateParts.Length) {
    $stateParts += "normal"
  }
  $stateName = $stateParts -join "-"
  $outputPath = Join-Path $repoRoot "outputs\desktop-ui\smoke-$stateName$outputPathSuffix.png"
  $dumpPath = [System.IO.Path]::ChangeExtension($outputPath, ".json")

  $argList = @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $smokeScript,
    "-WaitSeconds",
    $WaitSeconds,
    "-OutputPath",
    $outputPath,
    "-DumpPath",
    $dumpPath,
    "-SmokeHome",
    $resolvedSmokeHome
  )
  if ($AppPath) {
    $argList += @("-AppPath", $AppPath)
  }
  if ($Workspace) {
    $argList += @("-Workspace", $Workspace)
  }
  foreach ($key in $case.Args.Keys) {
    $argList += @("-$key", $case.Args[$key])
  }

  & powershell @argList | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "UI smoke capture failed for $($case.Name)"
  }
  $item = Get-Item -LiteralPath $outputPath
  $dumpItem = Get-Item -LiteralPath $dumpPath
  $dump = Get-Content -LiteralPath $dumpPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $expectation = Get-SmokeExpectations -Case $case
  Assert-SmokeDump -Name $case.Name -Dump $dump -ExpectedText $expectation.Text -SelectedTabId $expectation.SelectedTabId -ExpectedView $expectation.View -ExpectedCompactRail $expectation.CompactRail -ExpectedClick $expectation.Click
  $selectedTabs = @($dump.tabs | Where-Object { $_.selected -eq $true } | ForEach-Object { $_.id })
  $imageSize = Get-ImageSize -Path $outputPath
  $requestedWidth = if ($case.Args.ContainsKey("Width")) { $case.Args.Width } else { 1440 }
  $requestedHeight = if ($case.Args.ContainsKey("Height")) { $case.Args.Height } else { 920 }
  $expectedImageWidth = if ($dump.layout.viewport.width) { [int]$dump.layout.viewport.width } else { $requestedWidth }
  $expectedImageHeight = if ($dump.layout.viewport.height) { [int]$dump.layout.viewport.height } else { $requestedHeight }
  if ($imageSize.Width -ne $expectedImageWidth -or $imageSize.Height -ne $expectedImageHeight) {
    throw "UI smoke capture size mismatch for $($case.Name): expected content ${expectedImageWidth}x${expectedImageHeight}, got $($imageSize.Width)x$($imageSize.Height)"
  }
  $results += [pscustomobject]@{
    Name = $case.Name
    Fixture = if ($case.Args.ContainsKey("Fixture")) { $case.Args.Fixture } else { "" }
    View = if ($case.Args.ContainsKey("View")) { $case.Args.View } else { "threads" }
    Click = if ($case.Args.ContainsKey("Click")) { $case.Args.Click } else { "" }
    RequestedWidth = $requestedWidth
    RequestedHeight = $requestedHeight
    Width = $imageSize.Width
    Height = $imageSize.Height
    Length = $item.Length
    FullName = $item.FullName
    DumpLength = $dumpItem.Length
    DumpFullName = $dumpItem.FullName
    TextLength = $dump.textLength
    SelectedTabs = $selectedTabs
    AssertedText = $expectation.Text
    ComposerHeight = if ($dump.layout.composer) { $dump.layout.composer.height } else { 0 }
    HorizontalOverflow = $dump.layout.horizontalOverflow
    RootOverlapCount = @($dump.layout.rootOverlaps).Count
    TextOverflowCount = @($dump.layout.textOverflows).Count
    FooterHeight = if ($dump.layout.statusFooter) { $dump.layout.statusFooter.height } else { 0 }
    FooterItemCount = if ($dump.layout.statusFooter) { $dump.layout.statusFooter.itemCount } else { 0 }
    ComposerControlMaxWidth = if ($dump.layout.composerControls) { $dump.layout.composerControls.maxWidth } else { 0 }
    ComposerControlStripHeight = if ($dump.layout.composerControls) { $dump.layout.composerControls.stripHeight } else { 0 }
    OperationRowMaxHeight = if ($dump.layout.operationRows) { $dump.layout.operationRows.maxHeight } else { 0 }
  }
}

foreach ($result in $results) {
  $sampledColors = Get-SampledColorCount -Path $result.FullName
  $brightRatio = Get-BrightPixelRatio -Path $result.FullName
  $result | Add-Member -NotePropertyName SampledColors -NotePropertyValue $sampledColors
  $result | Add-Member -NotePropertyName BrightRatio -NotePropertyValue ([Math]::Round($brightRatio, 4))
}
New-SmokeContactSheet -Results $results -Path $ContactSheetPath
$contactSheetItem = Get-Item -LiteralPath $ContactSheetPath

$manifest = [pscustomobject]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  app_path = $AppPath
  workspace = $Workspace
  smoke_home = $resolvedSmokeHome
  contact_sheet = $contactSheetItem.FullName
  cases = $results
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ManifestPath) | Out-Null
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

$missingCases = $cases.Name | Where-Object { $caseName = $_; -not ($results | Where-Object { $_.Name -eq $caseName }) }
if ($missingCases) {
  throw "Missing UI smoke cases: $($missingCases -join ', ')"
}

$invalidImages = $results | Where-Object {
  -not (Test-Path -LiteralPath $_.FullName) -or ($_.Length -lt $MinImageBytes -and $_.SampledColors -lt $MinSampledColors)
}
if ($invalidImages) {
  $invalidImages | Select-Object Name, Length, FullName | Format-Table -AutoSize
  throw "Invalid UI smoke screenshots detected"
}

$lowColorImages = $results | Where-Object { $_.SampledColors -lt $MinSampledColors }
if ($lowColorImages) {
  $lowColorImages | Select-Object Name, SampledColors, FullName | Format-Table -AutoSize
  throw "UI smoke screenshots look blank or under-rendered"
}

$dimImages = $results | Where-Object { $_.BrightRatio -lt 0.03 -and $_.Length -lt $MinImageBytes }
if ($dimImages) {
  $dimImages | Select-Object Name, BrightRatio, FullName | Format-Table -AutoSize
  throw "UI smoke screenshots look blank or not yet painted"
}

if ($contactSheetItem.Length -lt $MinImageBytes) {
  throw "UI smoke contact sheet looks too small: $($contactSheetItem.FullName)"
}

Write-Host "Manifest: $ManifestPath"
Write-Host "Contact sheet: $($contactSheetItem.FullName)"
Write-Host "Verified $($results.Count) UI smoke artifacts, min bytes $MinImageBytes, min sampled colors $MinSampledColors"
$results | Select-Object Name, Length, FullName | Format-Table -AutoSize
