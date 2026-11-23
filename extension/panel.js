/* Sidecar panel — runs inside the iframe that content.js adds to chat.line.biz.
 * Mounts the shared UI in panel mode and talks to the host page with postMessage.
 */
(async function () {
  'use strict';

  const KEYS = ['sidecarApiUrl', 'sidecarToken'];
  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = hasChromeStorage
    ? { get: (keys) => chrome.storage.local.get(keys), set: (obj) => chrome.storage.local.set(obj) }
    : SidecarUI.localStore; // dev: panel.html opened from the mock server

  // Only the LINE OA Manager page may drive this panel. The dev stand-in is served from localhost.
  const isDev = location.protocol !== 'chrome-extension:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const ALLOWED_PARENTS = ['https://chat.line.biz'].concat(isDev ? [location.origin] : []);
  const embedded = window.parent !== window;
  let parentOrigin = null;
  if (embedded && location.ancestorOrigins && location.ancestorOrigins.length) {
    const o = location.ancestorOrigins[0];
    if (ALLOWED_PARENTS.includes(o)) parentOrigin = o;
  }

  const pending = new Map();
  let nextId = 1;
  function postToParent(msg) {
    if (!embedded || !parentOrigin) return false;
    window.parent.postMessage(msg, parentOrigin);
    return true;
  }
  function insertText(text) {
    return new Promise((resolve) => {
      const id = nextId++;
      if (!postToParent({ type: 'sidecar:insert', id, text })) { resolve(false); return; }
      const timer = setTimeout(() => { pending.delete(id); resolve(false); }, 1500);
      pending.set(id, (ok) => { clearTimeout(timer); resolve(ok); });
    });
  }

  const cfg = await store.get(KEYS);
  const api = SidecarUI.createApi({ baseUrl: cfg.sidecarApiUrl || '', token: cfg.sidecarToken || '' });
  const host = {
    insertText,
    copy: SidecarUI.copyText,
    saveConfig: (c) => store.set({ sidecarApiUrl: c.apiUrl, sidecarToken: c.token }),
  };
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
    host.openOptions = () => chrome.runtime.openOptionsPage();
  }
  const ui = SidecarUI.mount(document.getElementById('app'), { api, mode: 'panel', host });

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !ALLOWED_PARENTS.includes(e.origin)) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    parentOrigin = e.origin;
    if (d.type === 'sidecar:chat') {
      ui.setChat(typeof d.chatId === 'string' ? d.chatId : null, typeof d.name === 'string' ? d.name : '');
    } else if (d.type === 'sidecar:insert-result') {
      const done = pending.get(d.id);
      if (done) { pending.delete(d.id); done(!!d.ok); }
    }
  });
  postToParent({ type: 'sidecar:ready' });

  // Settings saved on the options page apply without reloading LINE OA Manager.
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || (!changes.sidecarApiUrl && !changes.sidecarToken)) return;
      const next = {};
      if (changes.sidecarApiUrl) next.baseUrl = changes.sidecarApiUrl.newValue || '';
      if (changes.sidecarToken) next.token = changes.sidecarToken.newValue || '';
      const cur = api.getConfig();
      if ((next.baseUrl === undefined || next.baseUrl === cur.baseUrl) && (next.token === undefined || next.token === cur.token)) return;
      api.setConfig(next);
      ui.reconnect();
    });
  }
})();
