[CmdletBinding()]
param(
  [string]$ProcessName = 'LLera',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function Fail([string]$m) { throw $m }
function Get-RootForProcess($p) {
  if ($p.MainWindowHandle -eq 0) { return $null }
  return [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
}
function Get-Editable($root) {
  $cond = New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document))
  )
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
  foreach ($e in $all) {
    if ($e.Current.IsOffscreen) { continue }
    if (-not $e.Current.IsEnabled) { continue }
    try {
      $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($vp) { return $e }
    } catch {}
  }
  return $null
}

$p = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1)
if ($p.Count -ne 1) { Fail 'Exactly one visible LLera window is required.' }
$p = $p[0]
if (-not $p.Responding) { Fail 'LLera is not responding.' }
$root = Get-RootForProcess $p
if ($null -eq $root) { Fail 'UI Automation root unavailable.' }
$edit = Get-Editable $root
if ($null -eq $edit) { Fail 'No visible enabled editable composer was found.' }

$vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$original = $vp.Current.Value
$sample = 'AArel UIUX fiziksel girdi: ğüşiöç ĞÜŞİÖÇ — merhaba dünya — 12345'
$warnings = @()
$failures = @()
$checks = [ordered]@{}

try {
  $edit.SetFocus()
  Start-Sleep -Milliseconds 150
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $checks.focusReachedComposer = ($focused -ne $null -and $focused.Current.ProcessId -eq $p.Id)
  if (-not $checks.focusReachedComposer) { $failures += 'Keyboard focus did not remain in LLera.' }

  # Real Windows clipboard + keyboard paste path. This tests the actual input plumbing rather than UIA SetValue.
  [System.Windows.Forms.Clipboard]::SetText($sample)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 250
  $afterPaste = $vp.Current.Value
  $checks.clipboardPasteExactUnicode = ($afterPaste -eq $sample)
  if (-not $checks.clipboardPasteExactUnicode) { $failures += 'Ctrl+V Unicode round-trip mismatch.' }

  # Undo must restore the previous composer value; this catches broken Electron input history/focus paths.
  [System.Windows.Forms.SendKeys]::SendWait('^z')
  Start-Sleep -Milliseconds 200
  $afterUndo = $vp.Current.Value
  $checks.undoRestoresPreviousValue = ($afterUndo -eq $original)
  if (-not $checks.undoRestoresPreviousValue) { $failures += 'Ctrl+Z did not restore the previous composer value.' }

  # Re-paste then select/copy through the real keyboard path and verify the clipboard receives exactly what is visible.
  [System.Windows.Forms.Clipboard]::SetText($sample)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^c')
  Start-Sleep -Milliseconds 150
  $copied = if ([System.Windows.Forms.Clipboard]::ContainsText()) { [System.Windows.Forms.Clipboard]::GetText() } else { '' }
  $checks.copyExactUnicode = ($copied -eq $sample)
  if (-not $checks.copyExactUnicode) { $failures += 'Ctrl+C clipboard round-trip mismatch.' }

  $checks.windowStillResponding = (Get-Process -Id $p.Id).Responding
  if (-not $checks.windowStillResponding) { $failures += 'LLera stopped responding during real-input audit.' }
}
finally {
  try {
    $vp.SetValue($original)
    Start-Sleep -Milliseconds 100
  } catch {
    $failures += 'Could not restore original composer value.'
  }
}

$exePath = $p.Path
$exeSha = if ($exePath -and (Test-Path -LiteralPath $exePath -PathType Leaf)) { (Get-FileHash -Algorithm SHA256 -LiteralPath $exePath).Hash.ToLowerInvariant() } else { $null }
if (-not $exeSha) { $failures += 'Unable to bind audit to executable SHA-256.' }

$score = 100
if ($failures.Count -gt 0) { $score = [Math]::Max(0,100 - (25 * $failures.Count)) }
if ($warnings.Count -gt 0) { $score = [Math]::Max(0,$score - (5 * $warnings.Count)) }
$verdict = if ($score -eq 100 -and $failures.Count -eq 0 -and $warnings.Count -eq 0) { 'PASS' } else { 'FAIL' }

$report = [ordered]@{
  schema = 1
  product = 'LLera UIUX 10/10 Real Input Audit'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  host = $env:COMPUTERNAME
  process = [ordered]@{ pid=$p.Id; path=$exePath; sha256=$exeSha }
  checks = $checks
  sampleSha256 = ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($sample))).Replace('-','').ToLowerInvariant())
  warnings = $warnings
  failures = $failures
  score = $score
  verdict = $verdict
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputDirectory "uiux10-real-input-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$report | ConvertTo-Json -Depth 8
if ($verdict -ne 'PASS') { exit 2 }
exit 0
