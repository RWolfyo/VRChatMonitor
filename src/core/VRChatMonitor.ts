import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { ConfigManager } from '../utils/Config';
import { Config, TrustRank } from '../types/config';
import { VRChatAPIService } from '../services/VRChatAPIService';
import { DiscordService } from '../services/DiscordService';
import { NotificationService } from '../services/NotificationService';
import { AudioService } from '../services/AudioService';
import { VRCXService } from '../services/VRCXService';
import { AutoUpdateService } from '../services/AutoUpdateService';
import { AvatarScannerService, AvatarData, AvatarViolation } from '../services/AvatarScannerService';
import { LogWatcher } from './LogWatcher';
import { BlocklistManager } from './BlocklistManager';
import { PlayerJoinEvent, PlayerLeaveEvent, AvatarChangeEvent } from '../types/events';
import { MatchResult } from '../types/blocklist';
import { DEDUPE_CLEANUP_MULTIPLIER, DEDUPE_MAP_MAX_SIZE, SECONDS_TO_MS } from '../constants';
import {
  extractTrustRankFromTags,
  isBelowMinimumRank,
  formatTrustRank,
  TRUST_RANK_DISPLAY_NAMES,
} from '../utils/TrustRankUtils';
import { VRChatModerationStorage } from '../utils/VRChatModerationStorage';
import { SeverityFormatter } from '../utils/FormatUtils';

export class VRChatMonitor extends EventEmitter {
  private logger: Logger;
  private config: Config;
  private configManager: ConfigManager;
  private vrchatAPI: VRChatAPIService | null = null;
  private discordService: DiscordService | null = null;
  private notificationService: NotificationService;
  private audioService: AudioService;
  private vrcxService: VRCXService | null = null;
  private autoUpdateService: AutoUpdateService;
  private logWatcher: LogWatcher | null = null;
  private blocklistManager: BlocklistManager | null = null;
  private avatarScanner: AvatarScannerService | null = null;
  private moderationStorage: VRChatModerationStorage | null = null;

  private isRunning: boolean = false;
  private recentJoins: Map<string, number> = new Map(); // userId -> timestamp
  private currentPlayers: Map<string, { userId: string; displayName: string; joinedAt: number }> = new Map(); // userId -> player info
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
    this.autoUpdateService = new AutoUpdateService();

    // Set dedupe window
    this.DEDUPE_WINDOW_MS = this.config.advanced.deduplicateWindow * SECONDS_TO_MS;

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

      // Initialize avatar scanner if enabled
      await this.initializeAvatarScanner();

      // Initialize log watcher
      await this.initializeLogWatcher();

      // Start monitoring
      this.isRunning = true;
      this.logger.info('✅ VRChat Monitor started successfully');
      this.logger.info('🔍 Monitoring your instance for potential matches...');

      // Check for updates in background
      this.autoUpdateService.checkOnStartup();

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

      // Stop auto-update checks
      if (this.autoUpdateService) {
        this.autoUpdateService.stop();
      }

