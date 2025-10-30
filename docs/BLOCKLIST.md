# Blocklist Management

Complete guide to managing the SQLite blocklist database.

## Overview

VRChat Monitor v2 uses SQLite for fast, indexed blocklist queries. The database contains:
- **86+ blocked VRChat groups**
- **Keyword patterns** (regex) for group/user matching
- **Whitelist groups** and **users** for trusted entities
- **Metadata** for versioning and updates

## Database Location

**Default:** `blocklist.db` in executable directory

**Can be replaced with:**
- Custom SQLite database
- Remote database via auto-update URL

## Database Schema

### blocked_users

Stores blocked VRChat user IDs (individual users).

```sql
CREATE TABLE blocked_users (
  user_id TEXT PRIMARY KEY,            -- VRChat user ID (usr_...)
  display_name TEXT,                   -- Display name (optional)
  reason TEXT,                          -- Why blocked
  severity TEXT DEFAULT 'high',        -- low | medium | high
  author TEXT,                          -- Who added (optional)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups
CREATE INDEX idx_blocked_users_id ON blocked_users(user_id);
```

**Example Rows:**
```sql
INSERT INTO blocked_users (user_id, display_name, reason, severity, author)
VALUES
  ('usr_abc123...', 'BadActor', 'Known crasher', 'high', 'admin'),
  ('usr_def456...', 'Suspicious User', 'Multiple reports', 'medium', 'moderator');
```

### blocked_groups

Stores blocked VRChat group IDs.

```sql
CREATE TABLE blocked_groups (
  group_id TEXT PRIMARY KEY,           -- VRChat group ID (grp_...)
  name TEXT,                            -- Group name (optional)
  reason TEXT,                          -- Why blocked
  severity TEXT DEFAULT 'medium',       -- low | medium | high
  author TEXT,                          -- Who added (optional)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups
CREATE INDEX idx_blocked_groups_id ON blocked_groups(group_id);
```

**Example Rows:**
```sql
INSERT INTO blocked_groups (group_id, name, reason, severity, author)
VALUES
  ('grp_abc123...', 'Crasher Group', 'Known crashers', 'high', 'admin'),
  ('grp_def456...', 'Suspicious Group', 'Multiple reports', 'medium', 'moderator');
```

### keyword_blacklist

Regex patterns for matching group names, descriptions, and user profiles.

```sql
CREATE TABLE keyword_blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,                -- Regex pattern
  reason TEXT,                          -- Why blocked
  severity TEXT,                        -- low | medium | high
  author TEXT                           -- Who added (optional)
);

-- Index for pattern searches
CREATE INDEX idx_keyword_pattern ON keyword_blacklist(pattern);
```

**Example Rows:**
```sql
INSERT INTO keyword_blacklist (pattern, reason, severity, author)
VALUES
  ('crash', 'Crasher-related keywords', 'high', 'admin'),
  ('rip(per)?', 'Ripper variants', 'high', 'admin'),
  ('\\bbot\\b', 'Bot-related names', 'medium', 'admin');
```

**Regex Notes:**
- JavaScript regex syntax
- Case-insensitive matching
- Escape special characters: `\\.`, `\\(`, `\\)`
- Word boundaries: `\\b`

### whitelist_groups

Trusted groups that bypass all checks.

```sql
CREATE TABLE whitelist_groups (
  group_id TEXT PRIMARY KEY,           -- VRChat group ID (grp_...)
  name TEXT,                            -- Group name (optional)
  reason TEXT,                          -- Why whitelisted
  author TEXT                           -- Who added (optional)
);

-- Index for fast lookups
CREATE INDEX idx_whitelist_groups_id ON whitelist_groups(group_id);
```

**Example Rows:**
```sql
INSERT INTO whitelist_groups (group_id, name, reason, author)
VALUES
  ('grp_trusted123...', 'Trusted Community', 'Verified safe', 'admin'),
  ('grp_friends456...', 'Friends Group', 'Personal friends', 'user');
```

### whitelist_users

Trusted users that bypass all checks.

```sql
CREATE TABLE whitelist_users (
  user_id TEXT PRIMARY KEY,            -- VRChat user ID (usr_...)
  name TEXT,                            -- Display name (optional)
  reason TEXT,                          -- Why whitelisted
  author TEXT                           -- Who added (optional)
);

-- Index for fast lookups
CREATE INDEX idx_whitelist_users_id ON whitelist_users(user_id);
```

