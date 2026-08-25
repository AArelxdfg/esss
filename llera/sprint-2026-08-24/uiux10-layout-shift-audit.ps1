[CmdletBinding()]
param(
  [string]$ProcessName = 'LLera',
  [int]$Samples = 40,
  [int]$IntervalMs = 250,
  [double]$MaxJitterPx = 1.5,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
if ($Samples -lt 20) { throw 'Samples must be >= 20.' }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function RectToMap($r) {
  [ordered]@{ x=[double]$r.X; y=[double]$r.Y; width=[double]$r.Width; height=[double]$r.Height }
}
function RectDelta($a,$b) {
  [Math]::Max(
    [Math]::Max([Math]::Abs($a.x-$b.x),[Math]::Abs($a.y-$b.y)),
    [Math]::Max([Math]::Abs($a.width-$b.width),[Math]::Abs($a.height-$b.height))
  )
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw 'Running LLera window not found.' }
if (-not $proc.Responding) { throw 'LLera is not responding at audit start.' }

$exePath = $proc.Path
if (-not $exePath -or -not (Test-Path -LiteralPath $exePath)) { throw 'Unable to resolve LLera executable path.' }
$exeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $exePath).Hash.ToLowerInvariant()
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if (-not $root) { throw 'Unable to attach UI Automation to LLera.' }

# Track only stable interaction anchors. Dynamic transcript/status text is intentionally excluded.
$anchorNameRx = '(?i)(send|stop|gönder|durdur|composer|message|mesaj|prompt|new chat|yeni sohbet|settings|ayar|operations|evidence|kanıt|activity|command)'
$baseline = @{}
$samplesOut = @()
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
$maxObservedJitter = 0.0

for ($i=0; $i -lt $Samples; $i++) {
  $proc.Refresh()
  if (-not $proc.Responding) { $failures.Add("sample $i: process not responding") }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  if (-not $root) { $failures.Add("sample $i: UIA root missing"); Start-Sleep -Milliseconds $IntervalMs; continue }

  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $anchors = @()
  for ($j=0; $j -lt $all.Count; $j++) {
    $e = $all.Item($j)
    try {
      $name = [string]$e.Current.Name
      $aid = [string]$e.Current.AutomationId
      $focusable = [bool]$e.Current.IsKeyboardFocusable
      $off = [bool]$e.Current.IsOffscreen
      $r = $e.Current.BoundingRectangle
      if ($off -or $r.Width -le 1 -or $r.Height -le 1) { continue }
      if (-not $focusable -and $name -notmatch $anchorNameRx -and $aid -notmatch $anchorNameRx) { continue }
      $key = if ($aid) { "id:$aid" } elseif ($name) { "name:$name|type:$($e.Current.ControlType.Id)" } else { continue }
      $rect = RectToMap $r
      $anchors += [ordered]@{ key=$key; name=$name; automationId=$aid; rect=$rect }

      if (-not $baseline.ContainsKey($key)) {
        $baseline[$key] = $rect
      } else {
        $d = RectDelta $baseline[$key] $rect
        if ($d -gt $maxObservedJitter) { $maxObservedJitter = $d }
        if ($d -gt $MaxJitterPx) { $failures.Add("sample $i: layout shift $([Math]::Round($d,2))px for $key") }
      }
    } catch {
      $warnings.Add("sample $i: transient UIA read failure: $($_.Exception.Message)")
    }
  }
  if ($anchors.Count -lt 3) { $warnings.Add("sample $i: fewer than 3 stable interaction anchors observed") }
  $samplesOut += [ordered]@{ index=$i; capturedAt=(Get-Date).ToUniversalTime().ToString('o'); anchorCount=$anchors.Count }
  Start-Sleep -Milliseconds $IntervalMs
}

$uniqueFailures = @($failures | Select-Object -Unique)
$uniqueWarnings = @($warnings | Select-Object -Unique)
$score = 100
if ($uniqueFailures.Count -gt 0) { $score -= [Math]::Min(100, 20 * $uniqueFailures.Count) }
if ($uniqueWarnings.Count -gt 0) { $score -= [Math]::Min(20, 5 * $uniqueWarnings.Count) }
if ($maxObservedJitter -gt $MaxJitterPx) { $score = [Math]::Min($score, 99) }
if ($score -lt 0) { $score = 0 }
$verdict = if ($score -eq 100 -and $uniqueFailures.Count -eq 0 -and $uniqueWarnings.Count -eq 0) { 'PASS' } else { 'FAIL' }

$report = [ordered]@{
  schema = 1
  product = 'LLera UIUX10 Layout Shift Stability Audit'
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  host = [ordered]@{ computer=$env:COMPUTERNAME; os=[Environment]::OSVersion.VersionString }
  runtime = [ordered]@{ pid=$proc.Id; executable=$exePath; executableSha256=$exeSha256 }
  policy = [ordered]@{ samples=$Samples; intervalMs=$IntervalMs; maxJitterPx=$MaxJitterPx; dynamicTranscriptExcluded=$true }
  observed = [ordered]@{ trackedAnchorCount=$baseline.Count; maxObservedJitterPx=[Math]::Round($maxObservedJitter,3) }
  score = $score
  verdict = $verdict
  warningCount = $uniqueWarnings.Count
  failureCount = $uniqueFailures.Count
  warnings = $uniqueWarnings
  failures = $uniqueFailures
  samples = $samplesOut
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputDirectory "uiux10-layout-shift-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
$sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Layout-shift evidence: $out"
Write-Host "Score: $score/100 Verdict: $verdict SHA-256: $sha"
if ($verdict -ne 'PASS') { exit 2 }
exit 0
