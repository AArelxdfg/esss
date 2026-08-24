[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$MatrixGateReport,
    [Parameter(Mandatory)][string]$FocusOrderReport,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}
$matrix=Read-Json $MatrixGateReport
$focus=Read-Json $FocusOrderReport
if($matrix.product -ne 'LLera UIUX 10/10 Matrix Gate'){Fail 'Unexpected matrix gate product marker.'}
if([int]$matrix.schema -lt 5){Fail 'Matrix gate schema 5+ required.'}
if($matrix.candidate -ne $ExpectedCandidate){Fail "Matrix candidate mismatch: $($matrix.candidate)"}
if($matrix.verdict -ne 'PASS' -or [int]$matrix.score -ne 100){Fail "Matrix is not strict 100/100: score=$($matrix.score) verdict=$($matrix.verdict)"}
if(@($matrix.evidence).Count -ne 3){Fail 'Matrix must contain exactly three physical viewport evidence records.'}
foreach($e in @($matrix.evidence)){
  if([int]$e.score -ne 100){Fail "Viewport $($e.matrixCase) is not 100/100."}
  if([int]$e.warningCount -ne 0){Fail "Viewport $($e.matrixCase) contains warnings."}
  if(-not $e.screenshotSha256 -or ([string]$e.screenshotSha256).Length -ne 64){Fail "Viewport $($e.matrixCase) lacks screenshot SHA-256."}
}
if($focus.product -ne 'LLera UIUX 10/10 Focus Order Audit'){Fail 'Unexpected focus-order product marker.'}
if($focus.candidate -ne $ExpectedCandidate){Fail "Focus candidate mismatch: $($focus.candidate)"}
if($focus.verdict -ne 'PASS' -or [int]$focus.score -ne 100){Fail "Focus order is not 100/100: score=$($focus.score) verdict=$($focus.verdict)"}
if([int]$focus.passCount -ne [int]$focus.totalChecks){Fail 'Focus-order audit has a non-PASS check.'}
if([string]$focus.computer -ne [string]$matrix.computer){Fail 'Focus-order proof must come from the same physical Windows host as the matrix.'}
if(@($focus.forward).Count -lt 5){Fail 'Insufficient forward keyboard traversal evidence.'}
if(@($focus.reverse).Count -lt 5){Fail 'Insufficient reverse keyboard traversal evidence.'}
$badForward=@($focus.forward|Where-Object{$_.processId-ne[int]$focus.processId -or $_.offscreen -or (-not $_.focusable)})
if($badForward.Count-ne0){Fail "Forward traversal contains $($badForward.Count) invalid focus target(s)."}
$badReverse=@($focus.reverse|Where-Object{$_.processId-ne[int]$focus.processId -or $_.offscreen -or (-not $_.focusable)})
if($badReverse.Count-ne0){Fail "Reverse traversal contains $($badReverse.Count) invalid focus target(s)."}
$matrixSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $MatrixGateReport).Hash.ToLowerInvariant()
$focusSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $FocusOrderReport).Hash.ToLowerInvariant()
$result=[ordered]@{
  schema=1;product='LLera UIUX 10/10 Ultimate Gate';candidate=$ExpectedCandidate;verdict='PASS';score=100;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$matrix.computer
  policy=@{requireMatrix100=$true;requireThreePhysicalViewports=$true;requireScreenshotHashes=$true;allowWarnings=$false;requireFocusOrder100=$true;requireForwardAndReverseTraversal=$true;requireSamePhysicalWindowsHost=$true}
  evidence=@{matrixGateSha256=$matrixSha;focusOrderSha256=$focusSha;viewportCount=@($matrix.evidence).Count;forwardFocusSteps=@($focus.forward).Count;reverseFocusSteps=@($focus.reverse).Count}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-ultimate-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict physical contract = 100/100, including focus-order proof.';Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";exit 0
