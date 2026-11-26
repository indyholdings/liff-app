/* Sidecar shared UI — used by the Chrome extension panel and by staff.html.
 * No framework, no build step. API data is only ever written with textContent / properties.
 * Contract: docs/sidecar-contract.md
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ brand
  // Static, chosen when the UI is built: extension/brand.js sets window.SIDECAR_BRAND before this
  // file loads. Asset paths in it are relative to the extension root, one level above this script.
  const SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const BRAND = (function () {
    const raw = global.SIDECAR_BRAND && typeof global.SIDECAR_BRAND === 'object' ? global.SIDECAR_BRAND : {};
    let root = '';
    try { root = SCRIPT_SRC ? new URL('../', SCRIPT_SRC).href : ''; } catch (_) { root = ''; }
    const asset = (p) => {
      if (!p || typeof p !== 'string') return '';
      try { return root ? new URL(p, root).href : p; } catch (_) { return ''; }
    };
    const pair = (light, dark) => { const l = asset(light); return l ? { light: l, dark: asset(dark) || l } : null; };
    return {
      id: String(raw.id || 'sidecar'),
      name: String(raw.name || 'Sidecar'),
      tagline: raw.tagline ? String(raw.tagline) : '',
      theme: String(raw.theme || 'default'),
      mark: pair(raw.logo_mark, raw.logo_mark_on_dark),
      landscape: pair(raw.logo_landscape, raw.logo_landscape_on_dark),
      fontsCss: asset(raw.fonts_css),
    };
  })();

  /** Theme attribute, bundled fonts and page title. Runs once, as soon as this file loads. */
  function applyBrand() {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    html.dataset.theme = BRAND.theme;
    if (BRAND.fontsCss && !document.querySelector('link[data-sc-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = BRAND.fontsCss;
      link.setAttribute('data-sc-fonts', '');
      document.head.append(link);
    }
    if (BRAND.name !== 'Sidecar' && /^Sidecar\b/.test(document.title)) document.title = document.title.replace(/^Sidecar\b/, BRAND.name);
  }
  applyBrand();

  /**
   * The brand's logo as an element, or null when the brand has none.
   * kind: "mark" | "landscape". on: "auto" follows the colour scheme, "dark" is for a dark surface.
   */
  function brandLogo(kind, on, cls) {
    const set = kind === 'landscape' ? BRAND.landscape : BRAND.mark;
    if (!set) return null;
    const img = document.createElement('img');
    img.alt = BRAND.name;
    img.decoding = 'async';
    if (on === 'dark' || set.dark === set.light) {
      img.src = on === 'dark' ? set.dark : set.light;
      img.className = cls || '';
      return img;
    }
    img.src = set.light;
    const pic = document.createElement('picture');
    pic.className = cls || '';
    const dark = document.createElement('source');
    dark.srcset = set.dark;
    dark.media = '(prefers-color-scheme: dark)';
    pic.append(dark, img);
    return pic;
  }

  // ------------------------------------------------------------------ profile
  // What kind of business this deployment serves. Comes from GET /api/config after sign-in; a
  // server without that route (or any failure) leaves the built-in retail profile in place.
  const STAGE_KEYS = ['new', 'interested', 'quoted', 'awaiting_payment', 'paid', 'booked', 'won', 'lost', 'spam'];
  const MEDIA_KEYS = ['slip', 'product', 'before_after', 'document', 'other'];
  const PAY_KEYS = ['transfer', 'cod', 'installment'];
  const RETAIL_CONFIG = {
    profile: 'retail',
    stages: [
      { key: 'new', label: 'ใหม่' },
      { key: 'interested', label: 'สนใจ' },
      { key: 'quoted', label: 'เสนอราคาแล้ว' },
      { key: 'awaiting_payment', label: 'รอโอน' },
      { key: 'paid', label: 'ชำระแล้ว' },
      { key: 'booked', label: 'จองคิวแล้ว' },
      { key: 'won', label: 'ปิดการขาย' },
      { key: 'lost', label: 'ยกเลิก' },
      { key: 'spam', label: 'สแปม' },
    ],
    detail_fields: [],
    media_categories: [
      { key: 'slip', label: 'สลิป' },
      { key: 'product', label: 'สินค้า' },
      { key: 'before_after', label: 'ก่อน-หลัง' },
      { key: 'document', label: 'เอกสาร' },
      { key: 'other', label: 'อื่นๆ' },
    ],
    payment_methods: [
      { key: 'transfer', label: 'โอนเงิน' },
      { key: 'cod', label: 'เก็บเงินปลายทาง' },
      { key: 'installment', label: 'ผ่อนชำระ' },
    ],
    labels: {
      product: 'สินค้า',
      products: 'สินค้า',
      order: 'ออเดอร์',
      order_empty: 'ยังไม่มีออเดอร์',
      product_search: 'ค้นหาสินค้าเพื่อเพิ่ม…',
      summary_button: 'ร่างข้อความสรุป',
    },
  };
  let CONFIG = RETAIL_CONFIG;

  /** Takes what the server sent and keeps only well-formed parts; anything else falls back to retail. */
  function setConfig(raw) {
    const base = RETAIL_CONFIG;
    if (!raw || typeof raw !== 'object') { CONFIG = base; return CONFIG; }
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
    const keyed = (list, allowed, fallback) => {
      if (!Array.isArray(list)) return fallback;
      const seen = new Set();
      const out = [];
      for (const it of list) {
        const key = it && str(it.key);
        if (!key || !allowed.includes(key) || seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label: str(it.label) || key });
      }
      return out.length ? out : fallback;
    };
    // Every stage and category must stay reachable, so ones the server left out keep their retail label.
    const complete = (list, fallback) => list.concat(fallback.filter((f) => !list.some((x) => x.key === f.key)));
    const fields = [];
    if (Array.isArray(raw.detail_fields)) {
      for (const f of raw.detail_fields) {
        const key = f && str(f.key);
        if (!key || !/^[a-z0-9_]{1,40}$/i.test(key) || fields.some((x) => x.key === key)) continue;
        const options = f.type === 'select' && Array.isArray(f.options)
          ? f.options.filter((o) => o && str(o.value)).map((o) => ({ value: str(o.value), label: str(o.label) || str(o.value) }))
          : null;
        fields.push({ key, label: str(f.label) || key, type: options && options.length ? 'select' : 'text', options: options || [], placeholder: str(f.placeholder) });
      }
    }
    const labels = {};
    for (const k of Object.keys(base.labels)) labels[k] = (raw.labels && str(raw.labels[k])) || base.labels[k];
    CONFIG = {
      profile: str(raw.profile) || base.profile,
      stages: complete(keyed(raw.stages, STAGE_KEYS, base.stages), base.stages),
      detail_fields: fields,
      media_categories: complete(keyed(raw.media_categories, MEDIA_KEYS, base.media_categories), base.media_categories),
      payment_methods: keyed(raw.payment_methods, PAY_KEYS, base.payment_methods),
      labels,
    };
    return CONFIG;
  }
  function stageLabel(key) { const s = CONFIG.stages.find((x) => x.key === key); return s ? s.label : key; }
  function mediaLabel(key) { const c = CONFIG.media_categories.find((x) => x.key === key); return c ? c.label : key; }
  /** An order moves through the same money steps as the lead, so it borrows those two stage labels. */
  function orderStatusLabel(status) {
    if (status === 'draft') return 'ร่าง';
    if (status === 'cancelled') return 'ยกเลิก';
    if (status === 'awaiting_payment' || status === 'paid') return stageLabel(status);
    return status;
  }
  function detailField(key) { return CONFIG.detail_fields.find((f) => f.key === key) || null; }
  /** The label of a select value, or the raw text for free-text fields. */
  function detailText(lead, key) {
    const v = lead && lead.details && lead.details[key];
    if (v == null || v === '') return '';
    const f = detailField(key);
    if (f && f.type === 'select') { const o = f.options.find((x) => x.value === v); return o ? o.label : String(v); }
    return String(v);
  }
  const L = () => CONFIG.labels;

  // ------------------------------------------------------------------ constants
  const NOTE_KIND = { ai: 'AI', staff: 'ทีม', system: 'ระบบ' };
  const CARD_FIELDS = [
    { key: 'full_name', label: 'ชื่อ-นามสกุล', placeholder: 'ยังไม่มีชื่อ', wide: true },
    { key: 'phone', label: 'เบอร์โทร', placeholder: '08x-xxx-xxxx', type: 'tel' },
    { key: 'postcode', label: 'รหัสไปรษณีย์', placeholder: '10xxx', inputmode: 'numeric' },
    { key: 'address', label: 'ที่อยู่จัดส่ง', placeholder: 'บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด', wide: true, multiline: true },
  ];
  const LEAD_POLL_MS = 20000;
  const INBOX_POLL_MS = 30000;
  const DUE_POLL_MS = 60000;

  // ------------------------------------------------------------------ dom helpers
  function append(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false || kid === true) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  /** Replaces an element's children. Unlike replaceChildren it flattens arrays and skips null/false. */
  function fill(el, ...kids) {
    el.replaceChildren();
    return append(el, kids);
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'value') value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'disabled' || k === 'readOnly' || k === 'open' || k === 'hidden') el[k] = true;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    append(el, kids);
    if (value !== undefined) el.value = value;
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    back: 'M15 18l-6-6 6-6',
    chev: 'M9 6l6 6-6 6',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    close: 'M6 6l12 12M18 6L6 18',
    copy: 'M9 9h10v11H9zM5 15V4h10',
    insert: 'M4 12h11M11 8l4 4-4 4M19 5v14',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7',
    gear: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM9 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name] || '');
    svg.append(p);
    return svg;
  }
  function iconBtn(name, title, onclick, extraClass) {
    return h('button', { type: 'button', class: 'sc-iconbtn' + (extraClass ? ' ' + extraClass : ''), title, 'aria-label': title, onclick }, icon(name));
  }

  // ------------------------------------------------------------------ formatters
  const nf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' });
  const timeFmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function num(v) {
    const n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return Number.isFinite(n) ? round2(n) : 0;
  }
  function money(n) { return '฿' + nf.format(round2(n)); }
  function calcTotals(o) {
    const subtotal = round2((o.items || []).reduce((s, it) => s + num(it.qty) * num(it.unit_price), 0));
    const discount = num(o.discount);
    const shipping = num(o.shipping_fee);
    return { subtotal, discount, shipping_fee: shipping, total: round2(subtotal - discount + shipping) };
  }
  function toDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function relTime(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return m + ' นาที';
    const hr = Math.round(m / 60);
    if (hr < 24) return hr + ' ชม.';
    const day = Math.round(hr / 24);
    if (day < 7) return day + ' วัน';
    return dateFmt.format(d);
  }
  function fmtDateTime(iso) {
    const d = toDate(iso);
    if (!d) return '';
    const today = new Date();
    const same = d.toDateString() === today.toDateString();
    return (same ? 'วันนี้' : dateFmt.format(d)) + ' ' + timeFmt.format(d);
  }
  function isPast(iso) { const d = toDate(iso); return !!d && d.getTime() <= Date.now(); }
  function initialOf(name) {
    const chars = Array.from(String(name || '').trim());
    return chars.length ? chars[0].toUpperCase() : '?';
  }
  function safeUrl(url) {
    const s = String(url || '');
    return /^(https?:|data:image\/|blob:)/i.test(s) ? s : '';
  }
  function debounce(fn, ms) {
    let t;
    const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function avatar(lead, small) {
    const name = lead.display_name || lead.full_name || '';
    const cls = 'sc-avatar' + (small ? ' sc-sm' : '');
    const fallback = () => h('div', { class: cls, 'aria-hidden': 'true' }, initialOf(name));
    const src = safeUrl(lead.picture_url);
    if (!src) return fallback();
    const img = h('img', { class: cls, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.replaceWith(fallback()));
    img.src = src;
    return img;
  }
  function stageTag(stage) {
    return h('span', { class: 'sc-stage-tag sc-st-' + stage }, stageLabel(stage));
  }
  function leadName(l) { return l.display_name || l.full_name || 'ลูกค้า LINE'; }

  // ------------------------------------------------------------------ storage + clipboard
  // JSON values under plain keys; shared by staff.html and by the extension when run outside Chrome (dev).
  const localStore = {
    async get(keys) {
      const out = {};
      for (const k of keys) {
        try {
          const raw = global.localStorage.getItem(k);
          if (raw != null) out[k] = JSON.parse(raw);
        } catch (_) { /* unreadable value: treat as unset */ }
      }
      return out;
    },
    async set(obj) {
      for (const k of Object.keys(obj)) {
        try {
          if (obj[k] == null) global.localStorage.removeItem(k);
          else global.localStorage.setItem(k, JSON.stringify(obj[k]));
        } catch (_) { /* storage blocked: config lasts for this page only */ }
      }
    },
  };

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through to execCommand */ }
    try {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0;opacity:0', readOnly: true, value: text });
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------ api client
  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || code);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  const STATUS_TEXT = {
    0: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตหรือ API URL',
    400: 'ข้อมูลไม่ถูกต้อง',
    401: 'ยังไม่ได้เข้าสู่ระบบ หรือ token ไม่ถูกต้อง',
    403: 'ไม่มีสิทธิ์ทำรายการนี้',
    404: 'ไม่พบข้อมูล',
    500: 'ระบบขัดข้อง ลองใหม่อีกครั้ง',
    503: 'เซิร์ฟเวอร์ยังตั้งค่าไม่ครบ แจ้งผู้ดูแลระบบ',
  };

  function createApi(initial) {
    const state = { baseUrl: '', token: '', idToken: '' };
    const api = {
      onUnauthorized: null,
      setConfig(c) {
        if (!c) return;
        if ('baseUrl' in c) state.baseUrl = String(c.baseUrl || '').trim().replace(/\/+$/, '');
        if ('token' in c) state.token = String(c.token || '').trim();
        if ('idToken' in c) state.idToken = String(c.idToken || '');
      },
      getConfig() { return { baseUrl: state.baseUrl, token: state.token, idToken: state.idToken }; },
      isConfigured() { return !!state.baseUrl && !!(state.token || state.idToken); },
      async request(method, path, body, opts) {
        opts = opts || {};
        const headers = {};
        if (state.token) headers.Authorization = 'Bearer ' + state.token;
        // The bearer token wins; the LIFF id token is sent alone, or with it when a route needs both.
        if (state.idToken && (!state.token || opts.withIdToken)) headers['X-Line-Id-Token'] = state.idToken;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
          res = await fetch(state.baseUrl + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store',
          });
        } catch (_) {
          throw new ApiError(0, 'network', STATUS_TEXT[0]);
        }
        let data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (!res.ok || !data || data.ok === false) {
          const base = STATUS_TEXT[res.status] || (res.status >= 500 ? STATUS_TEXT[500] : 'ทำรายการไม่สำเร็จ (' + res.status + ')');
          const detail = data && typeof data.message === 'string' && data.message ? ' — ' + data.message : '';
          const err = new ApiError(res.status, (data && data.error) || 'http_' + res.status, base + detail);
          if (res.status === 401 && !opts.silentAuth && typeof api.onUnauthorized === 'function') api.onUnauthorized(err);
          throw err;
        }
        return data;
      },
      get(path, opts) { return api.request('GET', path, undefined, opts); },
      post(path, body, opts) { return api.request('POST', path, body === undefined ? {} : body, opts); },
      put(path, body, opts) { return api.request('PUT', path, body, opts); },
      patch(path, body, opts) { return api.request('PATCH', path, body, opts); },
      del(path, opts) { return api.request('DELETE', path, undefined, opts); },
    };
    api.setConfig(initial);
    return api;
  }

  // ------------------------------------------------------------------ shared state blocks
  function skeleton() {
    return h('div', { class: 'sc-view', 'data-sc': 'loading', 'aria-busy': 'true' },
      h('div', { class: 'sc-card sc-sec-body' },
        h('div', { class: 'sc-skel sc-skel-line', style: 'width:55%' }),
        h('div', { class: 'sc-skel sc-skel-line', style: 'width:80%' }),
        h('div', { class: 'sc-skel sc-skel-line', style: 'width:40%' })),
      h('div', { class: 'sc-skel sc-skel-block' }),
      h('div', { class: 'sc-skel sc-skel-block' }));
  }
  function emptyState(title, text, ...actions) {
    return h('div', { class: 'sc-empty' }, h('b', null, title), text ? h('p', null, text) : null, actions);
  }
  function errorState(err, retry) {
    return h('div', { class: 'sc-empty', 'data-sc': 'error' },
      h('b', null, 'โหลดข้อมูลไม่สำเร็จ'),
      h('p', null, (err && err.message) || STATUS_TEXT[500]),
      retry ? h('button', { type: 'button', class: 'sc-btn', onclick: retry }, icon('refresh'), 'ลองใหม่') : null);
  }
  function section(title, opts, ...body) {
    opts = opts || {};
    return h('section', { class: 'sc-card' + (opts.class ? ' ' + opts.class : ''), 'data-sc': opts.sc },
      h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, title), opts.head || null),
      h('div', { class: 'sc-sec-body' }, body));
  }

  // ================================================================== lead view
  class LeadView {
    constructor(app, bundle, opts) {
      this.app = app;
      this.opts = opts || {};
      this.b = bundle;
      this.albumFilter = 'all';
      this.timer = null;
      this.busy = false;
      this.summaryText = null;
      this.cardInputs = {};
      this.cardStates = {};
      this.detailInputs = {};
      this.detailStates = {};
      this.initDraft();

      this.secHead = h('section', { class: 'sc-card', 'data-sc': 'lead-head' });
      this.secAgent = h('section', { class: 'sc-card sc-agent', 'data-sc': 'agent' });
      this.secMsgs = h('section', { class: 'sc-card', 'data-sc': 'messages' });
      this.secCard = h('section', { class: 'sc-card', 'data-sc': 'card' });
      this.secDetails = h('section', { class: 'sc-card', 'data-sc': 'details', hidden: true });
      this.secOrder = h('section', { class: 'sc-card', 'data-sc': 'order' });
      this.secNotes = h('section', { class: 'sc-card', 'data-sc': 'notes' });
      this.secAlbum = h('section', { class: 'sc-card', 'data-sc': 'album' });
      this.secFollow = h('section', { class: 'sc-card', 'data-sc': 'followup' });
      this.el = h('div', { class: 'sc-view', 'data-sc': 'lead', 'data-lead-id': bundle.lead.id },
        this.secHead, this.secAgent, this.secMsgs, this.secCard, this.secDetails, this.secOrder, this.secNotes, this.secAlbum, this.secFollow);

      this.buildCard();
      this.buildDetails();
      this.buildNotesShell();
      this.renderAll();
    }

    get lead() { return this.b.lead; }
    get api() { return this.app.api; }

    // ---- lifecycle
    start() {
      this.stop();
      this.timer = setInterval(() => {
        if (document.visibilityState !== 'visible' || this.busy || this.app.overlayOpen()) return;
        this.reload(true);
      }, LEAD_POLL_MS);
    }
    stop() { clearInterval(this.timer); this.timer = null; }

    async reload(quiet) {
      try {
        const b = await this.api.get('/api/leads/' + this.lead.id);
        if (b.lead) this.applyBundle(b);
      } catch (err) {
        if (!quiet) this.app.toast(err.message, 'err');
      }
    }

    applyBundle(b) {
      this.b = b;
      if (!this.orderDirty) this.initDraft();
      this.renderAll();
    }

    renderAll() {
      this.renderHead();
      this.renderAgent();
      this.renderMessages();
      this.syncCard();
      this.syncDetails();
      if (!this.orderDirty) this.renderOrder();
      this.renderNotes();
      this.renderAlbum();
      this.renderFollow();
    }

    async patchLead(body, okMsg) {
      const r = await this.api.patch('/api/leads/' + this.lead.id, body);
      this.b.lead = r.lead;
      if (okMsg) this.app.toast(okMsg, 'ok');
      return r.lead;
    }

    // ---- header: identity, stage, tags
    renderHead() {
      const active = document.activeElement;
      if (active && active.classList && active.classList.contains('sc-chip-input') && this.secHead.contains(active)) return;
      const l = this.lead;
      const me = this.app.me;
      const subBits = [];
      if (l.full_name && l.display_name && l.full_name !== l.display_name) subBits.push(l.full_name);
      if (l.last_message_at) subBits.push('ล่าสุด ' + relTime(l.last_message_at));
      const staff = this.app.staffList;
      if (!(staff && staff.length)) subBits.push(l.assignee_name ? 'ดูแลโดย ' + l.assignee_name : 'ยังไม่มีผู้ดูแล');

      let claim = null;
      if (staff && staff.length) {
        claim = h('select', {
          class: 'sc-input sc-assignee', 'aria-label': 'ผู้ดูแลลูกค้า', title: 'ผู้ดูแลลูกค้า', 'data-sc': 'assignee',
          onchange: (e) => this.setAssignee(e.target.value ? Number(e.target.value) : null),
        }, h('option', { value: '' }, 'ไม่มีผู้ดูแล'), staff.map((s) => h('option', { value: s.id }, s.name)));
        claim.value = l.assignee_id == null ? '' : String(l.assignee_id);
      } else if (me && l.assignee_id !== me.id) {
        claim = h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'claim', onclick: () => this.setAssignee(me.id) }, 'รับเคสนี้');
      }
      const stageLock = (l.locked_fields || []).includes('stage')
        ? h('div', { class: 'sc-lockline', 'data-sc': 'stage-lock' }, icon('lock'), 'ทีมตั้งสถานะเอง Agent จะไม่เปลี่ยนให้ ',
          h('button', { type: 'button', class: 'sc-link', onclick: () => this.unlock('stage') }, 'ให้ Agent ดูแลสถานะต่อ'))
        : null;

      const stageChips = h('div', { class: 'sc-chips', role: 'group', 'aria-label': 'สถานะลูกค้า', 'data-sc': 'stages' },
        CONFIG.stages.map((s) => h('button', {
          type: 'button',
          class: 'sc-chip sc-st-' + s.key + (l.stage === s.key ? ' sc-on' : ''),
          'aria-pressed': l.stage === s.key ? 'true' : 'false',
          'data-stage': s.key,
          onclick: () => this.setStage(s.key),
        }, s.label)));

      const tagInput = h('input', {
        class: 'sc-chip-input', type: 'text', placeholder: '+ แท็ก', maxlength: '30', 'aria-label': 'เพิ่มแท็ก', 'data-sc': 'tag-input',
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); this.addTag(tagInput); }
          if (e.key === 'Escape') { tagInput.value = ''; tagInput.blur(); }
        },
        onblur: () => { if (tagInput.value.trim()) this.addTag(tagInput); else this.renderHead(); },
      });
      const tags = h('div', { class: 'sc-chips', 'data-sc': 'tags' },
        (l.interests || []).map((t) => h('span', { class: 'sc-chip sc-interest', title: 'ความสนใจที่ Agent จับได้' }, t)),
        (l.tags || []).map((t) => h('span', { class: 'sc-chip sc-tag' }, t,
          h('button', { type: 'button', class: 'sc-x', 'aria-label': 'ลบแท็ก ' + t, onclick: () => this.removeTag(t) }, '×'))),
        tagInput);

      fill(this.secHead, h('div', { class: 'sc-lead-head' },
        h('div', { class: 'sc-ident' },
          avatar(l),
          h('div', { class: 'sc-ident-text' },
            h('div', { class: 'sc-name', 'data-sc': 'lead-name' }, leadName(l)),
            h('div', { class: 'sc-sub' }, subBits.join(' · '))),
          claim),
        stageChips,
        stageLock,
        tags));
    }

    async setStage(stage) {
      const l = this.lead;
      if (l.stage === stage) return;
      const prev = l.stage;
      l.stage = stage;
      this.renderHead();
      try {
        await this.patchLead({ stage });
        this.renderHead();
        this.syncCard();
        this.app.notifyChanged();
      } catch (err) {
        this.lead.stage = prev;
        this.renderHead();
        this.app.toast('เปลี่ยนสถานะไม่สำเร็จ: ' + err.message, 'err');
      }
    }

    async setAssignee(id) {
      try {
        await this.patchLead({ assignee_id: id }, id == null ? 'ยกเลิกผู้ดูแลแล้ว' : 'ตั้งผู้ดูแลแล้ว');
      } catch (err) { this.app.toast(err.message, 'err'); }
      this.renderHead();
    }

    /** Hands a field back to the agent: it may fill or change it again. */
    async unlock(key) {
      try {
        await this.patchLead({ unlock: [key] }, 'ปลดล็อกแล้ว — Agent กรอกช่องนี้ได้อีกครั้ง');
      } catch (err) { this.app.toast(err.message, 'err'); }
      this.renderHead();
      this.syncCard();
      this.syncDetails();
    }

    async addTag(input) {
      const t = input.value.trim();
      input.value = '';
      const tags = this.lead.tags || [];
      if (!t || tags.includes(t)) { this.renderHead(); return; }
      input.blur();
      try {
        await this.patchLead({ tags: tags.concat(t) });
      } catch (err) { this.app.toast(err.message, 'err'); }
      this.renderHead();
    }

    async removeTag(t) {
      try {
        await this.patchLead({ tags: (this.lead.tags || []).filter((x) => x !== t) });
      } catch (err) { this.app.toast(err.message, 'err'); }
      this.renderHead();
    }

    // ---- agent box
    renderAgent() {
      const l = this.lead;
      const analyzeBtn = h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', 'data-sc': 'analyze', onclick: (e) => this.analyze(e.currentTarget) }, icon('refresh'), 'วิเคราะห์ใหม่');
      const head = h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'Agent แนะนำ'), analyzeBtn);
      const body = h('div', { class: 'sc-sec-body' });
      if (!l.ai_summary && !l.next_action && !l.suggested_reply) {
        body.append(h('div', { class: 'sc-muted' }, 'Agent ยังไม่ได้วิเคราะห์แชทนี้ กด "วิเคราะห์ใหม่" เพื่อให้อ่านแชทล่าสุด'));
      } else {
        if (l.ai_summary) body.append(h('div', { 'data-sc': 'ai-summary', style: 'white-space:pre-wrap' }, l.ai_summary));
        if (l.next_action) {
          body.append(h('dl', { class: 'sc-kv' }, h('dt', null, 'ควรทำต่อ'), h('dd', { class: 'sc-next', 'data-sc': 'next-action' }, l.next_action)));
        }
        if (l.suggested_reply) {
          body.append(
            h('div', { class: 'sc-label' }, 'ร่างคำตอบ'),
            h('blockquote', { class: 'sc-quote', 'data-sc': 'suggested-reply' }, l.suggested_reply),
            this.textActions(() => l.suggested_reply, 'reply', true));
        }
      }
      fill(this.secAgent, head, body);
    }

    /** Insert / copy buttons for a piece of text. `cta` marks the one main action of the view. */
    textActions(getText, key, cta) {
      const row = h('div', { class: 'sc-row-gap' });
      const strong = ' sc-primary' + (cta ? ' sc-cta' : '');
      if (this.app.host.insertText) {
        row.append(h('button', { type: 'button', class: 'sc-btn sc-small' + strong, 'data-sc': key + '-insert', onclick: () => this.app.insertOrCopy(getText()) }, icon('insert'), 'ใส่ในช่องแชท'));
      }
      row.append(h('button', {
        type: 'button', class: 'sc-btn sc-small' + (this.app.host.insertText ? '' : strong), 'data-sc': key + '-copy',
        onclick: () => this.app.copy(getText()),
      }, icon('copy'), 'คัดลอก'));
      return row;
    }

    async analyze(btn) {
      if (this.busy) return;
      this.busy = true;
      btn.disabled = true;
      btn.lastChild.textContent = 'กำลังวิเคราะห์…';
      try {
        const b = await this.api.post('/api/leads/' + this.lead.id + '/analyze');
        if (b.lead) this.applyBundle(b);
        this.app.toast('วิเคราะห์แชทล่าสุดแล้ว', 'ok');
      } catch (err) {
        this.app.toast('วิเคราะห์ไม่สำเร็จ: ' + err.message, 'err');
        this.renderAgent();
      } finally {
        this.busy = false;
      }
    }

    // ---- recent messages (collapsed)
    renderMessages() {
      const msgs = this.b.messages || [];
      const wasOpen = !!(this.msgDetails && this.msgDetails.open);
      if (!msgs.length) { this.secMsgs.hidden = true; return; }
      this.secMsgs.hidden = false;
      const list = h('div', { class: 'sc-msgs' }, msgs.map((m) => {
        const text = m.type === 'text' ? (m.text || '') : m.type === 'image' ? '[รูปภาพ]' : m.type === 'sticker' ? '[สติกเกอร์]' : (m.text || '[ข้อความอื่น]');
        return h('div', { class: 'sc-msg' + (m.direction === 'out' ? ' sc-out' : '') }, text, h('time', null, fmtDateTime(m.sent_at)));
      }));
      this.msgDetails = h('details', { class: 'sc-details', open: wasOpen },
        h('summary', null,
          h('span', { class: 'sc-chev' }, icon('chev')),
          h('h2', { class: 'sc-sec-title', style: 'flex:none' }, 'แชทล่าสุด'),
          h('span', { class: 'sc-sub' }, msgs.length + ' ข้อความ')),
        list);
      this.msgDetails.addEventListener('toggle', () => { if (this.msgDetails.open) list.scrollTop = list.scrollHeight; });
      fill(this.secMsgs, this.msgDetails);
    }

    // ---- lead card (inline edit)
    buildCard() {
      const grid = h('div', { class: 'sc-grid-card' });
      for (const f of CARD_FIELDS) {
        const state = h('span', { class: 'sc-state' });
        const lock = h('button', {
          type: 'button', class: 'sc-lockmark', hidden: true, 'data-lock': f.key,
          title: 'ทีมแก้ไขเอง — Agent จะไม่เขียนทับ (กดเพื่อปลดล็อก)', 'aria-label': 'ปลดล็อก ' + f.label + ' ให้ Agent กรอกได้',
          onclick: (e) => { e.preventDefault(); this.unlock(f.key); },
        }, icon('lock'));
        const common = {
          class: 'sc-input', id: 'sc-f-' + f.key, placeholder: f.placeholder, 'data-field': f.key, autocomplete: 'off',
          onblur: () => this.saveField(f.key),
        };
        let input;
        if (f.multiline) {
          input = h('textarea', Object.assign({ rows: '2' }, common, {
            onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) input.blur(); if (e.key === 'Escape') this.resetField(f.key); },
          }));
        } else {
          input = h('input', Object.assign({ type: f.type || 'text', inputmode: f.inputmode }, common, {
            onkeydown: (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') this.resetField(f.key); },
          }));
        }
        this.cardInputs[f.key] = input;
        this.cardStates[f.key] = { state, lock };
        let control = input;
        if (f.key === 'phone') {
          this.callLink = h('a', { class: 'sc-iconbtn', title: 'โทร', 'aria-label': 'โทรหาลูกค้า', hidden: true }, icon('phone'));
          control = h('div', { class: 'sc-phone-wrap' }, input, this.callLink);
        }
        // Only a shop ships to the address; elsewhere it is simply where the customer can be reached.
        const label = f.key === 'address' && CONFIG.profile !== 'retail' ? 'ที่อยู่ติดต่อ' : f.label;
        grid.append(h('div', { class: 'sc-field' + (f.wide ? ' sc-wide' : '') },
          h('div', { class: 'sc-label' }, h('label', { for: 'sc-f-' + f.key }, label), lock, state),
          control));
      }
      this.samePhoneBox = h('div', { hidden: true });
      fill(this.secCard, 
        h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'ข้อมูลลูกค้า')),
        h('div', { class: 'sc-sec-body' }, this.samePhoneBox, grid));
    }

    syncCard() {
      const l = this.lead;
      const locked = l.locked_fields || [];
      for (const f of CARD_FIELDS) {
        const input = this.cardInputs[f.key];
        const server = l[f.key] == null ? '' : String(l[f.key]);
        // Never fight the person typing: a focused field keeps what they typed.
        if (document.activeElement !== input) input.value = server;
        input.dataset.saved = server;
        this.cardStates[f.key].lock.hidden = !locked.includes(f.key);
      }
      const tel = String(l.phone || '').replace(/[^0-9+]/g, '');
      this.callLink.hidden = !tel;
      if (tel) this.callLink.href = 'tel:' + tel;

      const same = this.b.same_phone || [];
      if (!same.length) { this.samePhoneBox.hidden = true; this.samePhoneBox.replaceChildren(); return; }
      this.samePhoneBox.hidden = false;
      fill(this.samePhoneBox, h('div', { class: 'sc-notice', 'data-sc': 'same-phone' },
        h('b', null, 'ลูกค้าเก่า'), ' — เบอร์นี้ตรงกับ ',
        same.map((s, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'sc-link', onclick: () => this.app.openLead(s.id) }, leadName(s))])));
    }

    // ---- requirement card: the profile's detail fields (empty for retail, so the card stays hidden)
    buildDetails() {
      const fields = CONFIG.detail_fields;
      this.secDetails.hidden = !fields.length;
      if (!fields.length) return;
      const grid = h('div', { class: 'sc-grid-card' });
      fields.forEach((f, i) => {
        const lockKey = 'details.' + f.key;
        const state = h('span', { class: 'sc-state' });
        const lock = h('button', {
          type: 'button', class: 'sc-lockmark', hidden: true, 'data-lock': lockKey,
          title: 'ทีมแก้ไขเอง — Agent จะไม่เขียนทับ (กดเพื่อปลดล็อก)', 'aria-label': 'ปลดล็อก ' + f.label + ' ให้ Agent กรอกได้',
          onclick: (e) => { e.preventDefault(); this.unlock(lockKey); },
        }, icon('lock'));
        let input;
        if (f.type === 'select') {
          input = h('select', { class: 'sc-input', id: 'sc-d-' + f.key, 'data-detail': f.key, onchange: () => this.saveDetail(f.key) },
            h('option', { value: '' }, 'ยังไม่ระบุ'), f.options.map((o) => h('option', { value: o.value }, o.label)));
        } else {
          input = h('input', {
            class: 'sc-input', id: 'sc-d-' + f.key, type: 'text', placeholder: f.placeholder || 'ยังไม่ระบุ', 'data-detail': f.key, autocomplete: 'off', maxlength: '200',
            onblur: () => this.saveDetail(f.key),
            onkeydown: (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = input.dataset.saved || ''; input.blur(); } },
          });
        }
        this.detailInputs[f.key] = input;
        this.detailStates[f.key] = { state, lock };
        // An odd field count leaves the last one alone on its row: let it span the card.
        const wide = fields.length % 2 === 1 && i === fields.length - 1;
        grid.append(h('div', { class: 'sc-field' + (wide ? ' sc-wide' : '') },
          h('div', { class: 'sc-label' }, h('label', { for: 'sc-d-' + f.key }, f.label), lock, state),
          input));
      });
      fill(this.secDetails,
        h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'ความต้องการ')),
        h('div', { class: 'sc-sec-body' }, grid));
    }

    syncDetails() {
      const fields = CONFIG.detail_fields;
      if (!fields.length) return;
      const details = this.lead.details || {};
      const locked = this.lead.locked_fields || [];
      for (const f of fields) {
        const input = this.detailInputs[f.key];
        if (!input) continue;
        const server = details[f.key] == null ? '' : String(details[f.key]);
        // A value the server holds that is not among the options still has to show.
        if (f.type === 'select' && server && !f.options.some((o) => o.value === server) && !input.querySelector('option[data-extra]')) {
          input.append(h('option', { value: server, 'data-extra': '' }, server));
        }
        if (document.activeElement !== input) input.value = server;
        input.dataset.saved = server;
        this.detailStates[f.key].lock.hidden = !locked.includes('details.' + f.key);
      }
    }

    async saveDetail(key) {
      const input = this.detailInputs[key];
      const st = this.detailStates[key].state;
      const value = input.value.trim();
      if (value === (input.dataset.saved || '')) { if (input.tagName === 'INPUT') input.value = value; return; }
      st.className = 'sc-state';
      st.textContent = 'กำลังบันทึก…';
      try {
        await this.patchLead({ details: { [key]: value || null } });
        st.className = 'sc-state sc-ok';
        st.textContent = 'บันทึกแล้ว';
        setTimeout(() => { if (st.textContent === 'บันทึกแล้ว') st.textContent = ''; }, 1800);
        this.syncDetails();
        this.app.notifyChanged();
      } catch (err) {
        st.className = 'sc-state sc-err';
        st.textContent = 'บันทึกไม่สำเร็จ';
        input.value = input.dataset.saved || '';
        this.app.toast(err.message, 'err');
      }
    }

    resetField(key) {
      const input = this.cardInputs[key];
      input.value = input.dataset.saved || '';
      input.blur();
    }

    async saveField(key) {
      const input = this.cardInputs[key];
      const st = this.cardStates[key].state;
      const value = input.value.trim();
      if (value === (input.dataset.saved || '')) { input.value = value; return; }
      st.className = 'sc-state';
      st.textContent = 'กำลังบันทึก…';
      try {
        await this.patchLead({ [key]: value || null });
        st.className = 'sc-state sc-ok';
        st.textContent = 'บันทึกแล้ว';
        setTimeout(() => { if (st.textContent === 'บันทึกแล้ว') st.textContent = ''; }, 1800);
        this.syncCard();
        if (key === 'phone') this.reload(true); // same_phone is computed by the server
        if (key === 'full_name') this.renderHead();
      } catch (err) {
        st.className = 'sc-state sc-err';
        st.textContent = 'บันทึกไม่สำเร็จ';
        this.app.toast(err.message, 'err');
      }
    }

    // ---- order
    initDraft() {
      const o = this.b.order;
      this.orderDirty = false;
      this.summaryText = null;
      this.orderReadonly = !!o && (o.status === 'paid' || o.status === 'cancelled');
      this.draft = o ? {
        id: o.id,
        status: o.status,
        items: (o.items || []).map((it) => ({ product_id: it.product_id == null ? null : it.product_id, name: it.name, qty: it.qty, unit_price: it.unit_price })),
        discount: o.discount || 0,
        shipping_fee: o.shipping_fee || 0,
        payment_method: o.payment_method || '',
        deposit_amount: o.deposit_amount == null ? '' : o.deposit_amount,
        note: o.note || '',
      } : this.blankDraft();
    }
    blankDraft() {
      return { id: null, status: null, items: [], discount: 0, shipping_fee: 0, payment_method: '', deposit_amount: '', note: '' };
    }

    markDirty() {
      this.orderDirty = true;
      this.summaryText = null;
      if (this.summaryBox) this.summaryBox.replaceChildren();
      if (this.dirtyMark) this.dirtyMark.hidden = false;
      this.updateTotals();
    }

    updateTotals() {
      const t = calcTotals(this.draft);
      if (!this.totalsEls) return;
      this.totalsEls.subtotal.textContent = money(t.subtotal);
      this.totalsEls.discount.textContent = t.discount ? '-' + money(t.discount) : money(0);
      this.totalsEls.shipping.textContent = money(t.shipping_fee);
      this.totalsEls.total.textContent = money(t.total);
      const dep = num(this.draft.deposit_amount);
      this.totalsEls.depRow.forEach((el) => { el.hidden = !dep; });
      this.totalsEls.deposit.textContent = money(dep);
      this.totalsEls.remain.textContent = money(round2(t.total - dep));
      (this.lineEls || []).forEach((el, i) => {
        const it = this.draft.items[i];
        if (it) el.textContent = money(num(it.qty) * num(it.unit_price));
      });
    }

    totalsBlock() {
      const els = {
        subtotal: h('dd', { 'data-sc': 'subtotal' }),
        discount: h('dd'),
        shipping: h('dd'),
        total: h('dd', { class: 'sc-grand', 'data-sc': 'total' }),
        deposit: h('dd'),
        remain: h('dd'),
      };
      const depDt = h('dt', null, 'มัดจำ');
      const remDt = h('dt', null, 'คงเหลือชำระ');
      els.depRow = [depDt, els.deposit, remDt, els.remain];
      this.totalsEls = els;
      const shipDt = h('dt', null, 'ค่าจัดส่ง');
      if (!this.showShipping()) { shipDt.hidden = true; els.shipping.hidden = true; }
      return h('dl', { class: 'sc-totals' },
        h('dt', null, (CONFIG.profile === 'retail' ? 'ยอด' : 'ราคา') + L().product), els.subtotal,
        h('dt', null, 'ส่วนลด'), els.discount,
        shipDt, els.shipping,
        h('dt', { class: 'sc-grand' }, 'ยอดรวม'), els.total,
        depDt, els.deposit, remDt, els.remain);
    }

    /** Delivery is a shop matter. Other profiles see the fee only if an order already carries one. */
    showShipping() { return CONFIG.profile === 'retail' || num(this.draft.shipping_fee) > 0; }

    renderOrder() {
      const d = this.draft;
      const statusBadge = d.status
        ? h('span', { class: 'sc-order-status sc-os-' + d.status, 'data-sc': 'order-status' }, orderStatusLabel(d.status))
        : h('span', { class: 'sc-order-status', 'data-sc': 'order-status' }, L().order_empty);
      this.dirtyMark = h('span', { class: 'sc-dirty', hidden: !this.orderDirty }, '● ยังไม่บันทึก');
      const head = h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, L().order), this.dirtyMark, statusBadge);
      const body = h('div', { class: 'sc-sec-body' });
      this.summaryBox = h('div', { 'data-sc': 'summary-box', style: 'display:flex;flex-direction:column;gap:8px' });
      this.lineEls = [];

      if (this.orderReadonly) {
        body.append(
          h('div', { class: 'sc-items' }, d.items.map((it) => h('div', { class: 'sc-row-gap' },
            h('span', { style: 'flex:1;min-width:0' }, it.name + ' × ' + nf.format(num(it.qty))),
            h('b', null, money(num(it.qty) * num(it.unit_price)))))),
          this.totalsBlock(),
          h('div', { class: 'sc-row-gap' },
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'summary', onclick: () => this.showSummary() }, L().summary_button),
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-new', onclick: () => { this.draft = this.blankDraft(); this.orderReadonly = false; this.renderOrder(); } }, icon('plus'), 'สร้าง' + L().order + 'ใหม่')),
          this.summaryBox);
        fill(this.secOrder, head, body);
        this.updateTotals();
        this.renderSummary();
        return;
      }

      // product search
      const results = h('div', { class: 'sc-search-results', hidden: true, 'data-sc': 'product-results' });
      const searchInput = h('input', {
        class: 'sc-input', type: 'search', placeholder: L().product_search, 'aria-label': 'ค้นหา' + L().product, autocomplete: 'off', 'data-sc': 'product-search',
      });
      let searchSeq = 0;
      const runSearch = debounce(async () => {
        const q = searchInput.value.trim();
        const seq = ++searchSeq;
        try {
          const r = await this.api.get('/api/products?q=' + encodeURIComponent(q));
          if (seq !== searchSeq) return;
          const products = (r.products || []).filter((p) => p.active !== false).slice(0, 20);
          fill(results, products.length
            ? h('div', null, products.map((p) => h('button', {
              type: 'button', class: 'sc-search-item', 'data-product-id': p.id,
              onclick: () => { this.addProduct(p); searchInput.value = ''; results.hidden = true; },
            }, h('span', null, p.name), h('span', null, money(p.price)))))
            : h('div', { class: 'sc-search-empty' }, q ? 'ไม่พบ "' + q + '" — ใช้ "เพิ่มรายการเอง" ได้' : 'ยังไม่มี' + L().products + 'ในระบบ เพิ่มได้ที่ตั้งค่า'));
          results.hidden = false;
        } catch (err) {
          if (seq !== searchSeq) return;
          fill(results, h('div', { class: 'sc-search-empty' }, err.message));
          results.hidden = false;
        }
      }, 250);
      searchInput.addEventListener('input', runSearch);
      searchInput.addEventListener('focus', runSearch);
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; searchInput.blur(); } });
      const searchWrap = h('div', { class: 'sc-search' }, searchInput, results);
      searchWrap.addEventListener('focusout', () => setTimeout(() => { if (!searchWrap.contains(document.activeElement)) results.hidden = true; }, 120));

      // items
      const items = h('div', { class: 'sc-items', 'data-sc': 'order-items' });
      d.items.forEach((it, i) => {
        const line = h('div', { class: 'sc-item-total' });
        this.lineEls[i] = line;
        const bind = (field, parse) => (e) => { it[field] = parse ? num(e.target.value) : e.target.value; this.markDirty(); };
        items.append(h('div', { class: 'sc-item' },
          h('input', { class: 'sc-input', type: 'text', value: it.name, placeholder: 'ชื่อรายการ', 'aria-label': 'ชื่อรายการ', oninput: bind('name') }),
          iconBtn('trash', 'ลบรายการ', () => { d.items.splice(i, 1); this.markDirty(); this.renderOrder(); }),
          h('div', { class: 'sc-item-line' },
            h('input', { class: 'sc-input sc-num', type: 'number', min: '0', step: '1', inputmode: 'numeric', value: it.qty, 'aria-label': 'จำนวน', 'data-sc': 'item-qty', oninput: bind('qty', true) }),
            h('span', { class: 'sc-times' }, '×'),
            h('input', { class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: it.unit_price, 'aria-label': 'ราคาต่อหน่วย', 'data-sc': 'item-price', oninput: bind('unit_price', true) }),
            line)));
      });
      if (!d.items.length) items.append(h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มีรายการ ค้นหา' + L().product + 'ด้านบน หรือเพิ่มรายการเอง'));

      const field = (label, control) => h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, label), control);
      const numInput = (key, sc) => h('input', {
        class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: d[key] === '' ? '' : d[key], placeholder: '0', 'data-sc': sc,
        oninput: (e) => { d[key] = e.target.value === '' ? (key === 'deposit_amount' ? '' : 0) : num(e.target.value); this.markDirty(); },
      });
      // One way to pay means there is nothing to choose: the selector is left out and that way is saved.
      const methods = CONFIG.payment_methods;
      const paySelect = methods.length > 1
        ? h('select', { class: 'sc-input', 'data-sc': 'order-payment', onchange: (e) => { d.payment_method = e.target.value; this.markDirty(); } },
          h('option', { value: '' }, 'ยังไม่ระบุ'), methods.map((p) => h('option', { value: p.key }, p.label)))
        : null;
      if (paySelect) paySelect.value = d.payment_method || '';

      // Two fields to a row; with an odd count the last one takes the full width.
      const moneyFields = [
        field('ส่วนลด (บาท)', numInput('discount', 'order-discount')),
        this.showShipping() ? field('ค่าจัดส่ง (บาท)', numInput('shipping_fee', 'order-shipping')) : null,
        paySelect ? field('วิธีชำระ', paySelect) : null,
        field('มัดจำ (บาท)', numInput('deposit_amount', 'order-deposit')),
      ].filter(Boolean);
      const moneyRows = [];
      for (let i = 0; i < moneyFields.length; i += 2) {
        moneyRows.push(i + 1 < moneyFields.length ? h('div', { class: 'sc-grid2' }, moneyFields[i], moneyFields[i + 1]) : moneyFields[i]);
      }

      this.saveBtn = h('button', { type: 'button', class: 'sc-btn sc-primary', 'data-sc': 'order-save', onclick: () => this.saveOrder() }, 'บันทึก' + L().order);
      const statusRow = h('div', { class: 'sc-row-gap', 'data-sc': 'order-status-actions' });
      if (d.status !== 'awaiting_payment') {
        statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-await', onclick: () => this.setOrderStatus('awaiting_payment') }, 'ตั้งเป็น' + stageLabel('awaiting_payment')));
      }
      statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-paid', onclick: () => this.setOrderStatus('paid') }, 'ยืนยัน' + stageLabel('paid')));
      if (d.id) statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small sc-danger', 'data-sc': 'order-cancel', onclick: () => this.setOrderStatus('cancelled') }, 'ยกเลิก'));

      body.append(
        searchWrap,
        items,
        h('div', null, h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', 'data-sc': 'item-add', onclick: () => { d.items.push({ product_id: null, name: '', qty: 1, unit_price: 0 }); this.markDirty(); this.renderOrder(); const ins = this.secOrder.querySelectorAll('.sc-item input[type=text]'); if (ins.length) ins[ins.length - 1].focus(); } }, icon('plus'), 'เพิ่มรายการเอง')),
        ...moneyRows,
        field('หมายเหตุ' + L().order, h('input', { class: 'sc-input', type: 'text', value: d.note, placeholder: CONFIG.profile === 'retail' ? 'เช่น สี / ความจุ / นัดรับ' : 'เช่น เงื่อนไข / วันนัด', oninput: (e) => { d.note = e.target.value; this.markDirty(); } })),
        this.totalsBlock(),
        h('div', { class: 'sc-row-gap' }, this.saveBtn, h('button', { type: 'button', class: 'sc-btn', 'data-sc': 'summary', onclick: () => this.showSummary() }, L().summary_button)),
        statusRow,
        this.summaryBox);
      fill(this.secOrder, head, body);
      this.updateTotals();
      this.renderSummary();
    }

    addProduct(p) {
      const existing = this.draft.items.find((it) => it.product_id === p.id);
      if (existing) existing.qty = num(existing.qty) + 1;
      else this.draft.items.push({ product_id: p.id, name: p.name, qty: 1, unit_price: num(p.price) });
      this.markDirty();
      this.renderOrder();
    }

    orderBody() {
      const d = this.draft;
      const items = d.items
        .map((it) => ({ product_id: it.product_id == null ? undefined : it.product_id, name: String(it.name || '').trim(), qty: num(it.qty), unit_price: num(it.unit_price) }))
        .filter((it) => it.name);
      return {
        items,
        discount: num(d.discount),
        shipping_fee: num(d.shipping_fee),
        payment_method: CONFIG.payment_methods.length === 1 ? CONFIG.payment_methods[0].key : (d.payment_method || null),
        deposit_amount: d.deposit_amount === '' || d.deposit_amount == null ? null : num(d.deposit_amount),
        note: String(d.note || '').trim() || null,
      };
    }

    /** Saves the draft. Returns true when the server holds exactly what is on screen. */
    async saveOrder(silent) {
      const body = this.orderBody();
      if (!body.items.length) { this.app.toast('เพิ่มรายการ' + L().product + 'อย่างน้อย 1 รายการก่อนบันทึก', 'err'); return false; }
      if (body.items.some((it) => it.qty <= 0)) { this.app.toast('จำนวนต้องมากกว่า 0', 'err'); return false; }
      if (this.saveBtn) { this.saveBtn.disabled = true; this.saveBtn.textContent = 'กำลังบันทึก…'; }
      this.busy = true;
      try {
        const r = await this.api.put('/api/leads/' + this.lead.id + '/order', body);
        this.b.order = r.order;
        this.initDraft();
        this.renderOrder();
        if (!silent) this.app.toast('บันทึก' + L().order + 'แล้ว ยอดรวม ' + money(r.order.total), 'ok');
        this.reload(true); // slip match and draft stage can change with the order
        return true;
      } catch (err) {
        this.app.toast('บันทึก' + L().order + 'ไม่สำเร็จ: ' + err.message, 'err');
        if (this.saveBtn) { this.saveBtn.disabled = false; this.saveBtn.textContent = 'บันทึก' + L().order; }
        return false;
      } finally {
        this.busy = false;
      }
    }

    async ensureSaved() {
      if (this.draft.id && !this.orderDirty) return true;
      return this.saveOrder(true);
    }

    async setOrderStatus(status) {
      if (!this.orderReadonly && !(await this.ensureSaved())) return;
      const o = this.b.order;
      if (!o) return;
      if (status === 'paid') {
        const ok = await this.app.confirm({
          title: 'ยืนยันว่าได้รับเงินแล้ว?',
          body: 'ยอด' + L().order + ' ' + money(o.total) + (o.deposit_amount ? ' (มัดจำ ' + money(o.deposit_amount) + ')' : '') + '\nตรวจยอดเข้าบัญชีจริงก่อนกดยืนยัน — สลิปที่ Agent อ่านได้ไม่ใช่หลักฐานว่าเงินเข้า',
          confirmLabel: 'ยืนยัน' + stageLabel('paid'),
        });
        if (!ok) return;
      }
      if (status === 'cancelled') {
        const ok = await this.app.confirm({ title: 'ยกเลิก' + L().order + 'นี้?', body: L().order + ' ' + money(o.total) + ' จะถูกปิดเป็นยกเลิก', confirmLabel: 'ยกเลิก' + L().order, danger: true });
        if (!ok) return;
      }
      try {
        const r = await this.api.post('/api/orders/' + o.id + '/status', { status });
        this.b.order = r.order;
        if (r.lead) this.b.lead = r.lead;
        this.initDraft();
        this.renderOrder();
        this.renderHead();
        this.app.toast(L().order + ': ' + orderStatusLabel(status), 'ok');
        this.app.notifyChanged();
        this.reload(true);
      } catch (err) {
        this.app.toast('เปลี่ยนสถานะ' + L().order + 'ไม่สำเร็จ: ' + err.message, 'err');
      }
    }

    async showSummary() {
      if (!this.orderReadonly && !(await this.ensureSaved())) return;
      if (!this.b.order) return;
      try {
        const r = await this.api.get('/api/leads/' + this.lead.id + '/summary');
        this.summaryText = r.text || '';
        this.renderSummary();
        if (this.summaryBox.scrollIntoView) this.summaryBox.scrollIntoView({ block: 'nearest' });
      } catch (err) {
        this.app.toast('ร่างข้อความสรุปไม่สำเร็จ: ' + err.message, 'err');
      }
    }

    renderSummary() {
      if (!this.summaryBox) return;
      if (this.summaryText == null) { this.summaryBox.replaceChildren(); return; }
      fill(this.summaryBox, 
        h('div', { class: 'sc-label' }, 'ข้อความสรุป (สร้างจาก' + L().order + 'ที่บันทึก ยอดตรงเสมอ)'),
        h('blockquote', { class: 'sc-quote sc-plain', 'data-sc': 'summary-text' }, this.summaryText),
        this.textActions(() => this.summaryText, 'summary'));
    }

    // ---- notes
    buildNotesShell() {
      this.notesList = h('div', { class: 'sc-notes', 'data-sc': 'notes-list' });
      this.noteInput = h('textarea', {
        class: 'sc-input', rows: '2', placeholder: 'จดโน้ตถึงทีม… (Ctrl/⌘ + Enter เพื่อบันทึก)', 'aria-label': 'โน้ตใหม่', 'data-sc': 'note-input',
        onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.addNote(); } },
      });
      this.notePin = h('input', { type: 'checkbox' });
      this.noteBtn = h('button', { type: 'button', class: 'sc-btn sc-small sc-primary', 'data-sc': 'note-add', onclick: () => this.addNote() }, 'บันทึกโน้ต');
      this.notesCount = h('span', { class: 'sc-muted sc-small' });
      fill(this.secNotes, 
        h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'โน้ต'), this.notesCount),
        h('div', { class: 'sc-sec-body' },
          this.noteInput,
          h('div', { class: 'sc-row-gap' }, h('label', { class: 'sc-check' }, this.notePin, 'ปักหมุด'), h('span', { class: 'sc-spacer' }), this.noteBtn),
          this.notesList));
    }

    renderNotes() {
      const notes = (this.b.notes || []).slice().sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
      this.notesCount.textContent = notes.length ? notes.length + ' รายการ' : '';
      const me = this.app.me;
      fill(this.notesList, notes.length
        ? h('div', { class: 'sc-notes' }, notes.map((n) => h('div', { class: 'sc-note' + (n.pinned ? ' sc-pinned' : ''), 'data-note-id': n.id },
          h('div', { class: 'sc-note-head' },
            h('span', { class: 'sc-kind sc-kind-' + n.kind }, NOTE_KIND[n.kind] || n.kind),
            n.pinned ? icon('pin') : null,
            h('span', null, [n.author_name, relTime(n.created_at)].filter(Boolean).join(' · ')),
            n.kind === 'staff' && me && n.author_name === me.name
              ? iconBtn('trash', 'ลบโน้ต', () => this.deleteNote(n), 'sc-note-del')
              : null),
          h('div', { class: 'sc-note-body' }, n.body))))
        : h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มีโน้ต — Agent จะสรุปให้เมื่อลูกค้าคุยเพิ่ม'));
    }

    async addNote() {
      const body = this.noteInput.value.trim();
      if (!body) { this.noteInput.focus(); return; }
      this.noteBtn.disabled = true;
      try {
        const r = await this.api.post('/api/leads/' + this.lead.id + '/notes', { body, pinned: this.notePin.checked });
        this.b.notes = [r.note].concat(this.b.notes || []);
        this.noteInput.value = '';
        this.notePin.checked = false;
        this.renderNotes();
      } catch (err) {
        this.app.toast('บันทึกโน้ตไม่สำเร็จ: ' + err.message, 'err');
      } finally {
        this.noteBtn.disabled = false;
      }
    }

    async deleteNote(n) {
      const ok = await this.app.confirm({ title: 'ลบโน้ตนี้?', body: n.body.length > 120 ? n.body.slice(0, 120) + '…' : n.body, confirmLabel: 'ลบ', danger: true });
      if (!ok) return;
      try {
        await this.api.del('/api/notes/' + n.id);
        this.b.notes = (this.b.notes || []).filter((x) => x.id !== n.id);
        this.renderNotes();
      } catch (err) {
        this.app.toast('ลบโน้ตไม่สำเร็จ: ' + err.message, 'err');
      }
    }

    // ---- album
    filteredMedia() {
      const media = this.b.media || [];
      return this.albumFilter === 'all' ? media : media.filter((m) => m.category === this.albumFilter);
    }

    renderAlbum() {
      const media = this.b.media || [];
      const counts = {};
      for (const m of media) counts[m.category] = (counts[m.category] || 0) + 1;
      if (this.albumFilter !== 'all' && !counts[this.albumFilter]) this.albumFilter = 'all';
      const chip = (id, label, n) => h('button', {
        type: 'button', class: 'sc-chip' + (this.albumFilter === id ? ' sc-on' : ''), 'data-cat': id,
        'aria-pressed': this.albumFilter === id ? 'true' : 'false',
        onclick: () => { this.albumFilter = id; this.renderAlbum(); },
      }, label, h('span', { class: 'sc-count' }, n));
      const filters = h('div', { class: 'sc-chips', 'data-sc': 'album-filters' },
        chip('all', 'ทั้งหมด', media.length),
        CONFIG.media_categories.filter((c) => counts[c.key]).map((c) => chip(c.key, c.label, counts[c.key])));
      const list = this.filteredMedia();
      const grid = h('div', { class: 'sc-grid', 'data-sc': 'album-grid' }, list.map((m, i) => {
        const btn = h('button', { type: 'button', class: 'sc-thumb', 'data-media-id': m.id, 'aria-label': 'เปิดรูป ' + mediaLabel(m.category), onclick: () => this.openLightbox(i) });
        const src = safeUrl(m.url);
        if (src) { const img = h('img', { alt: m.caption || mediaLabel(m.category), loading: 'lazy' }); img.src = src; btn.append(img); }
        btn.append(h('span', { class: 'sc-thumb-tag' }, m.category === 'slip' && m.slip && m.slip.amount != null ? money(m.slip.amount) : mediaLabel(m.category)));
        if (m.category === 'slip' && m.slip && m.slip.matches_order != null) {
          btn.append(h('span', { class: 'sc-thumb-flag ' + (m.slip.matches_order ? 'sc-ok' : 'sc-bad'), title: m.slip.matches_order ? 'ยอดตรงกับ' + L().order : 'ยอดไม่ตรงกับ' + L().order }, m.slip.matches_order ? '✓' : '!'));
        }
        return btn;
      }));
      fill(this.secAlbum, 
        h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'อัลบั้ม')),
        h('div', { class: 'sc-sec-body' }, media.length
          ? [filters, grid]
          : h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มีรูป — รูปที่ลูกค้าส่งมาจะถูกแยกหมวดให้อัตโนมัติ')));
      if (this.lightbox) this.lightbox.refresh();
    }

    openLightbox(index) {
      let idx = index;
      const app = this.app;
      const stage = h('div', { class: 'sc-lb-stage' });
      const info = h('div', { class: 'sc-lb-info' });
      const count = h('span', { class: 'sc-lb-count' });
      const box = h('div', { class: 'sc-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ดูรูป', tabindex: '-1', 'data-sc': 'lightbox' });
      const close = () => {
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        this.lightbox = null;
      };
      const move = (d) => { const n = this.filteredMedia().length; if (n) { idx = (idx + d + n) % n; draw(); } };
      const onKey = (e) => {
        if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'ArrowLeft') move(-1);
        if (e.key === 'ArrowRight') move(1);
      };
      const draw = () => {
        const list = this.filteredMedia();
        if (!list.length) { close(); return; }
        if (idx >= list.length) idx = list.length - 1;
        const m = list[idx];
        count.textContent = (idx + 1) + ' / ' + list.length + ' · ' + fmtDateTime(m.created_at);
        const src = safeUrl(m.url);
        const img = h('img', { alt: m.caption || mediaLabel(m.category) || 'รูปจากลูกค้า' });
        if (src) img.src = src;
        fill(stage, img);

        const catSelect = h('select', { class: 'sc-input', 'data-sc': 'media-category', 'aria-label': 'หมวดรูป', onchange: (e) => this.patchMedia(m, { category: e.target.value }) },
          CONFIG.media_categories.map((c) => h('option', { value: c.key }, c.label)));
        catSelect.value = m.category;
        const caption = h('input', {
          class: 'sc-input', type: 'text', value: m.caption || '', placeholder: 'คำอธิบายรูป', 'aria-label': 'คำอธิบายรูป',
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
          onblur: (e) => { const v = e.target.value.trim(); if (v !== (m.caption || '')) this.patchMedia(m, { caption: v || null }); },
        });
        const parts = [h('div', { class: 'sc-grid2' },
          h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'หมวด'), catSelect),
          h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'คำอธิบาย'), caption))];
        if (m.category === 'slip') {
          const s = m.slip || {};
          const match = s.matches_order === true
            ? h('dd', { class: 'sc-slip-match sc-ok', 'data-sc': 'slip-match' }, '✓ ยอดตรงกับ' + L().order)
            : s.matches_order === false
              ? h('dd', { class: 'sc-slip-match sc-bad', 'data-sc': 'slip-match' }, '⚠ ยอดไม่ตรงกับ' + L().order)
              : h('dd', { class: 'sc-slip-match sc-none', 'data-sc': 'slip-match' }, L().order_empty + ' ให้เทียบ');
          parts.push(
            h('dl', { class: 'sc-slip', 'data-sc': 'slip-details' },
              h('dt', null, 'ยอดในสลิป'), h('dd', null, s.amount != null ? money(s.amount) : 'อ่านไม่ได้'),
              h('dt', null, 'ธนาคาร'), h('dd', null, s.bank || '—'),
              h('dt', null, 'เวลาโอน'), h('dd', null, s.paid_at ? fmtDateTime(s.paid_at) : '—'),
              h('dt', null, 'เลขอ้างอิง'), h('dd', null, s.ref || '—'),
              h('dt', null, 'เทียบ' + L().order), match),
            h('div', { class: 'sc-slip-warn' }, 'อ่านสลิปได้ ไม่ได้ยืนยันว่าเงินเข้า — ตรวจยอดในบัญชีก่อนยืนยันชำระ'));
        }
        fill(info, ...parts);
      };
      const openTab = () => {
        const m = this.filteredMedia()[idx];
        const src = m && safeUrl(m.url);
        if (src && /^https?:/i.test(src)) global.open(src, '_blank', 'noopener');
        else app.toast('รูปนี้เปิดในแท็บใหม่ไม่ได้');
      };
      box.append(
        h('div', { class: 'sc-lb-bar' },
          count,
          iconBtn('back', 'รูปก่อนหน้า', () => move(-1)),
          iconBtn('chev', 'รูปถัดไป', () => move(1)),
          iconBtn('external', 'เปิดในแท็บใหม่', openTab),
          iconBtn('close', 'ปิด', close, 'sc-lb-close')),
        stage, info);
      box.addEventListener('click', (e) => { if (e.target === stage) close(); });
      document.addEventListener('keydown', onKey, true);
      this.lightbox = { refresh: draw, close, el: box };
      app.root.append(box);
      draw();
      box.focus();
    }

    async patchMedia(m, body) {
      try {
        const r = await this.api.patch('/api/media/' + m.id, body);
        const list = this.b.media || [];
        const i = list.findIndex((x) => x.id === m.id);
        if (i >= 0) list[i] = r.media;
        this.renderAlbum();
        this.app.toast('บันทึกแล้ว', 'ok');
      } catch (err) {
        this.app.toast('บันทึกรูปไม่สำเร็จ: ' + err.message, 'err');
        if (this.lightbox) this.lightbox.refresh();
      }
    }

    // ---- follow-up
    renderFollow() {
      const l = this.lead;
      const due = isPast(l.follow_up_at);
      const status = l.follow_up_at
        ? h('div', { class: 'sc-notice' + (due ? ' sc-danger' : ''), 'data-sc': 'followup-status' },
          due ? h('b', null, 'เลยกำหนดแล้ว ') : 'ตามอีกครั้ง ', fmtDateTime(l.follow_up_at))
        : h('div', { class: 'sc-muted sc-small', 'data-sc': 'followup-status' }, 'ยังไม่ได้ตั้งเวลาตามลูกค้า');
      const custom = h('input', {
        class: 'sc-input', type: 'datetime-local', 'aria-label': 'กำหนดเวลาเอง', style: 'max-width:210px',
        onchange: (e) => { const d = toDate(e.target.value); if (d) this.setFollow(d); },
      });
      const in3h = () => new Date(Date.now() + 3 * 3600 * 1000);
      const tomorrow10 = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; };
      fill(this.secFollow, 
        h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'ตามลูกค้า')),
        h('div', { class: 'sc-sec-body' },
          status,
          h('div', { class: 'sc-row-gap' },
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'follow-3h', onclick: () => this.setFollow(in3h()) }, '+3 ชม.'),
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'follow-tomorrow', onclick: () => this.setFollow(tomorrow10()) }, 'พรุ่งนี้ 10:00'),
            l.follow_up_at ? h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', 'data-sc': 'follow-clear', onclick: () => this.setFollow(null) }, 'ล้าง') : null),
          custom));
    }

    async setFollow(date) {
      try {
        await this.patchLead({ follow_up_at: date ? date.toISOString() : null }, date ? 'ตั้งเวลาตาม ' + fmtDateTime(date.toISOString()) : 'ล้างเวลาตามแล้ว');
        this.renderFollow();
        this.app.notifyChanged();
      } catch (err) {
        this.app.toast('ตั้งเวลาไม่สำเร็จ: ' + err.message, 'err');
      }
    }
  }

  // ================================================================== views
  /** Panel home: the lead that belongs to the chat open in LINE OA Manager. */
  class ChatView {
    constructor(app) {
      this.app = app;
      this.chat = null;
      this.leadView = null;
      this.seq = 0;
      this.el = h('div', { 'data-sc': 'chat-view' });
      this.renderIdle();
    }
    onShow() { if (this.leadView) this.leadView.start(); }
    onHide() { if (this.leadView) this.leadView.stop(); }
    destroy() { this.onHide(); }
    refresh() { return this.load(); }

    renderIdle() {
      fill(this.el, h('div', { class: 'sc-view' }, emptyState('เลือกแชทลูกค้า', 'เปิดแชทใน LINE OA ทางซ้าย แล้ว ' + BRAND.name + ' จะแสดงการ์ดลูกค้า โน้ต อัลบั้ม และ' + L().order + 'ของแชทนั้น')));
    }

    setChat(chat) {
      const same = this.chat && chat && this.chat.chatId === chat.chatId;
      if (same && (this.leadView || !chat.name || chat.name === this.chat.name)) { this.chat = chat; return; }
      this.chat = chat;
      this.load();
    }

    async load() {
      const chat = this.chat;
      const seq = ++this.seq;
      if (this.leadView) { this.leadView.stop(); this.leadView = null; }
      if (!chat || !chat.chatId) { this.renderIdle(); return; }
      fill(this.el, skeleton());
      try {
        const q = chat.name ? '?name=' + encodeURIComponent(chat.name) : '';
        const b = await this.app.api.get('/api/leads/by-chat/' + encodeURIComponent(chat.chatId) + q);
        if (seq !== this.seq) return;
        if (b.lead) {
          this.leadView = new LeadView(this.app, b, {});
          fill(this.el, this.leadView.el);
          if (this.app.top() === this) this.leadView.start();
        } else {
          this.renderUnknown(b);
        }
      } catch (err) {
        if (seq !== this.seq) return;
        if (err.status === 401) return;
        fill(this.el, h('div', { class: 'sc-view' }, errorState(err, () => this.load())));
      }
    }

    renderUnknown(b) {
      const chat = this.chat;
      const list = h('div', { class: 'sc-list', 'data-sc': 'candidates' });
      const showCandidates = (leads, emptyText) => {
        fill(list, leads.length
          ? h('div', null, leads.map((c) => h('div', { class: 'sc-row', style: 'cursor:default', 'data-lead-id': c.id },
            avatar(c, true),
            h('div', { class: 'sc-row-main' },
              h('div', { class: 'sc-row-top' }, h('span', { class: 'sc-row-name' }, leadName(c)), stageTag(c.stage)),
              h('div', { class: 'sc-row-bottom' }, h('span', { class: 'sc-row-preview' }, [c.full_name, c.phone, c.last_message_at ? 'ล่าสุด ' + relTime(c.last_message_at) : ''].filter(Boolean).join(' · ')))),
            h('button', { type: 'button', class: 'sc-btn sc-small sc-primary', 'data-sc': 'link-chat', onclick: (e) => this.link(c, e.currentTarget) }, 'ผูกกับแชทนี้'))))
          : h('div', { class: 'sc-muted sc-small', style: 'padding:10px 12px' }, emptyText));
      };
      const candidates = b.candidates || [];
      showCandidates(candidates, 'ไม่พบลูกค้าที่ชื่อตรงกับแชทนี้');

      let seq = 0;
      const search = h('input', { class: 'sc-input', type: 'search', placeholder: 'ค้นหาชื่อหรือเบอร์เพื่อผูกเอง…', 'aria-label': 'ค้นหาลูกค้าเพื่อผูก', 'data-sc': 'link-search' });
      search.addEventListener('input', debounce(async () => {
        const q = search.value.trim();
        const s = ++seq;
        if (!q) { showCandidates(candidates, 'ไม่พบลูกค้าที่ชื่อตรงกับแชทนี้'); return; }
        try {
          const r = await this.app.api.get('/api/leads?limit=8&q=' + encodeURIComponent(q));
          if (s === seq) showCandidates(r.leads || [], 'ไม่พบ "' + q + '"');
        } catch (err) { if (s === seq) showCandidates([], err.message); }
      }, 300));

      fill(this.el, h('div', { class: 'sc-view', 'data-sc': 'unknown-chat' },
        h('section', { class: 'sc-card' },
          h('div', { class: 'sc-sec-body' },
            h('b', null, 'ยังไม่มีการ์ดของแชทนี้' + (chat.name ? ' (' + chat.name + ')' : '')),
            h('div', { class: 'sc-muted' }, 'ลูกค้าคนนี้ยังไม่ได้ส่งข้อความเข้ามาตั้งแต่เชื่อม ' + BRAND.name + ' กับ LINE OA — เมื่อลูกค้าทักมาครั้งถัดไป ระบบจะสร้างการ์ดให้อัตโนมัติ'),
            h('div', { class: 'sc-muted' }, 'ถ้าลูกค้าเคยทักมาแล้วแต่การ์ดไม่ขึ้น ให้ผูกแชทนี้กับการ์ดที่มีอยู่:'),
            search)),
        h('section', { class: 'sc-card', style: 'overflow:hidden' }, list),
        h('div', null, h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', onclick: () => this.load() }, icon('refresh'), 'ตรวจอีกครั้ง'))));
    }

    async link(candidate, btn) {
      btn.disabled = true;
      try {
        await this.app.api.post('/api/leads/' + candidate.id + '/link-chat', { chat_id: this.chat.chatId });
        this.app.toast('ผูกแชทกับ ' + leadName(candidate) + ' แล้ว', 'ok');
        await this.load();
      } catch (err) {
        btn.disabled = false;
        this.app.toast('ผูกแชทไม่สำเร็จ: ' + err.message, 'err');
      }
    }
  }

  /** One lead opened by id, with a back bar. */
  class LeadPage {
    constructor(app, id) {
      this.app = app;
      this.id = id;
      this.leadView = null;
      this.body = h('div');
      this.title = h('span', { class: 'sc-sub', style: 'flex:1' });
      this.el = h('div', { 'data-sc': 'lead-page' },
        h('div', { class: 'sc-backbar' },
          h('button', { type: 'button', class: 'sc-btn sc-ghost', 'data-sc': 'back', onclick: () => app.back() }, icon('back'), 'กลับ'),
          this.title,
          iconBtn('refresh', 'รีเฟรช', () => this.load())),
        this.body);
      this.load();
    }
    onShow() { if (this.leadView) this.leadView.start(); }
    onHide() { if (this.leadView) this.leadView.stop(); }
    destroy() { this.onHide(); if (this.leadView && this.leadView.lightbox) this.leadView.lightbox.close(); }
    refresh() { return this.load(); }

    async load() {
      if (this.leadView) { this.leadView.stop(); this.leadView = null; }
      fill(this.body, skeleton());
      try {
        const b = await this.app.api.get('/api/leads/' + this.id);
        if (!b.lead) throw new ApiError(404, 'not_found', STATUS_TEXT[404]);
        this.leadView = new LeadView(this.app, b, {});
        fill(this.body, this.leadView.el);
        if (this.app.top() === this) this.leadView.start();
      } catch (err) {
        if (err.status === 401) return;
        fill(this.body, h('div', { class: 'sc-view' }, errorState(err, () => this.load())));
      }
    }
  }

  class InboxView {
    constructor(app, opts) {
      this.app = app;
      this.tab = (opts && opts.tab) || 'all';
      this.q = '';
      this.leads = [];
      this.counts = {};
      this.dueCount = 0;
      this.hasMore = false;
      this.seq = 0;
      this.timer = null;
      this.showBack = !!(opts && opts.back);

      this.tabsEl = h('div', { class: 'sc-tabs', role: 'tablist', 'data-sc': 'inbox-tabs' });
      this.listEl = h('div', { 'data-sc': 'inbox-list' });
      this.search = h('input', { class: 'sc-input', type: 'search', placeholder: 'ค้นหาชื่อ / เบอร์โทร', 'aria-label': 'ค้นหาลูกค้า', 'data-sc': 'inbox-search' });
      this.search.addEventListener('input', debounce(() => { this.q = this.search.value.trim(); this.load(); }, 300));
      const tools = h('div', { class: 'sc-inbox-tools' },
        h('div', { class: 'sc-row-gap', style: 'flex-wrap:nowrap' },
          this.showBack ? h('button', { type: 'button', class: 'sc-btn sc-ghost', 'data-sc': 'back', onclick: () => app.back() }, icon('back'), 'กลับ') : null,
          h('div', { class: 'sc-searchbox', style: 'flex:1' }, icon('search'), this.search),
          iconBtn('refresh', 'รีเฟรช', () => this.load(), 'sc-inbox-refresh')),
        this.tabsEl);
      this.el = h('div', { 'data-sc': 'inbox' }, tools, this.listEl);
      this.renderTabs();
      this.load();
    }
    onShow() {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        if (document.visibilityState === 'visible' && this.app.top() === this && !this.app.overlayOpen()) this.load({ quiet: true });
      }, INBOX_POLL_MS);
      if (this.loadedOnce) this.load({ quiet: true });
    }
    onHide() { clearInterval(this.timer); this.timer = null; }
    destroy() { this.onHide(); }
    refresh() { return this.load(); }

    renderTabs() {
      const total = Object.values(this.counts).reduce((s, n) => s + (Number(n) || 0), 0);
      const tab = (id, label, n, cls) => h('button', {
        type: 'button', role: 'tab', class: 'sc-chip ' + (cls || '') + (this.tab === id ? ' sc-on' : ''),
        'aria-selected': this.tab === id ? 'true' : 'false', 'data-tab': id,
        onclick: () => { if (this.tab !== id) { this.tab = id; this.renderTabs(); this.load(); } },
      }, label, n != null ? (id === 'due' && n > 0 ? h('span', { class: 'sc-badge' }, n) : h('span', { class: 'sc-count' }, n)) : null);
      fill(this.tabsEl, 
        tab('all', 'ทั้งหมด', this.loadedOnce ? total : null),
        tab('due', 'ต้องตาม', this.loadedOnce ? this.dueCount : null, 'sc-due'),
        CONFIG.stages.map((s) => tab(s.key, s.label, this.loadedOnce ? (this.counts[s.key] || 0) : null, 'sc-st-' + s.key)));
    }

    /** What the customer is after, when the profile records it: "หาเช่า · Kave Town Colony". */
    rowMeta(l) {
      const bits = [detailText(l, 'intent'), detailText(l, 'location')].filter(Boolean);
      return bits.length ? h('div', { class: 'sc-row-meta', 'data-sc': 'row-meta' }, bits.join(' · ')) : null;
    }

    query(offset) {
      const p = new URLSearchParams({ limit: '50', offset: String(offset) });
      if (this.q) p.set('q', this.q);
      if (this.tab === 'due') p.set('due', '1');
      else if (this.tab !== 'all') p.set('stage', this.tab);
      return '/api/leads?' + p.toString();
    }

    async load(opts) {
      opts = opts || {};
      const seq = ++this.seq;
      const offset = opts.more ? this.leads.length : 0;
      if (!opts.quiet && !opts.more) {
        fill(this.listEl, h('div', { class: 'sc-list', 'aria-busy': 'true', 'data-sc': 'loading' },
          [0, 1, 2, 3, 4].map(() => h('div', { class: 'sc-row', style: 'cursor:default' },
            h('div', { class: 'sc-skel', style: 'width:36px;height:36px;border-radius:50%;flex:none' }),
            h('div', { class: 'sc-row-main', style: 'display:flex;flex-direction:column;gap:6px' },
              h('div', { class: 'sc-skel sc-skel-line', style: 'width:45%' }),
              h('div', { class: 'sc-skel sc-skel-line', style: 'width:75%' }))))));
      }
      try {
        // A quiet refresh re-reads everything already on screen so "load more" pages do not vanish.
        const path = opts.quiet && this.leads.length > 50
          ? this.query(0).replace('limit=50', 'limit=' + Math.min(200, this.leads.length))
          : this.query(offset);
        const r = await this.app.api.get(path);
        if (seq !== this.seq) return;
        const page = r.leads || [];
        this.leads = opts.more ? this.leads.concat(page) : page;
        this.hasMore = page.length >= 50;
        this.counts = r.counts || {};
        this.dueCount = Number(r.due_count) || 0;
        this.loadedOnce = true;
        this.app.setDueCount(this.dueCount);
        this.renderTabs();
        this.renderList();
      } catch (err) {
        if (seq !== this.seq || err.status === 401) return;
        if (opts.quiet) return;
        fill(this.listEl, errorState(err, () => this.load()));
      }
    }

    renderList() {
      if (!this.leads.length) {
        const text = this.q ? 'ไม่พบลูกค้าที่ตรงกับ "' + this.q + '"'
          : this.tab === 'due' ? 'ไม่มีลูกค้าที่ถึงเวลาต้องตาม'
            : this.tab === 'all' ? 'ยังไม่มีลูกค้า — การ์ดจะถูกสร้างเมื่อมีคนทัก LINE OA เข้ามา'
              : 'ไม่มีลูกค้าในสถานะ "' + stageLabel(this.tab) + '"';
        fill(this.listEl, emptyState('ว่าง', text));
        return;
      }
      const rows = this.leads.map((l) => h('button', { type: 'button', class: 'sc-row', 'data-lead-id': l.id, onclick: () => this.app.openLead(l.id) },
        avatar(l, true),
        h('div', { class: 'sc-row-main' },
          h('div', { class: 'sc-row-top' },
            h('span', { class: 'sc-row-name' }, leadName(l)),
            h('span', { class: 'sc-row-time' }, relTime(l.last_message_at))),
          this.rowMeta(l),
          h('div', { class: 'sc-row-bottom' },
            h('span', { class: 'sc-row-preview' }, l.last_message_preview || l.ai_summary || l.phone || '—'),
            isPast(l.follow_up_at) ? h('span', { class: 'sc-due-dot', title: 'ถึงเวลาตาม' }, icon('clock'), 'ตาม') : null,
            stageTag(l.stage)))));
      fill(this.listEl, h('div', { class: 'sc-list' }, rows),
        this.hasMore ? h('div', { style: 'padding:10px' }, h('button', { type: 'button', class: 'sc-btn sc-block', onclick: () => this.load({ more: true }) }, 'โหลดเพิ่ม')) : null);
    }
  }

  class ConfigView {
    constructor(app, message) {
      this.app = app;
      const cfg = app.api.getConfig();
      const host = app.host;
      const editableUrl = !host.config || host.config.apiUrlEditable !== false;
      this.urlInput = h('input', { class: 'sc-input', type: 'url', value: cfg.baseUrl, placeholder: 'https://xxxx.supabase.co/functions/v1/sidecar', autocomplete: 'off', spellcheck: 'false', 'data-sc': 'cfg-url' });
      this.tokenInput = h('input', { class: 'sc-input', type: 'password', value: cfg.token, placeholder: 'staff token', autocomplete: 'off', spellcheck: 'false', 'data-sc': 'cfg-token' });
      this.msg = h('div', { class: 'sc-notice sc-warn', hidden: !message, 'data-sc': 'cfg-msg' }, message || '');
      this.btn = h('button', { type: 'submit', class: 'sc-btn sc-primary sc-cta sc-block', 'data-sc': 'cfg-save' }, 'บันทึกและเชื่อมต่อ');
      const logo = brandLogo('landscape', 'auto', 'sc-brand-logo');
      const form = h('form', { class: 'sc-sec-body', onsubmit: (e) => { e.preventDefault(); this.save(); } },
        logo ? h('div', { class: 'sc-brand-head', 'data-sc': 'brand-head' }, logo, BRAND.tagline ? h('div', { class: 'sc-brand-tagline' }, BRAND.tagline) : null) : null,
        h('div', null, h('b', { style: 'font-size:15px' }, 'เชื่อมต่อ ' + BRAND.name), h('div', { class: 'sc-muted' }, 'ใส่ token ประจำตัวพนักงานที่แอดมินออกให้ (ใส่ครั้งเดียว)')),
        this.msg,
        editableUrl ? h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'API URL'), this.urlInput) : null,
        h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'Staff token'), this.tokenInput),
        this.btn,
        host.relogin ? h('button', { type: 'button', class: 'sc-btn sc-block', onclick: () => host.relogin() }, 'เข้าสู่ระบบด้วย LINE อีกครั้ง') : null,
        host.openOptions ? h('button', { type: 'button', class: 'sc-btn sc-ghost sc-block', onclick: () => host.openOptions() }, 'เปิดหน้าตั้งค่าส่วนขยาย') : null);
      this.el = h('div', { class: 'sc-view', 'data-sc': 'config' }, h('section', { class: 'sc-card' }, form));
    }
    async save() {
      const cfg = { baseUrl: this.urlInput.value.trim().replace(/\/+$/, ''), token: this.tokenInput.value.trim() };
      if (!cfg.baseUrl || !/^https?:\/\//i.test(cfg.baseUrl)) { this.show('API URL ต้องขึ้นต้นด้วย https://'); return; }
      if (!cfg.token && !this.app.api.getConfig().idToken) { this.show('กรุณาใส่ staff token'); return; }
      this.btn.disabled = true;
      this.btn.textContent = 'กำลังเชื่อมต่อ…';
      this.app.api.setConfig(cfg);
      try {
        const r = await this.app.api.get('/api/me', { silentAuth: true });
        if (this.app.host.saveConfig) await this.app.host.saveConfig({ apiUrl: cfg.baseUrl, token: cfg.token });
        this.app.me = r.staff;
        await this.app.loadConfig();
        this.app.afterBoot();
      } catch (err) {
        this.show(err.message);
        this.btn.disabled = false;
        this.btn.textContent = 'บันทึกและเชื่อมต่อ';
      }
    }
    show(text) { this.msg.hidden = false; this.msg.textContent = text; }
  }

  class SettingsView {
    constructor(app) {
      this.app = app;
      this.body = h('div', { class: 'sc-view' }, skeleton());
      this.el = h('div', { 'data-sc': 'settings' },
        h('div', { class: 'sc-backbar' },
          h('button', { type: 'button', class: 'sc-btn sc-ghost', 'data-sc': 'back', onclick: () => app.back() }, icon('back'), 'กลับ'),
          h('span', { class: 'sc-sub', style: 'flex:1' }, 'ตั้งค่า')),
        this.body);
      this.load();
    }
    async load() {
      const app = this.app;
      try {
        const [s, p] = await Promise.all([app.api.get('/api/settings'), app.api.get('/api/products?all=1&q=')]);
        this.render(s.settings || {}, p.products || []);
      } catch (err) {
        if (err.status === 401) return;
        fill(this.body, errorState(err, () => this.load()));
      }
    }
    render(settings, products) {
      const app = this.app;
      const me = app.me || {};
      const isAdmin = me.role === 'admin';

      const account = section('บัญชี', null,
        h('div', null, h('b', null, me.name || '—'), ' · ', me.role === 'admin' ? 'แอดมิน' : 'พนักงาน'),
        h('div', { class: 'sc-row-gap' },
          h('button', { type: 'button', class: 'sc-btn sc-small', onclick: () => app.showConfig() }, 'เปลี่ยนการเชื่อมต่อ'),
          app.host.linkLine ? h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'link-line', onclick: (e) => this.linkLine(e.currentTarget) }, 'ผูกบัญชี LINE นี้') : null));

      const shopName = h('input', { class: 'sc-input', type: 'text', value: settings.shop_name || '', readOnly: !isAdmin, 'data-sc': 'set-shop' });
      const pay = h('textarea', { class: 'sc-input', rows: '4', value: settings.payment_instructions || '', readOnly: !isAdmin, placeholder: 'เช่น โอนเข้าบัญชี กสิกรไทย 123-4-56789-0 ชื่อบัญชี …\nโอนแล้วส่งสลิปในแชทได้เลยค่ะ', 'data-sc': 'set-pay' });
      const shop = section('ร้าน', null,
        h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'ชื่อร้าน'), shopName),
        h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'วิธีชำระเงิน (ต่อท้ายข้อความสรุป' + L().order + ')'), pay),
        isAdmin
          ? h('div', null, h('button', { type: 'button', class: 'sc-btn sc-primary sc-small', 'data-sc': 'set-save', onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await app.api.put('/api/settings', { shop_name: shopName.value.trim(), payment_instructions: pay.value.trim() });
              app.toast('บันทึกการตั้งค่าร้านแล้ว', 'ok');
            } catch (err) { app.toast(err.message, 'err'); }
            btn.disabled = false;
          } }, 'บันทึก'))
          : h('div', { class: 'sc-muted sc-small' }, 'เฉพาะแอดมินแก้ไขได้'));

      const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px', 'data-sc': 'product-list' });
      const drawProducts = () => {
        fill(list, products.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, products.map((p) => {
          const save = async (body) => {
            try {
              const r = await app.api.patch('/api/products/' + p.id, body);
              Object.assign(p, r.product);
              drawProducts();
            } catch (err) { app.toast(err.message, 'err'); drawProducts(); }
          };
          return h('div', { class: 'sc-prod-row' + (p.active === false ? ' sc-off' : '') },
            h('input', { class: 'sc-input', type: 'text', value: p.name, 'aria-label': 'ชื่อ' + L().product, onblur: (e) => { const v = e.target.value.trim(); if (v && v !== p.name) save({ name: v }); } }),
            h('input', { class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', value: p.price, 'aria-label': 'ราคา', onblur: (e) => { const v = num(e.target.value); if (v !== num(p.price)) save({ price: v }); } }),
            h('button', { type: 'button', class: 'sc-btn sc-small' + (p.active === false ? '' : ' sc-ghost'), onclick: () => save({ active: p.active === false }) }, p.active === false ? 'เปิดขาย' : 'ปิด'));
        })) : h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มี' + L().products + ' เพิ่มรายการแรกด้านล่าง'));
      };
      drawProducts();
      const newName = h('input', { class: 'sc-input', type: 'text', placeholder: 'ชื่อ' + L().product + 'ใหม่', 'aria-label': 'ชื่อ' + L().product + 'ใหม่', 'data-sc': 'prod-name' });
      const newPrice = h('input', { class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', placeholder: 'ราคา', 'aria-label': 'ราคา', 'data-sc': 'prod-price' });
      const addProduct = async () => {
        const name = newName.value.trim();
        if (!name) { newName.focus(); return; }
        try {
          const r = await app.api.post('/api/products', { name, price: num(newPrice.value) });
          products.unshift(r.product);
          newName.value = '';
          newPrice.value = '';
          drawProducts();
          app.toast('เพิ่ม' + L().product + 'แล้ว', 'ok');
        } catch (err) { app.toast(err.message, 'err'); }
      };
      const catalog = section(CONFIG.profile === 'retail' ? 'สินค้า / บริการ' : L().products, null,
        h('form', { class: 'sc-prod-row', onsubmit: (e) => { e.preventDefault(); addProduct(); } },
          newName, newPrice, h('button', { type: 'submit', class: 'sc-btn sc-small sc-primary', 'data-sc': 'prod-add' }, icon('plus'), 'เพิ่ม')),
        list);

      fill(this.body, account, shop, catalog);
    }
    async linkLine(btn) {
      btn.disabled = true;
      try {
        await this.app.host.linkLine();
        this.app.toast('ผูกบัญชี LINE แล้ว ครั้งหน้าเปิดจาก LINE ได้เลย', 'ok');
      } catch (err) {
        this.app.toast('ผูกบัญชี LINE ไม่สำเร็จ: ' + err.message, 'err');
      }
      btn.disabled = false;
    }
  }

  // ================================================================== app shell
  class App {
    constructor(root, opts) {
      this.root = root;
      this.api = opts.api;
      this.mode = opts.mode === 'inbox' ? 'inbox' : 'panel';
      this.host = opts.host || {};
      this.me = null;
      this.stack = [];
      this.chat = null;
      this.dueCount = 0;
      this.dueTimer = null;
      this.configOpen = false;
      this.staffList = null;
    }

    start() {
      this.root.classList.add('sc-root', 'sc-mode-' + this.mode);
      this.root.replaceChildren();
      this.topbar = h('header', { class: 'sc-topbar' });
      this.main = h('main', { class: 'sc-main' });
      this.toasts = h('div', { class: 'sc-toasts', 'aria-live': 'polite' });
      this.root.append(this.topbar, this.main, this.toasts);
      this.api.onUnauthorized = (err) => this.showConfig(err && err.message);
      // A theme can name the colour of the browser chrome around the page (mobile address bar).
      const chrome = getComputedStyle(this.root).getPropertyValue('--chrome-color').trim();
      const meta = chrome && document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', chrome);
      this.renderTopbar();
      if (!this.api.isConfigured()) this.showConfig();
      else this.boot();
    }

    async boot() {
      fill(this.main, skeleton());
      try {
        const r = await this.api.get('/api/me');
        this.me = r.staff;
        await this.loadConfig();
        this.afterBoot();
      } catch (err) {
        if (err.status === 401) return; // config screen already shown by the hook
        fill(this.main, h('div', { class: 'sc-view' }, errorState(err, () => this.boot()),
          h('div', { style: 'text-align:center' }, h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', onclick: () => this.showConfig() }, 'ตั้งค่าการเชื่อมต่อ'))));
      }
    }

    /** The deployment's profile. A server without the route keeps the built-in retail profile. */
    async loadConfig() {
      try {
        const r = await this.api.get('/api/config', { silentAuth: true });
        setConfig(r.config);
      } catch (_) {
        setConfig(null);
      }
    }

    async loadStaff() {
      try {
        const r = await this.api.get('/api/staff');
        this.staffList = r.staff || [];
        const v = this.top();
        const lv = v && v.leadView;
        if (lv) lv.renderHead();
      } catch (_) { this.staffList = null; /* the picker falls back to a "claim" button */ }
    }

    afterBoot() {
      this.configOpen = false;
      this.clearStack();
      this.loadStaff();
      if (this.mode === 'inbox') {
        this.home = new InboxView(this, {});
      } else {
        this.home = new ChatView(this);
        if (this.chat) this.home.setChat(this.chat);
        this.pollDue();
        clearInterval(this.dueTimer);
        this.dueTimer = setInterval(() => { if (document.visibilityState === 'visible') this.pollDue(); }, DUE_POLL_MS);
      }
      this.stack = [this.home];
      this.renderTopbar();
      this.renderTop();
    }

    // ---- navigation
    top() { return this.stack[this.stack.length - 1]; }
    clearStack() {
      for (const v of this.stack) { if (v.onHide) v.onHide(); if (v.destroy) v.destroy(); }
      this.stack = [];
    }
    renderTop() {
      const v = this.top();
      fill(this.main, v ? v.el : '');
      this.main.scrollTop = (v && v._scroll) || 0;
      if (v && v.onShow) v.onShow();
    }
    push(view) {
      const cur = this.top();
      if (cur) { cur._scroll = this.main.scrollTop; if (cur.onHide) cur.onHide(); }
      this.stack.push(view);
      this.renderTop();
    }
    back() {
      if (this.stack.length <= 1) return;
      const v = this.stack.pop();
      if (v.onHide) v.onHide();
      if (v.destroy) v.destroy();
      this.renderTop();
    }
    popToHome() {
      while (this.stack.length > 1) {
        const v = this.stack.pop();
        if (v.onHide) v.onHide();
        if (v.destroy) v.destroy();
      }
      this.renderTop();
    }
    openLead(id) { this.push(new LeadPage(this, id)); }
    openInbox(tab) { this.push(new InboxView(this, { tab, back: true })); }
    openSettings() { if (!(this.top() instanceof SettingsView)) this.push(new SettingsView(this)); }

    showConfig(message) {
      if (this.configOpen) return;
      this.configOpen = true;
      clearInterval(this.dueTimer);
      this.clearStack();
      const v = new ConfigView(this, message);
      this.stack = [v];
      this.renderTopbar();
      this.renderTop();
    }

    // ---- top bar
    renderTopbar() {
      // A theme whose top bar is dark asks for the light logo whatever the colour scheme.
      const onDark = getComputedStyle(this.root).getPropertyValue('--topbar-logo').trim() === 'dark';
      const mark = brandLogo('mark', onDark ? 'dark' : 'auto', 'sc-brand-mark');
      const brand = h('div', { class: 'sc-brand' + (mark ? ' sc-has-mark' : ''), 'data-sc': 'brand' },
        mark,
        h('b', null, BRAND.name), h('span', null, this.me ? this.me.name : ''));
      const kids = [brand];
      if (this.me && !this.configOpen) {
        if (this.mode === 'panel') {
          const due = iconBtn('clock', 'ลูกค้าที่ต้องตาม', () => this.openInbox('due'), 'sc-due-btn');
          due.dataset.sc = 'open-due';
          if (this.dueCount > 0) due.append(h('span', { class: 'sc-badge', 'data-sc': 'due-badge' }, this.dueCount > 99 ? '99+' : this.dueCount));
          const all = iconBtn('list', 'ลูกค้าทั้งหมด', () => this.openInbox('all'));
          all.dataset.sc = 'open-inbox';
          kids.push(due, all);
        }
        const gear = iconBtn('gear', 'ตั้งค่า', () => this.openSettings());
        gear.dataset.sc = 'open-settings';
        kids.push(gear);
      }
      fill(this.topbar, ...kids);
    }
    setDueCount(n) {
      if (n === this.dueCount) return;
      this.dueCount = n;
      this.renderTopbar();
    }
    async pollDue() {
      try {
        const r = await this.api.get('/api/leads?due=1&limit=1');
        this.setDueCount(Number(r.due_count) || 0);
      } catch (_) { /* badge is best-effort */ }
    }
    notifyChanged() { if (this.mode === 'panel') this.pollDue(); }

    // ---- chat from the host page (panel mode)
    setChat(chatId, name) {
      this.chat = chatId ? { chatId: String(chatId), name: name ? String(name) : '' } : null;
      if (this.mode !== 'panel' || !(this.home instanceof ChatView) || this.configOpen) return;
      const changed = !this.home.chat || !this.chat || this.home.chat.chatId !== this.chat.chatId;
      if (changed && this.stack.length > 1) this.popToHome();
      this.home.setChat(this.chat);
    }

    // ---- feedback
    toast(text, kind) {
      const el = h('div', { class: 'sc-toast' + (kind ? ' sc-' + kind : ''), role: kind === 'err' ? 'alert' : 'status', 'data-sc': 'toast' }, text);
      fill(this.toasts, el); // one at a time, so feedback never piles up over the controls
      setTimeout(() => el.remove(), kind === 'err' ? 5000 : 2600);
    }
    overlayOpen() { return !!this.root.querySelector('.sc-lightbox, .sc-modal-back'); }
    confirm(o) {
      return new Promise((resolve) => {
        const done = (v) => { document.removeEventListener('keydown', onKey, true); back.remove(); resolve(v); };
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
        const okBtn = h('button', { type: 'button', class: 'sc-btn ' + (o.danger ? 'sc-danger' : 'sc-primary'), 'data-sc': 'confirm-ok', onclick: () => done(true) }, o.confirmLabel || 'ยืนยัน');
        const back = h('div', { class: 'sc-modal-back', 'data-sc': 'confirm', onclick: (e) => { if (e.target === back) done(false); } },
          h('div', { class: 'sc-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': o.title },
            h('h3', null, o.title),
            o.body ? h('p', null, o.body) : null,
            h('div', { class: 'sc-modal-actions' },
              h('button', { type: 'button', class: 'sc-btn', 'data-sc': 'confirm-cancel', onclick: () => done(false) }, 'ยังก่อน'),
              okBtn)));
        document.addEventListener('keydown', onKey, true);
        this.root.append(back);
        okBtn.focus();
      });
    }
    async copy(text) {
      const fn = this.host.copy || copyText;
      let ok = false;
      try { ok = await fn(text); } catch (_) { ok = false; }
      this.toast(ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ ลองเลือกข้อความแล้วคัดลอกเอง', ok ? 'ok' : 'err');
      return ok;
    }
    async insertOrCopy(text) {
      let ok = false;
      if (this.host.insertText) {
        try { ok = !!(await this.host.insertText(text)); } catch (_) { ok = false; }
      }
      if (ok) { this.toast('ใส่ในช่องแชทแล้ว — ตรวจข้อความแล้วกดส่ง', 'ok'); return; }
      const fn = this.host.copy || copyText;
      let copied = false;
      try { copied = await fn(text); } catch (_) { copied = false; }
      this.toast(copied ? 'ใส่ในช่องแชทไม่ได้ — คัดลอกให้แล้ว กดวางในแชทได้เลย' : 'ใส่ในช่องแชทและคัดลอกไม่สำเร็จ', copied ? '' : 'err');
    }

    destroy() {
      clearInterval(this.dueTimer);
      this.clearStack();
      this.root.replaceChildren();
    }
  }

  function mount(rootEl, opts) {
    if (!rootEl || !opts || !opts.api) throw new Error('SidecarUI.mount(rootEl, { api, mode, host })');
    const app = new App(rootEl, opts);
    app.start();
    return {
      setChat: (chatId, name) => app.setChat(chatId, name),
      refresh: () => { const v = app.top(); if (v && v.refresh) v.refresh(); },
      reconnect: () => { app.configOpen = false; app.boot(); },
      destroy: () => app.destroy(),
    };
  }

  global.SidecarUI = {
    mount, createApi, ApiError, localStore, copyText, calcTotals,
    brand: BRAND, brandLogo,
    STAGES: RETAIL_CONFIG.stages.map((s) => ({ id: s.key, label: s.label })),
  };
})(typeof window !== 'undefined' ? window : globalThis);
