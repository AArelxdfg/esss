[CmdletBinding()]
param(
    [string]$ProcessName = 'LLera',
    [int]$SettleMilliseconds = 350,
    [double]$MaxMeanRgbDelta = 20.0,
    [double]$MinClosePixelRatio = 0.90,
    [int]$SampleStep = 8,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraDualCaptureWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd,IntPtr hdcBlt,uint nFlags);
}
'@
function Sha([string]$p){(Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant()}
function Save-ScreenCapture([string]$path,[int]$x,[int]$y,[int]$w,[int]$h){
  $bmp=New-Object System.Drawing.Bitmap($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  try{$g.CopyFromScreen($x,$y,0,0,$bmp.Size,[System.Drawing.CopyPixelOperation]::SourceCopy);$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$g.Dispose();$bmp.Dispose()}
}
function Save-PrintWindow([string]$path,[IntPtr]$hwnd,[int]$w,[int]$h){
  $bmp=New-Object System.Drawing.Bitmap($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g=[System.Drawing.Graphics]::FromImage($bmp);$hdc=$g.GetHdc()
  try{$ok=[LLeraDualCaptureWin32]::PrintWindow($hwnd,$hdc,2)}finally{$g.ReleaseHdc($hdc);$g.Dispose()}
  try{if(-not $ok){throw 'PrintWindow returned false.'};$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$bmp.Dispose()}
}
function Compare-Images([string]$a,[string]$b,[int]$step){
  $ia=[System.Drawing.Bitmap]::FromFile($a);$ib=[System.Drawing.Bitmap]::FromFile($b)
  try{
    if($ia.Width-ne$ib.Width -or $ia.Height-ne$ib.Height){return @{samples=0;meanRgbDelta=999;closePixelRatio=0;widthMatch=$false}}
    [int64]$samples=0;[double]$sum=0;[int64]$close=0
    for($y=0;$y-lt$ia.Height;$y+=$step){for($x=0;$x-lt$ia.Width;$x+=$step){
      $pa=$ia.GetPixel($x,$y);$pb=$ib.GetPixel($x,$y)
      $d=([Math]::Abs([int]$pa.R-[int]$pb.R)+[Math]::Abs([int]$pa.G-[int]$pb.G)+[Math]::Abs([int]$pa.B-[int]$pb.B))/3.0
      $sum+=$d;$samples++;if($d-le25){$close++}
    }}
    return @{samples=$samples;meanRgbDelta=if($samples){[Math]::Round($sum/$samples,4)}else{999};closePixelRatio=if($samples){[Math]::Round($close/[double]$samples,6)}else{0};widthMatch=$true}
  }finally{$ia.Dispose();$ib.Dispose()}
}
$failures=New-Object System.Collections.Generic.List[string]
$warnings=New-Object System.Collections.Generic.List[string]
$procs=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0})
if($procs.Count-ne1){$failures.Add("Expected exactly one visible LLera shell; found $($procs.Count).")}
if($failures.Count){$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Dual Capture Audit';candidate='V5.4.0 MONOLITH AURORA UX';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;score=0;verdict='FAIL';failures=@($failures);warnings=@($warnings)};$out=Join-Path $OutputDirectory("uiux10-dual-capture-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$report|ConvertTo-Json -Depth 8|Set-Content $out -Encoding UTF8;exit 2}
$p=$procs[0];$hwnd=[IntPtr]$p.MainWindowHandle
$r=New-Object LLeraDualCaptureWin32+RECT;[void][LLeraDualCaptureWin32]::GetWindowRect($hwnd,[ref]$r)
$w=$r.Right-$r.Left;$h=$r.Bottom-$r.Top
if($w-lt320 -or $h-lt240){$failures.Add("Window bounds are implausible: ${w}x${h}.")}
if(-not[LLeraDualCaptureWin32]::IsWindowVisible($hwnd)){$failures.Add('LLera window is not visible.')}
if([LLeraDualCaptureWin32]::IsHungAppWindow($hwnd) -or -not $p.Responding){$failures.Add('LLera window is hung/not responding.')}
[void][LLeraDualCaptureWin32]::SetForegroundWindow($hwnd);Start-Sleep -Milliseconds $SettleMilliseconds
$foreground=[LLeraDualCaptureWin32]::GetForegroundWindow()
if($foreground-ne$hwnd){$failures.Add("LLera did not own the foreground window during capture. expected=$hwnd actual=$foreground")}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff';$screenPath=Join-Path $OutputDirectory "uiux10-screen-$stamp.png";$printPath=Join-Path $OutputDirectory "uiux10-printwindow-$stamp.png"
try{Save-ScreenCapture $screenPath $r.Left $r.Top $w $h}catch{$failures.Add("CopyFromScreen failed: $($_.Exception.Message)")}
try{Save-PrintWindow $printPath $hwnd $w $h}catch{$failures.Add("PrintWindow failed: $($_.Exception.Message)")}
$similarity=$null
if((Test-Path $screenPath) -and (Test-Path $printPath)){
  $similarity=Compare-Images $screenPath $printPath ([Math]::Max(1,$SampleStep))
  if(-not $similarity.widthMatch){$failures.Add('Screen and PrintWindow capture dimensions differ.')}
  if([double]$similarity.meanRgbDelta-gt$MaxMeanRgbDelta){$failures.Add("Dual-capture mean RGB delta exceeds threshold: $($similarity.meanRgbDelta) > $MaxMeanRgbDelta")}
  if([double]$similarity.closePixelRatio-lt$MinClosePixelRatio){$failures.Add("Dual-capture close-pixel ratio below threshold: $($similarity.closePixelRatio) < $MinClosePixelRatio")}
}
$screenSha=if(Test-Path $screenPath){Sha $screenPath}else{$null};$printSha=if(Test-Path $printPath){Sha $printPath}else{$null}
if($screenSha-notmatch'^[0-9a-f]{64}$' -or $printSha-notmatch'^[0-9a-f]{64}$'){$failures.Add('Both physical capture SHA-256 values are required.')}
$score=if($failures.Count-eq0 -and $warnings.Count-eq0){100}else{0};$verdict=if($score-eq100){'PASS'}else{'FAIL'}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Dual Capture Audit';candidate='V5.4.0 MONOLITH AURORA UX';capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;process=@{pid=$p.Id;title=$p.MainWindowTitle;responding=$p.Responding;hwnd=$hwnd.ToInt64()};window=@{left=$r.Left;top=$r.Top;width=$w;height=$h};foregroundHwnd=$foreground.ToInt64();thresholds=@{maxMeanRgbDelta=$MaxMeanRgbDelta;minClosePixelRatio=$MinClosePixelRatio;sampleStep=$SampleStep};captures=@{screen=@{path=$screenPath;sha256=$screenSha};printWindow=@{path=$printPath;sha256=$printSha}};similarity=$similarity;failureCount=$failures.Count;warningCount=$warnings.Count;failures=@($failures);warnings=@($warnings);score=$score;verdict=$verdict}
$out=Join-Path $OutputDirectory("uiux10-dual-capture-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'));$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8;$sha=Sha $out;"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Dual capture score: $score/100";Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";if($verdict-ne'PASS'){exit 2};exit 0
