[CmdletBinding()]
param(
    [string]$ProcessName = 'LLera',
    [Parameter(Mandatory)][ValidateSet('1366x768@125','1920x1080@150','2560x1440@200')][string]$MatrixCase,
    [int]$MinActionTargetDip = 44,
    [int]$MinEditorHeightDip = 44,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraUiUxWin32 {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

$matrix = @{
    '1366x768@125' = @{ width=1366; height=768; dpi=120; scale=125 }
    '1920x1080@150' = @{ width=1920; height=1080; dpi=144; scale=150 }
    '2560x1440@200' = @{ width=2560; height=1440; dpi=192; scale=200 }
}
$expected = $matrix[$MatrixCase]

$checks = [System.Collections.Generic.List[object]]::new()
$warnings = [System.Collections.Generic.List[object]]::new()
function Add-Check {
    param([string]$Id,[string]$Name,[bool]$Pass,[string]$Detail,$Evidence=$null)
    $checks.Add([pscustomobject]@{id=$Id;name=$Name;pass=$Pass;detail=$Detail;evidence=$Evidence})
    $p = if ($Pass) {'PASS'} else {'FAIL'}
    Write-Host "[$p] $Id $Name - $Detail"
}

$procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($procs.Count -ne 1) {
    Add-Check 'UIX-001' 'Exactly one visible LLera shell' $false "count=$($procs.Count)" $null
    $report = [ordered]@{schema=2;product='LLera UIUX 10/10 Physical Audit';matrixCase=$MatrixCase;score=0;verdict='FAIL';capturedAt=(Get-Date).ToUniversalTime().ToString('o');warningCount=0;warnings=@();checks=$checks}
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $out=Join-Path $OutputDirectory "uiux10-$($MatrixCase.Replace('@','-'))-$stamp.json"
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $out -Encoding UTF8
    exit 2
}
$p = $procs[0]
Add-Check 'UIX-001' 'Exactly one visible LLera shell' $true "pid=$($p.Id)" @{pid=$p.Id;title=$p.MainWindowTitle}

$r = New-Object LLeraUiUxWin32+RECT
[void][LLeraUiUxWin32]::GetWindowRect($p.MainWindowHandle,[ref]$r)
$window = @{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top}
$dpi = [int][LLeraUiUxWin32]::GetDpiForWindow($p.MainWindowHandle)
$visible = [LLeraUiUxWin32]::IsWindowVisible($p.MainWindowHandle)
$hung = [LLeraUiUxWin32]::IsHungAppWindow($p.MainWindowHandle)
Add-Check 'UIX-002' 'Responsive visible window' ($visible -and -not $hung -and $p.Responding) "visible=$visible hung=$hung responding=$($p.Responding)" $window

$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$screenOk = ($primary.Bounds.Width -eq [int]$expected.width -and $primary.Bounds.Height -eq [int]$expected.height)
Add-Check 'UIX-003' 'Required physical viewport' $screenOk "actual=$($primary.Bounds.Width)x$($primary.Bounds.Height) expected=$($expected.width)x$($expected.height)" @{actual=@{width=$primary.Bounds.Width;height=$primary.Bounds.Height};expected=$expected}

$dpiOk = ($dpi -eq [int]$expected.dpi)
Add-Check 'UIX-004' 'Required Windows DPI scale' $dpiOk "actualDpi=$dpi expectedDpi=$($expected.dpi)" @{actualDpi=$dpi;expectedDpi=$expected.dpi;scalePercent=$expected.scale}

$wa=$primary.WorkingArea
$within = ($window.left -ge $wa.Left -and $window.top -ge $wa.Top -and $window.right -le $wa.Right -and $window.bottom -le $wa.Bottom)
Add-Check 'UIX-005' 'Window contained in working area' $within "window=$($window.width)x$($window.height) workingArea=$($wa.Width)x$($wa.Height)" @{window=$window;workingArea=@{left=$wa.Left;top=$wa.Top;right=$wa.Right;bottom=$wa.Bottom;width=$wa.Width;height=$wa.Height}}

# Capture a real pixel artifact for human review and tamper-evident evidence.
$screenshotPath = Join-Path $OutputDirectory ("uiux10-$($MatrixCase.Replace('@','-'))-{0}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$screenshotOk=$false; $screenshotSha=$null
try {
    $bmp = New-Object System.Drawing.Bitmap([Math]::Max(1,$window.width),[Math]::Max(1,$window.height))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($window.left,$window.top,0,0,$bmp.Size); $bmp.Save($screenshotPath,[System.Drawing.Imaging.ImageFormat]::Png); $screenshotOk=$true }
    finally { $g.Dispose(); $bmp.Dispose() }
    if ($screenshotOk) { $screenshotSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $screenshotPath).Hash.ToLowerInvariant() }
} catch { $screenshotOk=$false }
Add-Check 'UIX-006' 'Pixel screenshot evidence captured' $screenshotOk (if($screenshotOk){"sha256=$screenshotSha"}else{'capture failed'}) @{path=$screenshotPath;sha256=$screenshotSha}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
$all = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition))
Add-Check 'UIX-007' 'UI Automation tree exposed' ($all.Count -ge 8) "descendants=$($all.Count)" @{count=$all.Count}

