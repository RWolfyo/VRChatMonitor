# VRChat Monitor v2

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Advanced VRChat Instance Monitoring & Moderation Tool**

Real-time monitoring of VRChat instances with SQLite blocklist checking and multi-channel alerts (Desktop, Discord, Audio, VR Overlay).

## ✨ Features

- 🔍 **Real-time Log Monitoring** - Automatically detects player join/leave events
- 🚫 **SQLite Blocklist System** - Fast, indexed database with 86+ groups
- 🔄 **Auto-updating Blocklists** - Fetches updates from remote sources
- 🔔 **Multi-Channel Alerts**:
  - Desktop notifications (Windows toast)
  - Discord webhooks with rich embeds
  - Audio alerts (FFmpeg)
  - VR overlay (VRCX & XSOverlay)
- 🔐 **Full 2FA Support** - TOTP, OTP, Email verification
- 💾 **Session Persistence** - SQLite-based session storage
- 📦 **Single Executable** - Node.js SEA packaging

## 📋 Requirements

- **Windows 10/11** (64-bit)
- **VRChat** installed and running
- **VRChat Account** with credentials

## 🚀 Quick Start

### Download & Run

1. **Download** the latest release from [Releases](../../releases)
2. **Extract** the archive
3. **Run** `vrc-monitor-v2.exe`
4. **Login** when prompted (credentials saved for next time)

### First Run

```bash
# The app will prompt you for:
Username: your_vrchat_username
Password: ********
2FA Code: 123456  # If 2FA enabled
```

Your credentials and session are saved automatically. On subsequent runs, you'll be logged in instantly.

### Testing Notifications

Before relying on the monitor, test all your configured notification channels:

```bash
vrc-monitor-v2.exe --test-alert
```

This will:
- ✅ Send test alerts to ALL configured channels (Desktop, Discord, Audio, VR)
- 📊 Show which channels are enabled/disabled
- 🔍 Verify Discord webhooks and other integrations work
- 🎵 Test audio volume levels
- ⏱️ Exit automatically after 3 seconds

**Tip:** Run this after configuring Discord webhooks or changing notification settings to ensure everything works!

## ⚙️ Configuration

Edit `config.json` to enable features:

```json
{
  "vrchat": {
    "username": "",  // Optional: pre-fill or leave empty to prompt
    "password": ""
  },
  "notifications": {
    "desktop": { "enabled": true, "sound": true },
    "discord": { "enabled": false, "webhookUrl": "" },
    "vrcx": { "enabled": false, "xsOverlay": false }
  },
  "audio": { "enabled": true, "volume": 0.5 },
  "blocklist": {
    "autoUpdate": true,
    "remoteUrl": "https://example.com/blocklist.db",
    "updateInterval": 60
  }
}
```

See **[Configuration Guide](docs/CONFIGURATION.md)** for all options.

## 📚 Documentation

- **[Setup Guide](docs/SETUP.md)** - Installation, configuration, Discord webhooks, VR overlays
- **[Configuration Reference](docs/CONFIGURATION.md)** - All config options explained
- **[Blocklist Management](docs/BLOCKLIST.md)** - SQLite database schema and management
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[Building from Source](docs/BUILDING.md)** - Developer build instructions

## 🔄 How It Works

1. Monitors VRChat log files for player join events
2. Fetches player's groups via VRChat API (cached)
3. Checks against SQLite blocklist database
4. Sends alerts to all enabled channels if matched
5. Auto-updates blocklist periodically

## 🛠️ Technology Stack

- **TypeScript 5.7** + **Node.js 22+**
- **SQLite** (better-sqlite3) - Blocklist & session storage
- **vrchat@2.20.4** - Official VRChat API
- **Node.js SEA** - Single Executable Application

## 🐛 Troubleshooting

### Quick Fixes

- **Session issues**: Delete `.cache/session.sqlite` and re-login
- **Authentication failed**: Verify credentials, check 2FA code
- **No logs detected**: Ensure VRChat is running and installed in default location

See **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)** for detailed solutions.

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/RWolfyo/VRChatMonitor/issues)
- **Documentation**: See `docs/` folder

## 🎯 Roadmap

### ✅ Completed (v2.0.0)
- Complete TypeScript rewrite
- SQLite blocklist with auto-updates
- User blocklist checking (block individual users)
- Node.js SEA packaging
- VRChat API with session persistence
- Multi-channel notifications (Desktop, Discord, Audio, VR)
- VRCX & XSOverlay VR overlay integration

### 📋 Planned
- Blocklist management web dashboard

## 🙏 Credits

- Built on [VRChatMonitor](https://github.com/RWolfyo/VRChatMonitor)
- [vrchat@2.20.4](https://www.npmjs.com/package/vrchat) from [vrchat.community](https://vrchat.community/javascript)
- [better-sqlite3](https://www.npmjs.com/package/better-sqlite3)
- [FFmpeg](https://ffmpeg.org/), [SnoreToast](https://github.com/KDE/snoretoast)
- Inspired by [VRCX](https://github.com/vrcx-team/VRCX)

## 📜 License

MIT License - See [LICENSE](LICENSE)

## ⚠️ Disclaimer

VRChat Monitor v2 is not endorsed by VRChat and does not reflect the views of VRChat Inc. Uses VRChat API in accordance with their Terms of Service.

---

**Made with ❤️ for the VRChat community**
