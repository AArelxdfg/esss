[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$ExpectedInstallerSha256 = "1852b9c116fca9c4107e814b556956028d4732f4f04a00f606908d47667b9d2e",
    [string]$ExpectedVersion = "5.3.5",
    [string]$AppPath,
    [int]$RuntimePort = 18191,
    [int]$VisionPort = 18192,
    [int]$RecoveryTimeoutSeconds = 90,
    [switch]$RequireTrustedAuthenticode,
    [switch]$RunInstalledSelfTest,
    [switch]$ProbeRuntimeRecovery
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Results = [System.Collections.Generic.List[object]]::new()
$script:StartedAt = (Get-Date).ToUniversalTime()

function Add-GateResult {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][ValidateSet('PASS','FAIL','WARN','SKIP')][string]$Status,
        [string]$Detail = '',
        [bool]$Required = $true,
        $Evidence = $null
    )
    $script:Results.Add([pscustomobject]@{
        id       = $Id
        name     = $Name
        status   = $Status
        required = $Required
        detail   = $Detail
        evidence = $Evidence
        at       = (Get-Date).ToUniversalTime().ToString('o')
    })

    $prefix = if ($Status -eq 'PASS') { '[PASS]' } elseif ($Status -eq 'FAIL') { '[FAIL]' } elseif ($Status -eq 'WARN') { '[WARN]' } else { '[SKIP]' }
    Write-Host "$prefix $Id $Name - $Detail"
}

function Test-IsWindows {
    return [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
}

function Get-PeInfo {
    param([Parameter(Mandatory)][string]$Path)

    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        $br = [System.IO.BinaryReader]::new($fs)
        if ($br.ReadUInt16() -ne 0x5A4D) { return $null }
        $fs.Position = 0x3C
        $peOffset = $br.ReadInt32()
        if ($peOffset -lt 0 -or $peOffset -gt ($fs.Length - 24)) { return $null }
        $fs.Position = $peOffset
        if ($br.ReadUInt32() -ne 0x00004550) { return $null }
        $machine = $br.ReadUInt16()
        $numberOfSections = $br.ReadUInt16()
        $fs.Position = $peOffset + 24
        $magic = $br.ReadUInt16()
        return [pscustomobject]@{
            machineHex = ('0x{0:X4}' -f $machine)
            machine = switch ($machine) {
                0x8664 { 'AMD64' }
                0x014c { 'I386' }
                0xAA64 { 'ARM64' }
                default { 'UNKNOWN' }
            }
            optionalHeaderMagicHex = ('0x{0:X4}' -f $magic)
            pe32Plus = ($magic -eq 0x020B)
            numberOfSections = $numberOfSections
        }
    }
    finally {
        $fs.Dispose()
    }
}

function Get-ListeningConnections {
    param([int[]]$Ports)
    $rows = @()
    foreach ($port in $Ports) {
        try {
            $rows += Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop |
                Select-Object LocalAddress, LocalPort, OwningProcess, State
        }
        catch {
            # No listener is a valid observation.
        }
    }
    return @($rows)
}

function Test-LoopbackAddress {
    param([string]$Address)
    if ([string]::IsNullOrWhiteSpace($Address)) { return $false }
    return $Address -in @('127.0.0.1','::1')
}

function Invoke-HealthProbe {
    param([int]$Port)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 4
        return [pscustomobject]@{
            ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
            statusCode = [int]$r.StatusCode
            body = [string]$r.Content
            error = $null
        }
    }
    catch {
        return [pscustomobject]@{
            ok = $false
            statusCode = $null
            body = $null
            error = $_.Exception.Message
        }
    }
}

function Find-LLeraExecutable {
    if ($AppPath -and (Test-Path -LiteralPath $AppPath -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $AppPath).Path
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'LLera\LLera.exe'),
        (Join-Path $env:ProgramFiles 'LLera\LLera.exe')
    )
    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'LLera\LLera.exe')
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return $null
}

