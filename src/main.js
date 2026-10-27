const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  session,
  dialog,
  shell,
  safeStorage,
} = require('electron');
const { normalizeAddress, addressForDisplay } = require('./navigation');
const { DEFAULT_SETTINGS, validateSettings, isAdRequest } = require('./settings');
const { createPasswordStore } = require('./password-store');
const { trackDownloads } = require('./downloads');
app.setName('simple-browser');
process.title = 'simple-browser';
app.setAboutPanelOptions({ applicationName: 'simple-browser', applicationVersion: app.getVersion() });
const adblockScript = fs.readFileSync(path.join(__dirname, 'adblock.js'), 'utf8');

const TOOLBAR_HEIGHT = 118;
const MIN_WIDTH = 720;
const MIN_HEIGHT = 520;
const tabs = new Map();
let window;
let activeTabId = null;
let nextTabId = 1;
let bookmarks = [];
let bookmarksPath;
let settings = { ...DEFAULT_SETTINGS };
let settingsPath;
let activePanel = null;
let passwordStore;
let downloads;

async function offerPassword(event, value) {
  const tab = [...tabs.values()].find((tab) => tab.view.webContents.id === event.sender.id);
  if (!tab || tab.savingPassword || !passwordStore.available() || event.senderFrame !== event.sender.mainFrame) return;
  if (!value || typeof value.username !== 'string' || typeof value.password !== 'string' || !value.username || !value.password || value.username.length > 1000 || value.password.length > 10000) return;
  const url = new URL(event.senderFrame.url);
  if (value.origin !== url.origin) return;
  if (url.protocol !== 'https:' && !(smokeTest && url.hostname === '127.0.0.1')) return;
  if (passwordStore.find(url.origin, value.username)?.password === value.password) return;
  tab.savingPassword = true;
  try {
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: '암호 저장', message: `${url.hostname}의 암호를 저장할까요?`,
      detail: `계정: ${value.username}\n다음 로그인 때 같은 사이트의 입력란에 채워집니다. 계정이 여러 개면 열쇠 버튼에서 선택하세요.`,
      buttons: ['저장', '나중에'], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (result.response === 0) {
      passwordStore.save(url.origin, value.username, value.password);
      broadcastState();
    }
  } catch (error) {
    if (window && !window.isDestroyed()) dialog.showErrorBox('암호 저장 실패', error.message);
  } finally { tab.savingPassword = false; }
}

async function fillPassword() {
  const contents = activeContents();
  if (!contents || !passwordStore.available()) return;
  let origin;
  try { origin = new URL(contents.getURL()).origin; } catch { return; }
  const accounts = passwordStore.list().filter((entry) => entry.origin === origin).slice(0, 20);
  if (!accounts.length) {
    await dialog.showMessageBox(window, { message: '이 사이트에 저장된 암호가 없습니다.', detail: '로그인 양식을 제출하면 암호 저장 여부를 묻습니다.' });
    return;
  }
  const { response } = await dialog.showMessageBox(window, {
    title: '저장된 암호 채우기', message: `${origin}에 사용할 계정을 선택하세요.`,
    buttons: [...accounts.map((entry) => entry.username), '취소'], cancelId: accounts.length, noLink: true,
  });
  if (response >= accounts.length || contents.isDestroyed()) return;
  const account = accounts[response];
  const saved = passwordStore.find(origin, account.username);
  if (!saved || new URL(contents.getURL()).origin !== origin) return;
  const filled = await contents.executeJavaScript(`(() => {
    const origin = ${JSON.stringify(origin)};
    if (location.origin !== origin) return false;
    const password = [...document.querySelectorAll('input[type="password"]')].find(input => input.autocomplete !== 'new-password' && input.getClientRects().length);
    if (!password) return false;
    const scope = password.form || document;
    const username = scope.querySelector('input[autocomplete="username"], input[type="email"]') || [...scope.querySelectorAll('input')].filter(input => input.type === 'text' && input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [input, value] of [[username, ${JSON.stringify(saved.username)}], [password, ${JSON.stringify(saved.password)}]]) {
      if (!input) continue;
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    password.focus();
    return true;
  })()`).catch(() => false);
  if (!filled) await dialog.showMessageBox(window, { message: '이 페이지에서 로그인 암호 입력란을 찾지 못했습니다.' });
}

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try { settings = validateSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))); }
  catch { settings = { ...DEFAULT_SETTINGS }; }
}

