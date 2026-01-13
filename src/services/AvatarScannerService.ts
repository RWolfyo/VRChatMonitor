/**
 * Avatar Performance Scanner Service
 *
 * Monitors VRChat avatar performance metrics and alerts when users join with
 * avatars that exceed configured performance thresholds.
 *
 * Features:
 * - Fetches avatar data from VRChat API with intelligent caching
 * - Checks 15+ performance metrics against user-defined thresholds
 * - Two data sources: Basic avatar info (always available) + FileAnalysis (permission-based)
 * - Time-based cache prevents excessive API calls
 * - Supports null thresholds for selective checking
 *
 * Data Flow:
 * 1. User joins instance → Get user profile for currentAvatar ID
 * 2. Check cache for avatar data (60min default TTL)
 * 3. If not cached: Fetch from VRChat API (getAvatar + getFileAnalysis)
 * 4. Compare metrics against configured thresholds
 * 5. Return violations for alert generation
 *
 * Performance Considerations:
 * - Caching dramatically reduces API load (same avatar seen = 1 API call per hour)
 * - FileAnalysis may not be available for all avatars (permission-based)
 * - Performance rating always available, detailed stats sometimes missing
 *
 * @see AvatarScanningConfig in types/config.ts for configuration options
 */

import type { VRChatAPIService } from './VRChatAPIService';
import type { Logger } from '../utils/Logger';
import type { AvatarThresholds } from '../types/config';
import { MINUTES_TO_MS, AVATAR_PERFORMANCE_RATING_ORDER } from '../constants';

/**
 * Complete avatar data with performance metrics.
 *
 * Contains all information needed for threshold checking and alerts.
 * Stats may be partially available depending on API permissions.
 */
export interface AvatarData {
  /** Unique avatar ID from VRChat */
  avatarId: string;

  /** Avatar display name */
  avatarName: string;

  /** Author/creator user ID */
  authorId: string;

  /** Author/creator username */
  authorName: string;

  /** VRChat performance rating (Excellent/Good/Medium/Poor/VeryPoor) */
  performanceRating?: string;

  /** Detailed performance statistics (may be unavailable for some avatars) */
  stats?: AvatarStats;

  /** Thumbnail image URL */
  thumbnailUrl?: string;

  /** Timestamp when this data was fetched (for cache expiry) */
  fetchedAt: number;
}

/**
 * Detailed avatar performance statistics.
 *
 * Sourced from VRChat API FileAnalysis endpoint.
 * All fields are optional - availability depends on:
 * - Avatar upload permissions
 * - API access level
 * - Avatar platform (PC vs Quest)
 */
export interface AvatarStats {
  /** Total triangle/polygon count */
  totalPolygons?: number;

  /** Total vertex count */
  totalVertices?: number;

  /** Number of particle systems on avatar */
  particleSystemCount?: number;

  /** Maximum particles across all systems */
  totalMaxParticles?: number;

  /** Whether any particle system has collision enabled */
  particleCollisionEnabled?: boolean;

  /** Whether any particle system uses trails */
  particleTrailsEnabled?: boolean;

  /** Number of bones in skeleton */
  boneCount?: number;

  /** Number of PhysBones components */
  physBoneComponentCount?: number;

  /** Number of PhysBones colliders */
  physBoneColliderCount?: number;

  /** Number of transforms affected by PhysBones */
  physBoneTransformCount?: number;

  /** Number of unique materials */
  materialCount?: number;

  /** Number of mesh renderers */
  meshCount?: number;

  /** Number of realtime lights */
  lightCount?: number;

  /** Number of audio sources */
  audioSourceCount?: number;

  /** Compressed file size in bytes (convert to MB: / 1048576) */
  fileSize?: number;

  /** Uncompressed memory size in bytes */
  uncompressedSize?: number;

  /** Total texture memory usage in bytes */
  totalTextureUsage?: number;
}

/**
 * Represents a single threshold violation.
 *
 * Generated when avatar exceeds configured performance thresholds.
 * Used for alert generation and logging.
 */
export interface AvatarViolation {
  /** Human-readable field name (e.g., "Total Polygons") */
  field: string;

  /** Actual value from avatar */
  value: number | boolean | string;

  /** Configured threshold that was exceeded */
  threshold: number | boolean | string;

  /** Severity level for alert priority */
  severity: 'low' | 'medium' | 'high';
}

export class AvatarScannerService {
  /** In-memory cache mapping avatar IDs to avatar data */
  private cache: Map<string, AvatarData> = new Map();

  /** Cache expiry time in milliseconds */
  private cacheExpiryMs: number;

