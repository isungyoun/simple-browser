const path = require('node:path');

function trackDownloads(browserSession, { app, shell, getWindow, onChange, smokeTest }) {
  const entries = new Map();
  let nextId = 1;
  const updateProgress = () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    const active = [...entries.values()].filter((entry) => !entry.done);
    const total = active.reduce((sum, entry) => sum + entry.total, 0);
    const received = active.reduce((sum, entry) => sum + entry.received, 0);
    window.setProgressBar(active.length ? (total ? received / total : 2) : -1);
  };
  browserSession.on('will-download', (_event, item) => {
    const filename = path.basename(item.getFilename().replace(/\\/g, '/')) || 'download';
    if (smokeTest) item.setSavePath(path.join(app.getPath('userData'), filename));
    else item.setSaveDialogOptions({ title: '파일 저장', defaultPath: path.join(app.getPath('downloads'), filename) });
    const entry = { id: nextId++, filename, state: 'progressing', received: 0, total: item.getTotalBytes(), path: '', done: false, item };
    entries.set(entry.id, entry);
    const changed = () => { updateProgress(); onChange(); };
    item.on('updated', (_event, state) => {
      entry.state = state;
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes();
      changed();
    });
    item.once('done', (_event, state) => {
      entry.state = state;
      entry.done = true;
      entry.received = item.getReceivedBytes();
      entry.path = state === 'completed' ? item.getSavePath() : '';
      delete entry.item;
      changed();
    });
    // Bound history without removing active transfers.
    for (const [id, old] of entries) if (entries.size > 100 && old.done) entries.delete(id);
    changed();
  });
  return {
    list: () => [...entries.values()].map(({ item, path: savePath, ...entry }) => entry).reverse(),
    reveal: (id) => { const entry = entries.get(Number(id)); if (entry?.state === 'completed' && entry.path) shell.showItemInFolder(entry.path); },
    cancel: (id) => entries.get(Number(id))?.item?.cancel(),
    resume: (id) => { const item = entries.get(Number(id))?.item; if (item?.canResume()) item.resume(); },
  };
}

module.exports = { trackDownloads };
