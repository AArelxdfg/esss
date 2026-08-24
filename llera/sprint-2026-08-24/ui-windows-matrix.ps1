[CmdletBinding()]
param(
  [string]$ProcessName = 'LLera',
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'artifacts')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Windows required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LLeraWin32Audit {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

$targets = @(
  @{ width=1366; height=768; dpi=120; scale='125%' },
  @{ width=1920; height=1080; dpi=144; scale='150%' },
  @{ width=2560; height=1440; dpi=192; scale='200%' }
)
$proc = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1)
$window = $null
if ($proc.Count -eq 1) {
  $p=$proc[0]; $r=New-Object LLeraWin32Audit+RECT
  [void][LLeraWin32Audit]::GetWindowRect($p.MainWindowHandle,[ref]$r)
  $window=[ordered]@{
    pid=$p.Id; title=$p.MainWindowTitle; visible=[LLeraWin32Audit]::IsWindowVisible($p.MainWindowHandle)
    hung=[LLeraWin32Audit]::IsHungAppWindow($p.MainWindowHandle); dpi=[LLeraWin32Audit]::GetDpiForWindow($p.MainWindowHandle)
    rect=@{left=$r.Left;top=$r.Top;right=$r.Right;bottom=$r.Bottom;width=$r.Right-$r.Left;height=$r.Bottom-$r.Top}
    responding=$p.Responding; workingSetBytes=$p.WorkingSet64
  }
}
$screens=@([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  @{device=$_.DeviceName;primary=$_.Primary;bounds=@{x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height};workingArea=@{x=$_.WorkingArea.X;y=$_.WorkingArea.Y;width=$_.WorkingArea.Width;height=$_.WorkingArea.Height}}
})
$report=[ordered]@{
 schema=1; capturedAt=(Get-Date).ToUniversalTime().ToString('o'); processName=$ProcessName
 host=@{computer=$env:COMPUTERNAME; os=[Environment]::OSVersion.VersionString; screens=$screens}
 activeWindow=$window
 requiredMatrix=$targets
 verdict=if ($window -and $window.visible -and -not $window.hung -and $window.responding) {'OBSERVED_RESPONSIVE'} else {'NEEDS_RUNNING_LLERA'}
 manualChecks=@(
  'At each required resolution/scale: primary navigation is fully reachable.',
  'Composer remains visible and send/stop controls are not clipped.',
  'Operations/Evidence tabs remain reachable with long Turkish text and long tool output.',
  'No shell-wide horizontal scrollbar appears.',
  'Minimize, maximize, restore, tray restore and taskbar activation repeat without stale/ghost windows.',
  'Queued, running, verifying, blocked, failed and completed states are visually distinct.'
 )
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$out=Join-Path $OutputDirectory "ui-windows-matrix-$stamp.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host "UI evidence: $out"
$report | ConvertTo-Json -Depth 8
