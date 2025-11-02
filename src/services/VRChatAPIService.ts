import { VRChat } from 'vrchat';
import Keyv from 'keyv';
import path from 'path';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { LoginPrompt } from '../utils/LoginPrompt';
import { KeyvBetterSqliteStore } from '../utils/KeyvBetterSqliteStore';
import { APP_VERSION } from '../version';

export interface VRChatCredentials {
  username: string;
  password: string;
}

export interface CachedResponse<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface StoredSession {
  cookies: any;
  timestamp: number;
  expiresAt?: number;
}

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_REFRESH_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours

export class VRChatAPIService {
  private client: VRChat | null = null;
  private logger: Logger;
  private cache: Map<string, CachedResponse<any>>;
  private keyv: Keyv;
  private currentUser: any = null;
  private loginPrompt: LoginPrompt;
  private sessionTimestamp: number = 0;
  private onCredentialsSaved?: (username: string, password: string) => void;

  constructor(
    private credentials: VRChatCredentials | null = null,
    cacheDir?: string,
    onCredentialsSaved?: (username: string, password: string) => void
  ) {
    this.logger = Logger.getInstance();
    this.cache = new Map();
    this.loginPrompt = new LoginPrompt();
    this.onCredentialsSaved = onCredentialsSaved;

    const pathResolver = new PathResolver();
    const actualCacheDir = pathResolver.getCacheDir(cacheDir);
    const sessionDb = path.join(actualCacheDir, 'session.sqlite');

    this.logger.debug('Session database path', { sessionDb });

    // Initialize Keyv for persistent session storage using our custom better-sqlite3 store
    // This uses the same better-sqlite3 we already have for blocklist
    this.keyv = new Keyv({
      store: new KeyvBetterSqliteStore({
        uri: `sqlite://${sessionDb}`,
        namespace: 'vrchat'
      })
    });

    this.keyv.on('error', (err) => {
      this.logger.error('Keyv connection error', { error: err });
    });
  }

  /**
   * Authenticate with VRChat API (with interactive login)
   */
  public async authenticate(): Promise<void> {
    try {
      // Check if we have a valid session first
      const hasValidSession = await this.tryResumeSession();
      if (hasValidSession) {
        this.logger.info('Resumed existing session');
        return;
      }

      // Interactive login flow
      await this.performLogin();

    } catch (error) {
      this.logger.error('Authentication failed', { error });
      throw new Error(`VRChat authentication failed: ${error}`);
    }
  }

  /**
   * Try to resume existing session
   */
  private async tryResumeSession(): Promise<boolean> {
    try {
      const storedSession = await this.keyv.get('session') as StoredSession;

      if (!storedSession || !storedSession.cookies) {
        this.logger.debug('No stored session found');
        return false;
      }

      // Check if session needs refresh (6 hours before expiry)
      if (storedSession.expiresAt && storedSession.timestamp) {
        const now = Date.now();
        const timeUntilExpiry = storedSession.expiresAt - now;

        if (timeUntilExpiry < SESSION_REFRESH_THRESHOLD && timeUntilExpiry > 0) {
          this.logger.info('Session expires soon, will refresh after test');
        }
      }

      // Initialize client with stored session - Keyv will restore cookies automatically
      this.client = new VRChat({
        application: {
          name: 'VRChat Monitor',
          version: APP_VERSION,
          contact: 'hubert@wolfyo.eu',
        },
        keyv: this.keyv, // VRChat client will load cookies from Keyv
        verbose: false,
      });

      this.logger.debug('VRChat client initialized with stored session');

      // Test if session is still valid
      try {
        const user = await this.getCurrentUser();
        this.currentUser = user;
        this.sessionTimestamp = storedSession.timestamp;

        this.logger.info(`✓ Logged in as: ${user.displayName} (session reuse)`, {
          userId: user.id,
        });

        // Refresh if needed
        if (storedSession.expiresAt) {
          const timeUntilExpiry = storedSession.expiresAt - Date.now();
          if (timeUntilExpiry < SESSION_REFRESH_THRESHOLD && timeUntilExpiry > 0) {
            await this.refreshSession();
          }
        }

        return true;
      } catch (error) {
        this.logger.warn('Stored session is invalid, will re-login');
        await this.keyv.delete('session');
        return false;
      }
    } catch (error) {
      this.logger.debug('Error trying to resume session', { error });
      return false;
    }
  }

