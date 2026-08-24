[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$UltimateGateReport,
 [Parameter(Mandatory)][string]$DynamicResizeReport,
 [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
 [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}
$u=Read-Json $UltimateGateReport;$r=Read-Json $DynamicResizeReport
if($u.product-ne'LLera UIUX 10/10 Ultimate Gate'){Fail 'Unexpected ultimate gate product marker.'}
if($u.candidate-ne$ExpectedCandidate-or$u.verdict-ne'PASS'-or[int]$u.score-ne100){Fail 'Ultimate gate is not strict 100/100 for the expected candidate.'}
if($r.product-ne'LLera UIUX 10/10 Dynamic Resize Audit'){Fail 'Unexpected dynamic resize product marker.'}
if($r.candidate-ne$ExpectedCandidate-or$r.verdict-ne'PASS'-or[int]$r.score-ne100){Fail 'Dynamic resize audit is not strict 100/100 for the expected candidate.'}
if([int]$r.failureCount-ne0-or[int]$r.warningCount-ne0){Fail 'Dynamic resize evidence contains failures or warnings.'}
if([string]$r.computer-ne[string]$u.computer){Fail 'Dynamic resize and ultimate proof must come from the same physical Windows host.'}
$required=@(@{name='compact';w=1024;h=640},@{name='small';w=1180;h=720},@{name='baseline';w=1366;h=768},@{name='medium';w=1600;h=900},@{name='fullhd';w=1920;h=1080})
foreach($q in $required){$m=@($r.cases|Where-Object{$_.case-eq$q.name-and[int]$_.width-eq$q.w-and[int]$_.height-eq$q.h-and$_.pass});if($m.Count-ne1){Fail "Missing exact dynamic resize PASS: $($q.name) $($q.w)x$($q.h)"};$x=$m[0];if($x.hung-or(-not$x.responding)-or[int]$x.offscreenFocusable-ne0-or[int]$x.namelessFocusable-ne0-or[int]$x.clippedVisibleElements-ne0){Fail "Invalid dynamic resize state: $($q.name)"}}
$usha=(Get-FileHash -Algorithm SHA256 -LiteralPath $UltimateGateReport).Hash.ToLowerInvariant();$rsha=(Get-FileHash -Algorithm SHA256 -LiteralPath $DynamicResizeReport).Hash.ToLowerInvariant()
$result=[ordered]@{schema=1;product='LLera UIUX 10/10 Release-Grade Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$u.computer;score=100;verdict='PASS';policy=@{requireUltimate100=$true;requireDynamicResize100=$true;allowWarnings=$false;requireSamePhysicalWindowsHost=$true;requiredResizeCases=$required};evidence=@{ultimateGateSha256=$usha;dynamicResizeSha256=$rsha;resizeCaseCount=@($r.cases).Count}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-release-grade-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX release-grade physical contract = 100/100, including live dynamic resize integrity.';Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";exit 0
