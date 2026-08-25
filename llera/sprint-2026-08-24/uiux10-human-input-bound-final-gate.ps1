[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$AccessibilityBoundFinalReport,
  [Parameter(Mandatory)][string]$RealInputReport,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m; exit 2 }
function Read-Json([string]$p) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail "Missing evidence: $p" }
  try { return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json }
  catch { Fail "Invalid JSON evidence: $p :: $($_.Exception.Message)" }
}
function Require-Sha([string]$v,[string]$label) {
  if ($v -notmatch '^[a-f0-9]{64}$') { Fail "$label is not a lowercase SHA-256." }
}

$final = Read-Json $AccessibilityBoundFinalReport
$input = Read-Json $RealInputReport

if ($final.verdict -ne 'PASS' -or [int]$final.score -ne 100) { Fail 'Accessibility-bound final proof is not strict 100/100 PASS.' }
if ($input.product -ne 'LLera UIUX 10/10 Real Input Audit') { Fail 'Unexpected real-input evidence product marker.' }
if ($input.verdict -ne 'PASS' -or [int]$input.score -ne 100) { Fail 'Real-input audit is not strict 100/100 PASS.' }
if (@($input.failures).Count -ne 0) { Fail 'Real-input audit contains failures.' }
if (@($input.warnings).Count -ne 0) { Fail 'Real-input audit contains warnings.' }

$required = @('focusReachedComposer','clipboardPasteExactUnicode','undoRestoresPreviousValue','copyExactUnicode','windowStillResponding')
foreach ($name in $required) {
  if (-not ($input.checks.PSObject.Properties.Name -contains $name)) { Fail "Missing real-input check: $name" }
  if ($input.checks.$name -ne $true) { Fail "Real-input check did not pass: $name" }
}

Require-Sha ([string]$input.process.sha256) 'Real-input executable SHA-256'
Require-Sha ([string]$input.sampleSha256) 'Real-input sample SHA-256'

# Bind to the same runtime/host used by the existing final proof when those fields are exposed.
if ($final.PSObject.Properties.Name -contains 'host') {
  if ([string]$final.host -ne [string]$input.host) { Fail 'Final proof and real-input proof were captured on different Windows hosts.' }
}
$expectedExe = $null
foreach ($candidate in @('executableSha256','runtimeSha256','lleraExeSha256')) {
  if ($final.PSObject.Properties.Name -contains $candidate) { $expectedExe = [string]$final.$candidate; break }
}
if ($expectedExe) {
  Require-Sha $expectedExe 'Final proof executable SHA-256'
  if ($expectedExe -ne [string]$input.process.sha256) { Fail 'Real-input audit did not exercise the exact binary bound to final proof.' }
}

$result = [ordered]@{
  schema = 1
  product = 'LLera UIUX 10/10 Human-Input-Bound Final Gate'
  checkedAt = (Get-Date).ToUniversalTime().ToString('o')
  host = [string]$input.host
  executableSha256 = [string]$input.process.sha256
  accessibilityBoundFinalSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $AccessibilityBoundFinalReport).Hash.ToLowerInvariant()
  realInputReportSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $RealInputReport).Hash.ToLowerInvariant()
  score = 100
  verdict = 'PASS'
  contract = @(
    'Strict prior final proof is 100/100 PASS',
    'Real Windows keyboard focus reaches LLera composer',
    'Ctrl+V preserves Turkish Unicode exactly',
    'Ctrl+Z restores prior composer state',
    'Ctrl+C preserves Turkish Unicode exactly',
    'LLera remains responsive throughout',
    'Evidence is bound to executable SHA-256'
  )
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = Join-Path $OutputDirectory ("uiux10-human-input-final-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$result | ConvertTo-Json -Depth 7
exit 0
