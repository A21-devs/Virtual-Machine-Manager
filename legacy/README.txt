====================================================
  CUSTOM VM MANAGER  —  your own free, self-hosted VM app
====================================================

HOW TO OPEN IT
  • Double-click "VM Manager" on your Desktop
  • or run "VM Manager.bat" in this folder

WHAT IT IS
  Under the hood it drives QEMU
  (a free, open-source virtualization engine) with WHPX hardware
  acceleration — so VMs run fast, near-native speed. No paid software,
  no accounts, nothing phones home. Everything lives in this folder.

FOLDER LAYOUT   (%USERPROFILE%\VMs)
  VMManager.ps1  the app itself
  vms\           one .json per virtual machine (your settings)
  disks\         the virtual hard drives (.qcow2, grow as needed)
  ISOs\          installer images (Kali is already here)
  qemu\          the engine
  downloads\     installers (safe to delete)

USING IT
  1. Pick a VM on the left (or click "New VM").
  2. Set CPU, RAM, disk size, ISO, network, etc. on the right.
  3. Click Save, then ▶ Start.
  4. First boot runs the OS installer from the ISO. After you install,
     open the VM's settings and untick "Boot from ISO" so it boots
     your installed system instead.

ADD ANOTHER OS
  Drop any .iso into the ISOs\ folder (Ubuntu, Parrot, Windows, etc.),
  click New VM, and choose that ISO from the "Install ISO" dropdown.
  Parrot OS: download the "Security" or "Home" amd64 ISO from parrotsec.org.
  Ubuntu:    ubuntu.com/download/desktop.

SNAPSHOTS
  Select a VM (powered off) and click "Snapshots" to save/restore
  states — like VMware snapshots. Type a name, then Create/Restore/Delete.

NOTES
  • Windows 11 guests need UEFI firmware + a TPM; set Firmware=uefi in the
    VM. (Kali/Ubuntu/Parrot work fine on the default BIOS setting.)
  • Release your mouse from a VM window with the Ctrl+Alt key combo shown
    in the QEMU window title.
  • To free space, you can delete anything in downloads\.
