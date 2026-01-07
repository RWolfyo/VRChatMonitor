import fs from 'fs';
import path from 'path';
import { Config } from '../types/config';
import { Logger } from './Logger';
import { DEFAULT_AVATAR_THRESHOLDS } from '../constants';

export class ConfigManager {
  private config: Config | null = null;
  private logger: Logger;
  private configPath: string;

  constructor(configPath?: string) {
    this.logger = Logger.getInstance();

    // Determine config path - check multiple locations
    this.configPath = this.resolveConfigPath(configPath);
  }

  private resolveConfigPath(providedPath?: string): string {
    if (providedPath && fs.existsSync(providedPath)) {
      return providedPath;
    }

    const candidates = [
      // User provided path
      providedPath,
      // Next to executable (pkg)
      path.join(this.getExecutableDir(), 'config.json'),
      // Current working directory
      path.join(process.cwd(), 'config.json'),
      // Build directory (development)
      path.join(process.cwd(), 'build', 'config.json'),
      // Config directory
      path.join(process.cwd(), 'config', 'config.json'),
    ].filter((p): p is string => p !== undefined);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.logger.debug(`Found config at: ${candidate}`);
        return candidate;
      }
    }

    throw new Error('config.json not found. Please ensure config.json exists in the application directory.');
  }

  private getExecutableDir(): string {
    // Check if running in pkg environment
    // @ts-expect-error - process.pkg is added by pkg bundler
    if (process.pkg) {
      return path.dirname(process.execPath);
    }
    return process.cwd();
  }

  public load(): Config {
    try {
      const configText = fs.readFileSync(this.configPath, 'utf-8');
      let parsedConfig = JSON.parse(configText) as Partial<Config>;

      // Migrate config if needed
      parsedConfig = this.migrateConfig(parsedConfig);

      // Validate and apply defaults
      this.config = this.validateAndApplyDefaults(parsedConfig);

      this.logger.info('Configuration loaded successfully');
      return this.config;
    } catch (error) {
      this.logger.error('Failed to load configuration', { error });
      throw new Error(`Failed to load config.json: ${error}`);
    }
  }

  /**
   * Migrate config from older versions to current schema
   */
  private migrateConfig(config: Partial<Config>): Partial<Config> {
    const CURRENT_CONFIG_VERSION = 4;
    const configVersion = config.version || 1;

    if (configVersion >= CURRENT_CONFIG_VERSION) {
      // Config is up to date
      return config;
    }

    this.logger.info(`Migrating config from version ${configVersion} to ${CURRENT_CONFIG_VERSION}`);

    let migrated = { ...config };
    let migrationApplied = false;

    // Migration v1 -> v2: Add obscenityFilter, trustRankAlerts, and ageVerificationAlerts
    if (configVersion < 2) {
      this.logger.info('Applying migration v1 -> v2: Adding obscenityFilter, trustRankAlerts, and ageVerificationAlerts');

      // Add obscenityFilter if it doesn't exist
      if (!migrated.blocklist) {
        migrated.blocklist = {} as any;
      }

      const blocklistConfig = migrated.blocklist as any;
      if (!blocklistConfig.obscenityFilter) {
        blocklistConfig.obscenityFilter = {
          enabled: true,
          severity: 'high',
        };
        migrationApplied = true;
      }

      // Add trustRankAlerts and ageVerificationAlerts to advanced config
      if (!migrated.advanced) {
        migrated.advanced = {} as any;
      }

      const advancedConfig = migrated.advanced as any;
      if (!advancedConfig.trustRankAlerts) {
        advancedConfig.trustRankAlerts = {
          enabled: true,
          minimumRank: 'new_user',
        };
        migrationApplied = true;
      }

      if (!advancedConfig.ageVerificationAlerts) {
        advancedConfig.ageVerificationAlerts = {
          enabled: true,
        };
        migrationApplied = true;
      }
    }

    // Migration v2 -> v3: Add avatarScanning and skipFriends to advanced
    if (configVersion < 3) {
      this.logger.info('Applying migration v2 -> v3: Adding avatarScanning and skipFriends configuration');

      if (!migrated.advanced) {
        migrated.advanced = {} as any;
      }

      const advancedConfig = migrated.advanced as any;

      // Add skipFriends if it doesn't exist
      if (advancedConfig.skipFriends === undefined) {
        advancedConfig.skipFriends = true; // Skip friends by default
        migrationApplied = true;
      }

      // Add avatarScanning if it doesn't exist
      if (!advancedConfig.avatarScanning) {
        advancedConfig.avatarScanning = {
          enabled: true, // Enabled by default
          scanOnJoin: true,
          scanOnChange: true,
          cacheExpiry: 60,
          autoHideAvatar: true, // Enabled by default
          autoHideBlacklisted: false, // Disabled by default (opt-in)
          thresholds: { ...DEFAULT_AVATAR_THRESHOLDS },
        };
        migrationApplied = true;
      }
    }

    // Migration v3 -> v4: Update avatar thresholds to more permissive values and enable autoHideAvatar
    if (configVersion < 4) {
      this.logger.info('Applying migration v3 -> v4: Updating avatar thresholds to permissive values');

      if (!migrated.advanced) {
        migrated.advanced = {} as any;
      }

      const advancedConfig = migrated.advanced as any;

      // Update avatarScanning configuration with new permissive defaults
      if (advancedConfig.avatarScanning) {
        // Enable autoHideAvatar by default (was previously opt-in)
        if (advancedConfig.avatarScanning.autoHideAvatar === false) {
          advancedConfig.avatarScanning.autoHideAvatar = true;
          migrationApplied = true;
          this.logger.info('Enabled autoHideAvatar by default');
        }

        // Update thresholds to new permissive values
        if (advancedConfig.avatarScanning.thresholds) {
          const thresholds = advancedConfig.avatarScanning.thresholds;

          // Update polygon limit: 70000 -> 350000
          if (thresholds.totalPolygons === 70000) {
            thresholds.totalPolygons = 350000;
            migrationApplied = true;
            this.logger.info('Updated totalPolygons threshold: 70000 -> 350000');
          }

          // Update particle system count: 8 -> 32
          if (thresholds.particleSystemCount === 8) {
            thresholds.particleSystemCount = 32;
            migrationApplied = true;
            this.logger.info('Updated particleSystemCount threshold: 8 -> 32');
          }

          // Update max particles: 10000 -> 20000
          if (thresholds.totalMaxParticles === 10000) {
            thresholds.totalMaxParticles = 20000;
            migrationApplied = true;
            this.logger.info('Updated totalMaxParticles threshold: 10000 -> 20000');
          }

          // Disable bone count check: 400 -> null
          if (thresholds.boneCount === 400) {
            thresholds.boneCount = null;
            migrationApplied = true;
            this.logger.info('Disabled boneCount threshold (set to null)');
          }

          // Disable PhysBone check: 32 -> null
          if (thresholds.physBoneComponentCount === 32) {
            thresholds.physBoneComponentCount = null;
            migrationApplied = true;
            this.logger.info('Disabled physBoneComponentCount threshold (set to null)');
          }

          // Disable material count check: 20 -> null
          if (thresholds.materialCount === 20) {
            thresholds.materialCount = null;
            migrationApplied = true;
            this.logger.info('Disabled materialCount threshold (set to null)');
          }

          // Disable light count check: 0 -> null
          if (thresholds.lightCount === 0) {
            thresholds.lightCount = null;
            migrationApplied = true;
            this.logger.info('Disabled lightCount threshold (set to null)');
          }

          // Disable audio source check: 8 -> null
          if (thresholds.audioSourceCount === 8) {
            thresholds.audioSourceCount = null;
            migrationApplied = true;
            this.logger.info('Disabled audioSourceCount threshold (set to null)');
          }
        }
      }
    }

    // Update version number
    migrated.version = CURRENT_CONFIG_VERSION;

    // Save migrated config back to file
    if (migrationApplied) {
      try {
        this.saveConfigToFile(migrated);
        this.logger.info('Config migration completed and saved to file');
      } catch (error) {
        this.logger.warn('Failed to save migrated config to file', { error });
        this.logger.warn('Please manually update your config.json to include the new configuration settings');
      }
    }

    return migrated;
  }

  /**
   * Save config to file (used for migrations and credential saving)
   */
  private saveConfigToFile(config: Partial<Config>): void {
    const configJson = JSON.stringify(config, null, 2);
    fs.writeFileSync(this.configPath, configJson, 'utf-8');
  }

  private validateAndApplyDefaults(config: Partial<Config>): Config {
    // Validate and clamp volume (0-1)
    let volume = config.audio?.volume ?? 0.5;
    if (volume < 0 || volume > 1 || isNaN(volume)) {
      this.logger.warn(`Invalid audio volume ${volume}, clamping to 0-1 range`);
      volume = Math.max(0, Math.min(1, volume));
    }

    // Validate update interval (must be positive)
    let updateInterval = config.blocklist?.updateInterval ?? 60;
    if (updateInterval <= 0 || isNaN(updateInterval)) {
      this.logger.warn(`Invalid update interval ${updateInterval}, using default 60 minutes`);
      updateInterval = 60;
    }

    // Validate deduplicate window (must be positive)
    let deduplicateWindow = config.advanced?.deduplicateWindow ?? 30;
    if (deduplicateWindow < 0 || isNaN(deduplicateWindow)) {
      this.logger.warn(`Invalid deduplicate window ${deduplicateWindow}, using default 30 seconds`);
      deduplicateWindow = 30;
    }

    // Validate log level
    const validLogLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
    const logLevel = config.logging?.level || 'info';
    if (!validLogLevels.includes(logLevel)) {
      this.logger.warn(`Invalid log level ${logLevel}, using default 'info'`);
    }

    // Validate webhook URL format if Discord is enabled
    const webhookUrl = config.notifications?.discord?.webhookUrl || '';
    if (config.notifications?.discord?.enabled && webhookUrl) {
      try {
        const url = new URL(webhookUrl);
        if (!url.hostname.includes('discord.com')) {
          this.logger.warn('Discord webhook URL does not appear to be a Discord domain');
        }
      } catch (error) {
        this.logger.warn(`Invalid Discord webhook URL format: ${webhookUrl}`);
      }
    }

    return {
      version: config.version || 4, // Current config version
      vrchat: {
        username: config.vrchat?.username || '',
        password: config.vrchat?.password || '',
      },
      notifications: {
        desktop: {
          enabled: config.notifications?.desktop?.enabled ?? true,
          sound: config.notifications?.desktop?.sound ?? true,
        },
        discord: {
          enabled: config.notifications?.discord?.enabled ?? false,
          webhookUrl: webhookUrl,
          mentionRoles: config.notifications?.discord?.mentionRoles || [],
        },
        vrcx: {
          enabled: config.notifications?.vrcx?.enabled ?? false,
          xsOverlay: config.notifications?.vrcx?.xsOverlay ?? false,
        },
      },
      audio: {
        enabled: config.audio?.enabled ?? true,
        volume: volume,
        filePath: config.audio?.filePath || '',
      },
      blocklist: {
        autoUpdate: config.blocklist?.autoUpdate ?? true,
        remoteUrl: config.blocklist?.remoteUrl || 'https://raw.githubusercontent.com/RWolfyo/VRChatMonitor/refs/heads/master/blockedGroups.jsonc',
        updateInterval: updateInterval,
        obscenityFilter: {
          enabled: config.blocklist?.obscenityFilter?.enabled ?? true,
          severity: config.blocklist?.obscenityFilter?.severity || 'high',
        },
      },
      logging: {
        level: validLogLevels.includes(logLevel) ? logLevel as Config['logging']['level'] : 'info',
        file: config.logging?.file ?? false,
      },
      advanced: {
        cacheDir: config.advanced?.cacheDir || '',
        deduplicateWindow: deduplicateWindow,
        skipFriends: config.advanced?.skipFriends ?? true, // Skip friends by default
        trustRankAlerts: {
          enabled: config.advanced?.trustRankAlerts?.enabled ?? true,
          minimumRank: config.advanced?.trustRankAlerts?.minimumRank || 'new_user', // Warn for visitor by default
        },
        ageVerificationAlerts: {
          enabled: config.advanced?.ageVerificationAlerts?.enabled ?? true,
        },
        avatarScanning: {
          enabled: config.advanced?.avatarScanning?.enabled ?? true, // Enabled by default
          scanOnJoin: config.advanced?.avatarScanning?.scanOnJoin ?? true,
          scanOnChange: config.advanced?.avatarScanning?.scanOnChange ?? true, // Enabled by default
          cacheExpiry: config.advanced?.avatarScanning?.cacheExpiry ?? 60,
          autoHideAvatar: config.advanced?.avatarScanning?.autoHideAvatar ?? true, // Enabled by default
          autoHideBlacklisted: config.advanced?.avatarScanning?.autoHideBlacklisted ?? false, // Disabled by default
          thresholds: {
            totalPolygons: config.advanced?.avatarScanning?.thresholds?.totalPolygons ?? DEFAULT_AVATAR_THRESHOLDS.totalPolygons,
            totalVertices: config.advanced?.avatarScanning?.thresholds?.totalVertices,
            particleSystemCount: config.advanced?.avatarScanning?.thresholds?.particleSystemCount ?? DEFAULT_AVATAR_THRESHOLDS.particleSystemCount,
            totalMaxParticles: config.advanced?.avatarScanning?.thresholds?.totalMaxParticles ?? DEFAULT_AVATAR_THRESHOLDS.totalMaxParticles,
            particleCollisionEnabled: config.advanced?.avatarScanning?.thresholds?.particleCollisionEnabled,
            particleTrailsEnabled: config.advanced?.avatarScanning?.thresholds?.particleTrailsEnabled,
            boneCount: config.advanced?.avatarScanning?.thresholds?.boneCount !== undefined ? config.advanced.avatarScanning.thresholds.boneCount : (DEFAULT_AVATAR_THRESHOLDS.boneCount ?? undefined),
            physBoneComponentCount: config.advanced?.avatarScanning?.thresholds?.physBoneComponentCount !== undefined ? config.advanced.avatarScanning.thresholds.physBoneComponentCount : (DEFAULT_AVATAR_THRESHOLDS.physBoneComponentCount ?? undefined),
            physBoneColliderCount: config.advanced?.avatarScanning?.thresholds?.physBoneColliderCount,
            physBoneTransformCount: config.advanced?.avatarScanning?.thresholds?.physBoneTransformCount,
            materialCount: config.advanced?.avatarScanning?.thresholds?.materialCount !== undefined ? config.advanced.avatarScanning.thresholds.materialCount : (DEFAULT_AVATAR_THRESHOLDS.materialCount ?? undefined),
            meshCount: config.advanced?.avatarScanning?.thresholds?.meshCount,
            lightCount: config.advanced?.avatarScanning?.thresholds?.lightCount !== undefined ? config.advanced.avatarScanning.thresholds.lightCount : (DEFAULT_AVATAR_THRESHOLDS.lightCount ?? undefined),
            audioSourceCount: config.advanced?.avatarScanning?.thresholds?.audioSourceCount !== undefined ? config.advanced.avatarScanning.thresholds.audioSourceCount : (DEFAULT_AVATAR_THRESHOLDS.audioSourceCount ?? undefined),
            fileSize: config.advanced?.avatarScanning?.thresholds?.fileSize,
            uncompressedSize: config.advanced?.avatarScanning?.thresholds?.uncompressedSize,
            totalTextureUsage: config.advanced?.avatarScanning?.thresholds?.totalTextureUsage,
            performanceRating: config.advanced?.avatarScanning?.thresholds?.performanceRating,
          },
        },
      },
    };
  }

  public get(): Config {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  public reload(): Config {
    return this.load();
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Save credentials to config file
   */
  public saveCredentials(username: string, password: string): void {
    if (!this.config) return;

    try {
      // Update in-memory config
      this.config.vrchat.username = username;
      this.config.vrchat.password = password;

      // Read current config file to preserve formatting and comments
      const currentContent = fs.readFileSync(this.configPath, 'utf-8');
      let updatedContent = currentContent;

      // Parse and update JSON
      const currentConfig = JSON.parse(currentContent);
      currentConfig.vrchat = currentConfig.vrchat || {};
      currentConfig.vrchat.username = username;
      currentConfig.vrchat.password = password;

      // Write back with pretty formatting
      updatedContent = JSON.stringify(currentConfig, null, 2);

      fs.writeFileSync(this.configPath, updatedContent, 'utf-8');
      this.logger.info('Credentials saved to config.json');
    } catch (error) {
      this.logger.warn('Failed to save credentials to config', { error });
    }
  }

  /**
   * Generic config update method
   * Updates both in-memory config and persists to file
   * @param path Dot-notation path to config field (e.g., 'advanced.trustRankAlerts.enabled')
   * @param value New value for the field
   */
  public updateConfig(path: string, value: any): void {
    if (!this.config) return;

    try {
      // Update in-memory config
      const pathParts = path.split('.');
      let current: any = this.config;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!(pathParts[i] in current)) {
          current[pathParts[i]] = {};
        }
        current = current[pathParts[i]];
      }
      current[pathParts[pathParts.length - 1]] = value;

      // Read and update config file
      const currentContent = fs.readFileSync(this.configPath, 'utf-8');
      const currentConfig = JSON.parse(currentContent);

      // Update file config
      let fileCurrent: any = currentConfig;
      for (let i = 0; i < pathParts.length - 1; i++) {
        if (!(pathParts[i] in fileCurrent)) {
          fileCurrent[pathParts[i]] = {};
        }
        fileCurrent = fileCurrent[pathParts[i]];
      }
      fileCurrent[pathParts[pathParts.length - 1]] = value;

      fs.writeFileSync(this.configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
      this.logger.info(`Configuration updated: ${path} = ${JSON.stringify(value)}`);
    } catch (error) {
      this.logger.warn(`Failed to save configuration for ${path}`, { error });
      throw error;
    }
  }

  /**
   * Get configuration value from environment variable override
   */
  public static getEnvOverride<T>(envVar: string, defaultValue: T): T {
    const value = process.env[envVar];
    if (value === undefined) {
      return defaultValue;
    }

    // Try to parse as JSON for complex types
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Apply environment variable overrides to config
   */
  public applyEnvironmentOverrides(): void {
    if (!this.config) return;

    // VRChat credentials
    if (process.env.VRCHAT_USERNAME) {
      this.config.vrchat.username = process.env.VRCHAT_USERNAME;
    }
    if (process.env.VRCHAT_PASSWORD) {
      this.config.vrchat.password = process.env.VRCHAT_PASSWORD;
    }

    // Discord webhook
    if (process.env.DISCORD_WEBHOOK) {
      this.config.notifications.discord.webhookUrl = process.env.DISCORD_WEBHOOK;
      this.config.notifications.discord.enabled = true;
    }

    // Log level
    if (process.env.LOG_LEVEL) {
      const level = process.env.LOG_LEVEL.toLowerCase();
      if (['error', 'warn', 'info', 'debug'].includes(level)) {
        this.config.logging.level = level as Config['logging']['level'];
      }
    }

    this.logger.debug('Environment overrides applied');
  }
}
