#!/usr/bin/env node

import { VRChatMonitor } from './core/VRChatMonitor';
import { Logger } from './utils/Logger';
import chalk from 'chalk';

const APP_VERSION = '2.0.0';

/**
 * Create a centered line within the box (59 chars wide)
 */
function centerLine(text: string, width: number = 59): string {
  const padding = width - text.length;
  const leftPad = Math.floor(padding / 2);
  const rightPad = padding - leftPad;
  return '║' + ' '.repeat(leftPad) + text + ' '.repeat(rightPad) + '║';
}

/**
 * Create a left-aligned line within the box (59 chars wide)
 */
function leftLine(text: string, width: number = 59): string {
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

  try {
    // Set console window title (Windows only)
    if (process.platform === 'win32') {
      process.stdout.write(`\x1b]0;VRChat Monitor v${APP_VERSION}\x07`);
    }

    // Parse command-line arguments
    const args = process.argv.slice(2);
    const testAlertMode = args.includes('--test-alert') || args.includes('-t');
    const showHelp = args.includes('--help') || args.includes('-h');

    // Print banner
    console.log(chalk.cyan(BANNER));
    console.log(chalk.gray('═'.repeat(61)));
    console.log();

    // Show help if requested
    if (showHelp) {
      printHelp();
      process.exit(0);
    }

    // Initialize monitor
    monitor = new VRChatMonitor();

    // Setup event listeners
    monitor.on('ready', async () => {
      const logger = Logger.getInstance();
      logger.info(chalk.green('✓ All systems operational'));
      logger.info(chalk.gray('═'.repeat(61)));
      console.log();

      // If test alert mode, send test alert and exit
      if (testAlertMode) {
        console.log(chalk.cyan.bold('🧪 TEST ALERT MODE'));
        console.log(chalk.gray('═'.repeat(61)));
        console.log();

        await monitor!.sendTestAlert();

        console.log();
        console.log(chalk.gray('═'.repeat(61)));
        console.log(chalk.green('Test alert sent successfully!'));
        console.log(chalk.gray('Exiting in 3 seconds...'));

        setTimeout(async () => {
          await monitor!.stop();
          process.exit(0);
        }, 3000);
      } else {
        console.log(chalk.yellow('ℹ️  Press Ctrl+C to exit'));
        console.log(chalk.gray('   Use --test-alert to test notifications'));
        console.log();
      }
    });

    monitor.on('alert', (result) => {
      console.log();
      console.log(chalk.red.bold('═'.repeat(61)));
      console.log(chalk.red.bold('⚠️  MATCH DETECTED'));
      console.log(chalk.red.bold('═'.repeat(61)));
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
            const displayText = match.matchedText.length > 100
              ? match.matchedText.substring(0, 100) + '...'
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

      console.log(chalk.red.bold('═'.repeat(61)));
      console.log();
    });

    monitor.on('error', (error) => {
      const logger = Logger.getInstance();
      logger.error('Monitor error', { error });
    });

    // Start monitoring
    await monitor.start();

    // Keep process alive
    await new Promise(() => {}); // Intentionally never resolves

  } catch (error) {
    console.error();
    console.error(chalk.red.bold('═'.repeat(61)));
    console.error(chalk.red.bold('❌ FATAL ERROR'));
    console.error(chalk.red.bold('═'.repeat(61)));
    console.error();

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
    console.error(chalk.red.bold('═'.repeat(61)));
    console.error();

    // Cleanup
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
 * Print help information
 */
function printHelp(): void {
  console.log(chalk.white.bold('Usage:'));
  console.log(chalk.gray('  vrc-monitor-v2 [options]'));
  console.log();
  console.log(chalk.white.bold('Options:'));
  console.log(chalk.cyan('  -h, --help        ') + chalk.gray('Show this help message'));
  console.log(chalk.cyan('  -t, --test-alert  ') + chalk.gray('Send test alerts on all configured channels and exit'));
  console.log();
  console.log(chalk.white.bold('Examples:'));
  console.log(chalk.gray('  vrc-monitor-v2                  ') + chalk.white('# Normal operation'));
  console.log(chalk.gray('  vrc-monitor-v2 --test-alert     ') + chalk.white('# Test all notifications'));
  console.log();
  console.log(chalk.white.bold('Configuration:'));
  console.log(chalk.gray('  Edit config.json to configure notifications, blocklist, and settings'));
  console.log();
}

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
  console.error();
  console.error(chalk.red.bold('Uncaught Exception:'), error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error();
  console.error(chalk.red.bold('Unhandled Rejection:'), reason);
  process.exit(1);
});

// Run
main();
