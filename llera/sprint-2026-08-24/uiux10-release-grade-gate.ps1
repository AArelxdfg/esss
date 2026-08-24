[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$UltimateGateReport,
 [Parameter(Mandatory)][string]$DynamicResizeReport,
 [Parameter(Mandatory)][string]$ColdStartReport,
 [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
 [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}
$u=Read-Json $UltimateGateReport;$r=Read-Json $DynamicResizeReport;$c=Read-Json $ColdStartReport
if($u.product-ne'LLera UIUX 10/10 Ultimate Gate'){Fail 'Unexpected ultimate gate product marker.'}
if($u.candidate-ne$ExpectedCandidate-or$u.verdict-ne'PASS'-or[int]$u.score-ne100){Fail 'Ultimate gate is not strict 100/100 for the expected candidate.'}
if($r.product-ne'LLera UIUX 10/10 Dynamic Resize Audit'){Fail 'Unexpected dynamic resize product marker.'}
if($r.candidate-ne$ExpectedCandidate-or$r.verdict-ne'PASS'-or[int]$r.score-ne100){Fail 'Dynamic resize audit is not strict 100/100 for the expected candidate.'}
if([int]$r.failureCount-ne0-or[int]$r.warningCount-ne0){Fail 'Dynamic resize evidence contains failures or warnings.'}
if($c.product-ne'LLera UIUX 10/10 Cold Start Audit'){Fail 'Unexpected cold-start audit product marker.'}
if($c.candidate-ne$ExpectedCandidate-or$c.verdict-ne'PASS'-or[int]$c.score-ne100){Fail 'Cold-start audit is not strict 100/100 for the expected candidate.'}
if([int]$c.failureCount-ne0-or[int]$c.warningCount-ne0){Fail 'Cold-start evidence contains failures or warnings.'}
if([int]$c.timing.visibleWindowMs-gt[int]$c.timing.maxVisibleWindowMs){Fail 'Cold-start visible-window latency exceeds its strict limit.'}
if([int]$c.timing.interactiveReadyMs-gt[int]$c.timing.maxInteractiveMs){Fail 'Cold-start interactive-readiness latency exceeds its strict limit.'}
if([int]$c.automation.visibleFocusableCount-lt2-or[int]$c.automation.namedVisibleFocusableCount-ne[int]$c.automation.visibleFocusableCount){Fail 'Cold-start UI Automation readiness evidence is incomplete.'}
if([string]::IsNullOrWhiteSpace([string]$c.screenshot.sha256)-or[string]$c.screenshot.sha256-notmatch'^[0-9a-f]{64}$'){Fail 'Cold-start screenshot SHA-256 is missing or malformed.'}
if([string]::IsNullOrWhiteSpace([string]$c.executable.sha256)-or[string]$c.executable.sha256-notmatch'^[0-9a-f]{64}$'){Fail 'Cold-start executable SHA-256 is missing or malformed.'}
if([string]$r.computer-ne[string]$u.computer-or[string]$c.computer-ne[string]$u.computer){Fail 'All UIUX proof must come from the same physical Windows host.'}
$required=@(@{name='compact';w=1024;h=640},@{name='small';w=1180;h=720},@{name='baseline';w=1366;h=768},@{name='medium';w=1600;h=900},@{name='fullhd';w=1920;h=1080})
foreach($q in $required){$m=@($r.cases|Where-Object{$_.case-eq$q.name-and[int]$_.width-eq$q.w-and[int]$_.height-eq$q.h-and$_.pass});if($m.Count-ne1){Fail "Missing exact dynamic resize PASS: $($q.name) $($q.w)x$($q.h)"};$x=$m[0];if($x.hung-or(-not$x.responding)-or[int]$x.offscreenFocusable-ne0-or[int]$x.namelessFocusable-ne0-or[int]$x.clippedVisibleElements-ne0){Fail "Invalid dynamic resize state: $($q.name)"}}
$usha=(Get-FileHash -Algorithm SHA256 -LiteralPath $UltimateGateReport).Hash.ToLowerInvariant();$rsha=(Get-FileHash -Algorithm SHA256 -LiteralPath $DynamicResizeReport).Hash.ToLowerInvariant();$csha=(Get-FileHash -Algorithm SHA256 -LiteralPath $ColdStartReport).Hash.ToLowerInvariant()
$result=[ordered]@{schema=2;product='LLera UIUX 10/10 Release-Grade Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$u.computer;score=100;verdict='PASS';policy=@{requireUltimate100=$true;requireDynamicResize100=$true;requireColdStart100=$true;allowWarnings=$false;requireSamePhysicalWindowsHost=$true;requiredResizeCases=$required;maxColdStartVisibleMs=[int]$c.timing.maxVisibleWindowMs;maxColdStartInteractiveMs=[int]$c.timing.maxInteractiveMs};evidence=@{ultimateGateSha256=$usha;dynamicResizeSha256=$rsha;coldStartSha256=$csha;coldStartScreenshotSha256=$c.screenshot.sha256;testedExecutableSha256=$c.executable.sha256;resizeCaseCount=@($r.cases).Count}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-release-grade-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX release-grade physical contract = 100/100, including cold-start readiness and live dynamic resize integrity.';Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";exit 0
