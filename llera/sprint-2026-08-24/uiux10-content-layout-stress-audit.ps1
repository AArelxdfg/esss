[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$ExpectedCandidate='V5.4.0 MONOLITH AURORA UX',
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform-ne[PlatformID]::Win32NT){throw 'Physical Windows required.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null

function Fail([string]$m){throw $m}
function Get-Root {
  $p=Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1
  if(-not$p){Fail "Running $ProcessName window not found."}
  if(-not$p.Responding){Fail "$ProcessName is not responding."}
  $root=[System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
  if(-not$root){Fail 'UI Automation root unavailable.'}
  return @($p,$root)
}
function Get-Composer($root){
  $cond=New-Object System.Windows.Automation.OrCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Document))
  )
  $els=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
  $candidates=@()
  foreach($e in $els){
    try{
      if($e.Current.IsOffscreen){continue}
      $r=$e.Current.BoundingRectangle
      if($r.Width-lt160-or$r.Height-lt24){continue}
      $vp=$null
      if($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){
        $candidates+=[pscustomobject]@{Element=$e;Rect=$r;ValuePattern=$vp;Y=$r.Y}
      }
    }catch{}
  }
  if(-not$candidates){Fail 'No visible editable composer with ValuePattern found.'}
  return ($candidates|Sort-Object Y -Descending|Select-Object -First 1)
}
function Capture-Window($root,[string]$name){
  $r=$root.Current.BoundingRectangle
  if($r.Width-lt32-or$r.Height-lt32){Fail 'Invalid root bounds for screenshot.'}
  $bmp=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  try{$g.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bmp.Size)}finally{$g.Dispose()}
  $path=Join-Path $OutputDirectory ("uiux10-content-$name-{0}.png"-f(Get-Date -Format 'yyyyMMdd-HHmmssfff'))
  try{$bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$bmp.Dispose()}
  return [ordered]@{path=$path;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $path).Length}
}
function Inspect-Layout($root,$composer){
  $rootRect=$root.Current.BoundingRectangle
  $focusCond=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty,$true)
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$focusCond)
  $nameless=0;$offscreen=0;$clipped=0;$visible=0
  foreach($e in $all){
    try{
      if($e.Current.IsOffscreen){$offscreen++;continue}
      $visible++
      if([string]::IsNullOrWhiteSpace([string]$e.Current.Name)){$nameless++}
      $b=$e.Current.BoundingRectangle
      if($b.Width-gt0-and$b.Height-gt0){
        if($b.Left-lt($rootRect.Left-2)-or$b.Top-lt($rootRect.Top-2)-or$b.Right-gt($rootRect.Right+2)-or$b.Bottom-gt($rootRect.Bottom+2)){$clipped++}
      }
    }catch{}
  }
  $cr=$composer.Element.Current.BoundingRectangle
  [ordered]@{
    visibleFocusable=$visible;namelessFocusable=$nameless;offscreenFocusable=$offscreen;clippedFocusable=$clipped
    composer=[ordered]@{x=[math]::Round($cr.X,1);y=[math]::Round($cr.Y,1);width=[math]::Round($cr.Width,1);height=[math]::Round($cr.Height,1);offscreen=$composer.Element.Current.IsOffscreen}
    root=[ordered]@{width=[math]::Round($rootRect.Width,1);height=[math]::Round($rootRect.Height,1)}
  }
}

