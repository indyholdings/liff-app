/* Sidecar content script — runs on https://chat.line.biz/*
 * Adds a collapsible side panel (an iframe of panel.html), tells it which chat is open,
 * and fills the chat composer when the panel asks. It never sends a message: staff press send.
 */
(() => {
  'use strict';
  if (window.top !== window || window.__sidecarInjected) return;
  window.__sidecarInjected = true;

  /* ------------------------------------------------------------------------------------------
   * UNVERIFIED AGAINST THE REAL chat.line.biz DOM.
   * Everything this script assumes about LINE OA Manager's page lives in this one object.
   * If LINE changes its markup (or these guesses are wrong), fix it here. Every lookup that
   * fails degrades safely: no name → the panel looks the chat up by id only; no composer →
   * the panel copies the text to the clipboard instead.
   * ---------------------------------------------------------------------------------------- */
  const SIDECAR_DOM = {
    // The chat id is the last "/chat/<id>" segment of the path, e.g. /U1234.../chat/Uabcd...
    chatPathPattern: /\/chat\/([^/?#]+)/g,
    // Where the open chat's customer name might be, most specific first.
    headerNameSelectors: [
      '[class*="chatheader" i] [class*="name" i]',
      '[class*="chat-header" i] [class*="name" i]',
      'main header h1, main header h2, main header h3, main header h4',
      'header [class*="name" i]',
    ],
    // Fallback: the chat-list link that points at the open chat ({id} is replaced).
    chatListLinkSelector: 'a[href$="/chat/{id}"]',
    chatListNameSelector: '[class*="name" i], h6, h5, h4, strong',
    // The message composer: a textarea first, then a contenteditable box.
    composerSelectors: ['textarea', '[contenteditable="true"]'],
    // "push" narrows the page so nothing is covered; "overlay" floats the panel above it.
    layout: 'push',
    panelWidth: 384,
  };

  // The brand this copy wears: brand.js runs just before this file, in the same script world.
  const BRAND = (typeof window.SIDECAR_BRAND === 'object' && window.SIDECAR_BRAND) || {};
  const BRAND_NAME = String(BRAND.name || 'Sidecar');
  // Colours of the two things this script draws on the host page. The panel itself is themed by its own CSS.
  const CHROME = {
    globallink: { bg: '#f5f2e9', border: '#bfcbbb', accent: '#193e24' },
  }[BRAND.theme] || { bg: '#f4f5f7', border: '#cfd4da', accent: '#06c755' };

  const PANEL_URL = chrome.runtime.getURL('panel.html');
  const PANEL_ORIGIN = new URL(PANEL_URL).origin;
  const OPEN_KEY = 'sidecarPanelOpen';
  const POLL_MS = 600;
  const Z = '2147483000';

  // ---------------------------------------------------------------- panel elements
  const host = document.createElement('div');
  host.id = 'sidecar-host';
  host.setAttribute('style', [
    'position:fixed', 'top:0', 'right:0', 'bottom:0', 'width:' + SIDECAR_DOM.panelWidth + 'px',
    'z-index:' + Z, 'background:' + CHROME.bg, 'border-left:1px solid rgba(128,136,146,.4)',
    'box-shadow:-4px 0 16px rgba(16,24,40,.08)', 'display:none',
  ].join(';'));

  const iframe = document.createElement('iframe');
  iframe.title = BRAND_NAME;
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.setAttribute('style', 'width:100%;height:100%;border:0;display:block;background:transparent');
  host.append(iframe);

  const toggle = document.createElement('button');
  toggle.id = 'sidecar-toggle';
  toggle.type = 'button';
  if (BRAND.logo_mark) {
    const mark = document.createElement('img');
    mark.alt = '';
    mark.src = chrome.runtime.getURL(String(BRAND.logo_mark));
    mark.setAttribute('style', 'display:block;width:18px;height:18px;margin:0 auto;object-fit:contain');
    toggle.append(mark);
  } else {
    toggle.textContent = 'S';
  }
  toggle.setAttribute('style', [
    'position:fixed', 'top:84px', 'right:0', 'z-index:' + Z, 'width:26px', 'height:44px', 'padding:0',
    'border:1px solid ' + CHROME.border, 'border-right:0', 'border-radius:8px 0 0 8px', 'background:#fff', 'color:' + CHROME.accent,
    'font:700 14px/1 system-ui,sans-serif', 'cursor:pointer', 'box-shadow:-2px 2px 8px rgba(16,24,40,.12)',
  ].join(';'));

  let open = true;
  let loaded = false;      // iframe src has been set
  let panelReady = false;  // panel.html has finished loading, so its origin is PANEL_ORIGIN
  const root = document.documentElement;
  const prevWidth = root.style.width;

  function applyOpen() {
    host.style.display = open ? 'block' : 'none';
    toggle.style.right = open ? SIDECAR_DOM.panelWidth + 'px' : '0';
    toggle.title = (open ? 'ซ่อน ' : 'เปิด ') + BRAND_NAME + ' (Alt+S)';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(open));
    if (SIDECAR_DOM.layout === 'push') {
      if (open) root.style.setProperty('width', 'calc(100% - ' + SIDECAR_DOM.panelWidth + 'px)', 'important');
      else if (prevWidth) root.style.width = prevWidth;
      else root.style.removeProperty('width');
    }
    if (open && !loaded) {
      loaded = true;
      iframe.src = PANEL_URL; // loaded lazily so a closed panel costs nothing
    }
    if (open) sendChat(true);
  }

  function setOpen(next) {
    open = next;
    try { chrome.storage.local.set({ [OPEN_KEY]: open }); } catch (_) { /* state lasts for this page only */ }
    applyOpen();
  }

  toggle.addEventListener('click', () => setOpen(!open));
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyS') { e.preventDefault(); setOpen(!open); }
  });

  // ---------------------------------------------------------------- which chat is open
  function currentChatId() {
    let id = null;
    let m;
    const re = new RegExp(SIDECAR_DOM.chatPathPattern.source, 'g');
    while ((m = re.exec(location.pathname))) id = m[1];
    try { return id ? decodeURIComponent(id) : null; } catch (_) { return id; }
  }

  function cleanName(text) {
    const first = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    return first.length > 80 ? '' : first;
  }

  function scrapeName(chatId) {
    for (const sel of SIDECAR_DOM.headerNameSelectors) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (host.contains(el)) continue;
          const name = cleanName(el.textContent);
          if (name) return name;
        }
      } catch (_) { /* a selector the browser rejects is skipped */ }
    }
    try {
      const link = document.querySelector(SIDECAR_DOM.chatListLinkSelector.replace('{id}', CSS.escape(chatId)));
      if (link) {
        const inner = link.querySelector(SIDECAR_DOM.chatListNameSelector);
        return cleanName((inner || link).textContent);
      }
    } catch (_) { /* fall through */ }
    return '';
  }

  let last = { chatId: undefined, name: '' };
  let settleAt = 0;

  function postToPanel(msg) {
    if (!panelReady || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(msg, PANEL_ORIGIN);
  }

  function sendChat(force) {
    const chatId = currentChatId();
    const now = Date.now();
    if (chatId !== last.chatId) {
      // The URL changes before the header re-renders; wait a beat so the old name is not sent.
      if (!settleAt) { settleAt = now + 300; if (!force) return; }
      else if (now < settleAt && !force) return;
    }
    settleAt = 0;
    const name = chatId ? scrapeName(chatId) : '';
    if (!force && chatId === last.chatId && name === last.name) return;
    last = { chatId, name };
    postToPanel({ type: 'sidecar:chat', chatId, name });
  }

  // ---------------------------------------------------------------- fill the composer
  function findComposer() {
    for (const sel of SIDECAR_DOM.composerSelectors) {
      const found = [];
      let nodes = [];
      try { nodes = document.querySelectorAll(sel); } catch (_) { nodes = []; }
      for (const el of nodes) {
        if (host.contains(el) || el.disabled || el.readOnly) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 10) continue;
        found.push({ el, bottom: r.bottom });
      }
      if (found.length) {
        found.sort((a, b) => b.bottom - a.bottom); // the composer sits at the bottom of the chat
        return found[0].el;
      }
    }
    return null;
  }

  function insertIntoComposer(text) {
    const el = findComposer();
    if (!el || !text) return false;
    try {
      el.focus();
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        const current = el.value.replace(/\s+$/, '');
        const next = current ? current + '\n' + text : text;
        setter.call(el, next); // the native setter, so frameworks that wrap the property still see it
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        try { el.setSelectionRange(next.length, next.length); } catch (_) { /* not all inputs support it */ }
        return el.value === next;
      }
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      const prefix = el.textContent.trim() ? '\n' : '';
      if (!document.execCommand('insertText', false, prefix + text)) {
        el.append(document.createTextNode(prefix + text));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prefix + text }));
      }
      return el.textContent.includes(text.split('\n')[0]);
    } catch (_) {
      return false;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== iframe.contentWindow || e.origin !== PANEL_ORIGIN) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'sidecar:ready') {
      sendChat(true);
    } else if (d.type === 'sidecar:insert') {
      const ok = typeof d.text === 'string' && insertIntoComposer(d.text);
      postToPanel({ type: 'sidecar:insert-result', id: d.id, ok });
    }
  });

  // ---------------------------------------------------------------- start
  function start() {
    document.body.append(host, toggle);
    iframe.addEventListener('load', () => { panelReady = true; sendChat(true); });
    applyOpen();
    setInterval(() => { if (open) sendChat(false); }, POLL_MS);
    window.addEventListener('popstate', () => { if (open) sendChat(false); });
  }

  let started = false;
  const begin = (stored) => {
    if (started) return;
    started = true;
    if (stored && stored[OPEN_KEY] === false) open = false;
    start();
  };
  try {
    const p = chrome.storage.local.get([OPEN_KEY]);
    if (p && typeof p.then === 'function') p.then(begin, () => begin(null));
    else begin(null);
  } catch (_) {
    begin(null);
  }
})();
