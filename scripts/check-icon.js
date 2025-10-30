#!/usr/bin/env node

/**
 * Check if icon is embedded in the executable
 */

const fs = require('fs');
const path = require('path');

const exePath = path.join(__dirname, '..', 'dist', 'vrc-monitor-v2.exe');

if (!fs.existsSync(exePath)) {
  console.log('❌ Executable not found:', exePath);
  process.exit(1);
}

(async () => {
try {
  const ResEdit = await import('resedit');

  console.log('📖 Reading executable...');
  const exeData = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeData, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  console.log('\n🔍 Checking for icon resources...\n');

  let foundIcons = false;

  // Check for icon groups
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (iconGroups.length > 0) {
    console.log(`✓ Found ${iconGroups.length} icon group(s):`);
    iconGroups.forEach((group, i) => {
      console.log(`  Group ${i + 1}:`);
      console.log(`    - ID: ${group.id}`);
      console.log(`    - Icons: ${group.icons.length}`);
      group.icons.forEach((icon, j) => {
        console.log(`      Icon ${j + 1}: ${icon.width}x${icon.height}, ${icon.bitCount} bit`);
      });
    });
    foundIcons = true;
  } else {
    console.log('❌ No icon groups found');
  }

  console.log();

  if (foundIcons) {
    console.log('✅ Icons are embedded in the executable!');
    console.log('\nIf Windows still shows Node.js icon:');
    console.log('  1. Delete the .exe file');
    console.log('  2. Run: ie4uinit.exe -show');
    console.log('  3. Copy the .exe back and refresh (F5)');
  } else {
    console.log('❌ No icons found - embedding failed');
  }

} catch (error) {
  console.error('❌ Error reading executable:', error.message);
  process.exit(1);
}
})();
