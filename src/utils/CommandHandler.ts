import * as readline from 'readline';
import chalk from 'chalk';
import { VRChatMonitor } from '../core/VRChatMonitor';
import { APP_VERSION, APP_NAME, APP_BUILD } from '../version';

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

  constructor(monitor: VRChatMonitor) {
    this.monitor = monitor;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('vrc-monitor> '),
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
        console.log(chalk.gray('═'.repeat(61)));
        console.log();
        await this.monitor.sendTestAlert();
        console.log();
        console.log(chalk.gray('═'.repeat(61)));
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
        await new Promise((resolve) => setTimeout(resolve, 1000));
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
   * Start interactive command prompt
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

    this.rl.prompt();

    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim();

      if (trimmed) {
        await this.handleCommand(trimmed);
      }

      this.rl.prompt();
    });

    this.rl.on('close', async () => {
      console.log();
      console.log(chalk.yellow('👋 Shutting down...'));
      await this.monitor.stop();
      console.log(chalk.gray('Goodbye!'));
      console.log();
      process.exit(0);
    });
  }

  /**
   * Stop interactive command prompt
   */
  public stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
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
    console.log(chalk.gray('═'.repeat(61)));
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

    console.log(chalk.gray('═'.repeat(61)));
    console.log();
  }

  /**
   * Print status information
   */
  private printStatus(): void {
    const status = this.monitor.getStatus();

    console.log();
    console.log(chalk.white.bold('Monitor Status:'));
    console.log(chalk.gray('═'.repeat(61)));
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

    console.log(chalk.gray('═'.repeat(61)));
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
    console.log(chalk.gray(`    Blocked Groups: ${stats.blockedGroupCount || 0}`));
    console.log(chalk.gray(`    Blocked Users: ${stats.blockedUserCount || 0}`));
    console.log(chalk.gray(`    Whitelisted Groups: ${stats.whitelistedGroupCount || 0}`));
    console.log(chalk.gray(`    Whitelisted Users: ${stats.whitelistedUserCount || 0}`));
    console.log(chalk.gray(`    Keyword Patterns: ${stats.keywordCount || 0}`));

    if (stats.version) {
      console.log(chalk.gray(`    Version: ${stats.version}`));
    }

    if (stats.lastUpdate) {
      const lastUpdate = new Date(stats.lastUpdate);
      console.log(chalk.gray(`    Last Update: ${lastUpdate.toLocaleString()}`));
    }
  }
}
