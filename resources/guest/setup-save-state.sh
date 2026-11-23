#!/bin/bash
# One-time setup so Virtual Machine Manager's "Save state" works in this Linux guest.
# Save state = the guest hibernates: everything open is written to its disk, the VM
# closes completely, and the next power on brings it all back.
#
# It installs qemu-guest-agent, makes sure swap is at least as big as RAM (hibernation
# writes RAM into swap), and points the kernel at that swap so it can resume.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Run it with sudo"; exit 1; }
command -v apt-get >/dev/null && command -v update-initramfs >/dev/null || {
  echo "This script is for Debian-based guests (Kali, Parrot, Ubuntu). Install qemu-guest-agent and set up hibernation with your distro's tools instead."
  exit 1
}

echo "==> Installing qemu-guest-agent"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq qemu-guest-agent
systemctl enable --now qemu-guest-agent >/dev/null 2>&1 || systemctl start qemu-guest-agent

ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
part=$(swapon --show=NAME,TYPE,SIZE --bytes --noheadings | awk '$2=="partition" {print $1, int($3/1048576); exit}')
resume_args=""

if [ -n "$part" ] && [ "${part#* }" -ge "$ram_mb" ]; then
  dev=${part% *}
  uuid=$(blkid -s UUID -o value "$dev")
  echo "==> Using swap partition $dev"
  echo "RESUME=UUID=$uuid" > /etc/initramfs-tools/conf.d/resume
  resume_args="resume=UUID=$uuid"
else
  fs=$(findmnt -no FSTYPE /)
  if [ "$fs" != "ext4" ]; then
    echo "Root filesystem is $fs. This script only sets up a swap file on ext4. Make a swap partition at least ${ram_mb} MB instead."
    exit 1
  fi
  size=$((ram_mb + 512))
  echo "==> Making a ${size} MB swap file (RAM is ${ram_mb} MB)"
  if swapon --show=NAME --noheadings | grep -qx /swapfile; then swapoff /swapfile; fi
  rm -f /swapfile
  fallocate -l "${size}M" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  dev=$(findmnt -no SOURCE -T /swapfile)
  uuid=$(blkid -s UUID -o value "$dev")
  offset=$(filefrag -v /swapfile | awk '$1=="0:" {sub(/\.\./, "", $4); print $4; exit}')
  echo "RESUME=UUID=$uuid RESUME_OFFSET=$offset" > /etc/initramfs-tools/conf.d/resume
  resume_args="resume=UUID=$uuid resume_offset=$offset"
fi

echo "==> Telling the kernel where to resume from"
sed -i -E "s/ ?resume(_offset)?=[^ \"']*//g" /etc/default/grub
# the value can be in double or single quotes
sed -i -E "s/^(GRUB_CMDLINE_LINUX_DEFAULT=[\"'])/\1$resume_args /" /etc/default/grub
if ! grep -qE "^GRUB_CMDLINE_LINUX_DEFAULT=[\"']$resume_args" /etc/default/grub; then
  echo "Couldn't add '$resume_args' to GRUB_CMDLINE_LINUX_DEFAULT in /etc/default/grub."
  echo "Add it there by hand and run update-grub, otherwise the VM can't resume after Save state."
  exit 1
fi

# power off at the end of hibernation instead of using ACPI S4, which some VMs lack
mkdir -p /etc/systemd/sleep.conf.d
printf '[Sleep]\nAllowHibernation=yes\nHibernateMode=shutdown\n' > /etc/systemd/sleep.conf.d/vmm.conf

update-initramfs -u -k all >/dev/null
update-grub >/dev/null 2>&1

echo
echo "Done. Restart the VM once, then Save state in Virtual Machine Manager will work."
