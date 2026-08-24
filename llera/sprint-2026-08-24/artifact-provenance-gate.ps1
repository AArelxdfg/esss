[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallerPath,
    [Parameter(Mandatory)][string]$SourceZipPath,
    [string]$ExpectedVersion = '5.3.5',
    [string]$ExpectedInstallerSha256 = '1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e',
    [string]$ExpectedSourceSha256 = '06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097',
    [string]$ExpectedSignerThumbprint = '',
    [switch]$RequireTrustedSignature
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 2
}
function Hash([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}
function Normalize-Thumbprint([string]$Value) {
    return ($Value -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
}

if ($env:OS -ne 'Windows_NT') { Fail 'Artifact provenance gate must execute on Windows.' }
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { Fail "Installer missing: $InstallerPath" }
if (-not (Test-Path -LiteralPath $SourceZipPath -PathType Leaf)) { Fail "Source ZIP missing: $SourceZipPath" }

$installer = Get-Item -LiteralPath $InstallerPath
$source = Get-Item -LiteralPath $SourceZipPath
$installerHash = Hash $installer.FullName
$sourceHash = Hash $source.FullName

if ($installerHash -ne $ExpectedInstallerSha256.ToLowerInvariant()) {
    Fail "Installer SHA-256 mismatch. expected=$ExpectedInstallerSha256 actual=$installerHash"
}
if ($sourceHash -ne $ExpectedSourceSha256.ToLowerInvariant()) {
    Fail "Source ZIP SHA-256 mismatch. expected=$ExpectedSourceSha256 actual=$sourceHash"
}

# Reject obvious masquerading before any promotion decision. MZ + PE signature is required for the installer.
$bytes = [System.IO.File]::ReadAllBytes($installer.FullName)
if ($bytes.Length -lt 256 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { Fail 'Installer is not an MZ executable.' }
$peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
if ($peOffset -lt 0 -or ($peOffset + 6) -gt $bytes.Length) { Fail 'Installer has an invalid PE header offset.' }
if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45 -or $bytes[$peOffset + 2] -ne 0x00 -or $bytes[$peOffset + 3] -ne 0x00) {
    Fail 'Installer PE signature is invalid.'
}
$machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
if ($machine -ne 0x8664) { Fail ("Installer machine is 0x{0:X4}; expected AMD64 0x8664." -f $machine) }

# ZIP must be readable and free of traversal/absolute-path entries before it is accepted as the recovered source.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($source.FullName)
try {
    if ($zip.Entries.Count -eq 0) { Fail 'Source ZIP is empty.' }
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName.Replace('/', '\')
        if ($name -match '(^|\\)\.\.(\\|$)' -or $name.StartsWith('\') -or $name -match '^[A-Za-z]:') {
            Fail "Unsafe source ZIP entry: $($entry.FullName)"
        }
    }
    $zipEntryCount = $zip.Entries.Count
}
finally { $zip.Dispose() }

$signature = Get-AuthenticodeSignature -FilePath $installer.FullName
$signerThumbprint = if ($signature.SignerCertificate) { Normalize-Thumbprint $signature.SignerCertificate.Thumbprint } else { '' }
$expectedThumbprint = Normalize-Thumbprint $ExpectedSignerThumbprint

if ($RequireTrustedSignature -and $signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    Fail "Installer Authenticode status is $($signature.Status), not Valid."
}
if ($expectedThumbprint -and $signerThumbprint -ne $expectedThumbprint) {
    Fail "Installer signer thumbprint mismatch. expected=$expectedThumbprint actual=$signerThumbprint"
}

$result = [ordered]@{
    schema = 1
    product = 'LLera Artifact Provenance Gate'
    version = $ExpectedVersion
    verdict = 'PASS'
    checkedAt = (Get-Date).ToUniversalTime().ToString('o')
    physicalWindowsExecuted = $true
    installer = [ordered]@{
        file = $installer.Name
        sizeBytes = $installer.Length
        sha256 = $installerHash
        expectedSha256 = $ExpectedInstallerSha256.ToLowerInvariant()
        peMachine = 'AMD64'
        authenticode = [ordered]@{
            status = $signature.Status.ToString()
            statusMessage = $signature.StatusMessage
            signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
            signerThumbprint = if ($signerThumbprint) { $signerThumbprint } else { $null }
            trustedSignatureRequired = [bool]$RequireTrustedSignature
            expectedSignerThumbprint = if ($expectedThumbprint) { $expectedThumbprint } else { $null }
        }
    }
    source = [ordered]@{
        file = $source.Name
        sizeBytes = $source.Length
        sha256 = $sourceHash
        expectedSha256 = $ExpectedSourceSha256.ToLowerInvariant()
        zipEntries = $zipEntryCount
        traversalCheck = 'PASS'
    }
}

$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$out = Join-Path $outDir ("artifact-provenance-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
$outHash = Hash $out
"$outHash  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: exact V5.3.5 installer/source provenance verified.'
Write-Host "Evidence: $out"
Write-Host "SHA-256: $outHash"
exit 0
