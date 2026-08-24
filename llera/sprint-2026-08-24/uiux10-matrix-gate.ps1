[CmdletBinding()]
param(
    [Parameter(Mandatory)][string[]]$Reports,
    [Parameter(Mandatory)][string]$InteractionReport,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing report: $p"};try{Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}

$required=@('1366x768@125','1920x1080@150','2560x1440@200')
$seen=@{}
$evidence=@()
foreach($path in $Reports){
    $r=Read-Json $path
    if($r.product -ne 'LLera UIUX 10/10 Physical Audit'){Fail "Unexpected product marker in $path"}
    if($r.candidate -ne $ExpectedCandidate){Fail "Candidate mismatch in $path: $($r.candidate)"}
    if($required -notcontains [string]$r.matrixCase){Fail "Unexpected matrix case: $($r.matrixCase)"}
    if($seen.ContainsKey([string]$r.matrixCase)){Fail "Duplicate matrix case: $($r.matrixCase)"}
    $seen[[string]$r.matrixCase]=$true
    if($r.verdict -ne 'PASS' -or [int]$r.score -ne 100){Fail "UI/UX is not 10/10 for $($r.matrixCase): score=$($r.score) verdict=$($r.verdict)"}
    if([int]$r.passCount -ne [int]$r.totalChecks){Fail "Not all checks passed for $($r.matrixCase)."}
    if(-not $r.screenshot.sha256 -or ([string]$r.screenshot.sha256).Length -ne 64){Fail "Missing screenshot SHA-256 for $($r.matrixCase)."}
    $evidence += [pscustomobject]@{matrixCase=$r.matrixCase;score=[int]$r.score;reportSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant();screenshotSha256=[string]$r.screenshot.sha256;capturedAt=$r.capturedAt;computer=$r.host.computer}
}
foreach($case in $required){if(-not $seen.ContainsKey($case)){Fail "Missing required matrix case: $case"}}

$interaction=Read-Json $InteractionReport
if($interaction.product -ne 'LLera UIUX 10/10 Interaction Audit'){Fail 'Unexpected interaction audit product marker.'}
if($interaction.candidate -ne $ExpectedCandidate){Fail "Interaction candidate mismatch: $($interaction.candidate)"}
if($interaction.verdict -ne 'PASS' -or [int]$interaction.score -ne 100){Fail "Keyboard/command-palette interaction is not 100/100: score=$($interaction.score) verdict=$($interaction.verdict)"}
if([int]$interaction.passCount -ne [int]$interaction.totalChecks){Fail 'Interaction audit contains a non-PASS check.'}
$interactionSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $InteractionReport).Hash.ToLowerInvariant()

$result=[ordered]@{
 schema=2
 product='LLera UIUX 10/10 Matrix Gate'
 candidate=$ExpectedCandidate
 verdict='PASS'
 score=100
 checkedAt=(Get-Date).ToUniversalTime().ToString('o')
 policy=@{
   requiredMatrix=$required
   requiredPerCaseScore=100
   requiredInteractionScore=100
   allowWarnings=$false
   requireScreenshotEvidence=$true
   requireAllChecksPass=$true
   requireKeyboardInteractionProof=$true
 }
 evidence=$evidence
 interaction=@{score=100;reportSha256=$interactionSha;capturedAt=$interaction.capturedAt;computer=$interaction.computer}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-matrix-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: UI/UX = 100/100 across viewport, accessibility and interaction gates.'
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