async function applyAdBlocking(contents) {
  if (contents.isDestroyed() || !/^https?:/i.test(contents.getURL())) return;
  await contents.executeJavaScript(settings.blockAds ? adblockScript : 'window.__simpleBrowserAdCleanup?.()').catch(() => {});
}

async function saveSettings(value) {
  const next = validateSettings(value);
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
  settings = next;
  await Promise.all([...tabs.values()].map((tab) => applyAdBlocking(tab.view.webContents)));
  broadcastState();
  return settings;
}

function showSettings(open) {
  showPanel(open ? 'settings' : null);
}

function showPanel(panel) {
  if (panel !== null && !['settings', 'downloads'].includes(panel)) return;
  activePanel = panel;
  tabs.get(activeTabId)?.view.setVisible(!activePanel);
  if (activePanel) window.webContents.focus();
  else activeContents()?.focus();
  window.webContents.send('browser:panel-open', activePanel);
}

const newTabPath = path.join(__dirname, 'renderer', 'newtab.html');
const newTabUrl = pathToFileURL(newTabPath).href;
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) app.setPath('userData', path.join(__dirname, '..', 'work', 'smoke-profile'));

function isMac() {
  return process.platform === 'darwin';
}

function isTrustedShellSender(event) {
  return Boolean(window && !window.isDestroyed() && event.sender.id === window.webContents.id);
}

function loadBookmarks() {
  bookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');
  try {
    const value = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
    bookmarks = Array.isArray(value) ? value.filter((item) => item && item.url && item.title) : [];
  } catch {
    bookmarks = [];
  }
}

function saveBookmarks() {
  fs.mkdirSync(path.dirname(bookmarksPath), { recursive: true });
  fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarks, null, 2));
}

function tabSnapshot(tab) {
  const contents = tab.view.webContents;
  const rawUrl = contents.getURL();
  return {
    id: tab.id,
    title: tab.title || '새 탭',
    url: addressForDisplay(rawUrl, newTabUrl),
    loading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
    favicon: tab.favicon,
    bookmarked: bookmarks.some((item) => item.url === rawUrl),
  };
}

function appState() {
  return {
    tabs: [...tabs.values()].map(tabSnapshot),
    activeTabId,
    bookmarks,
    settings,
    downloads: downloads?.list() || [],
    passwords: passwordStore?.list() || [],
    passwordStorageAvailable: passwordStore?.available() || false,
  };
}

function broadcastState() {
  if (window && !window.isDestroyed()) window.webContents.send('browser:state', appState());
}

function resizeActiveView() {
  if (!window || window.isDestroyed() || activeTabId === null) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const [width, height] = window.getContentSize();
  tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
}

function focusAddress() {
  if (window && !window.isDestroyed()) {
    window.webContents.focus();
    window.webContents.send('browser:focus-address');
  }
}

function handleShortcut(input) {
  const command = isMac() ? input.meta : input.control;
  if (input.type !== 'keyDown') return false;

  if (input.key === 'F12' || (command && (isMac() ? input.alt : input.shift) && input.key.toLowerCase() === 'i')) {
    toggleTabDevTools();
    return true;
  }

  if (command && input.key.toLowerCase() === 'l') {
    focusAddress();
    return true;
  }
  if (command && input.key.toLowerCase() === 't') {
    createTab();
    return true;
  }
  if (command && input.key.toLowerCase() === 'w') {
    closeTab(activeTabId);
    return true;
  }
  if (command && input.key.toLowerCase() === 'r') {
    tabs.get(activeTabId)?.view.webContents.reload();
    return true;
  }
  if (input.alt && input.key === 'Left') {
    goBack();
    return true;
  }
  if (input.alt && input.key === 'Right') {
    goForward();
    return true;
  }
  return false;
}

