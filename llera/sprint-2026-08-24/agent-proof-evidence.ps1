[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EvidenceDir,
  [string]$ExpectedVersion = '5.3.5',
  [int]$MinimumMaterialActions = 2
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath $EvidenceDir -PathType Container)) { throw "EvidenceDir not found: $EvidenceDir" }

function Read-JsonFile([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 64 } catch { return $null }
}
function Find-Prop($o,[string[]]$names) {
  if ($null -eq $o) { return $null }
  foreach($n in $names) { if ($o.PSObject.Properties.Name -contains $n) { return $o.$n } }
  return $null
}
function Walk($o,[scriptblock]$fn) {
  if ($null -eq $o) { return }
  & $fn $o
  if ($o -is [System.Collections.IDictionary]) { foreach($v in $o.Values){ Walk $v $fn }; return }
  if ($o -is [System.Collections.IEnumerable] -and -not ($o -is [string])) { foreach($v in $o){ Walk $v $fn }; return }
  foreach($p in $o.PSObject.Properties){ if ($p.Value -isnot [string] -and $p.Value -ne $null){ Walk $p.Value $fn } }
}

$files = @(Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | Where-Object { $_.Extension -in '.json','.jsonl' })
$records = [System.Collections.Generic.List[object]]::new()
foreach($f in $files){
  if($f.Extension -eq '.json'){
    $j=Read-JsonFile $f.FullName; if($j){ $records.Add([pscustomobject]@{file=$f.FullName; data=$j}) }
  } else {
    foreach($line in Get-Content -LiteralPath $f.FullName){ if([string]::IsNullOrWhiteSpace($line)){continue}; try{$j=$line|ConvertFrom-Json -Depth 64; $records.Add([pscustomobject]@{file=$f.FullName;data=$j})}catch{} }
  }
}

$evidenceIds=[System.Collections.Generic.HashSet[string]]::new()
$hashes=[System.Collections.Generic.List[string]]::new()
$targets=[System.Collections.Generic.List[string]]::new()
$verificationDebtCreated=0; $verificationDebtSatisfied=0; $loopBlocks=0; $materialActions=0; $successClaims=0; $successWithEvidence=0
foreach($r in $records){
  Walk $r.data {
    param($o)
    $eid=Find-Prop $o @('evidenceId','evidence_id','id'); if($eid -and ([string]$eid -match 'evidence|ev[-_:]')){ [void]$evidenceIds.Add([string]$eid) }
    $h=Find-Prop $o @('sha256','resultHash','result_hash'); if($h -and ([string]$h -match '^[a-fA-F0-9]{64}$')){ $hashes.Add(([string]$h).ToLowerInvariant()) }
    $t=Find-Prop $o @('target','targetScope','target_scope'); if($t){$targets.Add([string]$t)}
    $event=[string](Find-Prop $o @('event','type','kind','name','status'))
    if($event -match 'verification.*debt.*(create|open|pending)'){ $script:verificationDebtCreated++ }
    if($event -match 'verification.*debt.*(satisf|close|resolve|paid)'){ $script:verificationDebtSatisfied++ }
    if($event -match '(anti.?loop|loop).*(block|stop|prevent)|blocked.*repeat'){ $script:loopBlocks++ }
    if($event -match 'material.*action|tool.*mutation|external.*action'){ $script:materialActions++ }
    if($event -match 'mission.*(success|complete)|final.*success'){ $script:successClaims++; $ev=Find-Prop $o @('evidenceId','evidence_id','evidence','ledger'); if($ev){$script:successWithEvidence++} }
  }
}

$checks=@()
function Add-Check([string]$id,[bool]$ok,[string]$detail){ $script:checks += [pscustomobject]@{id=$id;status=$(if($ok){'PASS'}else{'FAIL'});detail=$detail} }
Add-Check 'AGENT-001' ($records.Count -gt 0) "parsedRecords=$($records.Count)"
Add-Check 'AGENT-002' ($evidenceIds.Count -gt 0) "structuredEvidenceIds=$($evidenceIds.Count)"
Add-Check 'AGENT-003' ($hashes.Count -gt 0) "sha256Bindings=$($hashes.Count)"
Add-Check 'AGENT-004' ($targets.Count -gt 0) "targetBindings=$($targets.Count)"
Add-Check 'AGENT-005' ($verificationDebtCreated -gt 0) "verificationDebtCreated=$verificationDebtCreated"
Add-Check 'AGENT-006' ($verificationDebtSatisfied -gt 0 -and $verificationDebtSatisfied -le $verificationDebtCreated) "created=$verificationDebtCreated satisfied=$verificationDebtSatisfied"
Add-Check 'AGENT-007' ($loopBlocks -gt 0) "antiLoopBlocks=$loopBlocks"
Add-Check 'AGENT-008' ($materialActions -ge $MinimumMaterialActions) "materialActions=$materialActions minimum=$MinimumMaterialActions"
Add-Check 'AGENT-009' ($successClaims -eq 0 -or $successWithEvidence -eq $successClaims) "successClaims=$successClaims withEvidence=$successWithEvidence"

$fail=@($checks|Where-Object status -eq 'FAIL')
$report=[ordered]@{schema=1;product='LLera Agent Proof Physical Evidence';expectedVersion=$ExpectedVersion;generatedAt=(Get-Date).ToUniversalTime().ToString('o');sourceDirectory=(Resolve-Path $EvidenceDir).Path;verdict=$(if($fail.Count -eq 0){'PASS'}else{'FAIL'});counts=@{records=$records.Count;evidenceIds=$evidenceIds.Count;sha256Bindings=$hashes.Count;targetBindings=$targets.Count;verificationDebtCreated=$verificationDebtCreated;verificationDebtSatisfied=$verificationDebtSatisfied;antiLoopBlocks=$loopBlocks;materialActions=$materialActions;successClaims=$successClaims;successWithEvidence=$successWithEvidence};checks=$checks}
$outDir=Join-Path $PSScriptRoot 'artifacts'; New-Item -ItemType Directory -Force -Path $outDir|Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $out=Join-Path $outDir "agent-proof-$stamp.json"
$report|ConvertTo-Json -Depth 12|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant(); Set-Content -LiteralPath "$out.sha256" -Value "$sha  $([IO.Path]::GetFileName($out))" -Encoding ascii
Write-Host "Verdict: $($report.verdict)"; Write-Host "Evidence: $out"; Write-Host "SHA256: $sha"
if($fail.Count){exit 2}else{exit 0}