**Example Rows:**
```sql
INSERT INTO whitelist_users (user_id, name, reason, author)
VALUES
  ('usr_trusted789...', 'TrustedFriend', 'Close friend', 'user'),
  ('usr_verified012...', 'VerifiedUser', 'Known good user', 'admin');
```

### metadata

Stores database version and update information.

```sql
CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

**Standard Keys:**
```sql
INSERT INTO metadata (key, value) VALUES
  ('version', '2.0.0'),               -- Database schema version
  ('appVersion', '2.0.0'),            -- Compatible app version
  ('lastUpdate', '2025-10-31T12:00:00Z'),
  ('source', 'https://example.com/blocklist.db'),
  ('author', 'admin'),
  ('description', 'Community blocklist');
```

## Checking Logic

When a player joins, the monitor performs these checks **in order**:

### 1. User Whitelist Check

```sql
SELECT * FROM whitelist_users WHERE user_id = ?;
```

If found → **Skip all checks** (trusted user)

### 2. User Blocklist Check

```sql
SELECT * FROM blocked_users WHERE user_id = ?;
```

If found → **Match!** Alert user (but continue checking for additional context)

### 3. Fetch User's Groups

Via VRChat API: `GET /users/{userId}/groups`

Returns array of group IDs user is a member of.

### 4. Group Checks (for each group)

#### a. Group Whitelist Check

```sql
SELECT * FROM whitelist_groups WHERE group_id = ?;
```

If found → **Skip this group** (trusted)

#### b. Blocked Group Check

```sql
SELECT * FROM blocked_groups WHERE group_id = ?;
```

If found → **Match!** Alert user

#### c. Group Keyword Check

```sql
SELECT * FROM keyword_blacklist;
```

For each pattern:
- Compile regex
- Match against group name and description
- If matches → **Match!** Alert user

### 5. User Profile Check

Fetch user profile via API: `GET /users/{userId}`

```sql
SELECT * FROM keyword_blacklist;
```

For each pattern:
- Match against displayName
- Match against bio/statusDescription
- If matches → **Match!** Alert user

### 6. Send Alerts

If any matches found:
- Desktop notification
- Discord webhook
- Audio alert
- VR overlay (VRCX/XSOverlay)

## Managing the Database

### Method 1: SQLite Command Line

```bash
# Open database
sqlite3 blocklist.db

# View schema
.schema

# View all blocked groups
SELECT * FROM blocked_groups;

# Add blocked group
INSERT INTO blocked_groups (group_id, name, reason, severity)
VALUES ('grp_example123', 'Bad Group', 'Crashers', 'high');

# Add blocked user
INSERT INTO blocked_users (user_id, display_name, reason, severity)
VALUES ('usr_example456', 'BadActor', 'Known crasher', 'high');

# Add keyword pattern
INSERT INTO keyword_blacklist (pattern, reason, severity)
VALUES ('malicious', 'Malicious keyword', 'high');

# Add whitelist group
INSERT INTO whitelist_groups (group_id, name, reason)
VALUES ('grp_safe456', 'Safe Group', 'Verified safe');

# Remove blocked group
DELETE FROM blocked_groups WHERE group_id = 'grp_example123';

# Remove blocked user
DELETE FROM blocked_users WHERE user_id = 'usr_example456';

# Update severity
UPDATE blocked_groups
SET severity = 'high'
WHERE group_id = 'grp_example123';

# Exit
.quit
```

### Method 2: DB Browser for SQLite

**Recommended GUI tool:** https://sqlitebrowser.org/

1. Download and install DB Browser
2. Open `blocklist.db`
3. Use "Browse Data" tab to view/edit rows
4. Use "Execute SQL" tab for queries
5. Click "Write Changes" to save

**Advantages:**
- Visual interface
- Easy sorting/filtering
- No SQL knowledge required
- Export/import CSV

### Method 3: DBeaver

**Universal database tool:** https://dbeaver.io/

1. Download and install DBeaver
2. Create new connection (SQLite)
3. Select `blocklist.db`
4. Use SQL editor or data editor
5. Commit changes

### Method 4: Python Script

```python
import sqlite3

# Connect to database
conn = sqlite3.connect('blocklist.db')
cursor = conn.cursor()

# Add blocked group
cursor.execute('''
INSERT INTO blocked_groups (group_id, name, reason, severity)
VALUES (?, ?, ?, ?)
''', ('grp_example123', 'Bad Group', 'Crashers', 'high'))

