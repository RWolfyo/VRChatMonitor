/**
 * Main configuration structure for VRChat Monitor.
 *
 * This interface defines the complete application configuration schema.
 * Config is loaded from config.json and validated with defaults applied.
 *
 * @see ConfigManager for loading, validation, and migration logic
 */
export interface Config {
  /**
   * Config schema version number.
   * Used for automatic migration when config structure changes.
   */
  version?: number;

  /** VRChat authentication credentials */
  vrchat: VRChatConfig;

  /** Multi-channel notification settings (Desktop, Discord, VRCX, XSOverlay) */
  notifications: NotificationConfig;

  /** Audio alert configuration */
  audio: AudioConfig;

  /** Blocklist database and update settings */
  blocklist: BlocklistConfig;

  /** Logging configuration (Winston) */
  logging: LoggingConfig;

  /** Advanced features (trust rank, age verification, avatar scanning, etc.) */
  advanced: AdvancedConfig;
}

/**
 * VRChat authentication configuration.
 *
 * Credentials are optional in config - if not provided, user will be prompted.
 * Saved credentials are auto-filled on startup and updated after successful login.
 */
export interface VRChatConfig {
  /** VRChat username (optional: prompts if not provided) */
  username?: string;

  /** VRChat password (optional: prompts if not provided) */
  password?: string;
}

/**
 * Notification channel configuration.
 *
 * Supports multiple simultaneous notification channels:
 * - Desktop: Windows Toast notifications via SnoreToast
 * - Discord: Webhook-based rich embeds with role mentions
 * - VRCX: Named pipe communication to VRCX overlay
 * - XSOverlay: UDP broadcast for VR overlay notifications
 */
export interface NotificationConfig {
  /** Windows desktop toast notifications (SnoreToast) */
  desktop: {
    /** Enable desktop notifications */
    enabled: boolean;
    /** Play notification sound with alerts */
    sound: boolean;
  };

  /** Discord webhook notifications with rich embeds */
  discord: {
    /** Enable Discord notifications */
    enabled: boolean;
    /** Discord webhook URL (leave empty to disable) */
    webhookUrl?: string;
    /** Array of Discord role IDs to mention (e.g., ["123456789"]) */
    mentionRoles?: string[];
  };

  /** VRCX/XSOverlay VR overlay notifications */
  vrcx: {
    /** Enable VRCX named pipe notifications */
    enabled: boolean;
    /** Fallback to XSOverlay if VRCX unavailable */
    xsOverlay: boolean;
  };
}

/**
 * Audio alert configuration.
 *
 * Plays audio alerts using FFmpeg (ffplay) for blocklist matches.
 */
export interface AudioConfig {
  /** Enable audio alerts */
  enabled: boolean;

  /** Audio volume (0.0 to 1.0) */
  volume: number;

  /** Custom audio file path (defaults to bundled alert.mp3) */
  filePath?: string;
}

/**
 * Blocklist database configuration.
 *
 * Controls SQLite blocklist behavior, updates, and content filtering.
 */
export interface BlocklistConfig {
  /** Automatically update blocklist from remote URL */
  autoUpdate: boolean;

  /** Remote blocklist database URL (default: GitHub hosted) */
  remoteUrl: string;

  /** Update interval in minutes (default: 60) */
  updateInterval: number;

  /** Offensive content detection configuration */
  obscenityFilter: {
    /** Enable obscenity filter for profile/group content */
    enabled: boolean;
    /** Severity level for obscenity matches */
    severity: 'low' | 'medium' | 'high';
  };
}

/**
 * Winston log level.
 * Levels from least to most verbose: error > warn > info > debug > verbose
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

/**
 * Logging configuration.
 *
 * Controls Winston logger behavior and output destinations.
 */
export interface LoggingConfig {
  /** Log level (determines verbosity) */
  level: LogLevel;

  /** Write logs to debug.log file in cache directory */
  file: boolean;
}

/**
 * Advanced monitoring features configuration.
 *
 * Contains settings for trust rank monitoring, age verification alerts,
 * avatar performance scanning, and other advanced functionality.
 */
export interface AdvancedConfig {
  /** Custom cache directory path (defaults to .cache/ in app directory) */
  cacheDir?: string;

  /**
   * Deduplication window in seconds.
   * Prevents duplicate alerts for same user within this time frame.
   * Default: 30 seconds
   */
  deduplicateWindow: number;

  /**
   * Skip ALL scanning for friends (global friend bypass).
   * When enabled, friends are excluded from:
   * - Blocklist checking
   * - Trust rank alerts
   * - Age verification alerts
   * - Avatar performance scanning
   *
   * Default: true (respects social relationships)
   */
  skipFriends?: boolean;

  /** Trust rank monitoring configuration */
  trustRankAlerts?: TrustRankAlertsConfig;

  /** Age verification alert configuration */
  ageVerificationAlerts?: AgeVerificationAlertsConfig;

  /** Avatar performance scanning configuration */
  avatarScanning?: AvatarScanningConfig;
}

/**
 * VRChat trust rank hierarchy.
 *
 * Ranks from lowest to highest privilege:
 * - unknown: No rank assigned
 * - nuisance: Problematic users
 * - visitor: New accounts (less than 12 hours playtime)
 * - new_user: Basic trust level
 * - user: Standard trust level
 * - known_user: Elevated trust
 * - trusted_user: High trust level
 * - veteran_user: Highest trust level
 */
