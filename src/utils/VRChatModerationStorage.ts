/**
 * VRChat Local Player Moderation Storage Manager
 *
 * Manages VRChat's LocalPlayerModerations system for automatic avatar visibility control.
 * Directly reads and writes VRChat's local storage files to apply show/hide settings
 * that take effect immediately when VRChat reads them.
 *
 * Features:
 * - Direct file system integration with VRChat's AppData storage
 * - Per-user moderation persistence (survives VRChat restarts)
 * - Three moderation states: Default, HideAvatar, ShowAvatar
 * - Automatic directory creation if missing
 * - Cross-platform path detection (Windows primary)
 *
 * Storage Format:
 * VRChat stores moderations in: AppData\LocalLow\VRChat\VRChat\LocalPlayerModerations\
 * File naming: {currentUserId}-show-hide-user.vrcset
 * Entry format: "{userId padded to 64 chars}{type as 3-digit number}\n"
 *
 * Integration:
 * - Used by AvatarScannerService for autoHideAvatar feature
 * - Used by BlocklistManager for autoHideBlacklisted feature
 * - Changes apply immediately without VRChat restart
 *
 * Security:
 * - Only modifies current user's own moderation file
 * - Validates paths before file operations
 * - Graceful degradation if VRChat path not found
 *
 * @see https://docs.vrchat.com/docs/local-vrchat-storage
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

/**
 * VRChat local player moderation types.
 *
 * These values are written directly to VRChat's storage and control
 * avatar visibility behavior on a per-user basis.
 */
export enum VRChatModerationType {
  /** No moderation applied - use global avatar display setting */
  Default = 0,

  /** Hide this user's avatar - show fallback avatar instead */
  HideAvatar = 4,

  /** Force show this user's avatar - override safety settings */
  ShowAvatar = 5,
}

/**
 * VRChat Local Player Moderation Storage Manager.
 *
 * Provides programmatic access to VRChat's local avatar moderation system,
 * allowing automatic hiding/showing of specific users' avatars based on
 * performance criteria or blocklist matches.
 */
export class VRChatModerationStorage {
  /** Path to VRChat's AppData\LocalLow\VRChat\VRChat directory */
  private vrchatDataPath: string | null = null;

  /** Current authenticated VRChat user ID (used for file naming) */
  private currentUserId: string | null = null;

  /**
   * Create a new VRChat moderation storage manager.
   *
   * @param logger - Logger instance for debug/error messages
   */
  constructor(private logger: Logger) {}

  /**
   * Initialize the moderation storage system.
   *
   * Detects VRChat's data path, validates access, and ensures the
   * LocalPlayerModerations directory exists. Must be called after
   * VRChat authentication before using other methods.
   *
   * @param currentUserId - Authenticated VRChat user ID (usr_xxx format)
   */
  public initialize(currentUserId: string): void {
    this.currentUserId = currentUserId;
    this.vrchatDataPath = this.detectVRChatDataPath();

    if (!this.vrchatDataPath) {
      this.logger.warn('Could not detect VRChat data path. Avatar auto-hide will not work.');
      return;
    }

    // Ensure LocalPlayerModerations directory exists
    const modDir = path.join(this.vrchatDataPath, 'LocalPlayerModerations');
    if (!fs.existsSync(modDir)) {
      try {
        fs.mkdirSync(modDir, { recursive: true });
        this.logger.debug(`Created LocalPlayerModerations directory: ${modDir}`);
      } catch (error) {
        this.logger.error(`Failed to create LocalPlayerModerations directory: ${error}`);
      }
    }

    this.logger.info(`VRChat moderation storage initialized for user: ${currentUserId}`);
  }

  /**
   * Auto-detect VRChat's local storage directory.
   *
   * Searches for AppData\LocalLow\VRChat\VRChat using environment variables.
   * This is where VRChat stores configuration, logs, and moderation files.
   *
   * @returns Full path to VRChat data directory, or null if not found
   */
  private detectVRChatDataPath(): string | null {
    // VRChat stores data in AppData\LocalLow\VRChat\VRChat
    const appDataLocalLow = path.join(
      process.env.APPDATA || '',
      '..',
      'LocalLow',
      'VRChat',
      'VRChat'
    );

    const normalizedPath = path.normalize(appDataLocalLow);

    if (fs.existsSync(normalizedPath)) {
      this.logger.debug(`Found VRChat data path: ${normalizedPath}`);
      return normalizedPath;
    }

    this.logger.warn(`VRChat data path not found: ${normalizedPath}`);
    return null;
  }

