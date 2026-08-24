[CmdletBinding()]
param(
    [int]$DurationMinutes = 120,
    [int]$SampleSeconds = 10,
    [int]$RuntimePort = 18191,
    [int]$VisionPort = 18192,
    [string]$ExpectedVersion = '5.3.5'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Physical Windows soak must run on Windows.' }
if ($DurationMinutes -lt 1 -or $SampleSeconds -lt 1) { throw 'Invalid soak duration/sample interval.' }

function Probe([int]$Port) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
    } catch { return $false }
}
function LoopbackOnly([int[]]$Ports) {
    $bad = @()
    foreach ($p in $Ports) {
        try {
            $bad += @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') })
        } catch {}
    }
    return ($bad.Count -eq 0)
}

$started = Get-Date
$deadline = $started.AddMinutes($DurationMinutes)
$samples = [System.Collections.Generic.List[object]]::new()
$healthPass = 0; $healthFail = 0; $maxLlama = 0; $maxRelevantRss = [int64]0
while ((Get-Date) -lt $deadline) {
    $llama = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
    $relevant = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(LLera|llama-server|llera-vision)$' })
    $rss = [int64](($relevant | Measure-Object -Property WorkingSet64 -Sum).Sum)
    $maxLlama = [Math]::Max($maxLlama, $llama.Count)
    $maxRelevantRss = [Math]::Max($maxRelevantRss, $rss)
    $ok = Probe $RuntimePort
    if ($ok) { $healthPass++ } else { $healthFail++ }
    $os = Get-CimInstance Win32_OperatingSystem
    $samples.Add([pscustomobject]@{
        at=(Get-Date).ToUniversalTime().ToString('o'); runtimeHealthy=$ok; llamaCount=$llama.Count; relevantRssBytes=$rss;
        freePhysicalBytes=[int64]$os.FreePhysicalMemory*1KB; freeVirtualBytes=[int64]$os.FreeVirtualMemory*1KB;
        loopbackOnly=(LoopbackOnly @($RuntimePort,$VisionPort))
    })
    Start-Sleep -Seconds $SampleSeconds
}

# Conservative bounded-growth oracle: compare median first/last 20% RSS. This is evidence, not a leak proof.
$rssValues = @($samples | ForEach-Object { [int64]$_.relevantRssBytes })
$n = $rssValues.Count; $slice = [Math]::Max(1,[int]($n*0.2))
$firstAvg = [double](($rssValues | Select-Object -First $slice | Measure-Object -Average).Average)
$lastAvg = [double](($rssValues | Select-Object -Last $slice | Measure-Object -Average).Average)
$growthRatio = if ($firstAvg -gt 0) { $lastAvg/$firstAvg } else { 1.0 }
$allLoopback = (@($samples | Where-Object { -not $_.loopbackOnly }).Count -eq 0)
$singleRuntime = ($maxLlama -le 1)
$healthRatio = if (($healthPass+$healthFail) -gt 0) { $healthPass/($healthPass+$healthFail) } else { 0 }
$bounded = ($growthRatio -le 1.35)

$result = [ordered]@{
 schema=1; product='LLera Physical Windows Soak'; expectedVersion=$ExpectedVersion;
 executed=$true; startedAt=$started.ToUniversalTime().ToString('o'); completedAt=(Get-Date).ToUniversalTime().ToString('o');
 soakMinutes=[math]::Round(((Get-Date)-$started).TotalMinutes,2); sampleSeconds=$SampleSeconds; samples=$n;
 healthCyclesPassed=$healthPass; healthCyclesFailed=$healthFail; healthRatio=[math]::Round($healthRatio,4);
 maxLlamaServerCount=$maxLlama; maxRelevantRssBytes=$maxRelevantRss; rssFirstSliceAverageBytes=[int64]$firstAvg; rssLastSliceAverageBytes=[int64]$lastAvg;
 rssGrowthRatio=[math]::Round($growthRatio,4); noUnboundedGrowth=$bounded; loopbackOnlyPassed=$allLoopback; singleRuntimePassed=$singleRuntime;
 verdict=if($healthRatio -ge 0.98 -and $singleRuntime -and $allLoopback -and $bounded){'PASS'}else{'FAIL'};
 sampleData=$samples
}
$outDir=Join-Path $PSScriptRoot 'artifacts'; New-Item -ItemType Directory -Force -Path $outDir|Out-Null
$out=Join-Path $outDir ("physical-windows-soak-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant(); "$sha  $(Split-Path -Leaf $out)"|Set-Content "$out.sha256" -Encoding ASCII
Write-Host "Verdict: $($result.verdict)"; Write-Host "Evidence: $out"; Write-Host "SHA-256: $sha"
if($result.verdict -ne 'PASS'){exit 2}; exit 0
