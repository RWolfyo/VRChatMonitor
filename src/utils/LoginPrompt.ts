import readline from 'readline';

export interface LoginCredentials {
  username: string;
  password: string;
  twoFactorCode?: string;
}

export class LoginPrompt {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  /**
   * Prompt for username
   */
  private async promptUsername(defaultUsername?: string): Promise<string> {
    const prompt = defaultUsername
      ? `VRChat Username [${defaultUsername}]: `
      : 'VRChat Username: ';

    const username = await this.question(prompt);
    return username.trim() || defaultUsername || '';
  }

  /**
   * Prompt for password (plain text - will be saved to config anyway)
   */
  private async promptPassword(): Promise<string> {
    const password = await this.question('VRChat Password: ');
    return password.trim();
  }

  /**
   * Prompt for 2FA code
   */
  private async prompt2FA(method: '2FA' | 'TOTP' | 'OTP' | 'Email'): Promise<string> {
    const methodName = method === '2FA' ? 'Two-Factor Authentication' : method;
    const code = await this.question(`${methodName} Code: `);
    return code.trim();
  }

  /**
   * Perform interactive login flow
   */
  public async promptLogin(
    defaultUsername?: string,
    defaultPassword?: string
  ): Promise<LoginCredentials> {
    console.log();
    console.log('═'.repeat(61));
    console.log('VRChat Authentication');
    console.log('═'.repeat(61));
    console.log();

    // Get username - use saved if available, otherwise prompt
    let username = defaultUsername;
    if (!username) {
      username = await this.promptUsername();
    } else {
      console.log(`VRChat Username: ${username}`);
    }

    if (!username) {
      throw new Error('Username is required');
    }

    // Get password - use saved if available, otherwise prompt
    let password = defaultPassword;
    if (!password) {
      password = await this.promptPassword();
    } else {
      console.log('VRChat Password: ' + '*'.repeat(password.length));
    }

    if (!password) {
      throw new Error('Password is required');
    }

    console.log();

    return {
      username,
      password,
    };
  }

  /**
   * Prompt for 2FA when required
   */
  public async prompt2FACode(methods: string[]): Promise<string> {
    console.log();
    console.log('Two-Factor Authentication Required');
    console.log('─'.repeat(61));

    let methodName = '2FA';
    if (methods.includes('totp')) {
      methodName = 'TOTP';
      console.log('Please enter your authenticator app code (TOTP)');
    } else if (methods.includes('emailOtp')) {
      methodName = 'Email';
      console.log('Please check your email for the verification code');
    } else if (methods.includes('otp')) {
      methodName = 'OTP';
      console.log('Please enter your recovery code (OTP)');
    }

    console.log();

    const code = await this.prompt2FA(methodName as any);

    if (!code) {
      throw new Error('2FA code is required');
    }

    return code;
  }

  /**
   * Ask a question and return the answer
   */
  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
    });
  }

  /**
   * Close the readline interface
   */
  public close(): void {
    this.rl.close();
  }
}
