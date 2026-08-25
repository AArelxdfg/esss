[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$ExpectedExecutableSha256='',
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){ throw 'Windows required.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Fail([string]$m){ Write-Error $m; exit 2 }
function Sha([string]$p){ (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }
function Safe-Pattern($el,[System.Windows.Automation.AutomationPattern]$pattern){ try { $o=$null; return $el.TryGetCurrentPattern($pattern,[ref]$o) } catch { return $false } }

$proc=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle-ne0} | Select-Object -First 1)
if($proc.Count-ne1){ Fail 'Exactly one visible LLera main window is required.' }
$p=$proc[0]
$exe=$p.Path
if(-not $exe -or -not(Test-Path -LiteralPath $exe -PathType Leaf)){ Fail 'Running LLera executable path is unavailable.' }
$exeSha=Sha $exe
if($ExpectedExecutableSha256){ if($ExpectedExecutableSha256 -notmatch '^[0-9a-fA-F]{64}$'){ Fail 'Expected executable SHA-256 is malformed.' }; if($exeSha-ne$ExpectedExecutableSha256.ToLowerInvariant()){ Fail 'Running LLera executable SHA-256 does not match the expected candidate.' } }
if(-not $p.Responding){ Fail 'LLera process is not responding.' }

$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
if($null-eq$root){ Fail 'UI Automation root could not be resolved.' }
$walker=[System.Windows.Automation.TreeWalker]::RawViewWalker
$interactiveTypes=@(
  [System.Windows.Automation.ControlType]::Button.Id,
  [System.Windows.Automation.ControlType]::Edit.Id,
  [System.Windows.Automation.ControlType]::ComboBox.Id,
  [System.Windows.Automation.ControlType]::CheckBox.Id,
  [System.Windows.Automation.ControlType]::RadioButton.Id,
  [System.Windows.Automation.ControlType]::TabItem.Id,
  [System.Windows.Automation.ControlType]::ListItem.Id,
  [System.Windows.Automation.ControlType]::MenuItem.Id,
  [System.Windows.Automation.ControlType]::Hyperlink.Id,
  [System.Windows.Automation.ControlType]::Slider.Id
)
$rows=New-Object System.Collections.Generic.List[object]
$failures=New-Object System.Collections.Generic.List[string]
$warnings=New-Object System.Collections.Generic.List[string]
$queue=New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue($root)
while($queue.Count-gt0){
  $el=$queue.Dequeue()
  $child=$walker.GetFirstChild($el)
  while($null-ne$child){ $queue.Enqueue($child); $child=$walker.GetNextSibling($child) }
  if($el-eq$root){ continue }
  try {
    $c=$el.Current
    $rect=$c.BoundingRectangle
    $isInteractive=($interactiveTypes -contains $c.ControlType.Id) -or $c.IsKeyboardFocusable
    if(-not$isInteractive){ continue }
    $name=([string]$c.Name).Trim(); $autoId=([string]$c.AutomationId).Trim(); $type=[string]$c.ControlType.ProgrammaticName
    $visible=(-not$c.IsOffscreen) -and $rect.Width-gt0 -and $rect.Height-gt0
    $hasInvoke=Safe-Pattern $el ([System.Windows.Automation.InvokePattern]::Pattern)
    $hasValue=Safe-Pattern $el ([System.Windows.Automation.ValuePattern]::Pattern)
    $hasSelectionItem=Safe-Pattern $el ([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $hasToggle=Safe-Pattern $el ([System.Windows.Automation.TogglePattern]::Pattern)
    $hasExpand=Safe-Pattern $el ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    $semanticsOk=$hasInvoke -or $hasValue -or $hasSelectionItem -or $hasToggle -or $hasExpand -or $c.IsKeyboardFocusable
    if($visible -and -not$name){ $failures.Add("Visible interactive element has no accessible name: $type automationId='$autoId'") }
    if($visible -and -not$semanticsOk){ $failures.Add("Visible interactive element exposes no usable interaction semantics: $type name='$name'") }
    if($visible -and $c.IsKeyboardFocusable -and $rect.Width-lt1){ $failures.Add("Focusable element has invalid bounds: $type name='$name'") }
    $rows.Add([ordered]@{name=$name;automationId=$autoId;controlType=$type;keyboardFocusable=$c.IsKeyboardFocusable;offscreen=$c.IsOffscreen;enabled=$c.IsEnabled;visible=$visible;bounds=@{x=[math]::Round($rect.X,2);y=[math]::Round($rect.Y,2);width=[math]::Round($rect.Width,2);height=[math]::Round($rect.Height,2)};patterns=@{invoke=$hasInvoke;value=$hasValue;selectionItem=$hasSelectionItem;toggle=$hasToggle;expandCollapse=$hasExpand}})
  } catch { $warnings.Add("UIA element read failed: $($_.Exception.Message)") }
}

$visible=@($rows|Where-Object{$_.visible})
if($visible.Count-lt3){ $failures.Add("Too few visible interactive UIA elements discovered: $($visible.Count)") }
$named=@($visible|Where-Object{[string]$_.name})
if($visible.Count-gt0 -and $named.Count-ne$visible.Count){ $failures.Add('Not every visible interactive control has an accessible name.') }
$focusable=@($visible|Where-Object{$_.keyboardFocusable})
if($focusable.Count-lt2){ $failures.Add("Too few keyboard-focusable visible controls: $($focusable.Count)") }

# Duplicate accessible labels are tolerated only when a stable AutomationId disambiguates them.
$dupes=$visible|Where-Object{[string]$_.name}|Group-Object controlType,name|Where-Object{$_.Count-gt1}
foreach($g in $dupes){ $ids=@($g.Group|ForEach-Object{$_.automationId}|Where-Object{$_}|Select-Object -Unique); if($ids.Count-ne$g.Count){ $warnings.Add("Ambiguous duplicate accessible label/control type: $($g.Name)") } }

$score=100
if($failures.Count-gt0){ $score=[math]::Max(0,100-20*$failures.Count) }
elseif($warnings.Count-gt0){ $score=[math]::Max(0,100-5*$warnings.Count) }
$verdict=if($score-eq100 -and $failures.Count-eq0 -and $warnings.Count-eq0){'PASS'}else{'FAIL'}
$result=[ordered]@{
 schema=1; product='LLera UIUX 10/10 Accessibility Semantics Audit'; capturedAt=(Get-Date).ToUniversalTime().ToString('o'); computer=$env:COMPUTERNAME
 process=@{pid=$p.Id;path=$exe;sha256=$exeSha;responding=$p.Responding;windowTitle=$p.MainWindowTitle}
 metrics=@{interactiveVisible=$visible.Count;accessibleNamedVisible=$named.Count;keyboardFocusableVisible=$focusable.Count;duplicateLabelGroups=@($dupes).Count}
 score=$score;verdict=$verdict;failures=@($failures);warnings=@($warnings);elements=@($rows)
 policy=@{requirePhysicalWindows=$true;requireSameCandidateSha=$true;requireAllVisibleInteractiveNamed=$true;requireKeyboardFocusableSurface=$true;allowWarnings=$false}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-accessibility-semantics-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$reportSha=Sha $out
"$reportSha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Accessibility semantics evidence: $out"
Write-Host "Score: $score/100 Verdict: $verdict"
if($verdict-ne'PASS'){ exit 2 }
exit 0
