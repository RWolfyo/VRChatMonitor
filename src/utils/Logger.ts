import winston from 'winston';
import { LogLevel } from '../types/config';
import { LOG_BUFFER_MAX_SIZE } from '../constants';

export class Logger {
  private logger: winston.Logger;
  private static instance: Logger;
  private static onLogCallback?: () => void;
  private static logBuffer: string[] = [];

  private constructor(level: LogLevel = 'info', enableFile: boolean = false) {
    // Map our custom 'verbose' level to Winston's 'silly' level
    const winstonLevel = level === 'verbose' ? 'silly' : level;

    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level: logLevel, message, ...meta }) => {
          // Pretty print large objects for verbose logging
          let metaStr = '';
          if (Object.keys(meta).length) {
            if (winstonLevel === 'silly') {
              // Verbose mode: pretty print with indentation
              metaStr = `\n${JSON.stringify(meta, null, 2)}`;
            } else {
              // Normal mode: compact JSON
              metaStr = ` ${JSON.stringify(meta)}`;
            }
          }
          return `[${timestamp}] ${logLevel}: ${message}${metaStr}`;
        })
      ),
    });

    const transports: winston.transport[] = [consoleTransport];

    if (enableFile) {
      transports.push(
        new winston.transports.File({
          filename: 'debug.log',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        })
      );
    }

    this.logger = winston.createLogger({
      level: winstonLevel,
      transports,
    });

    // Listen to console transport's 'logged' event for accurate timing
    consoleTransport.on('logged', () => {
      if (Logger.onLogCallback) {
        // Use setImmediate to ensure output is flushed
        setImmediate(() => {
          Logger.onLogCallback?.();
        });
      }
    });
  }

  public static getInstance(level?: LogLevel, enableFile?: boolean): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(level, enableFile);
    }
    return Logger.instance;
  }

  public static initialize(level: LogLevel, enableFile: boolean): void {
    Logger.onLogCallback = undefined; // Clear callback on re-initialization
    Logger.instance = new Logger(level, enableFile);
  }

  private addToBuffer(level: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

    if (meta && Object.keys(meta).length > 0) {
      logLine += ` ${JSON.stringify(meta)}`;
    }

    Logger.logBuffer.push(logLine);

    // Keep buffer size limited
    if (Logger.logBuffer.length > LOG_BUFFER_MAX_SIZE) {
      Logger.logBuffer.shift();
    }
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.addToBuffer('error', message, meta);
    this.logger.error(message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.addToBuffer('warn', message, meta);
    this.logger.warn(message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.addToBuffer('info', message, meta);
    this.logger.info(message, meta);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.addToBuffer('debug', message, meta);
    this.logger.debug(message, meta);
  }

  public verbose(message: string, meta?: Record<string, unknown>): void {
    this.addToBuffer('verbose', message, meta);
    this.logger.silly(message, meta);
  }

  public static setLogOutputCallback(callback: () => void): void {
    Logger.onLogCallback = callback;
  }

  public static clearLogOutputCallback(): void {
    Logger.onLogCallback = undefined;
  }

  public setLevel(level: LogLevel): void {
    const winstonLevel = level === 'verbose' ? 'silly' : level;
    this.logger.level = winstonLevel;
  }

  public static getLogBuffer(): string[] {
    return [...Logger.logBuffer];
  }

  public static clearLogBuffer(): void {
    Logger.logBuffer = [];
  }
}
