import type { VRChatAPIService } from './VRChatAPIService';
import type { Logger } from '../utils/Logger';
import type { AvatarThresholds } from '../types/config';
import { MINUTES_TO_MS, AVATAR_PERFORMANCE_RATING_ORDER } from '../constants';

export interface AvatarData {
  avatarId: string;
  avatarName: string;
  authorName: string;
  performanceRating?: string;
  stats?: AvatarStats;
  thumbnailUrl?: string;
  fetchedAt: number; // Timestamp when data was fetched
}

export interface AvatarStats {
  // Polygon/Triangle counts
  totalPolygons?: number;
  totalVertices?: number;

  // Particle systems
  particleSystemCount?: number;
  totalMaxParticles?: number;
  particleCollisionEnabled?: boolean;
  particleTrailsEnabled?: boolean;

  // Physics/Bones
  boneCount?: number;
  physBoneComponentCount?: number;
  physBoneColliderCount?: number;
  physBoneTransformCount?: number;

  // Rendering
  materialCount?: number;
  meshCount?: number;
  lightCount?: number;

  // Audio
  audioSourceCount?: number;

  // File size (in bytes, convert to MB when needed)
  fileSize?: number;
  uncompressedSize?: number;
  totalTextureUsage?: number;
}

export interface AvatarViolation {
  field: string;
  value: number | boolean | string;
  threshold: number | boolean | string;
  severity: 'low' | 'medium' | 'high';
}

export class AvatarScannerService {
  private cache: Map<string, AvatarData> = new Map();
  private cacheExpiryMs: number;

  constructor(
    private vrchatAPI: VRChatAPIService,
    private logger: Logger,
    cacheExpiryMinutes: number = 60
  ) {
    this.cacheExpiryMs = cacheExpiryMinutes * MINUTES_TO_MS;
  }

  /**
   * Get avatar data for a user, with caching
   * @param userId The user ID to get avatar for
   * @param displayName The user's display name (for logging)
   * @returns Avatar data if available, null if not found or error
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
   * Fetch detailed avatar data from VRChat API
   * @param avatarId The avatar ID to fetch
   * @returns Avatar data with performance stats
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
   * Try to fetch detailed avatar stats from FileAnalysis endpoint
   * This may not always be available depending on avatar permissions
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
   * Extract performance rating from avatar data
   * Returns the Windows platform rating if available
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
   * Check avatar against configured thresholds
   * @param avatarData The avatar data to check
   * @param thresholds The configured thresholds
   * @returns Array of violations found
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
   * Clear expired entries from cache
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
   * Clear all cache
   */
  public clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cleared avatar cache (${size} entries)`);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; expiryMinutes: number } {
    return {
      size: this.cache.size,
      expiryMinutes: this.cacheExpiryMs / MINUTES_TO_MS,
    };
  }
}
