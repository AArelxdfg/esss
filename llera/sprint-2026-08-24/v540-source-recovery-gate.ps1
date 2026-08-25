[CmdletBinding()]
param(
    [string[]]$SearchRoots = @(
        "$env:USERPROFILE\Downloads",
        "$env:USERPROFILE\Desktop",
        "$env:USERPROFILE\Documents",
        "$env:USERPROFILE\OneDrive\Desktop",
        "$env:USERPROFILE\OneDrive\Documents",
        "$env:USERPROFILE\OneDrive\Downloads"
    ),
    [string]$ExpectedSha256 = 'b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471',
    [string]$ExpectedNamePattern = 'LLera*V5*4*AURORA*.zip',
    [switch]$HashAllZipFiles,
    [int64]$MaxZipBytes = 2147483648,
    [int64]$MaxExpandedBytes = 8589934592,
    [double]$MaxExpansionRatio = 250.0,
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
    finally { $zip.Dispose() }
}

function Get-CandidateFiles {
    param([string[]]$Roots)
    $items = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    foreach ($root in $Roots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -File -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Length -gt 0 -and $_.Length -le $MaxZipBytes -and (
                    $HashAllZipFiles -or
                    $_.Name -like $ExpectedNamePattern -or
                    ($_.Name -match '(?i)LLera' -and $_.Name -match '(?i)(5[._ -]?4|AURORA)')
                )
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
        [pscustomobject]@{ id=$req.id; found=($matches.Count -gt 0); matches=$matches }
    }
    return [pscustomobject]@{
        checks = @($checks)
        allRequiredPresent = (@($checks | Where-Object { -not $_.found }).Count -eq 0)
    }
}

