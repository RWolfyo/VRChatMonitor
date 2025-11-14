/**
 * Application-wide constants
 */

// ============================================================================
// Log Watcher
// ============================================================================
export const LOG_ROTATION_CHECK_INTERVAL_MS = 60000; // 60 seconds
export const LOG_ROTATION_CHECK_INTERVAL_SECONDS = LOG_ROTATION_CHECK_INTERVAL_MS / 1000;
export const LOG_WATCHER_STABILITY_THRESHOLD_MS = 500;
export const LOG_WATCHER_POLL_INTERVAL_MS = 100;

// ============================================================================
// Logger
// ============================================================================
export const LOG_BUFFER_MAX_SIZE = 500;

// ============================================================================
// API & Session Management
// ============================================================================
export const API_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const API_CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
export const API_RATE_LIMIT_CALLS = 10;
export const API_RATE_LIMIT_WINDOW_MS = 30000; // 30 seconds
export const API_CALL_SPACING_MS = 100;
export const SESSION_REFRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
export const SESSION_COOKIE_SAVE_DELAY_MS = 500;

// ============================================================================
// Blocklist Management
// ============================================================================
export const REDOS_TEST_STRING_LENGTH = 100;
export const REDOS_MAX_EXECUTION_TIME_MS = 100;
export const FILE_HANDLE_RELEASE_DELAY_MS = 100;
export const DATABASE_REOPEN_DELAY_MS = 100;
export const HTTP_MAX_REDIRECTS = 5;
export const BLOCKLIST_DOWNLOAD_TIMEOUT_MS = 30000; // 30 seconds

// ============================================================================
// Notifications - Discord
// ============================================================================
export const DISCORD_MAX_RETRIES = 3;
export const DISCORD_RETRY_DELAY_MS = 2000;
export const DISCORD_RATE_LIMIT_DELAY_MS = 2000; // 30 req/min = 2s
export const DISCORD_MAX_QUEUE_SIZE = 100;
export const DISCORD_MATCHED_TEXT_MAX_LENGTH = 200;

// Discord embed colors
export const DISCORD_COLOR_HIGH_SEVERITY = 0xed4245; // Red
export const DISCORD_COLOR_MEDIUM_SEVERITY = 0xfee75c; // Yellow
export const DISCORD_COLOR_LOW_SEVERITY = 0x57f287; // Green
export const DISCORD_COLOR_DEFAULT = 0x5865f2; // Blurple
export const DISCORD_COLOR_UPDATE_AVAILABLE = 0x5865f2; // Blurple

// ============================================================================
// Notifications - Desktop
// ============================================================================
export const NOTIFICATION_MIN_INTERVAL_MS = 2000; // 2 seconds

// ============================================================================
// Notifications - Audio
// ============================================================================
export const AUDIO_PLAYBACK_TIMEOUT_MS = 10000; // 10 seconds

// ============================================================================
// Notifications - VRCX/XSOverlay
// ============================================================================
export const XSOVERLAY_UDP_PORT = 42069;
export const XSOVERLAY_HOST = '127.0.0.1';
export const VRCX_CONNECTION_TIMEOUT_MS = 2000;
export const XSOVERLAY_NOTIFICATION_TIMEOUT_MS = 5000;
export const XSOVERLAY_NOTIFICATION_HEIGHT = 110;
export const XSOVERLAY_DEFAULT_OPACITY = 1.0;
export const XSOVERLAY_ALERT_TIMEOUT_MS = 5000;
export const POWERSHELL_TIMEOUT_MS = 3000;

// ============================================================================
// Auto-Update
// ============================================================================
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const UPDATE_STARTUP_CHECK_DELAY_MS = 5000;
export const GITHUB_API_TIMEOUT_MS = 10000;
export const UPDATE_SCRIPT_DELAY_MS = 2000;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 120000; // 2 minutes

// ============================================================================
// Command Handler
// ============================================================================
export const MONITOR_RESTART_DELAY_MS = 1000;
export const COMMAND_PROMPT_REDRAW_DEBOUNCE_MS = 50;

// ============================================================================
// Keyv Store
// ============================================================================
export const KEYV_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Console/UI Display
// ============================================================================
export const BANNER_CONTENT_WIDTH = 59;
export const CONSOLE_SEPARATOR_WIDTH = 61;
export const CONSOLE_MATCHED_TEXT_MAX_LENGTH = 100;

// ============================================================================
// Monitoring
// ============================================================================
export const DEDUPE_CLEANUP_MULTIPLIER = 2;
