#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Failed to download: ${response.statusCode}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Cross-platform recursive directory removal
function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Cross-platform recursive file search
function findFile(dir, filename) {
  const results = [];

  function search(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        search(fullPath);
      } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
        results.push(fullPath);
      }
    }
  }

  search(dir);
  return results[0]; // Return first match
}

async function downloadAndExtract(url, dest, filename) {
  const tempFile = path.join('vendor', 'temp.zip');
  const tempExtract = path.join('vendor', 'temp_extract');

  try {
    console.log(`   Downloading...`);
    await downloadFile(url, tempFile);

    // Extract all and find the file
    ensureDir(tempExtract);

    console.log(`   Extracting...`);
    try {
      // Try Python zipfile (most reliable and cross-platform)
      const pythonScript = `import zipfile; import sys; zipfile.ZipFile('${tempFile.replace(/\\/g, '\\\\')}', 'r').extractall('${tempExtract.replace(/\\/g, '\\\\')}')`;

      // Try python first, then python3
      try {
        execSync(`python -c "${pythonScript}"`, { stdio: 'pipe' });
      } catch (pyErr) {
        execSync(`python3 -c "${pythonScript}"`, { stdio: 'pipe' });
      }
    } catch (pythonErr) {
      // Fallback to tar (works on Windows with Git Bash)
      try {
        execSync(`tar -xf "${tempFile}" -C "${tempExtract}"`, { stdio: 'pipe' });
      } catch (tarErr) {
        throw new Error('Unable to extract zip file. Please install Python or ensure tar is available.');
      }
    }

    console.log(`   Finding ${filename}...`);
    const foundFile = findFile(tempExtract, filename);

    if (foundFile && fs.existsSync(foundFile)) {
      fs.copyFileSync(foundFile, dest);
      console.log(`✓ Downloaded and extracted: ${filename}`);

      // Clean up
      fs.unlinkSync(tempFile);
      removeDir(tempExtract);

      return true;
    } else {
      throw new Error(`${filename} not found in archive`);
    }
  } catch (err) {
    // Clean up on error
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    removeDir(tempExtract);

    throw err;
  }
}

function copyFile(src, dest) {
  try {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied: ${src} -> ${dest}`);
  } catch (err) {
    console.warn(`⚠ Failed to copy ${src}: ${err.message}`);
  }
}

function copyDir(src, dest) {
  try {
    if (!fs.existsSync(src)) {
      console.warn(`⚠ Source directory not found: ${src}`);
      return;
    }

    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
    console.log(`✓ Copied directory: ${src} -> ${dest}`);
  } catch (err) {
    console.warn(`⚠ Failed to copy directory ${src}: ${err.message}`);
  }
}

async function main() {
  console.log('📦 Copying build assets...\n');

  // Ensure directories exist
  ensureDir('build');
  ensureDir('vendor');
  ensureDir('build/vendor');

  // Copy configuration files
  copyFile('config/config.json', 'build/config.json');

  // Copy SQLite database
  if (fs.existsSync('config/blocklist.db')) {
    copyFile('config/blocklist.db', 'build/blocklist.db');
  } else {
    console.warn('⚠ blocklist.db not found - run: node scripts/convert-jsonc-to-sqlite.js');
  }

  // Copy better-sqlite3 with its pure-JS dependencies
  console.log('\n📦 Copying better-sqlite3 and dependencies...');
  const sqliteNativePath = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node';
  if (fs.existsSync(sqliteNativePath)) {
    ensureDir('build/lib/better-sqlite3');

    // Copy better-sqlite3 itself
    console.log('  Copying better-sqlite3 package...');
    copyFile('node_modules/better-sqlite3/package.json', 'build/lib/better-sqlite3/package.json');
    copyDir('node_modules/better-sqlite3/lib', 'build/lib/better-sqlite3/lib');
    copyDir('node_modules/better-sqlite3/build', 'build/lib/better-sqlite3/build');

    // Copy its pure-JS dependencies to node_modules so it can find them
    // (These can't be bundled because better-sqlite3 loads from external lib/)
    console.log('  Copying dependencies to node_modules...');
    ensureDir('build/lib/better-sqlite3/node_modules/bindings');
    copyFile('node_modules/bindings/package.json', 'build/lib/better-sqlite3/node_modules/bindings/package.json');
    copyFile('node_modules/bindings/bindings.js', 'build/lib/better-sqlite3/node_modules/bindings/bindings.js');

    if (fs.existsSync('node_modules/file-uri-to-path')) {
      ensureDir('build/lib/better-sqlite3/node_modules/file-uri-to-path');
      copyFile('node_modules/file-uri-to-path/package.json', 'build/lib/better-sqlite3/node_modules/file-uri-to-path/package.json');
      copyFile('node_modules/file-uri-to-path/index.js', 'build/lib/better-sqlite3/node_modules/file-uri-to-path/index.js');
    }

    console.log('✓ Copied better-sqlite3 and dependencies to lib/');
  } else {
    console.warn('⚠ better-sqlite3 native module not found - install with: npm rebuild better-sqlite3');
  }

  // Copy assets
  if (fs.existsSync('assets/alert.mp3')) {
    copyFile('assets/alert.mp3', 'build/alert.mp3');
  } else {
    console.warn('⚠ alert.mp3 not found in assets/ - audio alerts will be disabled');
  }

  // Download native binaries if not present
  console.log('\n📥 Checking for native binaries...\n');

  // Download ffplay.exe from FFmpeg (full static build - no DLL dependencies)
  const ffplayPath = 'vendor/ffplay.exe';
  if (!fs.existsSync(ffplayPath)) {
    console.log('📥 Downloading ffplay.exe (full static build) from BtbN FFmpeg builds...');
    try {
      // Using GitHub BtbN builds - FULL static version (all codecs compiled in, no DLLs needed)
      // This is larger (~100MB) but completely self-contained
      const ffmpegUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
      const success = await downloadAndExtract(ffmpegUrl, ffplayPath, 'ffplay.exe');
      if (!success) {
        console.warn('  Optional: Download FFmpeg manually from https://ffmpeg.org/download.html');
      }
    } catch (err) {
      console.warn(`⚠ Failed to download ffplay.exe: ${err.message}`);
      console.warn('  Optional: Download FFmpeg manually from https://ffmpeg.org/download.html');
    }
  } else {
    console.log('✓ ffplay.exe already exists');
  }

  // Copy SnoreToast.exe from node_modules (comes with node-notifier)
  const snoretoastPath = 'vendor/SnoreToast.exe';
  if (!fs.existsSync(snoretoastPath)) {
    const snoretoastSource = 'node_modules/node-notifier/vendor/snoreToast/snoretoast-x64.exe';
    if (fs.existsSync(snoretoastSource)) {
      fs.copyFileSync(snoretoastSource, snoretoastPath);
      console.log('✓ Copied SnoreToast.exe from node-notifier');
    } else {
      console.warn('⚠ SnoreToast.exe not found - desktop notifications may not work');
    }
  } else {
    console.log('✓ SnoreToast.exe already exists');
  }

  // Copy vendor binaries to build
  console.log('\n📦 Copying vendor binaries...\n');
  if (fs.existsSync('vendor')) {
    copyDir('vendor', 'build/vendor');
  } else {
    console.warn('⚠ vendor/ directory not found - notifications and audio may not work');
  }

  console.log('\n✅ Asset copy complete!');
}

// Run main function
main().catch(err => {
  console.error('❌ Error during asset copy:', err);
  process.exit(1);
});