  /**
   * Initialize the Avatar Scanner Service.
   *
   * @param vrchatAPI - VRChat API service for fetching avatar data
   * @param logger - Logger instance for debug/error logging
   * @param cacheExpiryMinutes - How long to cache avatar data (default: 60 minutes)
   */
  constructor(
    private vrchatAPI: VRChatAPIService,
    private logger: Logger,
    cacheExpiryMinutes: number = 60
  ) {
    this.cacheExpiryMs = cacheExpiryMinutes * MINUTES_TO_MS;
  }

  /**
   * Get avatar data for a user with intelligent caching.
   *
   * Retrieves the user's current avatar from their profile, checks cache for recent data,
   * and fetches from VRChat API if needed. Dramatically reduces API calls for avatars
   * seen multiple times within the cache window.
   *
   * @param userId - VRChat user ID (usr_xxx format)
   * @param displayName - User's display name for logging purposes
   * @returns Avatar data with performance metrics, or null if unavailable/error
   */
  public async getAvatarForUser(userId: string, displayName: string): Promise<AvatarData | null> {
    try {
      // Get user profile to find current avatar ID
      const userProfile = await this.vrchatAPI.getUserProfile(userId);
      if (!userProfile || !userProfile.currentAvatar) {
        this.logger.debug(`No avatar found for user ${displayName} (${userId})`);
        return null;
      }

      const avatarId = userProfile.currentAvatar;

      // Check cache first
      const cached = this.cache.get(avatarId);
      if (cached && (Date.now() - cached.fetchedAt) < this.cacheExpiryMs) {
        this.logger.debug(`Avatar cache hit for ${displayName}: ${avatarId}`);
        return cached;
      }

      // Fetch avatar data from API
      this.logger.debug(`Fetching avatar data for ${displayName}: ${avatarId}`);
      const avatarData = await this.fetchAvatarData(avatarId);

      if (avatarData) {
        // Cache the result
        this.cache.set(avatarId, avatarData);
        this.logger.debug(`Cached avatar data for ${avatarId}`);
      }

      return avatarData;
    } catch (error) {
      this.logger.error(`Error fetching avatar for user ${displayName} (${userId})`, { error });
      return null;
    }
  }

  /**
   * Fetch detailed avatar data from VRChat API.
   *
   * Retrieves basic avatar information (name, author, thumbnail, performance rating)
   * and attempts to fetch detailed performance statistics if available. Some stats
   * may be unavailable depending on avatar permissions and upload settings.
   *
   * @param avatarId - VRChat avatar ID (avtr_xxx format)
   * @returns Complete avatar data including stats if available, or null if not found
   */
  private async fetchAvatarData(avatarId: string): Promise<AvatarData | null> {
    try {
      // Get basic avatar info
      const avatar = await this.vrchatAPI.getAvatar(avatarId);
      if (!avatar) {
        this.logger.warn(`Avatar not found: ${avatarId}`);
        return null;
      }

      const avatarData: AvatarData = {
        avatarId: avatar.id,
        avatarName: avatar.name,
        authorId: avatar.authorId,
        authorName: avatar.authorName,
        performanceRating: this.extractPerformanceRating(avatar),
        thumbnailUrl: avatar.thumbnailImageUrl,
        fetchedAt: Date.now(),
      };

      // Try to get detailed performance stats from unity packages
      if (avatar.unityPackages && avatar.unityPackages.length > 0) {
        // Find the Windows platform package (most common)
        const windowsPackage = avatar.unityPackages.find((pkg: any) => pkg.platform === 'standalonewindows');
        if (windowsPackage) {
          avatarData.performanceRating = windowsPackage.performanceRating || avatarData.performanceRating;
        }
      }

      // Note: FileAnalysis data requires file ID and version, which we can get from unityPackages
      // However, this requires additional API calls and may not always be available
      // For now, we'll try to fetch it if we have the necessary info
      const stats = await this.tryFetchAvatarStats(avatar);
      if (stats) {
        avatarData.stats = stats;
      }

      return avatarData;
    } catch (error) {
      this.logger.error(`Error fetching avatar data for ${avatarId}`, { error });
      return null;
    }
  }

