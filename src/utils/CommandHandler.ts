import * as readline from 'readline';
import chalk from 'chalk';
import { VRChatMonitor } from '../core/VRChatMonitor';
import { APP_VERSION, APP_NAME, APP_BUILD } from '../version';
import { Logger } from './Logger';
import { CONSOLE_SEPARATOR_WIDTH, MONITOR_RESTART_DELAY_MS, COMMAND_PROMPT_REDRAW_DEBOUNCE_MS } from '../constants';

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: (args: string[], monitor: VRChatMonitor) => Promise<void>;
}

export class CommandHandler {
  private rl: readline.Interface;
  private monitor: VRChatMonitor;
  private commands: Map<string, Command> = new Map();
  private isActive: boolean = false;
  private isExecutingCommand: boolean = false;
  private currentInput: string = '';
  private cursorPosition: number = 0;
  private dataHandler?: (key: string) => Promise<void>;
  private commandHistory: string[] = [];
  private historyIndex: number = -1;
  private promptRedrawTimer: NodeJS.Timeout | null = null;
  private originalConsoleLog?: (...args: unknown[]) => void;

  constructor(monitor: VRChatMonitor) {
    this.monitor = monitor;

    // Use terminal: false to prevent readline from echoing
    // We'll handle all input/output manually
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.registerCommands();
  }

