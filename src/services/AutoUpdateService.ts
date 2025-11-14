import https from 'https';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';
import { APP_VERSION } from '../version';
import { centerLine, leftLine } from '../index';

interface GitHubRelease {
  tag_name: string;
  name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

export class AutoUpdateService {
  private logger: Logger;
  private readonly GITHUB_REPO = 'RWolfyo/VRChatMonitor';
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
  private updateCheckTimer: NodeJS.Timeout | null = null;
  private isUpdating: boolean = false;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Check if running as packaged executable
   */
  private isPackaged(): boolean {
    // @ts-expect-error - process.pkg is added by pkg bundler
    return !!process.pkg;
  }

  /**
   * Check for updates on startup (non-blocking notification)
   */
  public async checkOnStartup(): Promise<void> {
    if (!this.isPackaged()) {
      return;
    }

    // Check in background, don't block startup
    setTimeout(async () => {
      await this.checkForUpdates(false);
    }, 5000); // Wait 5 seconds after startup
  }

  /**
   * Stop periodic update checks
   */
  public stop(): void {
    if (this.updateCheckTimer) {
      clearInterval(this.updateCheckTimer);
      this.updateCheckTimer = null;
    }
  }

  /**
   * Check for updates from GitHub releases
   */
  public async checkForUpdates(silent: boolean = true): Promise<boolean> {
    if (!this.isPackaged()) {
      if (!silent) {
        this.logger.info('Auto-update is only available in packaged executables');
      }
      return false;
    }

    if (this.isUpdating) {
      this.logger.debug('Update already in progress');
      return false;
    }

    try {
      this.logger.debug('Checking for updates from GitHub...');

      const latestRelease = await this.fetchLatestRelease();

      if (!latestRelease) {
        this.logger.debug('No releases found on GitHub');
        return false;
      }

      const latestVersion = this.parseVersion(latestRelease.tag_name);
      const currentVersion = this.parseVersion(APP_VERSION);

      this.logger.debug('Version check', {
        current: APP_VERSION,
        latest: latestRelease.tag_name,
      });

      if (this.isNewerVersion(latestVersion, currentVersion)) {
        if (!silent) {
          this.logger.info(`🆕 Update available: ${latestRelease.tag_name} (current: ${APP_VERSION})`);
          this.logger.info('Type "update-app" to download and install the update');
        } else {
          // Startup notification with ASCII banner - matching main banner style
          const banner = `
╔═══════════════════════════════════════════════════════════╗
${centerLine('')}
${leftLine('   ███╗   ██╗███████╗██╗    ██╗    ██╗   ██╗██████╗ ██╗')}
${leftLine('   ████╗  ██║██╔════╝██║    ██║    ██║   ██║██╔══██╗██║')}
${leftLine('   ██╔██╗ ██║█████╗  ██║ █╗ ██║    ██║   ██║██████╔╝██║')}
${leftLine('   ██║╚██╗██║██╔══╝  ██║███╗██║    ██║   ██║██╔═══╝ ╚═╝')}
${leftLine('   ██║ ╚████║███████╗╚███╔███╔╝    ╚██████╔╝██║     ██╗')}
${leftLine('   ╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝      ╚═════╝ ╚═╝     ╚═╝')}
${centerLine('')}
${centerLine('U P D A T E   A V A I L A B L E')}
${centerLine('')}
${centerLine(`Latest: ${latestRelease.tag_name}  →  Current: ${APP_VERSION}`)}
${centerLine('')}
${centerLine('Type "update-app" to install')}
${centerLine('')}
╚═══════════════════════════════════════════════════════════╝
`;
          console.log(banner);
        }

        return true;
      } else {
        if (!silent) {
          this.logger.info('✓ Application is up to date');
        }
        return false;
      }
    } catch (error) {
      this.logger.error('Failed to check for updates', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Fetch latest release from GitHub API
   */
  private async fetchLatestRelease(): Promise<GitHubRelease | null> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `VRChat-Monitor/${APP_VERSION}`,
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const release = JSON.parse(data) as GitHubRelease;
              resolve(release);
            } catch (error) {
              reject(new Error('Failed to parse GitHub API response'));
            }
          } else if (res.statusCode === 404) {
            resolve(null); // No releases found
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API request timeout'));
      });