$pair=Get-Root;$proc=$pair[0];$root=$pair[1]
$composer=Get-Composer $root
$original=[string]$composer.ValuePattern.Current.Value
$dpi=96
try{
  Add-Type @'
using System; using System.Runtime.InteropServices;
public static class LLeraContentDpi { [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd); }
'@
  $dpi=[int][LLeraContentDpi]::GetDpiForWindow($proc.MainWindowHandle)
}catch{}
$minTargetPx=[math]::Ceiling(44*($dpi/96.0))
$tests=@(
  [ordered]@{name='turkish-unicode';text=(('İstanbul — ğüşiöç ĞÜŞİÖÇ ₺ ✓ → “LLera” ')*96)},
  [ordered]@{name='unbroken-token';text=('A'*8192)},
  [ordered]@{name='mixed-code-url';text=(("https://example.invalid/"+('segment/'*30)+"?q=İstanbul%20LLera`r`n```powershell`r`nGet-Process | Where-Object { `$_.Responding }`r`n``` `r`n")*40)}
)
$cases=@();$failures=@();$warnings=@()
try{
  foreach($t in $tests){
    $composer.ValuePattern.SetValue([string]$t.text)
    Start-Sleep -Milliseconds 450
    $pair2=Get-Root;$proc=$pair2[0];$root=$pair2[1];$composer=Get-Composer $root
    $roundTrip=[string]$composer.ValuePattern.Current.Value
    $layout=Inspect-Layout $root $composer
    $shot=Capture-Window $root $t.name
    $caseFailures=@()
    if($roundTrip-ne[string]$t.text){$caseFailures+='composer value round-trip mismatch'}
    if(-not$proc.Responding){$caseFailures+='process not responding'}
    if($layout.composer.offscreen){$caseFailures+='composer offscreen'}
    if([double]$layout.composer.height-lt$minTargetPx){$caseFailures+="composer below 44-DIP minimum ($minTargetPx px)"}
    if([double]$layout.composer.height-gt([double]$layout.root.height*0.55)){$caseFailures+='composer consumes >55% of window height'}
    if([int]$layout.namelessFocusable-ne0){$caseFailures+='nameless visible focusable controls'}
    if([int]$layout.clippedFocusable-ne0){$caseFailures+='focusable controls clipped outside window'}
    if($shot.sha256-notmatch'^[0-9a-f]{64}$'-or$shot.bytes-lt1024){$caseFailures+='invalid screenshot evidence'}
    $cases+=[ordered]@{case=$t.name;chars=([string]$t.text).Length;roundTrip=$roundTrip-eq[string]$t.text;responding=$proc.Responding;layout=$layout;screenshot=$shot;failures=$caseFailures;pass=$caseFailures.Count-eq0}
    $failures+=@($caseFailures|ForEach-Object{"$($t.name): $_"})
  }
}finally{
  try{$pair3=Get-Root;$root=$pair3[1];$composer=Get-Composer $root;$composer.ValuePattern.SetValue($original);Start-Sleep -Milliseconds 250;if([string]$composer.ValuePattern.Current.Value-ne$original){$failures+='original composer content was not restored'}}catch{$failures+="composer restore failed: $($_.Exception.Message)"}
}
$exe=$proc.Path;$exeSha=if($exe-and(Test-Path -LiteralPath $exe)){(Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash.ToLowerInvariant()}else{$null}
$score=if($failures.Count-eq0-and$warnings.Count-eq0){100}else{[math]::Max(0,100-([math]::Min(100,$failures.Count*12+$warnings.Count*4)))}
$result=[ordered]@{
 schema=1;product='LLera UIUX 10/10 Content Layout Stress Audit';candidate=$ExpectedCandidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME
 process=[ordered]@{pid=$proc.Id;responding=$proc.Responding;executablePath=$exe;executableSha256=$exeSha};dpi=$dpi;minimum44DipPx=$minTargetPx
 policy=[ordered]@{noSend=$true;restoreComposer=$true;requireExactValueRoundTrip=$true;requireZeroClippedFocusable=$true;requireZeroNamelessVisibleFocusable=$true;requireRealScreenshotHashes=$true;allowWarnings=$false}
 cases=$cases;failureCount=$failures.Count;warningCount=$warnings.Count;failures=$failures;warnings=$warnings;score=$score;verdict=if($score-eq100){'PASS'}else{'FAIL'}
}
$out=Join-Path $OutputDirectory ("uiux10-content-layout-stress-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Content layout evidence: $out";Write-Host "Score: $score/100";Write-Host "SHA-256: $sha"
if($score-ne100){exit 2};exit 0
