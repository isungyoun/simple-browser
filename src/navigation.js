const SEARCH_ENDPOINT = 'https://www.google.com/search?q=';

function normalizeAddress(input) {
  const value = String(input ?? '').trim();
  if (!value) return null;

  if (/^(https?|file):\/\//i.test(value) || /^(about:blank)$/i.test(value)) {
    return value;
  }

  if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(value) || /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(value)) {
    return `http://${value}`;
  }

  if (/^[^\s]+\.[^\s]+(?:\/.*)?$/.test(value)) {
    return `https://${value}`;
  }

  return `${SEARCH_ENDPOINT}${encodeURIComponent(value)}`;
}

function addressForDisplay(url, newTabUrl) {
  if (!url || url === newTabUrl || url === 'about:blank') return '';
  return url;
}

module.exports = { normalizeAddress, addressForDisplay, SEARCH_ENDPOINT };
