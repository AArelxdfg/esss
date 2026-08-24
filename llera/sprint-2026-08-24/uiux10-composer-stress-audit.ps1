[CmdletBinding()]
param(
  [string]$ProcessName='LLera',
  [string]$Candidate='V5.4.0 MONOLITH AURORA UX',
  [int]$LongTextChars=8192,
  [string]$OutputDirectory=(Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Physical Windows required.'}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Add-Check([System.Collections.ArrayList]$list,[string]$name,[bool]$pass,[string]$detail){
  [void]$list.Add([ordered]@{name=$name;pass=$pass;detail=$detail})
}
function Get-ValuePattern($el){
  $p=$null
  if($el -and $el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$p)){return [System.Windows.Automation.ValuePattern]$p}
  return $null
}

New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$checks=New-Object System.Collections.ArrayList
$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle-ne0}|Select-Object -First 1)
if($p.Count-ne1){throw 'A running LLera window is required.'}
$proc=$p[0]
$root=[System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if(-not $root){throw 'Unable to bind UI Automation to LLera window.'}
Add-Check $checks 'window-responsive' ([bool]$proc.Responding) "pid=$($proc.Id)"

$edits=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)|Where-Object{$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and -not $_.Current.IsOffscreen})
# Prefer the largest visible edit control: Electron textarea/contenteditable composer is normally the dominant edit surface.
$composer=$edits|Sort-Object @{Expression={($_.Current.BoundingRectangle.Width*$_.Current.BoundingRectangle.Height)};Descending=$true}|Select-Object -First 1
Add-Check $checks 'composer-found' ($null-ne$composer) "visibleEdits=$($edits.Count)"
if(-not $composer){throw 'No visible UIA Edit control found for composer.'}
$vp=Get-ValuePattern $composer
Add-Check $checks 'composer-value-pattern' ($null-ne$vp) 'ValuePattern is required for deterministic no-send stress testing.'
if(-not $vp){throw 'Composer does not expose UIA ValuePattern.'}

$original=$vp.Current.Value
$rootRect=$root.Current.BoundingRectangle
$cRect=$composer.Current.BoundingRectangle
$inside=($cRect.Left-ge$rootRect.Left -and $cRect.Top-ge$rootRect.Top -and $cRect.Right-le$rootRect.Right -and $cRect.Bottom-le$rootRect.Bottom)
Add-Check $checks 'composer-not-clipped' $inside ("composer={0},{1},{2},{3}; window={4},{5},{6},{7}" -f $cRect.Left,$cRect.Top,$cRect.Right,$cRect.Bottom,$rootRect.Left,$rootRect.Top,$rootRect.Right,$rootRect.Bottom)
Add-Check $checks 'composer-onscreen' (-not $composer.Current.IsOffscreen) "isOffscreen=$($composer.Current.IsOffscreen)"

$focusOk=$true
try{$composer.SetFocus();Start-Sleep -Milliseconds 120;$focusOk=[bool]$composer.Current.HasKeyboardFocus}catch{$focusOk=$false}
Add-Check $checks 'composer-keyboard-focus' $focusOk 'SetFocus must result in HasKeyboardFocus=true.'

$unicode="İstanbul; ğüşiöç ĞÜŞİÖÇ; Türkçe erişilebilirlik; satır-1`r`nsatır-2 — uzun içerik testi"
$unicodeOk=$false
try{$vp.SetValue($unicode);Start-Sleep -Milliseconds 120;$unicodeOk=($vp.Current.Value -ceq $unicode)}catch{}
Add-Check $checks 'turkish-unicode-roundtrip' $unicodeOk ("expectedChars=$($unicode.Length);actualChars=$($vp.Current.Value.Length)")

$seed="İstanbul ğüşiöç ĞÜŞİÖÇ | LLera uzun içerik | satır sonu`r`n"
$builder=New-Object System.Text.StringBuilder
while($builder.Length-lt$LongTextChars){[void]$builder.Append($seed)}
$long=$builder.ToString().Substring(0,$LongTextChars)
$longOk=$false
$latencyMs=0
try{
  $sw=[Diagnostics.Stopwatch]::StartNew();$vp.SetValue($long);$sw.Stop();$latencyMs=$sw.Elapsed.TotalMilliseconds
  Start-Sleep -Milliseconds 200
  $longOk=($vp.Current.Value.Length -eq $LongTextChars -and $vp.Current.Value.StartsWith('İstanbul'))
}catch{}
Add-Check $checks 'long-content-roundtrip' $longOk ("targetChars=$LongTextChars;actualChars=$($vp.Current.Value.Length);setValueMs=$([math]::Round($latencyMs,2))")

$proc.Refresh()
Add-Check $checks 'responsive-after-long-content' ([bool]$proc.Responding) "workingSetBytes=$($proc.WorkingSet64)"
$cRect2=$composer.Current.BoundingRectangle
$stableBounds=($cRect2.Width-gt0 -and $cRect2.Height-gt0 -and $cRect2.Left-ge$rootRect.Left -and $cRect2.Right-le$rootRect.Right -and $cRect2.Top-ge$rootRect.Top -and $cRect2.Bottom-le$rootRect.Bottom -and -not $composer.Current.IsOffscreen)
Add-Check $checks 'composer-bounds-stable-after-long-content' $stableBounds ("width=$([math]::Round($cRect2.Width,1));height=$([math]::Round($cRect2.Height,1));offscreen=$($composer.Current.IsOffscreen)")

$restoreOk=$false
try{$vp.SetValue($original);Start-Sleep -Milliseconds 100;$restoreOk=($vp.Current.Value -ceq $original)}catch{}
Add-Check $checks 'composer-content-restored' $restoreOk "originalChars=$($original.Length)"

$failures=@($checks|Where-Object{-not $_.pass})
$score=if($failures.Count-eq0){100}else{[math]::Max(0,100-10*$failures.Count)}
$report=[ordered]@{
  schema=1;product='LLera UIUX 10/10 Composer Stress Audit';candidate=$Candidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;processId=$proc.Id
  score=$score;verdict=if($score-eq100){'PASS'}else{'FAIL'};failureCount=$failures.Count;warningCount=0;longTextChars=$LongTextChars;checks=$checks
  policy=@{requiresPhysicalWindows=$true;doesNotSendMessage=$true;requireTurkishUnicodeExactRoundtrip=$true;minimumLongTextChars=8192;requireNoClipping=$true;requireKeyboardFocus=$true;requireResponsiveAfterStress=$true;requireContentRestore=$true}
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss';$out=Join-Path $OutputDirectory "uiux10-composer-stress-$stamp.json"
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Composer stress evidence: $out";Write-Host "Score: $score/100  Verdict: $($report.verdict)";Write-Host "SHA-256: $sha"
if($score-ne100){exit 2};exit 0
