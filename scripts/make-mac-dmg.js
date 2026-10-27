const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const architecture = process.argv[2] || process.arch;
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const appDirectory = path.join(output, architecture === 'arm64' ? 'mac-arm64' : 'mac');
const filename = `simple-browser-${version}-mac-${architecture}`;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-browser-dmg-'));
const payload = path.join(staging, 'payload');
fs.mkdirSync(payload);
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', timeout: 180000, ...options });
try {
  // Copy the app directly without creating an intermediate ZIP archive.
  fs.cpSync(path.join(appDirectory, 'simple-browser.app'), path.join(payload, 'simple-browser.app'), {
    recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
  });
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(payload, 'simple-browser.app')]);
  fs.symlinkSync('/Applications', path.join(payload, 'Applications'));
  // makehybrid builds HFS+ directly, avoiding the mounted-volume copy step
  // where hdiutil create and electron-builder's DMG tool stall on this host.
  const hybrid = path.join(staging, 'installer-hfs.dmg');
  const image = path.join(staging, 'installer.dmg');
  run('/usr/bin/hdiutil', ['makehybrid', '-hfs', '-hfs-volume-name', 'simple-browser', '-hfs-openfolder', payload, '-o', hybrid, payload]);
  const mount = path.join(staging, 'mounted');
  fs.mkdirSync(mount);
  run('/usr/bin/hdiutil', ['attach', hybrid, '-nobrowse', '-readwrite', '-mountpoint', mount]);
  try {
    // makehybrid adds FinderInfo to executable files. Those attributes must
    // be removed from the generated image to retain the app's valid signature.
    run('/usr/bin/xattr', ['-rd', 'com.apple.FinderInfo', path.join(mount, 'simple-browser.app')]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(mount, 'simple-browser.app')]);
  } finally {
    run('/usr/bin/hdiutil', ['detach', mount]);
  }
  run('/usr/bin/hdiutil', ['convert', hybrid, '-format', 'UDZO', '-o', image]);
  run('/usr/bin/hdiutil', ['verify', image]);
  const target = path.join(output, `${filename}.dmg`);
  fs.copyFileSync(image, `${target}.tmp`);
  fs.renameSync(`${target}.tmp`, target);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
