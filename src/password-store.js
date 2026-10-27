const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createPasswordStore(safeStorage, file) {
  const available = () => safeStorage.isEncryptionAvailable() &&
    (!safeStorage.getSelectedStorageBackend || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  let entries = [];
  let loadError = false;
  if (fs.existsSync(file)) {
    try {
      if (!available()) throw new Error('암호화 저장소를 사용할 수 없습니다.');
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      if (!Array.isArray(data) || !data.every((entry) => entry && typeof entry.id === 'string' && typeof entry.origin === 'string' && typeof entry.username === 'string' && typeof entry.password === 'string')) throw new Error('Invalid password store');
      entries = data;
    } catch { loadError = true; }
  }
  const persist = () => {
    if (!available() || loadError) throw new Error('암호 저장소를 사용할 수 없습니다. 기존 저장 파일은 유지됩니다.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, safeStorage.encryptString(JSON.stringify(entries)), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  return {
    available: () => available() && !loadError,
    list: () => entries.map(({ id, origin, username }) => ({ id, origin, username })),
    find: (origin, username) => entries.find((entry) => entry.origin === origin && (username === undefined || entry.username === username)),
    save(origin, username, password) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('HTTPS 사이트에서만 암호를 저장할 수 있습니다.');
      const previous = entries;
      const existing = this.find(url.origin, username);
      entries = entries.filter((entry) => entry.id !== existing?.id);
      entries.push({ id: existing?.id || crypto.randomUUID(), origin: url.origin, username, password });
      try { persist(); } catch (error) { entries = previous; throw error; }
    },
    remove(id) {
      const previous = entries;
      entries = entries.filter((entry) => entry.id !== id);
      try { persist(); } catch (error) { entries = previous; throw error; }
    },
  };
}

module.exports = { createPasswordStore };
