[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ExecutablePath,
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [int]$WindowTimeoutMs=15000,
  [int]$InteractiveTimeoutMs=20000,
  [int]$MaxVisibleWindowMs=5000,
  [int]$MaxInteractiveMs=8000,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){Fail 'Physical Windows required.'}
if(-not(Test-Path -LiteralPath $ExecutablePath -PathType Leaf)){Fail "Missing executable: $ExecutablePath"}
if(@(Get-Process -Name 'LLera' -ErrorAction SilentlyContinue).Count-ne0){Fail 'Cold-start audit requires no existing LLera process.'}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraColdStartWin32 {
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
}
'@
$exe=(Resolve-Path -LiteralPath $ExecutablePath).Path
$exeSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()
$sw=[Diagnostics.Stopwatch]::StartNew()
$p=Start-Process -FilePath $exe -PassThru
$visibleMs=$null;$interactiveMs=$null;$hwnd=[IntPtr]::Zero;$uia=$null;$focusable=0;$namedFocusable=0
try{
  while($sw.ElapsedMilliseconds-lt$WindowTimeoutMs){
    $p.Refresh();$hwnd=$p.MainWindowHandle
    if($hwnd-ne[IntPtr]::Zero-and[LLeraColdStartWin32]::IsWindowVisible($hwnd)){$visibleMs=[int]$sw.ElapsedMilliseconds;break}
    Start-Sleep -Milliseconds 50
  }
  if($null-eq$visibleMs){Fail "No visible LLera window within ${WindowTimeoutMs}ms."}
  while($sw.ElapsedMilliseconds-lt$InteractiveTimeoutMs){
    $p.Refresh()
    if($p.Responding-and-not[LLeraColdStartWin32]::IsHungAppWindow($hwnd)){
      try{
        $uia=[System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
        if($null-ne$uia){
          $all=$uia.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
          $f=@($all|Where-Object{$_.Current.IsKeyboardFocusable-and-not$_.Current.IsOffscreen})
          $focusable=$f.Count;$namedFocusable=@($f|Where-Object{-not[string]::IsNullOrWhiteSpace($_.Current.Name)}).Count
          if($focusable-ge2-and$namedFocusable-eq$focusable){$interactiveMs=[int]$sw.ElapsedMilliseconds;break}
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 75
  }
  if($null-eq$interactiveMs){Fail "LLera did not become UIA-interactive within ${InteractiveTimeoutMs}ms."}
  $p.Refresh();if(-not$p.Responding-or[LLeraColdStartWin32]::IsHungAppWindow($hwnd)){Fail 'LLera is not responsive at readiness point.'}
  $rect=$uia.Current.BoundingRectangle
  if($rect.Width-lt300-or$rect.Height-lt200){Fail 'Initial UIA window bounds are implausibly small.'}
  $bmp=New-Object Drawing.Bitmap([int]$rect.Width,[int]$rect.Height)
  $g=[Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bmp.Size)
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $png=Join-Path $OutputDirectory "uiux10-cold-start-$stamp.png";$bmp.Save($png,[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose()
  $pngSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $png).Hash.ToLowerInvariant()
  $pngBytes=(Get-Item -LiteralPath $png).Length
  if($pngBytes-lt4096){Fail 'Cold-start screenshot is suspiciously small/blank.'}
  $failures=@();$warnings=@()
  if($visibleMs-gt$MaxVisibleWindowMs){$failures+="Visible window ${visibleMs}ms > ${MaxVisibleWindowMs}ms"}
  if($interactiveMs-gt$MaxInteractiveMs){$failures+="Interactive readiness ${interactiveMs}ms > ${MaxInteractiveMs}ms"}
  if($focusable-lt2){$failures+='Fewer than two visible keyboard-focusable controls.'}
  if($namedFocusable-ne$focusable){$failures+='One or more visible focusable controls lack an accessible name.'}
  $score=100-($failures.Count*25)-($warnings.Count*5);if($score-lt0){$score=0}
  $report=[ordered]@{
    schema=1;product='LLera UIUX 10/10 Cold Start Audit';candidate=$ExpectedCandidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME
    executable=@{path=$exe;sha256=$exeSha;pid=$p.Id};timing=@{visibleWindowMs=$visibleMs;interactiveReadyMs=$interactiveMs;maxVisibleWindowMs=$MaxVisibleWindowMs;maxInteractiveMs=$MaxInteractiveMs}
    window=@{title=$p.MainWindowTitle;dpi=[LLeraColdStartWin32]::GetDpiForWindow($hwnd);responding=$p.Responding;hung=[LLeraColdStartWin32]::IsHungAppWindow($hwnd);width=[int]$rect.Width;height=[int]$rect.Height}
    automation=@{visibleFocusableCount=$focusable;namedVisibleFocusableCount=$namedFocusable};screenshot=@{path=$png;sha256=$pngSha;bytes=$pngBytes};failureCount=$failures.Count;warningCount=$warnings.Count;failures=$failures;warnings=$warnings;score=$score;verdict=if($score-eq100-and$failures.Count-eq0-and$warnings.Count-eq0){'PASS'}else{'FAIL'}
  }
  $out=Join-Path $OutputDirectory "uiux10-cold-start-$stamp.json";$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
  $sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
  $report|ConvertTo-Json -Depth 8
  if($report.verdict-ne'PASS'){exit 2};exit 0
}finally{
  if($p-and-not$p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue}
}
