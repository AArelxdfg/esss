[CmdletBinding()]
param(
  [string]$ProcessName = 'LLera',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts'),
  [int]$MaxControls = 200
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraHitTestNative {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  public const uint GA_ROOT = 2;
}
'@

function Fail([System.Collections.Generic.List[string]]$list, [string]$msg) { [void]$list.Add($msg) }
function SafeName($el) { try { return [string]$el.Current.Name } catch { return '' } }
function RectObj($r) { [ordered]@{ x=[int]$r.X; y=[int]$r.Y; width=[int]$r.Width; height=[int]$r.Height } }
function SameOrDescendant([System.Windows.Automation.AutomationElement]$hit, [System.Windows.Automation.AutomationElement]$target) {
  if ($null -eq $hit -or $null -eq $target) { return $false }
  try {
    if ($hit.Current.NativeWindowHandle -eq $target.Current.NativeWindowHandle -and $hit.Current.NativeWindowHandle -ne 0) { return $true }
    $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
    $cur=$hit
    for($i=0;$i -lt 16 -and $null -ne $cur;$i++) {
      try {
        if ($cur.Current.RuntimeId -join ',' -eq $target.Current.RuntimeId -join ',') { return $true }
      } catch {}
      $cur=$walker.GetParent($cur)
    }
  } catch {}
  return $false
}

$proc = Get-Process -Name $ProcessName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $proc) { throw 'Running LLera window not found.' }
$root=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if ($null -eq $root) { throw 'UI Automation root unavailable.' }
$exePath=$proc.Path
$exeSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $exePath).Hash.ToLowerInvariant()

$cond=[System.Windows.Automation.Condition]::TrueCondition
$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$cond)
$failures=New-Object 'System.Collections.Generic.List[string]'
$warnings=New-Object 'System.Collections.Generic.List[string]'
$tested=New-Object System.Collections.ArrayList
$seen=0

for($i=0;$i -lt $all.Count -and $seen -lt $MaxControls;$i++) {
  $el=$all.Item($i)
  try {
    $c=$el.Current
    if ($c.IsOffscreen -or -not $c.IsEnabled) { continue }
    $focusable=$c.IsKeyboardFocusable
    $ct=[string]$c.ControlType.ProgrammaticName
    $interactive=$focusable -or $ct -match 'Button|Edit|ListItem|MenuItem|TabItem|CheckBox|RadioButton|ComboBox|Hyperlink|Slider|TreeItem'
    if (-not $interactive) { continue }
    $r=$c.BoundingRectangle
    if ($r.Width -le 1 -or $r.Height -le 1) { continue }
    $seen++
    $cx=[int][Math]::Floor($r.X + ($r.Width/2.0)); $cy=[int][Math]::Floor($r.Y + ($r.Height/2.0))
    [void][LLeraHitTestNative]::SetCursorPos($cx,$cy)
    Start-Sleep -Milliseconds 20
    $pt=New-Object System.Windows.Point($cx,$cy)
    $hit=[System.Windows.Automation.AutomationElement]::FromPoint($pt)
    $nativePt=New-Object LLeraHitTestNative+POINT; $nativePt.X=$cx; $nativePt.Y=$cy
    $hw=[LLeraHitTestNative]::WindowFromPoint($nativePt)
    $rootHw=[LLeraHitTestNative]::GetAncestor($hw,[LLeraHitTestNative]::GA_ROOT)
    $belongsNative=($rootHw -eq $proc.MainWindowHandle)
    $belongsUia=SameOrDescendant $hit $el
    $name=SafeName $el
    if (-not $belongsNative) { Fail $failures "Center point is occluded by another top-level window: '$name' at $cx,$cy" }
    if (-not $belongsUia) { Fail $failures "UIA center hit-test does not resolve to target/descendant: '$name' at $cx,$cy" }
    [void]$tested.Add([ordered]@{
      name=$name; controlType=$ct; automationId=[string]$c.AutomationId; focusable=$focusable
      rect=RectObj $r; center=@{x=$cx;y=$cy}; nativeOwned=$belongsNative; uiaHitTarget=$belongsUia
      hitName=if($hit){SafeName $hit}else{''}; hitControlType=if($hit){[string]$hit.Current.ControlType.ProgrammaticName}else{''}
    })
  } catch { Fail $warnings "Skipped control due to UIA race: $($_.Exception.Message)" }
}

if ($seen -lt 5) { Fail $failures "Too few visible interactive controls tested: $seen" }
if (-not $proc.Responding) { Fail $failures 'LLera became non-responsive during hit-test audit.' }
$score=[Math]::Max(0,100 - (20*$failures.Count) - (5*$warnings.Count))
$verdict=if($score -eq 100 -and $failures.Count -eq 0 -and $warnings.Count -eq 0){'PASS'}else{'FAIL'}
$report=[ordered]@{
  schema=1; product='LLera UIUX10 Physical Hit-Test Audit'; capturedAt=(Get-Date).ToUniversalTime().ToString('o')
  host=$env:COMPUTERNAME; process=@{pid=$proc.Id; exe=$exePath; exeSha256=$exeSha; responding=$proc.Responding}
  controlsTested=$seen; score=$score; verdict=$verdict; failures=@($failures); warnings=@($warnings); controls=@($tested)
  policy=@{
    activation='none'; note='Moves the physical cursor only; no click/invoke is performed.'
    pass='100/100, zero warnings/failures, all visible interactive control centers owned by the LLera top-level window and resolving via UI Automation to the target or its descendant.'
  }
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $OutputDirectory "uiux10-hit-test-$stamp.json"
$report | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "UI hit-test evidence: $out"
$report | ConvertTo-Json -Depth 9
if($verdict -ne 'PASS'){exit 2}
exit 0
