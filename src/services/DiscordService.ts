import { Logger } from '../utils/Logger';

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

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const RATE_LIMIT_DELAY_MS = 2000; // Discord webhook rate limit: 30 req/min = 2 sec per request
const MAX_QUEUE_SIZE = 100;

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
            const displayText = match.matchedText.length > 200
              ? match.matchedText.substring(0, 200) + '...'
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
      color: 0x5865f2, // Blurple
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
    if (this.queue.length >= MAX_QUEUE_SIZE) {
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
      if (timeSinceLastSent < RATE_LIMIT_DELAY_MS) {
        const waitTime = RATE_LIMIT_DELAY_MS - timeSinceLastSent;
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
        if (queued.retries >= MAX_RETRIES) {
          this.logger.error('Discord message exceeded max retries, dropping', {
            retries: queued.retries,
          });
          this.queue.shift();
        } else {
          this.logger.info(`Retrying Discord message (attempt ${queued.retries + 1}/${MAX_RETRIES})`);
          await this.sleep(RETRY_DELAY_MS * queued.retries);
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
   * Get severity color for embed
   */
  private getSeverityColor(severity: number): number {
    switch (severity) {
      case 3: // high
        return 0xed4245; // Red
      case 2: // medium
        return 0xfee75c; // Yellow
      case 1: // low
        return 0x57f287; // Green
      default:
        return 0x5865f2; // Blurple
    }
  }

  /**
   * Get icon for match type
   */
  private getMatchTypeIcon(type: string): string {
    switch (type) {
      case 'blockedGroup':
        return '🚫';
      case 'blockedUser':
        return '🔒';
      case 'keywordGroup':
        return '🔍';
      case 'keywordUser':
        return '👤';
      default:
        return '⚠️';
    }
  }

  /**
   * Format match type for display
   */
  private formatMatchType(type: string): string {
    switch (type) {
      case 'blockedGroup':
        return 'Group Match (Potential Concern)';
      case 'blockedUser':
        return 'Blacklisted User (Confirmed)';
      case 'keywordGroup':
        return 'Keyword Match (Group)';
      case 'keywordUser':
        return 'Keyword Match (Profile)';
      default:
        return type;
    }
  }

  /**
   * Get severity emoji
   */
  private getSeverityEmoji(severity: string): string {
    switch (severity) {
      case 'high':
        return '🔴';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
      default:
        return '⚠️';
    }
  }

  /**
   * Format match location for display
   */
  private formatMatchLocation(location: string): string {
    switch (location) {
      case 'bio':
        return 'User Bio/Profile';
      case 'displayName':
        return 'User Display Name';
      case 'groupName':
        return 'Group Name';
      case 'groupDescription':
        return 'Group Description';
      default:
        return location;
    }
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
