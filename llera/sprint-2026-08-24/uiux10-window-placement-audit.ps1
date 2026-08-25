[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [int]$SettleMs=700,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){ throw 'Physical Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraPlacementNative {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT r);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
}
'@
function Rect($h){ $r=New-Object LLeraPlacementNative+RECT; if(-not[LLeraPlacementNative]::GetWindowRect($h,[ref]$r)){throw 'GetWindowRect failed'}; @{x=$r.Left;y=$r.Top;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top;right=$r.Right;bottom=$r.Bottom} }
function Capture([System.Drawing.Rectangle]$b,[string]$name){ $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); try{$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size)}finally{$g.Dispose()}; $p=Join-Path $OutputDirectory $name; $bmp.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); @{path=$p;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()} }
$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1)
if($p.Count-ne1){throw 'Exactly one visible LLera main window is required.'}
$proc=$p[0]; $h=$proc.MainWindowHandle; $screen=[System.Windows.Forms.Screen]::FromHandle($h); $wa=$screen.WorkingArea
$original=Rect $h; $dpi=[LLeraPlacementNative]::GetDpiForWindow($h); $failures=@(); $warnings=@(); $cases=@(); $shots=New-Object System.Collections.Generic.HashSet[string]
$placements=@(
 @{name='left-half';x=$wa.X;y=$wa.Y;w=[int][Math]::Floor($wa.Width/2);h=$wa.Height},
 @{name='right-half';x=$wa.X+[int][Math]::Floor($wa.Width/2);y=$wa.Y;w=$wa.Width-[int][Math]::Floor($wa.Width/2);h=$wa.Height},
 @{name='workarea-max';x=$wa.X;y=$wa.Y;w=$wa.Width;h=$wa.Height}
)
try{
 foreach($c in $placements){
   if(-not[LLeraPlacementNative]::SetWindowPos($h,[IntPtr]::Zero,$c.x,$c.y,$c.w,$c.h,0x0014)){ $failures+="SetWindowPos failed: $($c.name)"; continue }
   Start-Sleep -Milliseconds $SettleMs; $proc.Refresh(); $r=Rect $h
   $visible=[LLeraPlacementNative]::IsWindowVisible($h); $hung=[LLeraPlacementNative]::IsHungAppWindow($h); $responsive=$proc.Responding
   $inside=($r.x-ge$wa.X -and $r.y-ge$wa.Y -and $r.right-le($wa.X+$wa.Width) -and $r.bottom-le($wa.Y+$wa.Height))
   $curDpi=[LLeraPlacementNative]::GetDpiForWindow($h)
   if(-not$visible){$failures+="Window invisible: $($c.name)"}; if($hung-or-not$responsive){$failures+="Window unresponsive: $($c.name)"}; if(-not$inside){$failures+="Window escapes taskbar work area: $($c.name)"}; if($curDpi-ne$dpi){$warnings+="DPI changed unexpectedly on same monitor: $($c.name)"}
   $cap=Capture (New-Object System.Drawing.Rectangle($r.x,$r.y,$r.width,$r.height)) ("uiux10-placement-{0}-{1}.png" -f $c.name,(Get-Date -Format 'yyyyMMdd-HHmmssfff')); [void]$shots.Add($cap.sha256)
   $cases+=@{name=$c.name;requested=@{x=$c.x;y=$c.y;width=$c.w;height=$c.h};actual=$r;visible=$visible;responsive=$responsive;hung=$hung;insideWorkingArea=$inside;dpi=[int]$curDpi;screenshot=$cap}
 }
} finally { [void][LLeraPlacementNative]::SetWindowPos($h,[IntPtr]::Zero,$original.x,$original.y,$original.width,$original.height,0x0014) }
if($cases.Count-ne3){$failures+='All three placement cases were not captured.'}; if($shots.Count-ne3){$failures+='Placement proof requires three distinct screenshot hashes.'}
$score=[Math]::Max(0,100-($failures.Count*25)-($warnings.Count*5)); $verdict=if($score-eq100 -and $failures.Count-eq0 -and $warnings.Count-eq0){'PASS'}else{'FAIL'}
$result=[ordered]@{schema=1;product='LLera UIUX 10/10 Windows Placement Audit';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;process=@{pid=$proc.Id;path=$proc.Path;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $proc.Path).Hash.ToLowerInvariant()};monitor=@{device=$screen.DeviceName;workingArea=@{x=$wa.X;y=$wa.Y;width=$wa.Width;height=$wa.Height};dpi=[int]$dpi};score=$score;verdict=$verdict;cases=$cases;failures=$failures;warnings=$warnings;policy=@{requireLeftHalf=$true;requireRightHalf=$true;requireWorkAreaMax=$true;requireInsideTaskbarWorkArea=$true;requireResponsive=$true;requireDpiStableOnSameMonitor=$true;requireDistinctScreenshots=$true;allowWarnings=$false}}
$out=Join-Path $OutputDirectory ("uiux10-window-placement-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss')); $result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8; $sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant(); "$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "UIUX placement evidence: $out"; Write-Host "Score: $score/100 Verdict: $verdict"; if($verdict-ne'PASS'){exit 2}; exit 0
