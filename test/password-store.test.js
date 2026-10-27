const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPasswordStore } = require('../src/password-store');

test('encrypts at rest, scopes accounts to exact origins, persists updates and deletion', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'simple-password-test-'));
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decryptString: (buffer) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString();
    },
  };
  const file = path.join(directory, 'passwords.enc');
  try {
    let store = createPasswordStore(safeStorage, file);
    store.save('https://example.com', 'person', 'secret-password');
    assert.equal(fs.readFileSync(file).includes(Buffer.from('secret-password')), false);
    assert.equal(JSON.stringify(store.list()).includes('secret-password'), false);
    assert.equal(store.find('https://evil.example.com'), undefined);
    assert.equal(store.find('http://example.com'), undefined);
    assert.throws(() => store.save('http://example.com', 'person', 'unsafe'));
    store = createPasswordStore(safeStorage, file);
    assert.equal(store.find('https://example.com').password, 'secret-password');
    store.save('https://example.com', 'person', 'updated');
    assert.equal(store.list().length, 1);
    store.remove(store.list()[0].id);
    assert.equal(createPasswordStore(safeStorage, file).list().length, 0);
    const unavailable = createPasswordStore({ isEncryptionAvailable: () => false }, path.join(directory, 'unavailable.enc'));
    assert.equal(unavailable.available(), false);
    assert.throws(() => unavailable.save('https://example.com', 'person', 'no-plaintext-fallback'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
