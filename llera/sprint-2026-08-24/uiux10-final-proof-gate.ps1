[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleaseGradeReport,
    [Parameter(Mandatory)][string]$RuntimeContinuityReport,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Fail([string]$m){ Write-Error $m; exit 2 }
function Read-Json([string]$p){
    if(-not(Test-Path -LiteralPath $p -PathType Leaf)){ Fail "Missing evidence: $p" }
    try { return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json }
    catch { Fail "Invalid JSON: $p :: $($_.Exception.Message)" }
}
function Sha([string]$p){ return (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }

$r = Read-Json $ReleaseGradeReport
$c = Read-Json $RuntimeContinuityReport
if($r.product -ne 'LLera UIUX 10/10 Release-Grade Gate'){ Fail 'Unexpected release-grade product marker.' }
if($r.candidate -ne $ExpectedCandidate -or $r.verdict -ne 'PASS' -or [int]$r.score -ne 100){ Fail 'Release-grade UIUX evidence is not strict 100/100.' }
if($c.product -ne 'LLera UIUX 10/10 Matrix Runtime Continuity Gate'){ Fail 'Unexpected runtime-continuity product marker.' }
if($c.candidate -ne $ExpectedCandidate -or $c.verdict -ne 'PASS' -or [int]$c.score -ne 100){ Fail 'Matrix runtime continuity evidence is not strict 100/100.' }
if([string]$r.computer -ne [string]$c.computer){ Fail 'Release-grade and continuity evidence must come from the same physical Windows host.' }
$releaseSha = [string]$r.evidence.testedExecutableSha256
$continuitySha = [string]$c.executable.sha256
if($releaseSha -notmatch '^[0-9a-f]{64}$' -or $continuitySha -notmatch '^[0-9a-f]{64}$'){ Fail 'Executable SHA-256 evidence is malformed.' }
if($releaseSha -ne $continuitySha){ Fail 'Release-grade and physical matrix evidence do not identify the same LLera executable.' }
if(@($c.bindings).Count -ne 3){ Fail 'Runtime continuity evidence does not contain exactly three physical matrix bindings.' }
foreach($case in @('1366x768@125','1920x1080@150','2560x1440@200')){
    $m=@($c.bindings | Where-Object {$_.matrixCase -eq $case})
    if($m.Count -ne 1){ Fail "Missing exact runtime-bound matrix evidence for $case." }
    if([string]$m[0].executableSha256 -ne $releaseSha){ Fail "Executable identity mismatch inside matrix binding $case." }
    if([string]$m[0].screenshotSha256 -notmatch '^[0-9a-f]{64}$'){ Fail "Screenshot identity malformed for $case." }
}

$result = [ordered]@{
    schema = 1
    product = 'LLera UIUX 10/10 Final Proof Gate'
    candidate = $ExpectedCandidate
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    computer = [string]$r.computer
    score = 100
    verdict = 'PASS'
    executableSha256 = $releaseSha
    policy = @{
        requireReleaseGrade100 = $true
        requireRuntimeContinuity100 = $true
        requireSamePhysicalWindowsHost = $true
        requireSameExecutableAcrossAllPhysicalProof = $true
        requireThreeRuntimeBoundViewportCaptures = $true
        allowWarnings = $false
    }
    evidence = @{
        releaseGradeReportSha256 = Sha $ReleaseGradeReport
        runtimeContinuityReportSha256 = Sha $RuntimeContinuityReport
        matrixBindings = @($c.bindings | ForEach-Object { @{matrixCase=$_.matrixCase;screenshotSha256=$_.screenshotSha256;physicalReportSha256=$_.physicalReportSha256;identityReportSha256=$_.identityReportSha256} })
    }
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = Join-Path $OutputDirectory ("uiux10-final-proof-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = Sha $out
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict physical proof = 100/100 with one immutable runtime binary across the full Windows evidence chain.'
Write-Host "Executable SHA-256: $releaseSha"
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