      // Stop avatar scanner auto-pruning
      if (this.avatarScanner) {
        this.avatarScanner.stopAutoPruning();
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

    // Initialize VRChat moderation storage for auto-hide feature
    const currentUser = this.vrchatAPI.getCurrentUserCached();
    if (currentUser) {
      this.moderationStorage = new VRChatModerationStorage(this.logger);
      this.moderationStorage.initialize(currentUser.id);
      this.logger.debug('VRChat moderation storage initialized');
    }
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
      this.config.blocklist.updateInterval,
      this.config.blocklist.obscenityFilter.enabled,
      this.config.blocklist.obscenityFilter.severity as 'low' | 'medium' | 'high'
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
   * Initialize avatar scanner
   */
  private async initializeAvatarScanner(): Promise<void> {
    if (!this.vrchatAPI) {
      throw new Error('VRChat API must be initialized before avatar scanner');
    }

    if (!this.config.advanced.avatarScanning?.enabled) {
      this.logger.info('Avatar scanning is disabled');
      return;
    }

    this.logger.info('Initializing avatar scanner...');

    this.avatarScanner = new AvatarScannerService(
      this.vrchatAPI,
      this.logger,
      this.config.advanced.avatarScanning.cacheExpiry
    );

    this.logger.info('Avatar scanner initialized successfully');
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

    // Listen for player leave events
    this.logWatcher.on('playerLeave', (event: PlayerLeaveEvent) => {
      this.handlePlayerLeave(event);
    });

    // Listen for avatar change events
    this.logWatcher.on('avatarChange', (event: AvatarChangeEvent) => {
      this.handleAvatarChange(event);
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

    // Skip if it's the current user (check this first before any logging)
    if (this.vrchatAPI?.isCurrentUser(userId)) {
      this.logger.debug(`Ignoring join event for current user: ${displayName} (${userId})`);
      return;
    }

    // Deduplicate recent joins
    const lastJoinTime = this.recentJoins.get(userId);
    if (lastJoinTime && Date.now() - lastJoinTime < this.DEDUPE_WINDOW_MS) {
      this.logger.debug(`Ignoring duplicate join for ${userId}`);
      return;
    }

    this.recentJoins.set(userId, Date.now());
    this.cleanupOldJoins();

    // Track current players
    this.currentPlayers.set(userId, {
      userId,
      displayName,
      joinedAt: Date.now(),
    });

    this.logger.info(`Player joined: ${displayName} (${userId})`);

    // Fetch user profile once if we need it (for friend check, trust rank, or avatar scanning)
    let userProfile: any = null;
    if (this.vrchatAPI) {
      try {
        userProfile = await this.vrchatAPI.getUserProfile(userId);
      } catch (error) {
        this.logger.debug(`Failed to fetch user profile for ${displayName}:`, { error });
      }
    }

    // Skip all scanning for friends if enabled
    if (this.config.advanced.skipFriends && userProfile && userProfile.isFriend === true) {
      this.logger.debug(`Skipping all scanning for friend: ${displayName}`);
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

        // Auto-hide blacklisted user's avatar if enabled (skip friends)
        if (this.config.advanced.avatarScanning?.autoHideBlacklisted && this.moderationStorage?.isInitialized()) {
          await this.autoHideAvatar(userId, displayName, userProfile);
        }

        await this.sendAlerts(result);
      }
    } catch (error) {
      this.logger.error(`Error checking user ${userId}`, { error });
    }

    // Check trust rank and age verification (pass cached profile)
    if (this.vrchatAPI && userProfile) {
      await this.checkTrustRankAndAgeVerification(userId, displayName, userProfile);
    }

    // Check avatar performance (pass cached profile)
    if (this.vrchatAPI && this.avatarScanner && this.config.advanced.avatarScanning?.enabled && userProfile) {
      if (this.config.advanced.avatarScanning.scanOnJoin) {
        await this.checkAvatarPerformance(userId, displayName, userProfile);
      }
    }
  }

  /**
   * Handle player leave event
   */
  private handlePlayerLeave(event: PlayerLeaveEvent): void {
    const { userId, displayName } = event;

    // Remove player from current players tracking
    this.currentPlayers.delete(userId);

    this.logger.info(`Player left: ${displayName} (${userId})`);
  }

  /**
   * Handle avatar change event
   */
  private async handleAvatarChange(event: AvatarChangeEvent): Promise<void> {
    const { displayName, avatarName } = event;

    // Find the player by display name in current players
    const player = Array.from(this.currentPlayers.values()).find((p) => p.displayName === displayName);

    if (!player) {
      this.logger.debug(`Avatar change detected for unknown player: ${displayName}`);
      return;
    }

    const { userId } = player;

    // Skip if it's the current user
    if (this.vrchatAPI?.isCurrentUser(userId)) {
      this.logger.debug(`Ignoring avatar change for current user: ${displayName}`);
      return;
    }

    this.logger.info(`Avatar changed: ${displayName} (${userId}) -> ${avatarName}`);

    // Check avatar performance if enabled and scanOnChange is true
    if (
      this.vrchatAPI &&
      this.avatarScanner &&
      this.config.advanced.avatarScanning?.enabled &&
      this.config.advanced.avatarScanning.scanOnChange
    ) {
      await this.checkAvatarPerformance(userId, displayName);
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
   * Check trust rank and age verification status
   */
  private async checkTrustRankAndAgeVerification(userId: string, displayName: string, userProfile?: any): Promise<void> {
    const trustConfig = this.config.advanced.trustRankAlerts;
    const ageConfig = this.config.advanced.ageVerificationAlerts;

    // Skip if both features are disabled
    if (!trustConfig?.enabled && !ageConfig?.enabled) {
      return;
    }

    try {
      // Use cached profile or fetch if not provided
      const user = userProfile || await this.vrchatAPI!.getUserProfile(userId);

      if (!user) {
        this.logger.warn(`Failed to fetch user profile for ${displayName} (${userId})`);
        return;
      }

      // Extract trust rank from tags
      const trustRank = extractTrustRankFromTags(user.tags);

      // Check trust rank alerts
      if (trustConfig?.enabled) {
        const minimumRank = trustConfig.minimumRank || 'new_user';

        // Alert if rank is below minimum (or if detection failed and rank is unknown)
        if (trustRank === 'unknown' || isBelowMinimumRank(trustRank, minimumRank)) {
          this.logger.warn(`⚠️ TRUST RANK ALERT: ${displayName} (${userId})`, {
            trustRank,
            displayName: TRUST_RANK_DISPLAY_NAMES[trustRank],
            minimumRequired: TRUST_RANK_DISPLAY_NAMES[minimumRank],
          });

          await this.sendTrustRankAlert(displayName, userId, trustRank);
        }
      }

      // Check age verification
      if (ageConfig?.enabled && user.tags) {
        // Age verified users have 'system_age_verified' or similar tags
        // Also check the ageVerified field if available
        const isAgeVerified = user.tags.includes('system_age_verified') ||
                              (user as any).ageVerified === true;

        if (isAgeVerified) {
          this.logger.info(`ℹ️ AGE VERIFIED USER: ${displayName} (${userId})`);
          await this.sendAgeVerificationAlert(displayName, userId);
        }
      }
    } catch (error) {
      this.logger.error(`Error checking trust rank/age verification for ${userId}`, { error });
    }
  }

  /**
   * Send trust rank alerts
   */
  private async sendTrustRankAlert(displayName: string, userId: string, trustRank: TrustRank): Promise<void> {
    const formattedRank = formatTrustRank(trustRank, true);
    const isNuisance = trustRank === 'nuisance';

    // Desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        const message = isNuisance
          ? `🚨 NUISANCE USER DETECTED - BAN ON SIGHT 🚨`
          : `Trust Rank: ${formattedRank}`;
        await this.notificationService.notifyBlockedUser(displayName, message);
      } catch (error) {
        this.logger.error('Failed to send trust rank desktop notification', { error });
      }
    }

    // Audio alert (only for nuisance users by default, or any low trust)
    if (this.config.audio.enabled && this.audioService.isAvailable() && (isNuisance || trustRank === 'visitor')) {
      try {
        await this.audioService.playAlert();
      } catch (error) {
        this.logger.error('Failed to play trust rank audio alert', { error });
      }
    }

    // Discord notification
    if (this.discordService) {
      try {
        const embedColor = isNuisance ? 0xFF0000 : (trustRank === 'visitor' ? 0xFFA500 : 0xFFFF00);
        const description = isNuisance
          ? `🚨 **NUISANCE USER DETECTED - BAN ON SIGHT** 🚨\n\nThis user has been de-ranked by VRChat for problematic behavior.`
          : `User has low trust rank: **${formattedRank}**`;

        await this.discordService.sendEmbed({
          title: `Trust Rank Alert: ${displayName}`,
          description,
          color: embedColor,
          fields: [
            { name: 'User ID', value: userId, inline: true },
            { name: 'Trust Rank', value: formattedRank, inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error('Failed to send trust rank Discord notification', { error });
      }
    }

    // VRCX VR overlay notification
    if (this.vrcxService && this.vrcxService.isEnabled()) {
      try {
        const vrcxMessage = isNuisance
          ? `🚨 NUISANCE USER: ${displayName} - BAN ON SIGHT`
          : `${formattedRank}: ${displayName}`;
        await this.vrcxService.sendAlert(vrcxMessage, 'Trust Rank Alert', userId);
      } catch (error) {
        this.logger.error('Failed to send trust rank VRCX notification', { error });
      }
    }
  }

  /**
   * Send age verification informational alert
   */
  private async sendAgeVerificationAlert(displayName: string, userId: string): Promise<void> {
    // Desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        await this.notificationService.notify({
          title: 'Age Verified User',
          message: `${displayName} is age verified (18+)`,
          sound: false, // Informational, no sound
        });
      } catch (error) {
        this.logger.error('Failed to send age verification desktop notification', { error });
      }
    }

    // Discord notification (informational)
    if (this.discordService) {
      try {
        await this.discordService.sendEmbed({
          title: `Age Verified User: ${displayName}`,
          description: `✅ This user is **age verified** (18+) and can be allowed in faster.`,
          color: 0x00FF00, // Green
          fields: [
            { name: 'User ID', value: userId, inline: true },
            { name: 'Status', value: '✅ Age Verified', inline: true },
          ],
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.error('Failed to send age verification Discord notification', { error });
      }
    }

    // VRCX VR overlay notification
    if (this.vrcxService && this.vrcxService.isEnabled()) {
      try {
        await this.vrcxService.sendAlert(
          `✅ Age Verified: ${displayName}`,
          'VRChat Monitor',
          userId
        );
      } catch (error) {
        this.logger.error('Failed to send age verification VRCX notification', { error });
      }
    }
  }

  /**
   * Check avatar performance and send alerts if thresholds exceeded
   */
  private async checkAvatarPerformance(userId: string, displayName: string, userProfile?: any): Promise<void> {
    if (!this.avatarScanner || !this.config.advanced.avatarScanning) {
      return;
    }

    try {
      this.logger.debug(`Checking avatar performance for ${displayName} (${userId})`);

      // Get avatar data (with caching, pass user profile to avoid redundant API call)
      const avatarData = await this.avatarScanner.getAvatarForUser(userId, displayName, userProfile);
      if (!avatarData) {
        this.logger.debug(`No avatar data available for ${displayName}`);
        return;
      }

      // Check if avatar author is blacklisted
      const authorBlacklisted = await this.checkAvatarAuthorBlacklist(avatarData, displayName, userId);

      // Check against thresholds
      const violations = this.avatarScanner.checkAvatarThresholds(
        avatarData,
        this.config.advanced.avatarScanning.thresholds
      );

      if (violations.length > 0 || authorBlacklisted) {
        if (violations.length > 0) {
          this.logger.info(`⚠️ User ${displayName} is wearing a performance-heavy avatar: ${violations.length} violations (${avatarData.avatarName})`);
        }

        // Auto-hide avatar if enabled (skip friends)
        if (this.config.advanced.avatarScanning.autoHideAvatar && this.moderationStorage?.isInitialized()) {
          await this.autoHideAvatar(userId, displayName);
        }

        if (violations.length > 0) {
          await this.sendAvatarAlert(displayName, userId, avatarData, violations);
        }
      } else {
        this.logger.debug(`User ${displayName}'s avatar performance is acceptable`);
      }
    } catch (error) {
      this.logger.error(`Error checking avatar performance for ${displayName} (${userId})`, { error });
    }
  }

  /**
   * Check if avatar author is blacklisted
   */
  private async checkAvatarAuthorBlacklist(
    avatarData: AvatarData,
    displayName: string,
    userId: string
  ): Promise<boolean> {
    if (!this.blocklistManager) {
      return false;
    }

    try {
      // Check if avatar author is in the blocklist
      const authorMatch = await this.blocklistManager.isUserBlocked(avatarData.authorId);

      if (authorMatch) {
        this.logger.info(`🚨 User ${displayName} is wearing an avatar created by blacklisted user: ${avatarData.authorName} (${avatarData.authorId})`);

        // Send alert about blacklisted avatar author
        await this.sendBlacklistedAvatarAuthorAlert(displayName, userId, avatarData, authorMatch);

        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Error checking avatar author blacklist for ${displayName}`, { error });
      return false;
    }
  }

  /**
   * Send alert for avatar created by blacklisted user
   */
  private async sendBlacklistedAvatarAuthorAlert(
    displayName: string,
    userId: string,
    avatarData: AvatarData,
    authorMatch: any
  ): Promise<void> {
    // Desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        await this.notificationService.notify({
          title: `🚨 Blacklisted Avatar Creator: ${displayName}`,
          message: `User is wearing avatar by blacklisted creator\nAuthor: ${avatarData.authorName}\nAvatar: ${avatarData.avatarName}\nReason: ${authorMatch.reason || 'Unknown'}`,
          sound: true,
        });
      } catch (error) {
        this.logger.error('Failed to send blacklisted avatar author desktop notification', { error });
      }
    }

    // Audio alert (always play for blacklisted authors - high severity)
    if (this.config.audio.enabled && this.audioService.isAvailable()) {
      try {
        await this.audioService.playAlert();
      } catch (error) {
        this.logger.error('Failed to play audio alert for blacklisted avatar author', { error });
      }
    }

    // Discord notification
    if (this.discordService) {
      try {
        const fields: Array<{ name: string; value: string; inline: boolean }> = [
          {
            name: 'User Wearing Avatar',
            value: `**${displayName}**\n${userId}`,
            inline: false,
          },
          {
            name: 'Avatar Details',
            value: `**Name:** ${avatarData.avatarName}\n**Author:** ${avatarData.authorName} (${avatarData.authorId})${avatarData.performanceRating ? `\n**Rating:** ${avatarData.performanceRating}` : ''}`,
            inline: false,
          },
          {
            name: 'Blacklist Reason',
            value: authorMatch.reason || 'No reason provided',
            inline: false,
          },
        ];

        if (authorMatch.severity) {
          fields.push({
            name: 'Severity',
            value: authorMatch.severity.toUpperCase(),
            inline: true,
          });
        }

        await this.discordService.sendEmbed({
          title: `🚨 Avatar by Blacklisted Creator Detected`,
          description: `User **${displayName}** is wearing an avatar created by blacklisted user **${avatarData.authorName}**`,
          color: 0xFF0000, // Red for blacklisted authors
          fields,
        });
      } catch (error) {
        this.logger.error('Failed to send blacklisted avatar author Discord notification', { error });
      }
    }

    // VRCX notification
    if (this.vrcxService) {
      try {
        await this.vrcxService.sendNotification(
          `🚨 Avatar by Blacklisted Creator`,
          `${displayName} is wearing avatar by ${avatarData.authorName} (${authorMatch.reason || 'Blacklisted'})`
        );
      } catch (error) {
        this.logger.error('Failed to send blacklisted avatar author VRCX notification', { error });
      }
    }
  }

  /**
   * Send avatar performance alert notifications
   */
  private async sendAvatarAlert(
    displayName: string,
    userId: string,
    avatarData: AvatarData,
    violations: AvatarViolation[]
  ): Promise<void> {
    // Format violations summary
    const violationsSummary = violations.slice(0, 3).map(v => {
      if (typeof v.value === 'number' && typeof v.threshold === 'number') {
        return `${v.field}: ${v.value.toLocaleString()} (limit: ${v.threshold.toLocaleString()})`;
      }
      return `${v.field}: ${v.value} (threshold: ${v.threshold})`;
    }).join(', ');

    const moreCount = violations.length > 3 ? ` +${violations.length - 3} more` : '';

    // Desktop notification
    if (this.config.notifications.desktop.enabled) {
      try {
        await this.notificationService.notify({
          title: `⚠️ Performance Issue: ${displayName}`,
          message: `User is wearing problematic avatar\nAvatar: ${avatarData.avatarName}\n${violationsSummary}${moreCount}`,
          sound: true,
        });
      } catch (error) {
        this.logger.error('Failed to send avatar performance desktop notification', { error });
      }
    }

    // Audio alert for high severity violations
    const hasHighSeverity = violations.some(v => v.severity === 'high');
    if (this.config.audio.enabled && this.audioService.isAvailable() && hasHighSeverity) {
      try {
        await this.audioService.playAlert();
      } catch (error) {
        this.logger.error('Failed to play audio alert for avatar performance', { error });
      }
    }

    // Discord notification
    if (this.discordService) {
      try {
        // Determine embed color based on highest severity
        const maxSeverity = violations.reduce((max, v) => {
          if (v.severity === 'high') return 'high';
          if (v.severity === 'medium' && max !== 'high') return 'medium';
          return max;
        }, 'low' as 'low' | 'medium' | 'high');

        const embedColor = maxSeverity === 'high' ? 0xFF4500 : maxSeverity === 'medium' ? 0xFFA500 : 0xFFFF00;

        const fields: Array<{ name: string; value: string; inline: boolean }> = [
          {
            name: 'User Wearing Problematic Avatar',
            value: `**${displayName}**\n${userId}`,
            inline: false,
          },
          {
            name: 'Avatar Details',
            value: `**Name:** ${avatarData.avatarName}\n**Author:** ${avatarData.authorName}${avatarData.performanceRating ? `\n**Rating:** ${avatarData.performanceRating}` : ''}`,
            inline: false,
          },
        ];

        fields.push({
          name: `⚠️ Performance Violations (${violations.length})`,
          value: violations.map((v) => {
            const emoji = SeverityFormatter.getEmoji(v.severity);
            let valueStr = '';
            if (typeof v.value === 'number' && typeof v.threshold === 'number') {
              valueStr = `${v.value.toLocaleString()} / ${v.threshold.toLocaleString()}`;
            } else {
              valueStr = `${v.value} (expected: ${v.threshold})`;
            }
            return `${emoji} **${v.field}**: ${valueStr}`;
          }).slice(0, 10).join('\n') + (violations.length > 10 ? `\n... and ${violations.length - 10} more` : ''),
          inline: false,
        });

        await this.discordService.sendEmbed({
          title: `⚠️ User with Performance-Heavy Avatar Detected`,
          description: `User **${displayName}** is wearing an avatar with ${violations.length} performance violation${violations.length !== 1 ? 's' : ''}`,
          color: embedColor,
          fields,
        });
      } catch (error) {
        this.logger.error('Failed to send avatar performance Discord notification', { error });
      }
    }

    // VRCX VR overlay notification
    if (this.vrcxService && this.vrcxService.isEnabled()) {
      try {
        const severityEmoji = hasHighSeverity ? SeverityFormatter.getEmoji('high') : '⚠️';
        await this.vrcxService.sendAlert(
          `${severityEmoji} Performance Issue: ${displayName}`,
          `User wearing heavy avatar: ${violations.length} violations`,
          userId
        );
      } catch (error) {
        this.logger.error('Failed to send avatar performance VRCX notification', { error });
      }
    }
  }

  /**
   * Automatically hide user's avatar if they're not a friend
   * Writes to VRChat's local player moderation storage
   */
  private async autoHideAvatar(userId: string, displayName: string, userProfile?: any): Promise<void> {
    if (!this.vrchatAPI || !this.moderationStorage) {
      return;
    }

    try {
      // Use cached profile or fetch if not provided
      const profile = userProfile || await this.vrchatAPI.getUserProfile(userId);
      if (!profile) {
        this.logger.debug(`Could not get profile for ${displayName}, skipping auto-hide`);
        return;
      }

      // Skip friends
      if (profile.isFriend === true) {
        this.logger.debug(`Skipping auto-hide for friend: ${displayName}`);
        return;
      }

      // Hide avatar in VRChat local storage
      const success = this.moderationStorage.hideAvatar(userId);
      if (success) {
        this.logger.info(`🙈 Auto-hidden avatar for user: ${displayName} (${userId})`);
      } else {
        this.logger.warn(`Failed to auto-hide avatar for ${displayName}`);
      }
    } catch (error) {
      this.logger.error(`Error auto-hiding avatar for ${displayName}`, { error });
    }
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
    const cutoff = now - this.DEDUPE_WINDOW_MS * DEDUPE_CLEANUP_MULTIPLIER;

    let deletedCount = 0;
    for (const [userId, timestamp] of this.recentJoins.entries()) {
      if (timestamp < cutoff) {
        this.recentJoins.delete(userId);
        deletedCount++;
      }
    }

    // Emergency cleanup if map grows too large despite time-based cleanup
    if (this.recentJoins.size > DEDUPE_MAP_MAX_SIZE) {
      this.logger.warn(`Dedupe map exceeded maximum size (${DEDUPE_MAP_MAX_SIZE}), forcing cleanup`, {
        currentSize: this.recentJoins.size
      });

      // Sort by timestamp and keep only the most recent entries
      const entries = Array.from(this.recentJoins.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, DEDUPE_MAP_MAX_SIZE);

      this.recentJoins.clear();
      for (const [userId, timestamp] of entries) {
        this.recentJoins.set(userId, timestamp);
      }
    }

    if (deletedCount > 0) {
      this.logger.debug(`Cleaned up ${deletedCount} old join records (${this.recentJoins.size} remaining)`);
    }
  }

  /**
   * Get list of current players in instance
   */
  public getCurrentPlayers(): Array<{ userId: string; displayName: string; joinedAt: number }> {
    return Array.from(this.currentPlayers.values());
  }

  /**
   * Scan all current players' avatars for performance issues
   * Returns a summary of results
   */
  public async scanAllAvatars(): Promise<{
    total: number;
    scanned: number;
    passed: number;
    failed: number;
    skipped: number;
    results: Array<{
      userId: string;
      displayName: string;
      status: 'passed' | 'failed' | 'skipped' | 'error';
      violations?: number;
      error?: string;
    }>;
  }> {
    const players = this.getCurrentPlayers();
    const results: Array<{
      userId: string;
      displayName: string;
      status: 'passed' | 'failed' | 'skipped' | 'error';
      violations?: number;
      error?: string;
    }> = [];

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const player of players) {
      const { userId, displayName } = player;

      // Skip if avatar scanning is disabled
      if (!this.config.advanced.avatarScanning?.enabled || !this.avatarScanner) {
        results.push({ userId, displayName, status: 'skipped' });
        skipped++;
        continue;
      }

      // TODO: Skip friends if configured (need to implement isFriend method in VRChatAPIService)

      try {
        // Get avatar data
        const avatarData = await this.avatarScanner.getAvatarForUser(userId, displayName);
        if (!avatarData) {
          results.push({ userId, displayName, status: 'skipped' });
          skipped++;
          continue;
        }

        // Check avatar author blacklist
        const authorBlacklisted = await this.checkAvatarAuthorBlacklist(avatarData, displayName, userId);

        // Check thresholds
        const violations = this.avatarScanner.checkAvatarThresholds(
          avatarData,
          this.config.advanced.avatarScanning.thresholds
        );

        if (violations.length > 0 || authorBlacklisted) {
          results.push({
            userId,
            displayName,
            status: 'failed',
            violations: violations.length,
          });
          failed++;
        } else {
          results.push({ userId, displayName, status: 'passed' });
          passed++;
        }
      } catch (error: any) {
        results.push({
          userId,
          displayName,
          status: 'error',
          error: error.message || 'Unknown error',
        });
      }
    }

    return {
      total: players.length,
      scanned: passed + failed,
      passed,
      failed,
      skipped,
      results,
    };
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
   * Disable command input (for long-running operations like updates)
   * This prevents users from issuing commands while an operation is in progress
   */
  public setCommandInputDisabled(disabled: boolean): void {
    this.emit('commandInputDisabled', disabled);
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
   * Check for updates
   */
  public async checkForUpdates(): Promise<boolean> {
    return await this.autoUpdateService.checkForUpdates(false);
  }

  /**
   * Perform update
   */
  public async performUpdate(): Promise<boolean> {
    return await this.autoUpdateService.performUpdate();
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