  /**
   * Register all available commands
   */
  private registerCommands(): void {
    // Help command
    this.registerCommand({
      name: 'help',
      aliases: ['?', 'h'],
      description: 'Show available commands',
      handler: async () => {
        this.printHelp();
      },
    });

    // Test alert command
    this.registerCommand({
      name: 'test-alert',
      aliases: ['test', 't'],
      description: 'Send test alert on all configured notification channels',
      handler: async () => {
        console.log();
        console.log(chalk.cyan.bold('🧪 Sending test alert...'));
        console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
        console.log();
        await this.monitor.sendTestAlert();
        console.log();
        console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
        console.log(chalk.green('✓ Test alert completed'));
        console.log();
      },
    });

    // Status command
    this.registerCommand({
      name: 'status',
      aliases: ['s', 'info'],
      description: 'Display monitor status and statistics',
      handler: async () => {
        this.printStatus();
      },
    });

    // Update blocklist command
    this.registerCommand({
      name: 'update-blocklist',
      aliases: ['update', 'refresh', 'u'],
      description: 'Force update blocklist from remote source',
      handler: async () => {
        console.log();
        console.log(chalk.cyan('📥 Updating blocklist...'));
        const success = await this.monitor.updateBlocklist();
        if (success) {
          console.log(chalk.green('✓ Blocklist updated successfully'));
          this.printBlocklistStats();
        } else {
          console.log(chalk.yellow('⚠ Blocklist update failed or not configured'));
        }
        console.log();
      },
    });

    // Check user ID command
    this.registerCommand({
      name: 'checkid',
      aliases: ['check', 'lookup'],
      description: 'Manually check a user ID against the blocklist',
      usage: 'checkid <user_id>',
      handler: async (args) => {
        if (args.length === 0) {
          console.log();
          console.log(chalk.red('❌ Error: User ID is required'));
          console.log(chalk.gray('   Usage: checkid <user_id>'));
          console.log(chalk.gray('   Example: checkid usr_12345678-1234-1234-1234-123456789abc'));
          console.log();
          return;
        }

        const userId = args[0];

        // Validate user ID format (VRChat user IDs start with usr_)
        if (!userId.startsWith('usr_')) {
          console.log();
          console.log(chalk.yellow('⚠ Warning: User ID should start with "usr_"'));
          console.log(chalk.gray('   Continuing anyway...'));
          console.log();
        }

        console.log();
        console.log(chalk.cyan.bold(`🔍 Checking user ID: ${userId}`));
        console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
        console.log();

        try {
          const result = await this.monitor.checkUserById(userId);

          if (!result) {
            console.log(chalk.red('✗ Failed to check user - monitor may not be initialized'));
            console.log();
            return;
          }

          // Display user info
          console.log(chalk.white.bold('User Information:'));
          console.log(chalk.gray(`  User ID: ${result.userId}`));
          console.log(chalk.gray(`  Display Name: ${result.displayName}`));
          console.log();

          // Display match results
          if (result.matched) {
            console.log(chalk.red.bold(`⚠️ MATCH DETECTED - ${result.matches.length} issue(s) found`));
            console.log();

            for (let i = 0; i < result.matches.length; i++) {
              const match = result.matches[i];
              const severityColor =
                match.severity === 'high' ? chalk.red :
                match.severity === 'medium' ? chalk.yellow :
                chalk.white;

              console.log(severityColor(`  ${i + 1}. ${match.type.toUpperCase()}`));
              console.log(chalk.gray(`     Severity: ${match.severity}`));
              console.log(chalk.gray(`     Details: ${match.details}`));

              if (match.groupId) {
                console.log(chalk.gray(`     Group ID: ${match.groupId}`));
              }
              if (match.groupName) {
                console.log(chalk.gray(`     Group Name: ${match.groupName}`));
              }
              if (match.keyword) {
                console.log(chalk.gray(`     Keyword Pattern: ${match.keyword}`));
              }
              if (match.matchedText) {
                console.log(chalk.gray(`     Matched Text: ${match.matchedText}`));
              }
              if (match.reason) {
                console.log(chalk.gray(`     Reason: ${match.reason}`));
              }
              if (match.author) {
                console.log(chalk.gray(`     Author: ${match.author}`));
              }

              console.log();
            }
          } else {
            console.log(chalk.green('✓ No matches found - User appears clean'));
            console.log();
          }

        } catch (error) {
          console.log(chalk.red('✗ Error checking user ID:'));
          console.log(chalk.gray(`   ${error instanceof Error ? error.message : String(error)}`));
          console.log();
        }

        console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
        console.log();
      },
    });

    // Clear screen command
    this.registerCommand({
      name: 'clear',
      aliases: ['cls', 'c'],
      description: 'Clear the console screen',
      handler: async () => {
        console.clear();
        console.log(chalk.cyan('Console cleared'));
        console.log();
      },
    });

    // Reload config command
    this.registerCommand({
      name: 'reload-config',
      aliases: ['reload'],
      description: 'Reload configuration file (requires restart for some settings)',
      handler: async () => {
        console.log();
        console.log(chalk.yellow('⚠ Config reload requires application restart'));
        console.log(chalk.gray('  Use "restart" command or "quit" then restart manually'));
        console.log();
      },
    });

    // Restart command
    this.registerCommand({
      name: 'restart',
      aliases: ['r', 'reboot'],
      description: 'Restart the monitor (stops and starts monitoring)',
      handler: async () => {
        console.log();
        console.log(chalk.yellow('🔄 Restarting monitor...'));
        console.log();
        await this.monitor.stop();
        await new Promise((resolve) => setTimeout(resolve, MONITOR_RESTART_DELAY_MS));
        await this.monitor.start();
        console.log();
        console.log(chalk.green('✓ Monitor restarted successfully'));
        console.log();
      },
    });

    // Version command
    this.registerCommand({
      name: 'version',
      aliases: ['v', 'ver'],
      description: 'Show application version',
      handler: async () => {
        console.log();
        console.log(chalk.cyan(`${APP_NAME} v${APP_VERSION}`));
        console.log(chalk.gray(APP_BUILD));
        console.log();
      },
    });

    // Check for updates command
    this.registerCommand({
      name: 'check-update',
      aliases: ['check-updates'],
      description: 'Check for application updates',
      handler: async () => {
        console.log();
        console.log(chalk.cyan('🔍 Checking for updates...'));
        console.log();
        await this.monitor.checkForUpdates();
        console.log();
      },
    });

    // Update app command
    this.registerCommand({
      name: 'update-app',
      aliases: ['upgrade'],
      description: 'Download and install the latest application update',
      handler: async () => {
        console.log();
        console.log(chalk.cyan.bold('🚀 Starting update process...'));
        console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
        console.log();

        const success = await this.monitor.performUpdate();

        if (!success) {
          console.log();
          console.log(chalk.yellow('⚠ Update failed or cancelled'));
          console.log();
        }
        // If successful, the app will restart automatically
      },
    });

    // Quit command
    this.registerCommand({
      name: 'quit',
      aliases: ['exit', 'q', 'stop'],
      description: 'Stop monitoring and exit the application',
      handler: async () => {
        console.log();
        console.log(chalk.yellow('👋 Shutting down...'));
        await this.monitor.stop();
        console.log(chalk.gray('Goodbye!'));
        console.log();
        process.exit(0);
      },
    });
  }

