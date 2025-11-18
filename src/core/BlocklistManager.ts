import fs from 'fs';
import https from 'https';
import { EventEmitter } from 'events';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
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
import { createErrorContext } from '../utils/ErrorUtils';

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
  private obscenityMatcher: RegExpMatcher | null = null;
  private obscenityEnabled: boolean = true;
  private obscenityMatchSeverity: Severity = 'high';

  constructor(
    vrchatAPI: VRChatAPIService,
    remoteUrl: string,
    autoUpdate: boolean = true,
    updateInterval: number = 60,
    obscenityEnabled: boolean = true,
    obscenityMatchSeverity: Severity = 'high'
  ) {
    super();
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();
    this.vrchatAPI = vrchatAPI;
    this.remoteUrl = remoteUrl;
    this.autoUpdate = autoUpdate;
    this.updateInterval = updateInterval;
    this.obscenityEnabled = obscenityEnabled;
    this.obscenityMatchSeverity = obscenityMatchSeverity;

    // Load better-sqlite3 with proper native module resolution
    this.Database = loadBetterSqlite3();

    // Find blocklist database
    const foundPath = this.pathResolver.findFile('blocklist.db');
    if (!foundPath) {
      throw new Error('blocklist.db not found. Please ensure it exists in the application directory.');
    }
    this.blocklistPath = foundPath;

    // Initialize obscenity matcher if enabled
    if (this.obscenityEnabled) {
      this.initializeObscenityMatcher();
    }
  }

  /**
   * Initialize obscenity matcher for offensive content detection
   */
  private initializeObscenityMatcher(): void {
    try {
      this.obscenityMatcher = new RegExpMatcher({
        ...englishDataset.build(),
        ...englishRecommendedTransformers,
      });
      this.logger.info('Obscenity filter initialized', {
        enabled: this.obscenityEnabled,
        severity: this.obscenityMatchSeverity,
      });
    } catch (error) {
      this.logger.error('Failed to initialize obscenity matcher', createErrorContext(error));
      this.obscenityMatcher = null;
      this.obscenityEnabled = false;
    }
  }

  /**
   * Check text for offensive content using obscenity matcher
   */
  private checkObscenity(text: string, context: import('../types/blocklist').KeywordMatchLocation): Match | null {
    if (!this.obscenityEnabled || !this.obscenityMatcher || !text) {
      return null;
    }

    try {
      const matches = this.obscenityMatcher.getAllMatches(text);

      if (matches.length > 0) {
        // Extract matched text from first match
        const firstMatch = matches[0];
        const matchedText = text.substring(firstMatch.startIndex, firstMatch.endIndex + 1);

        this.logger.verbose('BlocklistManager: MATCH - Obscenity filter detected offensive content', {
          context,
          matchedText,
          matchCount: matches.length,
        });

        return {
          type: 'keywordUser', // Use keywordUser type for profile matches
          details: `Offensive content detected in ${context}`,
          severity: this.obscenityMatchSeverity,
          keyword: '[Obscenity Filter]',
          keywordMatchLocation: context,
          matchedText: matchedText,
          reason: `Offensive or inappropriate language detected in ${context}`,
          author: 'Obscenity Filter',
        };
      }
    } catch (error) {
      this.logger.warn('Obscenity check failed', createErrorContext(error, { context, textLength: text.length }));
    }

    return null;
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
      this.logger.error('Failed to update blocklist from remote', createErrorContext(error, {
        url: this.remoteUrl,
      }));
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
   * Check if hostname is a private IP or localhost (SSRF protection)
   */
  private isPrivateHost(hostname: string): boolean {
    // Normalize hostname (lowercase, remove brackets from IPv6)
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    // Check for localhost variations (including DNS tricks)
    const localhostPatterns = [
      'localhost',
      'localhost.localdomain',
      'localtest.me', // DNS that resolves to 127.0.0.1
      'lvh.me', // Another localhost alias
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '::',
      '0:0:0:0:0:0:0:1',
      '0:0:0:0:0:0:0:0',
    ];

    if (localhostPatterns.some(pattern => normalized === pattern)) {
      return true;
    }

    // Check for IPv4 addresses (including alternative notations)
    const ipv4Pattern = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
    const match = normalized.match(ipv4Pattern);
    if (match) {
      const octets = match.slice(1).map(Number);

      // Validate octets are in valid range
      if (octets.some(octet => octet < 0 || octet > 255)) {
        return true; // Invalid IP, treat as suspicious
      }

      const [a, b, c] = octets;

      // 0.0.0.0/8 (current network)
      if (a === 0) return true;
      // 10.0.0.0/8 (private)
      if (a === 10) return true;
      // 127.0.0.0/8 (loopback)
      if (a === 127) return true;
      // 172.16.0.0/12 (private)
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16 (private)
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return true;
      // 192.0.0.0/24 (IETF Protocol Assignments)
      if (a === 192 && b === 0 && c === 0) return true;
      // 192.0.2.0/24 (TEST-NET-1)
      if (a === 192 && b === 0 && c === 2) return true;
      // 198.51.100.0/24 (TEST-NET-2)
      if (a === 198 && b === 51 && c === 100) return true;
      // 203.0.113.0/24 (TEST-NET-3)
      if (a === 203 && b === 0 && c === 113) return true;
      // 224.0.0.0/4 (multicast)
      if (a >= 224 && a <= 239) return true;
      // 240.0.0.0/4 (reserved)
      if (a >= 240) return true;
      // 100.64.0.0/10 (shared address space / carrier-grade NAT)
      if (a === 100 && b >= 64 && b <= 127) return true;
    }

    // Check for IPv6 private ranges (including alternative notations)
    if (normalized.includes(':')) {
      // IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
      if (normalized.includes('::ffff:')) {
        const ipv4Part = normalized.split('::ffff:')[1];
        if (ipv4Part) {
          return this.isPrivateHost(ipv4Part); // Recursively check the IPv4 part
        }
      }

      // fc00::/7 (unique local address)
      if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
      // fe80::/10 (link-local)
      if (normalized.startsWith('fe80')) return true;
      // fec0::/10 (deprecated site-local)
      if (normalized.startsWith('fec')) return true;
      // :: (unspecified)
      if (normalized === '::') return true;
      // ::1 (loopback - already checked above but double-check)
      if (normalized.startsWith('::1') || normalized === '0:0:0:0:0:0:0:1') return true;
    }

    // Check for DNS rebinding attempts (numeric hostname that's not an IP)
    // This catches edge cases like "2130706433" (decimal representation of 127.0.0.1)
    if (/^\d+$/.test(normalized)) {
      this.logger.warn('Blocked suspicious numeric hostname (potential DNS rebinding)', { hostname });
      return true;
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
      this.logger.error('Failed to fetch user groups - cannot verify group membership', createErrorContext(error, {
        userId
      }));
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

      // Check keyword patterns against all group fields
      for (const pattern of this.compiledKeywordPatterns) {
        const matchesName = pattern.test(group.name || '');
        const matchesDesc = pattern.test(group.description || '');
        const matchesRules = group.rules ? pattern.test(group.rules) : false;

        this.logger.verbose('BlocklistManager: Keyword pattern test', {
          groupId: actualGroupId,
          pattern: pattern.source,
          matchesName,
          matchesDesc,
          matchesRules,
          groupName: group.name,
          groupDescription: group.description,
          groupRules: group.rules
        });

        if (matchesName || matchesDesc || matchesRules) {
          const patternInfo = this.db.prepare('SELECT * FROM keyword_blacklist WHERE pattern = ?').get(pattern.source);
          let matchedText = '';
          let matchLocation: import('../types/blocklist').KeywordMatchLocation = 'groupName';

          if (matchesName) {
            matchedText = group.name;
            matchLocation = 'groupName';
          } else if (matchesDesc) {
            matchedText = group.description;
            matchLocation = 'groupDescription';
          } else if (matchesRules) {
            matchedText = group.rules;
            matchLocation = 'groupRules';
          }

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

      // Check group name and description with obscenity filter
      const obscenityNameMatch = this.checkObscenity(group.name || '', 'groupName');
      if (obscenityNameMatch) {
        matches.push({
          ...obscenityNameMatch,
          type: 'keywordGroup',
          groupId: actualGroupId,
          groupName: group.name,
        });
      }

      const obscenityDescMatch = this.checkObscenity(group.description || '', 'groupDescription');
      if (obscenityDescMatch) {
        matches.push({
          ...obscenityDescMatch,
          type: 'keywordGroup',
          groupId: actualGroupId,
          groupName: group.name,
        });
      }

      // Check group rules with obscenity filter (if available)
      if (group.rules) {
        const obscenityRulesMatch = this.checkObscenity(group.rules, 'groupRules');
        if (obscenityRulesMatch) {
          matches.push({
            ...obscenityRulesMatch,
            type: 'keywordGroup',
            groupId: actualGroupId,
            groupName: group.name,
          });
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

      // Check regex keyword patterns against all profile fields
      for (const pattern of this.compiledKeywordPatterns) {
        const matchesDisplayName = pattern.test(profile.displayName || '');
        const matchesBio = pattern.test(profile.bio || '');
        const matchesStatus = pattern.test(profile.statusDescription || '');

        // Check pronouns if available
        let matchesPronouns = false;
        let pronounsText = '';
        if (profile.tags && Array.isArray(profile.tags)) {
          const pronounsTag = profile.tags.find((tag: string) => tag.startsWith('pronouns_'));
          if (pronounsTag) {
            pronounsText = pronounsTag.replace('pronouns_', '').replace(/_/g, ' ');
            matchesPronouns = pattern.test(pronounsText);
          }
        }

        this.logger.verbose('BlocklistManager: Profile keyword pattern test', {
          userId,
          pattern: pattern.source,
          matchesDisplayName,
          matchesBio,
          matchesStatus,
          matchesPronouns,
          displayName: profile.displayName,
          bio: profile.bio,
          statusDescription: profile.statusDescription,
          pronouns: pronounsText
        });

        if (matchesDisplayName || matchesBio || matchesStatus || matchesPronouns) {
          const patternInfo = this.db.prepare('SELECT * FROM keyword_blacklist WHERE pattern = ?').get(pattern.source);
          let matchedText = '';
          let matchLocation: import('../types/blocklist').KeywordMatchLocation = 'displayName';

          if (matchesDisplayName) {
            matchedText = profile.displayName;
            matchLocation = 'displayName';
          } else if (matchesBio) {
            matchedText = profile.bio;
            matchLocation = 'bio';
          } else if (matchesStatus) {
            matchedText = profile.statusDescription;
            matchLocation = 'statusDescription';
          } else if (matchesPronouns) {
            matchedText = pronounsText;
            matchLocation = 'pronouns';
          }

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

      // Check profile fields with obscenity filter
      const obscenityDisplayNameMatch = this.checkObscenity(profile.displayName || '', 'displayName');
      if (obscenityDisplayNameMatch) {
        matches.push(obscenityDisplayNameMatch);
      }

      const obscenityBioMatch = this.checkObscenity(profile.bio || '', 'bio');
      if (obscenityBioMatch) {
        matches.push(obscenityBioMatch);
      }

      const obscenityStatusMatch = this.checkObscenity(profile.statusDescription || '', 'statusDescription');
      if (obscenityStatusMatch) {
        matches.push(obscenityStatusMatch);
      }

      // Check pronouns tag if available (VRChat stores custom pronouns in tags)
      if (profile.tags && Array.isArray(profile.tags)) {
        const pronounsTag = profile.tags.find((tag: string) => tag.startsWith('pronouns_'));
        if (pronounsTag) {
          const pronouns = pronounsTag.replace('pronouns_', '').replace(/_/g, ' ');
          const obscenityPronounsMatch = this.checkObscenity(pronouns, 'pronouns');
          if (obscenityPronounsMatch) {
            matches.push(obscenityPronounsMatch);
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to fetch user profile for keyword check - profile patterns not verified', createErrorContext(error, {
        userId,
      }));
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
