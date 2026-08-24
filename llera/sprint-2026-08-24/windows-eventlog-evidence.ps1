[CmdletBinding()]
param(
  [int]$LookbackHours = 24,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts'),
  [string[]]$ProcessPatterns = @('LLera.exe','llama-server.exe'),
  [switch]$FailOnAnyCrashOrHang
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$start = (Get-Date).AddHours(-[Math]::Abs($LookbackHours))
$providers = @('Application Error','Application Hang','Windows Error Reporting')
$events = @()
try {
  $events = @(Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$start} -ErrorAction Stop |
    Where-Object { $_.ProviderName -in $providers } |
    ForEach-Object {
      $msg = [string]$_.Message
      $matched = @($ProcessPatterns | Where-Object { $msg -match [regex]::Escape($_) })
      if ($matched.Count -gt 0) {
        [pscustomobject]@{
          timeCreated = $_.TimeCreated.ToUniversalTime().ToString('o')
          provider = $_.ProviderName
          eventId = $_.Id
          level = $_.LevelDisplayName
          processMatches = $matched
          recordId = $_.RecordId
          messageSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($msg))).ToLowerInvariant()
          messagePreview = if ($msg.Length -gt 500) { $msg.Substring(0,500) } else { $msg }
        }
      }
    } | Where-Object { $null -ne $_ })
} catch {
  $events = @()
  $readError = $_.Exception.Message
}
$crashes = @($events | Where-Object { $_.provider -eq 'Application Error' })
$hangs = @($events | Where-Object { $_.provider -eq 'Application Hang' })
$wer = @($events | Where-Object { $_.provider -eq 'Windows Error Reporting' })
$status = 'PASS'
$reason = 'No matching LLera/llama-server crash or hang events in lookback window.'
if ($FailOnAnyCrashOrHang -and ($crashes.Count + $hangs.Count) -gt 0) {
  $status = 'FAIL'
  $reason = "Detected $($crashes.Count) crash event(s) and $($hangs.Count) hang event(s)."
} elseif (($crashes.Count + $hangs.Count) -gt 0) {
  $status = 'WARN'
  $reason = "Detected $($crashes.Count) crash event(s) and $($hangs.Count) hang event(s); strict failure switch not enabled."
}
if (Get-Variable readError -ErrorAction SilentlyContinue) {
  $status = 'FAIL'; $reason = "Application event log could not be read: $readError"
}
$report = [ordered]@{
  schema = 1
  collector = 'LLera Windows crash/hang event evidence'
  physicalWindows = $true
  startedAt = $start.ToUniversalTime().ToString('o')
  completedAt = (Get-Date).ToUniversalTime().ToString('o')
  computer = $env:COMPUTERNAME
  lookbackHours = $LookbackHours
  processPatterns = $ProcessPatterns
  verdict = $status
  reason = $reason
  counts = @{ crash=$crashes.Count; hang=$hangs.Count; wer=$wer.Count; total=$events.Count }
  events = $events
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputDirectory "windows-eventlog-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
[pscustomobject]@{ verdict=$status; evidence=$out; sha256=$sha; crash=$crashes.Count; hang=$hangs.Count; wer=$wer.Count } | ConvertTo-Json -Compress
if ($status -eq 'FAIL') { exit 2 }
exit 0
