const fs = require('node:fs');
const path = require('node:path');

// Schemes the browser handles itself or that must never reach the OS.
const INTERNAL_SCHEMES = new Set([
  'http:', 'https:', 'ws:', 'wss:', 'file:', 'javascript:', 'data:', 'blob:', 'about:',
  'filesystem:', 'chrome:', 'chrome-extension:', 'devtools:', 'view-source:',
]);
// Launch descriptors that remote-desktop portals (e.g. Citrix) hand to a local client.
const LAUNCH_FILE_EXTENSIONS = new Set(['.ica']);

// Hands app links (receiver://, zoommtg://, ...) and launch files to the OS like
// Chrome's "Open <app>?" prompt. "Always allow" is remembered per origin + scheme.
function createExternalApps({ app, shell, dialog, getWindow, file }) {
  let allowed = {};
  try { allowed = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { allowed = {}; }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(allowed, null, 2));
  };
  const originOf = (url) => { try { const { origin } = new URL(url); return origin === 'null' ? '' : origin; } catch { return ''; } };
  // One prompt at a time so a page cannot stack dialogs by retrying a link.
  let prompting = false;
  const confirm = async (origin, kind, appName) => {
    const host = origin ? new URL(origin).host : '이 페이지';
    if (origin && allowed[origin]?.includes(kind)) return true;
    if (prompting) return false;
    prompting = true;
    try { return await ask(origin, host, kind, appName); } finally { prompting = false; }
  };
  const ask = async (origin, host, kind, appName) => {
    const window = getWindow();
    const options = {
      type: 'question', title: '외부 프로그램 열기',
      message: `${host}에서 ${appName || '외부 프로그램'}을(를) 열려고 합니다.`,
      detail: '열기를 누르면 이 컴퓨터에 설치된 프로그램이 실행됩니다.',
      buttons: ['열기', '취소'], defaultId: 0, cancelId: 1, noLink: true,
      ...(origin ? { checkboxLabel: `${host}에서 이 유형은 항상 열기` } : {}),
    };
    const { response, checkboxChecked } = window && !window.isDestroyed()
      ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    if (checkboxChecked && origin) {
      allowed[origin] = [...new Set([...(allowed[origin] || []), kind])];
      save();
    }
    return true;
  };
  return {
    isAppLink(url) {
      try { return !INTERNAL_SCHEMES.has(new URL(url).protocol); } catch { return false; }
    },
    isLaunchFile: (filename) => LAUNCH_FILE_EXTENSIONS.has(path.extname(filename).toLowerCase()),
    // Ignores links no installed app can handle, as Chrome does silently.
    async openLink(url, pageUrl) {
      const scheme = new URL(url).protocol;
      const appName = app.getApplicationNameForProtocol(url);
      if (!appName) return false;
      if (!await confirm(originOf(pageUrl), scheme, appName)) return false;
      await shell.openExternal(url);
      return true;
    },
    async openLaunchFile(filePath, sourceUrl) {
      if (!await confirm(originOf(sourceUrl), path.extname(filePath).toLowerCase(), '')) return false;
      return !await shell.openPath(filePath);
    },
  };
}

module.exports = { createExternalApps };
