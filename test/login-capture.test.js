const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../src/tab-preload'), 'utf8');
const form = `<form autocomplete="off"><input id="id" name="id" type="text"><input id="pw" name="pw" type="password"><button type="button" id="loginBtn_column"><span>로그인</span></button><button type="button" id="passkey">패스키 로그인</button></form>`;

function setup(html = form, lookup = () => null) {
  const dom = new JSDOM(html, { url: 'https://nid.naver.com/nidlogin.login' });
  const w = dom.window;
  const events = new Map();
  const add = w.addEventListener.bind(w);
  w.addEventListener = (name, callback, options) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(callback);
    add(name, callback, options);
  };
  w.HTMLInputElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  const messages = [];
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron');
      return { ipcRenderer: { send: (channel, value) => messages.push({ channel, value }), invoke: async (channel) => { assert.equal(channel, 'password:lookup'); return lookup(); } } };
    },
    window: w, document: w.document, location: w.location,
    HTMLFormElement: w.HTMLFormElement, HTMLInputElement: w.HTMLInputElement,
    Element: w.Element, Node: w.Node, Event: w.Event, MutationObserver: w.MutationObserver,
    setTimeout: w.setTimeout.bind(w), clearTimeout: w.clearTimeout.bind(w),
  });
  return { w, messages, emit: (name, event) => events.get(name)?.forEach((callback) => callback(event)), close: () => w.close() };
}

test('captures a Naver-style button before encryption clears inputs and bypasses submit', () => {
  const s = setup();
  try {
    s.w.document.querySelector('#id').value = 'test-user';
    s.w.document.querySelector('#pw').value = 'test-password';
    // The isolated listener runs in window capture, before the page handler.
    s.emit('click', { isTrusted: true, target: s.w.document.querySelector('#loginBtn_column span') });
    s.w.document.querySelector('#id').value = '';
    s.w.document.querySelector('#pw').value = '';
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].value.username, 'test-user');
    assert.equal(s.messages[0].value.password, 'test-password');
    assert.equal(s.messages[0].value.origin, 'https://nid.naver.com');
  } finally { s.close(); }
});

test('captures Enter but ignores passkey and synthetic clicks', () => {
  const s = setup();
  try {
    const d = s.w.document;
    d.querySelector('#id').value = 'test-user'; d.querySelector('#pw').value = 'test-password';
    s.emit('click', { isTrusted: true, target: d.querySelector('#passkey') });
    s.emit('click', { isTrusted: false, target: d.querySelector('#loginBtn_column') });
    assert.equal(s.messages.length, 0);
    s.emit('keydown', { isTrusted: true, key: 'Enter', target: d.querySelector('#pw') });
    assert.equal(s.messages.length, 1);
  } finally { s.close(); }
});

test('does not offer signup or password-change credentials', () => {
  const s = setup(form.replace('type="password"', 'type="password" autocomplete="new-password"'));
  try {
    s.w.document.querySelector('#id').value = 'test-user'; s.w.document.querySelector('#pw').value = 'new-password';
    s.emit('click', { isTrusted: true, target: s.w.document.querySelector('#loginBtn_column') });
    assert.equal(s.messages.length, 0);
  } finally { s.close(); }
});

test('fills a saved account on the same origin without submitting', async () => {
  const s = setup(form, () => ({ origin: 'https://nid.naver.com', username: 'saved-user', password: 'saved-password' }));
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(s.w.document.querySelector('#id').value, 'saved-user');
    assert.equal(s.w.document.querySelector('#pw').value, 'saved-password');
    assert.equal(s.messages.length, 0);
    assert.equal(s.w.syBrowser, undefined);
  } finally { s.close(); }
});

test('never fills an account from another origin or overwrites user input', async () => {
  for (const foreignOrigin of [true, false]) {
    let reply;
    const s = setup(form, () => new Promise((resolve) => { reply = resolve; }));
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (!foreignOrigin) s.w.document.querySelector('#id').value = 'typing-user';
      reply({ origin: foreignOrigin ? 'https://www.naver.com' : 'https://nid.naver.com', username: 'saved-user', password: 'saved-password' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(s.w.document.querySelector('#id').value, foreignOrigin ? '' : 'typing-user');
      assert.equal(s.w.document.querySelector('#pw').value, '');
    } finally { s.close(); }
  }
});
