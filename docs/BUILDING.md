# Building from Source

Developer guide for building VRChat Monitor v2 from source.

## Prerequisites

### Required

- **Node.js 22+** (or Node.js 24 LTS recommended)
  - Download: https://nodejs.org/
  - Verify: `node --version` (should be v22.0.0 or higher)
- **npm** (included with Node.js)
  - Verify: `npm --version`
- **Python 3.x** (for FFmpeg extraction during build)
  - Download: https://www.python.org/downloads/
  - Verify: `python --version`
- **Git** (for cloning repository)
  - Download: https://git-scm.com/
  - Verify: `git --version`

### Platform-Specific

**Windows:**
- No additional requirements
- Windows 10/11 recommended for testing

**Linux/macOS:**
- Build produces `.exe` only
- Use Windows or Wine for testing

## Quick Start

```bash
# Clone repository
git clone https://github.com/RWolfyo/VRChatMonitor.git
cd vrchat-monitor-v2

# Install dependencies
npm install

# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Output: dist/vrc-monitor-v2/vrc-monitor-v2.exe
```

## Development Setup

### 1. Clone Repository

```bash
git clone https://github.com/RWolfyo/VRChatMonitor.git
cd vrchat-monitor-v2
```

### 2. Install Dependencies

```bash
npm install
```

**What gets installed:**
- TypeScript 5.7 and compiler
- better-sqlite3 (with native module compilation)
- vrchat API client
- Build tools (esbuild, postject)
- Development tools (tsx, eslint, prettier)

### 3. Configure

Copy example config:

```bash
# Windows
copy config\config.json config\config.local.json

# Linux/macOS
cp config/config.json config/config.local.json
```

Edit `config/config.local.json` with your credentials (optional).

## Development Commands

### Run in Development Mode

```bash
npm run dev
```

**Features:**
- Hot reload with tsx watch mode
- Source maps for debugging
- No bundling (runs TypeScript directly)
- Faster iteration

**Output:**
```
[tsx] Watching for file changes...
🔍 VRChat Monitor v2 initializing...
...
```

### Type Checking

```bash
npm run type-check
```

Runs TypeScript compiler in check mode (no emit).

**Fix type errors before committing!**

### Linting

```bash
npm run lint         # Check for issues
npm run lint:fix     # Auto-fix issues
```

Uses ESLint with TypeScript support.

### Formatting

```bash
npm run format       # Check formatting
npm run format:write # Auto-format files
```

Uses Prettier for consistent code style.

## Production Build

### Full Build Pipeline

```bash
npm run build
```

**Runs 3 steps:**
1. `build:compile` - esbuild bundles TypeScript → JavaScript
2. `build:copy` - Copy assets, native modules, vendor binaries
3. `build:sea` - Create Node.js SEA executable

### Individual Build Steps

```bash
# Step 1: Compile TypeScript
npm run build:compile

# Step 2: Copy assets
npm run build:copy

# Step 3: Create SEA executable
npm run build:sea
```

## Build Process Details

### Step 1: Compile (esbuild)

**Command:** `npm run build:compile`

**What it does:**
- Bundles `src/index.ts` → `build/index.js`
- Target: Node.js 22 CommonJS
- Tree-shaking enabled
- Source maps optional

**Configuration:**
```javascript
{
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'build/index.js',
  external: [], // Bundle everything except native modules
  minify: false // Easier debugging
}
```

**Output:**
- `build/index.js` (~977 KB)

### Step 2: Copy Assets

**Command:** `npm run build:copy`

**Script:** `scripts/copy-assets.js`

**What it does:**

1. **Copy configuration:**
   - `config/config.json` → `build/config.json`

2. **Copy blocklist:**
   - `config/blocklist.db` → `build/blocklist.db`

3. **Copy alert sound:**
   - `assets/alert.mp3` → `build/alert.mp3` (if exists)

4. **Copy native module:**
   - `node_modules/better-sqlite3/build/Release/better_sqlite3.node` → `build/native/better_sqlite3.node`

5. **Download FFmpeg (if missing):**
   - Downloads BtbN FFmpeg builds from GitHub releases
   - Extracts `ffplay.exe` using Python zipfile
   - Places in `build/vendor/ffplay.exe`

6. **Extract SnoreToast (if missing):**
   - Copies from node-notifier package
   - Places in `build/vendor/SnoreToast.exe`