function Get-HostSnapshot {
    $os = Get-CimInstance Win32_OperatingSystem
    $cs = Get-CimInstance Win32_ComputerSystem
    $page = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue)
    $cpu = @(Get-CimInstance Win32_Processor | Select-Object Name, LoadPercentage, NumberOfCores, NumberOfLogicalProcessors)
    $gpu = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Select-Object Name, DriverVersion, AdapterRAM)
    $llama = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
    $visionLike = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'llama|vision|llera' })

    [pscustomobject]@{
        computer = $env:COMPUTERNAME
        windows = $os.Caption
        build = $os.BuildNumber
        architecture = $os.OSArchitecture
        totalPhysicalMemoryBytes = [int64]$cs.TotalPhysicalMemory
        freePhysicalMemoryBytes = [int64]$os.FreePhysicalMemory * 1KB
        totalVirtualMemoryBytes = [int64]$os.TotalVirtualMemorySize * 1KB
        freeVirtualMemoryBytes = [int64]$os.FreeVirtualMemory * 1KB
        pageFiles = $page | Select-Object Name, AllocatedBaseSize, CurrentUsage, PeakUsage
        cpu = $cpu
        gpu = $gpu
        llamaServerCount = $llama.Count
        llamaServerWorkingSetBytes = [int64](($llama | Measure-Object -Property WorkingSet64 -Sum).Sum)
        relevantProcesses = $visionLike | Select-Object ProcessName, Id, PriorityClass, WorkingSet64, StartTime
    }
}

if (-not (Test-IsWindows)) {
    Add-GateResult -Id 'ENV-001' -Name 'Windows host' -Status FAIL -Detail 'This runner must execute on Windows.'
}
else {
    Add-GateResult -Id 'ENV-001' -Name 'Windows host' -Status PASS -Detail ([Environment]::OSVersion.VersionString)
}

if ([Environment]::Is64BitOperatingSystem) {
    Add-GateResult -Id 'ENV-002' -Name '64-bit operating system' -Status PASS -Detail '64-bit Windows process environment available.'
}
else {
    Add-GateResult -Id 'ENV-002' -Name '64-bit operating system' -Status FAIL -Detail 'LLera Windows x64 requires a 64-bit OS.'
}

if ($InstallerPath) {
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        Add-GateResult -Id 'ART-001' -Name 'Installer exists' -Status FAIL -Detail "Not found: $InstallerPath"
    }
    else {
        $resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
        Add-GateResult -Id 'ART-001' -Name 'Installer exists' -Status PASS -Detail $resolvedInstaller

        $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedInstaller).Hash.ToLowerInvariant()
        $expectedHash = $ExpectedInstallerSha256.ToLowerInvariant()
        if ($actualHash -eq $expectedHash) {
            Add-GateResult -Id 'ART-002' -Name 'Installer SHA-256' -Status PASS -Detail $actualHash -Evidence @{ sha256 = $actualHash }
        }
        else {
            Add-GateResult -Id 'ART-002' -Name 'Installer SHA-256' -Status FAIL -Detail "expected=$expectedHash actual=$actualHash" -Evidence @{ expected = $expectedHash; actual = $actualHash }
        }

        $pe = Get-PeInfo -Path $resolvedInstaller
        if ($pe -and $pe.machine -eq 'AMD64' -and $pe.pe32Plus) {
            Add-GateResult -Id 'ART-003' -Name 'PE32+ AMD64 installer' -Status PASS -Detail "$($pe.machine) $($pe.optionalHeaderMagicHex)" -Evidence $pe
        }
        else {
            Add-GateResult -Id 'ART-003' -Name 'PE32+ AMD64 installer' -Status FAIL -Detail 'Installer is not a valid PE32+ AMD64 binary.' -Evidence $pe
        }

        $signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
        $sigEvidence = @{
            status = [string]$signature.Status
            statusMessage = [string]$signature.StatusMessage
            signer = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
        }
        if ($signature.Status -eq 'Valid') {
            Add-GateResult -Id 'ART-004' -Name 'Authenticode signature' -Status PASS -Detail ([string]$signature.SignerCertificate.Subject) -Required:$RequireTrustedAuthenticode -Evidence $sigEvidence
        }
        elseif ($RequireTrustedAuthenticode) {
            Add-GateResult -Id 'ART-004' -Name 'Authenticode signature' -Status FAIL -Detail ([string]$signature.Status) -Required $true -Evidence $sigEvidence
        }
        else {
            Add-GateResult -Id 'ART-004' -Name 'Authenticode signature' -Status WARN -Detail "Not a release blocker for this run; status=$($signature.Status). Windows-grade release should eventually require a trusted publisher signature." -Required $false -Evidence $sigEvidence
        }
    }
}
else {
    Add-GateResult -Id 'ART-001' -Name 'Installer artifact checks' -Status SKIP -Detail 'No -InstallerPath supplied.' -Required $false
}