function Expand-VerifiedArchive {
    param([Parameter(Mandatory)][string]$ZipPath,[Parameter(Mandatory)][string]$DestinationPath)
    $destFull = [System.IO.Path]::GetFullPath($DestinationPath)
    if (Test-Path -LiteralPath $destFull) { Remove-Item -LiteralPath $destFull -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $destFull | Out-Null
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName -replace '\\','/'
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            $target = [System.IO.Path]::GetFullPath((Join-Path $destFull $name))
            $prefix = $destFull.TrimEnd([System.IO.Path]::DirectorySeparatorChar,[System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
            if (-not $target.StartsWith($prefix,[System.StringComparison]::OrdinalIgnoreCase)) { throw "Archive extraction escaped destination: $name" }
            if ($name.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
            $parent = Split-Path -Parent $target
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            $input = $entry.Open()
            try {
                $output = [System.IO.File]::Open($target,[System.IO.FileMode]::Create,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
                try { $input.CopyTo($output) } finally { $output.Dispose() }
            }
            finally { $input.Dispose() }
        }
    }
    finally { $zip.Dispose() }
    return $destFull
}

$expected = $ExpectedSha256.ToLowerInvariant()
if ($expected -notmatch '^[0-9a-f]{64}$') { throw 'ExpectedSha256 must be a 64-character SHA-256 value.' }
if ($MaxZipBytes -le 0 -or $MaxExpandedBytes -le 0 -or $MaxExpansionRatio -le 1) { throw 'Archive safety limits must be positive and expansion ratio must be > 1.' }

$roots = @($SearchRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Sort-Object -Unique)
$candidates = Get-CandidateFiles -Roots $roots
$scanned = [System.Collections.Generic.List[object]]::new()
foreach ($file in $candidates) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    $scanned.Add([pscustomobject]@{
        path=$file.FullName; bytes=[int64]$file.Length; lastWriteUtc=$file.LastWriteTimeUtc.ToString('o'); sha256=$hash; exactHash=($hash -eq $expected)
    })
}

$exact = @($scanned | Where-Object exactHash | Sort-Object path)
$result = [ordered]@{
    schema = 2
    product = 'LLera V5.4.0 MONOLITH AURORA UX Source Recovery Gate'
    candidate = 'V5.4.0 MONOLITH AURORA UX'
    baseline = 'V5.3.5 MONOLITH OMEGA EVIDENCE LEDGER'
    expectedSourceSha256 = $expected
    searchedRoots = $roots
    hashAllZipFiles = [bool]$HashAllZipFiles
    archiveSafety = @{maxZipBytes=$MaxZipBytes;maxExpandedBytes=$MaxExpandedBytes;maxExpansionRatio=$MaxExpansionRatio}
    candidateCount = $scanned.Count
    candidates = @($scanned)
    exactHashMatches = $exact.Count
    equivalentExactCopies = @($exact | ForEach-Object {$_.path})
    selectedArchive = $null
    zipEntries = 0
    compressedBytes = 0
    expandedBytes = 0
    expansionRatio = 0.0
    unsafeEntries = 0
    sourceShape = $null
    extracted = $false
    extractionPath = $null
    verdict = if ($exact.Count -gt 0) { 'HASH_MATCH_PENDING_STRUCTURE' } else { 'NOT_FOUND' }
}

if ($exact.Count -gt 0) {
    # SHA-256 identity means multiple matches are byte-for-byte equivalent copies, not an ambiguity.
    $selected = $exact[0]
    $result.selectedArchive = $selected.path
    $inventory = Get-SafeZipInventory -ZipPath $selected.path
    $unsafe = @($inventory | Where-Object unsafePath)
    $shape = Test-RequiredSourceShape -Inventory $inventory
    $compressedTotal = [int64](($inventory | Measure-Object -Property compressedBytes -Sum).Sum)
    $expandedTotal = [int64](($inventory | Measure-Object -Property uncompressedBytes -Sum).Sum)
    $ratio = if ($compressedTotal -gt 0) { [double]$expandedTotal / [double]$compressedTotal } elseif ($expandedTotal -eq 0) { 1.0 } else { [double]::PositiveInfinity }

    $result.zipEntries = $inventory.Count
    $result.compressedBytes = $compressedTotal
    $result.expandedBytes = $expandedTotal
    $result.expansionRatio = if ([double]::IsInfinity($ratio)) { 'Infinity' } else { [Math]::Round($ratio,3) }
    $result.unsafeEntries = $unsafe.Count
    $result.sourceShape = $shape

    if ($unsafe.Count -gt 0) { $result.verdict = 'REJECT_UNSAFE_ARCHIVE_PATHS' }
    elseif ($expandedTotal -gt $MaxExpandedBytes) { $result.verdict = 'REJECT_EXPANDED_SIZE_LIMIT' }
    elseif ($ratio -gt $MaxExpansionRatio) { $result.verdict = 'REJECT_EXPANSION_RATIO_LIMIT' }
    elseif (-not $shape.allRequiredPresent) { $result.verdict = 'REJECT_SOURCE_SHAPE_MISMATCH' }
    else {
        $result.verdict = 'FOUND_VERIFIED'
        if ($Extract) {
            $dest = Expand-VerifiedArchive -ZipPath $selected.path -DestinationPath $Destination
            $result.extracted = $true
            $result.extractionPath = $dest
            [ordered]@{
                schema=2
                product='LLera V5.4.0 AURORA Recovered Source Inventory'
                sourceArchive=$selected.path
                equivalentExactCopies=@($exact | ForEach-Object {$_.path})
                sourceSha256=$expected
                recoveredAt=(Get-Date).ToUniversalTime().ToString('o')
                requiredShape=$shape
                archiveSafety=@{compressedBytes=$compressedTotal;expandedBytes=$expandedTotal;expansionRatio=$result.expansionRatio}
                entries=$inventory
            } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $dest '.llera-v540-source-inventory.json') -Encoding UTF8
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
Write-Host "Exact byte-identical copies: $($exact.Count)"
if (-not $HashAllZipFiles) { Write-Host 'Tip: rerun with -HashAllZipFiles if the source ZIP may have been renamed.' }
Write-Host "Evidence: $outPath"
Write-Host "Evidence SHA-256: $reportSha"

if ($result.verdict -eq 'FOUND_VERIFIED') { exit 0 }
exit 3
