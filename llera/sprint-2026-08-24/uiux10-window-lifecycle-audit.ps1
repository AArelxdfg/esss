[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [int]$Cycles=3,
  [int]$SettleMs=900,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraLifecycleWin32 {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int nCmdShow);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT r);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
function Snapshot([System.Diagnostics.Process]$p,[string]$State,[int]$Cycle){
  $r=New-Object LLeraLifecycleWin32+RECT;[void][LLeraLifecycleWin32]::GetWindowRect($p.MainWindowHandle,[ref]$r)
  $uiaCount=0;$uiaOk=$false
  try{$root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle);$uiaCount=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition).Count;$uiaOk=$uiaCount-ge8}catch{}
  [pscustomobject]@{cycle=$Cycle;state=$State;visible=[LLeraLifecycleWin32]::IsWindowVisible($p.MainWindowHandle);iconic=[LLeraLifecycleWin32]::IsIconic($p.MainWindowHandle);zoomed=[LLeraLifecycleWin32]::IsZoomed($p.MainWindowHandle);hung=[LLeraLifecycleWin32]::IsHungAppWindow($p.MainWindowHandle);responding=$p.Responding;dpi=[int][LLeraLifecycleWin32]::GetDpiForWindow($p.MainWindowHandle);rect=@{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top};uiaCount=$uiaCount;uiaOk=$uiaOk;handle=[long]$p.MainWindowHandle}
}
$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1)
if($p.Count-ne1){throw 'Exactly one running LLera window is required.'}
$p=$p[0];$initialHandle=[long]$p.MainWindowHandle;$initialDpi=[int][LLeraLifecycleWin32]::GetDpiForWindow($p.MainWindowHandle)
$steps=New-Object System.Collections.Generic.List[object]
for($i=1;$i-le$Cycles;$i++){
  [void][LLeraLifecycleWin32]::ShowWindow($p.MainWindowHandle,6);Start-Sleep -Milliseconds $SettleMs;$p.Refresh();$steps.Add((Snapshot $p 'minimized' $i))
  [void][LLeraLifecycleWin32]::ShowWindow($p.MainWindowHandle,9);[void][LLeraLifecycleWin32]::SetForegroundWindow($p.MainWindowHandle);Start-Sleep -Milliseconds $SettleMs;$p.Refresh();$steps.Add((Snapshot $p 'restored-after-minimize' $i))
  [void][LLeraLifecycleWin32]::ShowWindow($p.MainWindowHandle,3);Start-Sleep -Milliseconds $SettleMs;$p.Refresh();$steps.Add((Snapshot $p 'maximized' $i))
  [void][LLeraLifecycleWin32]::ShowWindow($p.MainWindowHandle,9);[void][LLeraLifecycleWin32]::SetForegroundWindow($p.MainWindowHandle);Start-Sleep -Milliseconds $SettleMs;$p.Refresh();$steps.Add((Snapshot $p 'restored-after-maximize' $i))
}
$visibleShells=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0})
$failures=New-Object System.Collections.Generic.List[string]
if($visibleShells.Count-ne1){$failures.Add("visible-shell-count=$($visibleShells.Count)")}
foreach($s in $steps){
 if($s.handle-ne$initialHandle){$failures.Add("window-handle-changed cycle=$($s.cycle) state=$($s.state)")}
 if($s.hung-or(-not$s.responding)){$failures.Add("unresponsive cycle=$($s.cycle) state=$($s.state)")}
 if($s.dpi-ne$initialDpi){$failures.Add("dpi-drift cycle=$($s.cycle) state=$($s.state) dpi=$($s.dpi) expected=$initialDpi")}
 if($s.state-eq'minimized'){if(-not$s.iconic){$failures.Add("minimize-not-observed cycle=$($s.cycle)")}}
 else{if($s.iconic-or(-not$s.visible)){$failures.Add("restore-visibility-failed cycle=$($s.cycle) state=$($s.state)")};if(-not$s.uiaOk){$failures.Add("uia-tree-lost cycle=$($s.cycle) state=$($s.state) count=$($s.uiaCount)")}}
 if($s.state-eq'maximized' -and -not$s.zoomed){$failures.Add("maximize-not-observed cycle=$($s.cycle)")}
}
$score=if($failures.Count-eq0){100}else{0};$verdict=if($score-eq100){'PASS'}else{'FAIL'}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Window Lifecycle Audit';candidate='V5.4.0 MONOLITH AURORA UX';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;processId=$p.Id;initialHandle=$initialHandle;initialDpi=$initialDpi;cycles=$Cycles;score=$score;verdict=$verdict;failureCount=$failures.Count;failures=@($failures);steps=@($steps)}
$out=Join-Path $OutputDirectory ("uiux10-window-lifecycle-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Window lifecycle UIUX score: $score/100";Write-Host "Evidence: $out";Write-Host "SHA-256: $sha"
if($verdict-ne'PASS'){exit 2};exit 0
