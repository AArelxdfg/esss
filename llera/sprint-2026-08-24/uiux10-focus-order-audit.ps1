[CmdletBinding()]
param(
    [string]$ProcessName = 'LLera',
    [int]$MaxForwardTabs = 24,
    [int]$MaxReverseTabs = 24,
    [int]$MinUniqueFocusTargets = 5,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$checks=[System.Collections.Generic.List[object]]::new()
function Add-Check([string]$id,[string]$name,[bool]$pass,[string]$detail,$evidence=$null){
  $checks.Add([pscustomobject]@{id=$id;name=$name;pass=$pass;detail=$detail;evidence=$evidence})
  Write-Host ('[{0}] {1} {2} - {3}' -f $(if($pass){'PASS'}else{'FAIL'}),$id,$name,$detail)
}
function Focus-Snapshot {
  try {
    $e=[System.Windows.Automation.AutomationElement]::FocusedElement
    if($null -eq $e){return $null}
    $r=$e.Current.BoundingRectangle
    return [pscustomobject]@{
      name=[string]$e.Current.Name
      automationId=[string]$e.Current.AutomationId
      type=([string]$e.Current.ControlType.ProgrammaticName -replace '^ControlType\.','')
      enabled=[bool]$e.Current.IsEnabled
      offscreen=[bool]$e.Current.IsOffscreen
      focusable=[bool]$e.Current.IsKeyboardFocusable
      x=[double]$r.X;y=[double]$r.Y;width=[double]$r.Width;height=[double]$r.Height
      processId=[int]$e.Current.ProcessId
      key=('{0}|{1}|{2}|{3}|{4}' -f [string]$e.Current.AutomationId,[string]$e.Current.Name,[string]$e.Current.ControlType.ProgrammaticName,[int]$e.Current.ProcessId,[int]$r.X)
    }
  } catch { return $null }
}
function Capture-Sequence([bool]$Reverse,[int]$MaxSteps,[int]$ExpectedPid){
  $seq=[System.Collections.Generic.List[object]]::new()
  for($i=0;$i -lt $MaxSteps;$i++){
    if($Reverse){[System.Windows.Forms.SendKeys]::SendWait('+{TAB}')}else{[System.Windows.Forms.SendKeys]::SendWait('{TAB}')}
    Start-Sleep -Milliseconds 90
    $s=Focus-Snapshot
    if($null -ne $s){$seq.Add($s)}
  }
  return @($seq)
}

$procs=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne 0})
if($procs.Count -ne 1){Add-Check 'FOC-001' 'Exactly one LLera shell' $false "count=$($procs.Count)" $null}
else{Add-Check 'FOC-001' 'Exactly one LLera shell' $true "pid=$($procs[0].Id)" @{pid=$procs[0].Id;title=$procs[0].MainWindowTitle}}
if($procs.Count -ne 1){$passCount=0;$total=$checks.Count;$score=0;$verdict='FAIL';$forward=@();$reverse=@();$pidExpected=-1}
else{
  $p=$procs[0];$pidExpected=$p.Id
  [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) | Out-Null
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}')
  Start-Sleep -Milliseconds 120
  $start=Focus-Snapshot
  Add-Check 'FOC-002' 'Focus enters LLera via keyboard' ($null-ne$start -and $start.processId -eq $p.Id -and $start.focusable) $(if($null-eq$start){'no focused element'}else{"pid=$($start.processId) name=$($start.name)"}) $start

  $forward=Capture-Sequence $false $MaxForwardTabs $p.Id
  $forwardInApp=@($forward|Where-Object{$_.processId-eq$p.Id})
  $forwardEscapes=@($forward|Where-Object{$_.processId-ne$p.Id})
  Add-Check 'FOC-003' 'Forward Tab never escapes LLera' ($forward.Count-gt0 -and $forwardEscapes.Count-eq0) "steps=$($forward.Count) escapes=$($forwardEscapes.Count)" $forwardEscapes

  $blankForward=@($forwardInApp|Where-Object{[string]::IsNullOrWhiteSpace($_.name) -and [string]::IsNullOrWhiteSpace($_.automationId)})
  Add-Check 'FOC-004' 'Every forward focus target is identifiable' ($blankForward.Count-eq0) "blank=$($blankForward.Count)" $blankForward

  $offscreenForward=@($forwardInApp|Where-Object{$_.offscreen -or $_.width-le0 -or $_.height-le0})
  Add-Check 'FOC-005' 'No invisible/offscreen focused target' ($offscreenForward.Count-eq0) "violations=$($offscreenForward.Count)" $offscreenForward

  $uniqueForward=@($forwardInApp|ForEach-Object{$_.key}|Select-Object -Unique)
  Add-Check 'FOC-006' 'Useful keyboard focus coverage' ($uniqueForward.Count-ge$MinUniqueFocusTargets) "unique=$($uniqueForward.Count) required=$MinUniqueFocusTargets" @{unique=$uniqueForward}

  # Detect premature traps: the first focus target must not recur before enough useful targets were visited.
  $trap=$false;$trapAt=-1
  if($forwardInApp.Count-gt1){$first=$forwardInApp[0].key;for($i=1;$i-lt$forwardInApp.Count;$i++){if($forwardInApp[$i].key-eq$first -and @($forwardInApp[0..($i-1)]|ForEach-Object{$_.key}|Select-Object -Unique).Count-lt$MinUniqueFocusTargets){$trap=$true;$trapAt=$i;break}}}
  Add-Check 'FOC-007' 'No premature keyboard focus trap' (-not$trap) $(if($trap){"cycleAt=$trapAt"}else{'no premature cycle'}) $null

  $reverse=Capture-Sequence $true $MaxReverseTabs $p.Id
  $reverseInApp=@($reverse|Where-Object{$_.processId-eq$p.Id})
  $reverseEscapes=@($reverse|Where-Object{$_.processId-ne$p.Id})
  Add-Check 'FOC-008' 'Reverse Shift+Tab never escapes LLera' ($reverse.Count-gt0 -and $reverseEscapes.Count-eq0) "steps=$($reverse.Count) escapes=$($reverseEscapes.Count)" $reverseEscapes

  $blankReverse=@($reverseInApp|Where-Object{[string]::IsNullOrWhiteSpace($_.name) -and [string]::IsNullOrWhiteSpace($_.automationId)})
  Add-Check 'FOC-009' 'Every reverse focus target is identifiable' ($blankReverse.Count-eq0) "blank=$($blankReverse.Count)" $blankReverse

  $uniqueReverse=@($reverseInApp|ForEach-Object{$_.key}|Select-Object -Unique)
  $missingFromReverse=@($uniqueForward|Where-Object{$_ -notin $uniqueReverse})
  Add-Check 'FOC-010' 'Reverse traversal covers forward focus set' ($missingFromReverse.Count-eq0) "missing=$($missingFromReverse.Count)" $missingFromReverse

  $passCount=@($checks|Where-Object{$_.pass}).Count;$total=$checks.Count;$score=[int][Math]::Round($passCount*100.0/[Math]::Max(1,$total));$verdict=if($score-eq100){'PASS'}else{'FAIL'}
}
$report=[ordered]@{
  schema=1;product='LLera UIUX 10/10 Focus Order Audit';candidate='V5.4.0 MONOLITH AURORA UX';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;processId=$pidExpected
  policy=@{maxForwardTabs=$MaxForwardTabs;maxReverseTabs=$MaxReverseTabs;minUniqueFocusTargets=$MinUniqueFocusTargets;requireNoEscape=$true;requireNoOffscreenFocus=$true;requireNamedOrIdentifiedTargets=$true;requireReverseCoverage=$true;requiredScore=100}
  score=$score;passCount=$passCount;totalChecks=$total;verdict=$verdict;forward=$forward;reverse=$reverse;checks=$checks
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$out=Join-Path $OutputDirectory "uiux10-focus-order-$stamp.json"
$report|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Focus-order score: $score/100";Write-Host "Evidence: $out";Write-Host "SHA-256: $sha"
if($verdict-ne'PASS'){exit 2};exit 0