**Output:**
```
build/
├── index.js
├── config.json
├── blocklist.db
├── alert.mp3
├── native/
│   └── better_sqlite3.node
└── vendor/
    ├── ffplay.exe
    └── SnoreToast.exe
```

### Step 3: Create SEA Executable

**Command:** `npm run build:sea`

**Script:** `scripts/build-sea.js`

**What it does:**

1. **Create SEA configuration:**
   ```json
   {
     "main": "build/index.js",
     "output": "sea-prep.blob",
     "disableExperimentalSEAWarning": true,
     "useSnapshot": false,
     "useCodeCache": true
   }
   ```

2. **Generate SEA blob:**
   ```bash
   node --experimental-sea-config sea-config.json
   ```

3. **Copy Node.js executable:**
   ```bash
   copy process.execPath dist/vrc-monitor-v2.exe
   ```

4. **Inject blob with postject:**
   ```bash
   npx postject dist/vrc-monitor-v2.exe NODE_SEA_BLOB sea-prep.blob ^
     --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ^
     --macho-segment-name NODE_SEA
   ```

5. **Create deployment directory:**
   - Copy executable to `dist/vrc-monitor-v2/`
   - Copy all assets from `build/`

**Output:**
```
dist/
├── vrc-monitor-v2.exe           # Standalone (~50-60 MB)
└── vrc-monitor-v2/              # Deployment package
    ├── vrc-monitor-v2.exe
    ├── config.json
    ├── blocklist.db
    ├── alert.mp3
    ├── native/
    │   └── better_sqlite3.node
    └── vendor/
        ├── ffplay.exe
        └── SnoreToast.exe
```

## Testing Builds

### Test Development Build

```bash
npm run dev
# App starts with hot reload
# Make changes and see immediate updates
```

### Test Production Build

```bash
npm run build
cd dist/vrc-monitor-v2
.\vrc-monitor-v2.exe
```

**What to verify:**
- ✅ Starts without errors
- ✅ Authenticates successfully
- ✅ Detects VRChat logs
- ✅ Loads blocklist
- ✅ Sends notifications (if configured)
- ✅ Session persists to `.cache/session.sqlite`

### Test Executable Portability

Copy `dist/vrc-monitor-v2/` to another machine:

1. No Node.js installation required
2. No npm dependencies required
3. Runs standalone

## Project Structure

```
vrchat-monitor-v2/
├── src/
│   ├── core/                    # Core functionality
│   │   ├── VRChatMonitor.ts    # Main orchestrator
│   │   ├── LogWatcher.ts       # VRChat log monitoring
│   │   └── BlocklistManager.ts # Blocklist checking
│   ├── services/                # External services
│   │   ├── VRChatAPIService.ts # VRChat API client
│   │   ├── DiscordService.ts   # Discord webhooks
│   │   ├── NotificationService.ts # Desktop notifications
│   │   ├── AudioService.ts     # Audio alerts
│   │   └── VRCXService.ts      # VR overlay
│   ├── utils/                   # Utilities
│   │   ├── Logger.ts           # Winston logger
│   │   ├── Config.ts           # Configuration manager
│   │   ├── PathResolver.ts     # Path detection
│   │   ├── LoginPrompt.ts      # Interactive login
│   │   ├── SqliteLoader.ts     # Native module loader
│   │   └── KeyvBetterSqliteStore.ts # Custom Keyv store
│   ├── types/                   # TypeScript types
│   └── index.ts                 # Entry point
├── scripts/                     # Build scripts
│   ├── copy-assets.js          # Asset preparation
│   ├── build-sea.js            # SEA packaging
│   └── convert-jsonc-to-sqlite.js # JSONC migration
├── config/                      # Configuration
│   ├── config.json             # Default config
│   └── blocklist.db            # SQLite blocklist
├── assets/                      # Assets
│   └── alert.mp3               # Default alert sound
├── docs/                        # Documentation
├── build/                       # Build output (gitignored)
├── dist/                        # Distribution (gitignored)
├── .cache/                      # Runtime cache (gitignored)
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript config
├── .eslintrc.json              # ESLint config
├── .prettierrc                  # Prettier config
└── README.md                    # Main documentation
```

## Dependencies

### Runtime Dependencies

