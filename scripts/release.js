const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const tag = `v${version}`;
// Installers are over GitHub's 100MB file limit, so they are published as
// release assets instead of commits. Only the latest release is kept.
const installers = ['mac-arm64.dmg', 'mac-arm64.pkg', 'win-x64.exe'].map((suffix) => `simple-browser-${version}-${suffix}`);
const missing = installers.filter((name) => !fs.existsSync(path.join(output, name)));
if (missing.length) throw new Error(`빌드된 설치 파일이 없습니다: ${missing.join(', ')}`);
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
const read = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
if (read('git', ['status', '--porcelain'])) throw new Error('커밋하지 않은 변경이 있습니다. 커밋과 푸시 후 릴리스하세요.');
run('git', ['push', 'origin', 'HEAD']);
const files = installers.map((name) => path.join(output, name));
let exists = true;
try { read('gh', ['release', 'view', tag, '--json', 'tagName']); } catch { exists = false; }
if (exists) run('gh', ['release', 'upload', tag, ...files, '--clobber']);
else run('gh', ['release', 'create', tag, ...files, '--title', `simple-browser ${version}`, '--target', read('git', ['rev-parse', 'HEAD']), '--notes', 'macOS(Apple Silicon): PKG 권장, DMG / Windows x64: EXE']);
for (const { tagName } of JSON.parse(read('gh', ['release', 'list', '--limit', '100', '--json', 'tagName']))) {
  if (tagName !== tag) run('gh', ['release', 'delete', tagName, '--cleanup-tag', '--yes']);
}
// Remove older local installers (and legacy ZIPs) so dist holds only this version.
for (const name of fs.readdirSync(output)) {
  if (/^simple-browser-.+\.(dmg|pkg|exe|zip)$/.test(name) && !installers.includes(name)) fs.rmSync(path.join(output, name));
}
