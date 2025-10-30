# Troubleshooting Guide

Solutions to common issues and problems.

## Quick Fixes

| Problem | Solution |
|---------|----------|
| Session not persisting | Delete `.cache/session.sqlite` and re-login |
| Authentication failed | Verify credentials, check 2FA code, try re-login |
| No logs detected | Ensure VRChat is running and installed in default location |
| Config not found | Place `config.json` in same directory as `.exe` |
| Native module error | Ensure `native/better_sqlite3.node` exists |

---

## Authentication Issues

### "Authentication failed"

**Causes:**
- Incorrect username or password
- Invalid 2FA code
- VRChat API temporarily unavailable
- Expired session

**Solutions:**

1. **Verify credentials:**
   ```json
   {
     "vrchat": {
       "username": "correct_username",
       "password": "correct_password"
     }
   }
   ```

2. **Check 2FA code:**
   - Ensure time is synchronized (TOTP codes are time-based)
   - Try next code if current one expired
   - Check for typos

3. **Force re-login:**
   ```bash
   # Delete session file
   del .cache\session.sqlite  # Windows

   # Run app again
   vrc-monitor-v2.exe
   ```

4. **Check VRChat API status:**
   - Try logging into vrchat.com website
   - Check VRChat Status on Twitter

### "Session not persisting (asks for 2FA every time)"

**Cause:** Session file corrupted or not writable

**Solutions:**

1. **Check file exists:**
   ```bash
   # Should exist after successful login
   dir .cache\session.sqlite
   ```

2. **Check file permissions:**
   - Ensure `.cache/` directory is writable
   - Run as administrator if needed (not recommended long-term)

3. **Delete and recreate:**
   ```bash
   del .cache\session.sqlite
   # Run app and login again
   ```

4. **Check for antivirus interference:**
   - Some antivirus software blocks SQLite writes
   - Add `.cache/` to antivirus exclusions

### "Invalid 2FA code"

**Causes:**
- System time not synchronized
- Code expired (30-second window for TOTP)
- Wrong 2FA method

**Solutions:**

1. **Synchronize system time:**
   - Windows: Settings → Time & Language → Sync now
   - Use automatic time synchronization

2. **Wait for next code:**
   - TOTP codes change every 30 seconds
   - Wait for fresh code before entering

3. **Check 2FA method:**
   - TOTP: Authenticator app code
   - OTP: Recovery code
   - Email: Check email for code

---

## Log Monitoring Issues

### "Could not auto-detect VRChat log directory"

**Cause:** VRChat not installed in default location or not run yet

**Solutions:**

1. **Check VRChat installation:**
   - Windows: `%USERPROFILE%\AppData\LocalLow\VRChat\VRChat`
   - Linux (Proton): `~/.steam/steam/steamapps/compatdata/438100/pfx/drive_c/users/steamuser/AppData/LocalLow/VRChat/VRChat`
   - macOS: `~/Library/Application Support/VRChat/VRChat`

2. **Run VRChat at least once:**
   - Log directory created on first run
   - Exit and restart VRChat Monitor

3. **Check directory exists:**
   ```bash
   # Windows
   dir "%USERPROFILE%\AppData\LocalLow\VRChat\VRChat"

   # Linux
   ls -la ~/.steam/steam/steamapps/compatdata/438100/pfx/drive_c/users/steamuser/AppData/LocalLow/VRChat/VRChat
   ```

### "No output_log files found"

**Cause:** VRChat not running or hasn't created logs yet

**Solutions:**

1. **Start VRChat:**
   - Log files created when VRChat starts
   - Join any world to generate logs

2. **Check for log files:**
   ```bash
   # Windows
   dir "%USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log*.txt"
   ```

3. **Verify permissions:**
   - Ensure VRChat Monitor can read log directory
   - Check antivirus isn't blocking file access

---

## Configuration Issues

### "config.json not found"

**Cause:** Config file missing or in wrong location

**Solutions:**

1. **Check file location:**
   - Must be in same directory as `vrc-monitor-v2.exe`
   - Or in `config/` subdirectory

2. **Check filename:**
   - Must be exactly `config.json`
   - Not `config.json.txt` (Windows hides extensions)
   - Case-sensitive on Linux/macOS

3. **Create default config:**
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

4. **Enable file extensions in Windows:**
   - File Explorer → View → Show file extensions
   - Ensure no hidden `.txt` extension

### "Invalid JSON syntax"

**Cause:** Malformed JSON in config file

**Common Issues:**
- Missing commas between fields
- Trailing comma after last field
- Unescaped backslashes in paths
- Single quotes instead of double quotes

**Solutions:**

1. **Validate JSON:**
   - Use online JSON validator: https://jsonlint.com
   - Check for syntax errors

2. **Common fixes:**
   ```json
   // ❌ Wrong
   {
     "vrchat": {
       "username": 'alice',  // Single quotes
       "password": "pass",   // Trailing comma
     }
   }

   // ✅ Correct
   {
     "vrchat": {
       "username": "alice",  // Double quotes
       "password": "pass"    // No trailing comma
     }
   }
   ```

