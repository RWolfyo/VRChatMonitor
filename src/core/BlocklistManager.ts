import fs from 'fs';
import https from 'https';
import { EventEmitter } from 'events';
import { loadBetterSqlite3 } from '../utils/SqliteLoader';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { VRChatAPIService } from '../services/VRChatAPIService';
import {
  Match,
  MatchResult,
  Severity,
} from '../types/blocklist';
import { BlocklistUpdatedEvent, VersionMismatchEvent } from '../types/events';
import { APP_VERSION } from '../version';
import {
  REDOS_TEST_STRING_LENGTH,
  REDOS_MAX_EXECUTION_TIME_MS,
  FILE_HANDLE_RELEASE_DELAY_MS,
  DATABASE_REOPEN_DELAY_MS,
  HTTP_MAX_REDIRECTS,
  BLOCKLIST_DOWNLOAD_TIMEOUT_MS,
  MINUTES_TO_MS,
} from '../constants';

export class BlocklistManager extends EventEmitter {
  private logger: Logger;
  private pathResolver: PathResolver;
  private vrchatAPI: VRChatAPIService;
  private db: any = null;
  private Database: any;
  private blocklistPath: string;
  private remoteUrl: string;
  private autoUpdate: boolean;
  private updateInterval: number;
  private updateTimer: NodeJS.Timeout | null = null;
  private compiledKeywordPatterns: RegExp[] = [];
  private updateInProgress: boolean = false;
  private updateQueue: Array<() => void> = [];

  constructor(
    vrchatAPI: VRChatAPIService,
    remoteUrl: string,
    autoUpdate: boolean = true,
    updateInterval: number = 60
  ) {
    super();
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();
    this.vrchatAPI = vrchatAPI;
    this.remoteUrl = remoteUrl;
    this.autoUpdate = autoUpdate;
    this.updateInterval = updateInterval;

    // Load better-sqlite3 with proper native module resolution
    this.Database = loadBetterSqlite3();

    // Find blocklist database
    const foundPath = this.pathResolver.findFile('blocklist.db');
    if (!foundPath) {
      throw new Error('blocklist.db not found. Please ensure it exists in the application directory.');
    }
    this.blocklistPath = foundPath;
  }

  /**
   * Initialize blocklist - load and optionally update
   */
  public async initialize(): Promise<void> {
    this.logger.info('Initializing blocklist...');

    // Open database
    this.db = new this.Database(this.blocklistPath);

    // Update from remote if enabled
    if (this.autoUpdate) {
      await this.updateFromRemote();
    }

    // Compile keyword patterns for faster matching
    this.compileKeywordPatterns();

    // Start periodic updates if enabled
    if (this.autoUpdate && this.updateInterval > 0) {
      this.startPeriodicUpdates();
    }

    const stats = this.getStats();
    this.logger.info('Blocklist initialized', stats);
  }

  /**
   * Get blocklist statistics
   */
  public getStats() {
    if (!this.db) return {};

    return {
      blockedGroups: this.db.prepare('SELECT COUNT(*) as count FROM blocked_groups').get().count,
      blockedUsers: this.db.prepare('SELECT COUNT(*) as count FROM blocked_users').get().count,
      keywords: this.db.prepare('SELECT COUNT(*) as count FROM keyword_blacklist').get().count,
      whitelistedGroups: this.db.prepare('SELECT COUNT(*) as count FROM whitelist_groups').get().count,
      whitelistedUsers: this.db.prepare('SELECT COUNT(*) as count FROM whitelist_users').get().count,
    };
  }