# Add keyword
cursor.execute('''
INSERT INTO keyword_blacklist (pattern, reason, severity)
VALUES (?, ?, ?)
''', ('malicious', 'Malicious keyword', 'high'))

# Commit and close
conn.commit()
conn.close()
```

## Common Queries

### View Statistics

```sql
-- Count blocked groups by severity
SELECT severity, COUNT(*) as count
FROM blocked_groups
GROUP BY severity;

-- Count blocked users by severity
SELECT severity, COUNT(*) as count
FROM blocked_users
GROUP BY severity;

-- Count keywords
SELECT COUNT(*) as keyword_count FROM keyword_blacklist;

-- Count whitelist entries
SELECT COUNT(*) as whitelist_groups FROM whitelist_groups;
SELECT COUNT(*) as whitelist_users FROM whitelist_users;
```

### Find Groups

```sql
-- Search by name
SELECT * FROM blocked_groups WHERE name LIKE '%crasher%';

-- Search by severity
SELECT * FROM blocked_groups WHERE severity = 'high';

-- Recent additions (last 7 days)
SELECT * FROM blocked_groups
WHERE created_at > datetime('now', '-7 days')
ORDER BY created_at DESC;
```

### Bulk Operations

```sql
-- Import from CSV
.mode csv
.import groups.csv blocked_groups

-- Export to CSV
.mode csv
.output blocked_groups.csv
SELECT * FROM blocked_groups;
.output stdout

-- Bulk severity update
UPDATE blocked_groups
SET severity = 'high'
WHERE name LIKE '%crash%';

-- Bulk delete
DELETE FROM blocked_groups
WHERE severity = 'low' AND created_at < datetime('now', '-30 days');
```

## Creating Custom Blocklist

### From Scratch

```bash
# Create new database
sqlite3 custom-blocklist.db

# Create schema
.read schema.sql

# Add entries
INSERT INTO blocked_groups (group_id, name, reason, severity)
VALUES ('grp_...', 'Group Name', 'Reason', 'high');

# Add metadata
INSERT INTO metadata (key, value)
VALUES ('version', '1.0.0'), ('author', 'YourName');

# Exit
.quit
```

### Schema Template

Save as `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS blocked_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT,
  reason TEXT,
  severity TEXT DEFAULT 'medium',
  author TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_blocked_groups_id ON blocked_groups(group_id);

CREATE TABLE IF NOT EXISTS keyword_blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  reason TEXT,
  severity TEXT,
  author TEXT
);

CREATE INDEX IF NOT EXISTS idx_keyword_pattern ON keyword_blacklist(pattern);

CREATE TABLE IF NOT EXISTS whitelist_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT,
  reason TEXT,
  author TEXT
);

CREATE INDEX IF NOT EXISTS idx_whitelist_groups_id ON whitelist_groups(group_id);

CREATE TABLE IF NOT EXISTS whitelist_users (
  user_id TEXT PRIMARY KEY,
  name TEXT,
  reason TEXT,
  author TEXT
);

CREATE INDEX IF NOT EXISTS idx_whitelist_users_id ON whitelist_users(user_id);

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## Migrating from JSONC

If you have the old `blockedGroups.jsonc` format:

```bash
node scripts/convert-jsonc-to-sqlite.js
```

**Script behavior:**
- Reads `blockedGroups.jsonc`
- Creates `blocklist.db`
- Converts all sections:
  - `blockedGroups` → `blocked_groups`
  - `keywordBlacklist` → `keyword_blacklist`
  - `whitelistGroupIds` → `whitelist_groups`
  - `whitelistUserIds` → `whitelist_users`
- Preserves metadata (severity, reason, author)

## Auto-Update System

### Configure Remote URL

```json
{
  "blocklist": {
    "autoUpdate": true,
    "remoteUrl": "https://example.com/blocklist.db",
    "updateInterval": 60
  }
}
```

### How It Works

1. **Periodic Check** - Every N minutes
2. **Download** - Fetch remote SQLite database
3. **Validate** - Check SQLite magic header (`53 51 4C 69 74 65`)
4. **Compare** - File hash comparison (SHA256)
5. **Replace** - If different, replace local copy
6. **Reload** - Recompile regex patterns
7. **Notify** - Version mismatch notification (if app version differs)

### Hosting Blocklist

**Static Hosting:**
- GitHub Pages
- Cloudflare Pages
- AWS S3 + CloudFront
- Any static file host

