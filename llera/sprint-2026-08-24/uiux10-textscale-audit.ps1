[CmdletBinding()]
param(
    [string]$ProcessName = 'LLera',
    [ValidateSet(100,125,150,175,200,225)][int]$ExpectedTextScalePercent,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){ throw 'Physical Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Fail([string]$m){ throw $m }
function Sha([string]$p){ (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }

# Windows 11 text-size accessibility setting. Absence means 100%.
$textScale = 100
try {
    $v = Get-ItemPropertyValue -Path 'HKCU:\Software\Microsoft\Accessibility' -Name 'TextScaleFactor' -ErrorAction Stop
    if($null -ne $v){ $textScale = [int]$v }
} catch { $textScale = 100 }
if($PSBoundParameters.ContainsKey('ExpectedTextScalePercent') -and $textScale -ne $ExpectedTextScalePercent){
    Fail "Windows text scale is ${textScale}%, expected ${ExpectedTextScalePercent}%. Apply the requested Text size in Settings > Accessibility > Text size before collecting evidence."
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if(-not $proc){ Fail 'LLera must be running with a visible main window.' }
if(-not $proc.Responding){ Fail 'LLera is not responding.' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if(-not $root){ Fail 'UI Automation could not attach to the LLera window.' }
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$nodes = New-Object System.Collections.Generic.List[object]
$stack = New-Object System.Collections.Stack
$stack.Push($root)
while($stack.Count -gt 0){
    $n = [System.Windows.Automation.AutomationElement]$stack.Pop()
    $nodes.Add($n)
    $child = $walker.GetFirstChild($n)
    while($child){ $stack.Push($child); $child = $walker.GetNextSibling($child) }
}

$focusable = @($nodes | Where-Object { try { $_.Current.IsKeyboardFocusable -and -not $_.Current.IsOffscreen } catch { $false } })
$visible = @($nodes | Where-Object { try { -not $_.Current.IsOffscreen } catch { $false } })
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]
if($focusable.Count -lt 2){ $failures.Add('Fewer than two visible keyboard-focusable controls were exposed.') }

$unnamed = @($focusable | Where-Object { try { [string]::IsNullOrWhiteSpace($_.Current.Name) } catch { $true } })
if($unnamed.Count -gt 0){ $failures.Add("$($unnamed.Count) visible focusable control(s) have no accessible name.") }

# Detect controls whose reported rectangle is effectively clipped/collapsed after accessibility text scaling.
$collapsed = @()
foreach($n in $visible){
    try {
        $r=$n.Current.BoundingRectangle
        if(($r.Width -gt 0 -and $r.Width -lt 8) -or ($r.Height -gt 0 -and $r.Height -lt 8)){ $collapsed += $n }
    } catch {}
}
if($collapsed.Count -gt 0){ $failures.Add("$($collapsed.Count) visible element(s) collapsed below 8 physical pixels under text scaling.") }

# Critical edit/composer must remain visible and practically usable.
$edits = @($visible | Where-Object { try { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit } catch { $false } })
if($edits.Count -lt 1){ $failures.Add('No visible Edit control/composer was exposed at the active text scale.') }
else {
    $best = $edits | Sort-Object { try { -1 * $_.Current.BoundingRectangle.Height } catch { 0 } } | Select-Object -First 1
    try {
        $er=$best.Current.BoundingRectangle
        if($er.Height -lt 44){ $failures.Add("Composer height is only $([math]::Round($er.Height,1)) px under ${textScale}% text scale.") }
    } catch { $failures.Add('Composer bounding rectangle could not be read.') }
}

# Screenshot is mandatory physical evidence and is bound by hash.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$rect=$root.Current.BoundingRectangle
if($rect.Width -lt 100 -or $rect.Height -lt 100){ $failures.Add('LLera main window bounding rectangle is invalid for screenshot capture.') }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$shot=Join-Path $OutputDirectory "uiux10-textscale-${textScale}-$stamp.png"
if($failures.Count -eq 0){
    $bmp=New-Object System.Drawing.Bitmap([int][math]::Ceiling($rect.Width),[int][math]::Ceiling($rect.Height))
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen([int]$rect.Left,[int]$rect.Top,0,0,$bmp.Size); $bmp.Save($shot,[System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $g.Dispose(); $bmp.Dispose() }
}
$shotHash = if(Test-Path -LiteralPath $shot){ Sha $shot } else { $null }
if($shotHash -notmatch '^[0-9a-f]{64}$'){ $failures.Add('Physical screenshot SHA-256 evidence was not produced.') }

$score = [math]::Max(0,100 - (20*$failures.Count) - (5*$warnings.Count))
$verdict = if($score -eq 100 -and $failures.Count -eq 0 -and $warnings.Count -eq 0){'PASS'}else{'FAIL'}
$report=[ordered]@{
    schema=1
    product='LLera UIUX 10/10 Text Scale Audit'
    capturedAt=(Get-Date).ToUniversalTime().ToString('o')
    computer=$env:COMPUTERNAME
    process=@{pid=$proc.Id;path=$proc.Path;responding=$proc.Responding}
    windowsTextScalePercent=$textScale
    uiAutomation=@{visibleElements=$visible.Count;focusableElements=$focusable.Count;unnamedFocusable=$unnamed.Count;collapsedElements=$collapsed.Count;visibleEditors=$edits.Count}
    screenshot=@{path=$shot;sha256=$shotHash}
    failures=@($failures)
    warnings=@($warnings)
    score=$score
    verdict=$verdict
}
$out=Join-Path $OutputDirectory "uiux10-textscale-${textScale}-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
$hash=Sha $out
"$hash  $(Split-Path -Leaf $out)" | Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
$report | ConvertTo-Json -Depth 8
if($verdict -ne 'PASS'){ exit 2 }
exit 0
