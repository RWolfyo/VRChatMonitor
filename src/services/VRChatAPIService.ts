import { VRChat } from 'vrchat';
import Keyv from 'keyv';
import path from 'path';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { LoginPrompt } from '../utils/LoginPrompt';
import { KeyvBetterSqliteStore } from '../utils/KeyvBetterSqliteStore';
import { APP_VERSION } from '../version';
import {
  API_CACHE_DURATION_MS,
  API_CACHE_PRUNE_INTERVAL_MS,
  API_RATE_LIMIT_CALLS,
  API_RATE_LIMIT_WINDOW_MS,
  API_CALL_SPACING_MS,
  SESSION_REFRESH_THRESHOLD_MS,
  SESSION_EXPIRY_MS,
  SESSION_COOKIE_SAVE_DELAY_MS,
} from '../constants';

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
  cookies: any; // Marker field - actual cookies managed by VRChat SDK in Keyv
  timestamp: number;
  expiresAt?: number;
}


export class VRChatAPIService {
  private client: VRChat | null = null;
  private logger: Logger;
  private cache: Map<string, CachedResponse<any>>;
  private keyv: Keyv;
  private currentUser: any = null;
  private loginPrompt: LoginPrompt;
  private sessionTimestamp: number = 0;
  private onCredentialsSaved?: (username: string, password: string) => void;
  private pruneTimer: NodeJS.Timeout | null = null;

  // Rate limiting: managed by constants
  private apiCallQueue: Array<{ fn: () => Promise<any>; resolve: (value: any) => void; reject: (error: any) => void }> = [];
  private isProcessingQueue: boolean = false;
  private callTimestamps: number[] = [];

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

    // Start automatic cache pruning
    this.startCachePruning();
  }

  /**
   * Start automatic cache pruning to prevent memory leaks
   */
  private startCachePruning(): void {
    this.pruneTimer = setInterval(() => {
      this.pruneCache();
    }, API_CACHE_PRUNE_INTERVAL_MS);
  }

  /**
   * Queue an API call with rate limiting (10 calls per 30 seconds)
   */
  private async queueApiCall<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.apiCallQueue.push({ fn: fn as () => Promise<any>, resolve, reject });

      if (!this.isProcessingQueue) {
        this.processApiQueue();
      }
    });
  }

  /**
   * Process the API call queue with rate limiting
   */
  private async processApiQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.apiCallQueue.length > 0) {
      // Clean up old timestamps outside the rate limit window
      const now = Date.now();
      this.callTimestamps = this.callTimestamps.filter(
        timestamp => now - timestamp < API_RATE_LIMIT_WINDOW_MS
      );

      // Check if we've hit the rate limit
      if (this.callTimestamps.length >= API_RATE_LIMIT_CALLS) {
        // Calculate how long to wait
        const oldestCall = this.callTimestamps[0];
        const waitTime = API_RATE_LIMIT_WINDOW_MS - (now - oldestCall);

        this.logger.debug(`Rate limit reached (${this.callTimestamps.length}/${API_RATE_LIMIT_CALLS}), waiting ${waitTime}ms`);

        // Wait before processing next call
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Get next call from queue
      const call = this.apiCallQueue.shift();
      if (!call) break;

      // Record this API call timestamp
      this.callTimestamps.push(Date.now());

      // Execute the API call
      try {
        const result = await call.fn();
        call.resolve(result);
      } catch (error) {
        call.reject(error);
      }

      // Small delay between calls to spread them out
      if (this.apiCallQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, API_CALL_SPACING_MS));
      }
    }

    this.isProcessingQueue = false;
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

      // Check if session needs refresh
      if (storedSession.expiresAt && storedSession.timestamp) {
        const now = Date.now();
        const timeUntilExpiry = storedSession.expiresAt - now;

        if (timeUntilExpiry < SESSION_REFRESH_THRESHOLD_MS && timeUntilExpiry > 0) {
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

      // Test if session is still valid with comprehensive validation
      try {
        this.logger.debug('Testing session validity...');

        // First, test getCurrentUser
        const user = await this.getCurrentUser();

        // Validate that we got a proper user object with required fields
        if (!user || !user.id || (!user.displayName && !user.username)) {
          this.logger.warn('Session returned invalid user data', {
            hasUser: !!user,
            hasId: !!user?.id,
            hasDisplayName: !!user?.displayName,
            hasUsername: !!user?.username,
            userData: user
          });
          throw new Error('Invalid user data from session - session may be expired');
        }

        // Additionally test a protected endpoint to ensure session really works
        // Try to fetch user's own groups - this will fail if session is expired
        this.logger.debug('Validating session with protected API call...');
        try {
          const testGroups = await this.getUserGroups(user.id);
          this.logger.debug('Session validation successful', {
            userId: user.id,
            canAccessProtectedEndpoints: true,
            groupCount: testGroups?.length || 0
          });
        } catch (groupError) {
          this.logger.warn('Session fails on protected endpoints', {
            error: groupError,
            userId: user.id
          });
          throw new Error('Session expired - cannot access protected endpoints');
        }

        this.currentUser = user;
        this.sessionTimestamp = storedSession.timestamp;

        // Debug: log the user object structure
        this.logger.debug('Session reuse user object', {
          hasDisplayName: !!user.displayName,
          hasUsername: !!user.username,
          keys: Object.keys(user).slice(0, 10)
        });

        this.logger.info(`✓ Logged in as: ${user.displayName || user.username} (session reuse)`, {
          userId: user.id,
        });

        // Refresh if needed
        if (storedSession.expiresAt) {
          const timeUntilExpiry = storedSession.expiresAt - Date.now();
          if (timeUntilExpiry < SESSION_REFRESH_THRESHOLD_MS && timeUntilExpiry > 0) {
            await this.refreshSession();
          }
        }

        return true;
      } catch (error) {
        this.logger.warn('Stored session is invalid, will re-login', {
          error: getErrorMessage(error)
        });
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
    await new Promise(resolve => setTimeout(resolve, SESSION_COOKIE_SAVE_DELAY_MS));

    // Store session metadata (Keyv already has the cookies from VRChat client)
    const sessionExpiry = this.sessionTimestamp + SESSION_EXPIRY_MS;
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
      const newExpiry = newTimestamp + SESSION_EXPIRY_MS;

      // Store session metadata - VRChat SDK manages its own cookies in Keyv
      // We just track when the session was created/refreshed and when it expires
      await this.keyv.set('session', {
        cookies: true, // Marker that a session exists (cookies are managed by VRChat SDK)
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

      // Handle case where response.data might be wrapped
      const userData = response.data || response;
      return userData;
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

    // Queue the API call with rate limiting
    return this.queueApiCall(async () => {
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
        // Throw error instead of returning empty array - caller must handle
        throw error;
      }
    });
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

    // Queue the API call with rate limiting
    return this.queueApiCall(async () => {
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
        // Throw error instead of returning null - caller must handle
        throw error;
      }
    });
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
  private setCache<T>(key: string, data: T, ttl: number = API_CACHE_DURATION_MS): void {
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
    // Stop cache pruning timer
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }

    this.clearCache();
    await this.keyv.disconnect();
    this.client = null;
    this.logger.info('VRChat API service disconnected');
  }
}
