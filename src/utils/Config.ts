import fs from 'fs';
import path from 'path';
import { Config } from '../types/config';
import { Logger } from './Logger';

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
      const parsedConfig = JSON.parse(configText) as Config;

      // Validate and apply defaults
      this.config = this.validateAndApplyDefaults(parsedConfig);

      this.logger.info('Configuration loaded successfully');
      return this.config;
    } catch (error) {
      this.logger.error('Failed to load configuration', { error });
      throw new Error(`Failed to load config.json: ${error}`);
    }
  }

  private validateAndApplyDefaults(config: Partial<Config>): Config {
    return {
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
          webhookUrl: config.notifications?.discord?.webhookUrl || '',
          mentionRoles: config.notifications?.discord?.mentionRoles || [],
        },
        vrcx: {
          enabled: config.notifications?.vrcx?.enabled ?? false,
          xsOverlay: config.notifications?.vrcx?.xsOverlay ?? false,
        },
      },
      audio: {
        enabled: config.audio?.enabled ?? true,
        volume: config.audio?.volume ?? 0.5,
        filePath: config.audio?.filePath || '',
      },
      blocklist: {
        autoUpdate: config.blocklist?.autoUpdate ?? true,
        remoteUrl: config.blocklist?.remoteUrl || 'https://raw.githubusercontent.com/RWolfyo/VRChatMonitor/refs/heads/master/blockedGroups.jsonc',
        updateInterval: config.blocklist?.updateInterval ?? 60,
      },
      logging: {
        level: config.logging?.level || 'info',
        file: config.logging?.file ?? false,
      },
      advanced: {
        cacheDir: config.advanced?.cacheDir || '',
        deduplicateWindow: config.advanced?.deduplicateWindow ?? 30,
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
