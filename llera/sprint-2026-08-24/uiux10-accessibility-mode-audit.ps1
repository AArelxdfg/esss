[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [Parameter(Mandatory)][ValidateSet('HighContrast','ReducedMotion')][string]$Mode,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraA11yWin32 {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT r);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SystemParametersInfo(uint action,uint param,out bool value,uint flags);
}
'@
$checks=[System.Collections.Generic.List[object]]::new()
function Add-Check([string]$id,[string]$name,[bool]$pass,[string]$detail,$evidence=$null){$checks.Add([pscustomobject]@{id=$id;name=$name;pass=$pass;detail=$detail;evidence=$evidence})}
$procs=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne 0})
if($procs.Count-ne 1){Add-Check 'A11Y-001' 'Exactly one LLera window' $false "count=$($procs.Count)"; $p=$null}else{$p=$procs[0];Add-Check 'A11Y-001' 'Exactly one LLera window' $true "pid=$($p.Id)"}
$highContrast=[System.Windows.Forms.SystemInformation]::HighContrast
$animations=$true; [void][LLeraA11yWin32]::SystemParametersInfo(0x1042,0,[ref]$animations,0)
$modeActive=if($Mode-eq'HighContrast'){$highContrast}else{-not $animations}
Add-Check 'A11Y-002' 'Requested Windows accessibility mode is physically active' $modeActive "mode=$Mode highContrast=$highContrast clientAreaAnimations=$animations" @{highContrast=$highContrast;clientAreaAnimations=$animations}
if($p){
 Add-Check 'A11Y-003' 'LLera remains responsive' ([bool]$p.Responding) "responding=$($p.Responding)"
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
 $all=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition))
 Add-Check 'A11Y-004' 'UI Automation tree remains exposed' ($all.Count-ge 8) "descendants=$($all.Count)"
 $records=@(); foreach($el in $all){try{$ct=$el.Current.ControlType.ProgrammaticName-replace'^ControlType\.','';$records+=[pscustomobject]@{name=[string]$el.Current.Name;type=$ct;enabled=[bool]$el.Current.IsEnabled;offscreen=[bool]$el.Current.IsOffscreen;focusable=[bool]$el.Current.IsKeyboardFocusable}}catch{}}
 $actionTypes=@('Button','CheckBox','RadioButton','ComboBox','Hyperlink','TabItem','MenuItem','Edit')
 $actions=@($records|Where-Object{$_.type-in$actionTypes-and$_.enabled-and-not$_.offscreen})
 Add-Check 'A11Y-005' 'Visible actions remain discoverable' ($actions.Count-ge 5) "actions=$($actions.Count)"
 $unnamed=@($actions|Where-Object{[string]::IsNullOrWhiteSpace($_.name)})
 Add-Check 'A11Y-006' 'Visible actions retain accessible names' ($unnamed.Count-eq 0) "missingNames=$($unnamed.Count)" $unnamed
 $unfocus=@($actions|Where-Object{$_.type-ne'Hyperlink'-and-not$_.focusable})
 Add-Check 'A11Y-007' 'Visible actions remain keyboard focusable' ($unfocus.Count-eq 0) "unfocusable=$($unfocus.Count)" $unfocus
 $send=@($actions|Where-Object{$_.name-match'(?i)(send|gönder|stop|durdur|cancel|iptal)'})
 Add-Check 'A11Y-008' 'Primary send/stop semantics survive accessibility mode' ($send.Count-ge 1) "matches=$($send.Count)" $send
 $r=New-Object LLeraA11yWin32+RECT; [void][LLeraA11yWin32]::GetWindowRect($p.MainWindowHandle,[ref]$r)
 $w=[Math]::Max(1,$r.Right-$r.Left);$h=[Math]::Max(1,$r.Bottom-$r.Top);$png=Join-Path $OutputDirectory ("uiux10-a11y-$Mode-{0}.png"-f(Get-Date-Format'yyyyMMdd-HHmmss'))
 $shot=$false;$shotSha=$null;try{$bmp=New-Object System.Drawing.Bitmap($w,$h);$g=[System.Drawing.Graphics]::FromImage($bmp);try{$g.CopyFromScreen($r.Left,$r.Top,0,0,$bmp.Size);$bmp.Save($png,[System.Drawing.Imaging.ImageFormat]::Png);$shot=$true}finally{$g.Dispose();$bmp.Dispose()};if($shot){$shotSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $png).Hash.ToLowerInvariant()}}catch{}
 Add-Check 'A11Y-009' 'Accessibility-mode screenshot captured' $shot (if($shot){"sha256=$shotSha"}else{'capture failed'}) @{path=$png;sha256=$shotSha}
}
$pass=@($checks|Where-Object{$_.pass}).Count;$total=$checks.Count;$score=[int][Math]::Round($pass*100.0/[Math]::Max(1,$total));$verdict=if($score-eq100){'PASS'}else{'FAIL'}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Accessibility Mode Audit';candidate='V5.4.0 MONOLITH AURORA UX';mode=$Mode;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;score=$score;passCount=$pass;totalChecks=$total;verdict=$verdict;checks=$checks}
$out=Join-Path $OutputDirectory ("uiux10-a11y-$Mode-{0}.json"-f(Get-Date-Format'yyyyMMdd-HHmmss'));$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8;$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Accessibility mode score: $score/100";Write-Host "Evidence: $out";if($verdict-ne'PASS'){exit 2};exit 0
