import fs from 'fs';
import path from 'path';
import { FSWatcher, watch } from 'chokidar';
import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { PlayerJoinEvent, PlayerLeaveEvent } from '../types/events';

export class LogWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private logger: Logger;
  private pathResolver: PathResolver;
  private logDirectory: string | null = null;
  private currentLogFile: string | null = null;
  private lastPosition: number = 0;
  private isWatching: boolean = false;

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
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      this.watcher.on('add', (filePath) => this.handleFileAdd(filePath));
      this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
      this.watcher.on('error', (error) => this.handleError(error instanceof Error ? error : new Error(String(error))));

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
    const buffer = Buffer.alloc(end - start);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
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
