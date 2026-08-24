[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Physical1366,
    [Parameter(Mandatory)][string]$Identity1366,
    [Parameter(Mandatory)][string]$Physical1920,
    [Parameter(Mandatory)][string]$Identity1920,
    [Parameter(Mandatory)][string]$Physical2560,
    [Parameter(Mandatory)][string]$Identity2560,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [int]$MaxCaptureDeltaSeconds = 120,
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

$pairs = @(
    @{ case='1366x768@125'; physical=$Physical1366; identity=$Identity1366 },
    @{ case='1920x1080@150'; physical=$Physical1920; identity=$Identity1920 },
    @{ case='2560x1440@200'; physical=$Physical2560; identity=$Identity2560 }
)
$bindings = @()
foreach($pair in $pairs){
    $p = Read-Json $pair.physical
    $i = Read-Json $pair.identity
    if($p.product -ne 'LLera UIUX 10/10 Physical Audit'){ Fail "Unexpected physical product marker for $($pair.case)." }
    if([int]$p.schema -lt 2){ Fail "Physical audit schema too old for $($pair.case)." }
    if($p.candidate -ne $ExpectedCandidate -or [string]$p.matrixCase -ne [string]$pair.case){ Fail "Physical candidate/matrix mismatch for $($pair.case)." }
    if($p.verdict -ne 'PASS' -or [int]$p.score -ne 100 -or [int]$p.passCount -ne [int]$p.totalChecks){ Fail "Physical audit is not strict 100/100 for $($pair.case)." }
    if([int]$p.warningCount -ne 0 -or @($p.warnings).Count -ne 0){ Fail "Warnings are forbidden in $($pair.case)." }
    if([string]$p.screenshot.sha256 -notmatch '^[0-9a-f]{64}$'){ Fail "Physical screenshot hash missing for $($pair.case)." }

    if($i.product -ne 'LLera UIUX 10/10 Runtime Identity Audit'){ Fail "Unexpected runtime identity marker for $($pair.case)." }
    if($i.candidate -ne $ExpectedCandidate){ Fail "Runtime candidate mismatch for $($pair.case)." }
    if($i.verdict -ne 'PASS' -or [int]$i.score -ne 100 -or [int]$i.passCount -ne [int]$i.totalChecks){ Fail "Runtime identity is not strict 100/100 for $($pair.case)." }
    if([string]$i.process.sha256 -notmatch '^[0-9a-f]{64}$' -or [int64]$i.process.bytes -le 0){ Fail "Runtime binary identity malformed for $($pair.case)." }

    if([string]$p.host.computer -ne [string]$i.computer){ Fail "Physical/runtime host mismatch for $($pair.case)." }
    if([int]$p.window.pid -ne [int]$i.process.pid){ Fail "Physical/runtime PID mismatch for $($pair.case)." }
    $pt = [DateTimeOffset]::Parse([string]$p.capturedAt)
    $it = [DateTimeOffset]::Parse([string]$i.capturedAt)
    $delta = [Math]::Abs(($pt - $it).TotalSeconds)
    if($delta -gt $MaxCaptureDeltaSeconds){ Fail "Runtime identity capture is ${delta}s away from physical capture for $($pair.case); max=${MaxCaptureDeltaSeconds}s." }

    $bindings += [pscustomobject]@{
        matrixCase = [string]$pair.case
        computer = [string]$p.host.computer
        pid = [int]$p.window.pid
        executablePath = [string]$i.process.path
        executableSha256 = [string]$i.process.sha256
        executableBytes = [int64]$i.process.bytes
        screenshotSha256 = [string]$p.screenshot.sha256
        physicalCapturedAt = [string]$p.capturedAt
        identityCapturedAt = [string]$i.capturedAt
        captureDeltaSeconds = [Math]::Round($delta,3)
        physicalReportSha256 = Sha $pair.physical
        identityReportSha256 = Sha $pair.identity
    }
}

$hosts = @($bindings | ForEach-Object {$_.computer} | Select-Object -Unique)
if($hosts.Count -ne 1){ Fail "Matrix evidence spans multiple Windows hosts: $($hosts -join ', ')." }
$binaryHashes = @($bindings | ForEach-Object {$_.executableSha256} | Select-Object -Unique)
if($binaryHashes.Count -ne 1){ Fail 'Physical matrix cases were not captured against one immutable LLera executable SHA-256.' }
$binaryLengths = @($bindings | ForEach-Object {$_.executableBytes} | Select-Object -Unique)
if($binaryLengths.Count -ne 1){ Fail 'Runtime executable byte length changed across matrix cases.' }
$binaryPaths = @($bindings | ForEach-Object {$_.executablePath} | Select-Object -Unique)
if($binaryPaths.Count -ne 1){ Fail 'Runtime executable path changed across matrix cases.' }
$shotHashes = @($bindings | ForEach-Object {$_.screenshotSha256} | Select-Object -Unique)
if($shotHashes.Count -ne 3){ Fail 'Each physical matrix case must retain a distinct screenshot SHA-256.' }

$result = [ordered]@{
    schema = 1
    product = 'LLera UIUX 10/10 Matrix Runtime Continuity Gate'
    candidate = $ExpectedCandidate
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    computer = [string]$hosts[0]
    score = 100
    verdict = 'PASS'
    policy = @{
        requireThreePhysicalMatrixCases = $true
        requirePerCaseRuntimeIdentity = $true
        requireSamePidAtCapture = $true
        requireSamePhysicalWindowsHost = $true
        requireSameExecutableSha256AcrossMatrix = $true
        requireSameExecutableBytesAcrossMatrix = $true
        requireSameExecutablePathAcrossMatrix = $true
        requireDistinctScreenshotHashes = $true
        maxCaptureDeltaSeconds = $MaxCaptureDeltaSeconds
        allowWarnings = $false
    }
    executable = @{
        path = [string]$binaryPaths[0]
        sha256 = [string]$binaryHashes[0]
        bytes = [int64]$binaryLengths[0]
    }
    bindings = $bindings
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$out = Join-Path $OutputDirectory ("uiux10-matrix-runtime-continuity-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = Sha $out
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: all three physical UI matrix captures are bound to one immutable LLera runtime binary.'
Write-Host "Executable SHA-256: $($binaryHashes[0])"
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
