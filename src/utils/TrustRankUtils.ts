import { TrustRank } from '../types/config';

/**
 * Trust rank hierarchy (from lowest to highest)
 * Note: 'unknown' is not ranked - it indicates a detection failure
 */
export const TRUST_RANK_HIERARCHY: TrustRank[] = [
  'unknown', // Failed to detect rank (API error, missing tags, etc.)
  'nuisance', // De-ranked visitor (system_troll or system_probable_troll) - BAN ON SIGHT!
  'visitor', // Default rank (no trust tag)
  'new_user', // system_trust_basic
  'user', // Intermediate between new_user and known_user
  'known_user', // system_trust_known
  'trusted_user', // system_trust_trusted
  'veteran_user', // system_trust_veteran or system_legend
];

/**
 * VRChat tag to trust rank mapping
 * Based on VRCX implementation and VRChat API
 */
export const TRUST_TAG_MAP: Record<string, TrustRank> = {
  'system_troll': 'nuisance', // Confirmed troll - BAN ON SIGHT
  'system_probable_troll': 'nuisance', // Probable troll (almost nuisance) - BAN ON SIGHT
  'system_trust_basic': 'new_user',
  'system_trust_known': 'known_user',
  'system_trust_trusted': 'trusted_user',
  'system_trust_veteran': 'veteran_user',
  'system_legend': 'veteran_user', // Legends are treated as veterans
};

/**
 * Display names for trust ranks
 */
export const TRUST_RANK_DISPLAY_NAMES: Record<TrustRank, string> = {
  'unknown': 'Unknown (Detection Failed)',
  'nuisance': '🚨 NUISANCE - BAN ON SIGHT 🚨',
  'visitor': 'Visitor',
  'new_user': 'New User',
  'user': 'User',
  'known_user': 'Known User',
  'trusted_user': 'Trusted User',
  'veteran_user': 'Veteran User',
};

/**
 * Emoji indicators for trust ranks
 */
export const TRUST_RANK_EMOJIS: Record<TrustRank, string> = {
  'unknown': '❓', // Unknown - detection failed
  'nuisance': '🚨', // CRITICAL WARNING - De-ranked troll
  'visitor': '⚠️', // Warning
  'new_user': '🆕',
  'user': '👤',
  'known_user': '✅',
  'trusted_user': '🛡️',
  'veteran_user': '👑',
};

/**
 * Extract trust rank from VRChat user tags
 * @param tags Array of VRChat tags (undefined/null indicates API failure)
 * @returns Detected trust rank, 'visitor' if no trust tag found, or 'unknown' if tags are invalid/missing
 */
export function extractTrustRankFromTags(tags: string[] | undefined | null): TrustRank {
  // If tags are completely missing/undefined, this indicates an API failure or error
  if (tags === undefined || tags === null) {
    return 'unknown';
  }

  // If tags is not an array, something went wrong
  if (!Array.isArray(tags)) {
    return 'unknown';
  }

  // PRIORITY 1: Check for nuisance tags first (critical!)
  if (tags.includes('system_troll') || tags.includes('system_probable_troll')) {
    return 'nuisance';
  }

  // PRIORITY 2: Check for other trust rank tags
  for (const tag of tags) {
    if (tag in TRUST_TAG_MAP) {
      return TRUST_TAG_MAP[tag];
    }
  }

  // No trust tag found - user is a visitor (default rank)
  return 'visitor';
}

/**
 * Compare two trust ranks
 * @param rank1 First trust rank
 * @param rank2 Second trust rank
 * @returns -1 if rank1 < rank2, 0 if equal, 1 if rank1 > rank2
 */
export function compareTrustRanks(rank1: TrustRank, rank2: TrustRank): number {
  const index1 = TRUST_RANK_HIERARCHY.indexOf(rank1);
  const index2 = TRUST_RANK_HIERARCHY.indexOf(rank2);

  if (index1 < index2) return -1;
  if (index1 > index2) return 1;
  return 0;
}

/**
 * Check if a trust rank is below the minimum required rank
 * @param userRank User's trust rank
 * @param minimumRank Minimum required trust rank
 * @returns True if user's rank is below minimum
 */
export function isBelowMinimumRank(userRank: TrustRank, minimumRank: TrustRank): boolean {
  return compareTrustRanks(userRank, minimumRank) < 0;
}

/**
 * Get trust rank level (0-5, where 0 is visitor and 5 is veteran)
 * @param rank Trust rank
 * @returns Numeric level
 */
export function getTrustRankLevel(rank: TrustRank): number {
  return TRUST_RANK_HIERARCHY.indexOf(rank);
}

/**
 * Format trust rank for display
 * @param rank Trust rank
 * @param includeEmoji Whether to include emoji
 * @returns Formatted string
 */
export function formatTrustRank(rank: TrustRank, includeEmoji: boolean = true): string {
  const displayName = TRUST_RANK_DISPLAY_NAMES[rank];

  if (includeEmoji) {
    const emoji = TRUST_RANK_EMOJIS[rank];
    return `${emoji} ${displayName}`;
  }

  return displayName;
}
