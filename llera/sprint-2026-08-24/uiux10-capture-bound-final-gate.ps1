[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$FinalProofReport,
    [Parameter(Mandatory)][string]$DualCaptureReport,
    [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p :: $($_.Exception.Message)"}}
function Sha([string]$p){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()}
$f=Read-Json $FinalProofReport
$d=Read-Json $DualCaptureReport
if($f.product-ne'LLera UIUX 10/10 Final Proof Gate' -or $f.candidate-ne$ExpectedCandidate -or $f.verdict-ne'PASS' -or [int]$f.score-ne100){Fail 'Base final proof is not strict 100/100.'}
if($d.product-ne'LLera UIUX 10/10 Dual Capture Audit' -or $d.candidate-ne$ExpectedCandidate -or $d.verdict-ne'PASS' -or [int]$d.score-ne100){Fail 'Dual-path physical capture proof is not strict 100/100.'}
if(@($d.failures).Count-ne0 -or @($d.warnings).Count-ne0 -or [int]$d.failureCount-ne0 -or [int]$d.warningCount-ne0){Fail 'Dual capture proof contains failures or warnings.'}
if([string]$d.computer-ne[string]$f.computer){Fail 'Final proof and dual capture must come from the same physical Windows host.'}
if([int]$d.process.pid-le0 -or $d.process.responding-ne$true){Fail 'Dual capture is not bound to a responsive LLera process.'}
if([int64]$d.foregroundHwnd-ne[int64]$d.process.hwnd){Fail 'LLera did not own the foreground window during dual capture.'}
$screenSha=[string]$d.captures.screen.sha256;$printSha=[string]$d.captures.printWindow.sha256
if($screenSha-notmatch'^[0-9a-f]{64}$' -or $printSha-notmatch'^[0-9a-f]{64}$'){Fail 'Dual capture SHA-256 evidence is missing or malformed.'}
if([double]$d.similarity.meanRgbDelta-gt[double]$d.thresholds.maxMeanRgbDelta){Fail 'Dual capture pixel delta exceeds the audited threshold.'}
if([double]$d.similarity.closePixelRatio-lt[double]$d.thresholds.minClosePixelRatio){Fail 'Dual capture similarity ratio is below the audited threshold.'}
$result=[ordered]@{schema=1;product='LLera UIUX 10/10 Capture-Bound Final Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=[string]$f.computer;score=100;verdict='PASS';executableSha256=[string]$f.executableSha256;policy=@{requireBaseFinalProof100=$true;requireForegroundOwnership=$true;requireCopyFromScreenEvidence=$true;requirePrintWindowEvidence=$true;requireDualCaptureSimilarity=$true;requireSamePhysicalWindowsHost=$true;allowWarnings=$false};evidence=@{finalProofSha256=Sha $FinalProofReport;dualCaptureReportSha256=Sha $DualCaptureReport;screenSha256=$screenSha;printWindowSha256=$printSha;meanRgbDelta=[double]$d.similarity.meanRgbDelta;closePixelRatio=[double]$d.similarity.closePixelRatio;pid=[int]$d.process.pid;hwnd=[int64]$d.process.hwnd}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory("uiux10-capture-bound-final-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8;$sha=Sha $out;"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict final proof is bound to foreground-owned dual-path physical pixels.';Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";exit 0
