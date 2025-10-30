#!/usr/bin/env node

/**
 * Convert blockedGroups.jsonc to SQLite database
 * This script reads the JSONC file and creates a SQLite database with the same data
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Simple JSONC parser (removes comments and trailing commas)
function parseJSONC(content) {
  // Remove single-line comments
  content = content.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove trailing commas
  content = content.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(content);
}

function convertToSQLite() {
  console.log('🔄 Converting blockedGroups.jsonc to SQLite database...\n');

  // Read JSONC file
  const jsoncPath = path.join(__dirname, '../config/blockedGroups.jsonc');
  const jsoncContent = fs.readFileSync(jsoncPath, 'utf8');
  const data = parseJSONC(jsoncContent);

  // Create SQLite database
  const dbPath = path.join(__dirname, '../config/blocklist.db');
  const db = new Database(dbPath);

  // Create tables
  console.log('📋 Creating database schema...');

  db.exec(`
    -- App metadata
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Blocked groups
    CREATE TABLE IF NOT EXISTS blocked_groups (
      group_id TEXT PRIMARY KEY,
      name TEXT,
      reason TEXT,
      severity TEXT DEFAULT 'medium',
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Blocked users
    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id TEXT PRIMARY KEY,
      display_name TEXT,
      reason TEXT,
      severity TEXT DEFAULT 'high',
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Keyword blacklist patterns
    CREATE TABLE IF NOT EXISTS keyword_blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      reason TEXT,
      severity TEXT DEFAULT 'medium',
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Whitelist groups
    CREATE TABLE IF NOT EXISTS whitelist_groups (
      group_id TEXT PRIMARY KEY,
      name TEXT,
      reason TEXT,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Whitelist users
    CREATE TABLE IF NOT EXISTS whitelist_users (
      user_id TEXT PRIMARY KEY,
      name TEXT,
      reason TEXT,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for faster lookups
    CREATE INDEX IF NOT EXISTS idx_blocked_groups_name ON blocked_groups(name);
    CREATE INDEX IF NOT EXISTS idx_keyword_pattern ON keyword_blacklist(pattern);
  `);

  // Insert metadata
  console.log('📝 Inserting metadata...');
  const insertMetadata = db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
  insertMetadata.run('appVersion', data.appVersion || '2.0.0');
  insertMetadata.run('lastUpdated', new Date().toISOString());

  // Insert blocked groups
  console.log('🚫 Inserting blocked groups...');
  const insertBlockedGroup = db.prepare(`
    INSERT OR REPLACE INTO blocked_groups (group_id, name, reason, severity, author)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((groups) => {
    for (const group of groups) {
      if (typeof group === 'string') {
        insertBlockedGroup.run(group, null, null, 'medium', null);
      } else {
        insertBlockedGroup.run(
          group.groupId,
          group.name || null,
          group.reason || null,
          group.severity || 'medium',
          group.author || null
        );
      }
    }
  });

  insertMany(data.blockedGroups || []);
  console.log(`  ✓ Inserted ${data.blockedGroups?.length || 0} blocked groups`);

  // Insert blocked users
  console.log('🚫 Inserting blocked users...');
  const insertBlockedUser = db.prepare(`
    INSERT OR REPLACE INTO blocked_users (user_id, display_name, reason, severity, author)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const user of data.blockedUsers || []) {
    if (typeof user === 'string') {
      insertBlockedUser.run(user, null, null, 'high', null);
    } else {
      insertBlockedUser.run(
        user.userId,
        user.displayName || null,
        user.reason || null,
        user.severity || 'high',
        user.author || null
      );
    }
  }
  console.log(`  ✓ Inserted ${data.blockedUsers?.length || 0} blocked users`);

  // Insert keyword blacklist
  console.log('🔍 Inserting keyword patterns...');
  const insertKeyword = db.prepare(`
    INSERT OR REPLACE INTO keyword_blacklist (pattern, reason, severity, author)
    VALUES (?, ?, ?, ?)
  `);

  for (const keyword of data.keywordBlacklist || []) {
    if (typeof keyword === 'string') {
      insertKeyword.run(keyword, null, 'medium', null);
    } else {
      insertKeyword.run(
        keyword.pattern,
        keyword.reason || null,
        keyword.severity || 'medium',
        keyword.author || null
      );
    }
  }
  console.log(`  ✓ Inserted ${data.keywordBlacklist?.length || 0} keyword patterns`);

  // Insert whitelist groups
  console.log('✅ Inserting whitelist groups...');
  const insertWhitelistGroup = db.prepare(`
    INSERT OR REPLACE INTO whitelist_groups (group_id, name, reason, author)
    VALUES (?, ?, ?, ?)
  `);

  for (const group of data.whitelistGroupIds || []) {
    if (typeof group === 'string') {
      insertWhitelistGroup.run(group, null, null, null);
    } else {
      insertWhitelistGroup.run(
        group.groupId,
        group.name || null,
        group.reason || null,
        group.author || null
      );
    }
  }
  console.log(`  ✓ Inserted ${data.whitelistGroupIds?.length || 0} whitelist groups`);

  // Insert whitelist users
  console.log('👤 Inserting whitelist users...');
  const insertWhitelistUser = db.prepare(`
    INSERT OR REPLACE INTO whitelist_users (user_id, name, reason, author)
    VALUES (?, ?, ?, ?)
  `);

  for (const user of data.whitelistUserIds || []) {
    if (typeof user === 'string') {
      insertWhitelistUser.run(user, null, null, null);
    } else {
      insertWhitelistUser.run(
        user.userId,
        user.name || null,
        user.reason || null,
        user.author || null
      );
    }
  }
  console.log(`  ✓ Inserted ${data.whitelistUserIds?.length || 0} whitelist users`);

  // Print statistics
  console.log('\n📊 Database Statistics:');
  const stats = {
    blockedGroups: db.prepare('SELECT COUNT(*) as count FROM blocked_groups').get().count,
    blockedUsers: db.prepare('SELECT COUNT(*) as count FROM blocked_users').get().count,
    keywordPatterns: db.prepare('SELECT COUNT(*) as count FROM keyword_blacklist').get().count,
    whitelistGroups: db.prepare('SELECT COUNT(*) as count FROM whitelist_groups').get().count,
    whitelistUsers: db.prepare('SELECT COUNT(*) as count FROM whitelist_users').get().count,
  };

  console.log(`  Blocked Groups: ${stats.blockedGroups}`);
  console.log(`  Blocked Users: ${stats.blockedUsers}`);
  console.log(`  Keyword Patterns: ${stats.keywordPatterns}`);
  console.log(`  Whitelist Groups: ${stats.whitelistGroups}`);
  console.log(`  Whitelist Users: ${stats.whitelistUsers}`);

  const dbSize = fs.statSync(dbPath).size;
  console.log(`  Database Size: ${(dbSize / 1024).toFixed(2)} KB`);

  db.close();
  console.log(`\n✅ Conversion complete! Database saved to: ${dbPath}`);
}

// Run conversion
try {
  convertToSQLite();
} catch (error) {
  console.error('❌ Conversion failed:', error.message);
  process.exit(1);
}
