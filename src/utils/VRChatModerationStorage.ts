import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

/**
 * VRChat Local Player Moderation Types
 * As of October 2022, showAvatar/hideAvatar are stored locally
 * Reference: https://docs.vrchat.com/docs/local-vrchat-storage
 */
export enum VRChatModerationType {
  Default = 0,      // No moderation (use default setting)
  HideAvatar = 4,   // Hide user's avatar (show fallback)
  ShowAvatar = 5,   // Force show user's avatar
}

/**
 * Manages VRChat local player moderation storage
 * Handles reading/writing avatar show/hide preferences to VRChat's local storage
 */
export class VRChatModerationStorage {
  private vrchatDataPath: string | null = null;
  private currentUserId: string | null = null;

  constructor(private logger: Logger) {}

  /**
   * Initialize the moderation storage with current user ID
   * @param currentUserId The authenticated VRChat user ID
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
   * Detect VRChat's local data path
   * @returns Path to VRChat data directory or null if not found
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
   * Get the moderation file path for current user
   * @returns Moderation file path or null if not initialized
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
   * Read all moderations from VRChat storage
   * @returns Map of userId to moderation type
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
   * Get moderation type for a specific user
   * @param userId User ID to check
   * @returns Moderation type or Default if not found
   */
  public getUserModeration(userId: string): VRChatModerationType {
    const moderations = this.getAllModerations();
    return moderations.get(userId) || VRChatModerationType.Default;
  }

  /**
   * Set moderation type for a user
   * @param userId User ID to moderate
   * @param type Moderation type to apply
   * @returns Success status
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
   * Hide a user's avatar
   * @param userId User ID to hide
   * @returns Success status
   */
  public hideAvatar(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.HideAvatar);
  }

  /**
   * Show a user's avatar (force show)
   * @param userId User ID to show
   * @returns Success status
   */
  public showAvatar(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.ShowAvatar);
  }

  /**
   * Remove moderation for a user (revert to default)
   * @param userId User ID to reset
   * @returns Success status
   */
  public clearModeration(userId: string): boolean {
    return this.setUserModeration(userId, VRChatModerationType.Default);
  }

  /**
   * Check if storage is properly initialized
   * @returns True if ready to use
   */
  public isInitialized(): boolean {
    return this.vrchatDataPath !== null && this.currentUserId !== null;
  }
}
