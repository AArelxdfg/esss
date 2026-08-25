[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$FinalProofReport,
  [Parameter(Mandatory)][string]$AccessibilitySemanticsReport,
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){ Write-Error $m; exit 2 }
function Read-Json([string]$p){ if(-not(Test-Path -LiteralPath $p -PathType Leaf)){ Fail "Missing evidence: $p" }; try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p :: $($_.Exception.Message)"} }
function Sha([string]$p){ (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }

$f=Read-Json $FinalProofReport
$a=Read-Json $AccessibilitySemanticsReport
if($f.product-ne'LLera UIUX 10/10 Final Proof Gate' -or $f.candidate-ne$ExpectedCandidate -or $f.verdict-ne'PASS' -or [int]$f.score-ne100){ Fail 'Base final proof is not strict 100/100.' }
if($a.product-ne'LLera UIUX 10/10 Accessibility Semantics Audit' -or $a.verdict-ne'PASS' -or [int]$a.score-ne100){ Fail 'Accessibility semantics evidence is not strict 100/100.' }
if(@($a.failures).Count-ne0 -or @($a.warnings).Count-ne0){ Fail 'Accessibility semantics evidence contains warnings or failures.' }
if([string]$a.computer-ne[string]$f.computer){ Fail 'Accessibility semantics and final proof must come from the same physical Windows host.' }
$finalSha=([string]$f.executableSha256).ToLowerInvariant(); $accessSha=([string]$a.process.sha256).ToLowerInvariant()
if($finalSha-notmatch'^[0-9a-f]{64}$' -or $accessSha-notmatch'^[0-9a-f]{64}$' -or $finalSha-ne$accessSha){ Fail 'Accessibility audit used a different or malformed LLera executable identity.' }
if([int]$a.metrics.interactiveVisible-lt3){ Fail 'Accessibility audit discovered too few visible interactive controls.' }
if([int]$a.metrics.accessibleNamedVisible-ne[int]$a.metrics.interactiveVisible){ Fail 'Not all visible interactive controls are accessible-name complete.' }
if([int]$a.metrics.keyboardFocusableVisible-lt2){ Fail 'Keyboard-focusable UI surface is insufficient.' }

$result=[ordered]@{
 schema=1;product='LLera UIUX 10/10 Accessibility-Bound Final Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=[string]$f.computer;score=100;verdict='PASS';executableSha256=$finalSha
 policy=@{requireFinalProof100=$true;requireAccessibilitySemantics100=$true;requireAllVisibleInteractiveNamed=$true;requireKeyboardFocusableSurface=$true;requireSamePhysicalWindowsHost=$true;requireSameExecutableSha256=$true;allowWarnings=$false}
 evidence=@{finalProofReportSha256=Sha $FinalProofReport;accessibilitySemanticsReportSha256=Sha $AccessibilitySemanticsReport;interactiveVisible=[int]$a.metrics.interactiveVisible;accessibleNamedVisible=[int]$a.metrics.accessibleNamedVisible;keyboardFocusableVisible=[int]$a.metrics.keyboardFocusableVisible;duplicateLabelGroups=[int]$a.metrics.duplicateLabelGroups}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-accessibility-bound-final-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=Sha $out
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX final proof is accessibility-bound at 100/100.'
Write-Host "Executable SHA-256: $finalSha"
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