$hostSnapshot = $null
if (Test-IsWindows) {
    try {
        $hostSnapshot = Get-HostSnapshot
        Add-GateResult -Id 'HOST-001' -Name 'Host telemetry snapshot' -Status PASS -Detail "llama-server count=$($hostSnapshot.llamaServerCount)" -Evidence $hostSnapshot
        if ($hostSnapshot.llamaServerCount -le 1) {
            Add-GateResult -Id 'HOST-002' -Name 'HOSTGUARD single llama runtime' -Status PASS -Detail "count=$($hostSnapshot.llamaServerCount)" -Evidence @{ count = $hostSnapshot.llamaServerCount }
        }
        else {
            Add-GateResult -Id 'HOST-002' -Name 'HOSTGUARD single llama runtime' -Status FAIL -Detail "count=$($hostSnapshot.llamaServerCount); expected <= 1" -Evidence @{ count = $hostSnapshot.llamaServerCount }
        }
    }
    catch {
        Add-GateResult -Id 'HOST-001' -Name 'Host telemetry snapshot' -Status FAIL -Detail $_.Exception.Message
    }
}

if (Test-IsWindows) {
    $listeners = Get-ListeningConnections -Ports @($RuntimePort, $VisionPort)
    $nonLoopback = @($listeners | Where-Object { -not (Test-LoopbackAddress $_.LocalAddress) })
    if ($nonLoopback.Count -eq 0) {
        Add-GateResult -Id 'NET-001' -Name 'Runtime/Vision loopback-only listeners' -Status PASS -Detail "listeners=$($listeners.Count), nonLoopback=0" -Evidence $listeners
    }
    else {
        Add-GateResult -Id 'NET-001' -Name 'Runtime/Vision loopback-only listeners' -Status FAIL -Detail "Found $($nonLoopback.Count) non-loopback listener(s)." -Evidence $nonLoopback
    }

    $health = Invoke-HealthProbe -Port $RuntimePort
    if ($health.ok) {
        Add-GateResult -Id 'RUN-001' -Name 'Local runtime health' -Status PASS -Detail "HTTP $($health.statusCode) on 127.0.0.1:$RuntimePort" -Evidence $health
    }
    else {
        Add-GateResult -Id 'RUN-001' -Name 'Local runtime health' -Status WARN -Detail "Runtime not healthy/started: $($health.error)" -Required $false -Evidence $health
    }
}

$lleraExe = if (Test-IsWindows) { Find-LLeraExecutable } else { $null }
if ($lleraExe) {
    $exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $lleraExe).Hash.ToLowerInvariant()
    $fileVersion = (Get-Item -LiteralPath $lleraExe).VersionInfo.FileVersion
    Add-GateResult -Id 'APP-001' -Name 'Installed LLera executable discovered' -Status PASS -Detail $lleraExe -Evidence @{ sha256 = $exeHash; fileVersion = $fileVersion }

    if ($fileVersion -and $fileVersion -match [regex]::Escape($ExpectedVersion)) {
        Add-GateResult -Id 'APP-002' -Name 'Installed version matches candidate' -Status PASS -Detail "fileVersion=$fileVersion expected=$ExpectedVersion"
    }
    elseif ($fileVersion) {
        Add-GateResult -Id 'APP-002' -Name 'Installed version matches candidate' -Status WARN -Detail "fileVersion=$fileVersion expected=$ExpectedVersion" -Required $false
    }
    else {
        Add-GateResult -Id 'APP-002' -Name 'Installed version matches candidate' -Status SKIP -Detail 'Executable has no usable FileVersion metadata.' -Required $false
    }
}
else {
    Add-GateResult -Id 'APP-001' -Name 'Installed LLera executable discovered' -Status SKIP -Detail 'LLera.exe was not found in standard locations and -AppPath was not supplied.' -Required $false
}