function attachShortcuts(contents) {
  contents.on('before-input-event', (event, input) => {
    if (handleShortcut(input)) event.preventDefault();
  });
}

function attachTabEvents(tab) {
  const contents = tab.view.webContents;
  const changed = () => broadcastState();

  contents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    tab.title = title || '새 탭';
    changed();
  });
  contents.on('page-favicon-updated', (_event, favicons) => {
    tab.favicon = favicons.find((url) => /^https?:/i.test(url)) || null;
    changed();
  });
  contents.on('did-start-loading', changed);
  contents.on('did-stop-loading', changed);
  contents.on('dom-ready', () => applyAdBlocking(contents));
  contents.on('did-navigate', changed);
  contents.on('did-navigate-in-page', changed);
  contents.on('render-process-gone', (_event, details) => {
    tab.title = details.reason === 'crashed' ? '탭이 비정상 종료됨' : '탭을 불러올 수 없음';
    changed();
  });
  contents.on('context-menu', (_event, params) => {
    const items = [];
    const download = (url) => contents.downloadURL(url, { headers: [`Referer: ${contents.getURL()}`] });
    if (params.mediaType === 'image' && /^(https?:|blob:|data:)/i.test(params.srcURL)) {
      items.push({ label: '이미지 다른 이름으로 저장…', click: () => download(params.srcURL) });
      if (/^https?:/i.test(params.srcURL)) items.push({ label: '이미지를 새 탭에서 열기', click: () => createTab(params.srcURL) });
      items.push({ label: '이미지 주소 복사', click: () => require('electron').clipboard.writeText(params.srcURL) });
    }
    if (/^https?:/i.test(params.linkURL)) {
      items.push({ label: '링크를 새 탭에서 열기', click: () => createTab(params.linkURL) });
      items.push({ label: '링크 다른 이름으로 저장…', click: () => download(params.linkURL) });
    }
    if (params.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) items.push({ role: 'copy' });
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: '뒤로', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    items.push({ label: '새로고침', click: () => contents.reload() });
    items.push({ label: '검사', click: () => contents.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup({ window });
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:/i.test(url) && url !== 'about:blank' && !/^blob:/i.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: path.join(__dirname, 'tab-preload.js'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
        },
      },
      createWindow: (options) => {
        // Let Chromium perform the initial navigation, preserving POST bodies,
        // cookies, referrer and window.opener used by login/download popups.
        const id = createTab(undefined, undefined, false, options);
        return tabs.get(id).view.webContents;
      },
    };
  });
  contents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url) && url !== newTabUrl && url !== 'about:blank') {
      event.preventDefault();
    }
  });
  attachShortcuts(contents);
}

