[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [int]$SettleMs=900,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){throw 'Physical Windows required.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraPMDpi {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT r);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
function Sha([string]$p){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()}
function RectOf([IntPtr]$h){$r=New-Object LLeraPMDpi+RECT;[void][LLeraPMDpi]::GetWindowRect($h,[ref]$r);return $r}
function Capture([IntPtr]$h,[string]$name){$r=RectOf $h;$w=$r.Right-$r.Left;$hh=$r.Bottom-$r.Top;if($w-le0-or$hh-le0){throw 'Invalid LLera window bounds.'};$bmp=New-Object Drawing.Bitmap($w,$hh);$g=[Drawing.Graphics]::FromImage($bmp);try{$g.CopyFromScreen($r.Left,$r.Top,0,0,(New-Object Drawing.Size($w,$hh)))}finally{$g.Dispose()};$p=Join-Path $OutputDirectory $name;$bmp.Save($p,[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();return @{path=$p;sha256=Sha $p;width=$w;height=$hh}}
function Inspect([IntPtr]$h,[System.Windows.Forms.Screen]$screen,[int]$index){
 Start-Sleep -Milliseconds $SettleMs
 $p=Get-Process -Id $script:proc.Id -ErrorAction Stop
 $r=RectOf $h;$dpi=[int][LLeraPMDpi]::GetDpiForWindow($h);$wa=$screen.WorkingArea
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($h)
 $focusable=@();$unnamed=@();$offscreen=@();$clipped=@()
 if($root){$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition);foreach($e in $all){try{$b=$e.Current.BoundingRectangle;if($e.Current.IsKeyboardFocusable -and $e.Current.IsEnabled){$focusable+=$e;if([string]::IsNullOrWhiteSpace($e.Current.Name)){$unnamed+=$e};if($e.Current.IsOffscreen){$offscreen+=$e};if($b.Width-gt0-and$b.Height-gt0-and($b.Left-lt$r.Left-1-or$b.Top-lt$r.Top-1-or$b.Right-gt$r.Right+1-or$b.Bottom-gt$r.Bottom+1)){$clipped+=$e}}}catch{}}}
 $inside=($r.Left-ge$wa.Left-and$r.Top-ge$wa.Top-and$r.Right-le$wa.Right-and$r.Bottom-le$wa.Bottom)
 $shot=Capture $h ("uiux10-pmdpi-monitor{0}-{1}.png"-f$index,(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
 return [ordered]@{monitorIndex=$index;device=$screen.DeviceName;primary=$screen.Primary;dpi=$dpi;scalePercent=[math]::Round($dpi/96.0*100,1);window=@{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top};workingArea=@{left=$wa.Left;top=$wa.Top;right=$wa.Right;bottom=$wa.Bottom;width=$wa.Width;height=$wa.Height};insideWorkingArea=$inside;responding=$p.Responding;hung=[LLeraPMDpi]::IsHungAppWindow($h);uiaRoot=($null-ne$root);focusableCount=@($focusable).Count;unnamedFocusableCount=@($unnamed).Count;offscreenFocusableCount=@($offscreen).Count;clippedFocusableCount=@($clipped).Count;screenshot=$shot}
}
$script:proc=Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1
if(-not$script:proc){throw 'Running LLera window not found.'}
$h=[IntPtr]$script:proc.MainWindowHandle
$screens=@([System.Windows.Forms.Screen]::AllScreens)
$failures=@();$warnings=@();$samples=@()
if($screens.Count-lt2){$failures+='At least two physical Windows displays are required for per-monitor DPI transition proof.'}
$orig=RectOf $h
try{
 for($i=0;$i-lt$screens.Count;$i++){
  $s=$screens[$i];$wa=$s.WorkingArea;$w=[math]::Min([math]::Max(900,[int]($wa.Width*0.72)),$wa.Width);$hh=[math]::Min([math]::Max(620,[int]($wa.Height*0.78)),$wa.Height);$x=$wa.Left+[int](($wa.Width-$w)/2);$y=$wa.Top+[int](($wa.Height-$hh)/2)
  if(-[LLeraPMDpi]::SetWindowPos($h,[IntPtr]::Zero,$x,$y,$w,$hh,0x0010)){throw "SetWindowPos failed for monitor $i"};[void][LLeraPMDpi]::SetForegroundWindow($h)
  $sample=Inspect $h $s $i;$samples+=$sample
  if(-$sample.responding-or$sample.hung){$failures+="Monitor $i: LLera is hung/unresponsive."};if(-$sample.insideWorkingArea){$failures+="Monitor $i: window escaped working area."};if(-$sample.uiaRoot){$failures+="Monitor $i: UI Automation root unavailable."};if($sample.focusableCount-lt1){$failures+="Monitor $i: no keyboard-focusable controls."};if($sample.unnamedFocusableCount-ne0){$failures+="Monitor $i: unnamed focusable controls detected."};if($sample.offscreenFocusableCount-ne0){$failures+="Monitor $i: off-screen focusable controls detected."};if($sample.clippedFocusableCount-ne0){$failures+="Monitor $i: clipped focusable controls detected."};if($sample.screenshot.sha256-notmatch'^[0-9a-f]{64}$'){$failures+="Monitor $i: screenshot hash missing."}
 }
 if($samples.Count-ge2){$distinctDpi=@($samples|ForEach-Object{$_.dpi}|Sort-Object -Unique);if($distinctDpi.Count-lt2){$warnings+='Connected displays expose the same effective DPI; cross-monitor migration was exercised, but a real DPI-change transition was not observed.'}}
}finally{[void][LLeraPMDpi]::SetWindowPos($h,[IntPtr]::Zero,$orig.Left,$orig.Top,$orig.Right-$orig.Left,$orig.Bottom-$orig.Top,0x0010)}
$score=100-([math]::Min(100,$failures.Count*20+$warnings.Count*5));$verdict=if($failures.Count-eq0-and$warnings.Count-eq0-and$score-eq100){'PASS'}else{'FAIL'}
$result=[ordered]@{schema=1;product='LLera UIUX 10/10 Per-Monitor DPI Audit';candidate=$ExpectedCandidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;process=@{pid=$script:proc.Id;path=$script:proc.Path;executableSha256=if($script:proc.Path){Sha $script:proc.Path}else{$null}};monitorCount=$screens.Count;samples=$samples;failureCount=$failures.Count;warningCount=$warnings.Count;failures=$failures;warnings=$warnings;score=$score;verdict=$verdict;policy=@{physicalWindowsOnly=$true;requireAtLeastTwoDisplays=$true;requireDistinctEffectiveDpi=$true;requireResponsive=$true;requireUia=$true;requireNoClipping=$true;requireNoUnnamedFocusable=$true;requireNoOffscreenFocusable=$true;requireScreenshotSha256=$true;allowWarnings=$false}}
$out=Join-Path $OutputDirectory("uiux10-multimonitor-dpi-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8;$hash=Sha $out;"$hash  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$result|ConvertTo-Json -Depth 10
if($verdict-ne'PASS'){exit 2};exit 0
