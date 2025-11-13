import * as net from 'net';
import * as os from 'os';
import { Logger } from '../utils/Logger';

/**
 * VRCX IPC Packet Structure
 * IMPORTANT: VRCX uses MIXED case!
 * - type: lowercase (for switch statement on packet type)
 * - MsgType: PascalCase (for switch on message type)
 * - Data, DisplayName, UserId: PascalCase (actual data fields)
 * - notify: lowercase (boolean flag)
 * See: VRCX src/stores/vrcx.js line 426 (data.type), line 306 (data.MsgType), line 338 (data.DisplayName/Data/UserId)
 */
interface VRCXPacket {
  type: string;           // lowercase! switch (data.type)
  MsgType: string;        // PascalCase! switch (data.MsgType)
  Data: string;           // PascalCase! message: data.Data
  DisplayName?: string;   // PascalCase! data.DisplayName
  UserId?: string;        // PascalCase! data.UserId
  notify?: boolean;       // lowercase! data.notify
}

/**
 * XSOverlay Notification Message
 */
interface XSOverlayMessage {
  messageType: number;
  title: string;
  content: string;
  height?: number;
  sourceApp?: string;
  timeout?: number;
  audioPath?: string;
  useBase64Icon?: boolean;
  icon?: string;
  opacity?: number;
}

/**
 * Service for sending VR overlay notifications via VRCX IPC
 */
export class VRCXService {
  private logger: Logger;
  private enabled: boolean;
  private xsOverlayEnabled: boolean;
  private pipeName: string;
  private readonly xsOverlayPort = 42069;
  private readonly xsOverlayHost = '127.0.0.1';

  constructor(enabled: boolean = false, xsOverlayEnabled: boolean = false) {
    this.logger = Logger.getInstance();
    this.enabled = enabled;
    this.xsOverlayEnabled = xsOverlayEnabled;
    this.pipeName = this.getIpcName();

    if (this.enabled) {
      this.logger.info('VRCXService initialized', {
        pipeName: this.pipeName,
        xsOverlay: this.xsOverlayEnabled,
      });
    }
  }

  /**
   * Calculate VRCX IPC pipe name based on Windows username
   * Matches VRCX implementation exactly (IPCServer.cs line 38-45)
   *
   * VRCX uses simple sum of character codes:
   * var hash = 0;
   * foreach (var c in Environment.UserName) { hash += c; }
   * return $"vrcx-ipc-{hash}";
   */
  private getIpcName(): string {
    const username = os.userInfo().username;

    // Simple sum of character codes (matches VRCX exactly)
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash += username.charCodeAt(i);
    }

    this.logger.debug('VRCX IPC name calculated', {
      username,
      hash,
      pipeName: `vrcx-ipc-${hash}`,
    });