  /**
   * Perform interactive login
   */
  private async performLogin(): Promise<void> {
    this.logger.info('Authenticating with VRChat API...');

    // Get credentials interactively
    const loginCreds = await this.loginPrompt.promptLogin(
      this.credentials?.username,
      this.credentials?.password
    );

    // Create client with authentication credentials (recommended pattern)
    this.client = new VRChat({
      application: {
        name: 'VRChat Monitor',
        version: APP_VERSION,
        contact: 'hubert@wolfyo.eu',
      },
      authentication: {
        credentials: {
          username: loginCreds.username,
          password: loginCreds.password,
          // This function will be called if 2FA is required
          twoFactorCode: async () => {
            const code = await this.loginPrompt.prompt2FACode(['totp']);
            return code;
          }
        },
        // Authenticate immediately
        optimistic: true
      },
      keyv: this.keyv,
      verbose: false,
    });

    // Get current user to verify authentication succeeded
    const userResult = await this.getCurrentUser();
    this.currentUser = userResult;
    this.sessionTimestamp = Date.now();

    // Wait a bit for the VRChat client to store cookies in Keyv
    await new Promise(resolve => setTimeout(resolve, 500));

    // Store session metadata (Keyv already has the cookies from VRChat client)
    const sessionExpiry = this.sessionTimestamp + (24 * 60 * 60 * 1000);
    await this.keyv.set('session', {
      cookies: true, // Marker that we have a session
      timestamp: this.sessionTimestamp,
      expiresAt: sessionExpiry,
    } as StoredSession);

    console.log(`✓ Logged in as: ${this.currentUser.displayName}`);
    this.logger.info(`Successfully authenticated as: ${this.currentUser.displayName}`, {
      userId: this.currentUser.id,
    });

    // Save credentials to config for next time
    if (this.onCredentialsSaved) {
      this.onCredentialsSaved(loginCreds.username, loginCreds.password);
      console.log('💾 Credentials saved for next time');
    }

    this.loginPrompt.close();
  }

  /**
   * Refresh session to extend expiry
   */
  private async refreshSession(): Promise<void> {
    try {
      this.logger.info('Refreshing session...');

      // Just fetch current user to refresh the auth token
      await this.getCurrentUser();

      // Update session timestamp
      const newTimestamp = Date.now();
      const newExpiry = newTimestamp + (24 * 60 * 60 * 1000);

      await this.keyv.set('session', {
        cookies: await this.keyv.get('cookies'),
        timestamp: newTimestamp,
        expiresAt: newExpiry,
      } as StoredSession);

      this.sessionTimestamp = newTimestamp;
      this.logger.info('Session refreshed successfully');
    } catch (error) {
      this.logger.warn('Failed to refresh session', { error });
      // Don't throw - session might still be valid, will fail on next API call if not
    }
  }

  /**
   * Get current authenticated user
   */
  public async getCurrentUser(): Promise<any> {
    if (!this.client) {
      throw new Error('VRChat client not initialized. Call authenticate() first.');
    }

    try {
      this.logger.verbose('API Request: getCurrentUser');
      const response = await (this.client as any).getCurrentUser();

      this.logger.verbose('API Response: getCurrentUser', {
        success: !response.error,
        data: response.data,
        error: response.error
      });

      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.data;
    } catch (error) {
      this.logger.error('Failed to get current user', { error });
      throw error;
    }
  }

  /**
   * Get user groups (with caching)
   */
  public async getUserGroups(userId: string): Promise<any[]> {
    if (!this.client) {
      throw new Error('VRChat client not initialized. Call authenticate() first.');
    }

    // Check cache first
    const cacheKey = `groups:${userId}`;
    const cached = this.getFromCache<any[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for user groups: ${userId}`);
      return cached;
    }

    try {
      this.logger.debug(`Fetching groups for user: ${userId}`);
      this.logger.verbose('API Request: getUserGroups', { userId });

      const response = await (this.client as any).getUserGroups({ path: { userId } });

      this.logger.verbose('API Response: getUserGroups', {
        userId,
        success: !response.error,
        groupCount: response.data?.length || 0,
        groups: response.data,
        error: response.error
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const groups = response.data || [];
      this.setCache(cacheKey, groups);

      return groups;
    } catch (error) {
      this.logger.error(`Failed to fetch groups for user: ${userId}`, { error });
      // Return empty array on error to allow monitoring to continue
      return [];
    }
  }

  /**
   * Get user profile (with caching)
   */
  public async getUserProfile(userId: string): Promise<any | null> {
    if (!this.client) {
      throw new Error('VRChat client not initialized. Call authenticate() first.');
    }

    // Check cache first
    const cacheKey = `profile:${userId}`;
    const cached = this.getFromCache<any>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for user profile: ${userId}`);
      return cached;
    }

    try {
      this.logger.debug(`Fetching profile for user: ${userId}`);
      this.logger.verbose('API Request: getUser', { userId });

      const response = await (this.client as any).getUser({ path: { userId } });

      this.logger.verbose('API Response: getUser', {
        userId,
        success: !response.error,
        profile: response.data,
        error: response.error
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const profile = response.data;
      this.setCache(cacheKey, profile);

      return profile;
    } catch (error) {
      this.logger.error(`Failed to fetch profile for user: ${userId}`, { error });
      // Return null on error to allow monitoring to continue
      return null;
    }
  }

  /**
   * Check if a user is the current authenticated user
   */
  public isCurrentUser(userId: string): boolean {
    return this.currentUser && this.currentUser.id === userId;
  }

  /**
   * Get from cache if not expired
   */
  private getFromCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Set cache with expiration
   */
  private setCache<T>(key: string, data: T, ttl: number = CACHE_DURATION_MS): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Clear all caches
   */
  public clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }

  /**
   * Clean up expired cache entries
   */
  public pruneCache(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.logger.debug(`Pruned ${pruned} expired cache entries`);
    }
  }

  /**
   * Disconnect and cleanup
   */
  public async disconnect(): Promise<void> {
    this.clearCache();
    await this.keyv.disconnect();
    this.client = null;
    this.logger.info('VRChat API service disconnected');
  }
}