function createTab(rawUrl, loadOptions, loadInitialPage = true, popupOptions = {}) {
  const id = nextTabId++;
  const view = new WebContentsView(popupOptions.webContents ? {
    // Chromium may have already created the popup. Adopt that exact instance;
    // returning a replacement breaks window.open and triggers Invalid webContents.
    webContents: popupOptions.webContents,
  } : {
    webPreferences: {
      ...popupOptions.webPreferences,
      preload: path.join(__dirname, 'tab-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      partition: 'persist:sy-browser',
    },
  });
  const tab = { id, view, title: '새 탭', favicon: null };
  tabs.set(id, tab);
  attachTabEvents(tab);
  activateTab(id);
  if (loadInitialPage) loadPage(view.webContents, rawUrl ? normalizeAddress(rawUrl) : newTabUrl, loadOptions);
  return id;
}

function activateTab(id) {
  const tab = tabs.get(Number(id));
  if (!tab || !window) return;

  if (activeTabId !== null) {
    const previous = tabs.get(activeTabId);
    if (previous) window.contentView.removeChildView(previous.view);
  }
  activeTabId = tab.id;
  window.contentView.addChildView(tab.view);
  tab.view.setVisible(!activePanel);
  resizeActiveView();
  if (!activePanel) tab.view.webContents.focus();
  broadcastState();
}

function closeTab(id) {
  const numericId = Number(id);
  const tab = tabs.get(numericId);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const index = ids.indexOf(numericId);
  window.contentView.removeChildView(tab.view);
  tabs.delete(numericId);
  tab.view.webContents.close();

  if (tabs.size === 0) {
    createTab();
  } else if (activeTabId === numericId) {
    const remainingIds = [...tabs.keys()];
    activateTab(remainingIds[Math.min(index, remainingIds.length - 1)]);
  } else {
    broadcastState();
  }
}

function activeContents() {
  return tabs.get(activeTabId)?.view.webContents;
}

function toggleTabDevTools() {
  activeContents()?.toggleDevTools();
}

function createApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac() ? [{ label: app.name, submenu: [
      { role: 'about' },
      { label: '설정…', accelerator: 'Command+,', click: () => showSettings(true) },
      { type: 'separator' }, { role: 'services' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { label: '설정…', click: () => showSettings(true) },
        { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => activeContents()?.reload() },
        { label: '캐시 없이 새로고침', accelerator: 'CmdOrCtrl+Shift+R', click: () => activeContents()?.reloadIgnoringCache() },
        {
          label: '개발자 도구',
          accelerator: isMac() ? 'Alt+Command+I' : 'Control+Shift+I',
          click: toggleTabDevTools,
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

function navigate(rawAddress) {
  const url = normalizeAddress(rawAddress);
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (activePanel) showPanel(null);
  loadPage(activeContents(), url);
}

function loadPage(contents, url, options) {
  if (!contents) return;
  contents.loadURL(url, options).catch((error) => {
    if (error.code !== 'ERR_ABORTED') console.error('페이지 로딩 실패:', error.message);
  });
}

function goBack() {
  const contents = activeContents();
  if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
}

function goForward() {
  const contents = activeContents();
  if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
}

function toggleBookmark() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const url = tab.view.webContents.getURL();
  if (!/^https?:/i.test(url)) return;
  const index = bookmarks.findIndex((item) => item.url === url);
  if (index >= 0) bookmarks.splice(index, 1);
  else bookmarks.push({ title: tab.title || url, url });
  saveBookmarks();
  broadcastState();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'simple-browser',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    titleBarStyle: isMac() ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac() ? { x: 14, y: 17 } : undefined,
    backgroundColor: '#f7f8fc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.on('resize', resizeActiveView);
  window.on('closed', () => {
    for (const tab of tabs.values()) tab.view.webContents.close();
    tabs.clear();
    window = null;
  });
  attachShortcuts(window.webContents);
  window.webContents.once('did-finish-load', async () => {
    createTab();
    if (smokeTest) {
      try {
        await runSmokeTest();
        console.log('SMOKE PASS: window, tabs, navigation, bookmarks, isolation, DevTools, settings, downloads, popup POST, blob download');
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    }
  });
}

async function runSmokeTest() {
  const assert = require('node:assert/strict');
  const http = require('node:http');
  let popupPosted = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/login-form') {
      response.end(`<form action="/login-done" method="post"><input id="id" name="id" type="text"><input id="pw" name="pw" type="password"><button id="loginBtn_column" type="button">로그인</button></form><script>
        document.querySelector('button').addEventListener('click', () => {
          document.querySelector('#id').value = '';
          document.querySelector('#pw').value = '';
          document.querySelector('form').submit();
        });
      </script>`);
      return;
    }
    if (request.url?.startsWith('/popup-check')) {
      response.end(`<title>${request.headers.cookie?.includes('popup-session=present') ? 'popup session preserved' : 'missing session'}</title><h1>popup</h1>`);
      return;
    }
    if (request.url === '/post-download') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        popupPosted = request.method === 'POST' && body === 'token=login-session';
        response.setHeader('Content-Disposition', 'attachment; filename="smoke-popup.txt"');
        response.end('popup download');
      });
      return;
    }
    if (request.url === '/download') {
      response.setHeader('Content-Disposition', 'attachment; filename="smoke-download.txt"');
      response.end('simple-browser download test');
      return;
    }
    response.end('<title>sy smoke page</title><h1>sy browser works</h1>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const first = activeTabId;
    const second = createTab();
    assert.equal(tabs.size, 2);
    activateTab(first);
    assert.equal(activeTabId, first);
    const contents = activeContents();
    await contents.loadURL(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(contents.getTitle(), 'sy smoke page');
    assert.equal(await contents.executeJavaScript('typeof process'), 'undefined');
    await contents.session.cookies.set({ url: `http://127.0.0.1:${server.address().port}/`, name: 'popup-session', value: 'present' });
    const openAndCheckPopup = async (script) => {
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { app.removeListener('web-contents-created', created); reject(new Error('Popup failed to load')); }, 10000);
        const created = (_event, child) => child.once('did-finish-load', () => { clearTimeout(timer); resolve(child); });
        app.once('web-contents-created', created);
      });
      await contents.executeJavaScript(script, true);
      const child = await loaded;
      assert.equal(child.getTitle(), 'popup session preserved');
      assert.equal(await child.executeJavaScript('typeof process'), 'undefined');
      const tab = [...tabs.values()].find((tab) => tab.view.webContents === child);
      assert.ok(tab, 'Popup must adopt Chromium webContents into a browser tab');
      closeTab(tab.id);
      activateTab(first);
    };
    await openAndCheckPopup(`(() => {
      const link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener';
      link.href = '/popup-check?anchor'; document.body.append(link); link.click();
    })()`);
    await openAndCheckPopup(`window.open('/popup-check?script', '_blank', 'noopener'); true`);

    // Capture a trusted click before a Naver-style handler clears fields and
    // calls form.submit(). Observe the IPC without displaying a save dialog.
    tabs.get(first).savingPassword = true;
    try {
      await contents.loadURL(`http://127.0.0.1:${server.address().port}/login-form`);
      const captured = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ipcMain.removeListener('password:offer', listener); reject(new Error('Login capture timed out')); }, 10000);
        const listener = (_event, value) => { clearTimeout(timer); resolve(value); };
        ipcMain.once('password:offer', listener);
      });
      const submitted = new Promise((resolve) => contents.once('did-finish-load', resolve));
      const point = await contents.executeJavaScript(`(() => {
        document.querySelector('#id').value = 'smoke-login-user';
        document.querySelector('#pw').value = 'smoke-test-password';
        const bounds = document.querySelector('button').getBoundingClientRect();
        return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
      })()`);
      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
      const credentials = await captured;
      assert.equal(credentials.username, 'smoke-login-user');
      assert.equal(credentials.password, 'smoke-test-password');
      await submitted;
      assert.ok(contents.getURL().endsWith('/login-done'));
    } finally { tabs.get(first).savingPassword = false; }
    const devToolsOpened = new Promise((resolve) => contents.once('devtools-opened', resolve));
    toggleTabDevTools();
    await devToolsOpened;
    assert.equal(contents.isDevToolsOpened(), true);
    assert.equal(window.webContents.isDevToolsOpened(), false);
    const devToolsClosed = new Promise((resolve) => contents.once('devtools-closed', resolve));
    toggleTabDevTools();
    await devToolsClosed;
    toggleBookmark();
    assert.equal(tabSnapshot(tabs.get(first)).bookmarked, true);
    toggleBookmark();
    closeTab(second);
    assert.equal(tabs.size, 1);
    const waitForDownload = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Download timed out')), 15000);
      contents.session.once('will-download', (_event, item) => item.once('done', (_event, state) => {
        clearTimeout(timer);
        if (state !== 'completed') reject(new Error(`Download ${state}`));
        else resolve(item.getSavePath());
      }));
    });
    const downloadDone = waitForDownload();
    contents.downloadURL(`http://127.0.0.1:${server.address().port}/download`);
    assert.equal(fs.readFileSync(await downloadDone, 'utf8'), 'simple-browser download test');
    assert.equal(downloads.list()[0].state, 'completed');
    const popupDownload = waitForDownload();
    await contents.executeJavaScript(`(() => {
      const popup = window.open('about:blank', 'login-download');
      if (!popup) throw new Error('Login popup was blocked');
      const form = document.createElement('form');
      form.method = 'post'; form.target = 'login-download'; form.action = '/post-download';
      const input = document.createElement('input'); input.name = 'token'; input.value = 'login-session';
      form.append(input); document.body.append(form); form.submit();
    })()`, true);
    assert.equal(fs.readFileSync(await popupDownload, 'utf8'), 'popup download');
    assert.equal(popupPosted, true);
    activateTab(first);
    const blobDownload = waitForDownload();
    await contents.executeJavaScript(`(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['blob download'], { type: 'text/plain' }));
      a.download = 'smoke-blob.txt'; document.body.append(a); a.click();
    })()`, true);
    assert.equal(fs.readFileSync(await blobDownload, 'utf8'), 'blob download');
    assert.equal(await window.webContents.executeJavaScript(`new Promise(resolve => {
      window.syBrowser.onPanelOpen(panel => resolve(panel));
      document.querySelector('#downloads-button').click();
    })`), 'downloads');
    assert.deepEqual(await window.webContents.executeJavaScript(`({
      settingsHidden: document.querySelector('#settings-panel').hidden,
      downloadsHidden: document.querySelector('#downloads-panel').hidden,
      hasHomepage: Boolean(document.querySelector('#downloads-panel #homepage'))
    })`), { settingsHidden: true, downloadsHidden: false, hasHomepage: false });
    assert.equal(await window.webContents.executeJavaScript(`new Promise(resolve => {
      window.syBrowser.onPanelOpen(panel => resolve(panel));
      document.querySelector('#settings-button').click();
    })`), 'settings');
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("#downloads-panel").hidden'), true);
    assert.equal(tabs.get(first).view.getVisible(), false);
    await window.webContents.executeJavaScript('document.querySelector("#settings-panel").hidden').then((hidden) => assert.equal(hidden, false));
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.mkdirSync(path.join(__dirname, '..', 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'outputs', 'settings.png'), (await window.webContents.capturePage()).toPNG());
    for (const panel of ['settings', 'downloads']) {
      showPanel(panel);
      const navigated = new Promise((resolve) => contents.once('did-finish-load', resolve));
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('#address').value = ${JSON.stringify(`http://127.0.0.1:${server.address().port}/from-panel`)};
        document.querySelector('#address-form').requestSubmit();
      })()`);
      await navigated;
      assert.equal(activePanel, null);
      assert.equal(tabs.get(first).view.getVisible(), true);
      assert.equal(await window.webContents.executeJavaScript('document.querySelector("#settings-panel").hidden && document.querySelector("#downloads-panel").hidden'), true);
      assert.equal(contents.getURL(), `http://127.0.0.1:${server.address().port}/from-panel`);
    }
    assert.equal(tabs.get(first).view.getVisible(), true);
    const extraTabs = Array.from({ length: 12 }, () => createTab());
    window.setContentSize(900, 820);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const tabLayout = await window.webContents.executeJavaScript(`(() => {
      const tabs = document.querySelector('#tabs');
      const active = tabs.querySelector('.active').getBoundingClientRect();
      const bounds = tabs.getBoundingClientRect();
      const plus = document.querySelector('#new-tab').getBoundingClientRect();
      return { visible: active.left >= bounds.left - 1 && active.right <= bounds.right + 1, plusVisible: plus.right <= innerWidth, overflow: tabs.scrollWidth > tabs.clientWidth };
    })()`);
    assert.deepEqual(tabLayout, { visible: true, plusVisible: true, overflow: true });
    activateTab(first);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(resolve))');
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("#tabs").scrollLeft'), 0);
    assert.equal(await window.webContents.executeJavaScript(`(() => {
      const tabs = document.querySelector('#tabs');
      tabs.dispatchEvent(new WheelEvent('wheel', { deltaY: 180, cancelable: true }));
      return tabs.scrollLeft > 0;
    })()`), true);
    for (const id of extraTabs) closeTab(id);
    activateTab(first);
    fs.mkdirSync(path.join(__dirname, '..', 'outputs'), { recursive: true });
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, '..', 'outputs', 'sy-browser-shell.png'), image.toPNG());
  } finally {
    server.close();
  }
}