  /**
   * Attempt to fetch detailed performance statistics from VRChat FileAnalysis API.
   *
   * This data provides comprehensive metrics (polygons, PhysBones, particles, etc.) but
   * requires the avatar's file ID and may not be accessible for all avatars. Expected
   * to fail gracefully for avatars you don't own or have limited permissions to view.
   *
   * @param avatar - Raw avatar object from VRChat API (contains unityPackages)
   * @returns Detailed performance stats if available, null if unavailable or permission denied
   */
  private async tryFetchAvatarStats(avatar: any): Promise<AvatarStats | null> {
    try {
      // Find Windows unity package with file info
      const windowsPackage = avatar.unityPackages?.find((pkg: any) =>
        pkg.platform === 'standalonewindows' && pkg.id
      );

      if (!windowsPackage || !windowsPackage.id) {
        this.logger.debug(`No file ID available for avatar ${avatar.id}, skipping stats fetch`);
        return null;
      }

      // Extract file ID and version from unity package ID
      // Unity package ID format: file_xxx or similar
      const fileId = windowsPackage.id;
      const versionId = windowsPackage.assetVersion || 1;

      this.logger.debug(`Attempting to fetch file analysis for ${fileId}/${versionId}`);

      // Try to get file analysis (this may fail if not authorized)
      const fileAnalysis = await this.vrchatAPI.getFileAnalysis(fileId, versionId);
      if (!fileAnalysis || !fileAnalysis.avatarStats) {
        this.logger.debug(`No avatar stats available for ${avatar.id}`);
        return null;
      }

      const stats: AvatarStats = {
        totalPolygons: fileAnalysis.avatarStats.totalPolygons,
        totalVertices: fileAnalysis.avatarStats.totalVertices,
        particleSystemCount: fileAnalysis.avatarStats.particleSystemCount,
        totalMaxParticles: fileAnalysis.avatarStats.totalMaxParticles,
        particleCollisionEnabled: fileAnalysis.avatarStats.particleCollisionEnabled,
        particleTrailsEnabled: fileAnalysis.avatarStats.particleTrailsEnabled,
        boneCount: fileAnalysis.avatarStats.boneCount,
        physBoneComponentCount: fileAnalysis.avatarStats.physBoneComponentCount,
        physBoneColliderCount: fileAnalysis.avatarStats.physBoneColliderCount,
        physBoneTransformCount: fileAnalysis.avatarStats.physBoneTransformCount,
        materialCount: fileAnalysis.avatarStats.materialCount,
        meshCount: fileAnalysis.avatarStats.meshCount,
        lightCount: fileAnalysis.avatarStats.lightCount,
        audioSourceCount: fileAnalysis.avatarStats.audioSourceCount,
        fileSize: fileAnalysis.fileSize,
        uncompressedSize: fileAnalysis.uncompressedSize,
        totalTextureUsage: fileAnalysis.avatarStats.totalTextureUsage,
      };

      this.logger.debug(`Successfully fetched avatar stats for ${avatar.id}`);
      return stats;
    } catch (error) {
      // This is expected to fail for avatars we don't have permission to see stats for
      this.logger.debug(`Could not fetch avatar stats (expected for non-owned avatars): ${error}`);
      return null;
    }
  }

  /**
   * Extract VRChat performance rating from avatar data.
   *
   * Prioritizes Windows (standalonewindows) platform rating, falls back to
   * Android or iOS ratings if Windows unavailable. Performance ratings indicate
   * overall avatar optimization level (Excellent, Good, Medium, Poor, VeryPoor).
   *
   * @param avatar - Raw avatar object from VRChat API
   * @returns Performance rating string, or undefined if not available
   */
  private extractPerformanceRating(avatar: any): string | undefined {
    if (!avatar.performance) return undefined;

    // Try to get standalonewindows rating
    if (avatar.performance.standalonewindows) {
      return avatar.performance.standalonewindows;
    }

    // Fallback to android or ios
    return avatar.performance.android || avatar.performance.ios;
  }

