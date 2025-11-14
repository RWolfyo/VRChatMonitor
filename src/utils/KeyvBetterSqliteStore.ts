import { EventEmitter } from 'events';
import { loadBetterSqlite3 } from './SqliteLoader';
import { KEYV_CLEANUP_INTERVAL_MS } from '../constants';

/**
 * Keyv store adapter using better-sqlite3
 * Compatible with Keyv's store interface
 */
export class KeyvBetterSqliteStore extends EventEmitter {
  private db: any;
  private namespace: string;
  private tableName: string;
  private Database: any;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: { uri?: string; namespace?: string } = {}) {
    super();

    this.namespace = options.namespace || 'keyv';
    // Sanitize table name - replace special characters with underscore
    this.tableName = this.namespace.replace(/[^a-zA-Z0-9_]/g, '_');
    this.Database = loadBetterSqlite3();

    // Extract path from URI or use default
    const dbPath = options.uri?.replace('sqlite://', '') || '.cache/session.sqlite';

    // Initialize database
    try {
      this.db = new this.Database(dbPath);

      // Create table if it doesn't exist (use sanitized table name)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS "${this.tableName}" (
          key TEXT PRIMARY KEY,
          value TEXT,
          expires INTEGER
        )
      `);

      // Start automatic cleanup of expired entries every hour
      this.startAutoCleanup();
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, KEYV_CLEANUP_INTERVAL_MS);
  }

  /**
   * Cleanup expired entries from the database
   */
  private cleanupExpired(): void {
    try {
      const result = this.db
        .prepare(`DELETE FROM "${this.tableName}" WHERE expires IS NOT NULL AND expires < ?`)
        .run(Date.now());

      if (result.changes > 0) {
        // Silently clean up - don't spam logs
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Get a value from the store
   */
  get(key: string): any {
    try {
      const row = this.db
        .prepare(`SELECT value, expires FROM "${this.tableName}" WHERE key = ?`)
        .get(key);

      if (!row) {
        return undefined;
      }

      // Check if expired
      if (row.expires && row.expires < Date.now()) {
        this.delete(key);
        return undefined;
      }

      return JSON.parse(row.value);
    } catch (error) {
      this.emit('error', error);
      return undefined;
    }
  }

  /**
   * Set a value in the store
   */
  set(key: string, value: any, ttl?: number): void {
    try {
      const expires = ttl ? Date.now() + ttl : null;
      const valueStr = JSON.stringify(value);

      this.db
        .prepare(
          `INSERT OR REPLACE INTO "${this.tableName}" (key, value, expires) VALUES (?, ?, ?)`
        )
        .run(key, valueStr, expires);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Delete a value from the store
   */
  delete(key: string): boolean {
    try {
      const result = this.db
        .prepare(`DELETE FROM "${this.tableName}" WHERE key = ?`)
        .run(key);

      return result.changes > 0;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Clear all values from the store
   */
  clear(): void {
    try {
      this.db.prepare(`DELETE FROM "${this.tableName}"`).run();
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.db) {
      this.db.close();
    }
  }
}
