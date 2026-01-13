import { Logger } from '../utils/Logger';
import { SeverityFormatter, MatchTypeFormatter, LocationFormatter } from '../utils/FormatUtils';
import {
  DISCORD_MAX_RETRIES,
  DISCORD_RETRY_DELAY_MS,
  DISCORD_RATE_LIMIT_DELAY_MS,
  DISCORD_MAX_QUEUE_SIZE,
  DISCORD_MATCHED_TEXT_MAX_LENGTH,
  DISCORD_COLOR_DEFAULT,
  DISCORD_COLOR_UPDATE_AVAILABLE,
} from '../constants';

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

interface QueuedMessage {
  message: DiscordMessage;
  timestamp: number;
  retries: number;
}

export class DiscordService {
  private logger: Logger;
  private webhookUrl: string;
  private mentionRoles: string[];
  private queue: QueuedMessage[] = [];
  private isProcessing: boolean = false;
  private lastSentTime: number = 0;

  constructor(webhookUrl: string, mentionRoles: string[] = []) {
    this.logger = Logger.getInstance();
    this.webhookUrl = webhookUrl;
    this.mentionRoles = mentionRoles;

    if (!this.webhookUrl) {
      throw new Error('Discord webhook URL is required');
    }

    this.logger.info('Discord service initialized');
  }

  /**
   * Send a simple text message
   */
  public async sendMessage(message: string): Promise<void> {
    const mentions = this.mentionRoles.map((role) => `<@&${role}>`).join(' ');
    const content = mentions ? `${mentions} ${message}` : message;

    await this.queueMessage({ content });
  }

  /**
   * Send a rich embed message
   */
  public async sendEmbed(embed: DiscordEmbed): Promise<void> {
    const mentions = this.mentionRoles.map((role) => `<@&${role}>`).join(' ');
    const content = mentions || undefined;

    await this.queueMessage({
      content,
      embeds: [embed],
    });
  }

  /**
   * Send alert for user match detection
   */
  public async sendBlockAlert(
    displayName: string,
    userId: string,
    matches: Array<{
      type: string;
      details: string;
      severity: string;
      groupId?: string;
      groupName?: string;
      keyword?: string;
      keywordMatchLocation?: string;
      matchedText?: string;
      reason?: string;
      author?: string;
    }>
  ): Promise<void> {
    const severityColor = this.getSeverityColor(
      matches.reduce((max, m) => {
        const severities: Record<string, number> = { low: 1, medium: 2, high: 3 };
        return Math.max(max, severities[m.severity] || 0);
      }, 0)
    );

    const embed: DiscordEmbed = {
      title: '⚠️ Match Detected',
      description: `**User:** ${displayName}\n**User ID:** \`${userId}\``,
      color: severityColor,
      timestamp: new Date().toISOString(),
      fields: matches.map((match, index) => {
        let fieldValue = '';

        // Severity
        fieldValue += `**Severity:** ${this.getSeverityEmoji(match.severity)} ${match.severity.toUpperCase()}\n`;

        // Group information
        if (match.groupId && match.groupName) {
          fieldValue += `**Group:** ${match.groupName}\n`;
          fieldValue += `**Group ID:** \`${match.groupId}\`\n`;
        }

        // Keyword match details
        if (match.keyword) {
          fieldValue += `**Keyword Pattern:** \`${match.keyword}\`\n`;
          if (match.keywordMatchLocation) {
            fieldValue += `**Matched In:** ${this.formatMatchLocation(match.keywordMatchLocation)}\n`;
          }
          if (match.matchedText) {
            // Truncate long text for Discord
            const displayText = match.matchedText.length > DISCORD_MATCHED_TEXT_MAX_LENGTH
              ? match.matchedText.substring(0, DISCORD_MATCHED_TEXT_MAX_LENGTH) + '...'
              : match.matchedText;
            fieldValue += `**Matched Text:** "${displayText}"\n`;
          }
        }

        // Reason
        if (match.reason) {
          fieldValue += `**Reason:** ${match.reason}\n`;
        }

        // Author
        if (match.author && match.author !== 'Unknown') {
          fieldValue += `**Added By:** ${match.author}\n`;
        }

        return {
          name: `${index + 1}. ${this.getMatchTypeIcon(match.type)} ${this.formatMatchType(match.type)}`,
          value: fieldValue,
          inline: false,
        };
      }),
    };

    await this.sendEmbed(embed);
  }

