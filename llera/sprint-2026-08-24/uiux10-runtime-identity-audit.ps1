[CmdletBinding()]
param(
    [string]$ProcessName = 'LLera',
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$procs=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
$checks=[System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Id,[string]$Name,[bool]$Pass,[string]$Detail,$Evidence=$null){
  $checks.Add([pscustomobject]@{id=$Id;name=$Name;pass=$Pass;detail=$Detail;evidence=$Evidence})
}
if($procs.Count -ne 1){
  Add-Check 'RID-001' 'Exactly one visible LLera shell' $false "count=$($procs.Count)" $null
  $report=[ordered]@{schema=1;product='LLera UIUX 10/10 Runtime Identity Audit';candidate=$ExpectedCandidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;score=0;verdict='FAIL';checks=$checks}
  $out=Join-Path $OutputDirectory ("uiux10-runtime-identity-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
  exit 2
}
$p=$procs[0]
Add-Check 'RID-001' 'Exactly one visible LLera shell' $true "pid=$($p.Id)" @{pid=$p.Id;title=$p.MainWindowTitle}

$exePath=$null
try {$exePath=$p.Path} catch {}
$pathOk=($exePath -and (Test-Path -LiteralPath $exePath -PathType Leaf))
Add-Check 'RID-002' 'Running executable path is readable' $pathOk ([string]$exePath) @{path=$exePath}

$exeSha=$null;$length=0;$fileVersion=$null;$productVersion=$null;$company=$null;$productName=$null
if($pathOk){
  $fi=Get-Item -LiteralPath $exePath
  $length=[int64]$fi.Length
  $exeSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $exePath).Hash.ToLowerInvariant()
  $vi=$fi.VersionInfo
  $fileVersion=[string]$vi.FileVersion;$productVersion=[string]$vi.ProductVersion;$company=[string]$vi.CompanyName;$productName=[string]$vi.ProductName
}
$hashOk=($exeSha -match '^[0-9a-f]{64}$' -and $length -gt 0)
Add-Check 'RID-003' 'Running executable has immutable SHA-256 identity' $hashOk "sha256=$exeSha bytes=$length" @{sha256=$exeSha;bytes=$length}

$signatureStatus='Unknown';$signerThumbprint=$null;$signerSubject=$null
if($pathOk){
  try {
    $sig=Get-AuthenticodeSignature -LiteralPath $exePath
    $signatureStatus=[string]$sig.Status
    if($sig.SignerCertificate){$signerThumbprint=[string]$sig.SignerCertificate.Thumbprint;$signerSubject=[string]$sig.SignerCertificate.Subject}
  } catch {$signatureStatus='InspectionFailed'}
}
$signatureInspectable=($signatureStatus -ne 'InspectionFailed')
Add-Check 'RID-004' 'Authenticode status captured without inspection error' $signatureInspectable "status=$signatureStatus" @{status=$signatureStatus;thumbprint=$signerThumbprint;subject=$signerSubject}

$responding=([bool]$p.Responding)
Add-Check 'RID-005' 'Identified runtime is responsive during capture' $responding "responding=$responding" @{pid=$p.Id}

$passCount=@($checks|Where-Object{$_.pass}).Count;$total=$checks.Count
$score=[int][Math]::Round($passCount*100.0/[Math]::Max(1,$total));$verdict=if($score -eq 100){'PASS'}else{'FAIL'}
$report=[ordered]@{
 schema=1
 product='LLera UIUX 10/10 Runtime Identity Audit'
 candidate=$ExpectedCandidate
 capturedAt=(Get-Date).ToUniversalTime().ToString('o')
 computer=$env:COMPUTERNAME
 process=@{pid=$p.Id;title=$p.MainWindowTitle;path=$exePath;sha256=$exeSha;bytes=$length;fileVersion=$fileVersion;productVersion=$productVersion;companyName=$company;productName=$productName;responding=$responding}
 authenticode=@{status=$signatureStatus;thumbprint=$signerThumbprint;subject=$signerSubject;trusted=($signatureStatus -eq 'Valid')}
 score=$score;passCount=$passCount;totalChecks=$total;verdict=$verdict;checks=$checks
}
$out=Join-Path $OutputDirectory ("uiux10-runtime-identity-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Runtime identity evidence: $out"
Write-Host "Executable SHA-256: $exeSha"
if($verdict -ne 'PASS'){exit 2}
exit 0
