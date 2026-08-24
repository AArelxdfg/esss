[CmdletBinding()]
param(
  [string]$ProcessName = 'LLera',
  [string]$Candidate = 'V5.4.0 MONOLITH AURORA UX',
  [int]$Samples = 120,
  [int]$IntervalMs = 250,
  [double]$MaxP95Ms = 50,
  [double]$MaxWorstMs = 150,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){throw 'Physical Windows required.'}
if($Samples -lt 60){throw 'At least 60 responsiveness samples are required.'}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraUxLatency {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
function Fail([string]$m){Write-Error $m;exit 2}
$p=@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object{$_.MainWindowHandle-ne 0} | Select-Object -First 1)
if($p.Count-ne1){Fail "Running $ProcessName window required."}
$proc=$p[0];$hwnd=$proc.MainWindowHandle
$rows=New-Object System.Collections.Generic.List[object]
for($i=0;$i-lt$Samples;$i++){
  $proc.Refresh();$sw=[Diagnostics.Stopwatch]::StartNew();$out=[IntPtr]::Zero
  $ret=[LLeraUxLatency]::SendMessageTimeout($hwnd,0,[IntPtr]::Zero,[IntPtr]::Zero,2,1000,[ref]$out)
  $sw.Stop()
  $rows.Add([ordered]@{index=$i;at=(Get-Date).ToUniversalTime().ToString('o');latencyMs=[math]::Round($sw.Elapsed.TotalMilliseconds,3);timedOut=($ret-eq[IntPtr]::Zero);hung=[LLeraUxLatency]::IsHungAppWindow($hwnd);visible=[LLeraUxLatency]::IsWindowVisible($hwnd);responding=$proc.Responding;cpuSeconds=[math]::Round($proc.CPU,3);workingSetBytes=$proc.WorkingSet64})
  Start-Sleep -Milliseconds $IntervalMs
}
$lat=@($rows|ForEach-Object{[double]$_.latencyMs}|Sort-Object)
function Percentile([double[]]$v,[double]$q){if($v.Count-eq0){return [double]::PositiveInfinity};$idx=[math]::Ceiling($q*$v.Count)-1;if($idx-lt0){$idx=0};return $v[$idx]}
$p50=Percentile $lat .50;$p95=Percentile $lat .95;$p99=Percentile $lat .99;$worst=($lat|Measure-Object -Maximum).Maximum
$timeouts=@($rows|Where-Object{$_.timedOut}).Count;$hung=@($rows|Where-Object{$_.hung -or (-not $_.responding)}).Count;$invisible=@($rows|Where-Object{-not $_.visible}).Count
$checks=@(
  [ordered]@{name='all-message-probes-complete';pass=($timeouts-eq0);actual=$timeouts;expected=0},
  [ordered]@{name='no-hung-or-not-responding-samples';pass=($hung-eq0);actual=$hung;expected=0},
  [ordered]@{name='window-remains-visible';pass=($invisible-eq0);actual=$invisible;expected=0},
  [ordered]@{name='p95-ui-thread-latency';pass=($p95-le$MaxP95Ms);actualMs=[math]::Round($p95,3);maxMs=$MaxP95Ms},
  [ordered]@{name='worst-ui-thread-latency';pass=($worst-le$MaxWorstMs);actualMs=[math]::Round($worst,3);maxMs=$MaxWorstMs}
)
$failed=@($checks|Where-Object{-not $_.pass});$score=if($failed.Count-eq0){100}else{[math]::Max(0,100-20*$failed.Count)}
$report=[ordered]@{schema=1;product='LLera UIUX 10/10 Responsiveness Audit';candidate=$Candidate;capturedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$env:COMPUTERNAME;processId=$proc.Id;windowHandle=$hwnd.ToInt64();sampleCount=$Samples;intervalMs=$IntervalMs;latency=[ordered]@{p50Ms=[math]::Round($p50,3);p95Ms=[math]::Round($p95,3);p99Ms=[math]::Round($p99,3);worstMs=[math]::Round($worst,3);maxAllowedP95Ms=$MaxP95Ms;maxAllowedWorstMs=$MaxWorstMs};checks=$checks;failureCount=$failed.Count;score=$score;verdict=if($failed.Count-eq0){'PASS'}else{'FAIL'};samples=$rows}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-responsiveness-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host "UI responsiveness evidence: $out";Write-Host "SHA-256: $sha";Write-Host "Score: $score/100 p95=$([math]::Round($p95,3))ms worst=$([math]::Round($worst,3))ms"
if($failed.Count-ne0){exit 2};exit 0
