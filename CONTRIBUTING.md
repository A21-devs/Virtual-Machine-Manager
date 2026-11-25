# Contributing

Thanks for wanting to help. Bug reports, small fixes and features from the issue list are all welcome.

## Setup

You need Windows 10/11, Node.js 24+ and (for running real VMs) QEMU for Windows.

```bash
npm install
npx install-electron --no   # downloads the Electron binary if npm skipped it
npm run dev                 # the app
npm run dev:web             # the UI alone in a browser with a fake backend, no QEMU needed
```

## Before you open a PR

- `npm run typecheck` and `npm test` pass
- if you touched how QEMU is started or talked to, run `npm run test:qemu` too (boots a tiny VM, needs QEMU)
- UI changes: add a before/after screenshot to the PR (`npm run dev:web` is the quickest way to get one)
- keep PRs small and about one thing. Link the issue with `Closes #N`

## Ground rules

- Never commit VM data (disks, ISOs). `.gitignore` already blocks the usual extensions.
- Tests must not touch a real `%USERPROFILE%\VMs`. Use a temp folder.
- Everything the renderer can do goes through `src/preload`. Don't turn on `nodeIntegration`.

## Where to start

Issues labelled [first issue](https://github.com/A21-devs/Virtual-Machine-Manager/labels/first%20issue) are small and don't need much context. Comment on one if you're picking it up so nobody doubles up.
