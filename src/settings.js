const DEFAULT_SETTINGS = Object.freeze({ homepage: '', blockAds: false });

function validateSettings(value) {
  if (!value || typeof value !== 'object' || typeof value.blockAds !== 'boolean' || typeof value.homepage !== 'string') {
    throw new Error('설정 형식이 올바르지 않습니다.');
  }
  const homepage = value.homepage.trim();
  if (homepage) {
    let url;
    try { url = new URL(homepage); } catch { throw new Error('홈페이지는 https:// 또는 http://로 시작하는 주소를 입력하세요.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('홈페이지는 로그인 정보가 없는 HTTP(S) 주소만 사용할 수 있습니다.');
    }
    return { homepage: url.href, blockAds: value.blockAds };
  }
  return { homepage, blockAds: value.blockAds };
}

function isAdRequest(rawUrl, resourceType) {
  if (resourceType === 'mainFrame') return false;
  let hostname;
  try { hostname = new URL(rawUrl).hostname.toLowerCase(); } catch { return false; }
  return ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adnxs.com', 'adsrvr.org', 'criteo.com', 'criteo.net', 'ad.daum.net', 'ad.naver.com', 'ads.naver.com']
    .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

module.exports = { DEFAULT_SETTINGS, validateSettings, isAdRequest };
