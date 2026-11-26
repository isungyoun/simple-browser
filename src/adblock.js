// Runs in the page without Node or IPC access. Disconnecting restores every hidden card.
(() => {
  window.__simpleBrowserAdCleanup?.();
  const attribute = 'data-simple-browser-ad-hidden';
  const naver = /(^|\.)naver\.com$/.test(location.hostname);
  const google = /(^|\.)google\.[a-z.]+$/.test(location.hostname);
  const naverSlots = [
    '#ad_timeboard', '#timeboard-ex', '#ad_premium_area',
    'div[id^="right-ad-"]', 'div[id^="pc-main-ad-div-"]',
    'iframe[title="광고"]', 'iframe[title="AD"]',
    'iframe[title="right-shopping"]',
    'iframe[src^="https://recoshopping.naver.com/"]',
    '#da_public_left', '#da_public_right', '#veta_time2',
  ].join(',');
  // Selector-only rules apply from the first paint, before any scan runs.
  // The scan below still marks text-based cards that CSS cannot match.
  const early = [
    'ins.adsbygoogle', 'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]',
    ...(google ? ['#tads', '#tadsb', '#bottomads', '.commercial-unit-desktop-top', '.commercial-unit-desktop-rhs', '.cu-container', '.pla-unit'] : []),
    ...(naver ? [
      '.ct_snb_banner', '#search-right:has(.link_headline)', '#root > [class*="Layout-module__column_left"] > #feed',
      '#power_link', '#biz_site', '.sc_powerlink', '.ad_section', '[data-ad-type="powerlink"]',
      '#shopping:has(iframe[title="shoppingbox"], iframe[src^="https://shopsquare.naver.com/"])',
      naverSlots, `:is([class*="Layout-module__banner_area"], .nbanner_area):has(${naverSlots})`,
    ] : []),
  ];
  const style = document.createElement('style');
  style.textContent = `[${attribute}], ${early.join(', ')} { display: none !important; }`;
  // From the tab preload this runs before <html> exists; attach once it does.
  const attachStyle = () => { if (!style.isConnected && document.documentElement) document.documentElement.append(style); };
  attachStyle();
  const marked = new Set();
  const hide = (element) => {
    if (!element || element === document.body || element === document.documentElement) return;
    element.setAttribute(attribute, '');
    marked.add(element);
  };
  const scan = () => {
    attachStyle();
    document.querySelectorAll('ins.adsbygoogle, iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"]').forEach(hide);
    if (google) {
      document.querySelectorAll('#tads, #tadsb, #bottomads, .commercial-unit-desktop-top, .commercial-unit-desktop-rhs, .cu-container').forEach(hide);
      // Shopping ads: hide the block holding the "광고: 제품" heading and its
      // product cards, never the whole results column.
      document.querySelectorAll('[role="heading"]').forEach((heading) => {
        if (!/^(?:광고|스폰서|Sponsored|Ads?)\s*[:·]/i.test(heading.textContent.trim())) return;
        let block = heading.parentElement;
        while (block && !block.querySelector('.pla-unit') && !block.matches('body, #rso, #search, #center_col')) block = block.parentElement;
        if (block && !block.matches('body, #rso, #search, #center_col')) hide(block);
      });
      document.querySelectorAll('.pla-unit').forEach(hide);
      return;
    }
    if (!naver) return;
    // Naver News section banners (AI algorithm, premium contents promotions).
    document.querySelectorAll('.ct_snb_banner').forEach(hide);
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
    document.querySelectorAll(naverSlots).forEach((slot) => {
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
  // Scan right before the next paint so late-inserted cards are never drawn.
  const schedule = window.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
  const cancel = window.cancelAnimationFrame || clearTimeout;
  let timer = null;
  const observer = new MutationObserver((records) => {
    attachStyle();
    if (timer !== null || !records.some((record) => record.addedNodes.length || record.type === 'characterData' || record.type === 'attributes')) return;
    timer = schedule(() => { timer = null; scan(); });
  });
  observer.observe(document, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['id', 'title', 'src'],
  });
  window.__simpleBrowserAdCleanup = () => {
    observer.disconnect();
    if (timer !== null) cancel(timer);
    style.remove();
    for (const element of marked) element.removeAttribute(attribute);
    delete window.__simpleBrowserAdCleanup;
  };
  scan();
})();
