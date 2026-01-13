/**
 * Shared formatting utilities for consistent display across services
 * Eliminates duplication of severity, match type, and location formatting
 */

import chalk from 'chalk';
import type { Match, MatchType, Severity, KeywordMatchLocation } from '../types/blocklist';

/**
 * Severity formatter - handles icons, colors, and display
 */
export class SeverityFormatter {
  /**
   * Get colored severity text for console output
   */
  static getColoredText(severity: Severity): string {
    switch (severity) {
      case 'high':
        return chalk.red('HIGH');
      case 'medium':
        return chalk.yellow('MEDIUM');
      case 'low':
        return chalk.green('LOW');
      default:
        return chalk.gray('UNKNOWN');
    }
  }

  /**
   * Get severity emoji for notifications
   */
  static getEmoji(severity: Severity): string {
    switch (severity) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * Get severity icon (text) for console output
   */
  static getIcon(severity: Severity): string {
    switch (severity) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚪';
    }
  }

  /**
   * Get chalk color function for severity
   */
  static getChalkColor(severity: Severity): chalk.Chalk {
    switch (severity) {
      case 'high':
        return chalk.red;
      case 'medium':
        return chalk.yellow;
      case 'low':
        return chalk.green;
      default:
        return chalk.gray;
    }
  }

  /**
   * Get Discord embed color code for severity
   */
  static getDiscordColor(severity: Severity): number {
    switch (severity) {
      case 'high':
        return 0xff0000; // Red
      case 'medium':
        return 0xffaa00; // Yellow/Orange
      case 'low':
        return 0x00ff00; // Green
      default:
        return 0x808080; // Gray
    }
  }
}

/**
 * Match type formatter - handles labels and icons
 */
export class MatchTypeFormatter {
  /**
   * Get user-friendly label for match type
   */
  static getLabel(matchType: MatchType): string {
    switch (matchType) {
      case 'blockedGroup':
        return 'Group Match';
      case 'blockedUser':
        return 'Blacklisted User';
      case 'keywordGroup':
        return 'Keyword Match (Group)';
      case 'keywordUser':
        return 'Keyword Match (Profile)';
      case 'obscenity':
        return 'Obscenity Detected';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get icon/emoji for match type
   */
  static getIcon(matchType: MatchType): string {
    switch (matchType) {
      case 'blockedGroup':
        return '🚫';
      case 'blockedUser':
        return '🔒';
      case 'keywordGroup':
        return '🔍';
      case 'keywordUser':
        return '⚠️';
      case 'obscenity':
        return '🚨';
      default:
        return '❓';
    }
  }

  /**
   * Get formatted match type with icon
   */
  static getFormattedLabel(matchType: MatchType): string {
    return `${this.getIcon(matchType)} ${this.getLabel(matchType)}`;
  }
}

/**
 * Location formatter - handles keyword match location labels
 */
export class LocationFormatter {
  /**
   * Get user-friendly label for keyword match location
   */
  static getLabel(location: KeywordMatchLocation): string {
    switch (location) {
      case 'bio':
        return 'Bio';
      case 'displayName':
        return 'Display Name';
      case 'statusDescription':
        return 'Status';
      case 'pronouns':
        return 'Pronouns';
      case 'groupName':
        return 'Group Name';
      case 'groupDescription':
        return 'Group Description';
      case 'groupShortCode':
        return 'Group Short Code';
      case 'groupDiscriminator':
        return 'Group Discriminator';
      case 'groupRules':
        return 'Group Rules';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get formatted location for Discord embeds
   */
  static getFormattedLabel(location: KeywordMatchLocation): string {
    return this.getLabel(location);
  }
}

/**
 * Alert formatter - handles complete match formatting
 */
export class AlertFormatter {
  /**
   * Format a match for console output
   */
  static formatForConsole(match: Match): string {
    const severityText = SeverityFormatter.getColoredText(match.severity);
    const matchTypeLabel = MatchTypeFormatter.getLabel(match.type);

    let output = `[${severityText}] ${matchTypeLabel}`;

    if (match.type === 'blockedGroup' && match.groupId) {
      output += ` - ${match.groupName || match.groupId}`;
    } else if (match.type === 'blockedUser') {
      output += ` - Direct block`;
    } else if ((match.type === 'keywordGroup' || match.type === 'keywordUser') && match.keyword) {
      output += ` - "${match.keyword}"`;
      if (match.keywordMatchLocation) {
        output += ` in ${LocationFormatter.getLabel(match.keywordMatchLocation)}`;
      }
    }

    if (match.details) {
      output += `\n  ${match.details}`;
    }

    return output;
  }

  /**
   * Truncate text for display
   */
  static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format violation count text
   */
  static formatViolationCount(count: number): string {
    return count === 1 ? '1 violation' : `${count} violations`;
  }
}