  /**
   * Get the full path to the current user's moderation file.
   *
   * VRChat uses separate moderation files per user account to isolate settings.
   * File format: {currentUserId}-show-hide-user.vrcset
   *
   * @returns Full path to moderation file, or null if not initialized
   */
  private getModerationFilePath(): string | null {
    if (!this.vrchatDataPath || !this.currentUserId) {
      return null;
    }

    return path.join(
      this.vrchatDataPath,
      'LocalPlayerModerations',
      `${this.currentUserId}-show-hide-user.vrcset`
    );
  }

  /**
   * Read all avatar moderations from VRChat's storage file.
   *
   * Parses the .vrcset file to extract all user moderation settings.
   * Each line contains a user ID (padded to 64 chars) followed by a
   * 3-digit moderation type code.
   *
   * @returns Map of user IDs to their moderation types
   */
  public getAllModerations(): Map<string, VRChatModerationType> {
    const filePath = this.getModerationFilePath();
    if (!filePath || !fs.existsSync(filePath)) {
      return new Map();
    }

    const moderations = new Map<string, VRChatModerationType>();

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        const spaceIndex = line.indexOf(' ');
        if (spaceIndex <= 0) continue;

        const userId = line.substring(0, spaceIndex).trim();
        const typeStr = line.substring(line.length - 3).trim();
        const type = parseInt(typeStr, 10);

        if (!isNaN(type)) {
          moderations.set(userId, type as VRChatModerationType);
        }
      }

      this.logger.debug(`Loaded ${moderations.size} avatar moderations from VRChat storage`);
    } catch (error) {
      this.logger.error(`Failed to read VRChat moderations: ${error}`);
    }

    return moderations;
  }

  /**
   * Get the current moderation setting for a specific user.
   *
   * @param userId - VRChat user ID to check (usr_xxx format)
   * @returns Moderation type (Default if no moderation set)
   */
  public getUserModeration(userId: string): VRChatModerationType {
    const moderations = this.getAllModerations();
    return moderations.get(userId) || VRChatModerationType.Default;
  }

  /**
   * Set avatar moderation for a specific user.
   *
   * Reads the current moderation file, removes any existing entry for this user,
   * adds the new moderation (if not Default), and writes back to disk. VRChat
   * reads this file on startup and when entering instances.
   *
   * @param userId - VRChat user ID to moderate (usr_xxx format)
   * @param type - Moderation type to apply (Default removes the entry)
   * @returns True if successful, false if storage not initialized or write failed
   */
  public setUserModeration(userId: string, type: VRChatModerationType): boolean {
    const filePath = this.getModerationFilePath();
    if (!filePath) {
      this.logger.error('Cannot set moderation: VRChat storage not initialized');
      return false;
    }

    try {
      // Read existing moderations
      let lines: string[] = [];
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n').filter(line => line.trim());
      }

      // Remove existing moderation for this user
      lines = lines.filter(line => !line.startsWith(userId));

      // Add new moderation if not Default
      if (type !== VRChatModerationType.Default) {
        // Format: {userId padded to 64 chars}{type as 3-digit number}
        const paddedUserId = userId.padEnd(64, ' ');
        const typeStr = type.toString().padStart(3, '0');
        lines.push(`${paddedUserId}${typeStr}`);
      }

      // Write back to file
      fs.writeFileSync(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');

      const action = type === VRChatModerationType.Default ? 'Removed' :
                     type === VRChatModerationType.HideAvatar ? 'Hidden' : 'Shown';
      this.logger.debug(`${action} avatar for user: ${userId}`);

      return true;
    } catch (error) {
      this.logger.error(`Failed to set VRChat moderation for ${userId}: ${error}`);
      return false;
    }
  }

  /**
   * Hide a user's avatar (show fallback instead).
   *
   * Convenience method for `setUserModeration(userId, HideAvatar)`.
   * Used by auto-hide features for performance violations and blocklist matches.
   *
   * @param userId - VRChat user ID to hide
   * @returns True if successful, false if failed
   */
  public hideAvatar(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.HideAvatar);
  }

  /**
   * Force show a user's avatar (override safety settings).
   *
   * Convenience method for `setUserModeration(userId, ShowAvatar)`.
   * Use cautiously - bypasses VRChat's safety systems.
   *
   * @param userId - VRChat user ID to force show
   * @returns True if successful, false if failed
   */
  public showAvatar(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.ShowAvatar);
  }

  /**
   * Remove moderation for a user (revert to global settings).
   *
   * Convenience method for `setUserModeration(userId, Default)`.
   * Deletes the moderation entry from the file.
   *
   * @param userId - VRChat user ID to reset
   * @returns True if successful, false if failed
   */
  public clearModeration(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.Default);
  }

  /**
   * Check if the storage system is properly initialized and ready to use.
   *
   * @returns True if VRChat path detected and user ID set, false otherwise
   */
  public isInitialized(): boolean {
    return this.vrchatDataPath !== null && this.currentUserId !== null;
  }
}
