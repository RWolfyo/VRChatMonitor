/**
 * VRChat Log File Watcher
 *
 * Monitors VRChat's output_log*.txt files for player join/leave events and emits
 * events when players enter or exit the current instance.
 *
 * Features:
 * - Automatic VRChat log directory detection (Windows, Linux/Proton, macOS)
 * - Real-time log file monitoring using chokidar file watcher
 * - Automatic log rotation handling (VRChat creates new logs on restart)
 * - Position tracking to avoid re-parsing old content
 * - Regex-based event extraction from log lines
 * - Event emission for integration with monitoring system
 *
 * Log Patterns Monitored:
 * - Join: "[Behaviour] OnPlayerJoined {displayName} ({userId})"
 * - Leave: "[Behaviour] OnPlayerLeft {displayName} ({userId})"
 *
 * Technical Details:
 * - Uses chokidar's awaitWriteFinish to prevent partial reads
 * - Periodic rotation checks (60s) to catch new log files
 * - Handles file truncation and disappearance gracefully
 * - Only processes new content since last read (position tracking)
 *
 * Event Emission:
 * - 'playerJoin': Emitted when user joins (PlayerJoinEvent)
 * - 'playerLeave': Emitted when user leaves (PlayerLeaveEvent)
 * - 'error': Emitted on file system or parsing errors
 *
 * @extends EventEmitter
 */

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
  /** Chokidar file system watcher instance */
  private watcher: FSWatcher | null = null;

  /** Logger instance for debug/error messages */
  private logger: Logger;

  /** Path resolver for VRChat directory detection */
  private pathResolver: PathResolver;

  /** Detected VRChat log directory path */
  private logDirectory: string | null = null;

  /** Currently monitored log file path */
  private currentLogFile: string | null = null;

  /** Last read position in current log file (byte offset) */
  private lastPosition: number = 0;

  /** Whether log watcher is currently active */
  private isWatching: boolean = false;

  /** Interval timer for periodic log rotation checks */
  private rotationCheckTimer: NodeJS.Timeout | null = null;

  /** Regex pattern for player join events in VRChat logs */
  private readonly JOIN_PATTERN = /\[Behaviour\] OnPlayerJoined (.+) \(([^)]+)\)/;

  /** Regex pattern for player leave events in VRChat logs */
  private readonly LEAVE_PATTERN = /\[Behaviour\] OnPlayerLeft (.+) \(([^)]+)\)/;

  /**
   * Initialize the Log Watcher.
   *
   * Auto-detects VRChat log directory using PathResolver and validates access.
   * Throws error if VRChat logs cannot be found.
   *
   * @throws Error if VRChat log directory cannot be detected
   */
  constructor() {
    super();
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();

    this.logDirectory = this.pathResolver.detectVRChatLogDir();
    if (!this.logDirectory) {
      throw new Error('Could not auto-detect VRChat log directory. Please ensure VRChat is installed in the default location.');
    }
  }

  /**
   * Start monitoring VRChat log files for player events.
   *
   * Initializes chokidar file watcher on the VRChat log directory, finds the most
   * recent log file, and begins monitoring for changes. Sets up periodic rotation
   * checks to detect new log files when VRChat restarts.
   *
   * @throws Error if watcher fails to initialize
   */
  public start(): void {
    if (this.isWatching) {
      this.logger.warn('LogWatcher is already running');
      return;
    }

    try {
      this.currentLogFile = this.findLatestLogFile();
      if (this.currentLogFile) {
        this.logger.info(`Monitoring log file: ${this.currentLogFile}`);
        this.lastPosition = this.getFileSize(this.currentLogFile);
      } else {
        this.logger.warn('No VRChat log files found yet. Waiting for VRChat to start...');
      }

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

      this.startRotationCheck();

      this.isWatching = true;
      this.logger.info('LogWatcher started successfully');
    } catch (error) {
      this.logger.error('Failed to start LogWatcher', { error });
      throw error;
    }
  }

  /**
   * Stop monitoring VRChat log files and clean up resources.
   *
   * Closes the chokidar watcher, stops rotation check timer, and resets state.
   * Safe to call multiple times.
   */
  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (this.rotationCheckTimer) {
      clearInterval(this.rotationCheckTimer);
      this.rotationCheckTimer = null;
    }

    this.isWatching = false;
    this.logger.info('LogWatcher stopped');
  }

  /**
   * Find the most recent VRChat log file in the log directory.
   *
   * Searches for files matching output_log*.txt pattern, sorts by modification time,
   * and returns the newest one. VRChat creates timestamped log files on each launch.
   *
   * @returns Full path to most recent log file, or null if none found
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
   * Handle new log file detected by chokidar watcher.
   *
   * Filters for output_log*.txt files and switches to the new file if it's
   * newer than the current log file being monitored.
   *
   * @param filePath - Full path to newly detected file
   */
  private handleFileAdd(filePath: string): void {
    if (!/output_log.*\.txt$/i.test(path.basename(filePath))) {
      return;
    }

    this.logger.debug(`New log file detected: ${filePath}`);

    const currentFile = this.currentLogFile;
    if (!currentFile || this.isNewerFile(filePath, currentFile)) {
      this.logger.info(`Switching to new log file: ${filePath}`);
      this.currentLogFile = filePath;
      this.lastPosition = 0;
    }
  }

  /**
   * Start periodic log rotation check timer.
   *
   * Creates interval that checks for new log files every 60 seconds.
   * This catches cases where chokidar misses file creation events.
   */
  private startRotationCheck(): void {
    this.rotationCheckTimer = setInterval(() => {
      this.checkForLogRotation();
    }, LOG_ROTATION_CHECK_INTERVAL_MS);

    this.logger.debug(`Log rotation check timer started (checking every ${LOG_ROTATION_CHECK_INTERVAL_SECONDS} seconds)`);
  }

  /**
   * Check for log file rotation and switch to newest file if necessary.
   *
   * Called periodically by rotation check timer. Handles two cases:
   * 1. New log file created (VRChat restart)
   * 2. Current log file deleted or moved
   */
  private checkForLogRotation(): void {
    try {
      const latestFile = this.findLatestLogFile();

      if (latestFile && latestFile !== this.currentLogFile) {
        if (!this.currentLogFile || this.isNewerFile(latestFile, this.currentLogFile)) {
          this.logger.info(`Log rotation detected! Switching to: ${latestFile}`);
          this.currentLogFile = latestFile;
          this.lastPosition = 0;
        }
      }

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
   * Handle file change event from chokidar watcher.
   *
   * Triggered when new content is written to a log file. Only processes
   * changes to the currently monitored log file.
   *
   * @param filePath - Path to changed file
   */
  private handleFileChange(filePath: string): void {
    if (!/output_log.*\.txt$/i.test(path.basename(filePath))) {
      return;
    }

    if (this.currentLogFile && filePath === this.currentLogFile) {
      this.processNewContent(filePath);
    }
  }

  /**
   * Process new content added to the log file since last read.
   *
   * Reads content from lastPosition to current file size, splits into lines,
   * and processes each line for player events. Handles file truncation and
   * disappearance gracefully.
   *
   * @param filePath - Path to log file to process
   */
  private processNewContent(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`Log file disappeared: ${filePath}`);
        this.checkForLogRotation();
        return;
      }

      const currentSize = this.getFileSize(filePath);

      if (currentSize < this.lastPosition) {
        this.logger.debug('Log file was reset or truncated');
        this.lastPosition = 0;
      }

      if (currentSize === this.lastPosition) {
        return;
      }

      const newContent = this.readFileChunk(filePath, this.lastPosition, currentSize);
      this.lastPosition = currentSize;

      const lines = newContent.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) {
          this.processLogLine(line);
        }
      }
    } catch (error) {
      this.logger.error('Error processing new log content', { error, filePath });
      this.checkForLogRotation();
    }
  }

  /**
   * Process a single log line and check for player events.
   *
   * Tests line against JOIN_PATTERN and LEAVE_PATTERN regex, extracts
   * player information, and emits appropriate events.
   *
   * @param line - Single line from VRChat log file
   */
  private processLogLine(line: string): void {
    try {
      const joinMatch = line.match(this.JOIN_PATTERN);
      if (joinMatch) {
        const [, displayName, userId] = joinMatch;
        this.handlePlayerJoin(userId, displayName);
        return;
      }

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
   * Handle player join event and emit to monitoring system.
   *
   * Creates PlayerJoinEvent object and emits 'playerJoin' event for
   * downstream processing by VRChatMonitor.
   *
   * @param userId - VRChat user ID (usr_xxx format)
   * @param displayName - Player's display name
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
   * Handle player leave event and emit to monitoring system.
   *
   * Creates PlayerLeaveEvent object and emits 'playerLeave' event for
   * downstream processing.
   *
   * @param userId - VRChat user ID (usr_xxx format)
   * @param displayName - Player's display name
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
   * Handle file watcher errors and propagate to monitoring system.
   *
   * Logs error and emits 'error' event for upstream handling.
   *
   * @param error - Error object from chokidar watcher
   */
  private handleError(error: Error): void {
    this.logger.error('LogWatcher error', { error });
    this.emit('error', error);
  }

  /**
   * Get the current size of a file in bytes.
   *
   * @param filePath - Path to file
   * @returns File size in bytes, or 0 if file doesn't exist
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
   * Read a specific byte range from a file.
   *
   * Used for reading only new content without re-parsing entire log file.
   * Properly handles file descriptor cleanup in all cases.
   *
   * @param filePath - Path to file to read
   * @param start - Starting byte position
   * @param end - Ending byte position
   * @returns UTF-8 decoded file content from specified range
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
   * Compare two files to determine which is newer.
   *
   * Uses file modification time (mtime) for comparison. Used during
   * log rotation to identify the newest log file.
   *
   * @param fileA - First file path
   * @param fileB - Second file path
   * @returns True if fileA is newer than fileB, false otherwise
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
   * Get the path to the currently monitored log file.
   *
   * @returns Full path to current log file, or null if none
   */
  public getCurrentLogFile(): string | null {
    return this.currentLogFile;
  }

  /**
   * Check if log watcher is currently active and monitoring.
   *
   * @returns True if watcher is running, false otherwise
   */
  public isActive(): boolean {
    return this.isWatching;
  }
}
