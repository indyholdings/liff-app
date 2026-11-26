/* Sidecar options page: API URL + staff token in chrome.storage.local, and a connection test. */
(async function () {
  'use strict';
  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = hasChromeStorage
    ? { get: (keys) => chrome.storage.local.get(keys), set: (obj) => chrome.storage.local.set(obj) }
    : SidecarUI.localStore; // dev: page opened outside Chrome's extension context

  const $ = (id) => document.getElementById(id);

  // Brand: name in the copy, and the logo with its tagline above the form when the brand has one.
  const brand = SidecarUI.brand;
  if (brand.name !== 'Sidecar') {
    for (const el of document.querySelectorAll('[data-brand-text]')) el.textContent = el.textContent.replace(/Sidecar/g, brand.name);
    $('optTitle').textContent = 'ตั้งค่า ' + brand.name;
  }
  const logo = SidecarUI.brandLogo('landscape', 'auto', 'sc-brand-logo');
  if (logo) {
    const head = $('brandHead');
    head.append(logo);
    if (brand.tagline) {
      const tag = document.createElement('div');
      tag.className = 'sc-brand-tagline';
      tag.textContent = brand.tagline;
      head.append(tag);
    }
    head.hidden = false;
  }
  const apiUrl = $('apiUrl');
  const token = $('token');
  const result = $('result');

  const saved = await store.get(['sidecarApiUrl', 'sidecarToken']);
  apiUrl.value = saved.sidecarApiUrl || '';
  token.value = saved.sidecarToken || '';

  function line(kind, text) {
    const el = document.createElement('div');
    el.className = 'sc-notice' + (kind === 'ok' ? '' : kind === 'warn' ? ' sc-warn' : ' sc-danger');
    el.textContent = text;
    result.append(el);
  }
  function read() {
    return { baseUrl: apiUrl.value.trim().replace(/\/+$/, ''), token: token.value.trim() };
  }
  function valid(cfg) {
    result.replaceChildren();
    if (!/^https?:\/\//i.test(cfg.baseUrl)) { line('err', 'API URL ต้องขึ้นต้นด้วย https://'); return false; }
    if (!cfg.token) { line('err', 'กรุณาใส่ staff token'); return false; }
    return true;
  }

  $('showToken').addEventListener('change', (e) => { token.type = e.target.checked ? 'text' : 'password'; });

  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cfg = read();
    if (!valid(cfg)) return;
    await store.set({ sidecarApiUrl: cfg.baseUrl, sidecarToken: cfg.token });
    line('ok', 'บันทึกแล้ว — แผง ' + brand.name + ' ที่เปิดอยู่จะใช้ค่าใหม่ทันที');
  });

  $('test').addEventListener('click', async () => {
    const cfg = read();
    if (!valid(cfg)) return;
    const btn = $('test');
    btn.disabled = true;
    const api = SidecarUI.createApi(cfg);
    try {
      const health = await api.get('/health', { silentAuth: true });
      line('ok', 'เซิร์ฟเวอร์ตอบกลับ' + (health.version ? ' (เวอร์ชัน ' + health.version + ')' : ''));
      if (health.configured === false) {
        const missing = Array.isArray(health.missing) && health.missing.length ? ': ' + health.missing.join(', ') : '';
        line('warn', 'เซิร์ฟเวอร์ยังตั้งค่า secret ไม่ครบ' + missing + ' — แจ้งผู้ดูแลระบบ');
      }
      try {
        const me = await api.get('/api/me', { silentAuth: true });
        line('ok', 'token ใช้ได้ — เข้าสู่ระบบเป็น ' + me.staff.name + (me.staff.role === 'admin' ? ' (แอดมิน)' : ''));
      } catch (err) {
        line('err', 'เซิร์ฟเวอร์ใช้ได้ แต่ token ไม่ผ่าน: ' + err.message);
      }
    } catch (err) {
      line('err', 'เชื่อมต่อ API ไม่ได้: ' + err.message);
    }
    btn.disabled = false;
  });
})();
