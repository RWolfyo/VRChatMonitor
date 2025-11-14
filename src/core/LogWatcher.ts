import fs from 'fs';
import path from 'path';
import { FSWatcher, watch } from 'chokidar';
import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { PlayerJoinEvent, PlayerLeaveEvent } from '../types/events';
import {
  LOG_ROTATION_CHECK_INTERVAL_MS,
  LOG_ROTATION_CHECK_INTERVAL_SECONDS,
  LOG_WATCHER_STABILITY_THRESHOLD_MS,
  LOG_WATCHER_POLL_INTERVAL_MS,
} from '../constants';

export class LogWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private logger: Logger;
  private pathResolver: PathResolver;
  private logDirectory: string | null = null;
  private currentLogFile: string | null = null;
  private lastPosition: number = 0;
  private isWatching: boolean = false;
  private rotationCheckTimer: NodeJS.Timeout | null = null;

  // Regex patterns for log parsing
  private readonly JOIN_PATTERN = /\[Behaviour\] OnPlayerJoined (.+) \(([^)]+)\)/;
  private readonly LEAVE_PATTERN = /\[Behaviour\] OnPlayerLeft (.+) \(([^)]+)\)/;

  constructor() {
    super();
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();

    // Auto-detect VRChat log directory
    this.logDirectory = this.pathResolver.detectVRChatLogDir();
    if (!this.logDirectory) {
      throw new Error('Could not auto-detect VRChat log directory. Please ensure VRChat is installed in the default location.');
    }
  }

  /**
   * Start watching VRChat logs
   */
  public start(): void {
    if (this.isWatching) {
      this.logger.warn('LogWatcher is already running');
      return;
    }

    try {
      // Find the most recent output_log file
      this.currentLogFile = this.findLatestLogFile();
      if (this.currentLogFile) {
        this.logger.info(`Monitoring log file: ${this.currentLogFile}`);
        this.lastPosition = this.getFileSize(this.currentLogFile);
      } else {
        this.logger.warn('No VRChat log files found yet. Waiting for VRChat to start...');
      }

      // Watch the directory for new files and changes
      this.watcher = watch(this.logDirectory!, {
        persistent: true,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: LOG_WATCHER_STABILITY_THRESHOLD_MS,
          pollInterval: LOG_WATCHER_POLL_INTERVAL_MS,
        },
      });

      this.watcher.on('add', (filePath) => this.handleFileAdd(filePath));
      this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
      this.watcher.on('error', (error) => this.handleError(error instanceof Error ? error : new Error(String(error))));

      // Start periodic rotation check
      this.startRotationCheck();

      this.isWatching = true;
      this.logger.info('LogWatcher started successfully');
    } catch (error) {
      this.logger.error('Failed to start LogWatcher', { error });
      throw error;
    }
  }

  /**
   * Stop watching logs
   */
  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Stop rotation check timer
    if (this.rotationCheckTimer) {
      clearInterval(this.rotationCheckTimer);
      this.rotationCheckTimer = null;
    }

    this.isWatching = false;
    this.logger.info('LogWatcher stopped');
  }

  /**
   * Find the most recent output_log file
   */
  private findLatestLogFile(): string | null {
    if (!this.logDirectory) return null;

    try {
      const files = fs.readdirSync(this.logDirectory);
      const logFiles = files
        .filter((file) => /^output_log.*\.txt$/i.test(file))
        .map((file) => {
          const fullPath = path.join(this.logDirectory!, file);
          const stats = fs.statSync(fullPath);
          return { path: fullPath, mtime: stats.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);

      return logFiles.length > 0 ? logFiles[0].path : null;
    } catch (error) {
      this.logger.error('Error finding latest log file', { error });
      return null;
    }
  }

  /**
   * Handle new file added to directory
   */
  private handleFileAdd(filePath: string): void {
    if (!/output_log.*\.txt$/i.test(path.basename(filePath))) {
      return;
    }

    this.logger.debug(`New log file detected: ${filePath}`);

    // Check if this is newer than current log
    const currentFile = this.currentLogFile;
    if (!currentFile || this.isNewerFile(filePath, currentFile)) {
      this.logger.info(`Switching to new log file: ${filePath}`);
      this.currentLogFile = filePath;
      this.lastPosition = 0;
    }
  }

  /**
   * Start periodic rotation check timer
   */
  private startRotationCheck(): void {
    this.rotationCheckTimer = setInterval(() => {
      this.checkForLogRotation();
    }, LOG_ROTATION_CHECK_INTERVAL_MS);

    this.logger.debug(`Log rotation check timer started (checking every ${LOG_ROTATION_CHECK_INTERVAL_SECONDS} seconds)`);
  }

  /**
   * Periodically check if a newer log file exists
   */
  private checkForLogRotation(): void {
    try {
      const latestFile = this.findLatestLogFile();

      // If we found a newer file, switch to it
      if (latestFile && latestFile !== this.currentLogFile) {
        if (!this.currentLogFile || this.isNewerFile(latestFile, this.currentLogFile)) {
          this.logger.info(`Log rotation detected! Switching to: ${latestFile}`);
          this.currentLogFile = latestFile;
          this.lastPosition = 0;
        }
      }

      // Also check if current file still exists
      if (this.currentLogFile && !fs.existsSync(this.currentLogFile)) {
        this.logger.warn(`Current log file no longer exists: ${this.currentLogFile}`);
        this.currentLogFile = latestFile;
        this.lastPosition = 0;
        if (this.currentLogFile) {
          this.logger.info(`Switched to: ${this.currentLogFile}`);
        }
      }
    } catch (error) {
      this.logger.debug('Error during rotation check', { error });
    }
  }

  /**
   * Handle file change (new content written)
   */
  private handleFileChange(filePath: string): void {
    if (!/output_log.*\.txt$/i.test(path.basename(filePath))) {
      return;
    }

    // Only process the current log file
    if (this.currentLogFile && filePath === this.currentLogFile) {
      this.processNewContent(filePath);
    }
  }

  /**
   * Process new content from log file
   */
  private processNewContent(filePath: string): void {
    try {
      // Check if file still exists before processing
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`Log file disappeared: ${filePath}`);
        this.checkForLogRotation(); // Immediately check for rotation
        return;
      }

      const currentSize = this.getFileSize(filePath);

      // File was truncated or reset
      if (currentSize < this.lastPosition) {
        this.logger.debug('Log file was reset or truncated');
        this.lastPosition = 0;
      }

      // No new content
      if (currentSize === this.lastPosition) {
        return;
      }

      // Read new content
      const newContent = this.readFileChunk(filePath, this.lastPosition, currentSize);
      this.lastPosition = currentSize;

      // Process lines
      const lines = newContent.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          this.processLogLine(line);
        }
      }
    } catch (error) {
      this.logger.error('Error processing new log content', { error, filePath });
      // On error, trigger rotation check in case file was rotated
      this.checkForLogRotation();
    }
  }

  /**
   * Process a single log line
   */
  private processLogLine(line: string): void {
    try {
      // Check for player join
      const joinMatch = line.match(this.JOIN_PATTERN);
      if (joinMatch) {
        const [, displayName, userId] = joinMatch;
        this.handlePlayerJoin(userId, displayName);
        return;
      }

      // Check for player leave
      const leaveMatch = line.match(this.LEAVE_PATTERN);
      if (leaveMatch) {
        const [, displayName, userId] = leaveMatch;
        this.handlePlayerLeave(userId, displayName);
        return;
      }
    } catch (error) {
      this.logger.debug('Error processing log line', { error, line });
    }
  }

  /**
   * Handle player join event
   */
  private handlePlayerJoin(userId: string, displayName: string): void {
    this.logger.debug(`Player joined: ${displayName} (${userId})`);

    const event: PlayerJoinEvent = {
      userId,
      displayName,
      timestamp: new Date(),
    };

    this.emit('playerJoin', event);
  }

  /**
   * Handle player leave event
   */
  private handlePlayerLeave(userId: string, displayName: string): void {
    this.logger.debug(`Player left: ${displayName} (${userId})`);

    const event: PlayerLeaveEvent = {
      userId,
      displayName,
      timestamp: new Date(),
    };

    this.emit('playerLeave', event);
  }

  /**
   * Handle watcher errors
   */
  private handleError(error: Error): void {
    this.logger.error('LogWatcher error', { error });
    this.emit('error', error);
  }

  /**
   * Get file size
   */
  private getFileSize(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * Read chunk of file
   */
  private readFileChunk(filePath: string, start: number, end: number): string {
    let fd: number | null = null;
    try {
      const buffer = Buffer.alloc(end - start);
      fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Check if file is newer based on modification time
   */
  private isNewerFile(fileA: string, fileB: string): boolean {
    try {
      const statsA = fs.statSync(fileA);
      const statsB = fs.statSync(fileB);
      return statsA.mtimeMs > statsB.mtimeMs;
    } catch {
      return false;
    }
  }

  /**
   * Get current log file path
   */
  public getCurrentLogFile(): string | null {
    return this.currentLogFile;
  }

  /**
   * Check if watching
   */
  public isActive(): boolean {
    return this.isWatching;
  }
}
