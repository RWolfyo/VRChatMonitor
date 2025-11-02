# Interactive Commands Guide

VRChat Monitor now features an interactive command system. When you start the application, you'll see a prompt where you can type commands in real-time while monitoring continues.

## Starting the App

Simply run the executable:
```bash
vrc-monitor.exe
```

Once the monitor initializes, you'll see:
```
vrc-monitor>
```

## Available Commands

### help (?, h)
Show all available commands with descriptions.

```
vrc-monitor> help
```

### test-alert (test, t)
Send a test alert through all configured notification channels (desktop, audio, Discord, VRCX).

```
vrc-monitor> test-alert
```

### status (s, info)
Display current monitor status including:
- Running state (Active/Stopped)
- Log watcher status
- Blocklist statistics (groups, users, keywords, version, last update)

```
vrc-monitor> status
```

### update-blocklist (update, refresh, u)
Force update the blocklist database from the configured remote URL.

```
vrc-monitor> update-blocklist
```

### clear (cls, c)
Clear the console screen.

```
vrc-monitor> clear
```

### restart (r, reboot)
Restart the monitor (stops and starts all services).

```
vrc-monitor> restart
```

### version (v, ver)
Display the application version and build information.

```
vrc-monitor> version
```

### quit (exit, q, stop)
Gracefully stop monitoring and exit the application.

```
vrc-monitor> quit
```

## Features

- **Real-time interaction**: Commands work while monitoring continues
- **Command history**: Use up/down arrow keys to navigate previous commands
- **Multiple aliases**: Type shortcuts like `t` instead of `test-alert`
- **No restart needed**: Test notifications, check status, update blocklist without restarting
- **Graceful shutdown**: Ctrl+C or `quit` command properly closes all connections

## Examples

### Test all your notification channels
```
vrc-monitor> test-alert
```
This will send a sample alert to:
- Desktop notification (Windows toast)
- Audio alert (plays alert.mp3)
- Discord webhook (if configured)
- VRCX/XSOverlay (if enabled)

### Check if monitor is working
```
vrc-monitor> status
```
Shows:
- Monitor running: ✓ Running
- Log watcher: ✓ Active
- Blocklist statistics with counts

### Update your blocklist
```
vrc-monitor> update
```
Downloads the latest blocklist from the configured remote URL.

### Exit the application
```
vrc-monitor> quit
```
Properly closes all connections and exits.

## Tips

- Type partial commands - the system will recognize unique prefixes
- Use Tab key for... well, nothing yet, but we could add tab completion!
- All commands are case-insensitive
- Commands execute immediately - no confirmation needed
- The prompt reappears after each command completes

## Implementation Details

**Location**: `src/utils/CommandHandler.ts`

The command handler:
- Uses Node.js `readline` module for interactive input
- Runs concurrently with the monitor (non-blocking)
- All commands are async and properly await completion
- Errors are caught and displayed without crashing the monitor
- Ctrl+C triggers graceful shutdown
