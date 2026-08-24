[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$UnifiedSuiteReport,
    [Parameter(Mandatory)][string]$EvidenceLedger,
    [string]$ExpectedVersion = '5.3.5',
    [int]$MinSoakMinutes = 120,
    [int]$MinHealthCycles = 50,
    [int]$MinRuntimeRecoveries = 10,
    [int]$MinMissionRestartRecoveries = 5
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m; exit 2 }
function Read-Json([string]$p) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail "Missing evidence file: $p" }
    try { return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json }
    catch { Fail "Invalid JSON evidence: $p :: $($_.Exception.Message)" }
}

$suite = Read-Json $UnifiedSuiteReport
$ledger = Read-Json $EvidenceLedger

if ($suite.product -ne 'LLera Windows-Grade Unified Evidence Suite') { Fail 'Unexpected unified suite product marker.' }
if ($suite.baseline -notmatch [regex]::Escape($ExpectedVersion)) { Fail "Suite baseline does not match expected version $ExpectedVersion." }
if ($suite.verdict -ne 'PASS') { Fail "Unified Windows-grade suite verdict is $($suite.verdict), not PASS." }
if ($suite.policy.stableManifestModified -ne $false) { Fail 'Evidence says stable manifest was modified.' }
if ($suite.policy.runtimeSourceClaimedModified -ne $false) { Fail 'Evidence contains an unverified runtime-source modification claim.' }

# Evidence ledger must itself describe an intact chain. Accept either explicit verdict or zero integrity failures.
if ($ledger.PSObject.Properties.Name -contains 'verdict') {
    if ($ledger.verdict -ne 'PASS') { Fail "Evidence chain verdict is $($ledger.verdict)." }
}
if ($ledger.PSObject.Properties.Name -contains 'integrityFailures') {
    if ([int]$ledger.integrityFailures -ne 0) { Fail "Evidence ledger has $($ledger.integrityFailures) integrity failure(s)." }
}

# Promotion-only evidence is deliberately stricter than the ordinary suite. These fields are expected
# from the physical Windows soak collector; absence is a failure rather than an implicit pass.
$physical = $suite.physicalWindows
if ($null -eq $physical) { Fail 'Missing physicalWindows evidence. Promotion cannot be inferred from static/cross-build checks.' }
if ($physical.executed -ne $true) { Fail 'physicalWindows.executed is not true.' }
if ([int]$physical.soakMinutes -lt $MinSoakMinutes) { Fail "Soak duration below ${MinSoakMinutes}m." }
if ([int]$physical.healthCyclesPassed -lt $MinHealthCycles) { Fail "Runtime health cycles below $MinHealthCycles." }
if ([int]$physical.runtimeRecoveriesPassed -lt $MinRuntimeRecoveries) { Fail "Runtime recovery count below $MinRuntimeRecoveries." }
if ([int]$physical.missionRestartRecoveriesPassed -lt $MinMissionRestartRecoveries) { Fail "Mission restart recovery count below $MinMissionRestartRecoveries." }
if ($physical.uiMatrixPassed -ne $true) { Fail 'UI/DPI matrix is not PASS.' }
if ($physical.hostPressurePassed -ne $true) { Fail 'Host-pressure behavior is not PASS.' }
if ($physical.updateRollbackPassed -ne $true) { Fail 'Update/rollback lifecycle is not PASS.' }
if ($physical.uninstallReinstallPassed -ne $true) { Fail 'Uninstall/reinstall lifecycle is not PASS.' }
if ($physical.agentVerificationDebtPassed -ne $true) { Fail 'Agent verification-debt physical scenario is not PASS.' }
if ($physical.noUnboundedGrowth -ne $true) { Fail 'Soak did not prove bounded LLera process/RSS growth.' }

$result = [ordered]@{
    schema = 1
    product = 'LLera Release Promotion Gate'
    expectedVersion = $ExpectedVersion
    verdict = 'PASS'
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    suiteSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $UnifiedSuiteReport).Hash.ToLowerInvariant()
    ledgerSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $EvidenceLedger).Hash.ToLowerInvariant()
    thresholds = [ordered]@{
        soakMinutes = $MinSoakMinutes
        healthCycles = $MinHealthCycles
        runtimeRecoveries = $MinRuntimeRecoveries
        missionRestartRecoveries = $MinMissionRestartRecoveries
    }
}
$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir ("promotion-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "PASS: LLera release promotion evidence is complete."
Write-Host "Promotion evidence: $out"
Write-Host "SHA-256: $sha"
exit 0
