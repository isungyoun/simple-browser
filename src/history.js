const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 5000;
const DAY = 24 * 60 * 60 * 1000;

// "https://www.naver.com/" -> "naver.com"; what the address bar matches against.
function stripUrl(url) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}

function createHistory(file, { now = Date.now } = {}) {
  let entries = new Map();
  try {
    for (const entry of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (entry && typeof entry.url === 'string' && /^https?:\/\//i.test(entry.url)) entries.set(entry.url, entry);
    }
  } catch { entries = new Map(); }
  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify([...entries.values()]));
    fs.renameSync(`${file}.tmp`, file);
  };
  // Pages can navigate many times a second; batch the disk writes.
  const schedule = () => { if (!timer) timer = setTimeout(persist, 1000); };
  // Frequently and recently visited pages rank first.
  const score = (entry) => entry.visits / (1 + (now() - entry.lastVisit) / (7 * DAY));
  return {
    record(url, title = '') {
      if (!/^https?:\/\//i.test(url)) return;
      const entry = entries.get(url) || { url, title: '', visits: 0, lastVisit: 0 };
      entry.visits += 1;
      entry.lastVisit = now();
      if (title) entry.title = title;
      entries.delete(url);
      entries.set(url, entry);
      if (entries.size > MAX_ENTRIES) {
        const oldest = [...entries.values()].sort((a, b) => a.lastVisit - b.lastVisit).slice(0, entries.size - MAX_ENTRIES);
        for (const entry of oldest) entries.delete(entry.url);
      }
      schedule();
    },
    updateTitle(url, title) {
      const entry = entries.get(url);
      if (!entry || !title || entry.title === title) return;
      entry.title = title;
      schedule();
    },
    // Every word must appear in the address or title; address-prefix matches first.
    suggest(query, limit = 8) {
      const text = String(query || '').trim().toLowerCase();
      if (!text) return [];
      const words = text.split(/\s+/);
      const prefix = stripUrl(text);
      return [...entries.values()]
        .filter((entry) => words.every((word) => entry.url.toLowerCase().includes(word) || entry.title.toLowerCase().includes(word)))
        .map((entry) => ({ entry, rank: score(entry) * (stripUrl(entry.url).toLowerCase().startsWith(prefix) ? 10 : 1) }))
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit)
        .map(({ entry }) => ({ url: entry.url, title: entry.title }));
    },
    // Text to complete the typed prefix with, e.g. "nav" -> "naver.com". Prefers
    // the site root over deeper pages and never completes a multi-word search.
    inlineCompletion(query) {
      const typed = String(query || '');
      if (!typed || /\s/.test(typed)) return '';
      const lower = stripUrl(typed.toLowerCase());
      let best = null;
      for (const entry of entries.values()) {
        const stripped = stripUrl(entry.url);
        const host = stripped.split('/')[0];
        for (const candidate of new Set([host, stripped])) {
          if (!candidate.toLowerCase().startsWith(lower) || candidate.length === lower.length) continue;
          const rank = score(entry) * (candidate === host ? 2 : 1) / candidate.length;
          if (!best || rank > best.rank) best = { candidate, rank };
        }
      }
      if (!best) return '';
      return typed + best.candidate.slice(lower.length);
    },
    clear() {
      entries.clear();
      persist();
    },
    flush() { if (timer) persist(); },
  };
}

module.exports = { createHistory, stripUrl };
