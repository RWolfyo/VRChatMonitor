import fs from 'fs';
import path from 'path';
import { Logger } from './Logger';

export class PathResolver {
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Get the directory where the executable is located
   * Handles both pkg and normal Node.js execution
   */
  public getExecutableDir(): string {
    // @ts-expect-error - process.pkg is added by pkg bundler
    if (process.pkg) {
      return path.dirname(process.execPath);
    }
    return process.cwd();
  }

  /**
   * Detect VRChat log directory based on platform
   */
  public detectVRChatLogDir(overridePath?: string): string | null {
    if (overridePath) {
      if (fs.existsSync(overridePath) && fs.lstatSync(overridePath).isDirectory()) {
        this.logger.info(`Using override VRChat log path: ${overridePath}`);
        return overridePath;
      }
      this.logger.warn(`Override log path does not exist or is not a directory: ${overridePath}`);
    }

    const candidates: string[] = [];

    if (process.platform === 'win32') {
      // Windows paths
      const userProfile = process.env.USERPROFILE;
      if (userProfile) {
        candidates.push(
          path.join(userProfile, 'AppData', 'LocalLow', 'VRChat', 'VRChat')
        );
      }
    } else if (process.platform === 'linux') {
      // Linux paths (Proton/Wine)
      const home = process.env.HOME;
      if (home) {
        candidates.push(
          path.join(home, '.config', 'unity3d', 'VRChat', 'VRChat'),
          path.join(home, '.config', 'VRChat', 'VRChat'),
          path.join(home, '.local', 'share', 'VRChat', 'VRChat'),
          // Steam Proton paths
          path.join(home, '.steam', 'steam', 'steamapps', 'compatdata', '438100', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'LocalLow', 'VRChat', 'VRChat'),
        );
      }
    } else if (process.platform === 'darwin') {
      // macOS paths
      const home = process.env.HOME;
      if (home) {
        candidates.push(
          path.join(home, 'Library', 'Application Support', 'VRChat', 'VRChat')
        );
      }
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.lstatSync(candidate).isDirectory()) {
          this.logger.info(`Detected VRChat log directory: ${candidate}`);
          return candidate;
        }
      } catch (error) {
        this.logger.debug(`Failed to check candidate path: ${candidate}`, { error });
      }
    }

    this.logger.error('Could not detect VRChat log directory');
    return null;
  }

  /**
   * Find a file in multiple candidate locations
   */
  public findFile(filename: string, searchDirs?: string[]): string | null {
    const exeDir = this.getExecutableDir();

    const candidates = [
      // Executable directory
      path.join(exeDir, filename),
      // Current working directory
      path.join(process.cwd(), filename),
      // Build directory
      path.join(process.cwd(), 'build', filename),
      // Config directory
      path.join(process.cwd(), 'config', filename),
      // Assets directory
      path.join(process.cwd(), 'assets', filename),
      // Additional search directories
      ...(searchDirs || []).map(dir => path.join(dir, filename)),
    ];

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          this.logger.debug(`Found file: ${filename} at ${candidate}`);
          return candidate;
        }
      } catch (error) {
        this.logger.debug(`Failed to check candidate path: ${candidate}`, { error });
      }
    }

    this.logger.debug(`File not found: ${filename}`);
    return null;
  }

  /**
   * Find vendor binary (ffplay, SnoreToast, etc.)
   */
  public findVendorBinary(binaryName: string): string | null {
    const exeDir = this.getExecutableDir();

    const extensions = process.platform === 'win32' ? ['.exe', ''] : ['', '.exe'];
    const candidates: string[] = [];

    for (const ext of extensions) {
      const filename = binaryName + ext;
      candidates.push(
        path.join(exeDir, 'vendor', filename),
        path.join(process.cwd(), 'vendor', filename),
        path.join(process.cwd(), 'build', 'vendor', filename),
      );
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          this.logger.debug(`Found vendor binary: ${binaryName} at ${candidate}`);
          return candidate;
        }
      } catch (error) {
        this.logger.debug(`Failed to check vendor binary path: ${candidate}`, { error });
      }
    }

    this.logger.debug(`Vendor binary not found: ${binaryName}`);
    return null;
  }

  /**
   * Get cache directory
   */
  public getCacheDir(overrideDir?: string): string {
    if (overrideDir) {
      if (!fs.existsSync(overrideDir)) {
        fs.mkdirSync(overrideDir, { recursive: true });
      }
      return overrideDir;
    }

    const exeDir = this.getExecutableDir();
    const cacheDir = path.join(exeDir, '.cache');

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    return cacheDir;
  }
}