      req.end();
    });
  }

  /**
   * Parse version string to comparable array
   */
  private parseVersion(version: string): number[] {
    // Remove 'v' prefix if present
    const cleaned = version.replace(/^v/, '');
    // Split by dots and convert to numbers
    return cleaned.split('.').map(n => parseInt(n, 10) || 0);
  }

  /**
   * Compare two version arrays
   */
  private isNewerVersion(latest: number[], current: number[]): boolean {
    for (let i = 0; i < Math.max(latest.length, current.length); i++) {
      const latestPart = latest[i] || 0;
      const currentPart = current[i] || 0;

      if (latestPart > currentPart) {
        return true;
      } else if (latestPart < currentPart) {
        return false;
      }
    }
    return false;
  }

  /**
   * Download and install update (call this from update-app command)
   */
  public async performUpdate(release?: GitHubRelease): Promise<boolean> {
    // If no release provided, fetch latest
    if (!release) {
      this.logger.info('Fetching latest release...');
      const latestRelease = await this.fetchLatestRelease();
      if (!latestRelease) {
        this.logger.error('No releases found on GitHub');
        return false;
      }
      release = latestRelease;
    }
    if (this.isUpdating) {
      this.logger.warn('Update already in progress');
      return false;
    }

    this.isUpdating = true;

    try {
      this.logger.info('📦 Downloading update...');

      // Find the RELEASE ZIP asset (not source code)
      // Looking for: VRChatMonitor-vX.X.X-RELEASE-Windows-x64.zip
      const zipAsset = release.assets.find(asset =>
        asset.name.includes('RELEASE') &&
        asset.name.endsWith('.zip') &&
        !asset.name.toLowerCase().includes('source')
      );

      if (!zipAsset) {
        this.logger.error('Release assets:', release.assets.map(a => a.name));
        throw new Error('No RELEASE ZIP file found in release assets. Make sure the release was built correctly.');
      }

      this.logger.debug(`Found release asset: ${zipAsset.name}`);

      // Get executable directory
      const execDir = path.dirname(process.execPath);
      const tempDir = path.join(execDir, 'temp-update');
      const zipPath = path.join(tempDir, 'update.zip');

      // Create temp directory
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Download the ZIP file
      await this.downloadFile(zipAsset.browser_download_url, zipPath);
      this.logger.info('✓ Download complete');

      // Extract ZIP
      this.logger.info('📂 Extracting update...');
      await this.extractZip(zipPath, tempDir);
      this.logger.info('✓ Extraction complete');

      // Find the new executable in the extracted files
      const newExeName = path.basename(process.execPath);
      const newExePath = this.findExecutable(tempDir, newExeName);

      if (!newExePath) {
        throw new Error('Could not find executable in update package');
      }

      this.logger.info('🔄 Installing update...');

      // Create update script
      await this.createUpdateScript(newExePath, process.execPath, tempDir);

      this.logger.info('✅ Update ready to install');
      this.logger.info('The application will restart to complete the update...');
      this.logger.info('');

      // Wait a moment for logs to flush
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Execute update script and exit
      this.executeUpdateScript(execDir);

      return true;
    } catch (error) {
      this.logger.error('Failed to perform update', {
        error: error instanceof Error ? error.message : String(error)
      });
      this.isUpdating = false;
      return false;
    }
  }

  /**
   * Download file from URL
   */
  private async downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);

      https.get(url, {
        headers: { 'User-Agent': `VRChat-Monitor/${APP_VERSION}` },
        timeout: 120000 // 2 minutes timeout
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const location = response.headers.location;
          if (!location) {
            return reject(new Error('Redirect without location'));
          }
          file.close();
          fs.unlinkSync(dest);
          return this.downloadFile(location, dest).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`Download failed with status ${response.statusCode}`));
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (error) => {
        file.close();
        if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
        reject(error);
      });
    });
  }

  /**
   * Extract ZIP file (Windows-specific using PowerShell)
   */
  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.platform !== 'win32') {
        return reject(new Error('Auto-update only supported on Windows'));
      }

      // Use PowerShell to extract
      const ps = spawn('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${zipPath}" -DestinationPath "${destDir}" -Force`
      ]);

      let stderr = '';

      ps.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ps.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ZIP extraction failed: ${stderr}`));
        }
      });

      ps.on('error', reject);
    });
  }

  /**
   * Find executable in extracted files
   */
  private findExecutable(dir: string, exeName: string): string | null {
    const search = (currentDir: string): string | null => {
      const files = fs.readdirSync(currentDir);

      for (const file of files) {
        const fullPath = path.join(currentDir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          const found = search(fullPath);
          if (found) return found;
        } else if (file.toLowerCase() === exeName.toLowerCase()) {
          return fullPath;
        }
      }

      return null;
    };

    return search(dir);
  }

  /**
   * Create batch script to replace executable
   */
  private async createUpdateScript(
    newExePath: string,
    currentExePath: string,
    tempDir: string
  ): Promise<void> {
    const execDir = path.dirname(currentExePath);
    const scriptPath = path.join(execDir, 'update.bat');

    const script = `@echo off
echo Updating VRChat Monitor...
timeout /t 2 /nobreak > nul

REM Wait for main process to exit
:WAIT
tasklist /FI "IMAGENAME eq ${path.basename(currentExePath)}" 2>NUL | find /I /N "${path.basename(currentExePath)}">NUL
if "%ERRORLEVEL%"=="0" (
    timeout /t 1 /nobreak > nul
    goto WAIT
)

REM Backup current executable
if exist "${currentExePath}.bak" del /F /Q "${currentExePath}.bak"
move /Y "${currentExePath}" "${currentExePath}.bak"

REM Copy new executable
copy /Y "${newExePath}" "${currentExePath}"

REM Cleanup
timeout /t 1 /nobreak > nul
rmdir /S /Q "${tempDir}"

REM Restart application
start "" "${currentExePath}"

REM Delete this script
del /F /Q "%~f0"
`;

    fs.writeFileSync(scriptPath, script, 'utf-8');
  }

  /**
   * Execute update script and exit
   */
  private executeUpdateScript(execDir: string): void {
    const scriptPath = path.join(execDir, 'update.bat');

    // Start the update script detached
    spawn('cmd.exe', ['/c', scriptPath], {
      detached: true,
      stdio: 'ignore',
      cwd: execDir,
    }).unref();

    // Exit current process
    process.exit(0);
  }
}