if ($RunInstalledSelfTest) {
    if (-not $lleraExe) {
        Add-GateResult -Id 'APP-003' -Name 'Installed self-test' -Status FAIL -Detail 'Cannot run self-test without LLera.exe.'
    }
    else {
        try {
            $stdout = [System.IO.Path]::GetTempFileName()
            $stderr = [System.IO.Path]::GetTempFileName()
            try {
                $p = Start-Process -FilePath $lleraExe -ArgumentList '--self-test' -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
                $outText = (Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue)
                $errText = (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
                $evidence = @{ exitCode = $p.ExitCode; stdout = $outText; stderr = $errText }
                if ($p.ExitCode -eq 0) {
                    Add-GateResult -Id 'APP-003' -Name 'Installed self-test' -Status PASS -Detail 'Exit code 0.' -Evidence $evidence
                }
                else {
                    Add-GateResult -Id 'APP-003' -Name 'Installed self-test' -Status FAIL -Detail "Exit code $($p.ExitCode)." -Evidence $evidence
                }
            }
            finally {
                Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
            Add-GateResult -Id 'APP-003' -Name 'Installed self-test' -Status FAIL -Detail $_.Exception.Message
        }
    }
}
else {
    Add-GateResult -Id 'APP-003' -Name 'Installed self-test' -Status SKIP -Detail 'Use -RunInstalledSelfTest to execute LLera.exe --self-test.' -Required $false
}

if ($ProbeRuntimeRecovery) {
    if (-not (Test-IsWindows)) {
        Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status FAIL -Detail 'Windows required.'
    }
    elseif (-not $lleraExe) {
        Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status FAIL -Detail 'LLera.exe not found; cannot establish owner process context.'
    }
    else {
        $lleraProcesses = @(Get-Process -Name 'LLera' -ErrorAction SilentlyContinue)
        $llamaBefore = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue)
        if ($lleraProcesses.Count -eq 0 -or $llamaBefore.Count -eq 0) {
            Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status FAIL -Detail 'LLera and llama-server must already be running before an explicit recovery probe.'
        }
        elseif ($llamaBefore.Count -ne 1) {
            Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status FAIL -Detail "Expected exactly one llama-server before probe; found $($llamaBefore.Count)."
        }
        else {
            $oldPid = $llamaBefore[0].Id
            Write-Warning "Explicit recovery probe enabled: terminating llama-server PID $oldPid. LLera should self-recover."
            Stop-Process -Id $oldPid -Force
            $deadline = (Get-Date).AddSeconds($RecoveryTimeoutSeconds)
            $recovered = $false
            $newPid = $null
            while ((Get-Date) -lt $deadline) {
                Start-Sleep -Seconds 2
                $candidate = @(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $oldPid })
                if ($candidate.Count -eq 1) {
                    $probe = Invoke-HealthProbe -Port $RuntimePort
                    if ($probe.ok) {
                        $recovered = $true
                        $newPid = $candidate[0].Id
                        break
                    }
                }
            }
            if ($recovered) {
                Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status PASS -Detail "oldPid=$oldPid newPid=$newPid recovered within ${RecoveryTimeoutSeconds}s" -Evidence @{ oldPid = $oldPid; newPid = $newPid; timeoutSeconds = $RecoveryTimeoutSeconds }
            }
            else {
                Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status FAIL -Detail "No healthy replacement runtime within ${RecoveryTimeoutSeconds}s." -Evidence @{ oldPid = $oldPid; timeoutSeconds = $RecoveryTimeoutSeconds }
            }
        }
    }
}
else {
    Add-GateResult -Id 'REC-001' -Name 'llama-server recovery probe' -Status SKIP -Detail 'Non-destructive default. Use -ProbeRuntimeRecovery explicitly.' -Required $false
}

$requiredFailures = @($script:Results | Where-Object { $_.required -and $_.status -eq 'FAIL' })
$requiredPasses = @($script:Results | Where-Object { $_.required -and $_.status -eq 'PASS' })
$warnings = @($script:Results | Where-Object { $_.status -eq 'WARN' })

$report = [ordered]@{
    schema = 1
    product = 'LLera Windows-Grade Gate'
    expectedVersion = $ExpectedVersion
    startedAt = $script:StartedAt.ToString('o')
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    computer = $env:COMPUTERNAME
    verdict = if ($requiredFailures.Count -eq 0) { 'PASS' } else { 'FAIL' }
    summary = [ordered]@{
        requiredPass = $requiredPasses.Count
        requiredFail = $requiredFailures.Count
        warnings = $warnings.Count
        total = $script:Results.Count
    }
    results = $script:Results
}

$outDir = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outPath = Join-Path $outDir "windows-grade-$stamp.json"
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outPath -Encoding UTF8

Write-Host ""
Write-Host "Verdict: $($report.verdict)"
Write-Host "Report:  $outPath"

if ($requiredFailures.Count -gt 0) { exit 2 }
exit 0
