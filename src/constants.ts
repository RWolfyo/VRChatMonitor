/**
 * Application-wide constants for VRChat Monitor
 *
 * This file serves as the single source of truth for all configuration values,
 * timeouts, limits, and default settings throughout the application.
 *
 * Organization:
 * - Constants are grouped by functional area (Log Watcher, API, Notifications, etc.)
 * - Each section is clearly separated with visual dividers
 * - Inline comments explain rationale or context where needed
 * - All time values use _MS suffix for milliseconds
 *
 * Usage:
 * - Import specific constants: import { API_RATE_LIMIT_CALLS } from '../constants'
 * - Never hardcode magic numbers - add them here first
 * - Use constants for all timeouts, limits, and default values
 */

// ============================================================================
// Log Watcher - VRChat log file monitoring
// ============================================================================

/** How often to check if VRChat has rotated to a new log file (60 seconds) */
export const LOG_ROTATION_CHECK_INTERVAL_MS = 60000;
export const LOG_ROTATION_CHECK_INTERVAL_SECONDS = LOG_ROTATION_CHECK_INTERVAL_MS / 1000;

/** Time to wait for file to stabilize before considering it ready (prevents partial reads) */
export const LOG_WATCHER_STABILITY_THRESHOLD_MS = 500;

/** Polling interval for checking log file changes */
export const LOG_WATCHER_POLL_INTERVAL_MS = 100;

// ============================================================================
// Logger - Winston logging with circular buffer
// ============================================================================

/** Maximum number of log entries kept in memory for crash reports */
export const LOG_BUFFER_MAX_SIZE = 500;

// ============================================================================
// API & Session Management - VRChat API client configuration
// ============================================================================

/** How long to cache API responses before refetching (5 minutes) */
export const API_CACHE_DURATION_MS = 5 * 60 * 1000;

/** How often to prune expired cache entries */
export const API_CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

/** Maximum API calls allowed within the rate limit window */
export const API_RATE_LIMIT_CALLS = 10;

/** Time window for rate limiting (30 seconds) */
export const API_RATE_LIMIT_WINDOW_MS = 30000;

/** Minimum spacing between queued API calls (prevents request spam) */
export const API_CALL_SPACING_MS = 100;

/** Refresh session when approaching expiry (6 hours) */
export const SESSION_REFRESH_THRESHOLD_MS = 6 * 60 * 60 * 1000;

/** Session expires after 24 hours of inactivity */
export const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** Delay after login before saving cookies (ensures all cookies are set) */
export const SESSION_COOKIE_SAVE_DELAY_MS = 500;

// ============================================================================
// Blocklist Management - SQLite database with auto-update
// ============================================================================

/** Length of test string for ReDoS (Regular Expression Denial of Service) protection */
export const REDOS_TEST_STRING_LENGTH = 100;

/** Maximum time allowed for regex execution (prevents catastrophic backtracking) */
export const REDOS_MAX_EXECUTION_TIME_MS = 100;

/** Delay before releasing database file handle (Windows file locking workaround) */
export const FILE_HANDLE_RELEASE_DELAY_MS = 100;

/** Delay before reopening database after operations (prevents SQLITE_BUSY errors) */
export const DATABASE_REOPEN_DELAY_MS = 100;

/** Maximum HTTP redirects to follow when downloading blocklist */
export const HTTP_MAX_REDIRECTS = 5;

/** Timeout for blocklist download requests (30 seconds) */
export const BLOCKLIST_DOWNLOAD_TIMEOUT_MS = 30000;

// ============================================================================
// Notifications - Discord webhooks
// ============================================================================

/** Maximum retry attempts for failed Discord webhook requests */
export const DISCORD_MAX_RETRIES = 3;

/** Delay between retry attempts (2 seconds) */
export const DISCORD_RETRY_DELAY_MS = 2000;

/** Minimum delay between Discord messages (respects 30 req/min rate limit) */
export const DISCORD_RATE_LIMIT_DELAY_MS = 2000;

/** Maximum queued Discord messages (prevents memory exhaustion) */
export const DISCORD_MAX_QUEUE_SIZE = 100;

/** Maximum length of matched text shown in Discord embeds (prevents truncation issues) */
export const DISCORD_MATCHED_TEXT_MAX_LENGTH = 200;

/** Discord embed color for high severity alerts (Red) */
export const DISCORD_COLOR_HIGH_SEVERITY = 0xed4245;

/** Discord embed color for medium severity alerts (Yellow) */
export const DISCORD_COLOR_MEDIUM_SEVERITY = 0xfee75c;

/** Discord embed color for low severity alerts (Green) */
export const DISCORD_COLOR_LOW_SEVERITY = 0x57f287;

/** Discord embed color for informational messages (Discord Blurple) */
export const DISCORD_COLOR_DEFAULT = 0x5865f2;

/** Discord embed color for update notifications (Discord Blurple) */
export const DISCORD_COLOR_UPDATE_AVAILABLE = 0x5865f2;

// ============================================================================
// Notifications - Desktop (SnoreToast)
// ============================================================================

/** Minimum time between desktop notifications (prevents spam) */
export const NOTIFICATION_MIN_INTERVAL_MS = 2000;

// ============================================================================
// Notifications - Audio (FFmpeg)
// ============================================================================

/** Maximum time to wait for audio playback to complete (10 seconds) */
export const AUDIO_PLAYBACK_TIMEOUT_MS = 10000;

// ============================================================================
// Notifications - VRCX/XSOverlay (VR overlay notifications)
// ============================================================================

/** UDP port for XSOverlay communication */
export const XSOVERLAY_UDP_PORT = 42069;

