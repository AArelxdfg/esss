[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('1366x768@125','1920x1080@150','2560x1440@200')][string]$MatrixCase,
    [Parameter(Mandatory)][string]$PhysicalAuditReport,
    [int]$MinSampledUniqueColors = 24,
    [double]$MinLuminanceStdDev = 8.0,
    [double]$MinEdgeRatio = 0.015,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Windows required.'}
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing report: $p"};try{Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}
$src=Read-Json $PhysicalAuditReport
if($src.product -ne 'LLera UIUX 10/10 Physical Audit'){Fail 'Unexpected physical audit product marker.'}
if($src.matrixCase -ne $MatrixCase){Fail "Matrix mismatch: report=$($src.matrixCase) requested=$MatrixCase"}
if($src.verdict -ne 'PASS' -or [int]$src.score -ne 100){Fail 'Physical audit must already be 100/100 before visual-integrity validation.'}
$shot=[string]$src.screenshot.path
if(-not(Test-Path -LiteralPath $shot -PathType Leaf)){Fail "Missing screenshot: $shot"}
$actualHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $shot).Hash.ToLowerInvariant()
if($actualHash -ne [string]$src.screenshot.sha256){Fail 'Screenshot SHA-256 no longer matches physical audit evidence.'}
$bmp=[System.Drawing.Bitmap]::FromFile($shot)
try{
    $expectedW=[int]$src.window.rect.width; $expectedH=[int]$src.window.rect.height
    $dimensionOk=($bmp.Width -eq $expectedW -and $bmp.Height -eq $expectedH)
    $stepX=[Math]::Max(1,[int][Math]::Floor($bmp.Width/96.0)); $stepY=[Math]::Max(1,[int][Math]::Floor($bmp.Height/64.0))
    $colors=New-Object 'System.Collections.Generic.HashSet[int]'
    $lum=New-Object System.Collections.Generic.List[double]
    $edgeHits=0; $edgeTests=0; $opaque=0; $samples=0
    for($y=0;$y-lt$bmp.Height;$y+=$stepY){
      for($x=0;$x-lt$bmp.Width;$x+=$stepX){
        $c=$bmp.GetPixel($x,$y); $samples++; if($c.A-ge 250){$opaque++}
        [void]$colors.Add($c.ToArgb())
        $l=(0.2126*$c.R)+(0.7152*$c.G)+(0.0722*$c.B); $lum.Add($l)
        if($x+$stepX-lt$bmp.Width){$n=$bmp.GetPixel($x+$stepX,$y);$d=[Math]::Abs($c.R-$n.R)+[Math]::Abs($c.G-$n.G)+[Math]::Abs($c.B-$n.B);$edgeTests++;if($d-ge 36){$edgeHits++}}
        if($y+$stepY-lt$bmp.Height){$n=$bmp.GetPixel($x,$y+$stepY);$d=[Math]::Abs($c.R-$n.R)+[Math]::Abs($c.G-$n.G)+[Math]::Abs($c.B-$n.B);$edgeTests++;if($d-ge 36){$edgeHits++}}
      }
    }
    $mean=($lum|Measure-Object -Average).Average; $sq=0.0; foreach($v in $lum){$sq+=[Math]::Pow($v-$mean,2)}; $std=[Math]::Sqrt($sq/[Math]::Max(1,$lum.Count))
    $edgeRatio=if($edgeTests-gt 0){$edgeHits/[double]$edgeTests}else{0.0}; $opaqueRatio=if($samples-gt 0){$opaque/[double]$samples}else{0.0}
    $checks=@(
      [pscustomobject]@{id='VIS-001';name='Screenshot hash binding intact';pass=$true;detail="sha256=$actualHash"},
      [pscustomobject]@{id='VIS-002';name='Screenshot dimensions match captured LLera window';pass=$dimensionOk;detail="image=$($bmp.Width)x$($bmp.Height) window=${expectedW}x${expectedH}"},
      [pscustomobject]@{id='VIS-003';name='Screenshot is not blank or near-monochrome';pass=($colors.Count-ge$MinSampledUniqueColors);detail="sampledUniqueColors=$($colors.Count) minimum=$MinSampledUniqueColors"},
      [pscustomobject]@{id='VIS-004';name='Screenshot has meaningful luminance variation';pass=($std-ge$MinLuminanceStdDev);detail="luminanceStdDev=$([Math]::Round($std,3)) minimum=$MinLuminanceStdDev"},
      [pscustomobject]@{id='VIS-005';name='Screenshot contains rendered UI edge/detail structure';pass=($edgeRatio-ge$MinEdgeRatio);detail="edgeRatio=$([Math]::Round($edgeRatio,5)) minimum=$MinEdgeRatio"},
      [pscustomobject]@{id='VIS-006';name='Screenshot is effectively opaque';pass=($opaqueRatio-ge 0.99);detail="opaqueRatio=$([Math]::Round($opaqueRatio,5)) minimum=0.99"}
    )
    $pass=@($checks|Where-Object{$_.pass}).Count; $score=[int][Math]::Round(($pass*100.0)/$checks.Count); $verdict=if($score-eq100){'PASS'}else{'FAIL'}
    $result=[ordered]@{schema=1;product='LLera UIUX 10/10 Visual Integrity Audit';candidate=[string]$src.candidate;matrixCase=$MatrixCase;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=[string]$src.host.computer;physicalAuditSha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $PhysicalAuditReport).Hash.ToLowerInvariant();screenshot=@{path=$shot;sha256=$actualHash;width=$bmp.Width;height=$bmp.Height};metrics=@{sampledUniqueColors=$colors.Count;luminanceStdDev=$std;edgeRatio=$edgeRatio;opaqueRatio=$opaqueRatio;samples=$samples};thresholds=@{minSampledUniqueColors=$MinSampledUniqueColors;minLuminanceStdDev=$MinLuminanceStdDev;minEdgeRatio=$MinEdgeRatio;minOpaqueRatio=0.99};score=$score;passCount=$pass;totalChecks=$checks.Count;verdict=$verdict;checks=$checks}
} finally {$bmp.Dispose()}
$out=Join-Path $OutputDirectory ("uiux10-visual-$($MatrixCase.Replace('@','-'))-{0}.json"-f(Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "Visual integrity score: $($result.score)/100";Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";if($result.verdict-ne'PASS'){exit 2};exit 0
