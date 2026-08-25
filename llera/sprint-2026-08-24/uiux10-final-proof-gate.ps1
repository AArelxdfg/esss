[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseGradeReport,
    [Parameter(Mandatory)][string]$RuntimeContinuityReport,
    [Parameter(Mandatory)][string]$TextScale100Report,
    [Parameter(Mandatory)][string]$TextScale150Report,
    [Parameter(Mandatory)][string]$TextScale200Report,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$m){ Write-Error $m; exit 2 }
function Read-Json([string]$p){ if(-not(Test-Path -LiteralPath $p -PathType Leaf)){ Fail "Missing evidence: $p" }; try { return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json } catch { Fail "Invalid JSON: $p :: $($_.Exception.Message)" } }
function Sha([string]$p){ (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }
$r=Read-Json $ReleaseGradeReport; $c=Read-Json $RuntimeContinuityReport
if($r.product -ne 'LLera UIUX 10/10 Release-Grade Gate' -or $r.candidate -ne $ExpectedCandidate -or $r.verdict -ne 'PASS' -or [int]$r.score -ne 100){ Fail 'Release-grade UIUX evidence is not strict 100/100.' }
if($c.product -ne 'LLera UIUX 10/10 Matrix Runtime Continuity Gate' -or $c.candidate -ne $ExpectedCandidate -or $c.verdict -ne 'PASS' -or [int]$c.score -ne 100){ Fail 'Runtime-continuity evidence is not strict 100/100.' }
if([string]$r.computer -ne [string]$c.computer){ Fail 'Release-grade and continuity evidence must come from the same physical Windows host.' }
$releaseSha=[string]$r.evidence.testedExecutableSha256; $continuitySha=[string]$c.executable.sha256
if($releaseSha -notmatch '^[0-9a-f]{64}$' -or $continuitySha -notmatch '^[0-9a-f]{64}$' -or $releaseSha -ne $continuitySha){ Fail 'Executable identity is malformed or inconsistent.' }
if(@($c.bindings).Count -ne 3){ Fail 'Runtime continuity evidence does not contain exactly three physical matrix bindings.' }
foreach($case in @('1366x768@125','1920x1080@150','2560x1440@200')){ $m=@($c.bindings|Where-Object{$_.matrixCase -eq $case}); if($m.Count-ne 1 -or [string]$m[0].executableSha256-ne $releaseSha -or [string]$m[0].screenshotSha256 -notmatch '^[0-9a-f]{64}$'){ Fail "Invalid runtime-bound matrix evidence for $case." } }
$textReports=@(@{expected=100;path=$TextScale100Report},@{expected=150;path=$TextScale150Report},@{expected=200;path=$TextScale200Report})
$textEvidence=@(); $screens=New-Object System.Collections.Generic.HashSet[string]
foreach($t in $textReports){
    $j=Read-Json $t.path
    if($j.product-ne'LLera UIUX 10/10 Text Scale Audit' -or [int]$j.windowsTextScalePercent-ne[int]$t.expected -or $j.verdict-ne'PASS' -or [int]$j.score-ne100){ Fail "Text-scale $($t.expected)% evidence is not strict 100/100." }
    if(@($j.failures).Count-ne0 -or @($j.warnings).Count-ne0 -or [string]$j.computer-ne[string]$r.computer){ Fail "Text-scale $($t.expected)% evidence has warnings/failures or a host mismatch." }
    $shot=[string]$j.screenshot.sha256; if($shot -notmatch '^[0-9a-f]{64}$'){ Fail "Text-scale $($t.expected)% screenshot hash is malformed." }; [void]$screens.Add($shot)
    $textEvidence+=@{percent=[int]$t.expected;reportSha256=Sha $t.path;screenshotSha256=$shot}
}
if($screens.Count-ne3){ Fail '100/150/200% text-scale proof must contain three distinct physical screenshots.' }
$result=[ordered]@{schema=2;product='LLera UIUX 10/10 Final Proof Gate';candidate=$ExpectedCandidate;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=[string]$r.computer;score=100;verdict='PASS';executableSha256=$releaseSha;policy=@{requireReleaseGrade100=$true;requireRuntimeContinuity100=$true;requireSamePhysicalWindowsHost=$true;requireSameExecutableAcrossAllPhysicalProof=$true;requireThreeRuntimeBoundViewportCaptures=$true;requireWindowsTextScale100_150_200=$true;requireDistinctTextScaleScreenshots=$true;allowWarnings=$false};evidence=@{releaseGradeReportSha256=Sha $ReleaseGradeReport;runtimeContinuityReportSha256=Sha $RuntimeContinuityReport;matrixBindings=@($c.bindings|ForEach-Object{@{matrixCase=$_.matrixCase;screenshotSha256=$_.screenshotSha256;physicalReportSha256=$_.physicalReportSha256;identityReportSha256=$_.identityReportSha256}});textScale=$textEvidence}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-final-proof-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss')); $result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8; $sha=Sha $out; "$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict physical proof = 100/100 with viewport, immutable runtime, and Windows text-scale evidence.'; Write-Host "Executable SHA-256: $releaseSha"; Write-Host "Evidence: $out"; Write-Host "SHA-256: $sha"; exit 0