    return `vrcx-ipc-${hash}`;
  }

  /**
   * Get Windows named pipe path
   */
  private getPipePath(): string {
    return `\\\\.\\pipe\\${this.pipeName}`;
  }

  /**
   * Send notification to VRCX overlay via Named Pipe IPC
   * VRCX will forward this to OVRToolkit HUD notifications
   */
  public async sendNotification(
    message: string,
    displayName: string = 'VRChat Monitor',
    userId?: string,
    notify: boolean = true
  ): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }

    try {
      // Build packet matching VRCX's MIXED case expectations
      // switch (data.type) - lowercase
      // switch (data.MsgType) - PascalCase
      // data.Data, data.DisplayName, data.UserId - PascalCase
      const packet: VRCXPacket = {
        type: 'VrcxMessage',      // lowercase! (for packet type switch)
        MsgType: 'External',      // PascalCase! (for message type switch)
        Data: message,            // PascalCase! (message content)
        DisplayName: displayName, // PascalCase!
        UserId: userId,           // PascalCase!
        notify,                   // lowercase!
      };

      this.logger.debug('Sending VRCX notification packet', {
        type: packet.type,
        MsgType: packet.MsgType,
        message: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        DisplayName: packet.DisplayName,
        notify,
      });

      const success = await this.sendIpcPacket(packet);

      if (success) {
        this.logger.debug('✓ VRCX notification sent successfully', {
          message: message.substring(0, 30) + '...',
          note: 'Check VRCX settings -> Notifications for OVRToolkit integration',
        });
      }

      return success;
    } catch (error) {
      this.logger.error('Failed to send VRCX notification', { error, message });
      return false;
    }
  }

  /**
   * Send IPC packet to VRCX via Windows Named Pipe
   */
  private async sendIpcPacket(packet: VRCXPacket): Promise<boolean> {
    return new Promise((resolve) => {
      const pipePath = this.getPipePath();

      this.logger.debug('Attempting VRCX IPC connection', {
        pipePath,
        pipeName: this.pipeName,
        packet: packet.type,
      });

      const client = net.connect(pipePath);

      // Set timeout for connection
      const timeout = setTimeout(() => {
        client.destroy();
        this.logger.warn('VRCX connection timeout', {
          pipePath,
          message: 'VRCX may not be running or overlay is not enabled in VRCX settings',
          hint: 'Check VRCX -> Settings -> General -> Enable IPC',
        });
        resolve(false);
      }, 2000); // Increased timeout to 2 seconds

      client.on('connect', () => {
        clearTimeout(timeout);

        try {
          // Serialize packet to JSON
          const json = JSON.stringify(packet);
          const buffer = Buffer.from(json, 'utf-8');

          this.logger.debug('VRCX IPC connected, sending packet:', {
            rawJson: json,
            jsonLength: json.length,
            bufferLength: buffer.length,
          });

          // Send JSON packet
          client.write(buffer);

          // Send null terminator (VRCX protocol requirement)
          client.write(Buffer.from([0x00]));

          // Close connection
          client.end();

          this.logger.debug('✓ VRCX packet sent to pipe successfully');
          this.logger.debug('→ Check VRCX Game Log tab for "External" entry to verify receipt');
          resolve(true);
        } catch (error) {
          this.logger.error('Error writing to VRCX pipe', { error });
          client.destroy();
          resolve(false);
        }
      });

      client.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timeout);

        if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
          this.logger.warn('VRCX IPC unavailable', {
            error: error.message,
            pipePath,
            troubleshooting: [
              '1. Make sure VRCX is running',
              '2. Check VRCX -> Settings -> General -> Enable IPC is checked',
              '3. Try restarting VRCX',
              `4. Verify pipe name: ${this.pipeName}`,
            ],
          });
        } else {
          this.logger.error('VRCX IPC connection error', {
            error: error.message,
            code: error.code,
            pipePath,
          });
        }

        resolve(false);
      });
    });
  }

  /**
   * Send notification via XSOverlay (alternative VR overlay)
   * Uses UDP broadcast on port 42069
   */
  public async sendXSOverlayNotification(
    title: string,
    content: string,
    timeout: number = 5000,
    opacity: number = 1.0
  ): Promise<boolean> {
    if (!this.xsOverlayEnabled) {
      return false;
    }

    try {
      const dgram = await import('dgram');
      const socket = dgram.createSocket('udp4');

      const message: XSOverlayMessage = {
        messageType: 1,
        title,
        content,
        height: 110,
        sourceApp: 'VRChat Monitor',
        timeout,
        audioPath: '',
        useBase64Icon: false,
        icon: '',
        opacity,
      };

      const buffer = Buffer.from(JSON.stringify(message), 'utf-8');

      this.logger.debug('Sending XSOverlay notification', {
        host: this.xsOverlayHost,
        port: this.xsOverlayPort,
        title,
        contentLength: content.length,
      });

      return new Promise((resolve) => {
        socket.send(buffer, this.xsOverlayPort, this.xsOverlayHost, (error) => {
          socket.close();

          if (error) {
            this.logger.error('Failed to send XSOverlay notification', {
              error: error.message,
              troubleshooting: [
                '1. Make sure XSOverlay is running',
                '2. Check XSOverlay is configured to receive notifications',
                '3. Verify firewall allows UDP on port 42069',
              ],
            });
            resolve(false);
          } else {
            this.logger.debug('XSOverlay notification sent successfully', { title });
            resolve(true);
          }
        });
      });
    } catch (error) {
      this.logger.error('XSOverlay notification error', { error });
      return false;
    }
  }

  /**
   * Send alert notification (tries VRCX first, falls back to XSOverlay if enabled)
   */
  public async sendAlert(
    message: string,
    displayName: string = 'VRChat Monitor',
    userId?: string
  ): Promise<boolean> {
    let success = false;

    // Try VRCX first
    if (this.enabled) {
      success = await this.sendNotification(message, displayName, userId, true);
    }

    // Fallback to XSOverlay if VRCX failed and XSOverlay is enabled
    if (!success && this.xsOverlayEnabled) {
      success = await this.sendXSOverlayNotification(
        displayName,
        message,
        5000,
        1.0
      );
    }

    return success;
  }

  /**
   * List all available named pipes on Windows (diagnostic utility)
   */
  private async listAvailablePipes(): Promise<string[]> {
    try {
      const { execSync } = await import('child_process');
      // Use PowerShell to list pipes
      const cmd = 'powershell -Command "Get-ChildItem \\\\.\\pipe\\ | Select-Object -ExpandProperty Name | Where-Object { $_ -like \'vrcx-*\' }"';
      const output = execSync(cmd, { encoding: 'utf-8', timeout: 3000 });
      const pipes = output.trim().split('\n').map(p => p.trim()).filter(p => p.length > 0);
      return pipes;
    } catch (error) {
      this.logger.debug('Could not enumerate pipes', { error });
      return [];
    }
  }

  /**
   * Test connection to VRCX
   */
  public async testConnection(): Promise<boolean> {
    if (!this.enabled) {
      this.logger.info('VRCX is disabled');
      return false;
    }

    this.logger.info('Testing VRCX connection...');
    this.logger.info(`Calculated pipe name: ${this.pipeName}`);

    // List available VRCX pipes for diagnostics
    const availablePipes = await this.listAvailablePipes();
    if (availablePipes.length > 0) {
      this.logger.info('Available VRCX pipes:', { pipes: availablePipes });

      // Check if our calculated name matches any available pipe
      const match = availablePipes.some(p => p === this.pipeName);
      if (!match) {
        this.logger.warn('⚠️ Calculated pipe name does not match any available VRCX pipe!', {
          calculated: this.pipeName,
          available: availablePipes,
        });
      }
    } else {
      this.logger.info('No VRCX pipes found - VRCX may not be running');
    }

    const success = await this.sendNotification(
      'VRChat Monitor connected to VRCX',
      'VRChat Monitor',
      undefined,
      true
    );

    if (success) {
      this.logger.info('✓ VRCX connection successful');
    } else {
      this.logger.warn('✗ VRCX connection failed', {
        troubleshooting: [
          '1. Ensure VRCX is running',
          '2. Enable IPC in VRCX Settings -> General -> Enable IPC',
          '3. Restart VRCX after enabling IPC',
          '4. Check available pipes above',
        ],
      });
    }

    return success;
  }

  /**
   * Check if VRCX is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if XSOverlay is enabled
   */
  public isXSOverlayEnabled(): boolean {
    return this.xsOverlayEnabled;
  }

  /**
   * Get pipe name for debugging
   */
  public getPipeName(): string {
    return this.pipeName;
  }
}
