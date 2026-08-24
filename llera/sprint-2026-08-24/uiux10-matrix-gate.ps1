[CmdletBinding()]
param(
    [Parameter(Mandatory)][string[]]$Reports,
    [Parameter(Mandatory)][string[]]$VisualReports,
    [Parameter(Mandatory)][string]$InteractionReport,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing report: $p"};try{Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}

$required=@('1366x768@125','1920x1080@150','2560x1440@200')
$seen=@{};$physicalByCase=@{};$evidence=@()
foreach($path in $Reports){
    $r=Read-Json $path
    if($r.product -ne 'LLera UIUX 10/10 Physical Audit'){Fail "Unexpected product marker in $path"}
    if($r.candidate -ne $ExpectedCandidate){Fail "Candidate mismatch in $path: $($r.candidate)"}
    if($required -notcontains [string]$r.matrixCase){Fail "Unexpected matrix case: $($r.matrixCase)"}
    if($seen.ContainsKey([string]$r.matrixCase)){Fail "Duplicate matrix case: $($r.matrixCase)"}
    $seen[[string]$r.matrixCase]=$true;$physicalByCase[[string]$r.matrixCase]=@{path=$path;report=$r}
    if($r.verdict -ne 'PASS' -or [int]$r.score -ne 100){Fail "UI/UX is not 10/10 for $($r.matrixCase): score=$($r.score) verdict=$($r.verdict)"}
    if([int]$r.passCount -ne [int]$r.totalChecks){Fail "Not all checks passed for $($r.matrixCase)."}
    if(-not $r.screenshot.sha256 -or ([string]$r.screenshot.sha256).Length -ne 64){Fail "Missing screenshot SHA-256 for $($r.matrixCase)."}
}
foreach($case in $required){if(-not $seen.ContainsKey($case)){Fail "Missing required matrix case: $case"}}

$visualSeen=@{}
foreach($path in $VisualReports){
    $v=Read-Json $path
    if($v.product -ne 'LLera UIUX 10/10 Visual Integrity Audit'){Fail "Unexpected visual report marker in $path"}
    if($v.candidate -ne $ExpectedCandidate){Fail "Visual candidate mismatch in $path: $($v.candidate)"}
    $case=[string]$v.matrixCase
    if($required -notcontains $case){Fail "Unexpected visual matrix case: $case"}
    if($visualSeen.ContainsKey($case)){Fail "Duplicate visual matrix case: $case"}
    $visualSeen[$case]=$true
    if($v.verdict -ne 'PASS' -or [int]$v.score -ne 100 -or [int]$v.passCount -ne [int]$v.totalChecks){Fail "Visual integrity is not 100/100 for $case"}
    $physical=$physicalByCase[$case]
    $physicalSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $physical.path).Hash.ToLowerInvariant()
    if([string]$v.physicalAuditSha256 -ne $physicalSha){Fail "Visual report is not bound to supplied physical audit for $case"}
    if([string]$v.screenshot.sha256 -ne [string]$physical.report.screenshot.sha256){Fail "Visual/physical screenshot hash mismatch for $case"}
    if([double]$v.metrics.opaqueRatio -lt 0.99){Fail "Screenshot opacity evidence below threshold for $case"}
    if([int]$v.metrics.sampledUniqueColors -lt [int]$v.thresholds.minSampledUniqueColors){Fail "Screenshot color diversity below threshold for $case"}
    if([double]$v.metrics.luminanceStdDev -lt [double]$v.thresholds.minLuminanceStdDev){Fail "Screenshot luminance variation below threshold for $case"}
    if([double]$v.metrics.edgeRatio -lt [double]$v.thresholds.minEdgeRatio){Fail "Screenshot edge/detail evidence below threshold for $case"}
    $evidence += [pscustomobject]@{matrixCase=$case;score=100;reportSha256=$physicalSha;visualReportSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant();screenshotSha256=[string]$v.screenshot.sha256;capturedAt=$physical.report.capturedAt;computer=$physical.report.host.computer;visualMetrics=$v.metrics}
}
foreach($case in $required){if(-not $visualSeen.ContainsKey($case)){Fail "Missing visual-integrity report for required matrix case: $case"}}

$computers=@($evidence|ForEach-Object{$_.computer}|Select-Object -Unique)
if($computers.Count-ne 1){Fail "Physical matrix must come from one Windows host; hosts=$($computers -join ', ')"}
$screenshotHashes=@($evidence|ForEach-Object{$_.screenshotSha256}|Select-Object -Unique)
if($screenshotHashes.Count-ne 3){Fail 'Each matrix case must have a distinct real screenshot hash.'}

$interaction=Read-Json $InteractionReport
if($interaction.product -ne 'LLera UIUX 10/10 Interaction Audit'){Fail 'Unexpected interaction audit product marker.'}
if($interaction.candidate -ne $ExpectedCandidate){Fail "Interaction candidate mismatch: $($interaction.candidate)"}
if($interaction.verdict -ne 'PASS' -or [int]$interaction.score -ne 100){Fail "Keyboard/command-palette interaction is not 100/100: score=$($interaction.score) verdict=$($interaction.verdict)"}
if([int]$interaction.passCount -ne [int]$interaction.totalChecks){Fail 'Interaction audit contains a non-PASS check.'}
if([string]$interaction.computer -ne [string]$computers[0]){Fail 'Interaction audit must run on the same physical Windows host as the viewport matrix.'}
$interactionSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $InteractionReport).Hash.ToLowerInvariant()

$result=[ordered]@{
 schema=3
 product='LLera UIUX 10/10 Matrix Gate'
 candidate=$ExpectedCandidate
 verdict='PASS'
 score=100
 checkedAt=(Get-Date).ToUniversalTime().ToString('o')
 computer=[string]$computers[0]
 policy=@{
   requiredMatrix=$required
   requiredPerCaseScore=100
   requiredVisualIntegrityScore=100
   requiredInteractionScore=100
   allowWarnings=$false
   requireScreenshotEvidence=$true
   requireDistinctScreenshotHashes=$true
   requireVisualIntegrityProof=$true
   requireAllChecksPass=$true
   requireKeyboardInteractionProof=$true
   requireSinglePhysicalWindowsHost=$true
 }
 evidence=$evidence
 interaction=@{score=100;reportSha256=$interactionSha;capturedAt=$interaction.capturedAt;computer=$interaction.computer}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-matrix-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: UI/UX = 100/100 across viewport, visual-integrity, accessibility and interaction gates.'
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
