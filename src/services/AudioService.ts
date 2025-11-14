import { execFile } from 'child_process';
import fs from 'fs';
import { Logger } from '../utils/Logger';
import { PathResolver } from '../utils/PathResolver';
import { AUDIO_PLAYBACK_TIMEOUT_MS } from '../constants';

export class AudioService {
  private logger: Logger;
  private pathResolver: PathResolver;
  private ffplayPath: string | null = null;
  private alertSoundPath: string | null = null;
  private volume: number;
  private isPlaying: boolean = false;

  constructor(volume: number = 0.5, customSoundPath?: string) {
    this.logger = Logger.getInstance();
    this.pathResolver = new PathResolver();
    this.volume = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1

    // Find ffplay binary
    this.ffplayPath = this.pathResolver.findVendorBinary('ffplay');
    if (this.ffplayPath) {
      this.logger.info(`ffplay found at: ${this.ffplayPath}`);
    } else {
      this.logger.warn('ffplay not found - audio alerts will be disabled');
    }

    // Find alert sound
    if (customSoundPath && fs.existsSync(customSoundPath)) {
      this.alertSoundPath = customSoundPath;
    } else {
      this.alertSoundPath = this.pathResolver.findFile('alert.mp3');
    }

    if (this.alertSoundPath) {
      this.logger.info(`Alert sound found at: ${this.alertSoundPath}`);
    } else {
      this.logger.warn('alert.mp3 not found - audio alerts will be disabled');
    }
  }

  /**
   * Play alert sound
   */
  public async playAlert(): Promise<void> {
    if (!this.ffplayPath) {
      this.logger.debug('Cannot play alert: ffplay not available');
      return;
    }

    if (!this.alertSoundPath) {
      this.logger.debug('Cannot play alert: alert sound file not available');
      return;
    }

    if (this.isPlaying) {
      this.logger.debug('Alert already playing, skipping');
      return;
    }

    try {
      this.isPlaying = true;
      await this.playSound(this.alertSoundPath);
    } catch (error) {
      this.logger.error('Failed to play alert sound', { error });
    } finally {
      this.isPlaying = false;
    }
  }

  /**
   * Play a sound file using ffplay
   */
  private playSound(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ffplayPath) {
        reject(new Error('ffplay not available'));
        return;
      }

      const args = [
        '-nodisp', // No video display
        '-autoexit', // Exit when playback finishes
        '-loglevel', 'quiet', // Suppress ffplay output
        '-af', `volume=${this.volume}`, // Set volume
        filePath,
      ];

      this.logger.debug('Playing sound with ffplay', { filePath, volume: this.volume });

      const child = execFile(
        this.ffplayPath,
        args,
        {
          windowsHide: true, // Hide console window on Windows
        },
        (error, _stdout, stderr) => {
          if (error) {
            this.logger.error('ffplay error', { error, stderr });
            reject(error);
          } else {
            this.logger.debug('Sound playback completed');
            resolve();
          }
        }
      );

      // Set timeout to kill ffplay if it takes too long (shouldn't happen with autoexit)
      const timeout = setTimeout(() => {
        if (child && !child.killed) {
          this.logger.warn('ffplay timeout, killing process');
          child.kill();
          reject(new Error('Sound playback timeout'));
        }
      }, AUDIO_PLAYBACK_TIMEOUT_MS);

      child.on('exit', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.logger.debug(`Volume set to: ${this.volume}`);
  }

  /**
   * Get current volume
   */
  public getVolume(): number {
    return this.volume;
  }

  /**
   * Check if audio is available
   */
  public isAvailable(): boolean {
    return !!(this.ffplayPath && this.alertSoundPath);
  }

  /**
   * Test audio playback
   */
  public async testAudio(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.logger.warn('Cannot test audio: ffplay or alert sound not available');
      return false;
    }

    try {
      await this.playAlert();
      return true;
    } catch (error) {
      this.logger.error('Audio test failed', { error });
      return false;
    }
  }
}
