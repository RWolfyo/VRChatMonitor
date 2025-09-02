# VRChat Instance Monitor

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)

Short description  
VRChat Instance Monitor is a small Node.js CLI utility that watches a local VRChat instance log for player join events, checks joined players' VRChat groups against a configurable blocklist, and emits desktop notifications, optional sound, and Discord webhook alerts when a blocked-group member joins. It is designed to run from source or be packaged into a single Windows executable.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
  - [Node.js (npm)](#nodejs-npm)
  - [Node.js (yarn)](#nodejs-yarn)
- [Configuration](#configuration)
- [Scripts Summary](#scripts-summary)
- [CI/CD notes (GitHub Actions)](#cicd-notes-github-actions)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

## Features

- Watches VRChat `output_log*.txt` to detect player join/leave events.
- Authenticates with VRChat API and inspects user groups.
- Compares user groups to a maintained `blockedGroups` list and alerts on matches.
- Desktop notifications (Windows via `node-notifier` / SnoreToast).
- Optional Discord webhook notifications.
- Plays a packaged `alert.mp3` via bundled `ffplay` when available.
- Can be bundled with [`esbuild`] and packaged to an exe with [`pkg`].

## Prerequisites

- Node.js 18.x (LTS recommended)  
  - Verify: 
```[`bash()`]
node --version
```
- npm (included with Node.js) or Yarn (classic)
- Optional for packaging to Windows exe: `pkg` (already in devDependencies in [`package.json`])
- Optional for sound/notifications:
  - `vendor/SnoreToast.exe` (Windows notifications fallback)
  - `vendor/ffplay` / `vendor/ffplay.exe` (sound playback)
- Docker (optional)

## Installation & Setup

### Node.js (npm)

- Unix / macOS
```[`bash()`]
git clone https://github.com/RWolfyo/VRChatMonitor.git
cd VRChatMonitor
npm install
```

- Windows (cmd.exe / PowerShell)
```[`bash()`]
git clone https://github.com/RWolfyo/VRChatMonitor.git
cd VRChatMonitor
npm install
```

### Node.js (yarn)

```[`bash()`]
git clone https://github.com/RWolfyo/VRChatMonitor.git
cd VRChatMonitor
yarn install
```

## Configuration

The app reads defaults from [`config.json`]. You may override settings by editing that file.

## Scripts Summary

| Script | Command |
|---|---|
| build | `npm run build` — bundle + package (creates `dist/vrc-monitor.exe`) |
| build:bundle | `esbuild` to produce `build/index.cjs` |
| build:pkg | `pkg` to produce Windows exe |

### CI/CD notes (GitHub Actions)

The repo already includes a Windows build-and-release workflow at [`.github/workflows/build-release.yml`] which:
- checks out code
- sets up Node.js 18
- installs dependencies
- runs `npm run build` to produce `dist/vrc-monitor.exe`
- packages artifacts into a ZIP and publishes a GitHub Release

## Troubleshooting

- Login or session issues:
  - Remove `session.json` located next to the executable or in the project root and re-run the login flow.
- No sound:
  - Ensure `alert.mp3` and `vendor/ffplay` or `vendor/ffplay.exe` exist next to the exe.
- Notifications not shown on Windows:
  - Ensure `vendor/SnoreToast.exe` is present or that `node-notifier` vendor files are included.
- Block list not updating:
  - Check `blockedGroupsRemoteUrl` in [`config.json`] and network access.
- Log detection fails:
  - The app auto-detects VRChat log directories; enable debug mode to see detection attempts and errors in `debug.log`.

## Contributing

- Issues: open with reproduction steps, Node.js version, platform, and expected behavior.
- Pull requests:
  - Fork → branch → PR to `master`.
  - Keep PRs small and testable.
- Code style:
  - ES modules; consider adding ESLint + Prettier.
- Commit messages:
  - Prefer Conventional Commits: `feat/auth: add 2FA retry` or `fix(play): correct ffplay lookup`.

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE:1).

## Contact

- Maintainer: Wolfyo
