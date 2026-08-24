[CmdletBinding()]
param(
    [string]$ProcessName='LLera',
    [int]$FocusTraversalSteps=10,
    [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraInteractionWin32 {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@

$checks=[System.Collections.Generic.List[object]]::new()
function Add-Check([string]$id,[string]$name,[bool]$pass,[string]$detail,$evidence=$null){$checks.Add([pscustomobject]@{id=$id;name=$name;pass=$pass;detail=$detail;evidence=$evidence});Write-Host "[$(if($pass){'PASS'}else{'FAIL'})] $id $name - $detail"}
function Snapshot($root){
 $items=@();$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 foreach($el in $all){try{$items+=[pscustomobject]@{name=[string]$el.Current.Name;automationId=[string]$el.Current.AutomationId;type=($el.Current.ControlType.ProgrammaticName-replace '^ControlType\.','');offscreen=[bool]$el.Current.IsOffscreen;enabled=[bool]$el.Current.IsEnabled;focusable=[bool]$el.Current.IsKeyboardFocusable}}catch{}}
 return @($items)
}

$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0}|Select-Object -First 1)
if($p.Count-ne 1){Add-Check 'INT-001' 'Running LLera window' $false "count=$($p.Count)";exit 2}
$p=$p[0];[void][LLeraInteractionWin32]::ShowWindow($p.MainWindowHandle,9);[void][LLeraInteractionWin32]::SetForegroundWindow($p.MainWindowHandle);Start-Sleep -Milliseconds 250
$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
Add-Check 'INT-001' 'Running LLera window' $true "pid=$($p.Id) title=$($p.MainWindowTitle)"

$before=Snapshot $root
$beforePalette=@($before|Where-Object{-not $_.offscreen -and $_.type -eq 'Edit' -and $_.name -match '(?i)(command|komut|search|ara)'}).Count
[System.Windows.Forms.SendKeys]::SendWait('^k');Start-Sleep -Milliseconds 450
$opened=Snapshot $root
$palette=@($opened|Where-Object{-not $_.offscreen -and $_.enabled -and (($_.type -eq 'Edit' -and $_.name -match '(?i)(command|komut|search|ara)') -or $_.name -match '(?i)(command palette|komut paleti)')})
Add-Check 'INT-002' 'Ctrl+K opens discoverable command palette' ($palette.Count-ge 1) "matches=$($palette.Count) beforeNamedEditors=$beforePalette" ($palette|Select-Object -First 10)

$focused=$null;try{$focused=[System.Windows.Automation.AutomationElement]::FocusedElement}catch{}
$focusOk=$false;$focusEvidence=$null
if($focused){try{$focusEvidence=@{name=[string]$focused.Current.Name;automationId=[string]$focused.Current.AutomationId;type=($focused.Current.ControlType.ProgrammaticName-replace '^ControlType\.','')};$focusOk=($focusEvidence.type -eq 'Edit' -or $focusEvidence.name -match '(?i)(command|komut|search|ara)')}catch{}}
Add-Check 'INT-003' 'Palette receives useful keyboard focus' $focusOk ($(if($focusEvidence){"type=$($focusEvidence.type) name=$($focusEvidence.name)"}else{'no focused element'})) $focusEvidence

[System.Windows.Forms.SendKeys]::SendWait('{ESC}');Start-Sleep -Milliseconds 350
$closed=Snapshot $root
$paletteAfter=@($closed|Where-Object{-not $_.offscreen -and $_.enabled -and (($_.type -eq 'Edit' -and $_.name -match '(?i)(command|komut|search|ara)') -or $_.name -match '(?i)(command palette|komut paleti)')})
$escOk=($paletteAfter.Count -le $beforePalette)
Add-Check 'INT-004' 'Escape dismisses command palette' $escOk "afterMatches=$($paletteAfter.Count) baselineNamedEditors=$beforePalette" ($paletteAfter|Select-Object -First 10)

[void][LLeraInteractionWin32]::SetForegroundWindow($p.MainWindowHandle);Start-Sleep -Milliseconds 150
$focusPath=@()
for($i=0;$i-lt $FocusTraversalSteps;$i++){
 [System.Windows.Forms.SendKeys]::SendWait('{TAB}');Start-Sleep -Milliseconds 100
 try{$f=[System.Windows.Automation.AutomationElement]::FocusedElement;if($f){$focusPath+=[pscustomobject]@{step=$i+1;name=[string]$f.Current.Name;automationId=[string]$f.Current.AutomationId;type=($f.Current.ControlType.ProgrammaticName-replace '^ControlType\.','')}}}catch{}
}
$unique=@($focusPath|ForEach-Object{"$($_.type)|$($_.automationId)|$($_.name)"}|Where-Object{$_ -ne '||'}|Select-Object -Unique)
Add-Check 'INT-005' 'Tab traversal reaches multiple controls' ($unique.Count-ge 4) "uniqueFocusTargets=$($unique.Count) steps=$FocusTraversalSteps" $focusPath

$unnamedFocused=@($focusPath|Where-Object{[string]::IsNullOrWhiteSpace($_.name)-and[string]::IsNullOrWhiteSpace($_.automationId)})
Add-Check 'INT-006' 'Focused controls expose identity' ($unnamedFocused.Count-eq 0) "anonymousFocusedTargets=$($unnamedFocused.Count)" $unnamedFocused

[System.Windows.Forms.SendKeys]::SendWait('+{TAB}');Start-Sleep -Milliseconds 120
$backFocus=$null;try{$bf=[System.Windows.Automation.AutomationElement]::FocusedElement;if($bf){$backFocus=@{name=[string]$bf.Current.Name;automationId=[string]$bf.Current.AutomationId;type=($bf.Current.ControlType.ProgrammaticName-replace '^ControlType\.','')}}}catch{}
Add-Check 'INT-007' 'Shift+Tab reverse traversal works' ($null-ne $backFocus) ($(if($backFocus){"type=$($backFocus.type) name=$($backFocus.name)"}else{'no focus'})) $backFocus

$pass=@($checks|Where-Object{$_.pass}).Count;$score=[int][Math]::Round(($pass*100.0)/[Math]::Max(1,$checks.Count));$verdict=if($score-eq 100){'PASS'}else{'FAIL'}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Interaction Audit';candidate='V5.4.0 MONOLITH AURORA UX';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;pid=$p.Id;score=$score;passCount=$pass;totalChecks=$checks.Count;verdict=$verdict;checks=$checks}
$out=Join-Path $OutputDirectory ("uiux10-interaction-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8;$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Interaction score: $score/100";Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";if($verdict-ne'PASS'){exit 2};exit 0
