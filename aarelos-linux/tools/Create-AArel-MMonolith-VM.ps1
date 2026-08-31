[CmdletBinding()]
param(
    [string]$IsoPath = 'C:\Users\arelx\Downloads\AArel-MMonolith-OS-amd64.iso',
    [string]$Name = 'AArel-MMonolith-OS',
    [int]$MemoryMB = 4096,
    [int]$CpuCount = 4,
    [int]$DiskGB = 40
)

$ErrorActionPreference = 'Stop'
$vbox = Join-Path $env:ProgramFiles 'Oracle\VirtualBox\VBoxManage.exe'
if (-not (Test-Path -LiteralPath $vbox)) { throw 'VirtualBox VBoxManage.exe was not found.' }
if (-not (Test-Path -LiteralPath $IsoPath)) { throw "ISO was not found: $IsoPath" }
if ($MemoryMB -lt 2048 -or $CpuCount -lt 2 -or $DiskGB -lt 25) { throw 'Use at least 2 GiB RAM, 2 CPUs and a 25 GiB disk.' }

$existing = & $vbox list vms | Select-String -SimpleMatch ('"' + $Name + '"')
if ($existing) { throw "VM already exists: $Name. Refusing to mutate an existing VM." }

# Guest OS types are compiled into VirtualBox.  VBoxManage cannot register a
# custom Type=AArel / Version=MMonolith entry, so Other_64 is the honest host
# classification; VM name and description retain the product identity.
& $vbox createvm --name $Name --ostype Other_64 --register
& $vbox modifyvm $Name --description 'AArel MMonolith OS — UEFI test VM' --firmware efi --memory $MemoryMB --cpus $CpuCount --chipset ich9 --graphicscontroller vmsvga --vram 128 --audio none --boot1 dvd --boot2 disk --boot3 none --boot4 none
& $vbox storagectl $Name --name 'SATA' --add sata --controller IntelAhci
$vmHome = Join-Path $env:USERPROFILE ('VirtualBox VMs\' + $Name)
$diskPath = Join-Path $vmHome ($Name + '.vdi')
& $vbox createmedium disk --filename $diskPath --format VDI --size ($DiskGB * 1024)
& $vbox storageattach $Name --storagectl 'SATA' --port 0 --device 0 --type hdd --medium $diskPath
& $vbox storageattach $Name --storagectl 'SATA' --port 1 --device 0 --type dvddrive --medium $IsoPath

Write-Output "AAREL_VBOX_VM=PASS name=$Name iso=$IsoPath type=Other_64"
Write-Output "Start it with: & '$vbox' startvm '$Name' --type gui"
