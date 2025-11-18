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
}
