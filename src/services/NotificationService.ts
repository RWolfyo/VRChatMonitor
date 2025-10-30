import notifier from 'node-notifier';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';

interface NotificationOptions {
  title?: string;
  message: string;
  icon?: string;
  sound?: boolean;
  wait?: boolean;
}

export class NotificationService {
  private logger: Logger;
  private pathResolver: PathResolver;
  private snoreToastPath: string | null = null;
  private lastNotificationTime: number = 0;
  private readonly MIN_NOTIFICATION_INTERVAL = 2000; // 2 seconds

  constructor() {
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();

    // Find SnoreToast for Windows notifications
    this.snoreToastPath = this.pathResolver.findVendorBinary('SnoreToast');
    if (this.snoreToastPath) {
      this.logger.info(`SnoreToast found at: ${this.snoreToastPath}`);
    } else {
      this.logger.warn('SnoreToast not found - using fallback notification method');
    }
  }

  /**
   * Send a desktop notification
   */
  public async notify(options: NotificationOptions): Promise<void> {
    // Rate limiting to prevent notification spam
    const now = Date.now();
    if (now - this.lastNotificationTime < this.MIN_NOTIFICATION_INTERVAL) {
      this.logger.debug('Notification rate limited');
      return;
    }
    this.lastNotificationTime = now;

    try {
      const notificationConfig: any = {
        title: options.title || 'VRChat Monitor',
        message: options.message,
        sound: options.sound !== false,
        wait: options.wait || false,
        appID: 'VRChatMonitor.v2',
      };

      // Add icon if provided
      if (options.icon) {
        notificationConfig.icon = options.icon;
      }

      // Use custom SnoreToast if available (WindowsToaster specific)
      if (this.snoreToastPath) {
        notificationConfig.customPath = this.snoreToastPath;
      }

      // Send notification
      notifier.notify(notificationConfig, (error, response, metadata) => {
        if (error) {
          this.logger.error('Desktop notification failed', { error });
        } else {
          this.logger.debug('Desktop notification sent', { response, metadata });
        }
      });

      this.logger.info('Desktop notification sent', { title: options.title });
    } catch (error) {
      this.logger.error('Failed to send desktop notification', { error });
    }
  }

  /**
   * Send alert notification for user match
   */
  public async notifyBlockedUser(displayName: string, reason: string): Promise<void> {
    await this.notify({
      title: '⚠️ Match Detected',
      message: `${displayName}\n${reason}`,
      sound: true,
    });
  }

  /**
   * Send version update notification
   */
  public async notifyVersionUpdate(currentVersion: string, newVersion: string): Promise<void> {
    await this.notify({
      title: '🔄 Update Available',
      message: `New version ${newVersion} is available\n(Current: ${currentVersion})`,
      sound: false,
    });
  }

  /**
   * Send test notification
   */
  public async testNotification(): Promise<void> {
    await this.notify({
      title: '✅ Test Notification',
      message: `VRChat Monitor v2 is running!\nTime: ${new Date().toLocaleTimeString()}`,
      sound: true,
    });
  }

  /**
   * Send generic info notification
   */
  public async notifyInfo(message: string): Promise<void> {
    await this.notify({
      title: 'VRChat Monitor',
      message,
      sound: false,
    });
  }
}
