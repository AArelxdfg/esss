[CmdletBinding()]
param(
  [string]$AppPath,
  [string]$ExpectedVersion = '5.3.5',
  [int]$LaunchTimeoutSeconds = 30,
  [int]$RestartCycles = 5,
  [switch]$ExerciseLaunchCycles
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$started=(Get-Date).ToUniversalTime()
$results=[System.Collections.Generic.List[object]]::new()
function Add-Result([string]$Id,[string]$Status,[string]$Detail,$Evidence=$null){
  $results.Add([pscustomobject]@{id=$Id;status=$Status;detail=$Detail;evidence=$Evidence;at=(Get-Date).ToUniversalTime().ToString('o')})
  Write-Host "[$Status] $Id - $Detail"
}
function Find-App {
  if($AppPath -and (Test-Path -LiteralPath $AppPath -PathType Leaf)){return (Resolve-Path $AppPath).Path}
  $c=@((Join-Path $env:LOCALAPPDATA 'LLera\LLera.exe'),(Join-Path $env:ProgramFiles 'LLera\LLera.exe'))
  if(${env:ProgramFiles(x86)}){$c+=(Join-Path ${env:ProgramFiles(x86)} 'LLera\LLera.exe')}
  foreach($p in $c){if($p -and (Test-Path -LiteralPath $p -PathType Leaf)){return (Resolve-Path $p).Path}}
  return $null
}
function Shortcut-Evidence {
  $roots=@($env:USERPROFILE+'\Desktop',$env:APPDATA+'\Microsoft\Windows\Start Menu',$env:ProgramData+'\Microsoft\Windows\Start Menu')
  $items=@()
  $ws=New-Object -ComObject WScript.Shell
  foreach($root in $roots){
    if(Test-Path $root){
      Get-ChildItem $root -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'LLera'} | ForEach-Object {
        try{$s=$ws.CreateShortcut($_.FullName);$items += [pscustomobject]@{path=$_.FullName;target=$s.TargetPath;arguments=$s.Arguments;workingDirectory=$s.WorkingDirectory;targetExists=(Test-Path -LiteralPath $s.TargetPath)}}catch{}
      }
    }
  }
  return @($items)
}
if([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT){Add-Result 'LIFE-ENV' 'FAIL' 'Windows host required.'; $app=$null}else{Add-Result 'LIFE-ENV' 'PASS' ([Environment]::OSVersion.VersionString);$app=Find-App}
if($app){
  $vi=(Get-Item $app).VersionInfo
  $hash=(Get-FileHash -Algorithm SHA256 $app).Hash.ToLowerInvariant()
  Add-Result 'LIFE-APP' 'PASS' $app @{sha256=$hash;fileVersion=$vi.FileVersion;productVersion=$vi.ProductVersion}
  if(($vi.FileVersion -match [regex]::Escape($ExpectedVersion)) -or ($vi.ProductVersion -match [regex]::Escape($ExpectedVersion))){Add-Result 'LIFE-VERSION' 'PASS' "Expected version $ExpectedVersion present."}else{Add-Result 'LIFE-VERSION' 'WARN' "Version metadata does not contain $ExpectedVersion." @{fileVersion=$vi.FileVersion;productVersion=$vi.ProductVersion}}
}else{Add-Result 'LIFE-APP' 'FAIL' 'LLera.exe not found.'}
if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){
  $shortcuts=Shortcut-Evidence
  $stale=@($shortcuts | Where-Object {-not $_.targetExists})
  if($stale.Count -eq 0){Add-Result 'LIFE-SHORTCUTS' 'PASS' "No stale LLera shortcut targets; discovered=$($shortcuts.Count)." $shortcuts}else{Add-Result 'LIFE-SHORTCUTS' 'FAIL' "Stale LLera shortcut targets=$($stale.Count)." $stale}
}
if($ExerciseLaunchCycles -and $app){
  $cycles=@()
  for($i=1;$i -le $RestartCycles;$i++){
    $before=@(Get-Process -Name LLera -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $p=Start-Process -FilePath $app -PassThru
    $deadline=(Get-Date).AddSeconds($LaunchTimeoutSeconds);$responsive=$false
    while((Get-Date)-lt $deadline){Start-Sleep -Milliseconds 500;try{$p.Refresh();if(-not $p.HasExited -and $p.Responding){$responsive=$true;break}}catch{break}}
    $cycles += [pscustomobject]@{cycle=$i;pid=$p.Id;responsive=$responsive;exited=$p.HasExited;preexisting=$before}
    if(-not $p.HasExited){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;Start-Sleep -Seconds 1}
  }
  $bad=@($cycles|Where-Object{-not $_.responsive})
  if($bad.Count -eq 0){Add-Result 'LIFE-RESTART' 'PASS' "$RestartCycles/$RestartCycles launch cycles responsive." $cycles}else{Add-Result 'LIFE-RESTART' 'FAIL' "$($bad.Count) launch cycle(s) failed responsiveness." $cycles}
}else{Add-Result 'LIFE-RESTART' 'SKIP' 'Use -ExerciseLaunchCycles for explicit launch/terminate cycles.'}
# Observe update/rollback evidence without mutating installation.
$searchRoots=@((Join-Path $env:LOCALAPPDATA 'LLera'),(Join-Path $env:APPDATA 'LLera'))
$rollback=@()
foreach($r in $searchRoots){if(Test-Path $r){$rollback += Get-ChildItem $r -Recurse -File -ErrorAction SilentlyContinue | Where-Object {$_.Name -match 'rollback|backup|update|previous|last.?known|manifest'} | Select-Object FullName,Length,LastWriteTimeUtc}}
if($rollback.Count -gt 0){Add-Result 'LIFE-ROLLBACK' 'PASS' "Observed $($rollback.Count) update/rollback-related artifact(s)." $rollback}else{Add-Result 'LIFE-ROLLBACK' 'WARN' 'No update/rollback artifact observed in standard LLera data roots.'}
$fail=@($results|Where-Object{$_.status -eq 'FAIL'})
$report=[ordered]@{schema=1;kind='llera-windows-lifecycle-evidence';expectedVersion=$ExpectedVersion;startedAt=$started.ToString('o');completedAt=(Get-Date).ToUniversalTime().ToString('o');physicalWindows=([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT);verdict=if($fail.Count){'FAIL'}else{'PASS'};results=$results}
$outDir=Join-Path $PSScriptRoot 'artifacts';New-Item -ItemType Directory -Force $outDir|Out-Null
$out=Join-Path $outDir ("windows-lifecycle-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 $out
$sha=(Get-FileHash -Algorithm SHA256 $out).Hash.ToLowerInvariant();Write-Host "Evidence: $out";Write-Host "SHA256: $sha"
if($fail.Count){exit 2}else{exit 0}
