#!/usr/bin/env node

/**
 * Build Single Executable Application (SEA) using Node.js official SEA support
 * https://nodejs.org/api/single-executable-applications.html
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function buildSEA() {
  console.log('🔨 Building Single Executable Application...\n');

  const platform = process.platform;
  const isWindows = platform === 'win32';
  const outputName = isWindows ? 'vrc-monitor.exe' : 'vrc-monitor';

  ensureDir('dist');

  // Step 1: Create SEA configuration
  console.log('📝 Creating SEA configuration...');
  const seaConfig = {
    main: 'build/index.js',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: true,
    assets: {
      'config.json': 'build/config.json',
      'blocklist.db': 'build/blocklist.db',
      'alert.mp3': 'build/alert.mp3',
    }
  };

  fs.writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));
  console.log('✓ SEA config created\n');

  // Step 2: Generate the blob to be injected into the binary
  console.log('📦 Generating SEA blob...');
  try {
    execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });
    console.log('✓ SEA blob generated\n');
  } catch (error) {
    console.error('❌ Failed to generate SEA blob');
    throw error;
  }

  // Step 3: Copy node executable
  console.log('📋 Copying Node.js executable...');
  const nodeExePath = process.execPath;
  const tempExePath = path.join('dist', `temp-${outputName}`);

  fs.copyFileSync(nodeExePath, tempExePath);
  console.log(`✓ Copied from: ${nodeExePath}\n`);

  // Step 4: Remove signature (Windows) or adjust permissions (Unix)
  if (isWindows) {
    console.log('🔓 Removing signature (Windows)...');
    try {
      // Try to use signtool if available, otherwise skip
      try {
        execSync(`signtool remove /s "${tempExePath}"`, { stdio: 'pipe' });
        console.log('✓ Signature removed\n');
      } catch (e) {
        // signtool not available, that's okay for development builds
        console.log('⚠ signtool not found, skipping signature removal (dev build)\n');
      }
    } catch (error) {
      console.log('⚠ Could not remove signature, continuing...\n');
    }
  }

  // Step 5: Inject the blob into the executable
  console.log('💉 Injecting SEA blob into executable...');

  if (isWindows) {
    // Windows: Use postject (if available) or manual injection
    try {
      // Try using npx postject
      execSync(
        `npx postject "${tempExePath}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
        { stdio: 'inherit' }
      );
      console.log('✓ Blob injected successfully\n');
    } catch (error) {
      console.error('❌ Failed to inject blob. Install postject:');
      console.error('   npm install -g postject');
      throw error;
    }
  } else {
    // Unix: Use native approach
    try {
      // For macOS, need to remove signature first
      if (platform === 'darwin') {
        try {
          execSync(`codesign --remove-signature "${tempExePath}"`, { stdio: 'pipe' });
        } catch (e) {
          // Ignore if codesign fails
        }
      }

      // Inject using npx postject
      execSync(
        `npx postject "${tempExePath}" NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`,
        { stdio: 'inherit' }
      );
      console.log('✓ Blob injected successfully\n');
    } catch (error) {
      console.error('❌ Failed to inject blob');
      throw error;
    }
  }

  // Step 6: Make executable (Unix)
  if (!isWindows) {
    fs.chmodSync(tempExePath, 0o755);
  }

  // Step 7: Rename to final name
  const finalPath = path.join('dist', outputName);
  if (fs.existsSync(finalPath)) {
    fs.unlinkSync(finalPath);
  }
  fs.renameSync(tempExePath, finalPath);

  // Step 8: Set icon and console subsystem (Windows only) - using resedit (pure JS, no external binaries)
  if (isWindows) {
    console.log('🎨 Setting executable icon and console properties...');
    const iconPath = path.join('assets', 'VRCM.ico');
    if (fs.existsSync(iconPath)) {
      try {
        // Dynamic import since resedit is ESM
        const ResEdit = await import('resedit');

        // Read the executable
        const exeData = fs.readFileSync(finalPath);
        // Allow parsing signed executables (signature will be invalidated anyway after modification)
        const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
        const res = ResEdit.NtExecutableResource.from(exe);

        // Read the icon file
        const iconData = fs.readFileSync(iconPath);
        const iconFile = ResEdit.Data.IconFile.from(iconData);

        // Log icon info for debugging
        console.log(`  Found ${iconFile.icons.length} icon size(s) in ICO file`);
        iconFile.icons.forEach((icon, i) => {
          console.log(`    ${i + 1}. ${icon.width}x${icon.height}, ${icon.bitCount}-bit, ${icon.data.length} bytes`);
        });

        // Replace icon
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
          res.entries,
          1, // Icon group ID
          1033, // Language ID (English US)
          iconFile.icons.map((item) => item.data)
        );

        // Note: We don't force console subsystem (CUI) because it causes issues:
        // - Process doesn't terminate when console is closed
        // - Doesn't work well with Windows Terminal
        // The app will use whatever console the user prefers

        // Write back to executable
        res.outputResource(exe);
        const newExeData = Buffer.from(exe.generate());
        fs.writeFileSync(finalPath, newExeData);

        console.log('✓ Icon embedded in executable');

        // Force Windows to refresh icon cache
        try {
          console.log('🔄 Refreshing Windows icon cache...');
          // Delete icon cache databases to force refresh
          execSync('ie4uinit.exe -show', { stdio: 'pipe' });
          console.log('✓ Icon cache refreshed\n');
        } catch (e) {
          console.log('⚠ Could not refresh icon cache automatically');
          console.log('  To see the icon, restart Explorer or run: ie4uinit.exe -show\n');
        }
      } catch (error) {
        console.log('⚠ Could not set icon:', error.message);
        console.log('⚠ Skipping icon setup (executable will still work)\n');
      }
    } else {
      console.log('⚠ Icon file not found:', iconPath, '\n');
    }
  }

  // Step 9: Get file size
  const stats = fs.statSync(finalPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

  console.log('✅ Single Executable Application built successfully!');
  console.log(`📦 Output: ${finalPath}`);
  console.log(`📏 Size: ${sizeMB} MB\n`);

  // Cleanup
  console.log('🧹 Cleaning up...');
  if (fs.existsSync('sea-prep.blob')) {
    fs.unlinkSync('sea-prep.blob');
  }
  if (fs.existsSync('sea-config.json')) {
    fs.unlinkSync('sea-config.json');
  }
  console.log('✓ Cleanup complete\n');

  // Copy vendor binaries alongside the executable
  console.log('📁 Setting up deployment directory...');
  const deployDir = path.join('dist', 'vrc-monitor');
  ensureDir(deployDir);

  // Copy executable
  fs.copyFileSync(finalPath, path.join(deployDir, outputName));

  // Copy config and database
  fs.copyFileSync('build/config.json', path.join(deployDir, 'config.json'));
  fs.copyFileSync('build/blocklist.db', path.join(deployDir, 'blocklist.db'));
  fs.copyFileSync('build/alert.mp3', path.join(deployDir, 'alert.mp3'));

  // Copy vendor directory
  const vendorSrc = 'build/vendor';
  const vendorDest = path.join(deployDir, 'vendor');
  if (fs.existsSync(vendorSrc)) {
    ensureDir(vendorDest);
    const files = fs.readdirSync(vendorSrc);
    for (const file of files) {
      const srcFile = path.join(vendorSrc, file);
      const destFile = path.join(vendorDest, file);
      fs.copyFileSync(srcFile, destFile);
    }
  }

  // Copy lib directory (better-sqlite3 and dependencies)
  const libSrc = 'build/lib';
  const libDest = path.join(deployDir, 'lib');
  if (fs.existsSync(libSrc)) {
    copyDirRecursive(libSrc, libDest);
    console.log('✓ External libraries copied');
  }

  console.log('✓ Deployment directory ready\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('🎉 Build Complete!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Executable: dist/${outputName}`);
  console.log(`Deployment: dist/vrc-monitor/`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

// Run build
buildSEA().catch((error) => {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
});
