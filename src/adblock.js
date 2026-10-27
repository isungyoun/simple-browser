// Runs in the page without Node or IPC access. Disconnecting restores every hidden card.
(() => {
  window.__simpleBrowserAdCleanup?.();
  const attribute = 'data-simple-browser-ad-hidden';
  const style = document.createElement('style');
  style.textContent = `[${attribute}] { display: none !important; }`;
  document.documentElement.append(style);
  const marked = new Set();
  const hide = (element) => {
    if (!element || element === document.body || element === document.documentElement) return;
    element.setAttribute(attribute, '');
    marked.add(element);
  };
  const naver = /(^|\.)naver\.com$/.test(location.hostname);
  const scan = () => {
    document.querySelectorAll('ins.adsbygoogle, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"]').forEach(hide);
    if (!naver) return;
    // The small headline creative beside the homepage search box.
    document.querySelectorAll('#search-right .link_headline').forEach((link) => hide(link.closest('#search-right')));
    // Include the homepage recommendation feed at the user's request.
    document.querySelectorAll('#root > [class*="Layout-module__column_left"] > #feed').forEach(hide);
    document.querySelectorAll('#power_link, #biz_site, .sc_powerlink, .ad_section, [data-ad-type="powerlink"]').forEach(hide);
    // The homepage's category/product grid is itself an ad card. Collapse
    // its entire dedicated container, including tabs, border and pagination.
    document.querySelectorAll('iframe[title="shoppingbox"], iframe[src^="https://shopsquare.naver.com/"]').forEach((frame) => {
      hide(frame.closest('#shopping') || frame);
    });
    // Naver homepage uses cross-origin frames: target the host slot rather
    // than the changing creative/text inside each frame. Hide its layout
    // wrapper as well so the empty border, height and margins disappear.
    document.querySelectorAll([
      '#ad_timeboard', '#timeboard-ex', '#ad_premium_area',
      'div[id^="right-ad-"]', 'div[id^="pc-main-ad-div-"]',
      'iframe[title="광고"]', 'iframe[title="AD"]',
      'iframe[title="right-shopping"]',
      'iframe[src^="https://recoshopping.naver.com/"]',
      '#da_public_left', '#da_public_right', '#veta_time2',
    ].join(',')).forEach((slot) => {
      const wrapper = slot.closest('[class*="Layout-module__banner_area"], .nbanner_area');
      hide(wrapper || slot);
    });
    document.querySelectorAll('h2, h3, strong, span, .title_area, .api_title, .api_subject_bx').forEach((heading) => {
      const text = heading.textContent.replace(/\s+/g, ' ').trim();
      if (!/^(?:.{1,60}\s*관련 광고|파워링크|비즈사이트)(?:\s*[ⓘi])?$/.test(text)) return;
      const subject = heading.closest('.api_subject_bx');
      let card = heading.closest('section, .sc_new, [data-template-id]');
      if (!card) card = subject?.parentElement || heading.parentElement;
      // Modern Naver cards sometimes have only generated class names.
      // Walk through the heading wrapper to the first bounded card with ad links.
      for (let depth = 0; card && !card.querySelector('a[href]') && depth < 3; depth++) {
        const parent = card.parentElement;
        if (!parent || /^(BODY|MAIN|HTML)$/.test(parent.tagName) || ['main_pack', 'content'].includes(parent.id)) break;
        card = parent;
      }
      // Only hide the card containing the ad heading, never the whole results column.
      if (card && !card.matches('body, html, main, #main_pack, #content') && !card.querySelector('#main_pack, #content, main')) hide(card);
    });
  };
  let timer;
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => record.addedNodes.length || record.type === 'characterData' || record.type === 'attributes')) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 80);
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['id', 'title', 'src'],
  });
  window.__simpleBrowserAdCleanup = () => {
    observer.disconnect();
    clearTimeout(timer);
    style.remove();
    for (const element of marked) element.removeAttribute(attribute);
    delete window.__simpleBrowserAdCleanup;
  };
  scan();
})();