$records = New-Object System.Collections.Generic.List[object]
foreach ($el in $all) {
    try {
        $ct = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.',''
        $rect = $el.Current.BoundingRectangle
        $records.Add([pscustomobject]@{
            name=[string]$el.Current.Name
            automationId=[string]$el.Current.AutomationId
            type=$ct
            enabled=[bool]$el.Current.IsEnabled
            offscreen=[bool]$el.Current.IsOffscreen
            keyboardFocusable=[bool]$el.Current.IsKeyboardFocusable
            hasKeyboardFocus=[bool]$el.Current.HasKeyboardFocus
            x=[double]$rect.X; y=[double]$rect.Y; width=[double]$rect.Width; height=[double]$rect.Height
        })
    } catch { }
}

$actionTypes=@('Button','CheckBox','RadioButton','ComboBox','Hyperlink','TabItem','MenuItem','Edit')
$actions=@($records | Where-Object { $_.type -in $actionTypes -and $_.enabled })
Add-Check 'UIX-008' 'Action controls discoverable' ($actions.Count -ge 5) "enabledActions=$($actions.Count)" @{count=$actions.Count}

$missingNames=@($actions | Where-Object { -not $_.offscreen -and [string]::IsNullOrWhiteSpace($_.name) })
Add-Check 'UIX-009' 'Accessible names on visible enabled actions' ($missingNames.Count -eq 0) "missing=$($missingNames.Count)" $missingNames

$focusViolations=@($actions | Where-Object { -not $_.offscreen -and $_.type -notin @('Hyperlink') -and -not $_.keyboardFocusable })
Add-Check 'UIX-010' 'Keyboard focusability on visible actions' ($focusViolations.Count -eq 0) "violations=$($focusViolations.Count)" $focusViolations

# UI Automation bounding rectangles are physical pixels. Enforce a constant 44-DIP target at every DPI,
# rather than allowing high-DPI modes to pass with physically smaller logical controls.
$effectiveDpi = if ($dpi -gt 0) { $dpi } else { [int]$expected.dpi }
$minActionTargetPx = [int][Math]::Ceiling($MinActionTargetDip * $effectiveDpi / 96.0)
$minEditorHeightPx = [int][Math]::Ceiling($MinEditorHeightDip * $effectiveDpi / 96.0)
$smallTargets=@($actions | Where-Object {
    -not $_.offscreen -and $_.type -in @('Button','CheckBox','RadioButton','ComboBox','TabItem','MenuItem') -and
    ($_.width -lt $minActionTargetPx -or $_.height -lt $minActionTargetPx)
})
Add-Check 'UIX-011' 'Minimum 44-DIP action target size' ($smallTargets.Count -eq 0) "violations=$($smallTargets.Count) threshold=${MinActionTargetDip}dip/${minActionTargetPx}px dpi=$effectiveDpi" $smallTargets

$editors=@($records | Where-Object { $_.type -eq 'Edit' -and $_.enabled -and -not $_.offscreen })
$editorHeightOk = ($editors.Count -ge 1 -and @($editors | Where-Object { $_.height -ge $minEditorHeightPx }).Count -ge 1)
Add-Check 'UIX-012' 'Usable 44-DIP composer/editor target' $editorHeightOk "visibleEditors=$($editors.Count) min=${MinEditorHeightDip}dip/${minEditorHeightPx}px" $editors

