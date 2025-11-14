/**
 * Error handling utilities for consistent error logging
 */

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Extract error stack trace from unknown error type
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }
  return undefined;
}

/**
 * Create a safe error object for logging (no sensitive data)
 */
export function createErrorContext(error: unknown, additionalContext?: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {
    error: getErrorMessage(error),
    errorType: error instanceof Error ? error.constructor.name : typeof error,
    ...additionalContext,
  };

  // Include stack trace in debug/development mode
  if (process.env.DEBUG || process.env.LOG_LEVEL === 'debug') {
    const stack = getErrorStack(error);
    if (stack) {
      context.stack = stack;
    }
  }

  return context;
}

/**
 * Sanitize sensitive data from strings (for crash logs)
 */
export function sanitizeSensitiveData(text: string): string {
  let sanitized = text;

  // Remove auth tokens and API keys
  sanitized = sanitized.replace(/auth[a-z]*[=:]\s*["']?([a-zA-Z0-9_\-\.]+)["']?/gi, 'auth=$REDACTED');
  sanitized = sanitized.replace(/token[=:]\s*["']?([a-zA-Z0-9_\-\.]+)["']?/gi, 'token=$REDACTED');
  sanitized = sanitized.replace(/api[-_]?key[=:]\s*["']?([a-zA-Z0-9_\-\.]+)["']?/gi, 'apiKey=$REDACTED');
  sanitized = sanitized.replace(/bearer\s+([a-zA-Z0-9_\-\.]+)/gi, 'Bearer $REDACTED');

  // Remove cookie values
  sanitized = sanitized.replace(/Cookie:\s*([^\n]+)/gi, 'Cookie: $REDACTED');
  sanitized = sanitized.replace(/Set-Cookie:\s*([^\n]+)/gi, 'Set-Cookie: $REDACTED');

  // Remove passwords
  sanitized = sanitized.replace(/password[=:]\s*["']?([^"',\s}]+)["']?/gi, 'password=$REDACTED');
  sanitized = sanitized.replace(/"password":\s*"([^"]+)"/gi, '"password":"$REDACTED"');

  // Remove Discord webhook URLs
  sanitized = sanitized.replace(/https:\/\/discord\.com\/api\/webhooks\/[\d]+\/[\w-]+/gi, 'https://discord.com/api/webhooks/$REDACTED');

  // Remove IP addresses (private and public)
  sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '$IP_REDACTED');

  // Remove email addresses
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '$EMAIL_REDACTED');

  return sanitized;
}

/**
 * Sanitize log buffer entries
 */
export function sanitizeLogBuffer(logs: string[]): string[] {
  return logs.map(log => sanitizeSensitiveData(log));
}