/** Host for XSOverlay (always localhost for local VR setup) */
export const XSOVERLAY_HOST = '127.0.0.1';

/** Timeout for VRCX named pipe connection attempts */
export const VRCX_CONNECTION_TIMEOUT_MS = 2000;

/** How long XSOverlay notifications remain visible (5 seconds) */
export const XSOVERLAY_NOTIFICATION_TIMEOUT_MS = 5000;

/** Height of XSOverlay notification overlay (pixels) */
export const XSOVERLAY_NOTIFICATION_HEIGHT = 110;

/** Default opacity for XSOverlay notifications (1.0 = fully opaque) */
export const XSOVERLAY_DEFAULT_OPACITY = 1.0;

/** How long alert notifications remain visible in XSOverlay */
export const XSOVERLAY_ALERT_TIMEOUT_MS = 5000;

/** Timeout for PowerShell username detection (used for VRCX pipe hash) */
export const POWERSHELL_TIMEOUT_MS = 3000;

// ============================================================================
// Auto-Update - GitHub release checking and installation
// ============================================================================

/** How often to check for application updates (1 hour) */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before first update check on startup (allows app to fully initialize) */
export const UPDATE_STARTUP_CHECK_DELAY_MS = 5000;

/** Timeout for GitHub API requests when checking releases */
export const GITHUB_API_TIMEOUT_MS = 10000;

/** Delay before executing update script (allows current process to exit cleanly) */
export const UPDATE_SCRIPT_DELAY_MS = 2000;

/** Timeout for downloading update package from GitHub (2 minutes) */
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 120000;

// ============================================================================
// Command Handler - Interactive REPL
// ============================================================================

/** Delay before restarting monitor after restart command */
export const MONITOR_RESTART_DELAY_MS = 1000;

/** Debounce time for prompt redraws (prevents flickering from rapid log output) */
export const COMMAND_PROMPT_REDRAW_DEBOUNCE_MS = 100;

// ============================================================================
// Keyv Store - Session storage cleanup
// ============================================================================

/** How often to clean up expired session entries from storage (1 hour) */
export const KEYV_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// ============================================================================
// Console/UI Display - Formatting and layout
// ============================================================================

/** Width of banner content area (characters) */
export const BANNER_CONTENT_WIDTH = 59;

/** Width of console separator lines (characters) */
export const CONSOLE_SEPARATOR_WIDTH = 61;

/** Maximum length of matched text shown in console (prevents line wrapping) */
export const CONSOLE_MATCHED_TEXT_MAX_LENGTH = 100;

/** Width of crash report separator lines (characters) */
export const CRASH_REPORT_SEPARATOR_WIDTH = 70;

// ============================================================================
// Monitoring - Deduplication and performance
// ============================================================================

/**
 * Multiplier for dedupe cleanup threshold.
 * When dedupe window is 30s, cleanup happens at 60s (30 * 2).
 * This ensures entries are kept longer than needed to prevent edge cases.
 */
export const DEDUPE_CLEANUP_MULTIPLIER = 2;

/**
 * Emergency limit for dedupe map size (prevents unbounded memory growth).
 * If map exceeds 10,000 entries, oldest 50% are removed.
 * Normal operation should never hit this - indicates extremely high join rate.
 */
export const DEDUPE_MAP_MAX_SIZE = 10000;

// ============================================================================
// Avatar Scanning - Performance monitoring
// ============================================================================

/**
 * VRChat performance rating hierarchy (best to worst).
 * Used for threshold comparisons - higher index = worse performance.
 * Example: If threshold is 'Medium', avatars rated 'Poor' or 'VeryPoor' trigger alerts.
 */
export const AVATAR_PERFORMANCE_RATING_ORDER = ['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor'] as const;

/**
 * Default avatar performance thresholds with permissive settings.
 * Thresholds set to null are disabled and will not trigger alerts.
 *
 * Guidelines:
 * - totalPolygons: 350,000 triangles (very permissive, allows complex avatars)
 * - particleSystemCount: 32 particle systems maximum (4x VRChat Medium limit)
 * - totalMaxParticles: 20,000 max particles across all systems (2x VRChat Medium)
 * - boneCount: null (disabled - no bone count checking)
 * - physBoneComponentCount: null (disabled - no PhysBones checking)
 * - materialCount: null (disabled - no material count checking)
 * - lightCount: null (disabled - no light checking)
 * - audioSourceCount: null (disabled - no audio source checking)
 *
 * Note: These are permissive defaults that focus only on polygon and particle limits.
 * Users can customize per their needs via config.json.
 */
export const DEFAULT_AVATAR_THRESHOLDS = {
  totalPolygons: 350000,
  particleSystemCount: 32,
  totalMaxParticles: 20000,
  boneCount: null,
  physBoneComponentCount: null,
  materialCount: null,
  lightCount: null,
  audioSourceCount: null,
} as const;

// ============================================================================
// Progress Bar Display - Download/update visualization
// ============================================================================

/** Multiplier to convert decimal percentage to integer (0.753 * 100 = 75.3%) */
export const PROGRESS_BAR_PERCENTAGE_MULTIPLIER = 100;

/** Minimum time between progress bar updates (prevents flickering from rapid updates) */
export const PROGRESS_BAR_UPDATE_THROTTLE_MS = 100;

// ============================================================================
// General Utility - Time conversion helpers
// ============================================================================

/** Milliseconds per second (1000ms = 1s) */
export const SECONDS_TO_MS = 1000;

/** Milliseconds per minute (60,000ms = 1min) */
export const MINUTES_TO_MS = 60 * 1000;
