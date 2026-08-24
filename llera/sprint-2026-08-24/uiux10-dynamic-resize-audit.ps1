[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){throw 'Windows required.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraResizeWin32 {
 [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
}
'@
function Fail([string]$m){Write-Error $m;exit 2}
$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1)
if($p.Count-ne1){Fail 'A running LLera top-level window is required.'}
$p=$p[0];$hwnd=$p.MainWindowHandle
$root=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if($null-eq$root){Fail 'UI Automation root unavailable.'}
$cases=@(
 @{name='compact';w=1024;h=640},
 @{name='small';w=1180;h=720},
 @{name='baseline';w=1366;h=768},
 @{name='medium';w=1600;h=900},
 @{name='fullhd';w=1920;h=1080}
)
$rows=@();$failures=@();$warnings=@();$initialDpi=[LLeraResizeWin32]::GetDpiForWindow($hwnd)
foreach($c in $cases){
 if(-not[LLeraResizeWin32]::SetWindowPos($hwnd,[IntPtr]::Zero,20,20,$c.w,$c.h,0x0040)){Fail "SetWindowPos failed for $($c.name)."}
 Start-Sleep -Milliseconds 700
 $p.Refresh();$hung=[LLeraResizeWin32]::IsHungAppWindow($hwnd);$dpi=[LLeraResizeWin32]::GetDpiForWindow($hwnd)
 $desc=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
 $focusable=0;$offscreenFocusable=0;$namelessFocusable=0;$clipped=0
 $wr=$root.Current.BoundingRectangle
 for($i=0;$i-lt$desc.Count;$i++){
   $e=$desc.Item($i);$cur=$e.Current
   if($cur.IsKeyboardFocusable){$focusable++;if($cur.IsOffscreen){$offscreenFocusable++};if([string]::IsNullOrWhiteSpace($cur.Name)){$namelessFocusable++}}
   $r=$cur.BoundingRectangle
   if($r.Width-gt0-and$r.Height-gt0-and-not$cur.IsOffscreen){if($r.Left-lt$wr.Left-1-or$r.Top-lt$wr.Top-1-or$r.Right-gt$wr.Right+1-or$r.Bottom-gt$wr.Bottom+1){$clipped++}}
 }
 $pass=(-not$hung)-and$p.Responding-and($dpi-eq$initialDpi)-and($focusable-ge5)-and($offscreenFocusable-eq0)-and($namelessFocusable-eq0)-and($clipped-eq0)
 if(-not$pass){$failures+="$($c.name): responding=$($p.Responding) hung=$hung dpi=$dpi focusable=$focusable offscreenFocusable=$offscreenFocusable namelessFocusable=$namelessFocusable clipped=$clipped"}
 $rows+=[ordered]@{case=$c.name;width=$c.w;height=$c.h;responding=$p.Responding;hung=$hung;dpi=$dpi;focusable=$focusable;offscreenFocusable=$offscreenFocusable;namelessFocusable=$namelessFocusable;clippedVisibleElements=$clipped;pass=$pass}
}
$score=if($failures.Count-eq0-and$warnings.Count-eq0){100}else{0}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Dynamic Resize Audit';candidate=$ExpectedCandidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;processId=$p.Id;initialDpi=$initialDpi;cases=$rows;failureCount=$failures.Count;warningCount=$warnings.Count;failures=$failures;warnings=$warnings;score=$score;verdict=if($score-eq100){'PASS'}else{'FAIL'}}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-dynamic-resize-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'))
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Dynamic resize evidence: $out";Write-Host "SHA-256: $sha";if($score-ne100){exit 2};exit 0
