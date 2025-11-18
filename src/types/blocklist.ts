export type Severity = 'low' | 'medium' | 'high';

export interface BlockedGroupEntry {
  groupId: string;
  name?: string;
  reason?: string;
  severity?: Severity;
  author?: string;  // For web UI - who added this entry
}

export interface BlockedUserEntry {
  userId: string;
  displayName?: string;
  reason?: string;
  severity?: Severity;
  author?: string;
}

export interface KeywordEntry {
  pattern: string;  // Regex pattern
  reason?: string;
  severity?: Severity;
  author?: string;
}

export interface WhitelistUserEntry {
  userId: string;
  displayName?: string;
  reason?: string;  // Why they're whitelisted
  author?: string;
}

export interface WhitelistGroupEntry {
  groupId: string;
  name?: string;
  reason?: string;
  author?: string;
}

export interface BlocklistData {
  appVersion?: string;
  blockedGroups: Array<string | BlockedGroupEntry>;
  blockedUsers?: Array<string | BlockedUserEntry>;  // NEW
  keywordBlacklist?: Array<string | KeywordEntry>;
  whitelistGroupIds?: Array<string | WhitelistGroupEntry>;
  whitelistUserIds?: Array<string | WhitelistUserEntry>;
}

export interface NormalizedBlocklistData {
  appVersion?: string;
  blockedGroups: BlockedGroupEntry[];
  blockedUsers: BlockedUserEntry[];  // NEW
  keywordBlacklist: KeywordEntry[];
  keywordRegexes: RegExp[];
  whitelistGroupIds: string[];  // Keep as array of IDs for quick lookup
  whitelistUserIds: string[];   // Keep as array of IDs for quick lookup
  whitelistGroupsDetailed: WhitelistGroupEntry[];  // Full details
  whitelistUsersDetailed: WhitelistUserEntry[];    // Full details
}

export type MatchType = 'blockedGroup' | 'blockedUser' | 'keywordGroup' | 'keywordUser';
export type KeywordMatchLocation = 'bio' | 'displayName' | 'groupName' | 'groupDescription' | 'groupRules' | 'statusDescription' | 'pronouns';

export interface Match {
  type: MatchType;
  details: string;
  severity: Severity;
  // Group-related info (for blockedGroup and keywordGroup)
  groupId?: string;
  groupName?: string;
  // Keyword-related info (for keywordGroup and keywordUser)
  keyword?: string;
  keywordMatchLocation?: KeywordMatchLocation;
  matchedText?: string; // The actual text that matched
  // User-related info (for blockedUser)
  reason?: string; // Detailed reason from database
  author?: string; // Who added this entry
}

export interface MatchResult {
  matched: boolean;
  userId: string;
  displayName: string;
  matches: Match[];
}
