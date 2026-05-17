[CmdletBinding()]
param(
  [string]$ReportPath,
  [switch]$SkipMake,
  [switch]$SkipSmoke
)

$ErrorActionPreference = "Stop"

$desktopRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
if (-not $ReportPath) {
  $ReportPath = Join-Path $repoRoot "outputs\desktop-ui\release-verify.json"
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-ReleaseEvidence {
  param([bool]$SmokeSkipped)

  $runtimeSmokePath = Join-Path $repoRoot "outputs\desktop-ui\runtime-smoke.json"
  $sidecarSmokePath = Join-Path $repoRoot "outputs\desktop-ui\sidecar-restart-smoke.json"
  $uiManifestPath = Join-Path $repoRoot "outputs\desktop-ui\smoke-manifest.json"
  $uiContactSheetPath = Join-Path $repoRoot "outputs\desktop-ui\smoke-contact-sheet.png"

  $runtime = Read-JsonFile -Path $runtimeSmokePath
  $sidecar = Read-JsonFile -Path $sidecarSmokePath
  $ui = Read-JsonFile -Path $uiManifestPath
  $uiCases = if ($ui -and $ui.cases) { @($ui.cases) } else { @() }

  [pscustomobject]@{
    smoke_skipped_in_this_run = $SmokeSkipped
    runtime_smoke = [pscustomobject]@{
      path = $runtimeSmokePath
      exists = [bool]$runtime
      ok = [bool]($runtime -and $runtime.ok)
      fake_provider_requests = if ($runtime) { [int]$runtime.fakeProvider.requests } else { 0 }
      stream_done = [bool]($runtime -and $runtime.streamFlow.done)
      approval_required = [bool]($runtime -and $runtime.approvalFlow.required)
      approval_delivered = [bool]($runtime -and $runtime.approvalFlow.decisionDelivered)
      approval_allow_required = [bool]($runtime -and $runtime.approvalAllowFlow.required)
      approval_allow_delivered = [bool]($runtime -and $runtime.approvalAllowFlow.decisionDelivered)
      approval_allow_message_delta = [bool]($runtime -and $runtime.approvalAllowFlow.messageDelta)
      approval_allow_done = [bool]($runtime -and $runtime.approvalAllowFlow.done)
      token_redacted = [bool]($runtime -and $runtime.readyPayload.auth_token -eq "<redacted>")
      checked_endpoints = if ($runtime -and $runtime.checkedEndpoints) { @($runtime.checkedEndpoints).Count } else { 0 }
    }
    sidecar_restart = [pscustomobject]@{
      path = $sidecarSmokePath
      exists = [bool]$sidecar
      ok = [bool]($sidecar -and $sidecar.ok)
      pid_changed = [bool]($sidecar -and $sidecar.initial_pid -ne $sidecar.restarted_pid)
      port_changed = [bool]($sidecar -and $sidecar.initial_port -ne $sidecar.restarted_port)
    }
    ui_smoke = [pscustomobject]@{
      manifest_path = $uiManifestPath
      contact_sheet_path = $uiContactSheetPath
      manifest_exists = [bool]$ui
      contact_sheet_exists = Test-Path -LiteralPath $uiContactSheetPath
      case_count = $uiCases.Count
      horizontal_overflow_count = @($uiCases | Where-Object { $_.HorizontalOverflow }).Count
      root_overlap_count = @($uiCases | Where-Object { $_.RootOverlapCount -gt 0 }).Count
      text_overflow_count = @($uiCases | Where-Object { $_.TextOverflowCount -gt 0 }).Count
    }
  }
}

function Test-SmokeEvidence {
  param($Evidence)

  return $Evidence.runtime_smoke.ok -and
    $Evidence.runtime_smoke.fake_provider_requests -ge 5 -and
    $Evidence.runtime_smoke.stream_done -and
    $Evidence.runtime_smoke.approval_required -and
    $Evidence.runtime_smoke.approval_delivered -and
    $Evidence.runtime_smoke.approval_allow_required -and
    $Evidence.runtime_smoke.approval_allow_delivered -and
    $Evidence.runtime_smoke.approval_allow_message_delta -and
    $Evidence.runtime_smoke.approval_allow_done -and
    $Evidence.runtime_smoke.token_redacted -and
    $Evidence.sidecar_restart.ok -and
    $Evidence.sidecar_restart.pid_changed -and
    $Evidence.ui_smoke.manifest_exists -and
    $Evidence.ui_smoke.contact_sheet_exists -and
    $Evidence.ui_smoke.case_count -ge 1 -and
    $Evidence.ui_smoke.horizontal_overflow_count -eq 0 -and
    $Evidence.ui_smoke.root_overlap_count -eq 0 -and
    $Evidence.ui_smoke.text_overflow_count -eq 0
}

$steps = @(
  @{ Name = "typecheck"; Script = "typecheck" },
  @{ Name = "lint"; Script = "lint" },
  @{ Name = "test"; Script = "test" },
  @{ Name = "package"; Script = "package:win" },
  @{ Name = "verify package"; Script = "verify:package" }
)

if (-not $SkipMake) {
  $steps += @(
    @{ Name = "make"; Script = "make:win" },
    @{ Name = "verify make"; Script = "verify:make" }
  )
}

if (-not $SkipSmoke) {
  $steps += @(
    @{ Name = "runtime smoke"; Script = "smoke:runtime" },
    @{ Name = "sidecar restart smoke"; Script = "smoke:sidecar" },
    @{ Name = "ui smoke"; Script = "smoke:ui" }
  )
}

$results = @()
$failureMessage = $null
Push-Location $desktopRoot
try {
  foreach ($step in $steps) {
    Write-Host "== $($step.Name) =="
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    & npm run $step.Script
    $exitCode = $LASTEXITCODE
    $watch.Stop()
    $results += [pscustomobject]@{
      Name = $step.Name
      Script = $step.Script
      Seconds = [Math]::Round($watch.Elapsed.TotalSeconds, 2)
      ExitCode = $exitCode
    }
    if ($exitCode -ne 0) {
      $failureMessage = "Release verification failed at $($step.Name)"
      break
    }
  }
} finally {
  Pop-Location
}

$evidence = Get-ReleaseEvidence -SmokeSkipped ([bool]$SkipSmoke)
if (-not $SkipSmoke -and -not $failureMessage -and -not (Test-SmokeEvidence -Evidence $evidence)) {
  $failureMessage = "Release verification missing required smoke evidence"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
$report = [pscustomobject]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  status = if ($failureMessage) { "failed" } else { "passed" }
  skipped = @{
    make = [bool]$SkipMake
    smoke = [bool]$SkipSmoke
  }
  steps = $results
  evidence = $evidence
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Report: $ReportPath"
$results | Format-Table -AutoSize
Write-Host "Evidence:"
$evidence | ConvertTo-Json -Depth 8

if ($failureMessage) {
  throw $failureMessage
}
