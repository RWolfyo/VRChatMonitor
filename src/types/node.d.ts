/**
 * Type declarations for Node.js extensions
 */

declare namespace NodeJS {
  interface Process {
    /**
     * Checks if the current process is running as a Single Executable Application (SEA)
     * Available in Node.js 20+ (experimental) and Node.js 22+ (stable)
     * @returns true if running as SEA, false otherwise
     */
    isSea?(): boolean;
  }
}