$sendStop=@($records | Where-Object { -not $_.offscreen -and $_.enabled -and $_.type -in @('Button','MenuItem') -and $_.name -match '(?i)(send|gönder|stop|durdur|iptal|cancel)' })
Add-Check 'UIX-013' 'Send/stop affordance exposed semantically' ($sendStop.Count -ge 1) "matches=$($sendStop.Count)" $sendStop

$nav=@($records | Where-Object { -not $_.offscreen -and $_.enabled -and $_.type -in @('Button','TabItem','MenuItem','Hyperlink') -and -not [string]::IsNullOrWhiteSpace($_.name) })
Add-Check 'UIX-014' 'Reachable named navigation/actions' ($nav.Count -ge 3) "namedVisibleNavigation=$($nav.Count)" @{sample=@($nav | Select-Object -First 12)}

$duplicateIds=@($records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.automationId) } | Group-Object automationId | Where-Object { $_.Count -gt 1 } | ForEach-Object { [pscustomobject]@{automationId=$_.Name;count=$_.Count} })
Add-Check 'UIX-015' 'Unique non-empty AutomationIds' ($duplicateIds.Count -eq 0) "duplicates=$($duplicateIds.Count)" $duplicateIds

# Visible actionable bounds must intersect the LLera window. This catches clipped controls without penalizing virtualized/offscreen content.
$clipped=@($actions | Where-Object {
    -not $_.offscreen -and ($_.width -le 0 -or $_.height -le 0 -or $_.x -lt ($window.left-1) -or $_.y -lt ($window.top-1) -or ($_.x+$_.width) -gt ($window.right+1) -or ($_.y+$_.height) -gt ($window.bottom+1))
})
Add-Check 'UIX-016' 'No clipped visible actionable controls' ($clipped.Count -eq 0) "violations=$($clipped.Count)" $clipped

# A strict 10/10 run is warning-free by definition. Keep a first-class warning channel so future soft
# diagnostics cannot silently coexist with a perfect score.
Add-Check 'UIX-017' 'No UI/UX audit warnings' ($warnings.Count -eq 0) "warnings=$($warnings.Count)" @($warnings)

$passCount=@($checks | Where-Object {$_.pass}).Count
$total=$checks.Count
$score=[int][Math]::Round(($passCount*100.0)/[Math]::Max(1,$total))
$verdict=if($score -eq 100 -and $warnings.Count -eq 0){'PASS'}else{'FAIL'}

$report=[ordered]@{
    schema=2
    product='LLera UIUX 10/10 Physical Audit'
    candidate='V5.4.0 MONOLITH AURORA UX'
    matrixCase=$MatrixCase
    expected=$expected
    capturedAt=(Get-Date).ToUniversalTime().ToString('o')
    host=@{computer=$env:COMPUTERNAME;os=[Environment]::OSVersion.VersionString;primaryScreen=@{width=$primary.Bounds.Width;height=$primary.Bounds.Height;workingWidth=$wa.Width;workingHeight=$wa.Height}}
    window=@{pid=$p.Id;title=$p.MainWindowTitle;dpi=$dpi;rect=$window;workingSetBytes=$p.WorkingSet64}
    thresholds=@{minActionTargetDip=$MinActionTargetDip;minActionTargetPx=$minActionTargetPx;minEditorHeightDip=$MinEditorHeightDip;minEditorHeightPx=$minEditorHeightPx;requiredScore=100}
    score=$score
    passCount=$passCount
    totalChecks=$total
    warningCount=$warnings.Count
    warnings=@($warnings)
    verdict=$verdict
    screenshot=@{path=$screenshotPath;sha256=$screenshotSha}
    checks=$checks
}

$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $OutputDirectory "uiux10-$($MatrixCase.Replace('@','-'))-$stamp.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
"$sha  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "UIUX score: $score/100"
Write-Host "Evidence: $out"
Write-Host "SHA-256: $sha"
if($verdict -ne 'PASS'){exit 2}
exit 0
