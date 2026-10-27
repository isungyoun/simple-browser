const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(require.resolve('../src/adblock'), 'utf8');
const hidden = (element) => element.hasAttribute('data-simple-browser-ad-hidden');

test('hides query-specific Naver ad cards, handles later cards, and restores on disable', async () => {
  const dom = new JSDOM('<main><section id="ad"><h2>책상 관련 광고</h2><a>광고 상품</a></section><section id="organic"><h2>책상 추천</h2><p>일반 검색 결과</p></section></main>', { url: 'https://search.naver.com/search.naver?query=책상', runScripts: 'outside-only' });
  const { window } = dom;
  try {
    window.eval(script);
    assert.equal(hidden(window.document.querySelector('#ad')), true);
    assert.equal(hidden(window.document.querySelector('#organic')), false);
    assert.equal(hidden(window.document.querySelector('main')), false);
    const card = window.document.createElement('section');
    card.innerHTML = '<h2>노트북 관련 광고</h2>';
    window.document.querySelector('main').append(card);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(hidden(card), true);
    window.__simpleBrowserAdCleanup();
    assert.equal(window.document.querySelectorAll('[data-simple-browser-ad-hidden]').length, 0);
    assert.equal(window.__simpleBrowserAdCleanup, undefined);
  } finally { window.close(); }
});

test('does not treat ordinary article headings on other sites as Naver ad cards', () => {
  const dom = new JSDOM('<section><h2>책상 관련 광고</h2></section>', { url: 'https://example.com', runScripts: 'outside-only' });
  try {
    dom.window.eval(script);
    assert.equal(hidden(dom.window.document.querySelector('section')), false);
  } finally { dom.window.close(); }
});

test('hides Naver homepage ad wrappers and footer ads while preserving ordinary content', async () => {
  // Minimal structure from the supplied homepage HTML. Do not retain tracking
  // URLs or advertiser payloads from the original capture.
  const dom = new JSDOM(`
    <header id="header"><div id="search_area">검색창</div>
      <div id="search-right"><a class="link_headline"><img alt="[광고]다른 캠페인" /></a></div>
      <nav id="shortcutArea">메일·카페·블로그</nav>
    </header>
    <div id="root">
      <div class="Layout-module__column_left___sample">
        <div id="top-banner" class="Layout-module__banner_area___sample"><div id="ad_timeboard"><div><iframe title="광고"></iframe></div></div></div>
        <div id="newsstand">뉴스스탠드</div>
        <div id="shopping"><iframe title="shoppingbox" src="https://shopsquare.naver.com/"></iframe></div>
        <div id="shopping-results"><h2>일반 쇼핑 검색 결과</h2><a href="https://example.com/product">상품</a></div>
        <div id="feed"><nav>추천 카테크 웹툰 패션뷰티 리빙푸드 책방 지식 건강</nav><article>추천 카드</article></div>
      </div>
      <div id="right-content-area">
        <div id="login">로그인</div>
        <div id="right-banner" class="Layout-module__banner_area___sample"><div id="right-ad-1"><div><iframe title="광고"></iframe></div></div></div>
        <div id="shopping-ad" class="Layout-module__banner_area___sample"><iframe title="right-shopping" src="https://recoshopping.naver.com/"></iframe></div>
        <div id="weather">날씨</div>
        <div id="late-banner" class="Layout-module__banner_area___sample"><iframe id="late-frame"></iframe></div>
      </div>
    </div>
    <footer><div class="footer_inner"><div class="nbanner_area">
      <div id="da_public_left"><iframe title="AD"></iframe></div>
      <div id="da_public_right"><iframe title="AD"></iframe></div>
      <div id="veta_time2"><iframe title="AD"></iframe></div>
    </div><div id="footer-links">공지사항·회사소개</div></div></footer>
  `, { url: 'https://www.naver.com/', runScripts: 'outside-only' });
  const { window } = dom;
  const d = window.document;
  try {
    window.eval(script);
    for (const selector of ['#search-right', '#top-banner', '#right-banner', '#shopping-ad', '#shopping', '#feed', '.nbanner_area']) {
      assert.equal(hidden(d.querySelector(selector)), true, selector);
    }
    for (const selector of ['#header', '#search_area', '#shortcutArea', '#root', '#right-content-area', '#newsstand', '#shopping-results', '#login', '#weather', '#footer-links', 'footer']) {
      assert.equal(Boolean(d.querySelector(selector).closest('[data-simple-browser-ad-hidden]')), false, selector);
    }
    d.querySelector('#late-frame').title = '광고';
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(hidden(d.querySelector('#late-banner')), true);
    // A refresh can replace the creative without changing the ad slot.
    d.querySelector('#right-ad-1').innerHTML = '<iframe title="광고"></iframe>';
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(hidden(d.querySelector('#right-banner')), true);
    window.__simpleBrowserAdCleanup();
    assert.equal(d.querySelectorAll('[data-simple-browser-ad-hidden]').length, 0);
  } finally { window.close(); }
});
