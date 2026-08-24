[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$AppPath,
    [string]$ExpectedInstallerSha256 = "1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e",
    [switch]$RunInstalledSelfTest,
    [switch]$ProbeRuntimeRecovery,
    [switch]$RunUiMatrix,
    [switch]$RunSourceRecovery,
    [string[]]$SourceSearchRoots
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$started = (Get-Date).ToUniversalTime()
$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Invoke-ChildScript {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Path,
        [string[]]$Arguments = @()
    )

    $stdout = Join-Path $outDir ("{0}-{1}-stdout.txt" -f $Name, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $stderr = Join-Path $outDir ("{0}-{1}-stderr.txt" -f $Name, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $Path + '"')) + $Arguments
    $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    [pscustomobject]@{
        name = $Name
        exitCode = $p.ExitCode
        passed = ($p.ExitCode -eq 0)
        stdout = $stdout
        stderr = $stderr
        command = "powershell.exe $($argList -join ' ')"
    }
}

$steps = [System.Collections.Generic.List[object]]::new()

$gateArgs = @()
if ($InstallerPath) { $gateArgs += @('-InstallerPath', ('"' + $InstallerPath + '"')) }
if ($AppPath) { $gateArgs += @('-AppPath', ('"' + $AppPath + '"')) }
$gateArgs += @('-ExpectedInstallerSha256', $ExpectedInstallerSha256)
if ($RunInstalledSelfTest) { $gateArgs += '-RunInstalledSelfTest' }
if ($ProbeRuntimeRecovery) { $gateArgs += '-ProbeRuntimeRecovery' }
$steps.Add((Invoke-ChildScript -Name 'windows-grade-gate' -Path (Join-Path $PSScriptRoot 'windows-grade-gate.ps1') -Arguments $gateArgs))

if ($RunUiMatrix) {
    $uiArgs = @()
    if ($AppPath) { $uiArgs += @('-AppPath', ('"' + $AppPath + '"')) }
    $steps.Add((Invoke-ChildScript -Name 'ui-windows-matrix' -Path (Join-Path $PSScriptRoot 'ui-windows-matrix.ps1') -Arguments $uiArgs))
}

if ($RunSourceRecovery) {
    $recoveryArgs = @()
    if ($SourceSearchRoots -and $SourceSearchRoots.Count -gt 0) {
        $escaped = $SourceSearchRoots | ForEach-Object { '"' + $_ + '"' }
        $recoveryArgs += @('-SearchRoots', ($escaped -join ','))
    }
    $steps.Add((Invoke-ChildScript -Name 'source-recovery' -Path (Join-Path $PSScriptRoot 'source-recovery-gate.ps1') -Arguments $recoveryArgs))
}

$required = @($steps | Where-Object { $_.name -eq 'windows-grade-gate' })
$failedRequired = @($required | Where-Object { -not $_.passed })
$optionalFailures = @($steps | Where-Object { $_.name -ne 'windows-grade-gate' -and -not $_.passed })

$report = [ordered]@{
    schema = 1
    product = 'LLera Windows-Grade Unified Evidence Suite'
    baseline = 'V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER'
    startedAt = $started.ToString('o')
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    verdict = if ($failedRequired.Count -eq 0) { 'PASS' } else { 'FAIL' }
    optionalAttention = $optionalFailures.Count
    steps = @($steps)
    policy = [ordered]@{
        stableManifestModified = $false
        runtimeSourceClaimedModified = $false
        physicalWindowsValidationClaimRequiresThisEvidence = $true
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath = Join-Path $outDir "unified-suite-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $jsonPath).Hash.ToLowerInvariant()
$hashPath = "$jsonPath.sha256"
"$hash  $(Split-Path -Leaf $jsonPath)" | Set-Content -LiteralPath $hashPath -Encoding ASCII

Write-Host "LLera Windows-grade suite verdict: $($report.verdict)"
Write-Host "Evidence: $jsonPath"
Write-Host "Evidence SHA-256: $hash"
if ($optionalFailures.Count -gt 0) {
    Write-Warning "$($optionalFailures.Count) optional/recovery evidence step(s) require attention."
}

if ($failedRequired.Count -gt 0) { exit 2 }
exit 0