  /**
   * Send version mismatch notification
   */
  public async sendVersionMismatch(currentVersion: string, remoteVersion: string): Promise<void> {
    const embed: DiscordEmbed = {
      title: '🔄 Update Available',
      description: `A new version of VRChat Monitor is available!`,
      color: DISCORD_COLOR_UPDATE_AVAILABLE,
      fields: [
        { name: 'Current Version', value: currentVersion, inline: true },
        { name: 'Latest Version', value: remoteVersion, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };

    await this.sendEmbed(embed);
  }

  /**
   * Queue a message for sending
   */
  private async queueMessage(message: DiscordMessage): Promise<void> {
    if (this.queue.length >= DISCORD_MAX_QUEUE_SIZE) {
      this.logger.warn('Discord message queue is full, dropping oldest message');
      this.queue.shift();
    }

    this.queue.push({
      message,
      timestamp: Date.now(),
      retries: 0,
    });

    // Start processing if not already
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process queued messages
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const queued = this.queue[0];

      // Rate limiting - ensure minimum time between requests
      const timeSinceLastSent = Date.now() - this.lastSentTime;
      if (timeSinceLastSent < DISCORD_RATE_LIMIT_DELAY_MS) {
        const waitTime = DISCORD_RATE_LIMIT_DELAY_MS - timeSinceLastSent;
        this.logger.debug(`Rate limiting: waiting ${waitTime}ms before next Discord message`);
        await this.sleep(waitTime);
      }

      try {
        await this.sendToWebhook(queued.message);
        this.lastSentTime = Date.now();
        this.queue.shift(); // Remove from queue on success
        this.logger.debug('Discord message sent successfully');
      } catch (error) {
        this.logger.error('Failed to send Discord message', { error });

        queued.retries++;
        if (queued.retries >= DISCORD_MAX_RETRIES) {
          this.logger.error('Discord message exceeded max retries, dropping', {
            retries: queued.retries,
          });
          this.queue.shift();
        } else {
          this.logger.info(`Retrying Discord message (attempt ${queued.retries + 1}/${DISCORD_MAX_RETRIES})`);
          await this.sleep(DISCORD_RETRY_DELAY_MS * queued.retries);
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Send message to Discord webhook
   */
  private async sendToWebhook(message: DiscordMessage): Promise<void> {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Discord webhook error (${response.status}): ${errorText}`);
    }
  }

  /**
   * Get severity color for embed (wrapper for numeric severity)
   */
  private getSeverityColor(severity: number): number {
    // Convert numeric severity to string
    let severityString: 'high' | 'medium' | 'low';
    switch (severity) {
      case 3:
        severityString = 'high';
        break;
      case 2:
        severityString = 'medium';
        break;
      case 1:
        severityString = 'low';
        break;
      default:
        return DISCORD_COLOR_DEFAULT;
    }
    return SeverityFormatter.getDiscordColor(severityString);
  }

  /**
   * Get icon for match type (wrapper for shared formatter)
   */
  private getMatchTypeIcon(type: string): string {
    return MatchTypeFormatter.getIcon(type as any);
  }

  /**
   * Format match type for display (wrapper for shared formatter)
   */
  private formatMatchType(type: string): string {
    return MatchTypeFormatter.getLabel(type as any);
  }

  /**
   * Get severity emoji (wrapper for shared formatter)
   */
  private getSeverityEmoji(severity: string): string {
    return SeverityFormatter.getEmoji(severity as any);
  }

  /**
   * Format match location for display (wrapper for shared formatter)
   */
  private formatMatchLocation(location: string): string {
    return LocationFormatter.getLabel(location as any);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get queue status
   */
  public getQueueStatus(): { queued: number; processing: boolean } {
    return {
      queued: this.queue.length,
      processing: this.isProcessing,
    };
  }

  /**
   * Test webhook connectivity
   */
  public async testWebhook(): Promise<boolean> {
    try {
      await this.sendMessage('✅ VRChat Monitor - Discord webhook test successful!');
      return true;
    } catch (error) {
      this.logger.error('Discord webhook test failed', { error });
      return false;
    }
  }
}
