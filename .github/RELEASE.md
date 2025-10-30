# Release Process

This document describes how to create releases for VRChat Monitor v2.

## Automated Release Workflow

The project uses GitHub Actions to automatically build and release the Windows x64 executable.

### Creating a Release

#### Method 1: Git Tag (Recommended)

1. **Commit your changes**:
   ```bash
   git add .
   git commit -m "Release v2.0.0"
   ```

2. **Create and push a version tag**:
   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

3. **GitHub Actions automatically**:
   - Builds the executable
   - Downloads FFmpeg and SnoreToast
   - Creates release package
   - Generates changelog
   - Creates GitHub release
   - Uploads ZIP file

#### Method 2: Manual Trigger

1. Go to **Actions** → **Build & Release**
2. Click **Run workflow**
3. Enter version (e.g., `v2.0.0`)
4. Click **Run workflow**

### Release Package Contents

The automated release creates `vrc-monitor-v2-windows-x64.zip` containing:

```
vrc-monitor-v2/
├── vrc-monitor-v2.exe          # 38 MB - Main executable
├── config.json                 # Configuration
├── blockedGroups.jsonc         # Blocklist database (90+ groups)
├── alert.mp3                   # Alert sound
├── README_RELEASE.txt          # User documentation
├── README.md                   # Full documentation
├── LICENSE                     # License file
└── vendor/
    ├── SnoreToast.exe         # Desktop notifications (2.5 MB)
    └── ffplay.exe             # Audio playback (17 MB)
```

**Total Size**: ~57 MB

### Workflow Features

✅ **Fully Automated**:
- No manual steps required
- Automatic binary downloads
- Self-contained package

✅ **Comprehensive**:
- Includes all dependencies
- Ready-to-use package
- Complete documentation

✅ **Quality Checks**:
- Verifies build outputs
- Checks binary sizes
- Validates artifacts

✅ **Changelog Generation**:
- Auto-generates from commits
- Includes package details
- Lists all features

### Version Naming

Use semantic versioning: `vX.Y.Z`

- **X** (Major): Breaking changes
- **Y** (Minor): New features
- **Z** (Patch): Bug fixes

Examples:
- `v2.0.0` - Major release
- `v2.1.0` - New features
- `v2.0.1` - Bug fixes

### Skipping CI

To skip the workflow on a commit:
```bash
git commit -m "Update docs [skip-ci]"
```

### Testing Before Release

#### Local Testing

```bash
# Build locally
npm run build

# Test the executable
cd release/vrc-monitor-v2
./vrc-monitor-v2.exe
```

#### GitHub Testing

Push to a branch and the **Build Test** workflow will run automatically:

```bash
git checkout -b test-release
git push origin test-release
```

This runs the full build without creating a release.

### Release Checklist

Before creating a release:

- [ ] Update version in `package.json`
- [ ] Test locally with `npm run build`
- [ ] Commit all changes
- [ ] Create and push version tag
- [ ] Verify GitHub Actions succeeds
- [ ] Test downloaded release package
- [ ] Update release notes if needed

### Troubleshooting

#### Build Fails

1. Check **Actions** tab for error logs
2. Common issues:
   - FFmpeg download timeout → Retry workflow
   - Missing dependencies → Check `package.json`
   - Binary not found → Check `scripts/copy-assets.js`

#### Release Not Created

1. Verify tag format: `vX.Y.Z`
2. Check `GITHUB_TOKEN` permissions
3. Ensure not using `[skip-ci]` in commit

#### Binaries Missing

1. Check workflow logs for download errors
2. Verify Python is available (for FFmpeg extraction)
3. Check `build/vendor/` directory in artifacts

### Manual Release (Fallback)

If the automated workflow fails:

1. **Build locally**:
   ```bash
   npm run build
   ```

2. **Create release package**:
   ```bash
   # Windows
   Compress-Archive -Path release/vrc-monitor-v2/* -DestinationPath vrc-monitor-v2-windows-x64.zip

   # Linux/Mac
   cd release && zip -r ../vrc-monitor-v2-windows-x64.zip vrc-monitor-v2/
   ```

3. **Create release manually**:
   - Go to GitHub → Releases → New Release
   - Choose tag
   - Upload ZIP file
   - Add changelog

### Workflow Files

- `.github/workflows/release.yml` - Release automation
- `.github/workflows/build-test.yml` - Build testing
- `scripts/copy-assets.js` - Asset preparation
- `package.json` - Build scripts

### Requirements

The workflows require:
- Windows runner (GitHub Actions)
- Node.js 18
- Python 3.x (for FFmpeg extraction)
- `GITHUB_TOKEN` (automatically provided)

### Post-Release

After a successful release:

1. Announce in community channels
2. Update main README if needed
3. Monitor issue tracker
4. Plan next release

---

## Quick Reference

```bash
# Create release
git tag v2.0.0
git push origin v2.0.0

# Test build
git push origin feature-branch

# Skip CI
git commit -m "Update [skip-ci]"
```

For questions, see: [GitHub Actions Documentation](https://docs.github.com/actions)