3. **Escape backslashes in paths:**
   ```json
   // ❌ Wrong
   "cacheDir": "C:\Users\Alice\.cache"

   // ✅ Correct (use forward slashes or escaped backslashes)
   "cacheDir": "C:/Users/Alice/.cache"
   // OR
   "cacheDir": "C:\\Users\\Alice\\.cache"
   ```

---

## Native Module Issues

### "No such built-in module: better_sqlite3.node"

**Cause:** Native SQLite module missing from distribution

**Solutions:**

1. **Check file exists:**
   ```bash
   dir native\better_sqlite3.node  # Windows
   ls native/better_sqlite3.node   # Linux/macOS
   ```

2. **Verify distribution integrity:**
   - Re-download release archive
   - Ensure `native/` folder extracted correctly

3. **Copy from node_modules (if building from source):**
   ```bash
   copy node_modules\better-sqlite3\build\Release\better_sqlite3.node native\
   ```

4. **Check Node.js version match:**
   - Native module must match Node.js version
   - Rebuild if using different Node.js version:
     ```bash
     npm rebuild better-sqlite3
     ```

### "this.Database is not a constructor"

**Cause:** Native module loading failed or version mismatch

**Solutions:**

1. **Ensure native module exists:**
   ```bash
   dir native\better_sqlite3.node
   ```

2. **Check Node.js version:**
   - App built with Node.js 22+
   - Native module must match

3. **Verify SqliteLoader initialization:**
   - Should see "Initializing SQLite loader" in logs
   - Enable debug logging to check:
     ```json
     {
       "logging": {
         "level": "debug",
         "file": true
       }
     }
     ```

4. **Reinstall:**
   - Delete `native/` folder
   - Re-extract from release archive

---

## Notification Issues

### Desktop Notifications Not Appearing

**Causes:**
- Windows notifications disabled
- SnoreToast.exe missing
- Notification settings in Windows

**Solutions:**

1. **Check Windows notification settings:**
   - Settings → System → Notifications
   - Ensure notifications enabled
   - Allow notifications from unknown sources

2. **Verify SnoreToast.exe:**
   ```bash
   dir vendor\SnoreToast.exe
   ```

3. **Test notification manually:**
   ```bash
   vendor\SnoreToast.exe -t "Test" -m "Testing notifications"
   ```

4. **Check config:**
   ```json
   {
     "notifications": {
       "desktop": {
         "enabled": true
       }
     }
   }
   ```

### Discord Webhook Not Working

**Causes:**
- Invalid webhook URL
- Webhook deleted
- Network issues

**Solutions:**

1. **Test webhook manually:**
   ```bash
   curl -X POST -H "Content-Type: application/json" ^
     -d "{\"content\":\"Test message\"}" ^
     "YOUR_WEBHOOK_URL"
   ```

2. **Check webhook URL:**
   - Must start with `https://discord.com/api/webhooks/`
   - Includes ID and token
   - No spaces or newlines

3. **Verify webhook exists:**
   - Open Discord → Server Settings → Integrations → Webhooks
   - Ensure webhook still exists
   - Create new webhook if deleted

4. **Check network connectivity:**
   - Firewall blocking outbound HTTPS?
   - Proxy configuration needed?

5. **Enable debug logging:**
   ```json
   {
     "logging": {
       "level": "debug",
       "file": true
     }
   }
   ```
   Check `.cache/debug.log` for error details

### VRCX Not Receiving Notifications

**Causes:**
- VRCX not running
- Named pipe connection failed
- Incorrect username hash

**Solutions:**

1. **Ensure VRCX is running:**
   - Launch VRCX before VRChat Monitor
   - Check VRCX system tray icon

2. **Check connection test:**
   ```
   Testing VRCX connection...
   ✓ VRCX connection successful  # Should see this
   ```

3. **Verify pipe name:**
   - Enable debug logging
   - Check pipe name: `vrcx-ipc-{hash}`
   - Hash calculated from Windows username

4. **Enable XSOverlay fallback:**
   ```json
   {
     "notifications": {
       "vrcx": {
         "enabled": true,
         "xsOverlay": true
       }
     }
   }
   ```

### Audio Alerts Not Playing

**Causes:**
- ffplay.exe missing
- alert.mp3 missing
- Audio device issues

**Solutions:**

1. **Check required files:**
   ```bash
   dir vendor\ffplay.exe
   dir alert.mp3
   ```

2. **Test ffplay manually:**
   ```bash
   vendor\ffplay.exe -nodisp -autoexit alert.mp3
   ```

3. **Check volume level:**
   ```json
   {
     "audio": {
       "enabled": true,
       "volume": 0.8  // Try higher volume
     }
   }
   ```

4. **Verify audio device:**
   - Check Windows sound settings
   - Ensure audio output device is working
   - Test with other applications

---

## Performance Issues

### High CPU Usage

**Causes:**
- Frequent log file reads
- Excessive API calls
- Debug logging enabled

**Solutions:**

