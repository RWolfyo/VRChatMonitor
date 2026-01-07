export interface Config {
  version?: number; // Config schema version for migrations
  vrchat: VRChatConfig;
  notifications: NotificationConfig;
  audio: AudioConfig;
  blocklist: BlocklistConfig;
  logging: LoggingConfig;
  advanced: AdvancedConfig;
}

export interface VRChatConfig {
  username?: string;  // Optional: used as default if provided
  password?: string;  // Optional: used as default if provided
}

export interface NotificationConfig {
  desktop: {
    enabled: boolean;
    sound: boolean;
  };
  discord: {
    enabled: boolean;
    webhookUrl?: string;
    mentionRoles?: string[];
  };
  vrcx: {
    enabled: boolean;
    xsOverlay: boolean;
  };
}

export interface AudioConfig {
  enabled: boolean;
  volume: number;
  filePath?: string;
}

export interface BlocklistConfig {
  autoUpdate: boolean;
  remoteUrl: string;
  updateInterval: number;
  obscenityFilter: {
    enabled: boolean;
    severity: 'low' | 'medium' | 'high';
  };
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export interface LoggingConfig {
  level: LogLevel;
  file: boolean;
}

export interface AdvancedConfig {
  cacheDir?: string;
  deduplicateWindow: number;
  trustRankAlerts?: TrustRankAlertsConfig;
  ageVerificationAlerts?: AgeVerificationAlertsConfig;
  avatarScanning?: AvatarScanningConfig;
}

export type TrustRank = 'unknown' | 'nuisance' | 'visitor' | 'new_user' | 'user' | 'known_user' | 'trusted_user' | 'veteran_user';

export interface TrustRankAlertsConfig {
  enabled: boolean;
  minimumRank: TrustRank; // Alert if rank is BELOW this level
}

export interface AgeVerificationAlertsConfig {
  enabled: boolean; // Show informational alert for age-verified users
}

export interface AvatarScanningConfig {
  enabled: boolean; // Enable avatar scanning on join and avatar change
  scanOnJoin: boolean; // Scan avatar when user joins instance
  scanOnChange: boolean; // Scan avatar when user changes avatar (requires polling)
  cacheExpiry: number; // Avatar data cache expiry in minutes (default: 60)
  autoHideAvatar: boolean; // Automatically hide avatars that violate thresholds (ignores friends)
  thresholds: AvatarThresholds; // Thresholds for avatar performance metrics
}

export interface AvatarThresholds {
  // Polygon/Triangle counts
  totalPolygons?: number; // Alert if totalPolygons exceeds this (e.g., 70000)
  totalVertices?: number; // Alert if totalVertices exceeds this

  // Particle systems
  particleSystemCount?: number; // Alert if particleSystemCount exceeds this (e.g., 8)
  totalMaxParticles?: number; // Alert if totalMaxParticles exceeds this (e.g., 10000)
  particleCollisionEnabled?: boolean; // Alert if particle collision is enabled (performance impact)
  particleTrailsEnabled?: boolean; // Alert if particle trails are enabled (performance impact)

  // Physics/Bones
  boneCount?: number; // Alert if boneCount exceeds this (e.g., 400)
  physBoneComponentCount?: number; // Alert if physBoneComponentCount exceeds this (e.g., 32)
  physBoneColliderCount?: number; // Alert if physBoneColliderCount exceeds this
  physBoneTransformCount?: number; // Alert if physBoneTransformCount exceeds this

  // Rendering
  materialCount?: number; // Alert if materialCount exceeds this (e.g., 20)
  meshCount?: number; // Alert if meshCount exceeds this
  lightCount?: number; // Alert if lightCount exceeds this (e.g., 0 - lights are expensive)

  // Audio
  audioSourceCount?: number; // Alert if audioSourceCount exceeds this (e.g., 8)

  // File size
  fileSize?: number; // Alert if fileSize exceeds this in MB (e.g., 50)
  uncompressedSize?: number; // Alert if uncompressedSize exceeds this in MB
  totalTextureUsage?: number; // Alert if totalTextureUsage exceeds this in MB

  // Performance rating
  performanceRating?: 'Excellent' | 'Good' | 'Medium' | 'Poor' | 'VeryPoor'; // Alert if rating is below this level
}
