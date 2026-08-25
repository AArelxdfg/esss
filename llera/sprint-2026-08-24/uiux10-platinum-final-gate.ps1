[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$CaptureBoundFinalReport,
  [Parameter(Mandatory)][string]$PerMonitorDpiReport,
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p :: $($_.Exception.Message)"}}
function Sha([string]$p){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()}
$f=Read-Json $CaptureBoundFinalReport
$m=Read-Json $PerMonitorDpiReport
if($f.product-ne'LLera UIUX 10/10 Capture-Bound Final Gate' -or $f.candidate-ne$ExpectedCandidate -or $f.verdict-ne'PASS' -or [int]$f.score-ne100){Fail 'Capture-bound final proof is not strict 100/100.'}
if($m.product-ne'LLera UIUX 10/10 Per-Monitor DPI Audit' -or $m.candidate-ne$ExpectedCandidate -or $m.verdict-ne'PASS' -or [int]$m.score-ne100){Fail 'Per-monitor DPI proof is not strict 100/100.'}
if([int]$m.monitorCount-lt2){Fail 'Per-monitor DPI proof used fewer than two physical displays.'}
if([int]$m.failureCount-ne0 -or [int]$m.warningCount-ne0 -or @($m.failures).Count-ne0 -or @($m.warnings).Count-ne0){Fail 'Per-monitor DPI proof contains failures or warnings.'}
if([string]$m.computer-ne[string]$f.computer){Fail 'Evidence must come from the same physical Windows host.'}
if([string]$m.process.executableSha256-ne[string]$f.executableSha256){Fail 'Per-monitor DPI audit used a different LLera executable.'}
$distinct=@($m.samples|ForEach-Object{[int]$_.dpi}|Sort-Object -Unique)
if($distinct.Count-lt2){Fail 'No real per-monitor DPI transition was observed.'}
foreach($s in @($m.samples)){if($s.responding-ne$true -or $s.hung-ne$false -or $s.uiaRoot-ne$true -or $s.insideWorkingArea-ne$true){Fail "Monitor $($s.monitorIndex) responsiveness/UIA/work-area proof failed."};if([int]$s.unnamedFocusableCount-ne0 -or [int]$s.offscreenFocusableCount-ne0 -or [int]$s.clippedFocusableCount-ne0){Fail "Monitor $($s.monitorIndex) accessibility/clipping proof failed."};if([string]$s.screenshot.sha256-notmatch'^[0-9a-f]{64}$'){Fail "Monitor $($s.monitorIndex) screenshot SHA-256 missing."}}
$result=[ordered]@{schema=1;product='LLera UIUX 10/10 Platinum Final Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=[string]$f.computer;executableSha256=[string]$f.executableSha256;score=100;verdict='PASS';policy=@{requireCaptureBoundFinal100=$true;requirePerMonitorDpi100=$true;requireAtLeastTwoDisplays=$true;requireObservedDpiTransition=$true;requireSamePhysicalHost=$true;requireSameExecutableSha256=$true;allowWarnings=$false};evidence=@{captureBoundFinalSha256=Sha $CaptureBoundFinalReport;perMonitorDpiSha256=Sha $PerMonitorDpiReport;monitorCount=[int]$m.monitorCount;observedDpis=$distinct;screenshotSha256=@($m.samples|ForEach-Object{$_.screenshot.sha256})}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory("uiux10-platinum-final-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8;$hash=Sha $out;"$hash  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict 10/10 proof includes a real per-monitor DPI transition on the same binary.';Write-Host "Evidence: $out";Write-Host "SHA-256: $hash";exit 0
