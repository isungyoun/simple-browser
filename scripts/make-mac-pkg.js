const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { version, build } = require('../package.json');
const architecture = process.argv[2] || process.arch;
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
// make-mac-dmg.js moves the unpacked app into *.noindex when it finishes.
const appDirectory = path.join(output, `${architecture === 'arm64' ? 'mac-arm64' : 'mac'}.noindex`);
const filename = `simple-browser-${version}-mac-${architecture}`;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-browser-pkg-'));
const payload = path.join(staging, 'payload');
fs.mkdirSync(payload);
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', timeout: 180000, ...options });
try {
  fs.cpSync(path.join(appDirectory, 'simple-browser.app'), path.join(payload, 'simple-browser.app'), {
    recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true,
  });
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(payload, 'simple-browser.app')]);
  // A relocatable bundle is upgraded wherever another copy with the same
  // bundle ID was last seen, so always install to /Applications.
  const components = path.join(staging, 'components.plist');
  run('/usr/bin/pkgbuild', ['--analyze', '--root', payload, components]);
  run('/usr/bin/plutil', ['-replace', '0.BundleIsRelocatable', '-bool', 'NO', components]);
  const packages = path.join(staging, 'packages');
  fs.mkdirSync(packages);
  run('/usr/bin/pkgbuild', [
    '--root', payload, '--component-plist', components, '--install-location', '/Applications',
    '--identifier', build.appId, '--version', version, path.join(packages, 'simple-browser.pkg'),
  ]);
  const distribution = path.join(staging, 'distribution.xml');
  run('/usr/bin/productbuild', ['--synthesize', '--package', path.join(packages, 'simple-browser.pkg'), distribution]);
  fs.writeFileSync(distribution, fs.readFileSync(distribution, 'utf8')
    .replace(/(<installer-gui-script[^>]*>)/, `$1\n    <title>simple-browser ${version}</title>`)
    .replace(/hostArchitectures="[^"]*"/, `hostArchitectures="${architecture}"`));
  const installer = path.join(staging, 'installer.pkg');
  run('/usr/bin/productbuild', ['--distribution', distribution, '--package-path', packages, installer]);
  const target = path.join(output, `${filename}.pkg`);
  fs.copyFileSync(installer, `${target}.tmp`);
  fs.renameSync(`${target}.tmp`, target);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
