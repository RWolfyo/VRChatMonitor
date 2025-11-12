import winston from 'winston';
import { LogLevel } from '../types/config';

export class Logger {
  private logger: winston.Logger;
  private static instance: Logger;
  private static onLogCallback?: () => void;

  private constructor(level: LogLevel = 'info', enableFile: boolean = false) {
    // Map our custom 'verbose' level to Winston's 'silly' level
    const winstonLevel = level === 'verbose' ? 'silly' : level;

    const transports: winston.transport[] = [
      new winston.transports.Console({
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
      }),
    ];

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
  }

  public static getInstance(level?: LogLevel, enableFile?: boolean): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(level, enableFile);
    }
    return Logger.instance;
  }

  public static initialize(level: LogLevel, enableFile: boolean): void {
    Logger.instance = new Logger(level, enableFile);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
    this.notifyLogOutput();
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
    this.notifyLogOutput();
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
    this.notifyLogOutput();
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
    this.notifyLogOutput();
  }

  public verbose(message: string, meta?: Record<string, unknown>): void {
    this.logger.silly(message, meta);
    this.notifyLogOutput();
  }

  private notifyLogOutput(): void {
    if (Logger.onLogCallback) {
      // Use setImmediate to ensure the log is written before the prompt is redrawn
      setImmediate(() => {
        Logger.onLogCallback?.();
      });
    }
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
}