**Requirements:**
- HTTPS recommended (not required)
- CORS enabled (for web access)
- Direct file download (not HTML page)

**Example GitHub Setup:**

1. Create repo: `vrchat-blocklist`
2. Add `blocklist.db`
3. Enable GitHub Pages (main branch, root)
4. URL: `https://username.github.io/vrchat-blocklist/blocklist.db`

### Version Mismatch Handling

If remote database has different `appVersion` in metadata:

```sql
SELECT value FROM metadata WHERE key = 'appVersion';
```

The monitor sends notifications:
- Desktop: "Update available: v2.1.0 (current: v2.0.0)"
- Discord: Rich embed with version details

**Does NOT:**
- Stop monitoring
- Refuse to load blocklist
- Auto-update application

## Best Practices

### Severity Levels

Use consistent severity classification:

- **High:** Immediate threat (crashers, malicious)
- **Medium:** Suspicious but unconfirmed
- **Low:** Minor concerns, monitoring only

### Reason Field

Always provide clear reasons:

```sql
-- ✅ Good
reason = 'Known crasher group - 10+ confirmed reports'

-- ❌ Bad
reason = 'bad'
```

### Regex Patterns

**Test patterns before adding:**

```javascript
// JavaScript console
const pattern = /crash/i;
pattern.test('Crasher Group'); // true
```

**Common patterns:**
```sql
-- Exact word
'\\bcrash\\b'                    -- Matches "crash" but not "crashed"

-- Case variations
'rip(per)?'                      -- Matches "rip", "ripper"

-- Multiple words
'(crash|ripper|malicious)'       -- Matches any of these

-- Wildcards
'bot.*client'                    -- Matches "bot client", "bot_client", etc.
```

### Whitelist Trusted Groups

Prevent false positives:

```sql
-- Add well-known safe groups
INSERT INTO whitelist_groups (group_id, name, reason)
VALUES
  ('grp_trusted...', 'VRChat Official', 'Official group'),
  ('grp_friends...', 'My Friends', 'Personal friends');
```

### Regular Maintenance

- **Review severity levels** - Upgrade/downgrade as needed
- **Remove old entries** - Groups that no longer exist
- **Update reasons** - Add new information
- **Test patterns** - Ensure regex still works

### Backup Database

```bash
# Create backup
copy blocklist.db blocklist.backup.db

# Or use SQLite backup command
sqlite3 blocklist.db ".backup blocklist.backup.db"
```

## Performance Considerations

### Database Size

Current: 86 groups, 15 keywords

**Recommendations for optimal performance:**
- Keep database compact (faster loading)
- Limit excessive keyword patterns
- Use specific patterns over broad wildcards

### Query Performance

**Fast:**
- Group ID lookups (indexed)
- User ID lookups (indexed)

**Slower:**
- Keyword regex matching (must scan all patterns)

**Optimization:**
- Limit keyword patterns (<100 recommended)
- Use specific patterns (avoid `.*`)
- Pre-compile regex at startup (done automatically)

### Memory Usage

- **Database:** Loaded entirely into memory (fast access)
- **Regex patterns:** Pre-compiled and cached
- **Overhead:** Minimal for typical blocklists

## Troubleshooting

### "Database file is corrupted"

```bash
# Check integrity
sqlite3 blocklist.db "PRAGMA integrity_check;"

# Should output: ok

# If corrupted, restore from backup
copy blocklist.backup.db blocklist.db
```

### "Table does not exist"

```bash
# Check schema
sqlite3 blocklist.db ".schema"

# Recreate tables
sqlite3 blocklist.db < schema.sql
```

### "Pattern not matching"

```bash
# Test regex in JavaScript
node -e "console.log(/your-pattern/i.test('Test String'))"

# Check for escaping issues
# SQLite: 'crash'
# JavaScript: /crash/i

# Escape special characters
# SQLite: '\\bword\\b'
# JavaScript: /\bword\b/i
```

### Auto-update not working

Enable debug logging:

```json
{
  "logging": {
    "level": "debug",
    "file": true
  }
}
```

Check `.cache/debug.log` for:
- "Updating blocklist from {url}"
- HTTP errors
- "Blocklist update successful"

## Next Steps

- **[Configuration Reference](CONFIGURATION.md)** - Configure auto-updates
- **[Setup Guide](SETUP.md)** - Initial blocklist setup
- **[Troubleshooting](TROUBLESHOOTING.md)** - Fix blocklist issues