  /**
   * Compile keyword patterns for faster matching
   */
  private compileKeywordPatterns(): void {
    if (!this.db) return;

    this.compiledKeywordPatterns = [];
    const patterns = this.db.prepare('SELECT pattern FROM keyword_blacklist').all();

    for (const row of patterns) {
      try {
        const regex = new RegExp(row.pattern, 'i');

        // Test regex for ReDoS vulnerability by timing execution
        // Test against multiple patterns to catch catastrophic backtracking
        const testStrings = [
          'x'.repeat(REDOS_TEST_STRING_LENGTH), // Simple repeated character
          'ab'.repeat(REDOS_TEST_STRING_LENGTH / 2), // Alternating pattern
          'a'.repeat(REDOS_TEST_STRING_LENGTH / 2) + 'b'.repeat(REDOS_TEST_STRING_LENGTH / 2), // Two blocks
        ];

        let maxDuration = 0;
        for (const testString of testStrings) {
          const start = Date.now();

          try {
            regex.test(testString);
          } catch (testError) {
            this.logger.warn(`Regex pattern execution error: ${row.pattern}`, { error: testError });
            continue;
          }

          const duration = Date.now() - start;
          maxDuration = Math.max(maxDuration, duration);

          // Early exit if we detect slowness
          if (duration > REDOS_MAX_EXECUTION_TIME_MS) {
            break;
          }
        }

        if (maxDuration > REDOS_MAX_EXECUTION_TIME_MS) {
          this.logger.warn(`Regex pattern too slow (${maxDuration}ms), potential ReDoS - skipping: ${row.pattern}`);
          continue;
        }

        this.compiledKeywordPatterns.push(regex);
      } catch (error) {
        this.logger.warn(`Invalid regex pattern: ${row.pattern}`, { error });
      }
    }
  }

  /**
   * Update blocklist from remote URL
   */
  private async updateFromRemote(): Promise<void> {
    // Queue updates if one is already in progress to prevent race conditions
    if (this.updateInProgress) {
      this.logger.debug('Update already in progress, queueing request');
      return new Promise((resolve) => {
        this.updateQueue.push(resolve);
      });
    }

    this.updateInProgress = true;
    this.logger.debug('Checking for blocklist updates from remote...');

    try {
      const tempPath = this.blocklistPath + '.tmp';

      // Download database
      await this.downloadFile(this.remoteUrl, tempPath);

      // Verify it's a valid SQLite database
      let tempDb: any = null;
      try {
        tempDb = new this.Database(tempPath, { readonly: true });
        // Check if metadata table exists to validate database structure
        tempDb.prepare('SELECT value FROM metadata WHERE key = ?').get('lastUpdated');
      } catch (error) {
        // Ensure database is closed before cleanup
        if (tempDb) {
          try {
            tempDb.close();
          } catch {
            // Ignore close errors
          }
        }
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        throw new Error('Downloaded file is not a valid SQLite database');
      } finally {
        // Always close the database
        if (tempDb) {
          try {
            tempDb.close();
          } catch {
            // Ignore close errors
          }
        }
      }

      // Check if different from current
      if (fs.existsSync(this.blocklistPath)) {
        const currentHash = this.getFileHash(this.blocklistPath);
        const newHash = this.getFileHash(tempPath);

        if (currentHash === newHash) {
          this.logger.debug('Blocklist is up to date');
          fs.unlinkSync(tempPath);
          return;
        }
      }

      // Replace old database with new one
      if (this.db) {
        this.db.close();
        this.db = null;
      }

      // Wait a bit for file handles to be fully released (Windows issue)
      await new Promise(resolve => setTimeout(resolve, FILE_HANDLE_RELEASE_DELAY_MS));

      fs.renameSync(tempPath, this.blocklistPath);

      // Wait again before reopening
      await new Promise(resolve => setTimeout(resolve, DATABASE_REOPEN_DELAY_MS));

      // Reopen database
      this.db = new this.Database(this.blocklistPath);

      // Verify database is readable
      try {
        const testStats = this.getStats();
        this.logger.debug('Database reopened successfully', testStats);
      } catch (error) {
        this.logger.error('Database verification failed after update', { error });
        throw new Error('Database corrupted after update');
      }

      // Recompile patterns
      this.compileKeywordPatterns();

      this.logger.info('Blocklist updated from remote');

      // Check version
      const version = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get('appVersion');
      if (version && version.value !== APP_VERSION) {
        const event: VersionMismatchEvent = {
          currentVersion: APP_VERSION,
          remoteVersion: version.value,
          message: `New version available: ${version.value} (current: ${APP_VERSION})`,
        };
        this.emit('versionMismatch', event);
      }

      const stats = this.getStats();
      const event: BlocklistUpdatedEvent = {
        source: 'remote',
        timestamp: new Date(),
        entriesCount: (stats.blockedGroups || 0) + (stats.blockedUsers || 0),
        keywordsCount: stats.keywords || 0,
      };
      this.emit('blocklistUpdated', event);
    } catch (error) {
      this.logger.error('Failed to update blocklist from remote', {
        error: error instanceof Error ? error.message : String(error),
        url: this.remoteUrl,
      });
    } finally {
      this.updateInProgress = false;

      // Notify all queued update requests
      const callbacks = this.updateQueue.splice(0);
      callbacks.forEach(cb => cb());
    }
  }

