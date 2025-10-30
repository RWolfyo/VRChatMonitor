# Configuration Reference

Complete reference for all configuration options in `config.json`.

## Configuration File Location

The application searches for `config.json` in the following order:

1. Executable directory (same folder as `.exe`)
2. Current working directory
3. `build/` directory
4. `config/` directory

## Full Configuration Example

```json
{
  "vrchat": {
    "username": "",
    "password": ""
  },
  "notifications": {
    "desktop": {
      "enabled": true,
      "sound": true
    },
    "discord": {
      "enabled": false,
      "webhookUrl": "",
      "mentionRoles": []
    },
    "vrcx": {
      "enabled": false,
      "xsOverlay": false
    }
  },
  "audio": {
    "enabled": true,
    "volume": 0.5,
    "filePath": ""
  },
  "blocklist": {
    "autoUpdate": true,
    "remoteUrl": "https://example.com/blocklist.db",
    "updateInterval": 60
  },
  "logging": {
    "level": "info",
    "file": false
  },
  "advanced": {
    "cacheDir": "",
    "deduplicateWindow": 30
  }
}
```

## Configuration Sections

### VRChat Authentication

```json
{
  "vrchat": {
    "username": "your_vrchat_username",
    "password": "your_vrchat_password"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `username` | `string` | `""` | VRChat username (optional, will prompt if empty) |
| `password` | `string` | `""` | VRChat password (optional, will prompt if empty) |

**Notes:**
- Leave empty to be prompted on first run
- Credentials saved automatically after successful login
- 2FA codes always prompted when required (never saved)
- Session persists in `.cache/session.sqlite` for 24 hours

**Environment Variable Overrides:**
- `VRCHAT_USERNAME` - Override username
- `VRCHAT_PASSWORD` - Override password

---

### Desktop Notifications

```json
{
  "notifications": {
    "desktop": {
      "enabled": true,
      "sound": true
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable Windows toast notifications |
| `sound` | `boolean` | `true` | Play system notification sound |

**Technical Details:**
- Uses SnoreToast.exe for Windows 10/11 native notifications
- Falls back to node-notifier if SnoreToast unavailable
- Rate limited to 2 seconds minimum between notifications
- Requires `vendor/SnoreToast.exe` in distribution

**Notification Content:**
- Title: User's display name
- Body: First match reason
- Icon: Custom app icon (if configured)

---

### Discord Webhooks

```json
{
  "notifications": {
    "discord": {
      "enabled": false,
      "webhookUrl": "https://discord.com/api/webhooks/1234567890/abcdef...",
      "mentionRoles": ["123456789012345678", "987654321098765432"]
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable Discord webhook notifications |
| `webhookUrl` | `string` | `""` | Discord webhook URL (required if enabled) |
| `mentionRoles` | `string[]` | `[]` | Array of role IDs to mention in alerts |

**Environment Variable Override:**
- `DISCORD_WEBHOOK` - Override webhook URL

**Webhook Features:**
- Rich embeds with severity-based colors
- Multiple match details in single embed
- User ID and VRChat profile link
- Timestamp for each alert
- Role mentions for critical alerts
- Rate limiting (2 seconds minimum)
- Message queue with retry logic (max 3 retries)
- Queue size limit (100 messages)

**Severity Colors:**
- 🔴 High: `#ed4245` (Red)
- 🟡 Medium: `#fee75c` (Yellow)
- 🟢 Low: `#57f287` (Green)
- 🔵 Info: `#5865f2` (Blurple)

**Match Type Icons:**
- 🚫 Blocked Group
- 🔍 Group Keyword Match
- 👤 User Keyword Match

---

### VR Overlay (VRCX & XSOverlay)

```json
{
  "notifications": {
    "vrcx": {
      "enabled": false,
      "xsOverlay": false
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable VRCX VR overlay notifications |
| `xsOverlay` | `boolean` | `false` | Enable XSOverlay (fallback or standalone) |

**VRCX Technical Details:**
- Protocol: Windows Named Pipe IPC
- Pipe name: `\\.\\pipe\\vrcx-ipc-{hash}` (hash from Windows username)
- Packet format: JSON with null terminator
- Connection timeout: 1 second
- Automatic fallback if unavailable

**XSOverlay Technical Details:**
- Protocol: UDP broadcast
- Port: 42069
- Host: 127.0.0.1 (localhost)
- Message type: 1 (notification)
- Height: 110px
- Timeout: 5000ms
- Opacity: 1.0

**Fallback Behavior:**
- If both enabled: Try VRCX first, fall back to XSOverlay on failure
- If only one enabled: Use that method only
- Graceful failure if neither available

**Notification Format:**
```
⚠️ [SEVERITY] DisplayName - Reason
```

Example: `⚠️ [HIGH] BadActor123 - Member of blocked group: Crasher Gang`

---

### Audio Alerts

```json
{
  "audio": {
    "enabled": true,
    "volume": 0.5,
    "filePath": ""
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable audio alerts |
| `volume` | `number` | `0.5` | Volume level (0.0 to 1.0) |
| `filePath` | `string` | `""` | Custom sound file path (optional) |

**Default Behavior:**
- Uses `alert.mp3` in executable directory
- Requires `vendor/ffplay.exe` (FFmpeg)
- Mutex lock prevents overlapping playback
- 10-second timeout per playback

**Custom Sound Files:**
- Absolute or relative path
- Supported formats: MP3, WAV, OGG, FLAC, any FFmpeg-compatible format
- Example: `"filePath": "C:/sounds/custom-alert.wav"`

**Volume Control:**
- Range: 0.0 (silent) to 1.0 (100%)
- Applied via FFmpeg volume filter
- Example: `0.5` = 50% volume

**Technical Details:**
- Uses `ffplay.exe` with flags: `-nodisp -autoexit -loglevel quiet`
- Volume filter: `-af volume={volume}`
- Hidden console window on Windows
- Automatic cleanup after playback

---

### Blocklist Management

```json
{
  "blocklist": {
    "autoUpdate": true,
    "remoteUrl": "https://example.com/blocklist.db",
    "updateInterval": 60
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoUpdate` | `boolean` | `true` | Enable automatic blocklist updates |
| `remoteUrl` | `string` | `""` | URL to remote SQLite database |
| `updateInterval` | `number` | `60` | Minutes between update checks |

**Auto-Update Process:**
1. Periodic check every N minutes
2. Download remote SQLite database
3. Verify database validity (SQLite magic header)
4. Compare file hash with local copy
5. Replace local copy if different
6. Recompile regex patterns
7. Emit version mismatch notification if detected

**Version Mismatch Handling:**
- Checks `metadata` table for app version
- Sends desktop + Discord notification if version differs
- Continues using updated blocklist (no automatic app update)

**Manual Updates:**
- Replace `blocklist.db` with new file
- Restart application to reload

---

### Logging

```json
{
  "logging": {
    "level": "info",
    "file": false
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | `string` | `"info"` | Log level: `error`, `warn`, `info`, `debug` |
| `file` | `boolean` | `false` | Write logs to file (`.cache/debug.log`) |

**Environment Variable Override:**
- `LOG_LEVEL` - Override log level

**Log Levels:**

| Level | Description | Use Case |
|-------|-------------|----------|
| `error` | Only errors | Production (minimal) |
| `warn` | Errors + warnings | Production |
| `info` | Normal operation | Default (recommended) |
| `debug` | Verbose output | Troubleshooting |

**File Logging:**
- Location: `.cache/debug.log`
- Format: Timestamp + level + message + metadata
- No automatic rotation (manual cleanup required)
- Includes stack traces for errors

**Console Output:**
- Always enabled
- Colorized output
- Structured logging with Winston

---

### Advanced Settings

```json
{
  "advanced": {
    "cacheDir": "",
    "deduplicateWindow": 30
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cacheDir` | `string` | `""` | Custom cache directory path |
| `deduplicateWindow` | `number` | `30` | Seconds to dedupe join events |

#### Cache Directory

**Default Behavior:**
- Uses `.cache/` in executable directory
- Contains:
  - `session.sqlite` - Session cookies
  - `debug.log` - Log file (if enabled)

**Custom Path:**
```json
{
  "advanced": {
    "cacheDir": "C:/custom/path/.cache"
  }
}
```

**Notes:**
- Must be absolute path
- Directory created automatically if missing
- Requires write permissions

#### Deduplication Window

**Purpose:**
- Prevents duplicate alerts for the same user
- Common when player rejoins quickly
- Reduces notification spam

**How it works:**
1. Player joins → Record userId + timestamp
2. Same player joins again → Check if within window
3. If within window → Ignore (no alert)
4. If outside window → Process normally

**Recommended Values:**
- `30` - Default, works for most cases
- `60` - More aggressive deduplication
- `10` - Less deduplication (more alerts)
- `0` - Disable deduplication (not recommended)

**Memory Management:**
- Old join records cleaned up automatically
- Cleanup interval: 2x dedupe window
- Prevents memory leaks

---

## Minimal Configuration

Bare minimum to get started:

```json
{
  "vrchat": {
    "username": "",
    "password": ""
  },
  "notifications": {
    "desktop": { "enabled": true }
  }
}
```

All other fields use defaults.

---

## Example Configurations

### Silent Monitoring (Discord Only)

```json
{
  "notifications": {
    "desktop": { "enabled": false },
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/..."
    }
  },
  "audio": { "enabled": false }
}
```

### VR-Only Alerts

```json
{
  "notifications": {
    "desktop": { "enabled": false },
    "vrcx": {
      "enabled": true,
      "xsOverlay": true
    }
  },
  "audio": { "enabled": false }
}
```

### Maximum Alerts

```json
{
  "notifications": {
    "desktop": { "enabled": true, "sound": true },
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/...",
      "mentionRoles": ["123456789012345678"]
    },
    "vrcx": { "enabled": true, "xsOverlay": true }
  },
  "audio": { "enabled": true, "volume": 1.0 }
}
```

### Debug Mode

```json
{
  "logging": {
    "level": "debug",
    "file": true
  }
}
```

---

## Validation

The application validates configuration on startup:

**Common Validation Errors:**
- Invalid JSON syntax
- Missing required fields
- Invalid data types
- Out-of-range values (e.g., volume > 1.0)

**Error Messages:**
- Descriptive error with field name
- Suggests default value
- Application continues with defaults if possible

---

## Configuration Precedence

Settings are resolved in this order:

1. **Environment Variables** (highest priority)
2. **config.json** file
3. **Default Values** (lowest priority)

Example:
```bash
# Config file has: "username": "alice"
# But environment variable overrides:
set VRCHAT_USERNAME=bob

# Application uses: "bob"
```

---

## Next Steps

- **[Setup Guide](SETUP.md)** - Configure specific features
- **[Blocklist Management](BLOCKLIST.md)** - Customize blocklist
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix configuration issues
