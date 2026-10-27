const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSettings, isAdRequest } = require('../src/settings');

test('validates homepage protocols and retains an empty new-tab homepage', () => {
  assert.deepEqual(validateSettings({ homepage: 'https://example.com', blockAds: true }), { homepage: 'https://example.com/', blockAds: true });
  assert.equal(validateSettings({ homepage: '', blockAds: false }).homepage, '');
  for (const homepage of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com', 'example.com']) {
    assert.throws(() => validateSettings({ homepage, blockAds: true }));
  }
});

test('blocks ad hosts with domain boundaries and leaves direct navigation available', () => {
  assert.equal(isAdRequest('https://ad.doubleclick.net/a', 'script'), true);
  assert.equal(isAdRequest('https://notdoubleclick.net/a', 'script'), false);
  assert.equal(isAdRequest('https://example.com/doubleclick.net', 'image'), false);
  assert.equal(isAdRequest('https://doubleclick.net/', 'mainFrame'), false);
});
