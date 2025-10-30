# Configuration Guide

This file explains all configuration options for VRChat Monitor v2.

## Logging Levels

The `logging.level` option supports the following levels (from least to most verbose):

- **`error`** - Only errors
- **`warn`** - Warnings and errors
- **`info`** - General information, warnings, and errors (default)
- **`debug`** - Debug information for troubleshooting
- **`verbose`** - **Extremely detailed logging including:**
  - Full API request/response data for all VRChat API calls
  - Complete user profile data (displayName, bio, tags, etc.)
  - All group information (id, name, description)
  - Detailed blocklist checking steps
  - All database query results
  - Pattern matching details

### Verbose Logging Example

Set `"level": "verbose"` in config.json to see output like:

```json
{
  "logging": {
    "level": "verbose",
    "file": false
  }
}
```

**Sample verbose output:**
```
[12:34:56] silly: API Request: getUserGroups
{
  "userId": "usr_12345678-1234-1234-1234-123456789abc"
}

[12:34:57] silly: API Response: getUserGroups
{
  "userId": "usr_12345678-1234-1234-1234-123456789abc",
  "success": true,
  "groupCount": 3,
  "groups": [
    {
      "id": "grp_11111111-1111-1111-1111-111111111111",
      "name": "Example Group",
      "description": "A sample group description",
      ...
    }
  ]
}

[12:34:57] silly: BlocklistManager: Checking group
{
  "groupId": "grp_11111111-1111-1111-1111-111111111111",
  "groupName": "Example Group",
  "groupDescription": "A sample group description"
}
```

**Warning:** Verbose logging produces **very large amounts of output** and may contain sensitive user data. Only use for debugging purposes.

## Other Configuration Options

### VRChat Credentials
```json
"vrchat": {
  "username": "",  // Optional: Pre-fill login username
  "password": ""   // Optional: Pre-fill login password
}
```

### Notifications
```json
"notifications": {
  "desktop": {
    "enabled": true,   // Windows toast notifications
    "sound": true      // Play sound with notification
  },
  "discord": {
    "enabled": false,
    "webhookUrl": "",       // Discord webhook URL
    "mentionRoles": []      // Role IDs to mention
  },
  "vrcx": {
    "enabled": false,      // VRCX overlay notifications
    "xsOverlay": false     // XSOverlay VR notifications
  }
}
```

### Audio Alerts
```json
"audio": {
  "enabled": true,
  "volume": 0.5,          // 0.0 to 1.0
  "filePath": ""          // Custom alert sound (optional)
}
```

### Blocklist
```json
"blocklist": {
  "autoUpdate": true,
  "remoteUrl": "https://vrcm.winter.tf/blocklist.db",
  "updateInterval": 60    // Minutes between updates
}
```

### Advanced
```json
"advanced": {
  "cacheDir": "",                // Custom cache directory
  "deduplicateWindow": 30        // Seconds to suppress duplicate alerts
}
```
