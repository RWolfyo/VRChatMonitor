import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { ConfigManager } from '../utils/Config';
import { Config } from '../types/config';
import { VRChatAPIService } from '../services/VRChatAPIService';
import { DiscordService } from '../services/DiscordService';
import { NotificationService } from '../services/NotificationService';
import { AudioService } from '../services/AudioService';
import { VRCXService } from '../services/VRCXService';
import { LogWatcher } from './LogWatcher';
import { BlocklistManager } from './BlocklistManager';
import { PlayerJoinEvent } from '../types/events';
import { MatchResult } from '../types/blocklist';

export class VRChatMonitor extends EventEmitter {
  private logger: Logger;
  private config: Config;
  private configManager: ConfigManager;
  private vrchatAPI: VRChatAPIService | null = null;
  private discordService: DiscordService | null = null;
  private notificationService: NotificationService;
  private audioService: AudioService;
  private vrcxService: VRCXService | null = null;
  private logWatcher: LogWatcher | null = null;
  private blocklistManager: BlocklistManager | null = null;

  private isRunning: boolean = false;
  private recentJoins: Map<string, number> = new Map(); // userId -> timestamp
  private readonly DEDUPE_WINDOW_MS: number;

  constructor(configPath?: string) {
    super();

    // Initialize logger first
    this.logger = Logger.getInstance();

    // Load configuration
    this.configManager = new ConfigManager(configPath);
    this.config = this.configManager.load();
    this.configManager.applyEnvironmentOverrides();

    // Reconfigure logger with config settings
    Logger.initialize(this.config.logging.level, this.config.logging.file);
    this.logger = Logger.getInstance();

    this.logger.info('🔍 VRChat Monitor initializing...');

    // Initialize services
    this.notificationService = new NotificationService();
    this.audioService = new AudioService(
      this.config.audio.volume,
      this.config.audio.filePath
    );
    this.vrcxService = new VRCXService(
      this.config.notifications.vrcx.enabled,
      this.config.notifications.vrcx.xsOverlay
    );

    // Set dedupe window
    this.DEDUPE_WINDOW_MS = this.config.advanced.deduplicateWindow * 1000;

    // Setup signal handlers
    this.setupSignalHandlers();
  }

  /**
   * Start monitoring
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('VRChat Monitor is already running');
      return;
    }

    try {
      this.logger.info('Starting VRChat Monitor...');

      // Initialize VRChat API
      await this.initializeVRChatAPI();

      // Initialize Discord if enabled
      if (this.config.notifications.discord.enabled) {
        await this.initializeDiscord();
      }

      // Test VRCX connection if enabled
      if (this.vrcxService && this.vrcxService.isEnabled()) {
        await this.vrcxService.testConnection();
      }

      // Initialize blocklist
      await this.initializeBlocklist();

      // Initialize log watcher
      await this.initializeLogWatcher();

      // Start monitoring
      this.isRunning = true;
      this.logger.info('✅ VRChat Monitor started successfully');
      this.logger.info('🔍 Monitoring your instance for potential matches...');

      // Emit ready event
      this.emit('ready');

    } catch (error) {
      this.logger.error('Failed to start VRChat Monitor', { error });
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping VRChat Monitor...');

    try {
      // Stop log watcher
      if (this.logWatcher) {
        await this.logWatcher.stop();
      }

      // Stop blocklist updates
      if (this.blocklistManager) {
        this.blocklistManager.destroy();
      }

      // Disconnect VRChat API
      if (this.vrchatAPI) {
        await this.vrchatAPI.disconnect();
      }

      this.isRunning = false;
      this.logger.info('VRChat Monitor stopped');
    } catch (error) {
      this.logger.error('Error during shutdown', { error });
    }
  }

  /**
   * Initialize VRChat API
   */
  private async initializeVRChatAPI(): Promise<void> {
    this.logger.info('Initializing VRChat API...');

    // Pass config credentials as defaults (can be empty, will prompt if needed)
    const credentials = this.config.vrchat;
    const defaultCreds = credentials.username && credentials.password
      ? { username: credentials.username, password: credentials.password }
      : null;

    // Create callback to save credentials after successful login
    const onCredentialsSaved = (username: string, password: string) => {
      this.configManager.saveCredentials(username, password);
    };

    this.vrchatAPI = new VRChatAPIService(
      defaultCreds,
      this.config.advanced.cacheDir,
      onCredentialsSaved
    );

    await this.vrchatAPI.authenticate();
  }

