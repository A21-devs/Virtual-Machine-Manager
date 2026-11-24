# Security

## Reporting a problem

Please don't open a public issue for security problems. Use **Security > Report a vulnerability** on this repository instead. Only the maintainer can see those reports.

Include what you found, how to reproduce it, and what someone could do with it. You'll get a reply within a week, and a fix or a plan after that. You're credited in the release notes unless you'd rather not be.

## Supported versions

Only the [latest release](https://github.com/A21-devs/Virtual-Machine-Manager/releases/latest) gets fixes.

## What's in scope

- The app itself: the Electron main process, the preload bridge, IPC handlers
- The guest setup server the app runs on `127.0.0.1` while a guest needs the one-time setup
- How the app starts QEMU (arguments built from VM configs)
- The installer and the release workflow

Bugs in QEMU itself should go to the [QEMU project](https://www.qemu.org/contribute/security-process/).