  /**
   * Register a command
   */
  private registerCommand(command: Command): void {
    this.commands.set(command.name, command);

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  /**
   * Start interactive command prompt with manual input handling
   */
  public start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;

    console.log();
    console.log(chalk.green('💬 Interactive command mode enabled'));
    console.log(chalk.gray('   Type "help" for available commands'));
    console.log();

    // Remove any existing listeners to prevent duplicates
    if (this.dataHandler) {
      process.stdin.removeListener('data', this.dataHandler);
    }

    // Register callback to redraw prompt after log output (including console.log)
    this.originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      this.originalConsoleLog!(...args);
      // Trigger prompt redraw after console.log
      if (this.isActive && process.stdin.isTTY) {
        this.redrawPromptAfterLog();
      }
    };

    Logger.setLogOutputCallback(() => {
      if (this.isActive && process.stdin.isTTY) {
        this.redrawPromptAfterLog();
      }
    });

    // Set stdin to raw mode to capture each keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding('utf8');

    // Handle raw input - store reference to remove later
    this.dataHandler = async (key: string) => {
      await this.handleKeypress(key);
    };
    process.stdin.on('data', this.dataHandler);

    // Show initial prompt AFTER all handlers are set up
    this.showPrompt();
  }

  /**
   * Handle individual keypress events
   */
  private async handleKeypress(key: string): Promise<void> {
    const code = key.charCodeAt(0);

    // Ctrl+C or Ctrl+D (EOF) - graceful shutdown
    if (code === 3 || code === 4) {
      console.log();
      console.log(chalk.yellow('👋 Shutting down...'));
      await this.monitor.stop();
      console.log(chalk.gray('Goodbye!'));
      console.log();
      process.exit(0);
    }

    // Handle escape sequences (arrow keys, etc.)
    if (key.startsWith('\x1b')) {
      // Arrow Up: \x1b[A
      if (key === '\x1b[A') {
        this.navigateHistory('up');
        return;
      }
      // Arrow Down: \x1b[B
      if (key === '\x1b[B') {
        this.navigateHistory('down');
        return;
      }
      // Arrow Right: \x1b[C
      if (key === '\x1b[C') {
        if (this.cursorPosition < this.currentInput.length) {
          this.cursorPosition++;
          this.redrawLine();
        }
        return;
      }
      // Arrow Left: \x1b[D
      if (key === '\x1b[D') {
        if (this.cursorPosition > 0) {
          this.cursorPosition--;
          this.redrawLine();
        }
        return;
      }
      // Home: \x1b[H or \x1b[1~
      if (key === '\x1b[H' || key === '\x1b[1~') {
        this.cursorPosition = 0;
        this.redrawLine();
        return;
      }
      // End: \x1b[F or \x1b[4~
      if (key === '\x1b[F' || key === '\x1b[4~') {
        this.cursorPosition = this.currentInput.length;
        this.redrawLine();
        return;
      }
      // Ignore other escape sequences
      return;
    }

    // Enter/Return
    if (key === '\r' || key === '\n') {
      // Prevent concurrent command execution
      if (this.isExecutingCommand) {
        return;
      }

      process.stdout.write('\n');
      const command = this.currentInput.trim();

      // Add to history if not empty and not duplicate of last command
      if (command && (this.commandHistory.length === 0 || this.commandHistory[this.commandHistory.length - 1] !== command)) {
        this.commandHistory.push(command);
      }

      this.currentInput = '';
      this.cursorPosition = 0;
      this.historyIndex = -1; // Reset history navigation

      if (command) {
        this.isExecutingCommand = true;
        try {
          await this.handleCommand(command);
        } finally {
          this.isExecutingCommand = false;
        }
      }

      this.showPrompt();
      return;
    }

    // Backspace or Delete
    if (code === 127 || code === 8) {
      if (this.currentInput.length > 0 && this.cursorPosition > 0) {
        // Remove character before cursor
        this.currentInput =
          this.currentInput.slice(0, this.cursorPosition - 1) +
          this.currentInput.slice(this.cursorPosition);
        this.cursorPosition--;
        this.redrawLine();
      }
      return;
    }

    // Ignore other control characters
    if (code < 32) {
      return;
    }

    // Regular character - insert at cursor position
    this.currentInput =
      this.currentInput.slice(0, this.cursorPosition) +
      key +
      this.currentInput.slice(this.cursorPosition);
    this.cursorPosition += key.length;
    this.redrawLine();
  }

  /**
   * Navigate command history
   */
  private navigateHistory(direction: 'up' | 'down'): void {
    if (this.commandHistory.length === 0) {
      return;
    }

    if (direction === 'up') {
      // Going back in history
      if (this.historyIndex === -1) {
        // First time pressing up - go to most recent command
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        // Go to older command
        this.historyIndex--;
      } else {
        // Already at oldest command
        return;
      }
    } else {
      // Going forward in history
      if (this.historyIndex === -1) {
        // Not in history navigation
        return;
      } else if (this.historyIndex < this.commandHistory.length - 1) {
        // Go to newer command
        this.historyIndex++;
      } else {
        // Back to current input (empty)
        this.historyIndex = -1;
        this.currentInput = '';
        this.cursorPosition = 0;
        this.redrawLine();
        return;
      }
    }

    // Set input to history command
    this.currentInput = this.commandHistory[this.historyIndex];
    this.cursorPosition = this.currentInput.length;
    this.redrawLine();
  }

  /**
   * Show the command prompt
   */
  private showPrompt(): void {
    process.stdout.write(chalk.cyan('vrc-monitor> '));
  }

  /**
   * Redraw the current input line
   */
  private redrawLine(): void {
    // Clear the current line
    process.stdout.write('\r');
    process.stdout.write('\x1b[K'); // Clear to end of line

    // Redraw prompt and current input
    this.showPrompt();
    process.stdout.write(this.currentInput);

    // Move cursor to correct position
    const offset = this.currentInput.length - this.cursorPosition;
    if (offset > 0) {
      process.stdout.write(`\x1b[${offset}D`); // Move cursor left
    }
  }

  /**
   * Redraw prompt after log output (debounced to prevent spam)
   */
  private redrawPromptAfterLog(): void {
    if (!this.isActive) {
      return;
    }

    // Clear any existing timer
    if (this.promptRedrawTimer) {
      clearTimeout(this.promptRedrawTimer);
    }

    // Debounce: only redraw after logs have stopped for 50ms
    this.promptRedrawTimer = setTimeout(() => {
      // Only redraw if we're not currently executing a command
      if (!this.isExecutingCommand) {
        // Clear the current line (which may have a partial prompt)
        process.stdout.write('\r'); // Move to beginning of line
        process.stdout.clearLine(0); // Clear entire line

        // Redraw prompt with current input
        this.showPrompt();
        process.stdout.write(this.currentInput);

        // Move cursor to correct position
        const offset = this.currentInput.length - this.cursorPosition;
        if (offset > 0) {
          process.stdout.write(`\x1b[${offset}D`); // Move cursor left
        }
      }
      this.promptRedrawTimer = null;
    }, COMMAND_PROMPT_REDRAW_DEBOUNCE_MS);
  }

  /**
   * Stop interactive command prompt
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    // Restore original console.log
    if (this.originalConsoleLog) {
      console.log = this.originalConsoleLog;
      this.originalConsoleLog = undefined;
    }

    // Clear the log output callback
    Logger.clearLogOutputCallback();

    // Clear prompt redraw timer
    if (this.promptRedrawTimer) {
      clearTimeout(this.promptRedrawTimer);
      this.promptRedrawTimer = null;
    }

    // Remove data handler to prevent memory leak
    if (this.dataHandler) {
      process.stdin.removeListener('data', this.dataHandler);
      this.dataHandler = undefined;
    }

    // Restore normal terminal mode
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    this.rl.close();
  }

  /**
   * Handle command input
   */
  private async handleCommand(input: string): Promise<void> {
    const parts = input.split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);

    const command = this.commands.get(commandName);

    if (!command) {
      console.log();
      console.log(chalk.red(`❌ Unknown command: ${commandName}`));
      console.log(chalk.gray(`   Type "help" for available commands`));
      console.log();
      return;
    }

    try {
      await command.handler(args, this.monitor);
    } catch (error) {
      console.log();
      console.log(chalk.red('❌ Command error:'), error);
      console.log();
    }
  }

  /**
   * Print help information
   */
  private printHelp(): void {
    console.log();
    console.log(chalk.white.bold('Available Commands:'));
    console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.log();

    // Get unique commands (exclude aliases)
    const uniqueCommands: Command[] = [];
    const seen = new Set<string>();

    for (const command of this.commands.values()) {
      if (!seen.has(command.name)) {
        seen.add(command.name);
        uniqueCommands.push(command);
      }
    }

    // Sort alphabetically
    uniqueCommands.sort((a, b) => a.name.localeCompare(b.name));

    for (const command of uniqueCommands) {
      const aliases = command.aliases?.join(', ') || '';
      const aliasText = aliases ? chalk.gray(` (${aliases})`) : '';

      console.log(chalk.cyan(`  ${command.name}`) + aliasText);
      console.log(chalk.gray(`    ${command.description}`));

      if (command.usage) {
        console.log(chalk.gray(`    Usage: ${command.usage}`));
      }

      console.log();
    }

    console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.log();
  }

  /**
   * Print status information
   */
  private printStatus(): void {
    const status = this.monitor.getStatus();

    console.log();
    console.log(chalk.white.bold('Monitor Status:'));
    console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.log();

    // Running status
    const runningIcon = status.running ? chalk.green('✓') : chalk.red('✗');
    const runningText = status.running ? chalk.green('Running') : chalk.red('Stopped');
    console.log(`  ${runningIcon} Status: ${runningText}`);

    // Log watcher status
    const watcherIcon = status.logWatcherActive ? chalk.green('✓') : chalk.red('✗');
    const watcherText = status.logWatcherActive ? chalk.green('Active') : chalk.red('Inactive');
    console.log(`  ${watcherIcon} Log Watcher: ${watcherText}`);

    console.log();

    // Blocklist stats
    if (status.blocklistStats) {
      this.printBlocklistStats(status.blocklistStats);
    }

    console.log(chalk.gray('═'.repeat(CONSOLE_SEPARATOR_WIDTH)));
    console.log();
  }

  /**
   * Print blocklist statistics
   */
  private printBlocklistStats(stats?: any): void {
    if (!stats) {
      const status = this.monitor.getStatus();
      stats = status.blocklistStats;
    }

    if (!stats) {
      console.log(chalk.gray('  Blocklist: Not loaded'));
      return;
    }

    console.log(chalk.white.bold('  Blocklist Statistics:'));
    console.log(chalk.gray(`    Blocked Groups: ${stats.blockedGroups || 0}`));
    console.log(chalk.gray(`    Blocked Users: ${stats.blockedUsers || 0}`));
    console.log(chalk.gray(`    Whitelisted Groups: ${stats.whitelistedGroups || 0}`));
    console.log(chalk.gray(`    Whitelisted Users: ${stats.whitelistedUsers || 0}`));
    console.log(chalk.gray(`    Keyword Patterns: ${stats.keywords || 0}`));

    if (stats.version) {
      console.log(chalk.gray(`    Version: ${stats.version}`));
    }

    if (stats.lastUpdate) {
      const lastUpdate = new Date(stats.lastUpdate);
      console.log(chalk.gray(`    Last Update: ${lastUpdate.toLocaleString()}`));
    }
  }
}