  /**
   * Download file from URL with SSRF protection and timeout
   */
  private async downloadFile(url: string, dest: string, redirectCount: number = 0): Promise<void> {
    if (redirectCount > HTTP_MAX_REDIRECTS) {
      throw new Error(`Too many redirects (${redirectCount})`);
    }

    // Validate URL to prevent SSRF
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Only allow HTTPS and HTTP protocols
    if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
      throw new Error(`Invalid URL protocol: ${urlObj.protocol}. Only HTTP(S) allowed.`);
    }

    // Prevent access to private IP ranges and localhost
    const hostname = urlObj.hostname.toLowerCase();
    if (this.isPrivateHost(hostname)) {
      throw new Error(`Access to private IP/hostname not allowed: ${hostname}`);
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      let timeoutHandle: NodeJS.Timeout | null = null;

      const request = https.get(url, { timeout: BLOCKLIST_DOWNLOAD_TIMEOUT_MS }, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          file.close();
          if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
          }

          const location = response.headers.location;
          if (!location) {
            return reject(new Error('Redirect without location header'));
          }

          // Clear timeout for redirect
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          return this.downloadFile(location, dest, redirectCount + 1).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
          }
          return reject(new Error(`Failed to download: ${response.statusCode}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
          resolve();
        });
      });

      request.on('timeout', () => {
        request.destroy();
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(new Error('Download timeout'));
      });

      request.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(error);
      });
    });
  }

  /**
   * Check if hostname is a private IP or localhost
   */
  private isPrivateHost(hostname: string): boolean {
    // Check for localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Check for private IPv4 ranges
    const ipv4Pattern = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
    const match = hostname.match(ipv4Pattern);
    if (match) {
      const octets = match.slice(1).map(Number);
      const [a, b] = octets;

      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
    }

    // Check for private IPv6 ranges
    if (hostname.includes(':')) {
      // fc00::/7 (unique local address)
      if (hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
      // fe80::/10 (link-local)
      if (hostname.startsWith('fe80')) return true;
    }

    return false;
  }

  /**
   * Get cryptographic file hash for comparison
   */
  private getFileHash(filePath: string): string {
    const crypto = require('crypto');
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Start periodic updates
   */
  private startPeriodicUpdates(): void {
    const intervalMs = this.updateInterval * MINUTES_TO_MS;
    this.updateTimer = setInterval(() => {
      this.updateFromRemote();
    }, intervalMs);

    this.logger.info(`Blocklist auto-update enabled (every ${this.updateInterval} minutes)`);
  }

  /**
   * Check if user is in any blocked groups or matches patterns
   */
  public async checkUser(userId: string, displayName: string): Promise<MatchResult> {
    if (!this.db) {
      throw new Error('BlocklistManager not initialized');
    }

    this.logger.verbose('BlocklistManager: Starting user check', { userId, displayName });

    const matches: Match[] = [];

    // Check if user is whitelisted
    const whitelisted = this.db.prepare('SELECT * FROM whitelist_users WHERE user_id = ?').get(userId);
    this.logger.verbose('BlocklistManager: Whitelist check', { userId, whitelisted: !!whitelisted, data: whitelisted });

    if (whitelisted) {
      this.logger.debug(`User ${userId} is whitelisted`, { reason: whitelisted.reason });
      return { matched: false, userId, displayName, matches: [] };
    }

    // Check if user is directly blocked
    const blockedUser = this.db.prepare('SELECT * FROM blocked_users WHERE user_id = ?').get(userId);
    this.logger.verbose('BlocklistManager: Direct user block check', { userId, blocked: !!blockedUser, data: blockedUser });

    if (blockedUser) {
      matches.push({
        type: 'blockedUser',
        details: blockedUser.reason || 'Blocked user',
        severity: (blockedUser.severity as Severity) || 'high',
        reason: blockedUser.reason || 'Blocked user',
        author: blockedUser.author || 'Unknown',
      });
      // Still continue to check groups and keywords for additional context
    }

    // Get user groups
    let groups: any[] = [];
    try {
      groups = await this.vrchatAPI.getUserGroups(userId);
      this.logger.verbose('BlocklistManager: User groups retrieved', {
        userId,
        groupCount: groups.length,
        groups: groups.map(g => ({ id: g.id, groupId: g.groupId, name: g.name, description: g.description }))
      });
    } catch (error) {
      this.logger.error('Failed to fetch user groups - cannot verify group membership', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't return - we can still check keywords in profile
      // But add a warning match to alert about the API failure
      matches.push({
        type: 'keywordUser',
        details: 'API Error: Could not verify group membership',
        severity: 'medium',
        reason: 'VRChat API failed to return user groups - security check incomplete',
        author: 'System',
      });
    }

    // Check each group
    for (const group of groups) {
      // Extract the actual group ID - VRChat API returns group.id as membership ID (gmem_xxx)
      // and group.groupId as the actual group ID (grp_xxx)
      const actualGroupId = group.groupId || group.id;

      this.logger.verbose('BlocklistManager: Checking group', {
        membershipId: group.id,
        groupId: actualGroupId,
        groupName: group.name,
        groupDescription: group.description
      });

      // Skip whitelisted groups
      const whitelistedGroup = this.db.prepare('SELECT * FROM whitelist_groups WHERE group_id = ?').get(actualGroupId);
      if (whitelistedGroup) {
        this.logger.debug(`Group ${actualGroupId} is whitelisted`, { name: group.name });
        this.logger.verbose('BlocklistManager: Group whitelisted', { groupId: actualGroupId, data: whitelistedGroup });
        continue;
      }

      // Check blocked groups
      const blockedGroup = this.db.prepare('SELECT * FROM blocked_groups WHERE group_id = ?').get(actualGroupId);
      this.logger.verbose('BlocklistManager: Group block check', {
        groupId: actualGroupId,
        blocked: !!blockedGroup,
        data: blockedGroup
      });

      if (blockedGroup) {
        this.logger.verbose('BlocklistManager: MATCH - Blocked group found', {
          groupId: actualGroupId,
          groupName: group.name,
          blockInfo: blockedGroup
        });

        matches.push({
          type: 'blockedGroup',
          details: blockedGroup.reason || 'Member of blocked group',
          severity: (blockedGroup.severity as Severity) || 'medium',
          groupId: actualGroupId,
          groupName: group.name,
          reason: blockedGroup.reason || 'Member of blocked group',
          author: blockedGroup.author || 'Unknown',
        });
        continue;
      }

      // Check keyword patterns
      for (const pattern of this.compiledKeywordPatterns) {
        const matchesName = pattern.test(group.name || '');
        const matchesDesc = pattern.test(group.description || '');

        this.logger.verbose('BlocklistManager: Keyword pattern test', {
          groupId: actualGroupId,
          pattern: pattern.source,
          matchesName,
          matchesDesc,
          groupName: group.name,
          groupDescription: group.description
        });

        if (matchesName || matchesDesc) {
          const patternInfo = this.db.prepare('SELECT * FROM keyword_blacklist WHERE pattern = ?').get(pattern.source);
          const matchedText = matchesName ? group.name : group.description;
          const matchLocation = matchesName ? 'groupName' : 'groupDescription';

          this.logger.verbose('BlocklistManager: MATCH - Keyword pattern matched', {
            groupId: actualGroupId,
            groupName: group.name,
            pattern: pattern.source,
            matchLocation,
            matchedText,
            patternInfo
          });

          matches.push({
            type: 'keywordGroup',
            details: patternInfo?.reason || `Group matches keyword pattern`,
            severity: (patternInfo?.severity as Severity) || 'medium',
            groupId: actualGroupId,
            groupName: group.name,
            keyword: pattern.source,
            keywordMatchLocation: matchLocation,
            matchedText: matchedText,
            reason: patternInfo?.reason || `Keyword pattern matched in group ${matchLocation}`,
            author: patternInfo?.author || 'Unknown',
          });
          // Break after first match to avoid duplicate matches for the same group
          break;
        }
      }
    }

    // Check user profile for keyword patterns
    try {
      const profile = await this.vrchatAPI.getUserProfile(userId);

      if (!profile) {
        throw new Error('Profile data is null');
      }

      this.logger.verbose('BlocklistManager: User profile retrieved', {
        userId,
        profile: {
          displayName: profile?.displayName,
          bio: profile?.bio,
          statusDescription: profile?.statusDescription,
          tags: profile?.tags
        }
      });

      for (const pattern of this.compiledKeywordPatterns) {
        const matchesDisplayName = pattern.test(profile.displayName || '');
        const matchesBio = pattern.test(profile.bio || '');

        this.logger.verbose('BlocklistManager: Profile keyword pattern test', {
          userId,
          pattern: pattern.source,
          matchesDisplayName,
          matchesBio,
          displayName: profile.displayName,
          bio: profile.bio
        });

        if (matchesDisplayName || matchesBio) {
          const patternInfo = this.db.prepare('SELECT * FROM keyword_blacklist WHERE pattern = ?').get(pattern.source);
          const matchedText = matchesDisplayName ? profile.displayName : profile.bio;
          const matchLocation = matchesDisplayName ? 'displayName' : 'bio';

          this.logger.verbose('BlocklistManager: MATCH - Profile keyword matched', {
            userId,
            pattern: pattern.source,
            matchLocation,
            matchedText,
            patternInfo
          });

          matches.push({
            type: 'keywordUser',
            details: patternInfo?.reason || `User profile matches keyword pattern`,
            severity: (patternInfo?.severity as Severity) || 'medium',
            keyword: pattern.source,
            keywordMatchLocation: matchLocation,
            matchedText: matchedText,
            reason: patternInfo?.reason || `Keyword pattern matched in user ${matchLocation}`,
            author: patternInfo?.author || 'Unknown',
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to fetch user profile for keyword check - profile patterns not verified', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Profile keyword check failed - this is less critical than group check
      // Only log the warning, don't add a match
    }

    const result = {
      matched: matches.length > 0,
      userId,
      displayName,
      matches,
    };

    this.logger.verbose('BlocklistManager: User check complete', {
      userId,
      displayName,
      matched: result.matched,
      matchCount: matches.length,
      matches
    });

    return result;
  }

  /**
   * Force update from remote
   */
  public async forceUpdate(): Promise<boolean> {
    try {
      await this.updateFromRemote();
      return true;
    } catch (error) {
      this.logger.error('Force update failed', { error });
      return false;
    }
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
