<#
============================================================
  Custom VM Manager  (QEMU front-end)
  A free, self-hosted, VMware-style virtual machine manager.
  Everything lives under  %USERPROFILE%\VMs
============================================================
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# ---------- paths ----------
$Root      = Join-Path $env:USERPROFILE "VMs"
$VmDir     = Join-Path $Root "vms"      # one .json per VM
$DiskDir   = Join-Path $Root "disks"    # qcow2 disks
$IsoDir    = Join-Path $Root "ISOs"     # installer ISOs
$QemuDir   = Join-Path $Root "qemu"     # qemu binaries
foreach ($d in @($Root,$VmDir,$DiskDir,$IsoDir,$QemuDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}

# ---------- locate qemu ----------
function Find-Qemu {
    $candidates = @(
        (Join-Path $QemuDir "qemu-system-x86_64.exe"),
        "C:\Program Files\qemu\qemu-system-x86_64.exe",
        "C:\Program Files\qemu\qemu-system-x86_64w.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    $cmd = Get-Command qemu-system-x86_64.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}
function Qemu-Img {
    $q = Find-Qemu
    if (-not $q) { return $null }
    $img = Join-Path (Split-Path $q) "qemu-img.exe"
    if (Test-Path $img) { return $img }
    return $null
}

# ---------- acceleration auto-detect ----------
function Detect-Accel {
    $q = Find-Qemu
    if (-not $q) { return "tcg" }
    try {
        $out = & $q -accel help 2>&1 | Out-String
        if ($out -match "whpx") { return "whpx" }
    } catch {}
    return "tcg"
}

# ---------- config helpers ----------
function New-DefaultConfig {
    param([string]$Name)
    [ordered]@{
        name        = $Name
        os          = "linux"          # linux | windows | other
        cpus        = 8
        ramMB       = 8192
        diskPath    = (Join-Path $DiskDir "$Name.qcow2")
        diskSizeGB  = 100
        iso         = ""
        firmware    = "bios"           # bios | uefi
        network     = "nat"            # nat | none
        nic         = "e1000"          # e1000 | virtio-net-pci | rtl8139
        display     = "auto"           # auto | gtk | sdl
        video       = "qxl"            # qxl | virtio | std | vmware
        accel       = "auto"           # auto | whpx | tcg
        bootFromIso = $true
        usbTablet   = $true
        extraArgs   = ""
    }
}
function Get-ConfigPath { param($Name) Join-Path $VmDir "$Name.json" }
function Save-Config {
    param($Cfg)
    $p = Get-ConfigPath $Cfg.name
    ($Cfg | ConvertTo-Json -Depth 5) | Set-Content -Path $p -Encoding UTF8
}
function Load-Config {
    param($Path)
    $o = Get-Content $Path -Raw | ConvertFrom-Json
    # convert to ordered hashtable for easy editing
    $h = [ordered]@{}
    foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value }
    return $h
}
function Get-AllConfigs {
    Get-ChildItem $VmDir -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object { Load-Config $_.FullName }
}

# ---------- build qemu command ----------
# NOTE: uses $qa (not $args â€” $args is a reserved automatic variable in PowerShell)
function Build-QemuArgs {
    param($Cfg)
    $accel = $Cfg.accel; if ($accel -eq "auto") { $accel = Detect-Accel }
    $qa = New-Object System.Collections.Generic.List[string]
    $qa.Add("-name"); $qa.Add([string]$Cfg.name)
    $qa.Add("-machine"); if ($accel -eq "whpx") { $qa.Add("q35,accel=whpx,kernel-irqchip=off") } else { $qa.Add("q35,accel=tcg") }
    $qa.Add("-smp"); $qa.Add([string]$Cfg.cpus)
    $qa.Add("-m");   $qa.Add([string]$Cfg.ramMB)
    $qa.Add("-cpu"); if ($accel -eq "whpx") { $qa.Add("max") } else { $qa.Add("qemu64") }

    if ($Cfg.firmware -eq "uefi") {
        $ovmf = Join-Path (Split-Path (Find-Qemu)) "share\edk2-x86_64-code.fd"
        if (Test-Path $ovmf) { $qa.Add("-bios"); $qa.Add($ovmf) }
    }

    # disk
    $qa.Add("-drive"); $qa.Add("file=$($Cfg.diskPath),format=qcow2,if=ide,index=0,media=disk")
    # cdrom
    if ($Cfg.iso -and (Test-Path $Cfg.iso)) {
        $qa.Add("-drive"); $qa.Add("file=$($Cfg.iso),if=ide,index=2,media=cdrom")
    }
    # boot order
    if ($Cfg.bootFromIso -and $Cfg.iso) { $qa.Add("-boot"); $qa.Add("order=dc,menu=on") }
    else { $qa.Add("-boot"); $qa.Add("order=cd,menu=on") }

    # network
    if ($Cfg.network -eq "nat") { $qa.Add("-nic"); $qa.Add("user,model=$($Cfg.nic)") }
    else { $qa.Add("-nic"); $qa.Add("none") }

    # video adapter (fixes glitchy/tearing graphics â€” basic std VGA mangles animations)
    $vid = $Cfg.video; if (-not $vid) { $vid = "qxl" }
    $glOn = $false
    switch ($vid) {
        "virtio" { $qa.Add("-device"); $qa.Add("virtio-vga-gl"); $glOn = $true }
        "std"    { $qa.Add("-vga"); $qa.Add("std") }
        "vmware" { $qa.Add("-vga"); $qa.Add("vmware") }
        default  { $qa.Add("-vga"); $qa.Add("qxl") }   # qxl = smooth 2D, no guest driver needed
    }

    # input / display
    if ($Cfg.usbTablet) { $qa.Add("-usb"); $qa.Add("-device"); $qa.Add("usb-tablet") }
    $disp = $Cfg.display
    if ($disp -eq "auto") { $disp = "gtk" }
    if ($glOn) { $qa.Add("-display"); $qa.Add("$disp,gl=on") }
    else       { $qa.Add("-display"); $qa.Add($disp) }

    if ($Cfg.extraArgs) { foreach ($tok in ($Cfg.extraArgs -split '\s+')) { if ($tok) { $qa.Add($tok) } } }
    return ,$qa.ToArray()
}

# ---------- actions ----------
function Ensure-Disk {
    param($Cfg)
    if (-not (Test-Path $Cfg.diskPath)) {
        $img = Qemu-Img
        if (-not $img) { throw "qemu-img.exe not found." }
        & $img create -f qcow2 $Cfg.diskPath "$($Cfg.diskSizeGB)G" | Out-Null
    }
}
function Start-VM {
    param($Cfg)
    $q = Find-Qemu
    if (-not $q) { [System.Windows.Forms.MessageBox]::Show("QEMU is not installed yet. Finish the QEMU install first.","VM Manager"); return }
    Ensure-Disk $Cfg

    $logDir = Join-Path $Root "logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force $logDir | Out-Null }
    $errLog = Join-Path $logDir "$($Cfg.name).err.log"
    $cmdLog = Join-Path $logDir "$($Cfg.name).cmd.log"

    $qargs = Build-QemuArgs $Cfg
    # Quote any token containing whitespace, otherwise paths like "Parrot Home.qcow2"
    # get split at the space and QEMU dies instantly. This is the fix for spaces in names.
    $argLine = ($qargs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
    ("`"$q`" " + $argLine) | Set-Content $cmdLog -Encoding UTF8

    try {
        $p = Start-Process -FilePath $q -ArgumentList $argLine -WorkingDirectory (Split-Path $q) `
             -RedirectStandardError $errLog -PassThru
    } catch {
        [System.Windows.Forms.MessageBox]::Show("Could not launch QEMU:`n`n$($_.Exception.Message)","VM Manager - launch failed")
        return
    }

    # If QEMU dies immediately, surface the real reason instead of failing silently.
    Start-Sleep -Milliseconds 1800
    if ($p -and $p.HasExited) {
        $msg = ""
        try { $msg = (Get-Content $errLog -Raw -ErrorAction SilentlyContinue) } catch {}
        if (-not $msg) { $msg = "QEMU exited immediately (exit code $($p.ExitCode)) with no error output." }
        [System.Windows.Forms.MessageBox]::Show(
            "The VM '$($Cfg.name)' failed to start:`n`n$msg`n`nFull command saved to:`n$cmdLog",
            "VM Manager - launch failed")
    }
}
function Snapshot-List {
    param($Cfg)
    $img = Qemu-Img; if (-not $img) { return @() }
    if (-not (Test-Path $Cfg.diskPath)) { return @() }
    $out = & $img snapshot -l $Cfg.diskPath 2>&1 | Out-String
    return $out
}
function Snapshot-Create { param($Cfg,$Name) $img=Qemu-Img; & $img snapshot -c $Name $Cfg.diskPath 2>&1 | Out-String }
function Snapshot-Apply  { param($Cfg,$Name) $img=Qemu-Img; & $img snapshot -a $Name $Cfg.diskPath 2>&1 | Out-String }
function Snapshot-Delete { param($Cfg,$Name) $img=Qemu-Img; & $img snapshot -d $Name $Cfg.diskPath 2>&1 | Out-String }

# ======================================================
#  GUI
# ======================================================
$font  = New-Object System.Drawing.Font("Segoe UI",9)
$fontB = New-Object System.Drawing.Font("Segoe UI",10,[System.Drawing.FontStyle]::Bold)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Custom VM Manager"
$form.Size = New-Object System.Drawing.Size(920,600)
$form.StartPosition = "CenterScreen"
$form.Font = $font
$form.BackColor = [System.Drawing.Color]::FromArgb(37,37,38)
$form.ForeColor = [System.Drawing.Color]::White

# left: VM list
$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = "Virtual Machines"; $lbl.Font = $fontB
$lbl.Location = "12,12"; $lbl.Size = "260,22"; $form.Controls.Add($lbl)

$list = New-Object System.Windows.Forms.ListBox
$list.Location = "12,40"; $list.Size = "260,470"
$list.BackColor = [System.Drawing.Color]::FromArgb(30,30,30)
$list.ForeColor = [System.Drawing.Color]::White; $list.BorderStyle = "FixedSingle"
$form.Controls.Add($list)

# right: details panel
$panel = New-Object System.Windows.Forms.Panel
$panel.Location = "288,40"; $panel.Size = "600,470"; $form.Controls.Add($panel)

function New-Field {
    param($Label,$Y,$Ctrl)
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $Label; $l.Location = "0,$Y"; $l.Size = "150,22"
    $panel.Controls.Add($l)
    $Ctrl.Location = "160,$Y"; $Ctrl.Size = "420,24"
    $panel.Controls.Add($Ctrl)
    return $Ctrl
}
$tName = New-Field "Name" 6   (New-Object System.Windows.Forms.TextBox)
$cOS   = New-Field "OS type" 40 (New-Object System.Windows.Forms.ComboBox)
$cOS.DropDownStyle="DropDownList"; $cOS.Items.AddRange(@("linux","windows","other"))
$tCpu  = New-Field "CPU cores" 74 (New-Object System.Windows.Forms.NumericUpDown)
$tCpu.Minimum=1;$tCpu.Maximum=24
$tRam  = New-Field "RAM (MB)" 108 (New-Object System.Windows.Forms.NumericUpDown)
$tRam.Minimum=512;$tRam.Maximum=30000;$tRam.Increment=512
$tDisk = New-Field "Disk size (GB)" 142 (New-Object System.Windows.Forms.NumericUpDown)
$tDisk.Minimum=5;$tDisk.Maximum=1000
$cIso  = New-Field "Install ISO" 176 (New-Object System.Windows.Forms.ComboBox)
$cIso.DropDownStyle="DropDownList"
$cFw   = New-Field "Firmware" 210 (New-Object System.Windows.Forms.ComboBox)
$cFw.DropDownStyle="DropDownList"; $cFw.Items.AddRange(@("bios","uefi"))
$cNet  = New-Field "Network" 244 (New-Object System.Windows.Forms.ComboBox)
$cNet.DropDownStyle="DropDownList"; $cNet.Items.AddRange(@("nat","none"))
$cDisp = New-Field "Display" 278 (New-Object System.Windows.Forms.ComboBox)
$cDisp.DropDownStyle="DropDownList"; $cDisp.Items.AddRange(@("auto","gtk","sdl"))
$cAcc  = New-Field "Acceleration" 312 (New-Object System.Windows.Forms.ComboBox)
$cAcc.DropDownStyle="DropDownList"; $cAcc.Items.AddRange(@("auto","whpx","tcg"))
$cVid  = New-Field "Video (graphics)" 346 (New-Object System.Windows.Forms.ComboBox)
$cVid.DropDownStyle="DropDownList"; $cVid.Items.AddRange(@("qxl","virtio","std","vmware"))
$chkBoot = New-Object System.Windows.Forms.CheckBox
$chkBoot.Text="Boot from ISO (for install)"; $chkBoot.Location="160,380"; $chkBoot.Size="420,22"
$chkBoot.ForeColor=[System.Drawing.Color]::White; $panel.Controls.Add($chkBoot)
$tExtra = New-Field "Extra QEMU args" 408 (New-Object System.Windows.Forms.TextBox)

foreach ($c in $panel.Controls) {
    if ($c -is [System.Windows.Forms.TextBox] -or $c -is [System.Windows.Forms.ComboBox] -or $c -is [System.Windows.Forms.NumericUpDown]) {
        $c.BackColor=[System.Drawing.Color]::FromArgb(30,30,30); $c.ForeColor=[System.Drawing.Color]::White
    }
}

# ---------- buttons ----------
function New-Btn { param($Text,$X,$W=110)
    $b=New-Object System.Windows.Forms.Button
    $b.Text=$Text;$b.Location="$X,520";$b.Size="$W,32"
    $b.FlatStyle="Flat";$b.BackColor=[System.Drawing.Color]::FromArgb(60,60,62);$b.ForeColor=[System.Drawing.Color]::White
    $form.Controls.Add($b);return $b
}
$btnNew   = New-Btn "New VM" 12 100
$btnSave  = New-Btn "Save"   118 90
$btnStart = New-Btn "â–¶ Start" 212 100
$btnSnap  = New-Btn "Snapshots" 316 110
$btnDel   = New-Btn "Delete" 430 90
$btnFolder= New-Btn "Open Folder" 720 110
$btnStart.BackColor=[System.Drawing.Color]::FromArgb(0,120,40)

# ---------- data binding ----------
function Refresh-Isos {
    $cIso.Items.Clear(); $cIso.Items.Add("(none)") | Out-Null
    Get-ChildItem $IsoDir -Filter *.iso -ErrorAction SilentlyContinue | ForEach-Object { $cIso.Items.Add($_.FullName) | Out-Null }
}
function Refresh-List {
    $list.Items.Clear()
    Get-AllConfigs | ForEach-Object { $list.Items.Add($_.name) | Out-Null }
}
function Load-Into-Form { param($Cfg)
    $tName.Text=$Cfg.name; $cOS.Text=$Cfg.os; $tCpu.Value=[int]$Cfg.cpus; $tRam.Value=[int]$Cfg.ramMB
    $tDisk.Value=[int]$Cfg.diskSizeGB
    Refresh-Isos
    if ($Cfg.iso) { $cIso.Text=$Cfg.iso } else { $cIso.SelectedIndex=0 }
    $cFw.Text=$Cfg.firmware; $cNet.Text=$Cfg.network; $cDisp.Text=$Cfg.display; $cAcc.Text=$Cfg.accel
    $v=$Cfg.video; if(-not $v){$v="qxl"}; $cVid.Text=$v
    $chkBoot.Checked=[bool]$Cfg.bootFromIso; $tExtra.Text=$Cfg.extraArgs
}
function Form-To-Config {
    $iso = $cIso.Text; if ($iso -eq "(none)") { $iso = "" }
    [ordered]@{
        name=$tName.Text; os=$cOS.Text; cpus=[int]$tCpu.Value; ramMB=[int]$tRam.Value
        diskPath=(Join-Path $DiskDir "$($tName.Text).qcow2"); diskSizeGB=[int]$tDisk.Value
        iso=$iso; firmware=$cFw.Text; network=$cNet.Text; nic="e1000"
        display=$cDisp.Text; video=$cVid.Text; accel=$cAcc.Text; bootFromIso=$chkBoot.Checked
        usbTablet=$true; extraArgs=$tExtra.Text
    }
}

$list.Add_SelectedIndexChanged({
    if ($list.SelectedItem) {
        $cfg = Load-Config (Get-ConfigPath $list.SelectedItem)
        Load-Into-Form $cfg
    }
})
$btnNew.Add_Click({
    $name = "VM-" + (Get-Random -Maximum 9999)
    $cfg = New-DefaultConfig $name
    Load-Into-Form $cfg
    $tName.Focus()
})
$btnSave.Add_Click({
    if (-not $tName.Text) { [System.Windows.Forms.MessageBox]::Show("Give the VM a name."); return }
    $cfg = Form-To-Config
    Save-Config $cfg
    Refresh-List
    $list.SelectedItem = $cfg.name
    [System.Windows.Forms.MessageBox]::Show("Saved '$($cfg.name)'.","VM Manager")
})
$btnStart.Add_Click({
    if (-not $tName.Text) { return }
    $cfg = Form-To-Config; Save-Config $cfg; Refresh-List
    try { Start-VM $cfg } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,"VM Manager") }
})
$btnDel.Add_Click({
    if (-not $list.SelectedItem) { return }
    $n = $list.SelectedItem
    $r = [System.Windows.Forms.MessageBox]::Show("Delete VM '$n'? (disk file kept unless you check)","Delete",[System.Windows.Forms.MessageBoxButtons]::YesNo)
    if ($r -eq "Yes") {
        Remove-Item (Get-ConfigPath $n) -ErrorAction SilentlyContinue
        Refresh-List
    }
})
$btnFolder.Add_Click({ Start-Process explorer.exe $Root })
$btnSnap.Add_Click({
    if (-not $list.SelectedItem) { [System.Windows.Forms.MessageBox]::Show("Select a VM first."); return }
    $cfg = Load-Config (Get-ConfigPath $list.SelectedItem)
    Show-SnapshotDialog $cfg
})

function Show-SnapshotDialog { param($Cfg)
    $d = New-Object System.Windows.Forms.Form
    $d.Text="Snapshots - $($Cfg.name)"; $d.Size="520,420"; $d.StartPosition="CenterParent"
    $d.BackColor=[System.Drawing.Color]::FromArgb(37,37,38); $d.ForeColor=[System.Drawing.Color]::White; $d.Font=$font
    $tb=New-Object System.Windows.Forms.TextBox; $tb.Multiline=$true; $tb.ReadOnly=$true; $tb.ScrollBars="Vertical"
    $tb.Location="12,12"; $tb.Size="480,250"; $tb.BackColor=[System.Drawing.Color]::FromArgb(30,30,30); $tb.ForeColor=[System.Drawing.Color]::White
    $d.Controls.Add($tb)
    $nameBox=New-Object System.Windows.Forms.TextBox; $nameBox.Location="12,275"; $nameBox.Size="200,24"
    $nameBox.BackColor=[System.Drawing.Color]::FromArgb(30,30,30); $nameBox.ForeColor=[System.Drawing.Color]::White; $d.Controls.Add($nameBox)
    function Refresh-Snaps { $tb.Text = (Snapshot-List $Cfg) }
    Refresh-Snaps
    $bc=New-Object System.Windows.Forms.Button; $bc.Text="Create"; $bc.Location="222,274"; $bc.Size="80,26"; $bc.FlatStyle="Flat"; $bc.ForeColor="White"; $d.Controls.Add($bc)
    $ba=New-Object System.Windows.Forms.Button; $ba.Text="Restore"; $ba.Location="308,274"; $ba.Size="80,26"; $ba.FlatStyle="Flat"; $ba.ForeColor="White"; $d.Controls.Add($ba)
    $bd=New-Object System.Windows.Forms.Button; $bd.Text="Delete"; $bd.Location="394,274"; $bd.Size="80,26"; $bd.FlatStyle="Flat"; $bd.ForeColor="White"; $d.Controls.Add($bd)
    $note=New-Object System.Windows.Forms.Label; $note.Text="VM must be powered off. Type a name, then Create/Restore/Delete."; $note.Location="12,310"; $note.Size="480,40"; $d.Controls.Add($note)
    $bc.Add_Click({ if($nameBox.Text){ Snapshot-Create $Cfg $nameBox.Text | Out-Null; Refresh-Snaps } })
    $ba.Add_Click({ if($nameBox.Text){ Snapshot-Apply  $Cfg $nameBox.Text | Out-Null; Refresh-Snaps } })
    $bd.Add_Click({ if($nameBox.Text){ Snapshot-Delete $Cfg $nameBox.Text | Out-Null; Refresh-Snaps } })
    $d.ShowDialog() | Out-Null
}

# ---------- startup ----------
Refresh-Isos
Refresh-List
if ($list.Items.Count -gt 0) { $list.SelectedIndex = 0 } else { Load-Into-Form (New-DefaultConfig "VM-1") }

# status bar
$status = New-Object System.Windows.Forms.Label
$q = Find-Qemu
$accel = if ($q) { Detect-Accel } else { "n/a" }
$status.Text = if ($q) { "QEMU: found   |   Acceleration: $accel   |   Root: $Root" } else { "QEMU: NOT installed yet   |   Root: $Root" }
$status.Location="288,516"; $status.Size="420,18"; $status.ForeColor=[System.Drawing.Color]::Silver
$form.Controls.Add($status)

[void]$form.ShowDialog()
