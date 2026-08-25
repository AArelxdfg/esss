[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$MatrixReport,
  [Parameter(Mandatory)][string]$LayoutShiftReport,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$m) { Write-Error $m; exit 2 }
function ReadJson([string]$p) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail "Missing report: $p" }
  try { Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { Fail "Invalid JSON: $p :: $($_.Exception.Message)" }
}
function GetScore($o) {
  foreach ($n in @('score','overallScore','totalScore')) {
    if ($o.PSObject.Properties.Name -contains $n) { return [int]$o.$n }
  }
  return -1
}
function GetWarningCount($o) {
  if ($o.PSObject.Properties.Name -contains 'warningCount') { return [int]$o.warningCount }
  if ($o.PSObject.Properties.Name -contains 'warnings') { return @($o.warnings).Count }
  return -1
}

$m = ReadJson $MatrixReport
$l = ReadJson $LayoutShiftReport
$ms = GetScore $m
$ls = GetScore $l
if ($ms -ne 100) { Fail "Authoritative matrix score is $ms, expected exactly 100." }
if ($m.verdict -ne 'PASS') { Fail "Authoritative matrix verdict is $($m.verdict)." }
$mw = GetWarningCount $m
if ($mw -ne 0) { Fail "Authoritative matrix warning count is $mw, expected 0." }
if ($l.product -ne 'LLera UIUX10 Layout Shift Stability Audit') { Fail 'Unexpected layout-shift report product marker.' }
if ($ls -ne 100 -or $l.verdict -ne 'PASS') { Fail "Layout stability is not strict 100/100 PASS (score=$ls verdict=$($l.verdict))." }
if ([int]$l.warningCount -ne 0 -or [int]$l.failureCount -ne 0) { Fail 'Layout stability contains warnings or failures.' }
if ([double]$l.observed.maxObservedJitterPx -gt [double]$l.policy.maxJitterPx) { Fail 'Observed layout jitter exceeds policy.' }

$matrixHost = $null
if ($m.PSObject.Properties.Name -contains 'host') {
  if ($m.host -is [string]) { $matrixHost = [string]$m.host }
  elseif ($m.host.PSObject.Properties.Name -contains 'computer') { $matrixHost = [string]$m.host.computer }
}
$layoutHost = [string]$l.host.computer
if ($matrixHost -and $layoutHost -and $matrixHost -ne $layoutHost) { Fail "Evidence host mismatch: matrix=$matrixHost layout=$layoutHost" }

# If the matrix exposes runtime SHA, it must bind to the same executable. Absence is not invented.
$matrixExeSha = $null
foreach ($n in @('executableSha256','runtimeExecutableSha256','runtimeSha256')) {
  if ($m.PSObject.Properties.Name -contains $n) { $matrixExeSha = [string]$m.$n; break }
}
if (-not $matrixExeSha -and ($m.PSObject.Properties.Name -contains 'runtime')) {
  if ($m.runtime -and ($m.runtime.PSObject.Properties.Name -contains 'executableSha256')) { $matrixExeSha = [string]$m.runtime.executableSha256 }
}
if ($matrixExeSha -and $matrixExeSha.ToLowerInvariant() -ne ([string]$l.runtime.executableSha256).ToLowerInvariant()) { Fail 'Runtime executable SHA-256 differs between matrix and layout stability proof.' }

$result = [ordered]@{
  schema = 1
  product = 'LLera UIUX10 Layout-Stability Bound Gate'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  verdict = 'PASS'
  score = 100
  matrixSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $MatrixReport).Hash.ToLowerInvariant()
  layoutShiftSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $LayoutShiftReport).Hash.ToLowerInvariant()
  runtimeExecutableSha256 = ([string]$l.runtime.executableSha256).ToLowerInvariant()
  host = $layoutHost
  policy = [ordered]@{ exactMatrixScore=100; exactLayoutScore=100; warningsAllowed=0; failuresAllowed=0 }
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = Join-Path $OutputDirectory ("uiux10-layout-bound-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "PASS: authoritative 100/100 matrix is bound to 100/100 physical layout stability."
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