  /**
   * Initialize Discord service
   */
  private async initializeDiscord(): Promise<void> {
    if (!this.config.notifications.discord.webhookUrl) {
      this.logger.warn('Discord notifications enabled but no webhook URL provided');
      return;
    }

    this.logger.info('Initializing Discord service...');

    this.discordService = new DiscordService(
      this.config.notifications.discord.webhookUrl,
      this.config.notifications.discord.mentionRoles
    );

    this.logger.info('Discord service initialized successfully');
  }

  /**
   * Initialize blocklist manager
   */
  private async initializeBlocklist(): Promise<void> {
    if (!this.vrchatAPI) {
      throw new Error('VRChat API must be initialized before blocklist');
    }

    this.logger.info('Initializing blocklist...');

    this.blocklistManager = new BlocklistManager(
      this.vrchatAPI,
      this.config.blocklist.remoteUrl,
      this.config.blocklist.autoUpdate,
      this.config.blocklist.updateInterval
    );

    // Listen for blocklist events
    this.blocklistManager.on('versionMismatch', (event) => {
      this.handleVersionMismatch(event.currentVersion, event.remoteVersion);
    });

    await this.blocklistManager.initialize();

    const stats = this.blocklistManager.getStats();
    this.logger.info('Blocklist loaded', stats);
  }

  /**
   * Initialize log watcher
   */
  private async initializeLogWatcher(): Promise<void> {
    this.logger.info('Initializing log watcher...');

    // Clean up old watcher if exists to prevent listener accumulation
    if (this.logWatcher) {
      this.logWatcher.removeAllListeners('playerJoin');
      this.logWatcher.removeAllListeners('error');
      await this.logWatcher.stop();
    }

    this.logWatcher = new LogWatcher();

    // Listen for player join events
    this.logWatcher.on('playerJoin', (event: PlayerJoinEvent) => {
      this.handlePlayerJoin(event);
    });

    // Listen for errors
    this.logWatcher.on('error', (error: Error) => {
      this.logger.error('LogWatcher error', { error });
    });

    this.logWatcher.start();
  }

  /**
   * Handle player join event
   */
  private async handlePlayerJoin(event: PlayerJoinEvent): Promise<void> {
    const { userId, displayName } = event;

    // Deduplicate recent joins
    const lastJoinTime = this.recentJoins.get(userId);
    if (lastJoinTime && Date.now() - lastJoinTime < this.DEDUPE_WINDOW_MS) {
      this.logger.debug(`Ignoring duplicate join for ${userId}`);
      return;
    }

    this.recentJoins.set(userId, Date.now());
    this.cleanupOldJoins();

    this.logger.info(`Player joined: ${displayName} (${userId})`);

    // Skip if it's the current user
    if (this.vrchatAPI?.isCurrentUser(userId)) {
      this.logger.debug('Ignoring join event for current user');
      return;
    }

    // Check against blocklist
    try {
      if (!this.blocklistManager) {
        this.logger.warn('Blocklist manager not initialized');
        return;
      }

      const result = await this.blocklistManager.checkUser(userId, displayName);

      if (result.matched) {
        this.logger.warn(`⚠️ BLOCKED USER DETECTED: ${displayName} (${userId})`, {
          matches: result.matches,
        });

        await this.sendAlerts(result);
      }
    } catch (error) {
      this.logger.error(`Error checking user ${userId}`, { error });
    }
  }

