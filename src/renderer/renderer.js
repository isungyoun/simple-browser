const elements = {
  tabs: document.querySelector('#tabs'),
  address: document.querySelector('#address'),
  addressForm: document.querySelector('#address-form'),
  back: document.querySelector('#back'),
  forward: document.querySelector('#forward'),
  reload: document.querySelector('#reload'),
  home: document.querySelector('#home'),
  newTab: document.querySelector('#new-tab'),
  bookmark: document.querySelector('#bookmark'),
  bookmarks: document.querySelector('#bookmarks'),
};

let state = { tabs: [], activeTabId: null, bookmarks: [] };
let lastActiveTabId = null;
let lastTabCount = 0;

function makeButton(className, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function renderTabs() {
  const previousScroll = elements.tabs.scrollLeft;
  const revealActive = state.activeTabId !== lastActiveTabId || state.tabs.length !== lastTabCount;
  elements.tabs.replaceChildren();
  for (const tab of state.tabs) {
    const tabButton = document.createElement('div');
    tabButton.className = `tab${tab.id === state.activeTabId ? ' active' : ''}`;
    tabButton.tabIndex = 0;
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', String(tab.id === state.activeTabId));
    tabButton.title = tab.title;

    if (tab.favicon) {
      const icon = document.createElement('img');
      icon.className = 'tab-icon';
      icon.src = tab.favicon;
      icon.alt = '';
      tabButton.append(icon);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'tab-placeholder';
      placeholder.textContent = tab.loading ? '●' : '◆';
      tabButton.append(placeholder);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title;
    tabButton.append(title);

    const close = makeButton('tab-close', '×');
    close.setAttribute('aria-label', `${tab.title} 닫기`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      window.syBrowser.closeTab(tab.id);
    });
    tabButton.append(close);
    tabButton.addEventListener('click', () => window.syBrowser.activateTab(tab.id));
    tabButton.addEventListener('keydown', (event) => {
      if (event.target === tabButton && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        window.syBrowser.activateTab(tab.id);
      }
    });
    elements.tabs.append(tabButton);
  }
  elements.tabs.scrollLeft = previousScroll;
  updateTabScrollButtons();
  if (revealActive) {
    elements.tabs.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  lastActiveTabId = state.activeTabId;
  lastTabCount = state.tabs.length;
  updateTabScrollButtons();
}

function updateTabScrollButtons() {
  const overflow = elements.tabs.scrollWidth > elements.tabs.clientWidth + 1;
  const left = document.querySelector('#tabs-left');
  const right = document.querySelector('#tabs-right');
  left.hidden = right.hidden = !overflow;
  left.disabled = elements.tabs.scrollLeft <= 1;
  right.disabled = elements.tabs.scrollLeft + elements.tabs.clientWidth >= elements.tabs.scrollWidth - 1;
}

document.querySelector('#tabs-left').addEventListener('click', () => elements.tabs.scrollBy({ left: -elements.tabs.clientWidth * 0.7, behavior: 'smooth' }));
document.querySelector('#tabs-right').addEventListener('click', () => elements.tabs.scrollBy({ left: elements.tabs.clientWidth * 0.7, behavior: 'smooth' }));
elements.tabs.addEventListener('scroll', updateTabScrollButtons);
elements.tabs.addEventListener('wheel', (event) => {
  if (elements.tabs.scrollWidth <= elements.tabs.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  event.preventDefault();
  elements.tabs.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? elements.tabs.clientWidth : 1);
}, { passive: false });
new ResizeObserver(updateTabScrollButtons).observe(elements.tabs);
window.addEventListener('resize', () => {
  updateTabScrollButtons();
  elements.tabs.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});

function renderBookmarks() {
  elements.bookmarks.replaceChildren();
  for (const bookmark of state.bookmarks) {
    const button = makeButton('bookmark-link', bookmark.title);
    button.title = bookmark.url;
    button.addEventListener('click', () => window.syBrowser.navigate(bookmark.url));
    elements.bookmarks.append(button);
  }
}

function render(nextState) {
  state = nextState;
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  renderTabs();
  renderBookmarks();
  if (!elements.address.matches(':focus')) elements.address.value = active?.url || '';
  elements.back.disabled = !active?.canGoBack;
  elements.forward.disabled = !active?.canGoForward;
  elements.reload.textContent = active?.loading ? '×' : '↻';
  elements.reload.title = active?.loading ? '불러오기 중지' : '새로고침 (⌘R)';
  elements.bookmark.textContent = active?.bookmarked ? '★' : '☆';
  elements.bookmark.classList.toggle('active', Boolean(active?.bookmarked));
  elements.bookmark.title = active?.bookmarked ? '북마크 삭제' : '북마크 추가';
  renderDownloads();
  renderPasswords();
}

elements.addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  window.syBrowser.navigate(elements.address.value);
  elements.address.blur();
});
elements.address.addEventListener('focus', () => elements.address.select());
elements.newTab.addEventListener('click', () => window.syBrowser.newTab());
elements.back.addEventListener('click', () => window.syBrowser.back());
elements.forward.addEventListener('click', () => window.syBrowser.forward());
elements.home.addEventListener('click', () => window.syBrowser.home());
elements.reload.addEventListener('click', () => {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return active?.loading ? window.syBrowser.stop() : window.syBrowser.reload();
});
elements.bookmark.addEventListener('click', () => window.syBrowser.toggleBookmark());

