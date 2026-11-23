/* Sidecar shared UI — used by the Chrome extension panel and by staff.html.
 * No framework, no build step. API data is only ever written with textContent / properties.
 * Contract: docs/sidecar-contract.md
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ constants
  const STAGES = [
    { id: 'new', label: 'ใหม่' },
    { id: 'interested', label: 'สนใจ' },
    { id: 'quoted', label: 'เสนอราคาแล้ว' },
    { id: 'awaiting_payment', label: 'รอโอน' },
    { id: 'paid', label: 'ชำระแล้ว' },
    { id: 'booked', label: 'จองคิวแล้ว' },
    { id: 'won', label: 'ปิดการขาย' },
    { id: 'lost', label: 'ยกเลิก' },
    { id: 'spam', label: 'สแปม' },
  ];
  const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));
  const MEDIA_CATS = [
    { id: 'slip', label: 'สลิป' },
    { id: 'product', label: 'สินค้า' },
    { id: 'before_after', label: 'ก่อน-หลัง' },
    { id: 'document', label: 'เอกสาร' },
    { id: 'other', label: 'อื่นๆ' },
  ];
  const MEDIA_LABEL = Object.fromEntries(MEDIA_CATS.map((c) => [c.id, c.label]));
  const PAY_METHODS = [
    { id: '', label: 'ยังไม่ระบุ' },
    { id: 'transfer', label: 'โอนเงิน' },
    { id: 'cod', label: 'เก็บเงินปลายทาง' },
    { id: 'installment', label: 'ผ่อนชำระ' },
  ];
  const ORDER_STATUS = { draft: 'ร่าง', awaiting_payment: 'รอโอน', paid: 'ชำระแล้ว', cancelled: 'ยกเลิก' };
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
    return h('span', { class: 'sc-stage-tag sc-st-' + stage }, STAGE_LABEL[stage] || stage);
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
      this.initDraft();

      this.secHead = h('section', { class: 'sc-card', 'data-sc': 'lead-head' });
      this.secAgent = h('section', { class: 'sc-card sc-agent', 'data-sc': 'agent' });
      this.secMsgs = h('section', { class: 'sc-card', 'data-sc': 'messages' });
      this.secCard = h('section', { class: 'sc-card', 'data-sc': 'card' });
      this.secOrder = h('section', { class: 'sc-card', 'data-sc': 'order' });
      this.secNotes = h('section', { class: 'sc-card', 'data-sc': 'notes' });
      this.secAlbum = h('section', { class: 'sc-card', 'data-sc': 'album' });
      this.secFollow = h('section', { class: 'sc-card', 'data-sc': 'followup' });
      this.el = h('div', { class: 'sc-view', 'data-sc': 'lead', 'data-lead-id': bundle.lead.id },
        this.secHead, this.secAgent, this.secMsgs, this.secCard, this.secOrder, this.secNotes, this.secAlbum, this.secFollow);

      this.buildCard();
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
      subBits.push(l.assignee_name ? 'ดูแลโดย ' + l.assignee_name : 'ยังไม่มีผู้ดูแล');

      const claim = me && l.assignee_id !== me.id
        ? h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'claim', onclick: () => this.claim() }, 'รับเคสนี้')
        : null;

      const stageChips = h('div', { class: 'sc-chips', role: 'group', 'aria-label': 'สถานะลูกค้า', 'data-sc': 'stages' },
        STAGES.map((s) => h('button', {
          type: 'button',
          class: 'sc-chip sc-st-' + s.id + (l.stage === s.id ? ' sc-on' : ''),
          'aria-pressed': l.stage === s.id ? 'true' : 'false',
          'data-stage': s.id,
          onclick: () => this.setStage(s.id),
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

      this.secHead.replaceChildren(h('div', { class: 'sc-lead-head' },
        h('div', { class: 'sc-ident' },
          avatar(l),
          h('div', { class: 'sc-ident-text' },
            h('div', { class: 'sc-name', 'data-sc': 'lead-name' }, leadName(l)),
            h('div', { class: 'sc-sub' }, subBits.join(' · '))),
          claim),
        stageChips,
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

    async claim() {
      try {
        await this.patchLead({ assignee_id: this.app.me.id }, 'รับเคสแล้ว');
        this.renderHead();
      } catch (err) { this.app.toast(err.message, 'err'); }
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
            this.textActions(() => l.suggested_reply, 'reply'));
        }
      }
      this.secAgent.replaceChildren(head, body);
    }

    textActions(getText, key) {
      const row = h('div', { class: 'sc-row-gap' });
      if (this.app.host.insertText) {
        row.append(h('button', { type: 'button', class: 'sc-btn sc-primary sc-small', 'data-sc': key + '-insert', onclick: () => this.app.insertOrCopy(getText()) }, icon('insert'), 'ใส่ในช่องแชท'));
      }
      row.append(h('button', {
        type: 'button', class: 'sc-btn sc-small' + (this.app.host.insertText ? '' : ' sc-primary'), 'data-sc': key + '-copy',
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
      this.secMsgs.replaceChildren(this.msgDetails);
    }

    // ---- lead card (inline edit)
    buildCard() {
      const grid = h('div', { class: 'sc-grid-card' });
      for (const f of CARD_FIELDS) {
        const state = h('span', { class: 'sc-state' });
        const lock = h('span', { class: 'sc-lockmark', title: 'ทีมแก้ไขเอง — Agent จะไม่เขียนทับ', hidden: true }, icon('lock'));
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
        grid.append(h('div', { class: 'sc-field' + (f.wide ? ' sc-wide' : '') },
          h('label', { class: 'sc-label', for: 'sc-f-' + f.key }, f.label, lock, state),
          control));
      }
      this.samePhoneBox = h('div', { hidden: true });
      this.secCard.replaceChildren(
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
      this.samePhoneBox.replaceChildren(h('div', { class: 'sc-notice', 'data-sc': 'same-phone' },
        h('b', null, 'ลูกค้าเก่า'), ' — เบอร์นี้ตรงกับ ',
        same.map((s, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'sc-link', onclick: () => this.app.openLead(s.id) }, leadName(s))])));
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
      return h('dl', { class: 'sc-totals' },
        h('dt', null, 'ยอดสินค้า'), els.subtotal,
        h('dt', null, 'ส่วนลด'), els.discount,
        h('dt', null, 'ค่าจัดส่ง'), els.shipping,
        h('dt', { class: 'sc-grand' }, 'ยอดรวม'), els.total,
        depDt, els.deposit, remDt, els.remain);
    }

    renderOrder() {
      const d = this.draft;
      const statusBadge = d.status
        ? h('span', { class: 'sc-order-status sc-os-' + d.status, 'data-sc': 'order-status' }, ORDER_STATUS[d.status] || d.status)
        : h('span', { class: 'sc-order-status', 'data-sc': 'order-status' }, 'ยังไม่มีออเดอร์');
      this.dirtyMark = h('span', { class: 'sc-dirty', hidden: !this.orderDirty }, '● ยังไม่บันทึก');
      const head = h('div', { class: 'sc-sec-head' }, h('h2', { class: 'sc-sec-title' }, 'ออเดอร์'), this.dirtyMark, statusBadge);
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
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'summary', onclick: () => this.showSummary() }, 'ร่างข้อความสรุป'),
            h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-new', onclick: () => { this.draft = this.blankDraft(); this.orderReadonly = false; this.renderOrder(); } }, icon('plus'), 'สร้างออเดอร์ใหม่')),
          this.summaryBox);
        this.secOrder.replaceChildren(head, body);
        this.updateTotals();
        this.renderSummary();
        return;
      }

      // product search
      const results = h('div', { class: 'sc-search-results', hidden: true, 'data-sc': 'product-results' });
      const searchInput = h('input', {
        class: 'sc-input', type: 'search', placeholder: 'ค้นหาสินค้าเพื่อเพิ่ม…', 'aria-label': 'ค้นหาสินค้า', autocomplete: 'off', 'data-sc': 'product-search',
      });
      let searchSeq = 0;
      const runSearch = debounce(async () => {
        const q = searchInput.value.trim();
        const seq = ++searchSeq;
        try {
          const r = await this.api.get('/api/products?q=' + encodeURIComponent(q));
          if (seq !== searchSeq) return;
          const products = (r.products || []).filter((p) => p.active !== false).slice(0, 20);
          results.replaceChildren(products.length
            ? h('div', null, products.map((p) => h('button', {
              type: 'button', class: 'sc-search-item', 'data-product-id': p.id,
              onclick: () => { this.addProduct(p); searchInput.value = ''; results.hidden = true; },
            }, h('span', null, p.name), h('span', null, money(p.price)))))
            : h('div', { class: 'sc-search-empty' }, q ? 'ไม่พบ "' + q + '" — ใช้ "เพิ่มรายการเอง" ได้' : 'ยังไม่มีสินค้าในระบบ เพิ่มได้ที่ตั้งค่า'));
          results.hidden = false;
        } catch (err) {
          if (seq !== searchSeq) return;
          results.replaceChildren(h('div', { class: 'sc-search-empty' }, err.message));
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
      if (!d.items.length) items.append(h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มีรายการ ค้นหาสินค้าด้านบน หรือเพิ่มรายการเอง'));

      const field = (label, control) => h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, label), control);
      const numInput = (key, sc) => h('input', {
        class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: d[key] === '' ? '' : d[key], placeholder: '0', 'data-sc': sc,
        oninput: (e) => { d[key] = e.target.value === '' ? (key === 'deposit_amount' ? '' : 0) : num(e.target.value); this.markDirty(); },
      });
      const paySelect = h('select', { class: 'sc-input', 'data-sc': 'order-payment', onchange: (e) => { d.payment_method = e.target.value; this.markDirty(); } },
        PAY_METHODS.map((p) => h('option', { value: p.id }, p.label)));
      paySelect.value = d.payment_method || '';

      this.saveBtn = h('button', { type: 'button', class: 'sc-btn sc-primary', 'data-sc': 'order-save', onclick: () => this.saveOrder() }, 'บันทึกออเดอร์');
      const statusRow = h('div', { class: 'sc-row-gap', 'data-sc': 'order-status-actions' });
      if (d.status !== 'awaiting_payment') {
        statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-await', onclick: () => this.setOrderStatus('awaiting_payment') }, 'ตั้งเป็นรอโอน'));
      }
      statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small', 'data-sc': 'order-paid', onclick: () => this.setOrderStatus('paid') }, 'ยืนยันชำระแล้ว'));
      if (d.id) statusRow.append(h('button', { type: 'button', class: 'sc-btn sc-small sc-danger', 'data-sc': 'order-cancel', onclick: () => this.setOrderStatus('cancelled') }, 'ยกเลิก'));

      body.append(
        searchWrap,
        items,
        h('div', null, h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', 'data-sc': 'item-add', onclick: () => { d.items.push({ product_id: null, name: '', qty: 1, unit_price: 0 }); this.markDirty(); this.renderOrder(); const ins = this.secOrder.querySelectorAll('.sc-item input[type=text]'); if (ins.length) ins[ins.length - 1].focus(); } }, icon('plus'), 'เพิ่มรายการเอง')),
        h('div', { class: 'sc-grid2' }, field('ส่วนลด (บาท)', numInput('discount', 'order-discount')), field('ค่าจัดส่ง (บาท)', numInput('shipping_fee', 'order-shipping'))),
        h('div', { class: 'sc-grid2' }, field('วิธีชำระ', paySelect), field('มัดจำ (บาท)', numInput('deposit_amount', 'order-deposit'))),
        field('หมายเหตุออเดอร์', h('input', { class: 'sc-input', type: 'text', value: d.note, placeholder: 'เช่น สี / ความจุ / นัดรับ', oninput: (e) => { d.note = e.target.value; this.markDirty(); } })),
        this.totalsBlock(),
        h('div', { class: 'sc-row-gap' }, this.saveBtn, h('button', { type: 'button', class: 'sc-btn', 'data-sc': 'summary', onclick: () => this.showSummary() }, 'ร่างข้อความสรุป')),
        statusRow,
        this.summaryBox);
      this.secOrder.replaceChildren(head, body);
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
        payment_method: d.payment_method || null,
        deposit_amount: d.deposit_amount === '' || d.deposit_amount == null ? null : num(d.deposit_amount),
        note: String(d.note || '').trim() || null,
      };
    }

    /** Saves the draft. Returns true when the server holds exactly what is on screen. */
    async saveOrder(silent) {
      const body = this.orderBody();
      if (!body.items.length) { this.app.toast('เพิ่มรายการสินค้าอย่างน้อย 1 รายการก่อนบันทึก', 'err'); return false; }
      if (body.items.some((it) => it.qty <= 0)) { this.app.toast('จำนวนต้องมากกว่า 0', 'err'); return false; }
      if (this.saveBtn) { this.saveBtn.disabled = true; this.saveBtn.textContent = 'กำลังบันทึก…'; }
      this.busy = true;
      try {
        const r = await this.api.put('/api/leads/' + this.lead.id + '/order', body);
        this.b.order = r.order;
        this.initDraft();
        this.renderOrder();
        if (!silent) this.app.toast('บันทึกออเดอร์แล้ว ยอดรวม ' + money(r.order.total), 'ok');
        this.reload(true); // slip match and draft stage can change with the order
        return true;
      } catch (err) {
        this.app.toast('บันทึกออเดอร์ไม่สำเร็จ: ' + err.message, 'err');
        if (this.saveBtn) { this.saveBtn.disabled = false; this.saveBtn.textContent = 'บันทึกออเดอร์'; }
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
          body: 'ยอดออเดอร์ ' + money(o.total) + (o.deposit_amount ? ' (มัดจำ ' + money(o.deposit_amount) + ')' : '') + '\nตรวจยอดเข้าบัญชีจริงก่อนกดยืนยัน — สลิปที่ Agent อ่านได้ไม่ใช่หลักฐานว่าเงินเข้า',
          confirmLabel: 'ยืนยันชำระแล้ว',
        });
        if (!ok) return;
      }
      if (status === 'cancelled') {
        const ok = await this.app.confirm({ title: 'ยกเลิกออเดอร์นี้?', body: 'ออเดอร์ ' + money(o.total) + ' จะถูกปิดเป็นยกเลิก', confirmLabel: 'ยกเลิกออเดอร์', danger: true });
        if (!ok) return;
      }
      try {
        const r = await this.api.post('/api/orders/' + o.id + '/status', { status });
        this.b.order = r.order;
        if (r.lead) this.b.lead = r.lead;
        this.initDraft();
        this.renderOrder();
        this.renderHead();
        this.app.toast('ออเดอร์: ' + (ORDER_STATUS[status] || status), 'ok');
        this.app.notifyChanged();
        this.reload(true);
      } catch (err) {
        this.app.toast('เปลี่ยนสถานะออเดอร์ไม่สำเร็จ: ' + err.message, 'err');
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
      this.summaryBox.replaceChildren(
        h('div', { class: 'sc-label' }, 'ข้อความสรุป (สร้างจากออเดอร์ที่บันทึก ยอดตรงเสมอ)'),
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
      this.secNotes.replaceChildren(
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
      this.notesList.replaceChildren(notes.length
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
        MEDIA_CATS.filter((c) => counts[c.id]).map((c) => chip(c.id, c.label, counts[c.id])));
      const list = this.filteredMedia();
      const grid = h('div', { class: 'sc-grid', 'data-sc': 'album-grid' }, list.map((m, i) => {
        const btn = h('button', { type: 'button', class: 'sc-thumb', 'data-media-id': m.id, 'aria-label': 'เปิดรูป ' + (MEDIA_LABEL[m.category] || ''), onclick: () => this.openLightbox(i) });
        const src = safeUrl(m.url);
        if (src) { const img = h('img', { alt: m.caption || MEDIA_LABEL[m.category] || '', loading: 'lazy' }); img.src = src; btn.append(img); }
        btn.append(h('span', { class: 'sc-thumb-tag' }, m.category === 'slip' && m.slip && m.slip.amount != null ? money(m.slip.amount) : MEDIA_LABEL[m.category] || m.category));
        if (m.category === 'slip' && m.slip && m.slip.matches_order != null) {
          btn.append(h('span', { class: 'sc-thumb-flag ' + (m.slip.matches_order ? 'sc-ok' : 'sc-bad'), title: m.slip.matches_order ? 'ยอดตรงกับออเดอร์' : 'ยอดไม่ตรงกับออเดอร์' }, m.slip.matches_order ? '✓' : '!'));
        }
        return btn;
      }));
      this.secAlbum.replaceChildren(
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
        const img = h('img', { alt: m.caption || MEDIA_LABEL[m.category] || 'รูปจากลูกค้า' });
        if (src) img.src = src;
        stage.replaceChildren(img);

        const catSelect = h('select', { class: 'sc-input', 'data-sc': 'media-category', 'aria-label': 'หมวดรูป', onchange: (e) => this.patchMedia(m, { category: e.target.value }) },
          MEDIA_CATS.map((c) => h('option', { value: c.id }, c.label)));
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
            ? h('dd', { class: 'sc-slip-match sc-ok', 'data-sc': 'slip-match' }, '✓ ยอดตรงกับออเดอร์')
            : s.matches_order === false
              ? h('dd', { class: 'sc-slip-match sc-bad', 'data-sc': 'slip-match' }, '⚠ ยอดไม่ตรงกับออเดอร์')
              : h('dd', { class: 'sc-slip-match sc-none', 'data-sc': 'slip-match' }, 'ยังไม่มีออเดอร์ให้เทียบ');
          parts.push(
            h('dl', { class: 'sc-slip', 'data-sc': 'slip-details' },
              h('dt', null, 'ยอดในสลิป'), h('dd', null, s.amount != null ? money(s.amount) : 'อ่านไม่ได้'),
              h('dt', null, 'ธนาคาร'), h('dd', null, s.bank || '—'),
              h('dt', null, 'เวลาโอน'), h('dd', null, s.paid_at ? fmtDateTime(s.paid_at) : '—'),
              h('dt', null, 'เลขอ้างอิง'), h('dd', null, s.ref || '—'),
              h('dt', null, 'เทียบออเดอร์'), match),
            h('div', { class: 'sc-slip-warn' }, 'อ่านสลิปได้ ไม่ได้ยืนยันว่าเงินเข้า — ตรวจยอดในบัญชีก่อนยืนยันชำระ'));
        }
        info.replaceChildren(...parts);
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
      this.secFollow.replaceChildren(
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
      this.el.replaceChildren(h('div', { class: 'sc-view' }, emptyState('เลือกแชทลูกค้า', 'เปิดแชทใน LINE OA ทางซ้าย แล้ว Sidecar จะแสดงการ์ดลูกค้า โน้ต อัลบั้ม และออเดอร์ของแชทนั้น')));
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
      this.el.replaceChildren(skeleton());
      try {
        const q = chat.name ? '?name=' + encodeURIComponent(chat.name) : '';
        const b = await this.app.api.get('/api/leads/by-chat/' + encodeURIComponent(chat.chatId) + q);
        if (seq !== this.seq) return;
        if (b.lead) {
          this.leadView = new LeadView(this.app, b, {});
          this.el.replaceChildren(this.leadView.el);
          if (this.app.top() === this) this.leadView.start();
        } else {
          this.renderUnknown(b);
        }
      } catch (err) {
        if (seq !== this.seq) return;
        if (err.status === 401) return;
        this.el.replaceChildren(h('div', { class: 'sc-view' }, errorState(err, () => this.load())));
      }
    }

    renderUnknown(b) {
      const chat = this.chat;
      const list = h('div', { class: 'sc-list', 'data-sc': 'candidates' });
      const fill = (leads, emptyText) => {
        list.replaceChildren(leads.length
          ? h('div', null, leads.map((c) => h('div', { class: 'sc-row', style: 'cursor:default', 'data-lead-id': c.id },
            avatar(c, true),
            h('div', { class: 'sc-row-main' },
              h('div', { class: 'sc-row-top' }, h('span', { class: 'sc-row-name' }, leadName(c)), stageTag(c.stage)),
              h('div', { class: 'sc-row-bottom' }, h('span', { class: 'sc-row-preview' }, [c.full_name, c.phone, c.last_message_at ? 'ล่าสุด ' + relTime(c.last_message_at) : ''].filter(Boolean).join(' · ')))),
            h('button', { type: 'button', class: 'sc-btn sc-small sc-primary', 'data-sc': 'link-chat', onclick: (e) => this.link(c, e.currentTarget) }, 'ผูกกับแชทนี้'))))
          : h('div', { class: 'sc-muted sc-small', style: 'padding:10px 12px' }, emptyText));
      };
      const candidates = b.candidates || [];
      fill(candidates, 'ไม่พบลูกค้าที่ชื่อตรงกับแชทนี้');

      let seq = 0;
      const search = h('input', { class: 'sc-input', type: 'search', placeholder: 'ค้นหาชื่อหรือเบอร์เพื่อผูกเอง…', 'aria-label': 'ค้นหาลูกค้าเพื่อผูก', 'data-sc': 'link-search' });
      search.addEventListener('input', debounce(async () => {
        const q = search.value.trim();
        const s = ++seq;
        if (!q) { fill(candidates, 'ไม่พบลูกค้าที่ชื่อตรงกับแชทนี้'); return; }
        try {
          const r = await this.app.api.get('/api/leads?limit=8&q=' + encodeURIComponent(q));
          if (s === seq) fill(r.leads || [], 'ไม่พบ "' + q + '"');
        } catch (err) { if (s === seq) fill([], err.message); }
      }, 300));

      this.el.replaceChildren(h('div', { class: 'sc-view', 'data-sc': 'unknown-chat' },
        h('section', { class: 'sc-card' },
          h('div', { class: 'sc-sec-body' },
            h('b', null, 'ยังไม่มีการ์ดของแชทนี้' + (chat.name ? ' (' + chat.name + ')' : '')),
            h('div', { class: 'sc-muted' }, 'ลูกค้าคนนี้ยังไม่ได้ส่งข้อความเข้ามาตั้งแต่เชื่อม Sidecar กับ LINE OA — เมื่อลูกค้าทักมาครั้งถัดไป ระบบจะสร้างการ์ดให้อัตโนมัติ'),
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
      this.body.replaceChildren(skeleton());
      try {
        const b = await this.app.api.get('/api/leads/' + this.id);
        if (!b.lead) throw new ApiError(404, 'not_found', STATUS_TEXT[404]);
        this.leadView = new LeadView(this.app, b, {});
        this.body.replaceChildren(this.leadView.el);
        if (this.app.top() === this) this.leadView.start();
      } catch (err) {
        if (err.status === 401) return;
        this.body.replaceChildren(h('div', { class: 'sc-view' }, errorState(err, () => this.load())));
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
      this.tabsEl.replaceChildren(
        tab('all', 'ทั้งหมด', this.loadedOnce ? total : null),
        tab('due', 'ต้องตาม', this.loadedOnce ? this.dueCount : null, 'sc-due'),
        STAGES.map((s) => tab(s.id, s.label, this.loadedOnce ? (this.counts[s.id] || 0) : null, 'sc-st-' + s.id)));
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
        this.listEl.replaceChildren(h('div', { class: 'sc-list', 'aria-busy': 'true', 'data-sc': 'loading' },
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
        this.listEl.replaceChildren(errorState(err, () => this.load()));
      }
    }

    renderList() {
      if (!this.leads.length) {
        const text = this.q ? 'ไม่พบลูกค้าที่ตรงกับ "' + this.q + '"'
          : this.tab === 'due' ? 'ไม่มีลูกค้าที่ถึงเวลาต้องตาม'
            : this.tab === 'all' ? 'ยังไม่มีลูกค้า — การ์ดจะถูกสร้างเมื่อมีคนทัก LINE OA เข้ามา'
              : 'ไม่มีลูกค้าในสถานะ "' + (STAGE_LABEL[this.tab] || this.tab) + '"';
        this.listEl.replaceChildren(emptyState('ว่าง', text));
        return;
      }
      const rows = this.leads.map((l) => h('button', { type: 'button', class: 'sc-row', 'data-lead-id': l.id, onclick: () => this.app.openLead(l.id) },
        avatar(l, true),
        h('div', { class: 'sc-row-main' },
          h('div', { class: 'sc-row-top' },
            h('span', { class: 'sc-row-name' }, leadName(l)),
            h('span', { class: 'sc-row-time' }, relTime(l.last_message_at))),
          h('div', { class: 'sc-row-bottom' },
            h('span', { class: 'sc-row-preview' }, l.last_message_preview || l.ai_summary || l.phone || '—'),
            isPast(l.follow_up_at) ? h('span', { class: 'sc-due-dot', title: 'ถึงเวลาตาม' }, icon('clock'), 'ตาม') : null,
            stageTag(l.stage)))));
      this.listEl.replaceChildren(h('div', { class: 'sc-list' }, rows),
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
      this.btn = h('button', { type: 'submit', class: 'sc-btn sc-primary sc-block', 'data-sc': 'cfg-save' }, 'บันทึกและเชื่อมต่อ');
      const form = h('form', { class: 'sc-sec-body', onsubmit: (e) => { e.preventDefault(); this.save(); } },
        h('div', null, h('b', { style: 'font-size:15px' }, 'เชื่อมต่อ Sidecar'), h('div', { class: 'sc-muted' }, 'ใส่ token ประจำตัวพนักงานที่แอดมินออกให้ (ใส่ครั้งเดียว)')),
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
        const [s, p] = await Promise.all([app.api.get('/api/settings'), app.api.get('/api/products?q=')]);
        this.render(s.settings || {}, p.products || []);
      } catch (err) {
        if (err.status === 401) return;
        this.body.replaceChildren(errorState(err, () => this.load()));
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
        h('label', { class: 'sc-field' }, h('span', { class: 'sc-label' }, 'วิธีชำระเงิน (ต่อท้ายข้อความสรุปออเดอร์)'), pay),
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
        list.replaceChildren(products.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, products.map((p) => {
          const save = async (body) => {
            try {
              const r = await app.api.patch('/api/products/' + p.id, body);
              Object.assign(p, r.product);
              drawProducts();
            } catch (err) { app.toast(err.message, 'err'); drawProducts(); }
          };
          return h('div', { class: 'sc-prod-row' + (p.active === false ? ' sc-off' : '') },
            h('input', { class: 'sc-input', type: 'text', value: p.name, 'aria-label': 'ชื่อสินค้า', onblur: (e) => { const v = e.target.value.trim(); if (v && v !== p.name) save({ name: v }); } }),
            h('input', { class: 'sc-input sc-num', type: 'number', min: '0', step: 'any', value: p.price, 'aria-label': 'ราคา', onblur: (e) => { const v = num(e.target.value); if (v !== num(p.price)) save({ price: v }); } }),
            h('button', { type: 'button', class: 'sc-btn sc-small' + (p.active === false ? '' : ' sc-ghost'), onclick: () => save({ active: p.active === false }) }, p.active === false ? 'เปิดขาย' : 'ปิด'));
        })) : h('div', { class: 'sc-muted sc-small' }, 'ยังไม่มีสินค้า เพิ่มรายการแรกด้านล่าง'));
      };
      drawProducts();
      const newName = h('input', { class: 'sc-input', type: 'text', placeholder: 'ชื่อสินค้าใหม่', 'aria-label': 'ชื่อสินค้าใหม่', 'data-sc': 'prod-name' });
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
          app.toast('เพิ่มสินค้าแล้ว', 'ok');
        } catch (err) { app.toast(err.message, 'err'); }
      };
      const catalog = section('สินค้า / บริการ', null,
        h('form', { class: 'sc-prod-row', onsubmit: (e) => { e.preventDefault(); addProduct(); } },
          newName, newPrice, h('button', { type: 'submit', class: 'sc-btn sc-small sc-primary', 'data-sc': 'prod-add' }, icon('plus'), 'เพิ่ม')),
        list);

      this.body.replaceChildren(account, shop, catalog);
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
    }

    start() {
      this.root.classList.add('sc-root', 'sc-mode-' + this.mode);
      this.root.replaceChildren();
      this.topbar = h('header', { class: 'sc-topbar' });
      this.main = h('main', { class: 'sc-main' });
      this.toasts = h('div', { class: 'sc-toasts', 'aria-live': 'polite' });
      this.root.append(this.topbar, this.main, this.toasts);
      this.api.onUnauthorized = (err) => this.showConfig(err && err.message);
      this.renderTopbar();
      if (!this.api.isConfigured()) this.showConfig();
      else this.boot();
    }

    async boot() {
      this.main.replaceChildren(skeleton());
      try {
        const r = await this.api.get('/api/me');
        this.me = r.staff;
        this.afterBoot();
      } catch (err) {
        if (err.status === 401) return; // config screen already shown by the hook
        this.main.replaceChildren(h('div', { class: 'sc-view' }, errorState(err, () => this.boot()),
          h('div', { style: 'text-align:center' }, h('button', { type: 'button', class: 'sc-btn sc-small sc-ghost', onclick: () => this.showConfig() }, 'ตั้งค่าการเชื่อมต่อ'))));
      }
    }

    afterBoot() {
      this.configOpen = false;
      this.clearStack();
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
      this.main.replaceChildren(v ? v.el : '');
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
      const brand = h('div', { class: 'sc-brand' }, h('b', null, 'Sidecar'), h('span', null, this.me ? this.me.name : ''));
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
      this.topbar.replaceChildren(...kids);
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
      this.toasts.append(el);
      while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
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

  global.SidecarUI = { mount, createApi, ApiError, localStore, copyText, calcTotals, STAGES };
})(typeof window !== 'undefined' ? window : globalThis);
