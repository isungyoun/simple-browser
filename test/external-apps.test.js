const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExternalApps } = require('../src/external-apps');

const setup = (responses, appName = 'Citrix Workspace') => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-external-test-'));
  const opened = [];
  const prompts = [];
  const deps = {
    app: { getApplicationNameForProtocol: () => appName },
    shell: { openExternal: async (url) => { opened.push(url); }, openPath: async (file) => { opened.push(file); return ''; } },
    dialog: { showMessageBox: async (_window, options) => { prompts.push(options); return responses.shift() || { response: 1 }; } },
    getWindow: () => ({ isDestroyed: () => false }),
    file: path.join(directory, 'external-apps.json'),
  };
  return { deps, opened, prompts, directory, apps: createExternalApps(deps) };
};

test('classifies app links and keeps web and dangerous schemes internal', () => {
  const { apps, directory } = setup([]);
  try {
    assert.equal(apps.isAppLink('receiver://launch?x=1'), true);
    assert.equal(apps.isAppLink('citrixreceiver:open'), true);
    for (const url of ['https://a.com', 'http://a.com', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'about:blank', 'blob:https://a.com/1', 'chrome://settings', 'not a url']) {
      assert.equal(apps.isAppLink(url), false, url);
    }
    assert.equal(apps.isLaunchFile('launch.ICA'), true);
    assert.equal(apps.isLaunchFile('report.pdf'), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('asks before opening, remembers "always" per origin and scheme', async () => {
  const { apps, opened, prompts, deps, directory } = setup([{ response: 1 }, { response: 0, checkboxChecked: true }]);
  try {
    assert.equal(await apps.openLink('receiver://a', 'https://mydesk.example.com/Vdi/Main'), false);
    assert.deepEqual(opened, []);
    assert.equal(await apps.openLink('receiver://b', 'https://mydesk.example.com/Vdi/Main'), true);
    assert.match(prompts[1].message, /mydesk\.example\.com.*Citrix Workspace/);
    // Remembered, even after a restart, without another prompt.
    const again = createExternalApps(deps);
    assert.equal(await again.openLink('receiver://c', 'https://mydesk.example.com/other'), true);
    assert.equal(prompts.length, 2);
    assert.deepEqual(opened, ['receiver://b', 'receiver://c']);
    // A different site still has to ask.
    assert.equal(await again.openLink('receiver://d', 'https://evil.example.com/'), false);
    assert.equal(prompts.length, 3);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ignores links with no installed app and opens launch files after consent', async () => {
  const none = setup([], '');
  try {
    assert.equal(await none.apps.openLink('unknownapp://x', 'https://a.com'), false);
    assert.equal(none.prompts.length, 0);
  } finally { fs.rmSync(none.directory, { recursive: true, force: true }); }
  const { apps, opened, directory } = setup([{ response: 0 }]);
  try {
    assert.equal(await apps.openLaunchFile('/tmp/launch.ica', 'https://mydesk.example.com/Vdi/Launch'), true);
    assert.deepEqual(opened, ['/tmp/launch.ica']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