window.syBrowser.onState(render);
window.syBrowser.onFocusAddress(() => {
  elements.address.focus();
  elements.address.select();
});
window.syBrowser.getState().then(render);

const settingsPanel = document.querySelector('#settings-panel');
const downloadsPanel = document.querySelector('#downloads-panel');
const settingsError = document.querySelector('#settings-error');
window.syBrowser.onPanelOpen((panel) => {
  const settingsWereOpen = !settingsPanel.hidden;
  const downloadsWereOpen = !downloadsPanel.hidden;
  settingsPanel.hidden = panel !== 'settings';
  downloadsPanel.hidden = panel !== 'downloads';
  if (panel === 'settings') {
    document.querySelector('#homepage').value = state.settings?.homepage || '';
    document.querySelector('#block-ads').checked = Boolean(state.settings?.blockAds);
    settingsError.textContent = '';
    document.querySelector('#homepage').focus();
  } else if (panel === 'downloads') {
    downloadsPanel.scrollTop = 0;
    document.querySelector('#downloads-close').focus();
  } else if (downloadsWereOpen) document.querySelector('#downloads-button').focus();
  else if (settingsWereOpen) document.querySelector('#settings-button').focus();
});
document.querySelector('#settings-button').addEventListener('click', () => window.syBrowser.showSettings(true));
document.querySelector('#password-button').addEventListener('click', () => window.syBrowser.fillPassword());
document.querySelector('#downloads-button').addEventListener('click', () => {
  window.syBrowser.showDownloads(downloadsPanel.hidden);
});
document.querySelector('#downloads-close').addEventListener('click', () => window.syBrowser.showDownloads(false));
document.querySelector('#settings-cancel').addEventListener('click', () => window.syBrowser.showSettings(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (!settingsPanel.hidden || !downloadsPanel.hidden)) window.syBrowser.showSettings(false);
});

function renderDownloads() {
  const list = document.querySelector('#download-list');
  list.replaceChildren();
  const labels = { progressing: '다운로드 중', interrupted: '연결 끊김', completed: '완료', cancelled: '취소됨' };
  const entries = state.downloads || [];
  const active = entries.filter((entry) => !entry.done).length;
  document.querySelector('#downloads-button').textContent = active ? `↓${active}` : '↓';
  if (!entries.length) list.textContent = '아직 다운로드한 파일이 없습니다.';
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const label = document.createElement('span');
    const progress = entry.total ? ` ${Math.round(entry.received / entry.total * 100)}%` : ` ${(entry.received / 1024).toFixed(0)} KB`;
    label.textContent = `${entry.filename} · ${labels[entry.state] || entry.state}${entry.done ? '' : progress}`;
    row.append(label);
    if (entry.state === 'completed') {
      const button = makeButton('', '폴더에서 보기');
      button.addEventListener('click', () => window.syBrowser.revealDownload(entry.id));
      row.append(button);
    } else if (!entry.done) {
      if (entry.state === 'interrupted') {
        const resume = makeButton('', '재개');
        resume.addEventListener('click', () => window.syBrowser.resumeDownload(entry.id));
        row.append(resume);
      }
      const cancel = makeButton('', '취소');
      cancel.addEventListener('click', () => window.syBrowser.cancelDownload(entry.id));
      row.append(cancel);
    }
    list.append(row);
  }
}

function renderPasswords() {
  document.querySelector('#password-button').disabled = !state.passwordStorageAvailable;
  document.querySelector('#password-storage-status').textContent = state.passwordStorageAvailable ? '운영체제 보안 기능으로 암호화하여 저장합니다. 계정이 하나면 같은 사이트에서 자동으로 채우고, 여러 개면 열쇠 버튼으로 선택하세요.' : '운영체제 암호화 저장소를 사용할 수 없습니다.';
  const list = document.querySelector('#password-list');
  list.replaceChildren();
  if (!state.passwords?.length) list.textContent = '저장된 계정이 없습니다.';
  for (const account of state.passwords || []) {
    const row = document.createElement('div');
    row.className = 'saved-row';
    const label = document.createElement('span');
    label.textContent = `${account.origin} · ${account.username}`;
    const button = makeButton('', '삭제');
    button.addEventListener('click', async () => {
      try { await window.syBrowser.deletePassword(account.id); }
      catch (error) { settingsError.textContent = error.message; }
    });
    row.append(label, button);
    list.append(row);
  }
}
document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await window.syBrowser.saveSettings({
      homepage: document.querySelector('#homepage').value,
      blockAds: document.querySelector('#block-ads').checked,
    });
    await window.syBrowser.showSettings(false);
  } catch (error) { settingsError.textContent = error.message; }
});
