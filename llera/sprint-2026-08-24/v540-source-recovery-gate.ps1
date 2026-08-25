[CmdletBinding()]
param(
    [string[]]$SearchRoots = @(
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Documents"
    ),
    [string]$ExpectedSha256 = 'b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471',
    [string]$ExpectedNamePattern = 'LLera*V5*4*AURORA*.zip',
    [string]$Destination = "$PSScriptRoot\recovered-v540-source",
    [switch]$Extract
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-SafeZipInventory {
    param([Parameter(Mandatory)][string]$ZipPath)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $records = foreach ($entry in $zip.Entries) {
            $name = $entry.FullName -replace '\\','/'
            if ([string]::IsNullOrWhiteSpace($name)) { continue }

            $unsafe = $false
            if ($name.StartsWith('/') -or $name.StartsWith('\\')) { $unsafe = $true }
            if ($name -match '^[A-Za-z]:') { $unsafe = $true }
            $parts = $name.Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
            if ($parts -contains '..') { $unsafe = $true }

            [pscustomobject]@{
                path = $name
                compressedBytes = [int64]$entry.CompressedLength
                uncompressedBytes = [int64]$entry.Length
                unsafePath = $unsafe
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
            Where-Object {
                $_.Name -like $ExpectedNamePattern -or
                ($_.Name -match '(?i)LLera' -and $_.Name -match '(?i)(5[._ -]?4|AURORA)')
            } |
            ForEach-Object { $items.Add($_) }
    }
    return @($items | Sort-Object FullName -Unique)
}

function Test-RequiredSourceShape {
    param([Parameter(Mandatory)][object[]]$Inventory)

    $paths = @($Inventory | ForEach-Object { ([string]$_.path).ToLowerInvariant() })
    $requirements = @(
        @{ id='main'; pattern='(^|/)main\.js$' },
        @{ id='agent'; pattern='(^|/)agent\.js$' },
        @{ id='preload'; pattern='(^|/)preload\.js$' },
        @{ id='renderer'; pattern='(^|/)renderer\.js$' },
        @{ id='aurora-regression'; pattern='(^|/)test_v540_aurora_ux\.js$' }
    )

    $checks = foreach ($req in $requirements) {
        $matches = @($paths | Where-Object { $_ -match $req.pattern })
        [pscustomobject]@{
            id = $req.id
            found = ($matches.Count -gt 0)
            matches = $matches
        }
    }

    return [pscustomobject]@{
        checks = @($checks)
        allRequiredPresent = (@($checks | Where-Object { -not $_.found }).Count -eq 0)
    }
}

$expected = $ExpectedSha256.ToLowerInvariant()
if ($expected -notmatch '^[0-9a-f]{64}$') { throw 'ExpectedSha256 must be a 64-character SHA-256 value.' }

$candidates = Get-CandidateFiles -Roots $SearchRoots
$scanned = [System.Collections.Generic.List[object]]::new()

foreach ($file in $candidates) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    $scanned.Add([pscustomobject]@{
        path = $file.FullName
        bytes = [int64]$file.Length
        sha256 = $hash
        exactHash = ($hash -eq $expected)
    })
}

$exact = @($scanned | Where-Object exactHash)
$result = [ordered]@{
    schema = 1
    product = 'LLera V5.4.0 MONOLITH AURORA UX Source Recovery Gate'
    candidate = 'V5.4.0 MONOLITH AURORA UX'
    baseline = 'V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER'
    expectedSourceSha256 = $expected
    searchedRoots = @($SearchRoots)
    candidateCount = $scanned.Count
    candidates = @($scanned)
    exactHashMatches = $exact.Count
    selectedArchive = $null
    zipEntries = 0
    unsafeEntries = 0
    sourceShape = $null
    extracted = $false
    extractionPath = $null
    verdict = if ($exact.Count -eq 1) { 'HASH_MATCH_PENDING_STRUCTURE' } elseif ($exact.Count -gt 1) { 'AMBIGUOUS_IDENTICAL_HASH' } else { 'NOT_FOUND' }
}

if ($exact.Count -gt 0) {
    $selected = $exact[0]
    $result.selectedArchive = $selected.path
    $inventory = Get-SafeZipInventory -ZipPath $selected.path
    $unsafe = @($inventory | Where-Object unsafePath)
    $shape = Test-RequiredSourceShape -Inventory $inventory

    $result.zipEntries = $inventory.Count
    $result.unsafeEntries = $unsafe.Count
    $result.sourceShape = $shape

    if ($unsafe.Count -gt 0) {
        $result.verdict = 'REJECT_UNSAFE_ARCHIVE_PATHS'
    }
    elseif (-not $shape.allRequiredPresent) {
        $result.verdict = 'REJECT_SOURCE_SHAPE_MISMATCH'
    }
    elseif ($exact.Count -gt 1) {
        $result.verdict = 'AMBIGUOUS_IDENTICAL_HASH'
    }
    else {
        $result.verdict = 'FOUND_VERIFIED'

        if ($Extract) {
            if (Test-Path -LiteralPath $Destination) {
                Remove-Item -LiteralPath $Destination -Recurse -Force
            }
            New-Item -ItemType Directory -Force -Path $Destination | Out-Null
            [System.IO.Compression.ZipFile]::ExtractToDirectory($selected.path, $Destination)
            $result.extracted = $true
            $result.extractionPath = (Resolve-Path -LiteralPath $Destination).Path

            [ordered]@{
                schema = 1
                product = 'LLera V5.4.0 AURORA Recovered Source Inventory'
                sourceArchive = $selected.path
                sourceSha256 = $expected
                recoveredAt = (Get-Date).ToUniversalTime().ToString('o')
                requiredShape = $shape
                entries = $inventory
            } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $Destination '.llera-v540-source-inventory.json') -Encoding UTF8
        }
    }
}

$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir ("v540-source-recovery-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outPath -Encoding UTF8
$reportSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $outPath).Hash.ToLowerInvariant()
"$reportSha  $(Split-Path -Leaf $outPath)" | Set-Content -LiteralPath "$outPath.sha256" -Encoding ASCII

Write-Host "V5.4 source recovery verdict: $($result.verdict)"
Write-Host "Expected source SHA-256: $expected"
Write-Host "Candidates scanned: $($scanned.Count)"
Write-Host "Exact hash matches: $($exact.Count)"
Write-Host "Evidence: $outPath"
Write-Host "Evidence SHA-256: $reportSha"

if ($result.verdict -in @('FOUND_VERIFIED','AMBIGUOUS_IDENTICAL_HASH')) { exit 0 }
exit 3
