# Virtual Machine Manager

A desktop app for running virtual machines on Windows. It's free, it runs locally, and it's built on [QEMU](https://www.qemu.org/) with Windows Hypervisor Platform (WHPX) acceleration.

I wanted something that works like VMware Workstation but is fully free and fully mine. It started as a PowerShell + WinForms script (still in [`legacy/`](legacy/)), and this repo is the rewrite as a proper Electron + React + TypeScript app.

> 🚧 Rewrite in progress. See the [issues](../../issues) for what's being worked on.

## Features

- VM library with per-VM settings (CPU, RAM, disk, ISO, firmware, network, graphics)
- Fast defaults: virtio disk + network, WHPX acceleration, xHCI USB tablet
- Reads VM configs made by the old PowerShell version, so nothing has to be recreated

Planned (tracked in issues): save states/profiles per VM, auto-start, live previews, power controls, port forwarding, linked clones, OS templates, and more.

## Requirements

- Windows 10/11 with **Windows Hypervisor Platform** turned on (Windows Features)
- [QEMU for Windows](https://qemu.weilnetz.de/w64/)
- Node.js 24+ (only for building from source)

## Run from source

```bash
npm install
npm run dev
```

Other scripts:

| script | what it does |
| --- | --- |
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | production build into `out/` |

## Data folder

Everything lives in `%USERPROFILE%\VMs` by default:

```
VMs/
  vms/     one .json config per VM
  disks/   qcow2 disk images
  ISOs/    installer images
  qemu/    QEMU binaries (optional, otherwise PATH / Program Files is used)
  logs/    per-VM launch logs
```

## Project layout

```
src/
  main/       Electron main process (spawns QEMU, talks to it over QMP)
  preload/    the safe bridge between main and the UI
  renderer/   React UI
  shared/     plain TypeScript used by both sides (config model, QEMU args)
tests/        Vitest unit tests
legacy/       the original PowerShell version
```

## Credits

Built by me, with help from [Claude](https://claude.ai) (Anthropic) as a coding assistant.

## License

[MIT](LICENSE)