  /**
   * Check avatar performance metrics against configured thresholds.
   *
   * Compares all available avatar statistics with user-defined limits and generates
   * violation reports for metrics that exceed thresholds. Handles three types of checks:
   * - Numeric thresholds (polygons, particles, bones, etc.)
   * - File size thresholds (converts bytes to MB for comparison)
   * - Boolean flags (particle collision/trails enabled)
   * - Performance rating comparison (hierarchy-based)
   *
   * @param avatarData - Complete avatar data with stats
   * @param thresholds - User-configured performance limits
   * @returns Array of threshold violations (empty if avatar passes all checks)
   */
  public checkAvatarThresholds(avatarData: AvatarData, thresholds: AvatarThresholds): AvatarViolation[] {
    const violations: AvatarViolation[] = [];

    if (!avatarData.stats) {
      // No stats available, can only check performance rating
      if (thresholds.performanceRating && avatarData.performanceRating) {
        const currentIndex = AVATAR_PERFORMANCE_RATING_ORDER.indexOf(avatarData.performanceRating as any);
        const thresholdIndex = AVATAR_PERFORMANCE_RATING_ORDER.indexOf(thresholds.performanceRating as any);

        if (currentIndex > thresholdIndex) {
          violations.push({
            field: 'Performance Rating',
            value: avatarData.performanceRating,
            threshold: thresholds.performanceRating,
            severity: 'medium',
          });
        }
      }
      return violations;
    }

    const stats = avatarData.stats;

    // Check numeric thresholds
    const numericChecks: Array<{field: keyof AvatarStats; name: string; severity: 'low' | 'medium' | 'high'}> = [
      { field: 'totalPolygons', name: 'Total Polygons', severity: 'high' },
      { field: 'totalVertices', name: 'Total Vertices', severity: 'medium' },
      { field: 'particleSystemCount', name: 'Particle Systems', severity: 'high' },
      { field: 'totalMaxParticles', name: 'Max Particles', severity: 'high' },
      { field: 'boneCount', name: 'Bone Count', severity: 'medium' },
      { field: 'physBoneComponentCount', name: 'PhysBone Components', severity: 'high' },
      { field: 'physBoneColliderCount', name: 'PhysBone Colliders', severity: 'medium' },
      { field: 'physBoneTransformCount', name: 'PhysBone Transforms', severity: 'medium' },
      { field: 'materialCount', name: 'Materials', severity: 'medium' },
      { field: 'meshCount', name: 'Meshes', severity: 'low' },
      { field: 'lightCount', name: 'Lights', severity: 'high' },
      { field: 'audioSourceCount', name: 'Audio Sources', severity: 'low' },
    ];

    for (const check of numericChecks) {
      const value = stats[check.field] as number | undefined;
      const threshold = thresholds[check.field] as number | undefined;

      if (value !== undefined && threshold !== undefined && value > threshold) {
        violations.push({
          field: check.name,
          value,
          threshold,
          severity: check.severity,
        });
      }
    }

    // Check file sizes (convert bytes to MB)
    const fileSizeChecks: Array<{field: keyof AvatarStats; name: string}> = [
      { field: 'fileSize', name: 'File Size' },
      { field: 'uncompressedSize', name: 'Uncompressed Size' },
      { field: 'totalTextureUsage', name: 'Texture Usage' },
    ];

    for (const check of fileSizeChecks) {
      const valueBytes = stats[check.field] as number | undefined;
      const thresholdMB = thresholds[check.field] as number | undefined;

      if (valueBytes !== undefined && thresholdMB !== undefined) {
        const valueMB = valueBytes / (1024 * 1024);
        if (valueMB > thresholdMB) {
          violations.push({
            field: check.name,
            value: valueMB,
            threshold: thresholdMB,
            severity: 'medium',
          });
        }
      }
    }

    // Check boolean flags (particle collision/trails)
    if (thresholds.particleCollisionEnabled === true && stats.particleCollisionEnabled === true) {
      violations.push({
        field: 'Particle Collision',
        value: 'Enabled',
        threshold: 'Disabled',
        severity: 'high',
      });
    }

    if (thresholds.particleTrailsEnabled === true && stats.particleTrailsEnabled === true) {
      violations.push({
        field: 'Particle Trails',
        value: 'Enabled',
        threshold: 'Disabled',
        severity: 'medium',
      });
    }

    // Check performance rating
    if (thresholds.performanceRating && avatarData.performanceRating) {
      const currentIndex = AVATAR_PERFORMANCE_RATING_ORDER.indexOf(avatarData.performanceRating as any);
      const thresholdIndex = AVATAR_PERFORMANCE_RATING_ORDER.indexOf(thresholds.performanceRating as any);

      if (currentIndex > thresholdIndex) {
        violations.push({
          field: 'Performance Rating',
          value: avatarData.performanceRating,
          threshold: thresholds.performanceRating,
          severity: 'high',
        });
      }
    }

    return violations;
  }

  /**
   * Remove expired entries from cache to prevent unbounded memory growth.
   *
   * Scans cache for entries older than the configured expiry time and removes them.
   * Should be called periodically (e.g., every hour) to maintain reasonable memory usage.
   */
  public pruneCache(): void {
    const now = Date.now();
    let pruned = 0;

    for (const [avatarId, data] of this.cache.entries()) {
      if (now - data.fetchedAt > this.cacheExpiryMs) {
        this.cache.delete(avatarId);
        pruned++;
      }
    }

    if (pruned > 0) {
      this.logger.debug(`Pruned ${pruned} expired avatar cache entries`);
    }
  }

  /**
   * Clear entire avatar cache immediately.
   *
   * Removes all cached avatar data, forcing fresh API fetches on next requests.
   * Useful for testing or when cache may contain stale data.
   */
  public clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cleared avatar cache (${size} entries)`);
  }

  /**
   * Get current cache statistics for monitoring and debugging.
   *
   * @returns Object containing cache size (entries) and expiry time (minutes)
   */
  public getCacheStats(): { size: number; expiryMinutes: number } {
    return {
      size: this.cache.size,
      expiryMinutes: this.cacheExpiryMs / MINUTES_TO_MS,
    };
  }
}
