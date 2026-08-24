[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$MatrixGateReport,
    [Parameter(Mandatory)][string]$FocusOrderReport,
    [Parameter(Mandatory)][string]$WindowLifecycleReport,
    [Parameter(Mandatory)][string]$ResponsivenessReport,
    [Parameter(Mandatory)][string]$ComposerStressReport,
    [string]$ExpectedCandidate = 'V5.4.0 MONOLITH AURORA UX',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Fail([string]$m){Write-Error $m;exit 2}
function Read-Json([string]$p){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){Fail "Missing evidence: $p"};try{return Get-Content -LiteralPath $p -Raw|ConvertFrom-Json}catch{Fail "Invalid JSON: $p"}}
$matrix=Read-Json $MatrixGateReport
$focus=Read-Json $FocusOrderReport
$lifecycle=Read-Json $WindowLifecycleReport
$responsive=Read-Json $ResponsivenessReport
$composer=Read-Json $ComposerStressReport
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
if($lifecycle.product -ne 'LLera UIUX 10/10 Window Lifecycle Audit'){Fail 'Unexpected window-lifecycle product marker.'}
if($lifecycle.candidate -ne $ExpectedCandidate){Fail "Lifecycle candidate mismatch: $($lifecycle.candidate)"}
if($lifecycle.verdict -ne 'PASS' -or [int]$lifecycle.score -ne 100){Fail "Window lifecycle is not 100/100: score=$($lifecycle.score) verdict=$($lifecycle.verdict)"}
if([int]$lifecycle.failureCount -ne 0){Fail "Window lifecycle contains $($lifecycle.failureCount) failure(s)."}
if([int]$lifecycle.cycles -lt 3){Fail 'At least three minimize/restore/maximize/restore cycles are required.'}
if(@($lifecycle.steps).Count -lt 12){Fail 'Lifecycle evidence lacks the required state-transition observations.'}
if([string]$lifecycle.computer -ne [string]$matrix.computer){Fail 'Window-lifecycle proof must come from the same physical Windows host as the matrix.'}
$badLifecycle=@($lifecycle.steps|Where-Object{$_.hung -or (-not $_.responding) -or ([int]$_.dpi-ne[int]$lifecycle.initialDpi)})
if($badLifecycle.Count-ne0){Fail "Lifecycle contains $($badLifecycle.Count) unresponsive or DPI-drift state(s)."}
if($responsive.product -ne 'LLera UIUX 10/10 Responsiveness Audit'){Fail 'Unexpected responsiveness product marker.'}
if($responsive.candidate -ne $ExpectedCandidate){Fail "Responsiveness candidate mismatch: $($responsive.candidate)"}
if($responsive.verdict -ne 'PASS' -or [int]$responsive.score -ne 100){Fail "Responsiveness is not 100/100: score=$($responsive.score) verdict=$($responsive.verdict)"}
if([int]$responsive.failureCount -ne 0){Fail "Responsiveness audit contains $($responsive.failureCount) failure(s)."}
if([int]$responsive.sampleCount -lt 60){Fail 'Responsiveness proof requires at least 60 physical UI-thread probes.'}
if([double]$responsive.latency.p95Ms -gt 50){Fail "UI-thread p95 latency exceeds 50 ms: $($responsive.latency.p95Ms) ms."}
if([double]$responsive.latency.worstMs -gt 150){Fail "UI-thread worst latency exceeds 150 ms: $($responsive.latency.worstMs) ms."}
if([string]$responsive.computer -ne [string]$matrix.computer){Fail 'Responsiveness proof must come from the same physical Windows host as the matrix.'}
if($composer.product -ne 'LLera UIUX 10/10 Composer Stress Audit'){Fail 'Unexpected composer-stress product marker.'}
if([int]$composer.schema -lt 1){Fail 'Composer-stress schema 1+ required.'}
if($composer.candidate -ne $ExpectedCandidate){Fail "Composer candidate mismatch: $($composer.candidate)"}
if($composer.verdict -ne 'PASS' -or [int]$composer.score -ne 100){Fail "Composer stress is not 100/100: score=$($composer.score) verdict=$($composer.verdict)"}
if([int]$composer.failureCount -ne 0 -or [int]$composer.warningCount -ne 0){Fail 'Composer-stress evidence contains failures or warnings.'}
if([int]$composer.longTextChars -lt 8192){Fail 'Composer stress proof requires at least 8192 characters.'}
if([string]$composer.computer -ne [string]$matrix.computer){Fail 'Composer-stress proof must come from the same physical Windows host as the matrix.'}
$badComposer=@($composer.checks|Where-Object{-not $_.pass})
if($badComposer.Count-ne0){Fail "Composer stress contains $($badComposer.Count) failed check(s)."}
$requiredComposerChecks=@('window-responsive','composer-found','composer-value-pattern','composer-not-clipped','composer-onscreen','composer-keyboard-focus','turkish-unicode-roundtrip','long-content-roundtrip','responsive-after-long-content','composer-bounds-stable-after-long-content','composer-content-restored')
foreach($name in $requiredComposerChecks){if(-not(@($composer.checks|Where-Object{$_.name-eq$name -and $_.pass}).Count-eq1)){Fail "Composer stress lacks required PASS check: $name"}}
$matrixSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $MatrixGateReport).Hash.ToLowerInvariant()
$focusSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $FocusOrderReport).Hash.ToLowerInvariant()
$lifecycleSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $WindowLifecycleReport).Hash.ToLowerInvariant()
$responsiveSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $ResponsivenessReport).Hash.ToLowerInvariant()
$composerSha=(Get-FileHash -Algorithm SHA256 -LiteralPath $ComposerStressReport).Hash.ToLowerInvariant()
$result=[ordered]@{
  schema=4;product='LLera UIUX 10/10 Ultimate Gate';candidate=$ExpectedCandidate;verdict='PASS';score=100;checkedAt=(Get-Date).ToUniversalTime().ToString('o');computer=$matrix.computer
  policy=@{requireMatrix100=$true;requireThreePhysicalViewports=$true;requireScreenshotHashes=$true;allowWarnings=$false;requireFocusOrder100=$true;requireForwardAndReverseTraversal=$true;requireWindowLifecycle100=$true;requireMinimizeRestoreMaximizeRestore=$true;requireStableDpiAcrossLifecycle=$true;requireResponsiveness100=$true;maxP95UiThreadLatencyMs=50;maxWorstUiThreadLatencyMs=150;requireComposerStress100=$true;requireTurkishUnicodeRoundtrip=$true;minimumComposerStressChars=8192;requireComposerNoClipping=$true;requireComposerContentRestore=$true;requireSamePhysicalWindowsHost=$true}
  evidence=@{matrixGateSha256=$matrixSha;focusOrderSha256=$focusSha;windowLifecycleSha256=$lifecycleSha;responsivenessSha256=$responsiveSha;composerStressSha256=$composerSha;viewportCount=@($matrix.evidence).Count;forwardFocusSteps=@($focus.forward).Count;reverseFocusSteps=@($focus.reverse).Count;lifecycleCycles=[int]$lifecycle.cycles;lifecycleSteps=@($lifecycle.steps).Count;responsivenessSamples=[int]$responsive.sampleCount;p95UiThreadLatencyMs=[double]$responsive.latency.p95Ms;worstUiThreadLatencyMs=[double]$responsive.latency.worstMs;composerStressChars=[int]$composer.longTextChars;composerChecks=@($composer.checks).Count}
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$out=Join-Path $OutputDirectory ("uiux10-ultimate-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$result|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $out -Encoding UTF8
$sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant();"$sha  $(Split-Path -Leaf $out)"|Set-Content -LiteralPath "$out.sha256" -Encoding ASCII
Write-Host 'PASS: LLera UI/UX strict physical contract = 100/100, including viewport, focus-order, Windows lifecycle, UI-thread responsiveness and Unicode/long-content composer proof.';Write-Host "Evidence: $out";Write-Host "SHA-256: $sha";exit 0
