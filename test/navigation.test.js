const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress, addressForDisplay } = require('../src/navigation');

test('keeps fully qualified web URLs', () => {
  assert.equal(normalizeAddress('https://example.com/a'), 'https://example.com/a');
});

test('adds https to domain-like input', () => {
  assert.equal(normalizeAddress('example.com/docs'), 'https://example.com/docs');
});

test('uses http for localhost', () => {
  assert.equal(normalizeAddress('localhost:3000/test'), 'http://localhost:3000/test');
});

test('turns words into an encoded search', () => {
  assert.equal(normalizeAddress('sy 브라우저'), 'https://www.google.com/search?q=sy%20%EB%B8%8C%EB%9D%BC%EC%9A%B0%EC%A0%80');
});

test('returns null for empty input', () => {
  assert.equal(normalizeAddress('   '), null);
});

test('hides the internal new-tab URL', () => {
  assert.equal(addressForDisplay('file:///newtab.html', 'file:///newtab.html'), '');
});
