[CmdletBinding()]
param(
  [int]$DurationMinutes = 30,
  [int]$SampleSeconds = 5,
  [int]$RuntimePort = 18191,
  [int]$VisionPort = 18192,
  [double]$CriticalCommitPercent = 90,
  [double]$CriticalMemoryPercent = 92,
  [double]$MaxUnhealthyRatio = 0.05
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }

$outDir=Join-Path $PSScriptRoot 'artifacts'; New-Item -ItemType Directory -Force $outDir|Out-Null
$samples=[System.Collections.Generic.List[object]]::new(); $violations=[System.Collections.Generic.List[string]]::new()
$start=Get-Date; $deadline=$start.AddMinutes($DurationMinutes)

function Get-LoopbackListeners([int[]]$Ports) {
  $r=@(); foreach($p in $Ports){ try{$r+=Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop|Select-Object LocalAddress,LocalPort,OwningProcess}catch{} }; @($r)
}
function Probe([int]$Port){try{$r=Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/health" -TimeoutSec 3; return $r.StatusCode -ge 200 -and $r.StatusCode -lt 300}catch{return $false}}
function Snapshot {
  $os=Get-CimInstance Win32_OperatingSystem
  $cs=Get-CimInstance Win32_ComputerSystem
  $page=@(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue)
  $llama=@(Get-Process llama-server -ErrorAction SilentlyContinue)
  $vision=@(Get-Process -ErrorAction SilentlyContinue|Where-Object{$_.ProcessName -match 'vision'})
  $listeners=Get-LoopbackListeners @($RuntimePort,$VisionPort)
  $nonLoop=@($listeners|Where-Object{$_.LocalAddress -notin @('127.0.0.1','::1')})
  $total=[double]$cs.TotalPhysicalMemory; $free=[double]$os.FreePhysicalMemory*1KB
  $memPct=if($total){100*(1-$free/$total)}else{0}
  $vTotal=[double]$os.TotalVirtualMemorySize*1KB; $vFree=[double]$os.FreeVirtualMemory*1KB
  $commitPct=if($vTotal){100*(1-$vFree/$vTotal)}else{0}
  [pscustomobject]@{
    at=(Get-Date).ToUniversalTime().ToString('o'); memoryUsedPercent=[math]::Round($memPct,2); commitUsedPercent=[math]::Round($commitPct,2)
    pageFileUsage=@($page|Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage)
    llamaCount=$llama.Count; llamaRssBytes=[int64](($llama|Measure-Object WorkingSet64 -Sum).Sum)
    llamaPriority=@($llama|ForEach-Object{try{$_.PriorityClass.ToString()}catch{'unknown'}})
    visionCount=$vision.Count; visionRssBytes=[int64](($vision|Measure-Object WorkingSet64 -Sum).Sum)
    runtimeHealthy=(Probe $RuntimePort); listeners=$listeners; nonLoopbackListeners=$nonLoop
  }
}

while((Get-Date)-lt $deadline){
  $s=Snapshot; $samples.Add($s)
  if($s.llamaCount -gt 1){$violations.Add("$($s.at): llama-server count=$($s.llamaCount)")}
  if(@($s.nonLoopbackListeners).Count -gt 0){$violations.Add("$($s.at): runtime/vision non-loopback listener")}
  if(($s.commitUsedPercent -ge $CriticalCommitPercent -or $s.memoryUsedPercent -ge $CriticalMemoryPercent) -and $s.visionCount -gt 0){
    $violations.Add("$($s.at): Vision remained loaded under critical host pressure")
  }
  Start-Sleep -Seconds $SampleSeconds
}

$total=$samples.Count; $unhealthy=@($samples|Where-Object{-not $_.runtimeHealthy}).Count
$unhealthyRatio=if($total){$unhealthy/[double]$total}else{1}
$critical=@($samples|Where-Object{$_.commitUsedPercent -ge $CriticalCommitPercent -or $_.memoryUsedPercent -ge $CriticalMemoryPercent})
$maxLlama=@($samples|Measure-Object llamaCount -Maximum).Maximum
$priorityBad=@($samples|Where-Object{ @($_.llamaPriority|Where-Object{$_ -notin @('BelowNormal','Idle')}).Count -gt 0 }).Count
if($priorityBad -gt 0){$violations.Add("llama-server priority exceeded BelowNormal/Idle in $priorityBad sample(s)")}
if($unhealthyRatio -gt $MaxUnhealthyRatio){$violations.Add("runtime unhealthy ratio $([math]::Round($unhealthyRatio,4)) > $MaxUnhealthyRatio")}

$report=[ordered]@{
 schema=1; product='LLera Physical Windows Host-Pressure Evidence'; physicalWindows=$true
 startedAt=$start.ToUniversalTime().ToString('o'); completedAt=(Get-Date).ToUniversalTime().ToString('o')
 durationMinutes=$DurationMinutes; sampleSeconds=$SampleSeconds
 thresholds=@{criticalCommitPercent=$CriticalCommitPercent;criticalMemoryPercent=$CriticalMemoryPercent;maxUnhealthyRatio=$MaxUnhealthyRatio}
 summary=@{samples=$total;criticalSamples=$critical.Count;unhealthySamples=$unhealthy;unhealthyRatio=$unhealthyRatio;maxLlamaCount=$maxLlama;violations=$violations.Count}
 verdict=if($violations.Count -eq 0){'PASS'}else{'FAIL'}; violations=$violations; samples=$samples
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $path=Join-Path $outDir "host-pressure-$stamp.json"
$report|ConvertTo-Json -Depth 12|Set-Content -Encoding UTF8 $path
$sha=(Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant(); Set-Content -Encoding ascii "$path.sha256" "$sha  $([IO.Path]::GetFileName($path))"
Write-Host "Verdict: $($report.verdict)"; Write-Host "Evidence: $path"; Write-Host "SHA256: $sha"
if($report.verdict -ne 'PASS'){exit 2}
