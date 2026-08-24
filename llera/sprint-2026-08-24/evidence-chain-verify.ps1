[CmdletBinding()]
param(
  [string]$ArtifactsPath = (Join-Path $PSScriptRoot 'artifacts'),
  [string]$LedgerPath = (Join-Path $PSScriptRoot 'evidence-chain.jsonl')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Sha([string]$p){ (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }
function Canonical([hashtable]$o){
  # Stable field order; ConvertTo-Json compressed so the chained hash is reproducible.
  [ordered]@{schema=$o.schema;sequence=$o.sequence;createdAt=$o.createdAt;file=$o.file;bytes=$o.bytes;sha256=$o.sha256;previous=$o.previous} | ConvertTo-Json -Compress
}
function TextSha([string]$s){
  $b=[Text.Encoding]::UTF8.GetBytes($s); $h=[Security.Cryptography.SHA256]::Create(); try { -join ($h.ComputeHash($b)|ForEach-Object{$_.ToString('x2')}) } finally {$h.Dispose()}
}

New-Item -ItemType Directory -Force -Path $ArtifactsPath | Out-Null
$existing=@()
if(Test-Path -LiteralPath $LedgerPath){
  $existing=@(Get-Content -LiteralPath $LedgerPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

# First verify the existing chain before extending it.
$prev='GENESIS'
$seq=0
foreach($e in $existing){
  $seq++
  if([int]$e.sequence -ne $seq){ throw "Evidence sequence break at $seq" }
  if([string]$e.previous -ne $prev){ throw "Evidence previous-hash break at sequence $seq" }
  $base=@{schema=[int]$e.schema;sequence=[int]$e.sequence;createdAt=[string]$e.createdAt;file=[string]$e.file;bytes=[int64]$e.bytes;sha256=[string]$e.sha256;previous=[string]$e.previous}
  $calc=TextSha (Canonical $base)
  if($calc -ne [string]$e.chainHash){ throw "Evidence chainHash mismatch at sequence $seq" }
  $prev=$calc
}

$known=@{}
foreach($e in $existing){ $known[[string]$e.file]=[string]$e.sha256 }
$files=@(Get-ChildItem -LiteralPath $ArtifactsPath -File -Recurse | Sort-Object FullName)
$added=0
foreach($f in $files){
  $rel=[IO.Path]::GetRelativePath($PSScriptRoot,$f.FullName).Replace('\','/')
  $hash=Sha $f.FullName
  if($known.ContainsKey($rel)){
    if($known[$rel] -ne $hash){ throw "Previously ledgered evidence was modified: $rel" }
    continue
  }
  $seq++
  $base=@{schema=1;sequence=$seq;createdAt=(Get-Date).ToUniversalTime().ToString('o');file=$rel;bytes=$f.Length;sha256=$hash;previous=$prev}
  $chain=TextSha (Canonical $base)
  $record=[ordered]@{schema=1;sequence=$seq;createdAt=$base.createdAt;file=$rel;bytes=$f.Length;sha256=$hash;previous=$prev;chainHash=$chain}
  ($record|ConvertTo-Json -Compress) | Add-Content -LiteralPath $LedgerPath -Encoding UTF8
  $prev=$chain; $added++
}

$result=[ordered]@{schema=1;verified=$true;entries=$seq;added=$added;head=$prev;ledger=(Split-Path -Leaf $LedgerPath);at=(Get-Date).ToUniversalTime().ToString('o')}
$result|ConvertTo-Json -Depth 4