```json
{
  "better-sqlite3": "^11.7.0",    // SQLite database
  "chokidar": "^4.0.3",           // File watching
  "keyv": "^5.1.2",               // Key-value store
  "node-notifier": "^10.0.1",     // Desktop notifications
  "vrchat": "^2.20.4",            // VRChat API client
  "winston": "^3.17.0"            // Logging
}
```

### Development Dependencies

```json
{
  "@types/node": "^22.10.5",      // Node.js types
  "esbuild": "^0.24.2",           // Bundler
  "eslint": "^9.17.0",            // Linter
  "postject": "^1.0.0-alpha.6",   // SEA injection
  "prettier": "^3.4.2",           // Formatter
  "tsx": "^4.19.2",               // TypeScript runner
  "typescript": "^5.7.2"          // TypeScript compiler
}
```

## Build Configuration Files

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

### package.json Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "npm run build:compile && npm run build:copy && npm run build:sea",
    "build:compile": "esbuild src/index.ts --bundle --platform=node --target=node22 --format=cjs --outfile=build/index.js",
    "build:copy": "node scripts/copy-assets.js",
    "build:sea": "node scripts/build-sea.js",
    "type-check": "tsc --noEmit",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix",
    "format": "prettier --check \"src/**/*.ts\"",
    "format:write": "prettier --write \"src/**/*.ts\""
  }
}
```

## Common Build Issues

### "Cannot find module 'better-sqlite3'"

**Cause:** Native module not compiled or copied

**Solution:**
```bash
npm rebuild better-sqlite3
npm run build:copy
```

### "Python not found" during build

**Cause:** Python not in PATH (needed for FFmpeg extraction)

**Solution:**
- Install Python 3.x
- Add to PATH
- Restart terminal

### "postject not found"

**Cause:** Development dependencies not installed

**Solution:**
```bash
npm install
```

### Build succeeds but .exe doesn't run

**Causes:**
- Missing `native/better_sqlite3.node`
- Missing `vendor/` binaries
- Missing `config.json`

**Solution:**
```bash
# Rebuild everything
npm run clean
npm install
npm run build
```

## Clean Build

```bash
# Manual cleanup
rm -rf build/ dist/ .cache/ node_modules/

# Reinstall and rebuild
npm install
npm run build
```

## GitHub Actions CI/CD

The project uses GitHub Actions for automated builds and releases.

### Workflows

**`.github/workflows/release.yml`** - Release builds

Triggers on:
- Git tags: `v*.*.*` (e.g., `v2.0.0`)
- Manual dispatch

Steps:
1. Checkout code
2. Setup Node.js 22 + Python 3.x
3. Install dependencies
4. Run full build
5. Create ZIP archive
6. Generate changelog
7. Create GitHub release
8. Upload artifacts

**`.github/workflows/build-test.yml`** - CI builds

Triggers on:
- Push to `main`, `master`, `develop`
- Pull requests

Steps:
1. Checkout code
2. Setup Node.js 22
3. Install dependencies
4. Run type-check
5. Run build
6. Upload artifacts (7-day retention)

### Creating a Release

```bash
# Tag version
git tag v2.0.0
git push origin v2.0.0

# GitHub Actions automatically:
# - Builds application
# - Creates release
# - Uploads vrc-monitor-v2.zip
```

## Performance Optimization

### Bundle Size

Current: ~977 KB

**Optimization tips:**
- Tree-shaking enabled in esbuild
- No unnecessary dependencies
- Native modules external (not bundled)

### Startup Time

Target: <2 seconds with session reuse

**Optimization areas:**
- Pre-compile regex patterns
- Lazy load heavy modules
- Cache API responses

### Memory Usage

Target: 50-80 MB

**Optimization techniques:**
- Automatic cache pruning
- Dedupe cleanup
- No memory leaks

## Contributing

### Before Submitting PR

1. **Run type checking:**
   ```bash
   npm run type-check
   ```

2. **Run linting:**
   ```bash
   npm run lint:fix
   ```

3. **Run formatting:**
   ```bash
   npm run format:write
   ```

4. **Test build:**
   ```bash
   npm run build
   # Test the executable
   ```

5. **Update documentation** if needed

### Code Style

- Use TypeScript strict mode
- Async/await over callbacks
- Descriptive variable names
- Comment complex logic
- Follow existing patterns

## Next Steps

- **[Configuration Reference](CONFIGURATION.md)** - Understand config options
- **[Setup Guide](SETUP.md)** - Configure development environment
- **[Main README](../README.md)** - Back to documentation
