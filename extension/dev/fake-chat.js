/* Dev-only helpers for fake-chat.html. Never shipped in the extension's runtime path. */

// ---- a minimal `chrome` object so content.js runs on a normal web page ----
(function () {
  var parse = function (raw) { try { return raw == null ? undefined : JSON.parse(raw); } catch (_) { return undefined; } };
  window.chrome = {
    runtime: { id: 'sidecar-dev', getURL: function (p) { return location.origin + '/extension/' + p; } },
    storage: {
      local: {
        get: function (keys) {
          var out = {};
          keys.forEach(function (k) { var v = parse(localStorage.getItem(k)); if (v !== undefined) out[k] = v; });
          return Promise.resolve(out);
        },
        set: function (obj) {
          Object.keys(obj).forEach(function (k) { localStorage.setItem(k, JSON.stringify(obj[k])); });
          return Promise.resolve();
        },
      },
    },
  };
})();

// ---- tiny single-page chat console ----
(function () {
  var OA = 'Ufakeoa';
  var CHATS = [
    { id: 'U1001', name: 'Ploy 🌸', last: '[รูปภาพ]', msgs: [['in', 'ขอมัดจำก่อน 3000 ได้ไหมคะ เสาร์นี้ไปรับ'], ['out', 'ได้เลยค่ะ เดี๋ยวแอดมินสรุปยอดให้นะคะ'], ['in', '[ส่งรูปสลิป]']] },
    { id: 'U1002', name: 'Bank Thanakorn', last: 'iPhone 14 มีสีอะไรบ้างครับ', msgs: [['in', 'สวัสดีครับ'], ['in', 'iPhone 14 มีสีอะไรบ้างครับ']] },
    { id: 'U1003', name: 'มายด์', last: 'ขอคิดดูก่อนนะคะ', msgs: [['in', 'MacBook Air M2 ผ่อนได้กี่เดือนคะ'], ['in', 'ขอคิดดูก่อนนะคะ']] },
    { id: 'U1004', name: 'Kittipong S.', last: 'ลดได้อีกไหมครับ', msgs: [['in', 'ลดได้อีกไหมครับ']] },
    { id: 'Cchat9999', name: 'น้ำฝน Namfon', last: 'Apple Watch 45mm มีไหมคะ', msgs: [['in', 'Apple Watch 45mm มีไหมคะ']] },
    { id: 'Unobody', name: 'ลูกค้าเก่าก่อนติดตั้ง', last: '(แชทเก่า)', msgs: [['in', 'แชทนี้เกิดก่อนเชื่อม Sidecar']] },
  ];
  var list = document.getElementById('list');
  var nameEl = document.getElementById('chatName');
  var idEl = document.getElementById('chatId');
  var msgs = document.getElementById('msgs');
  var composer = document.getElementById('composer');

  function current() {
    var m = /\/chat\/([^/?#]+)/.exec(location.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function bubble(dir, text) {
    var b = document.createElement('div');
    b.className = 'bubble' + (dir === 'out' ? ' out' : '');
    b.textContent = text;
    msgs.append(b);
  }
  function render() {
    var id = current();
    list.textContent = '';
    CHATS.forEach(function (c) {
      var a = document.createElement('a');
      a.className = 'item' + (c.id === id ? ' active' : '');
      a.href = '/' + OA + '/chat/' + c.id;
      a.dataset.chat = c.id;
      var pic = document.createElement('span'); pic.className = 'pic'; pic.textContent = Array.from(c.name)[0];
      var box = document.createElement('div');
      var h = document.createElement('h6'); h.className = 'name'; h.textContent = c.name;
      var p = document.createElement('p'); p.textContent = c.last;
      box.append(h, p); a.append(pic, box);
      a.addEventListener('click', function (e) { e.preventDefault(); history.pushState({}, '', a.href); render(); });
      list.append(a);
    });
    var chat = CHATS.find(function (c) { return c.id === id; });
    msgs.textContent = '';
    composer.value = '';
    if (!chat) {
      nameEl.textContent = '';
      idEl.textContent = '';
      var e = document.createElement('div'); e.className = 'empty'; e.textContent = 'เลือกแชททางซ้าย';
      msgs.append(e);
      return;
    }
    nameEl.textContent = chat.name;
    idEl.textContent = chat.id;
    chat.msgs.forEach(function (m) { bubble(m[0], m[1]); });
  }
  document.getElementById('send').addEventListener('click', function () {
    var t = composer.value.trim();
    if (!t) return;
    bubble('out', t);
    composer.value = '';
    msgs.scrollTop = msgs.scrollHeight;
  });
  window.addEventListener('popstate', render);
  render();
})();