  /**
   * Send alerts for user matches
   */
  private async sendAlerts(result: MatchResult): Promise<void> {
    const { displayName, userId, matches } = result;

    // Desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        // Use neutral language for desktop notification
        const isBlacklistedUser = matches.some((m) => m.type === 'blockedUser');
        const shortReason = isBlacklistedUser
          ? 'Blacklisted user detected (confirmed)'
          : matches[0]?.details || 'Potential match detected';
        await this.notificationService.notifyBlockedUser(displayName, shortReason);
      } catch (error) {
        this.logger.error('Failed to send desktop notification', { error });
      }
    }

    // Audio alert
    if (this.config.audio.enabled && this.audioService.isAvailable()) {
      try {
        await this.audioService.playAlert();
      } catch (error) {
        this.logger.error('Failed to play audio alert', { error });
      }
    }

    // Discord notification
    if (this.discordService) {
      try {
        await this.discordService.sendBlockAlert(displayName, userId, matches);
      } catch (error) {
        this.logger.error('Failed to send Discord notification', { error });
      }
    }

    // VRCX VR overlay notification
    if (this.vrcxService && this.vrcxService.isEnabled()) {
      try {
        // Simple VR notification format: just display name + simple alert
        const vrcxMessage = `⚠️ Match Detected: ${displayName}`;
        await this.vrcxService.sendAlert(vrcxMessage, 'VRChat Monitor', userId);
      } catch (error) {
        this.logger.error('Failed to send VRCX notification', { error });
      }
    }

    // Emit alert event
    this.emit('alert', result);
  }

  /**
   * Handle version mismatch
   */
  private async handleVersionMismatch(currentVersion: string, remoteVersion: string): Promise<void> {
    this.logger.warn(`⚠️ Update available: ${remoteVersion} (current: ${currentVersion})`);

    // Desktop notification
    try {
      await this.notificationService.notifyVersionUpdate(currentVersion, remoteVersion);
    } catch (error) {
      this.logger.error('Failed to send version update notification', { error });
    }

    // Discord notification
    if (this.discordService) {
      try {
        await this.discordService.sendVersionMismatch(currentVersion, remoteVersion);
      } catch (error) {
        this.logger.error('Failed to send Discord version notification', { error });
      }
    }
  }

  /**
   * Clean up old join records to prevent memory leak
   */
  private cleanupOldJoins(): void {
    const now = Date.now();
    const cutoff = now - this.DEDUPE_WINDOW_MS * 2;

    for (const [userId, timestamp] of this.recentJoins.entries()) {
      if (timestamp < cutoff) {
        this.recentJoins.delete(userId);
      }
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Get monitor status
   */
  public getStatus(): {
    running: boolean;
    logWatcherActive: boolean;
    blocklistStats: any;
  } {
    return {
      running: this.isRunning,
      logWatcherActive: this.logWatcher?.isActive() || false,
      blocklistStats: this.blocklistManager?.getStats() || null,
    };
  }

  /**
   * Force blocklist update
   */
  public async updateBlocklist(): Promise<boolean> {
    if (!this.blocklistManager) {
      this.logger.warn('Blocklist manager not initialized');
      return false;
    }

    return await this.blocklistManager.forceUpdate();
  }

  /**
   * Manually check a user ID against the blocklist
   */
  public async checkUserById(userId: string): Promise<MatchResult | null> {
    if (!this.blocklistManager) {
      this.logger.warn('Blocklist manager not initialized');
      return null;
    }

    if (!this.vrchatAPI) {
      this.logger.warn('VRChat API not initialized');
      return null;
    }

    try {
      // First, get the user profile to get their display name
      const profile = await this.vrchatAPI.getUserProfile(userId);

      if (!profile) {
        this.logger.error(`Failed to fetch profile for user ${userId}`);
        return null;
      }

      const displayName = profile.displayName || 'Unknown User';

      this.logger.info(`Manually checking user: ${displayName} (${userId})`);

      // Check against blocklist
      const result = await this.blocklistManager.checkUser(userId, displayName);

      if (result.matched) {
        this.logger.warn(`Manual check: User matched blocklist`, {
          userId,
          displayName,
          matchCount: result.matches.length,
        });
      } else {
        this.logger.info(`Manual check: No matches found for user ${displayName}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error manually checking user ${userId}`, { error });
      return null;
    }
  }

  /**
   * Send test alert on all notification channels
   */
  public async sendTestAlert(): Promise<void> {
    this.logger.info('Sending test alert on all channels...');

    // Create sample test match result
    const testResult: MatchResult = {
      matched: true,
      userId: 'usr_00000000-0000-0000-0000-000000000000',
      displayName: 'TestUser_Example',
      matches: [
        {
          type: 'blockedGroup',
          details: 'Member of test blocked group',
          severity: 'high',
          groupId: 'grp_11111111-1111-1111-1111-111111111111',
          groupName: 'Test Dangerous Group',
          reason: 'This is a test alert - User is a member of a blocked group',
          author: 'System Administrator',
        },
        {
          type: 'keywordUser',
          details: 'Profile matches test keyword pattern',
          severity: 'medium',
          keyword: '(test|sample)_pattern',
          keywordMatchLocation: 'bio',
          matchedText: 'This is a sample bio with test content',
          reason: 'This is a test alert - Keyword pattern matched in user bio',
          author: 'AutoModerator',
        },
      ],
    };

    // Send desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        this.logger.info('📧 Sending test desktop notification...');
        await this.notificationService.notify({
          title: '🧪 Test Alert - VRChat Monitor',
          message: 'This is a test alert!\n2 test matches detected',
          sound: true,
        });
        this.logger.info('✓ Desktop notification sent');
      } catch (error) {
        this.logger.error('✗ Failed to send desktop notification', { error });
      }
    } else {
      this.logger.info('⊘ Desktop notifications disabled');
    }

    // Play audio alert
    if (this.config.audio.enabled && this.audioService.isAvailable()) {
      try {
        this.logger.info('🔊 Playing test audio alert...');
        await this.audioService.playAlert();
        this.logger.info('✓ Audio alert played');
      } catch (error) {
        this.logger.error('✗ Failed to play audio alert', { error });
      }
    } else {
      this.logger.info('⊘ Audio alerts disabled or not available');
    }

    // Send Discord webhook
    if (this.discordService) {
      try {
        this.logger.info('💬 Sending test Discord webhook...');
        await this.discordService.sendBlockAlert(
          testResult.displayName,
          testResult.userId,
          testResult.matches
        );
        this.logger.info('✓ Discord webhook sent');
      } catch (error) {
        this.logger.error('✗ Failed to send Discord webhook', { error });
      }
    } else {
      this.logger.info('⊘ Discord notifications disabled or not configured');
    }

    // Send VRCX notification
    if (this.vrcxService && this.vrcxService.isEnabled()) {
      try {
        this.logger.info('🥽 Sending test VRCX/XSOverlay notification...');
        await this.vrcxService.sendAlert(
          '⚠️ Match Detected: TestUser_Example',
          'VRChat Monitor',
          testResult.userId
        );
        this.logger.info('✓ VRCX notification sent');
      } catch (error) {
        this.logger.error('✗ Failed to send VRCX notification', { error });
      }
    } else {
      this.logger.info('⊘ VRCX/XSOverlay notifications disabled');
    }

    // Emit test alert event (will show in console)
    this.logger.info('📺 Emitting test console alert...');
    this.emit('alert', testResult);

    this.logger.info('');
    this.logger.info('✅ Test alert complete! Check all enabled notification channels.');
  }
}