function registerIpc() {
  const trusted = (handler) => (event, ...args) => {
    if (!isTrustedShellSender(event)) return undefined;
    return handler(...args);
  };

  ipcMain.handle('browser:get-state', trusted(appState));
  ipcMain.on('password:offer', offerPassword);
  ipcMain.handle('password:lookup', (event) => {
    const tab = [...tabs.values()].find((tab) => tab.view.webContents.id === event.sender.id);
    if (!tab || event.senderFrame !== event.sender.mainFrame || !passwordStore.available()) return null;
    let url;
    try { url = new URL(event.senderFrame.url); } catch { return null; }
    if (url.protocol !== 'https:') return null;
    const accounts = passwordStore.list().filter((account) => account.origin === url.origin);
    if (accounts.length !== 1) return null;
    const account = passwordStore.find(url.origin, accounts[0].username);
    return { origin: url.origin, username: account.username, password: account.password };
  });
  ipcMain.handle('browser:fill-password', trusted(fillPassword));
  ipcMain.handle('browser:delete-password', trusted((id) => { passwordStore.remove(id); broadcastState(); }));
  ipcMain.handle('browser:reveal-download', trusted((id) => downloads.reveal(id)));
  ipcMain.handle('browser:cancel-download', trusted((id) => downloads.cancel(id)));
  ipcMain.handle('browser:resume-download', trusted((id) => downloads.resume(id)));
  ipcMain.handle('browser:save-settings', trusted(saveSettings));
  ipcMain.handle('browser:show-settings', trusted(showSettings));
  ipcMain.handle('browser:show-downloads', trusted((open) => showPanel(open ? 'downloads' : null)));
  ipcMain.handle('browser:new-tab', trusted((url) => createTab(url)));
  ipcMain.handle('browser:activate-tab', trusted(activateTab));
  ipcMain.handle('browser:close-tab', trusted(closeTab));
  ipcMain.handle('browser:navigate', trusted(navigate));
  ipcMain.handle('browser:back', trusted(goBack));
  ipcMain.handle('browser:forward', trusted(goForward));
  ipcMain.handle('browser:reload', trusted(() => activeContents()?.reload()));
  ipcMain.handle('browser:stop', trusted(() => activeContents()?.stop()));
  ipcMain.handle('browser:home', trusted(() => loadPage(activeContents(), settings.homepage || newTabUrl)));
  ipcMain.handle('browser:toggle-bookmark', trusted(toggleBookmark));
}

app.whenReady().then(() => {
  if (isMac()) app.dock.setIcon(path.join(__dirname, 'renderer', 'assets', 'icon.png'));
  loadBookmarks();
  loadSettings();
  passwordStore = createPasswordStore(safeStorage, path.join(app.getPath('userData'), 'passwords.enc'));
  downloads = trackDownloads(session.fromPartition('persist:sy-browser'), { app, shell, getWindow: () => window, onChange: broadcastState, smokeTest });
  if (smokeTest) fs.mkdirSync(path.join(__dirname, '..', 'outputs'), { recursive: true });
  registerIpc();
  createApplicationMenu();
  session.fromPartition('persist:sy-browser').setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.fromPartition('persist:sy-browser').setPermissionCheckHandler(() => false);
  session.fromPartition('persist:sy-browser').webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: settings.blockAds && isAdRequest(details.url, details.resourceType) });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac()) app.quit();
});
