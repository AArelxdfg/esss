[CmdletBinding()]
param(
    [string[]]$SearchRoots = @(
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Documents"
    ),
    [string]$ExpectedSha256 = "06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097",
    [string]$ExpectedNamePattern = "LLera*5*3*5*.zip",
    [string]$Destination = "$PSScriptRoot\recovered-source",
    [switch]$Extract
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SafeZipInventory {
    param([Parameter(Mandatory)][string]$ZipPath)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $records = foreach ($entry in $zip.Entries) {
            $name = $entry.FullName -replace '\\','/'
            $danger = $false
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            if ($name.StartsWith('/') -or $name.StartsWith('\\')) { $danger = $true }
            if ($name -match '^[A-Za-z]:') { $danger = $true }
            $parts = $name.Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
            if ($parts -contains '..') { $danger = $true }
            [pscustomobject]@{
                path = $name
                compressedBytes = [int64]$entry.CompressedLength
                uncompressedBytes = [int64]$entry.Length
                unsafePath = $danger
            }
        }
        return @($records)
    }
    finally {
        $zip.Dispose()
    }
}

function Get-CandidateFiles {
    param([string[]]$Roots)
    $items = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    foreach ($root in $Roots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -File -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like $ExpectedNamePattern -or $_.Name -match 'LLera' } |
            ForEach-Object { $items.Add($_) }
    }
    return @($items | Sort-Object FullName -Unique)
}

$expected = $ExpectedSha256.ToLowerInvariant()
$candidates = Get-CandidateFiles -Roots $SearchRoots
$matches = [System.Collections.Generic.List[object]]::new()

foreach ($file in $candidates) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    $matches.Add([pscustomobject]@{
        path = $file.FullName
        bytes = [int64]$file.Length
        sha256 = $hash
        exact = ($hash -eq $expected)
    })
}

$exact = @($matches | Where-Object exact)
$result = [ordered]@{
    schema = 1
    baseline = 'LLera V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER'
    expectedSha256 = $expected
    searchedRoots = @($SearchRoots)
    candidates = @($matches)
    exactMatches = $exact.Count
    extracted = $false
    extractionPath = $null
    zipEntries = 0
    unsafeEntries = 0
    verdict = if ($exact.Count -eq 1) { 'FOUND' } elseif ($exact.Count -gt 1) { 'AMBIGUOUS_IDENTICAL' } else { 'NOT_FOUND' }
}

if ($exact.Count -gt 0) {
    $sourceZip = $exact[0].path
    $inventory = Get-SafeZipInventory -ZipPath $sourceZip
    $unsafe = @($inventory | Where-Object unsafePath)
    $result.zipEntries = $inventory.Count
    $result.unsafeEntries = $unsafe.Count

    if ($unsafe.Count -gt 0) {
        $result.verdict = 'REJECT_UNSAFE_ARCHIVE_PATHS'
    }
    elseif ($Extract) {
        if (Test-Path -LiteralPath $Destination) {
            Remove-Item -LiteralPath $Destination -Recurse -Force
        }
        New-Item -ItemType Directory -Force -Path $Destination | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $Destination)
        $result.extracted = $true
        $result.extractionPath = (Resolve-Path -LiteralPath $Destination).Path

        $inventoryOut = Join-Path $Destination '.llera-source-inventory.json'
        [ordered]@{
            schema = 1
            sourceArchive = $sourceZip
            sourceSha256 = $expected
            recoveredAt = (Get-Date).ToUniversalTime().ToString('o')
            entries = $inventory
        } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $inventoryOut -Encoding UTF8
    }
}

$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir ("source-recovery-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outPath -Encoding UTF8

Write-Host "LLera source recovery verdict: $($result.verdict)"
Write-Host "Expected SHA-256: $expected"
Write-Host "Candidates scanned: $($matches.Count)"
Write-Host "Exact matches: $($exact.Count)"
Write-Host "Evidence: $outPath"

switch ($result.verdict) {
    'FOUND' { exit 0 }
    'AMBIGUOUS_IDENTICAL' { exit 0 }
    default { exit 3 }
}
