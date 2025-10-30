# Setup Guide

Complete installation and setup guide for VRChat Monitor v2.

## Installation

### Option 1: Standalone Executable (Recommended)

1. **Download** the latest release from [Releases](https://github.com/RWolfyo/VRChatMonitor/releases)

2. **Extract** the archive - you should have:
   ```
   vrc-monitor-v2/
   ├── vrc-monitor-v2.exe       # Main executable
   ├── config.json              # Configuration file
   ├── blocklist.db             # SQLite blocklist (86+ groups)
   ├── alert.mp3                # Default alert sound
   ├── native/
   │   └── better_sqlite3.node  # Native SQLite module
   └── vendor/
       ├── ffplay.exe           # FFmpeg audio player (full static)
       └── SnoreToast.exe       # Windows notification tool
   ```

3. **Run** `vrc-monitor-v2.exe` from a terminal or double-click

### Option 2: From Source

See [Building from Source](BUILDING.md) for developer setup.

## First-Time Setup

### Interactive Login

On first run, you'll be prompted for credentials:

```bash
VRChat Monitor v2
─────────────────
Enter VRChat username: your_username
Enter VRChat password: ******** (hidden)
Enter 2FA code (if enabled): 123456
```

### Pre-Configure Credentials (Optional)

Edit `config.json` before first run:

```json
{
  "vrchat": {
    "username": "your_vrchat_username",
    "password": "your_vrchat_password"
  }
}
```

**Note**: Even with saved credentials, you'll still need to provide 2FA codes when prompted.

### Session Persistence

After successful login:
- ✅ Credentials saved to `config.json`
- ✅ Session cookies saved to `.cache/session.sqlite`
- ✅ No re-login needed on subsequent runs (until session expires)

Sessions last 24 hours or until invalidated by VRChat.

## Discord Webhook Setup

Send alerts to Discord with rich embeds.

### Create Webhook

1. Open your Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **New Webhook**
4. Name it (e.g., "VRChat Monitor")
5. Select the channel for alerts
6. Click **Copy Webhook URL**

### Configure

Edit `config.json`:

```json
{
  "notifications": {
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/1234567890/abcdef...",
      "mentionRoles": ["123456789012345678"]  // Optional: role IDs to mention
    }
  }
}
```

### Discord Features

**Rich Embeds** with severity colors:
- 🔴 High: Red (#ed4245)
- 🟡 Medium: Yellow (#fee75c)
- 🟢 Low: Green (#57f287)

**Match Type Icons**:
- 🚫 Blocked Group
- 🔍 Group Keyword Match
- 👤 User Keyword Match

**Additional Features**:
- User ID and VRChat profile links
- Timestamps
- Multiple match details in single embed
- Role mentions for critical alerts
- Rate limiting (2 second minimum between messages)

### Finding Role IDs

1. Enable **Developer Mode** in Discord (User Settings → Advanced)
2. Right-click the role → **Copy ID**
3. Add to `mentionRoles` array in config

## VR Overlay Setup

Get alerts directly in VR!

### VRCX Integration (Recommended)

**Requirements:**
- [VRCX](https://github.com/vrcx-team/VRCX) installed and running
- Windows Named Pipes (automatic)

**Setup:**

1. Download and install [VRCX](https://github.com/vrcx-team/VRCX/releases/latest)
2. Launch VRCX **before** starting VRChat Monitor
3. Enable in `config.json`:
   ```json
   {
     "notifications": {
       "vrcx": {
         "enabled": true,
         "xsOverlay": false
       }
     }
   }
   ```
4. Run VRChat Monitor - it will test the connection on startup
5. Alerts will appear in VRCX's VR overlay!

**How it works:**
- Connects via Windows Named Pipe (`\\.\\pipe\\vrcx-ipc-{hash}`)
- Hash calculated from Windows username
- Sends JSON packets with notifications
- 1-second connection timeout with graceful failure

**Testing:**
On startup, you'll see:
```
Testing VRCX connection...
✓ VRCX connection successful
```

### XSOverlay Integration (Alternative)

**Requirements:**
- [XSOverlay](https://store.steampowered.com/app/1173510/XSOverlay/) (paid, ~$14)
- UDP port 42069 available

**Setup:**

1. Purchase and install XSOverlay from Steam
2. Launch XSOverlay before starting VRChat
3. Enable in `config.json`:
   ```json
   {
     "notifications": {
       "vrcx": {
         "enabled": false,
         "xsOverlay": true
       }
     }
   }
   ```

### Fallback Mode

Enable both for automatic fallback:

```json
{
  "notifications": {
    "vrcx": {
      "enabled": true,    // Try VRCX first
      "xsOverlay": true   // Fall back to XSOverlay if VRCX unavailable
    }
  }
}
```

### VR Notification Format

```
⚠️ [HIGH] BadActor123 - Member of blocked group: Crasher Gang
```

Shows:
- Severity level (LOW/MEDIUM/HIGH)
- Display name
- Reason for blocking

## Audio Alerts Setup

Play custom sounds when blocked users join.

### Default Setup

Audio alerts work out of the box with:
- `alert.mp3` included in release
- `ffplay.exe` (FFmpeg) in `vendor/` directory
- Default volume: 0.5 (50%)

### Custom Sound

Replace `alert.mp3` or specify custom path:

```json
{
  "audio": {
    "enabled": true,
    "volume": 0.8,  // 0.0 to 1.0
    "filePath": "C:/path/to/custom-sound.mp3"
  }
}
```

Supported formats: MP3, WAV, OGG, FLAC (anything FFmpeg supports)

### Disable Audio

```json
{
  "audio": {
    "enabled": false
  }
}
```

## Desktop Notifications Setup

Windows 10/11 toast notifications are enabled by default.

### Configure

```json
{
  "notifications": {
    "desktop": {
      "enabled": true,
      "sound": true  // System notification sound
    }
  }
}
```

### Disable

```json
{
  "notifications": {
    "desktop": {
      "enabled": false
    }
  }
}
```

**Note**: Uses SnoreToast.exe for native Windows 10/11 toast notifications.

## Blocklist Setup

### Default Blocklist

The release includes a pre-configured `blocklist.db` with 86+ groups.

### Remote Auto-Updates

Configure automatic blocklist updates:

```json
{
  "blocklist": {
    "autoUpdate": true,
    "remoteUrl": "https://example.com/blocklist.db",
    "updateInterval": 60  // Minutes between checks
  }
}
```

**How it works:**
- Periodic checks every N minutes
- Downloads remote SQLite database
- Verifies validity before replacing local copy
- File hash comparison avoids unnecessary updates
- Notifies if app version mismatch detected

### Disable Auto-Updates

```json
{
  "blocklist": {
    "autoUpdate": false
  }
}
```

### Custom Blocklist

Replace `blocklist.db` with your own SQLite database. See [Blocklist Management](BLOCKLIST.md) for schema details.

## Advanced Configuration

### Custom Cache Directory

```json
{
  "advanced": {
    "cacheDir": "C:/custom/path/.cache"
  }
}
```

Default: `.cache/` in executable directory

### Deduplication Window

Prevent duplicate alerts for the same user:

```json
{
  "advanced": {
    "deduplicateWindow": 30  // Seconds
  }
}
```

Default: 30 seconds (recommended)

### Debug Logging

Enable file logging for troubleshooting:

```json
{
  "logging": {
    "level": "debug",  // error | warn | info | debug
    "file": true       // Write to .cache/debug.log
  }
}
```

**Log levels:**
- `error`: Only errors
- `warn`: Errors + warnings
- `info`: Normal operation (default)
- `debug`: Verbose output

Check `.cache/debug.log` for detailed logs.

## Environment Variables

Override config values with environment variables:

```bash
# Windows Command Prompt
set VRCHAT_USERNAME=myusername
set VRCHAT_PASSWORD=mypassword
set DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
set LOG_LEVEL=debug

vrc-monitor-v2.exe

# Windows PowerShell
$env:VRCHAT_USERNAME="myusername"
$env:VRCHAT_PASSWORD="mypassword"
$env:DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
$env:LOG_LEVEL="debug"

.\vrc-monitor-v2.exe
```

**Available variables:**
- `VRCHAT_USERNAME`
- `VRCHAT_PASSWORD`
- `DISCORD_WEBHOOK`
- `LOG_LEVEL`

## Running as a Service

### Windows Task Scheduler

1. Open **Task Scheduler**
2. **Create Basic Task**
3. Name: "VRChat Monitor"
4. Trigger: **When I log on**
5. Action: **Start a program**
6. Program: `C:\path\to\vrc-monitor-v2.exe`
7. ✅ Enable **Run whether user is logged on or not**

### Background Mode

The application runs in the console. To hide the window, use a tool like:
- [Hidden Start](https://github.com/stax76/OpenWithPlusPlus)
- Windows Task Scheduler (run hidden)

## Verifying Setup

After setup, verify everything works:

### 1. Check Startup Messages

```
🔍 VRChat Monitor v2 initializing...
Initializing VRChat API...
✓ Authenticated as YourUsername
Initializing Discord service...
✓ Discord webhook test successful
Testing VRCX connection...
✓ VRCX connection successful
Initializing blocklist...
✓ Blocklist loaded: 86 blocked groups, 15 keywords, 5 whitelist groups
✅ VRChat Monitor started successfully
🔍 Monitoring your instance for blocked users...
```

### 2. Test Notifications

- **Desktop**: Should see a test notification on startup (if enabled)
- **Discord**: Check webhook channel for test message
- **VRCX**: Should see connection test in VRCX overlay
- **Audio**: Manually trigger or wait for first alert

### 3. Check Logs

If issues occur, check `.cache/debug.log` with debug logging enabled.

## Next Steps

- **[Configuration Reference](CONFIGURATION.md)** - Explore all configuration options
- **[Blocklist Management](BLOCKLIST.md)** - Customize your blocklist
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix common issues

## Support

- **Issues**: [GitHub Issues](https://github.com/RWolfyo/VRChatMonitor/issues)
- **Documentation**: [Main README](../README.md)