export type TrustRank = 'unknown' | 'nuisance' | 'visitor' | 'new_user' | 'user' | 'known_user' | 'trusted_user' | 'veteran_user';

/**
 * Trust rank alert configuration.
 *
 * Alerts when users below specified trust rank join your instance.
 * Helps identify potentially problematic or new users.
 */
export interface TrustRankAlertsConfig {
  /** Enable trust rank monitoring */
  enabled: boolean;

  /**
   * Minimum acceptable trust rank.
   * Alerts are triggered for users BELOW this level.
   * Example: Setting 'new_user' alerts for 'visitor' and 'nuisance' users.
   */
  minimumRank: TrustRank;
}

/**
 * Age verification alert configuration.
 *
 * Shows informational alerts when age-verified users join.
 * Age verification is a VRChat+ feature indicating real-world identity check.
 */
export interface AgeVerificationAlertsConfig {
  /** Enable age verification alerts */
  enabled: boolean;
}

/**
 * Avatar performance scanning configuration.
 *
 * Monitors avatar metrics (polygons, particles, PhysBones, etc.) and alerts
 * when users join with avatars exceeding configured thresholds.
 *
 * Features:
 * - Real-time performance monitoring
 * - Configurable thresholds for 15+ metrics
 * - Automatic avatar hiding (opt-in)
 * - Smart caching to minimize API calls
 */
export interface AvatarScanningConfig {
  /** Enable avatar performance scanning */
  enabled: boolean;

  /** Scan avatars when users join the instance */
  scanOnJoin: boolean;

  /**
   * Scan avatars when users change their avatar.
   * Requires periodic polling - may increase API usage.
   */
  scanOnChange: boolean;

  /**
   * How long to cache avatar data (minutes).
   * Reduces API calls for frequently seen avatars.
   * Default: 60 minutes
   */
  cacheExpiry: number;

  /**
   * Automatically hide avatars that violate performance thresholds.
   * Uses VRChat's LocalPlayerModerations - changes apply immediately.
   * Always skips friends regardless of this setting.
   * Default: false (opt-in for user safety)
   */
  autoHideAvatar: boolean;

  /**
   * Automatically hide avatars of blacklisted users.
   * Applies when blocklist match is detected.
   * Always skips friends regardless of this setting.
   * Default: false (opt-in for user safety)
   */
  autoHideBlacklisted: boolean;

  /** Performance thresholds for triggering alerts */
  thresholds: AvatarThresholds;
}

/**
 * Avatar performance thresholds.
 *
 * All thresholds are optional (nullable) - set to null to disable individual checks.
 * Numeric thresholds trigger alerts when avatar values EXCEED the threshold.
 * Boolean thresholds trigger alerts when the feature is ENABLED on the avatar.
 *
 * Default values are conservative based on VRChat "Medium" performance tier.
 * Customize based on your hardware capabilities and tolerance.
 *
 * @see DEFAULT_AVATAR_THRESHOLDS in constants.ts for default values
 */
export interface AvatarThresholds {
  /**
   * Maximum triangles/polygons allowed.
   * VRChat PC limits: Excellent=7.5k, Good=10k, Medium=70k, Poor=70k+
   */
  totalPolygons?: number;

  /** Maximum vertex count (alternative to polygon count) */
  totalVertices?: number;

  /**
   * Maximum number of particle systems.
   * Each system has performance cost even when not emitting.
   */
  particleSystemCount?: number;

  /**
   * Maximum total particles across all systems.
   * High particle counts cause severe performance impact.
   */
  totalMaxParticles?: number;

  /**
   * Alert if particle collision is enabled.
   * Particle collision is extremely expensive (CPU-bound physics).
   */
  particleCollisionEnabled?: boolean;

  /**
   * Alert if particle trails are enabled.
   * Trails multiply particle count and impact performance.
   */
  particleTrailsEnabled?: boolean;

  /**
   * Maximum skeletal bones for animations.
   * VRChat recommends <150 bones, limits at 400 (humanoid).
   */
  boneCount?: number;

  /**
   * Maximum PhysBones components.
   * PhysBones are CPU-intensive real-time simulations.
   */
  physBoneComponentCount?: number;

  /** Maximum PhysBones colliders (collision detection for PhysBones) */
  physBoneColliderCount?: number;

  /** Maximum transforms affected by PhysBones */
  physBoneTransformCount?: number;

  /**
   * Maximum material slots.
   * Each material requires additional draw calls.
   */
  materialCount?: number;

  /** Maximum mesh renderers (separate meshes on avatar) */
  meshCount?: number;

  /**
   * Maximum realtime lights on avatar.
   * Lights are EXTREMELY expensive - VRChat strongly discourages them.
   * Recommended: 0 (no lights)
   */
  lightCount?: number;

  /** Maximum audio sources (spatial audio emitters) */
  audioSourceCount?: number;

  /** Maximum compressed avatar file size (MB) */
  fileSize?: number;

  /** Maximum uncompressed avatar size in memory (MB) */
  uncompressedSize?: number;

  /** Maximum total texture memory usage (MB) */
  totalTextureUsage?: number;

  /**
   * Alert if performance rating is below this level.
   * Ratings: Excellent > Good > Medium > Poor > VeryPoor
   * Example: Set to 'Medium' to alert on Poor/VeryPoor avatars
   */
  performanceRating?: 'Excellent' | 'Good' | 'Medium' | 'Poor' | 'VeryPoor';
}
