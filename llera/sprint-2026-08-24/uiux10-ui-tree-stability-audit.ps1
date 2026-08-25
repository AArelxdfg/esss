[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$Candidate='V5.4.0 MONOLITH AURORA UX',
  [int]$Samples=30,
  [int]$IntervalMs=500,
  [double]$MaxInteractiveChurnPercent=10.0,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
if($Samples -lt 10){throw 'Samples must be >= 10.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null

function Fail([string]$m){throw $m}
function Get-Proc {
  $p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0}|Select-Object -First 1)
  if($p.Count-ne 1){Fail 'Running LLera window required.'}
  return $p[0]
}
function Get-Snapshot([System.Diagnostics.Process]$p){
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  if($null-eq $root){Fail 'UI Automation root unavailable.'}
  $cond=[System.Windows.Automation.Condition]::TrueCondition
  $els=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond))
  $visibleInteractive=@()
  $unnamed=@();$dupIds=@();$idMap=@{}
  foreach($e in $els){
    try{
      $c=$e.Current
      if($c.IsOffscreen){continue}
      $interactive=$c.IsKeyboardFocusable -or $c.IsEnabled -and ($c.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $c.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or $c.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -or $c.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -or $c.ControlType -eq [System.Windows.Automation.ControlType]::TabItem)
      if(-not $interactive){continue}
      $name=([string]$c.Name).Trim();$aid=([string]$c.AutomationId).Trim();$type=[string]$c.ControlType.ProgrammaticName
      if($c.IsKeyboardFocusable -and [string]::IsNullOrWhiteSpace($name)){$unnamed += $type}
      if(-not [string]::IsNullOrWhiteSpace($aid)){
        if($idMap.ContainsKey($aid)){$dupIds += $aid}else{$idMap[$aid]=$true}
      }
      $key=if($aid){"id:$aid"}elseif($name){"name:$name|$type"}else{"type:$type"}
      $visibleInteractive += $key
    }catch{}
  }
  $focus=[System.Windows.Automation.AutomationElement]::FocusedElement
  $focusPid=0
  try{$focusPid=$focus.Current.ProcessId}catch{}
  [ordered]@{
    capturedAt=(Get-Date).ToUniversalTime().ToString('o')
    responding=$p.Responding
    interactive=@($visibleInteractive|Sort-Object -Unique)
    unnamedFocusable=@($unnamed|Sort-Object -Unique)
    duplicateAutomationIds=@($dupIds|Sort-Object -Unique)
    focusProcessId=$focusPid
  }
}

$p=Get-Proc
$exePath=$p.Path
$exeSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $exePath).Hash.ToLowerInvariant()
$snapshots=@()
for($i=0;$i-lt $Samples;$i++){
  $p.Refresh();$snapshots += Get-Snapshot $p
  if($i-lt ($Samples-1)){Start-Sleep -Milliseconds $IntervalMs}
}
$baseline=@($snapshots[0].interactive)
$maxChurn=0.0;$failures=@();$warnings=@()
foreach($s in $snapshots){
  if(-not $s.responding){$failures += 'LLera became non-responsive during idle UIA stability sampling.'}
  if(@($s.unnamedFocusable).Count-gt 0){$failures += ('Unnamed focusable controls observed: '+(@($s.unnamedFocusable)-join ', '))}
  if(@($s.duplicateAutomationIds).Count-gt 0){$failures += ('Duplicate AutomationId values observed: '+(@($s.duplicateAutomationIds)-join ', '))}
  if([int]$s.focusProcessId -ne 0 -and [int]$s.focusProcessId -ne $p.Id){$warnings += 'Keyboard focus left LLera while idle stability audit was running.'}
  $cur=@($s.interactive)
  $union=@($baseline+$cur|Sort-Object -Unique)
  if($union.Count-gt 0){
    $diff=@($union|Where-Object{($baseline -notcontains $_) -or ($cur -notcontains $_)})
    $churn=100.0*$diff.Count/$union.Count
    if($churn-gt $maxChurn){$maxChurn=$churn}
  }
}
if($maxChurn -gt $MaxInteractiveChurnPercent){$failures += "Interactive UIA tree churn ${maxChurn}% exceeds ${MaxInteractiveChurnPercent}% idle limit."}
$failures=@($failures|Sort-Object -Unique);$warnings=@($warnings|Sort-Object -Unique)
$checks=[ordered]@{
  samplesEnough=($snapshots.Count -eq $Samples)
  alwaysResponsive=(@($snapshots|Where-Object{-not $_.responding}).Count -eq 0)
  noUnnamedFocusable=(@($snapshots|Where-Object{@($_.unnamedFocusable).Count-gt 0}).Count -eq 0)
  noDuplicateAutomationIds=(@($snapshots|Where-Object{@($_.duplicateAutomationIds).Count-gt 0}).Count -eq 0)
  boundedInteractiveTreeChurn=($maxChurn -le $MaxInteractiveChurnPercent)
  noWarnings=($warnings.Count -eq 0)
}
$passCount=@($checks.GetEnumerator()|Where-Object{$_.Value}).Count;$totalChecks=$checks.Count
$score=[int][Math]::Round(100.0*$passCount/$totalChecks)
$verdict=if($score-eq 100 -and $failures.Count-eq 0 -and $warnings.Count-eq 0){'PASS'}else{'FAIL'}
$result=[ordered]@{
  schema=1;product='LLera UIUX 10/10 UI Tree Stability Audit';candidate=$Candidate
  capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME
  process=@{pid=$p.Id;path=$exePath;sha256=$exeSha}
  policy=@{samples=$Samples;intervalMs=$IntervalMs;maxInteractiveChurnPercent=$MaxInteractiveChurnPercent;allowWarnings=$false}
  metrics=@{baselineInteractiveCount=$baseline.Count;maxInteractiveChurnPercent=[Math]::Round($maxChurn,3)}
  checks=$checks;passCount=$passCount;totalChecks=$totalChecks;score=$score;verdict=$verdict
  failures=$failures;warnings=$warnings
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$out=Join-Path $OutputDirectory "uiux10-ui-tree-stability-$stamp.json"
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$result|ConvertTo-Json -Depth 10
if($verdict-ne 'PASS'){exit 2}
exit 0
