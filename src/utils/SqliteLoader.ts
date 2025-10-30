import path from 'path';
import { createRequire } from 'module';

/**
 * Load better-sqlite3 with proper native module resolution
 * Handles both development and SEA (Single Executable Application) environments
 */
export function loadBetterSqlite3() {
  // Detect if running as SEA or regular Node.js
  // @ts-expect-error - process.pkg is added by SEA or pkg
  const isSEA = typeof process.pkg !== 'undefined' || process.argv[0].endsWith('.exe');

  if (!isSEA) {
    // Development mode - use normal require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('better-sqlite3');
  }

  // Running as SEA executable
  // better-sqlite3 is in lib/ folder alongside the executable
  const execDir = path.dirname(process.execPath);
  const libPath = path.join(execDir, 'lib');

  // Use the actual better-sqlite3 entry point as the context for createRequire
  // This allows it to resolve 'bindings' and other dependencies from lib/
  const sqliteEntryPoint = path.join(libPath, 'better-sqlite3', 'lib', 'index.js');
  const requireFromLib = createRequire(sqliteEntryPoint);

  // Load better-sqlite3 using its main entry point
  const sqliteMainPath = path.join(libPath, 'better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return requireFromLib(sqliteMainPath);
}
