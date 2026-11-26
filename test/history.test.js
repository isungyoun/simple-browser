const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory, stripUrl } = require('../src/history');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'simple-history-test-'));

test('records web visits, ignores other schemes and persists across restarts', () => {
  const directory = temp();
  const file = path.join(directory, 'history.json');
  try {
    const history = createHistory(file);
    history.record('https://www.naver.com/', '네이버');
    history.record('https://www.naver.com/', '네이버');
    history.record('file:///Users/me/secret.txt', 'secret');
    history.record('about:blank');
    history.flush();
    const reloaded = createHistory(file);
    assert.deepEqual(reloaded.suggest('naver'), [{ url: 'https://www.naver.com/', title: '네이버' }]);
    assert.deepEqual(reloaded.suggest('secret'), []);
    reloaded.clear();
    assert.deepEqual(createHistory(file).suggest('naver'), []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('matches every word in address or title and ranks address prefixes and frequent pages first', () => {
  const directory = temp();
  let clock = 1_000_000_000_000;
  try {
    const history = createHistory(path.join(directory, 'history.json'), { now: () => clock });
    history.record('https://news.example.com/sports', '스포츠 뉴스');
    for (let i = 0; i < 5; i++) history.record('https://www.google.com/search?q=news', 'news - Google 검색');
    history.record('https://naver.com/', '네이버');
    history.updateTitle('https://naver.com/', 'NAVER');
    assert.equal(history.suggest('news')[0].url, 'https://news.example.com/sports');
    assert.deepEqual(history.suggest('스포츠 뉴스').map((item) => item.url), ['https://news.example.com/sports']);
    assert.deepEqual(history.suggest('NAVER').map((item) => item.title), ['NAVER']);
    assert.deepEqual(history.suggest('   '), []);
    assert.equal(history.suggest('o', 2).length, 2);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('inline completion prefers the site root, keeps typed casing and skips searches', () => {
  const directory = temp();
  try {
    const history = createHistory(path.join(directory, 'history.json'));
    history.record('https://www.naver.com/');
    history.record('https://news.naver.com/section/100');
    history.record('https://news.naver.com/section/100');
    assert.equal(history.inlineCompletion('nav'), 'naver.com');
    assert.equal(history.inlineCompletion('NAV'), 'NAVer.com');
    assert.equal(history.inlineCompletion('www.nav'), 'www.naver.com');
    assert.equal(history.inlineCompletion('news.naver.com/sec'), 'news.naver.com/section/100');
    assert.equal(history.inlineCompletion('naver.com'), '');
    assert.equal(history.inlineCompletion('nav news'), '');
    assert.equal(history.inlineCompletion('zzz'), '');
    assert.equal(stripUrl('https://www.naver.com/'), 'naver.com');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