1. **Disable debug logging:**
   ```json
   {
     "logging": {
       "level": "info",  // Change from "debug"
       "file": false
     }
   }
   ```

2. **Increase dedupe window:**
   ```json
   {
     "advanced": {
       "deduplicateWindow": 60  // Reduce API calls
     }
   }
   ```

3. **Check for log file issues:**
   - Large log files (>100 MB) slow down reading
   - VRChat log rotation should handle this
   - Manually delete old logs if needed

### High Memory Usage

**Typical Usage:** 50-80 MB

**If Exceeding 200 MB:**

1. **Check cache size:**
   - API responses cached for 5 minutes
   - Automatic pruning should prevent growth

2. **Check dedupe map:**
   - Stores recent joins
   - Automatic cleanup at 2x dedupe window

3. **Restart application:**
   - Memory leaks should not occur
   - Report if persistent high memory

### Slow Startup

**Expected:** <2 seconds with session reuse

**If Exceeding 10 seconds:**

1. **Check session validity:**
   - Invalid sessions cause slow re-authentication
   - Delete `.cache/session.sqlite` if slow

2. **Check blocklist size:**
   - Large blocklists (>1000 groups) take longer to load
   - Regex compilation done at startup

3. **Check network:**
   - Auto-update check on startup
   - Slow network delays startup

---

## Duplicate Alert Issues

### Same User Triggering Multiple Alerts

**Cause:** Deduplication window too short or disabled

**Solution:**

```json
{
  "advanced": {
    "deduplicateWindow": 60  // Increase to 60 seconds
  }
}
```

### Deduplication Not Working

**Causes:**
- UserID mismatch
- Log file restart
- Memory cleared

**Solutions:**

1. **Check dedupe window:**
   ```json
   {
     "advanced": {
       "deduplicateWindow": 30  // Ensure not 0
     }
   }
   ```

2. **Enable debug logging:**
   - Check for "Ignoring duplicate join" messages
   - Verify userId consistency

3. **Normal behavior:**
   - Dedupe clears after 2x window
   - Alerts repeat if user rejoins after window expires

---

## Blocklist Issues

### Blocklist Not Loading

**Cause:** Database file corrupted or invalid

**Solutions:**

1. **Check file exists:**
   ```bash
   dir blocklist.db
   ```

2. **Verify SQLite database:**
   ```bash
   sqlite3 blocklist.db ".schema"
   # Should show table definitions
   ```

3. **Re-download blocklist:**
   - Delete `blocklist.db`
   - Copy from release archive
   - Or download from remote URL

4. **Check file permissions:**
   - Ensure readable by application
   - Not locked by another process

### Auto-Update Not Working

**Causes:**
- Invalid remote URL
- Network issues
- Invalid remote database

**Solutions:**

1. **Check remote URL:**
   ```json
   {
     "blocklist": {
       "autoUpdate": true,
       "remoteUrl": "https://valid-url.com/blocklist.db"
     }
   }
   ```

2. **Test URL manually:**
   ```bash
   curl -O https://your-url.com/blocklist.db
   ```

3. **Check update interval:**
   ```json
   {
     "blocklist": {
       "updateInterval": 5  // Test with shorter interval
     }
   }
   ```

4. **Enable debug logging:**
   - Check for "Updating blocklist" messages
   - Look for HTTP errors

---

## Enable Debug Mode

For detailed troubleshooting, enable debug logging:

```json
{
  "logging": {
    "level": "debug",
    "file": true
  }
}
```

**Check logs:**
```bash
type .cache\debug.log  # Windows
cat .cache/debug.log   # Linux/macOS
```

**What to look for:**
- Error messages with stack traces
- API call details
- File system operations
- Network requests
- SQLite queries

---

## Getting Help

If issues persist:

1. **Enable debug logging** (see above)
2. **Reproduce the issue**
3. **Check `.cache/debug.log`** for errors
4. **Create GitHub issue** with:
   - Debug log excerpt (remove sensitive info)
   - Configuration (remove credentials)
   - Steps to reproduce
   - Expected vs actual behavior

**GitHub Issues:** https://github.com/RWolfyo/VRChatMonitor/issues

---

## Known Issues

### Windows Defender False Positive

**Issue:** Windows Defender may flag the .exe as suspicious

**Solution:**
- This is common for Node.js SEA executables
- Add to Windows Defender exclusions
- Verify download from official GitHub releases

### VRCX Pipe Name Mismatch

**Issue:** VRCX pipe name calculation differs from app

**Solution:**
- Pipe name based on Windows username hash
- Check VRCX logs for actual pipe name
- Report if consistently wrong

### Session Expires Quickly

**Issue:** Session expires before 24 hours

**Solution:**
- VRChat API can invalidate sessions early
- Multiple simultaneous logins may invalidate sessions
- This is normal VRChat API behavior

---

## Next Steps

- **[Configuration Reference](CONFIGURATION.md)** - Adjust settings
- **[Setup Guide](SETUP.md)** - Reconfigure features
- **[Main README](../README.md)** - Back to documentation
