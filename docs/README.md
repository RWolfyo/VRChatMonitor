# VRChat Monitor Documentation

Complete documentation index for VRChat Monitor.

## Getting Started

**New users start here:**

1. **[Main README](../README.md)** - Overview, quick start, features
2. **[Setup Guide](SETUP.md)** - Installation and initial configuration
3. **[Interactive Commands](COMMANDS.md)** - Command system reference
4. **[Configuration Reference](CONFIGURATION.md)** - All config options explained

## User Guides

### Usage

- **[Interactive Commands](COMMANDS.md)** - Command system guide
  - Available commands (help, test-alert, status, etc.)
  - Command aliases
  - Real-time interaction
  - Command examples

### Setup & Configuration

- **[Setup Guide](SETUP.md)** - Complete installation guide
  - Standalone executable setup
  - First-time login
  - Discord webhook setup
  - VR overlay setup (VRCX/XSOverlay)
  - Audio alerts
  - Desktop notifications

- **[Configuration Reference](CONFIGURATION.md)** - Detailed config documentation
  - VRChat authentication
  - Notification channels (Desktop, Discord, VR)
  - Audio alerts
  - Blocklist auto-updates
  - Logging and debugging
  - Advanced settings
  - Example configurations

### Blocklist Management

- **[Blocklist Management](BLOCKLIST.md)** - SQLite database guide
  - Database schema
  - Checking logic
  - Managing entries (add/remove/update)
  - Creating custom blocklists
  - Auto-update system
  - Regex patterns
  - Best practices

### Support

- **[Troubleshooting Guide](TROUBLESHOOTING.md)** - Common issues and solutions
  - Authentication issues
  - Log monitoring problems
  - Configuration errors
  - Native module issues
  - Notification problems
  - Performance issues
  - Debug mode

## Developer Documentation

### Building from Source

- **[Building Guide](BUILDING.md)** - Developer setup
  - Prerequisites
  - Development environment
  - Build process (compile, copy, SEA)
  - Project structure
  - Dependencies
  - Build configuration
  - Common build issues
  - GitHub Actions CI/CD

### Technical Details

- **[BUILDING.md](BUILDING.md)** - Build instructions and development guide
  - Node.js SEA packaging
  - Native module handling
  - Technology stack
  - Session management
  - Performance notes

## Quick Reference

### Common Tasks

| Task | Documentation |
|------|---------------|
| Install the application | [Setup Guide](SETUP.md) |
| View available commands | [Commands Reference](COMMANDS.md) |
| Test notifications | Type `test-alert` in app |
| Configure Discord webhooks | [Setup Guide](SETUP.md#discord-webhook-setup) |
| Setup VR overlay | [Setup Guide](SETUP.md#vr-overlay-setup) |
| Add blocked group | [Blocklist Management](BLOCKLIST.md#managing-the-database) |
| Fix authentication | [Troubleshooting](TROUBLESHOOTING.md#authentication-issues) |
| Enable debug logging | [Configuration Reference](CONFIGURATION.md#logging) |
| Build from source | [Building Guide](BUILDING.md) |
| Understand config options | [Configuration Reference](CONFIGURATION.md) |

### File Locations

| File | Location | Purpose |
|------|----------|---------|
| `config.json` | Executable directory | Configuration |
| `blocklist.db` | Executable directory | SQLite blocklist database |
| `.cache/session.sqlite` | `.cache/` | Session cookies |
| `.cache/debug.log` | `.cache/` | Debug logs (if enabled) |
| `alert.mp3` | Executable directory | Default alert sound |
| `native/better_sqlite3.node` | `native/` | Native SQLite module |
| `vendor/ffplay.exe` | `vendor/` | Audio playback (FFmpeg) |
| `vendor/SnoreToast.exe` | `vendor/` | Desktop notifications |

### Configuration Examples

**Minimal (Desktop only):**
```json
{
  "vrchat": { "username": "", "password": "" },
  "notifications": { "desktop": { "enabled": true } }
}
```

**Discord alerts:**
```json
{
  "notifications": {
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/..."
    }
  }
}
```

**VR overlay:**
```json
{
  "notifications": {
    "vrcx": { "enabled": true, "xsOverlay": true }
  }
}
```

**Debug mode:**
```json
{
  "logging": { "level": "debug", "file": true }
}
```

### Quick Troubleshooting

| Issue | Quick Fix |
|-------|-----------|
| Session not saving | Delete `.cache/session.sqlite` |
| Auth failed | Verify credentials, check 2FA |
| No logs detected | Ensure VRChat is running |
| Config not found | Place in same directory as .exe |
| Native module error | Check `native/better_sqlite3.node` exists |

## Documentation Structure

```
docs/
├── README.md              # This file (documentation index)
├── SETUP.md               # Installation and setup guide
├── COMMANDS.md            # Interactive command reference
├── CONFIGURATION.md       # Configuration reference
├── BLOCKLIST.md           # Blocklist management
├── TROUBLESHOOTING.md     # Common issues and solutions
└── BUILDING.md            # Developer build guide
```

## External Resources

- **GitHub Repository**: https://github.com/RWolfyo/VRChatMonitor
- **VRChat API Documentation**: https://vrchat.community/javascript
- **VRCX Project**: https://github.com/vrcx-team/VRCX
- **XSOverlay**: https://store.steampowered.com/app/1173510/XSOverlay/

## Support

- **GitHub Issues**: https://github.com/RWolfyo/VRChatMonitor/issues
- **Main README**: [../README.md](../README.md)

## Contributing

See [Building Guide](BUILDING.md) for development setup and contribution guidelines.

---

**Version**: 2.0.2
**Last Updated**: 2025-11-02
