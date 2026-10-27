const { ipcRenderer } = require('electron');

// Kept in the isolated preload world; no IPC/password API is exposed to sites.
function loginFields(scope) {
  const fields = [...scope.querySelectorAll('input')];
  if (fields.some((input) => input.autocomplete.split(/\s+/).includes('new-password'))) return null;
  const passwords = fields.filter((input) => !input.disabled && input.type !== 'hidden' && (
    input.type === 'password' || input.autocomplete.split(/\s+/).includes('current-password') ||
    (input.id === 'pw' && input.name === 'pw')
  ));
  if (passwords.length !== 1) return null;
  const password = passwords[0];
  const candidates = fields.filter((input) => input !== password && !input.disabled &&
    ['text', 'email', 'tel'].includes(input.type) &&
    Boolean(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
  const username = candidates.find((input) => input.autocomplete.split(/\s+/).includes('username')) ||
    candidates.find((input) => /^(?:id|user(?:name|id)?|login(?:id)?|email|account)$/i.test(input.name || input.id)) || candidates.at(-1);
  return username ? { username, password } : null;
}

function offer(scope) {
  const fields = loginFields(scope);
  if (!fields?.username.value.trim() || !fields.password.value) return;
  ipcRenderer.send('password:offer', {
    origin: location.origin,
    username: fields.username.value.trim(),
    password: fields.password.value,
  });
}

// Capture before page handlers encrypt/clear fields and call form.submit(),
// which bypasses the ordinary submit event.
window.addEventListener('submit', (event) => {
  if (event.target instanceof HTMLFormElement) offer(event.target);
}, true);

window.addEventListener('click', (event) => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const control = event.target.closest('button, input[type="submit"], input[type="image"], [role="button"]');
  if (!control || control.disabled) return;
  const label = (control.textContent || control.value || control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  if (/가입|등록|비밀번호\s*변경|패스키|sign\s*up|register|change\s*password|passkey/i.test(label)) return;
  if (control.type !== 'submit' && control.type !== 'image' && !/^(?:로그인(?:하기)?|log\s*in|sign\s*in)$/i.test(label)) return;
  offer(control.form || control.closest('form') || document);
}, true);

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted || event.key !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!(event.target instanceof HTMLInputElement)) return;
  const scope = event.target.form || document;
  const fields = loginFields(scope);
  if (fields && (event.target === fields.username || event.target === fields.password)) offer(scope);
}, true);

// Autofill a single account only into an untouched visible form on its exact
// origin. Multiple accounts still use the toolbar's explicit chooser.
const filledPasswords = new WeakSet();
let lookingUp = false;
let noSavedAccount = false;
async function fillSavedLogin() {
  if (lookingUp || noSavedAccount) return;
  const fields = [...document.forms, document].map(loginFields).find((fields) => fields &&
    !filledPasswords.has(fields.password) && !fields.username.value && !fields.password.value &&
    fields.username.getClientRects().length && fields.password.getClientRects().length);
  if (!fields) return;
  lookingUp = true;
  const origin = location.origin;
  try {
    const account = await ipcRenderer.invoke('password:lookup');
    if (!account) { noSavedAccount = true; return; }
    if (account.origin !== origin || location.origin !== origin ||
      !fields.password.isConnected || !fields.username.isConnected ||
      fields.username.value || fields.password.value) return;
    filledPasswords.add(fields.password);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [input, value] of [[fields.username, account.username], [fields.password, account.password]]) {
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } catch { /* Leave the login form usable when the secure store is unavailable. */ }
  finally { lookingUp = false; }
}

function watchLoginForm() {
  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(fillSavedLogin, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'class', 'style', 'autocomplete'] });
  fillSavedLogin();
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); }, { once: true });
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', watchLoginForm, { once: true });
else watchLoginForm();
