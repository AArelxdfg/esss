[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$HumanInputFinalReport,
  [Parameter(Mandatory)][string]$HitTestReport,
  [Parameter(Mandatory)][string]$UiTreeStabilityReport,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON evidence: $p :: $($_.Exception.Message)"}}
function Require-Sha([string]$v,[string]$label){if($v -notmatch '^[a-f0-9]{64}$'){Fail "$label is not a lowercase SHA-256."}}
$final=Read-Json $HumanInputFinalReport
$hit=Read-Json $HitTestReport
$tree=Read-Json $UiTreeStabilityReport
if($final.product -ne 'LLera UIUX 10/10 Human-Input-Bound Final Gate' -or $final.verdict -ne 'PASS' -or [int]$final.score -ne 100){Fail 'Human-input-bound final proof is not strict 100/100 PASS.'}
if($hit.product -ne 'LLera UIUX10 Physical Hit-Test Audit' -or $hit.verdict -ne 'PASS' -or [int]$hit.score -ne 100){Fail 'Physical hit-test audit is not strict 100/100 PASS.'}
if(@($hit.failures).Count -ne 0 -or @($hit.warnings).Count -ne 0){Fail 'Physical hit-test evidence contains warnings/failures.'}
if([int]$hit.controlsTested -lt 5){Fail 'Physical hit-test covered too few interactive controls.'}
if($tree.product -ne 'LLera UIUX 10/10 UI Tree Stability Audit' -or $tree.verdict -ne 'PASS' -or [int]$tree.score -ne 100){Fail 'UI-tree stability audit is not strict 100/100 PASS.'}
if(@($tree.failures).Count -ne 0 -or @($tree.warnings).Count -ne 0){Fail 'UI-tree stability evidence contains warnings/failures.'}
Require-Sha ([string]$final.executableSha256) 'Final executable SHA-256'
Require-Sha ([string]$hit.process.exeSha256) 'Hit-test executable SHA-256'
Require-Sha ([string]$tree.process.sha256) 'UI-tree executable SHA-256'
if([string]$final.executableSha256 -ne [string]$hit.process.exeSha256 -or [string]$final.executableSha256 -ne [string]$tree.process.sha256){Fail 'Evidence was captured against different LLera binaries.'}
if($final.PSObject.Properties.Name -contains 'host'){if([string]$final.host -ne [string]$hit.host -or [string]$final.host -ne [string]$tree.computer){Fail 'Evidence was captured on different Windows hosts.'}}
$result=[ordered]@{
  schema=1;product='LLera UIUX 10/10 Physical-Interaction Final Gate';checkedAt=(Get-Date).ToUniversalTime().ToString('o')
  host=[string]$hit.host;executableSha256=[string]$final.executableSha256;score=100;verdict='PASS'
  humanInputFinalSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $HumanInputFinalReport).Hash.ToLowerInvariant()
  hitTestReportSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $HitTestReport).Hash.ToLowerInvariant()
  uiTreeStabilityReportSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $UiTreeStabilityReport).Hash.ToLowerInvariant()
  contract=@(
    'Prior human-input-bound proof is strict 100/100 PASS',
    'Every sampled visible interactive control center is physically unobstructed by another top-level window',
    'UI Automation FromPoint resolves each sampled center to the intended control or descendant',
    'Idle interactive UI Automation tree remains bounded and stable',
    'No unnamed focusable controls or duplicate AutomationId values are observed',
    'All evidence is bound to the same physical Windows host and exact LLera executable SHA-256'
  )
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-physical-interaction-final-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$result|ConvertTo-Json -Depth 8
exit 0
