#!/usr/bin/env node

import { VRChatMonitor } from './core/VRChatMonitor';
import { Logger } from './utils/Logger';
import { CommandHandler } from './utils/CommandHandler';
import { APP_VERSION } from './version';
import {
  CRASH_REPORT_SEPARATOR_WIDTH,
  CONSOLE_SEPARATOR_WIDTH,
  CONSOLE_MATCHED_TEXT_MAX_LENGTH,
  BANNER_CONTENT_WIDTH,
  LOG_BUFFER_MAX_SIZE,
} from './constants';
import { sanitizeLogBuffer, sanitizeSensitiveData } from './utils/ErrorUtils';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Write crash log to file
 */
function writeCrashLog(error: Error | any, type: string = 'crash'): string {
  try {
    // Get executable directory or current directory
    // @ts-expect-error - process.pkg is added by pkg bundler
    const execDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
    const crashDir = path.join(execDir, 'crashes');

    // Create crashes directory if it doesn't exist
    if (!fs.existsSync(crashDir)) {
      fs.mkdirSync(crashDir, { recursive: true });
    }

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    const filename = `crash-${timestamp}.log`;
    const filepath = path.join(crashDir, filename);

    // Get recent logs from buffer and sanitize sensitive data
    const logBuffer = Logger.getLogBuffer();
    const sanitizedLogs = sanitizeLogBuffer(logBuffer);

    // Build crash report
    const report = [
      '═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH),
      `VRChat Monitor v${APP_VERSION} - Crash Report`,
      '═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH),
      '',
      `Type: ${type}`,
      `Date: ${now.toISOString()}`,
      `Platform: ${process.platform} ${process.arch}`,
      `Node Version: ${process.version}`,
      '',
      '⚠️  NOTICE: Sensitive data (passwords, tokens, IDs) has been redacted from this log.',
      '',
      '═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH),
      `Application Log (Last ${LOG_BUFFER_MAX_SIZE} entries):`,
      '═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH),
      '',
    ];

    // Add sanitized log buffer
    if (sanitizedLogs.length > 0) {
      report.push(...sanitizedLogs);
    } else {
      report.push('(No logs available)');
    }

    report.push('');
    report.push('═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH));
    report.push('Error Details:');
    report.push('═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH));
    report.push('');

    if (error instanceof Error) {
      report.push(`Message: ${sanitizeSensitiveData(error.message)}`);
      report.push('');
      if (error.stack) {
        report.push('Stack Trace:');
        report.push(sanitizeSensitiveData(error.stack));
      }
    } else {
      report.push(`Error: ${sanitizeSensitiveData(String(error))}`);
    }

    report.push('');
    report.push('═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH));
    report.push('End of Crash Report');
    report.push('═'.repeat(CRASH_REPORT_SEPARATOR_WIDTH));

    // Write to file
    fs.writeFileSync(filepath, report.join('\n'), 'utf-8');

    return filepath;
  } catch (writeError) {
    // If we can't write the crash log, just log to console
    console.error('Failed to write crash log:', writeError);
    return '';
  }
}

/**
 * Create a centered line within the box (59 chars wide)
 */
export function centerLine(text: string, width: number = BANNER_CONTENT_WIDTH): string {
  const padding = width - text.length;
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return '║' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + '║';
}

/**
 * Create a left-aligned line within the box (59 chars wide)
 */
export function leftLine(text: string, width: number = BANNER_CONTENT_WIDTH): string {
  const padding = width - text.length;
  return '║' + text + ' '.repeat(padding) + '║';
}

// ASCII art banner - use centerLine() to auto-align any text you add/edit
const BANNER = `
╔═══════════════════════════════════════════════════════════╗
${centerLine('')}
${leftLine('   ██╗   ██╗██████╗  ██████╗██╗  ██╗ █████╗ ████████╗')}
${leftLine('   ██║   ██║██╔══██╗██╔════╝██║  ██║██╔══██╗╚══██╔══╝')}
${leftLine('   ██║   ██║██████╔╝██║     ███████║███████║   ██║')}
${leftLine('   ╚██╗ ██╔╝██╔══██╗██║     ██╔══██║██╔══██║   ██║')}
${leftLine('    ╚████╔╝ ██║  ██║╚██████╗██║  ██║██║  ██║   ██║')}
${leftLine('     ╚═══╝  ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝')}
${centerLine('')}
${centerLine(`M O N I T O R   v ${APP_VERSION}`)}
${centerLine('')}
${centerLine('Advanced Instance Monitoring & Moderation')}
${centerLine('')}
╚═══════════════════════════════════════════════════════════╝
`;

async function main() {
  let monitor: VRChatMonitor | null = null;
  let commandHandler: CommandHandler | null = null as CommandHandler | null;

  try {
    // Set console window title and configure console mode (Windows only)
    if (process.platform === 'win32') {
      process.stdout.write(`\x1b]0;VRChat Monitor v${APP_VERSION}\x07`);

      // Enable virtual terminal processing for better readline support
      // This helps prevent double-echo issues in packaged executables
      if (process.stdout.isTTY) {
        process.stdout.write('\x1b[?25h'); // Show cursor
      }
    }

    // Print banner
    console.log(chalk.cyan(BANNER));
    console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.log();

    // Initialize monitor
    monitor = new VRChatMonitor();

    // Setup event listeners
    monitor.on('ready', async () => {
      const logger = Logger.getInstance();
      logger.info(chalk.green('✓ All systems operational'));
      logger.info(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
      console.log();

      // Start interactive command handler
      commandHandler = new CommandHandler(monitor!);
      commandHandler.start();
    });

    monitor.on('alert', (result) => {
      console.log();
      console.log(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
      console.log(chalk.red.bold('⚠️  MATCH DETECTED'));
      console.log(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
      console.log(chalk.white(`User: ${chalk.bold(result.displayName)}`));
      console.log(chalk.gray(`User ID: ${result.userId}`));
      console.log();
      console.log(chalk.yellow.bold('Matches Found:'));
      console.log();

      for (let i = 0; i < result.matches.length; i++) {
        const match = result.matches[i];
        const icon = getSeverityIcon(match.severity);
        const severityColor = getSeverityColor(match.severity);

        console.log(chalk.white(`  ${i + 1}. ${icon} ${getMatchTypeLabel(match.type)}`));
        console.log(chalk.gray(`     Severity: ${severityColor(match.severity.toUpperCase())}`));

        // Show group information for group-related matches
        if (match.groupId && match.groupName) {
          console.log(chalk.cyan(`     Group: ${match.groupName}`));
          console.log(chalk.gray(`     Group ID: ${match.groupId}`));
        }

        // Show keyword match details
        if (match.keyword) {
          console.log(chalk.magenta(`     Keyword Pattern: ${match.keyword}`));
          if (match.keywordMatchLocation) {
            const locationLabel = getLocationLabel(match.keywordMatchLocation);
            console.log(chalk.gray(`     Matched In: ${locationLabel}`));
          }
          if (match.matchedText) {
            // Truncate very long text
            const displayText = match.matchedText.length > CONSOLE_MATCHED_TEXT_MAX_LENGTH
              ? match.matchedText.substring(0, CONSOLE_MATCHED_TEXT_MAX_LENGTH) + '...'
              : match.matchedText;
            console.log(chalk.gray(`     Matched Text: "${displayText}"`));
          }
        }

        // Show reason
        if (match.reason) {
          console.log(chalk.yellow(`     Reason: ${match.reason}`));
        }

        // Show author if available
        if (match.author && match.author !== 'Unknown') {
          console.log(chalk.gray(`     Added By: ${match.author}`));
        }

        console.log();
      }

      console.log(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
      console.log();
    });

    monitor.on('error', (error) => {
      const logger = Logger.getInstance();
      logger.error('Monitor error', { error });
    });

    // Start monitoring
    await monitor.start();

  } catch (error) {
    console.error();
    console.error(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.error(chalk.red.bold('❌ FATAL ERROR'));
    console.error(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.error();

    // Write crash log
    const crashLogPath = writeCrashLog(error, 'Fatal Error');

    if (error instanceof Error) {
      console.error(chalk.red(error.message));

      // Provide helpful error messages
      if (error.message.includes('config.json not found')) {
        console.error();
        console.error(chalk.yellow('💡 Solution:'));
        console.error(chalk.white('  Ensure config.json exists in the same directory as the executable.'));
      } else if (error.message.includes('VRChat credentials')) {
        console.error();
        console.error(chalk.yellow('💡 Solution:'));
        console.error(chalk.white('  Edit config.json and provide your VRChat username and password:'));
        console.error(chalk.gray('  {'));
        console.error(chalk.gray('    "vrchat": {'));
        console.error(chalk.gray('      "username": "your_username",'));
        console.error(chalk.gray('      "password": "your_password"'));
        console.error(chalk.gray('    }'));
        console.error(chalk.gray('  }'));
      } else if (error.message.includes('log directory')) {
        console.error();
        console.error(chalk.yellow('💡 Solution:'));
        console.error(chalk.white('  VRChat must be installed. If using a custom install location:'));
        console.error(chalk.white('  Edit config.json and set advanced.logPath to your VRChat log directory.'));
      } else if (error.message.includes('authentication failed')) {
        console.error();
        console.error(chalk.yellow('💡 Possible causes:'));
        console.error(chalk.white('  - Incorrect username or password'));
        console.error(chalk.white('  - 2FA enabled but totpSecret not configured'));
        console.error(chalk.white('  - VRChat API is down'));
      }

      // Show stack trace in debug mode
      if (process.env.DEBUG || process.env.LOG_LEVEL === 'debug') {
        console.error();
        console.error(chalk.gray('Stack trace:'));
        console.error(chalk.gray(error.stack));
      }
    } else {
      console.error(chalk.red(String(error)));
    }

    console.error();
    console.error(chalk.red.bold('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));

    // Show crash log location
    if (crashLogPath) {
      console.error();
      console.error(chalk.yellow(`📝 Crash log saved to: ${crashLogPath}`));
    }

    console.error();

    // Cleanup
    if (commandHandler) {
      try {
        commandHandler.stop();
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    if (monitor) {
      try {
        await monitor.stop();
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }

    process.exit(1);
  }
}

/**
 * Get severity icon for console output
 */
function getSeverityIcon(severity: string): string {
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
 * Get severity color function
 */
function getSeverityColor(severity: string): typeof chalk.red {
  switch (severity) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.green;
    default:
      return chalk.white;
  }
}

/**
 * Get human-readable match type label
 */
function getMatchTypeLabel(type: string): string {
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
 * Get human-readable location label
 */
function getLocationLabel(location: string): string {
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
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
  console.error();
  console.error(chalk.red.bold('Uncaught Exception:'), error);

  const crashLogPath = writeCrashLog(error, 'Uncaught Exception');
  if (crashLogPath) {
    console.error();
    console.error(chalk.yellow(`📝 Crash log saved to: ${crashLogPath}`));
  }

  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error();
  console.error(chalk.red.bold('Unhandled Rejection:'), reason);

  const crashLogPath = writeCrashLog(reason, 'Unhandled Rejection');
  if (crashLogPath) {
    console.error();
    console.error(chalk.yellow(`📝 Crash log saved to: ${crashLogPath}`));
  }

  process.exit(1);
});

// Run
main();
