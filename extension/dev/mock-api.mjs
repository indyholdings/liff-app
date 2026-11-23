// Sidecar mock API + static file server for UI development and the smoke test.
// Node built-ins only. In-memory. Implements the routes in docs/sidecar-contract.md.
//
//   node extension/dev/mock-api.mjs            → http://localhost:8790
//   open http://localhost:8790/Ufakeoa/chat/U1001   (stand-in for chat.line.biz)
//   open http://localhost:8790/staff.html           (mobile staff page)
//   API URL http://localhost:8790 · staff token "demo-token" · admin key "demo-admin"

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
export const DEMO_TOKEN = 'demo-token';
export const DEMO_ADMIN_KEY = 'demo-admin';
export const DEMO_ID_TOKEN = 'demo-id-token';

const STAGES = ['new', 'interested', 'quoted', 'awaiting_payment', 'paid', 'booked', 'won', 'lost', 'spam'];
const LOCKABLE = ['full_name', 'phone', 'address', 'postcode', 'stage'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- demo media (inline SVG)
const svgUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const FONT = "font-family='Sarabun,Noto Sans Thai,Thonburi,sans-serif'";

function slipSvg({ amount, bank, time, ref, to }) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='360' height='520' viewBox='0 0 360 520'>
<rect width='360' height='520' fill='#eef2f6'/><rect x='18' y='18' width='324' height='484' rx='18' fill='#fff' stroke='#d5dbe3'/>
<rect x='18' y='18' width='324' height='84' rx='18' fill='#11845b'/><rect x='18' y='70' width='324' height='32' fill='#11845b'/>
<circle cx='58' cy='60' r='18' fill='#fff'/><path d='M49 60l6 6 12-13' stroke='#11845b' stroke-width='4' fill='none' stroke-linecap='round' stroke-linejoin='round'/>
<text x='88' y='55' ${FONT} font-size='20' font-weight='700' fill='#fff'>โอนเงินสำเร็จ</text>
<text x='88' y='78' ${FONT} font-size='13' fill='#d6f3e6'>${bank}</text>
<text x='40' y='150' ${FONT} font-size='13' fill='#6b7480'>จำนวนเงิน</text>
<text x='40' y='192' ${FONT} font-size='36' font-weight='700' fill='#1b1f24'>${amount} บาท</text>
<line x1='40' y1='220' x2='320' y2='220' stroke='#e2e6eb'/>
<text x='40' y='256' ${FONT} font-size='13' fill='#6b7480'>ไปยัง</text><text x='40' y='280' ${FONT} font-size='16' fill='#1b1f24'>${to}</text>
<text x='40' y='324' ${FONT} font-size='13' fill='#6b7480'>วันที่ทำรายการ</text><text x='40' y='348' ${FONT} font-size='16' fill='#1b1f24'>${time}</text>
<text x='40' y='392' ${FONT} font-size='13' fill='#6b7480'>เลขที่อ้างอิง</text><text x='40' y='416' font-family='monospace' font-size='15' fill='#1b1f24'>${ref}</text>
<rect x='250' y='420' width='64' height='64' fill='#fff' stroke='#1b1f24' stroke-width='3'/><path d='M262 432h12v12h-12zM290 432h12v12h-12zM262 460h12v12h-12zM282 452h8v8h-8zM294 464h8v8h-8z' fill='#1b1f24'/>
</svg>`);
}

function phoneSvg({ body, accent, label }) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${accent}'/><stop offset='1' stop-color='#f6f7f9'/></linearGradient></defs>
<rect width='400' height='400' fill='url(#g)'/>
<rect x='130' y='50' width='140' height='290' rx='26' fill='${body}'/><rect x='138' y='58' width='124' height='274' rx='20' fill='#10141a'/>
<rect x='148' y='70' width='52' height='52' rx='14' fill='${body}'/><circle cx='164' cy='86' r='8' fill='#0a0d11'/><circle cx='184' cy='106' r='8' fill='#0a0d11'/><circle cx='164' cy='106' r='4' fill='#3a4654'/>
<rect x='20' y='352' width='360' height='32' rx='8' fill='rgba(16,20,26,.78)'/><text x='200' y='374' ${FONT} font-size='15' fill='#fff' text-anchor='middle'>${label}</text>
</svg>`);
}

function docSvg(label) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='420' height='270' viewBox='0 0 420 270'>
<rect width='420' height='270' rx='16' fill='#dfe9f5'/><rect x='14' y='14' width='392' height='242' rx='12' fill='#f8fbff' stroke='#9db4d0'/>
<rect x='34' y='70' width='96' height='120' rx='6' fill='#c9d7e8'/><circle cx='82' cy='112' r='22' fill='#9db4d0'/><path d='M46 186c6-30 66-30 72 0z' fill='#9db4d0'/>
<text x='34' y='48' ${FONT} font-size='17' font-weight='700' fill='#2a4365'>${label}</text>
<rect x='150' y='78' width='220' height='14' rx='4' fill='#c9d7e8'/><rect x='150' y='106' width='170' height='14' rx='4' fill='#c9d7e8'/><rect x='150' y='134' width='200' height='14' rx='4' fill='#c9d7e8'/><rect x='150' y='162' width='120' height='14' rx='4' fill='#c9d7e8'/>
<text x='210' y='232' ${FONT} font-size='13' fill='#7b8da3' text-anchor='middle'>ภาพตัวอย่างสำหรับทดสอบ (ไม่ใช่เอกสารจริง)</text>
</svg>`);
}

const avatarSvg = (bg, ch) => svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='${bg}'/><text x='48' y='62' ${FONT} font-size='42' font-weight='700' fill='#fff' text-anchor='middle'>${ch}</text></svg>`);

// ---------------------------------------------------------------- seed
function seed() {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const ahead = (min) => new Date(now + min * 60000).toISOString();
  let seq = 100;
  const id = () => ++seq;

  const db = {
    staff: [
      { id: 1, name: 'ริต้า', role: 'admin', token: DEMO_TOKEN, line_user_id: null },
      { id: 2, name: 'เจมส์', role: 'agent', token: 'demo-token-james', line_user_id: null },
    ],
    settings: {
      shop_name: 'JAIFU Solutions',
      payment_instructions: 'โอนเข้าบัญชี กสิกรไทย 123-4-56789-0\nชื่อบัญชี บจก. ใจฟู โซลูชั่นส์\nโอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ 🙏',
    },
    products: [
      { id: 1, sku: 'IP15P-256-NT', name: 'iPhone 15 Pro 256GB Natural Titanium (มือสอง 98%)', price: 32900, category: 'iPhone', active: true },
      { id: 2, sku: 'IP14-128-BL', name: 'iPhone 14 128GB Blue (มือสอง 95%)', price: 18900, category: 'iPhone', active: true },
      { id: 3, sku: 'IP13-128-MN', name: 'iPhone 13 128GB Midnight (มือสอง 95%)', price: 14500, category: 'iPhone', active: true },
      { id: 4, sku: 'MBA-M2-256', name: 'MacBook Air M2 13" 8/256GB (มือสอง 97%)', price: 27900, category: 'Mac', active: true },
      { id: 5, sku: 'IPA5-64', name: 'iPad Air 5 Wi-Fi 64GB (มือสอง 96%)', price: 15900, category: 'iPad', active: true },
      { id: 6, sku: 'APP2', name: 'AirPods Pro 2 USB-C (มือสอง)', price: 5990, category: 'อุปกรณ์เสริม', active: true },
      { id: 7, sku: 'AW9-45', name: 'Apple Watch Series 9 45mm GPS (มือสอง)', price: 9900, category: 'Watch', active: true },
      { id: 8, sku: 'ACC-FILM', name: 'ฟิล์มกระจกเต็มจอ', price: 290, category: 'อุปกรณ์เสริม', active: true },
      { id: 9, sku: 'ACC-CASE', name: 'เคสใส MagSafe', price: 590, category: 'อุปกรณ์เสริม', active: true },
      { id: 10, sku: 'IPSE3', name: 'iPhone SE 3 64GB (หมดสต็อก)', price: 7900, category: 'iPhone', active: false },
    ],
    leads: [],
    notes: [],
    media: [],
    orders: [],
    messages: [],
    id,
  };

  const lead = (o) => {
    const l = Object.assign({
      id: id(), chat_id: null, display_name: null, picture_url: null, full_name: null, phone: null, address: null, postcode: null,
      stage: 'new', tags: [], interests: [], assignee_id: null, ai_summary: null, next_action: null, suggested_reply: null,
      follow_up_at: null, locked_fields: [], last_message_at: ago(5), last_message_preview: null, created_at: ago(3000), updated_at: ago(5),
    }, o);
    db.leads.push(l);
    return l;
  };
  const note = (lead_id, kind, body, min, author, pinned) => db.notes.push({ id: id(), lead_id, body, kind, author_name: author || (kind === 'ai' ? 'Sidecar Agent' : null), pinned: !!pinned, created_at: ago(min) });
  const msg = (lead_id, direction, text, min, type) => db.messages.push({ id: id(), lead_id, direction, type: type || 'text', text: type && type !== 'text' ? null : text, media_id: null, sent_at: ago(min) });
  const media = (lead_id, category, url, min, caption, slip) => db.media.push({ id: id(), lead_id, url, category, caption: caption || null, slip: slip || null, created_at: ago(min) });

  // 1) hot lead waiting for a deposit — the main demo chat
  const ploy = lead({
    line_user_id: 'U1001', display_name: 'Ploy 🌸', picture_url: avatarSvg('#e58fb1', 'P'),
    full_name: 'พลอยไพลิน ศรีสุข', phone: '0812345678', address: '88/12 ซ.ลาดพร้าว 71 แขวงสะพานสอง เขตวังทองหลาง กรุงเทพมหานคร', postcode: '10310',
    stage: 'awaiting_payment', tags: ['ลูกค้า IG'], interests: ['iPhone 15 Pro 256GB', 'ผ่อน 0%'], assignee_id: 1,
    ai_summary: 'สนใจ iPhone 15 Pro 256GB สี Natural Titanium ตกลงราคา 32,900 พร้อมฟิล์ม ขอวางมัดจำ 3,000 แล้วมารับเครื่องวันเสาร์',
    next_action: 'ตรวจยอดมัดจำ 3,000 บาทในบัญชี แล้วกดยืนยันชำระและนัดเวลารับเครื่อง',
    suggested_reply: 'ได้รับสลิปมัดจำ 3,000 บาทแล้วนะคะคุณพลอย 🙏 แอดมินล็อกเครื่อง iPhone 15 Pro 256GB ไว้ให้เรียบร้อยค่ะ สะดวกเข้ามารับวันเสาร์ช่วงกี่โมงดีคะ',
    follow_up_at: ago(40), last_message_at: ago(6), last_message_preview: '[รูปภาพ]', locked_fields: ['phone'],
  });
  msg(ploy.id, 'in', 'สวัสดีค่ะ iPhone 15 Pro 256 สีธรรมชาติยังมีไหมคะ', 190);
  msg(ploy.id, 'in', 'ราคาเท่าไหร่ ผ่อนได้ไหมคะ', 189);
  msg(ploy.id, 'in', 'โอเคค่ะ เอาเครื่องนี้ พร้อมฟิล์มด้วยนะคะ', 120);
  msg(ploy.id, 'in', 'ชื่อ พลอยไพลิน ศรีสุข เบอร์ 081-234-5678 ค่ะ', 118);
  msg(ploy.id, 'in', 'ขอมัดจำก่อน 3000 ได้ไหมคะ เสาร์นี้ไปรับ', 60);
  msg(ploy.id, 'in', null, 6, 'image');
  note(ploy.id, 'ai', 'ลูกค้าตกลงซื้อ iPhone 15 Pro 256GB + ฟิล์มกระจก ขอมัดจำ 3,000 บาท นัดรับเครื่องวันเสาร์', 58);
  note(ploy.id, 'staff', 'ลูกค้าขอให้เช็กแบตก่อนส่งมอบ ต้องได้ 90% ขึ้นไป', 50, 'ริต้า', true);
  note(ploy.id, 'system', 'ได้รับสลิป ยอด 3,000 บาท ตรงกับมัดจำของออเดอร์ — รอแอดมินยืนยัน', 6);
  note(ploy.id, 'staff', 'เจมส์เตรียมเครื่อง + กล่อง + ใบรับประกันไว้ที่เคาน์เตอร์แล้ว', 30, 'เจมส์');
  media(ploy.id, 'slip', slipSvg({ amount: '3,000.00', bank: 'ธนาคารกสิกรไทย', time: 'วันนี้ 14:02 น.', ref: '0152 3301 8842 AB', to: 'บจก. ใจฟู โซลูชั่นส์' }), 6, 'สลิปมัดจำ',
    { amount: 3000, paid_at: ago(8), bank: 'กสิกรไทย', ref: '015233018842AB', matches_order: true });
  media(ploy.id, 'product', phoneSvg({ body: '#b9b2a6', accent: '#e9e3d8', label: 'iPhone 15 Pro · Natural Titanium' }), 185, 'รูปที่ลูกค้าส่งมาถามสี');
  media(ploy.id, 'product', phoneSvg({ body: '#3b4252', accent: '#d7dce6', label: 'iPhone 15 Pro · Blue Titanium' }), 184, null);
  media(ploy.id, 'document', docSvg('บัตรประชาชน (ตัวอย่าง)'), 100, 'เอกสารประกอบผ่อน');
  media(ploy.id, 'other', phoneSvg({ body: '#d9c7b0', accent: '#f3ebe0', label: 'ภาพอื่นๆ' }), 90, null);
  db.orders.push({
    id: id(), lead_id: ploy.id, status: 'awaiting_payment',
    items: [{ id: id(), product_id: 1, name: db.products[0].name, qty: 1, unit_price: 32900 }, { id: id(), product_id: 8, name: 'ฟิล์มกระจกเต็มจอ', qty: 1, unit_price: 290 }],
    discount: 290, shipping_fee: 0, payment_method: 'transfer', deposit_amount: 3000, note: 'นัดรับหน้าร้านวันเสาร์', created_at: ago(57), updated_at: ago(57), staff_edited: true,
  });

  // 2) same phone as Ploy → "returning customer" notice
  lead({ line_user_id: 'U1006', display_name: 'Ploy (เครื่องเก่า)', full_name: 'พลอยไพลิน ศรีสุข', phone: '0812345678', stage: 'won', interests: ['ขาย iPhone 12'], last_message_at: ago(60 * 24 * 40), last_message_preview: 'ขอบคุณค่ะ ได้รับเงินแล้ว', ai_summary: 'เคยขายฝาก iPhone 12 เมื่อเดือนก่อน ปิดดีลเรียบร้อย' });

  const bank = lead({ line_user_id: 'U1002', display_name: 'Bank Thanakorn', picture_url: avatarSvg('#4f7cc9', 'B'), stage: 'new', interests: ['iPhone 14'], last_message_at: ago(2), last_message_preview: 'iPhone 14 มีสีอะไรบ้างครับ', ai_summary: 'เพิ่งทักเข้ามาถามสี iPhone 14 ยังไม่ให้ชื่อและเบอร์', next_action: 'ตอบสีที่มี พร้อมขอชื่อและเบอร์เพื่อเปิดออเดอร์', suggested_reply: 'iPhone 14 128GB ตอนนี้มีสี Blue กับ Midnight ครับ สภาพ 95% ราคา 18,900 บาท สนใจสีไหนดีครับ' });
  msg(bank.id, 'in', 'สวัสดีครับ', 3);
  msg(bank.id, 'in', 'iPhone 14 มีสีอะไรบ้างครับ', 2);

  lead({ line_user_id: 'U1003', display_name: 'มายด์', picture_url: avatarSvg('#8a63d2', 'ม'), full_name: 'ณัฐธิดา แก้วมณี', phone: '0898887766', stage: 'interested', interests: ['MacBook Air M2', 'ผ่อนบัตรเครดิต'], assignee_id: 2, last_message_at: ago(75), last_message_preview: 'ขอคิดดูก่อนนะคะ', ai_summary: 'ถามราคา MacBook Air M2 และเงื่อนไขผ่อนบัตร ยังลังเลเรื่องความจุ 256GB', next_action: 'ส่งตารางผ่อน 10 เดือน และแจ้งว่ามีเครื่อง 512GB เข้าใหม่', follow_up_at: ahead(180) });
  lead({ line_user_id: 'U1004', display_name: 'Kittipong S.', full_name: 'กิตติพงษ์ สายทอง', phone: '0865551234', stage: 'quoted', interests: ['iPad Air 5'], assignee_id: 1, last_message_at: ago(60 * 26), last_message_preview: 'ลดได้อีกไหมครับ', ai_summary: 'เสนอราคา iPad Air 5 ไป 15,900 ลูกค้าต่อราคา', next_action: 'เสนอแถมฟิล์ม+เคสแทนการลดราคา', follow_up_at: ago(60 * 2) });
  lead({ line_user_id: 'U1005', display_name: 'Nok Nok 🐥', picture_url: avatarSvg('#e0a13a', 'N'), full_name: 'ชนกนันท์ ใจดี', phone: '0823334455', stage: 'paid', interests: ['AirPods Pro 2'], last_message_at: ago(60 * 5), last_message_preview: 'โอนแล้วนะคะ ส่งวันไหนคะ', ai_summary: 'ชำระค่า AirPods Pro 2 ครบแล้ว รอจัดส่ง EMS', next_action: 'แจ้งเลขพัสดุเมื่อส่งของ' });
  lead({ line_user_id: 'U1007', display_name: 'Ton', stage: 'lost', last_message_at: ago(60 * 24 * 6), last_message_preview: 'ไม่เป็นไรครับ ไว้คราวหน้า', ai_summary: 'ราคาเกินงบ ลูกค้าขอผ่านรอบนี้' });
  lead({ line_user_id: 'U1008', display_name: 'ปล่อยกู้ด่วน 24ชม', stage: 'spam', last_message_at: ago(60 * 24 * 2), last_message_preview: 'สนใจเงินด่วนไหมคะ อนุมัติไว' });
  lead({ line_user_id: 'U1009', display_name: 'Aom Siriporn', full_name: 'ศิริพร อ่อนละมัย', phone: '0891112233', stage: 'booked', interests: ['ขายฝาก MacBook Pro'], assignee_id: 2, last_message_at: ago(60 * 9), last_message_preview: 'พรุ่งนี้ 11 โมงเจอกันค่ะ', ai_summary: 'นัดนำ MacBook Pro 14" มาประเมินราคาขายฝากพรุ่งนี้ 11:00', next_action: 'เตรียมเอกสารสัญญาขายฝาก', follow_up_at: ahead(60 * 14) });

  // A customer whose OA Manager chat id differs from the Messaging API user id → link by hand.
  const fon = lead({ line_user_id: 'U2001', display_name: 'น้ำฝน Namfon', picture_url: avatarSvg('#2f9e8f', 'น'), full_name: null, phone: '0844445566', stage: 'interested', interests: ['Apple Watch S9'], last_message_at: ago(20), last_message_preview: 'Apple Watch 45mm มีไหมคะ', ai_summary: 'ถามหา Apple Watch Series 9 ขนาด 45mm', next_action: 'ส่งรูปเครื่องจริงและราคา' });
  msg(fon.id, 'in', 'Apple Watch 45mm มีไหมคะ', 20);

  return db;
}

// ---------------------------------------------------------------- helpers
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normPhone = (p) => {
  if (p == null || p === '') return null;
  let d = String(p).replace(/[^0-9+]/g, '');
  if (d.startsWith('+66')) d = '0' + d.slice(3);
  else if (d.startsWith('66') && d.length >= 11) d = '0' + d.slice(2);
  return d.replace(/\D/g, '') || null;
};
const money = (n) => round2(n).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (m) => new HttpError(400, 'bad_request', m);
const notFound = (m) => new HttpError(404, 'not_found', m || 'not found');

export function createMockApp() {
  const db = seed();
  const now = () => new Date().toISOString();

  const viewLead = (l) => {
    const s = db.staff.find((x) => x.id === l.assignee_id);
    return { ...l, assignee_name: s ? s.name : null };
  };
  const lite = (l) => ({ id: l.id, display_name: l.display_name, full_name: l.full_name, phone: l.phone, picture_url: l.picture_url, stage: l.stage, last_message_at: l.last_message_at });
  const viewOrder = (o) => {
    if (!o) return null;
    const subtotal = round2(o.items.reduce((s, it) => s + it.qty * it.unit_price, 0));
    const { staff_edited, ...rest } = o;
    return { ...rest, subtotal, total: round2(subtotal - o.discount + o.shipping_fee) };
  };
  const openOrder = (leadId) => db.orders.filter((o) => o.lead_id === leadId && (o.status === 'draft' || o.status === 'awaiting_payment')).sort((a, b) => b.id - a.id)[0];
  const bundleOrder = (leadId) => openOrder(leadId) || db.orders.filter((o) => o.lead_id === leadId).sort((a, b) => b.id - a.id)[0] || null;
  const getLead = (id) => {
    const l = db.leads.find((x) => x.id === Number(id));
    if (!l) throw notFound('lead not found');
    return l;
  };
  const rematchSlips = (leadId) => {
    const o = viewOrder(openOrder(leadId));
    for (const m of db.media) {
      if (m.lead_id !== leadId || m.category !== 'slip' || !m.slip) continue;
      m.slip.matches_order = !o || m.slip.amount == null ? null : (m.slip.amount === o.total || (o.deposit_amount != null && m.slip.amount === o.deposit_amount));
    }
  };
  const bundle = (l, match) => ({
    ok: true,
    lead: l ? viewLead(l) : null,
    match,
    candidates: [],
    notes: l ? db.notes.filter((n) => n.lead_id === l.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : [],
    media: l ? db.media.filter((m) => m.lead_id === l.id).sort((a, b) => b.created_at.localeCompare(a.created_at)) : [],
    order: l ? viewOrder(bundleOrder(l.id)) : null,
    messages: l ? db.messages.filter((m) => m.lead_id === l.id).sort((a, b) => a.sent_at.localeCompare(b.sent_at)).slice(-30) : [],
    same_phone: l && l.phone ? db.leads.filter((x) => x.id !== l.id && x.phone === l.phone).map(lite) : [],
  });

  function auth(req) {
    const h = req.headers;
    const bearer = /^Bearer\s+(.+)$/i.exec(h.authorization || '');
    if (bearer) {
      const s = db.staff.find((x) => x.token === bearer[1].trim());
      if (s) return s;
    }
    const idt = h['x-line-id-token'];
    if (idt === DEMO_ID_TOKEN && !bearer) {
      const s = db.staff.find((x) => x.line_user_id === 'Ustaffdemo');
      if (s) return s;
    }
    throw new HttpError(401, 'unauthorized', 'invalid or missing staff token');
  }
  const staffView = (s) => ({ id: s.id, name: s.name, role: s.role });

  function summaryText(l) {
    const o = viewOrder(bundleOrder(l.id));
    if (!o) throw bad('lead has no order');
    const lines = ['สรุปรายการสั่งซื้อ — ' + db.settings.shop_name, ''];
    lines.push('คุณ ' + (l.full_name || l.display_name || 'ลูกค้า'));
    if (l.phone) lines.push('เบอร์ ' + l.phone);
    if (l.address) lines.push('ที่อยู่ ' + l.address + (l.postcode ? ' ' + l.postcode : ''));
    lines.push('');
    o.items.forEach((it, i) => lines.push(`${i + 1}. ${it.name} × ${it.qty} = ${money(it.qty * it.unit_price)} บาท`));
    lines.push('');
    lines.push('ยอดสินค้า ' + money(o.subtotal) + ' บาท');
    if (o.discount) lines.push('ส่วนลด -' + money(o.discount) + ' บาท');
    if (o.shipping_fee) lines.push('ค่าจัดส่ง ' + money(o.shipping_fee) + ' บาท');
    lines.push('ยอดรวมทั้งหมด ' + money(o.total) + ' บาท');
    if (o.deposit_amount) {
      lines.push('มัดจำ ' + money(o.deposit_amount) + ' บาท');
      lines.push('คงเหลือชำระวันรับสินค้า ' + money(o.total - o.deposit_amount) + ' บาท');
    }
    const pm = { transfer: 'โอนเงิน', cod: 'เก็บเงินปลายทาง', installment: 'ผ่อนชำระ' }[o.payment_method];
    if (pm) lines.push('วิธีชำระ: ' + pm);
    if (o.note) lines.push('หมายเหตุ: ' + o.note);
    if (db.settings.payment_instructions && o.payment_method !== 'cod') lines.push('', db.settings.payment_instructions);
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- routes
  async function api(method, p, url, req, body) {
    if (method === 'GET' && p === '/health') return { ok: true, version: 'mock-0.1.0' };
    if (method === 'POST' && p === '/webhook') return { ok: true };

    if (method === 'POST' && p === '/api/admin/staff') {
      if (req.headers['x-admin-key'] !== DEMO_ADMIN_KEY) throw new HttpError(403, 'forbidden', 'bad admin key');
      if (!body.name) throw bad('name is required');
      const s = { id: db.id(), name: String(body.name), role: body.role === 'admin' ? 'admin' : 'agent', token: 'tok-' + Math.random().toString(36).slice(2), line_user_id: null };
      db.staff.push(s);
      return { ok: true, staff: staffView(s), token: s.token };
    }

    const me = auth(req);
    let m;

    if (method === 'GET' && p === '/api/me') return { ok: true, staff: staffView(me) };

    if (method === 'POST' && p === '/api/staff/link-line') {
      if (req.headers['x-line-id-token'] !== DEMO_ID_TOKEN) throw new HttpError(401, 'unauthorized', 'invalid LINE id token');
      me.line_user_id = 'Ustaffdemo';
      return { ok: true, staff: staffView(me) };
    }

    if (method === 'GET' && p === '/api/leads') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const stage = url.searchParams.get('stage') || '';
      const due = url.searchParams.get('due') === '1';
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const isDue = (l) => !!l.follow_up_at && new Date(l.follow_up_at).getTime() <= Date.now();
      const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
      for (const l of db.leads) counts[l.stage] = (counts[l.stage] || 0) + 1;
      let rows = db.leads.slice();
      if (q) rows = rows.filter((l) => [l.display_name, l.full_name, l.phone].some((v) => v && String(v).toLowerCase().includes(q)));
      if (stage) rows = rows.filter((l) => l.stage === stage);
      if (due) rows = rows.filter(isDue);
      rows.sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')));
      return { ok: true, leads: rows.slice(offset, offset + limit).map(viewLead), counts, due_count: db.leads.filter(isDue).length };
    }

    if (method === 'GET' && (m = /^\/api\/leads\/by-chat\/([^/]+)$/.exec(p))) {
      const chatId = decodeURIComponent(m[1]);
      const l = db.leads.find((x) => x.line_user_id === chatId) || db.leads.find((x) => x.chat_id === chatId);
      if (l) return bundle(l, 'chat_id');
      const name = (url.searchParams.get('name') || '').trim();
      const b = bundle(null, 'none');
      if (name) b.candidates = db.leads.filter((x) => x.display_name === name).map(lite);
      return b;
    }

    if ((m = /^\/api\/leads\/(\d+)$/.exec(p))) {
      const l = getLead(m[1]);
      if (method === 'GET') return bundle(l, 'id');
      if (method === 'PATCH') {
        const allowed = ['full_name', 'phone', 'address', 'postcode', 'stage', 'tags', 'interests', 'assignee_id', 'follow_up_at'];
        for (const k of Object.keys(body)) {
          if (!allowed.includes(k)) continue;
          let v = body[k];
          if (k === 'stage' && !STAGES.includes(v)) throw bad('unknown stage');
          if (k === 'phone') v = normPhone(v);
          if ((k === 'tags' || k === 'interests') && !Array.isArray(v)) throw bad(k + ' must be an array');
          if (k === 'assignee_id' && v != null && !db.staff.some((s) => s.id === v)) throw bad('unknown assignee');
          l[k] = v === '' ? null : v;
          if (LOCKABLE.includes(k) && !l.locked_fields.includes(k)) l.locked_fields.push(k);
        }
        l.updated_at = now();
        return { ok: true, lead: viewLead(l) };
      }
    }

    if (method === 'POST' && (m = /^\/api\/leads\/(\d+)\/link-chat$/.exec(p))) {
      const l = getLead(m[1]);
      if (!body.chat_id) throw bad('chat_id is required');
      for (const other of db.leads) if (other.chat_id === body.chat_id) other.chat_id = null;
      l.chat_id = String(body.chat_id);
      return { ok: true, lead: viewLead(l) };
    }

    if (method === 'POST' && (m = /^\/api\/leads\/(\d+)\/analyze$/.exec(p))) {
      const l = getLead(m[1]);
      await new Promise((r) => setTimeout(r, 350));
      const last = db.messages.filter((x) => x.lead_id === l.id && x.text).slice(-1)[0];
      l.ai_summary = (l.ai_summary || 'ลูกค้าทักเข้ามา').replace(/ \(วิเคราะห์ใหม่.*\)$/, '') + ' (วิเคราะห์ใหม่ ' + new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ')';
      if (!l.next_action) l.next_action = 'ตอบลูกค้าและขอชื่อ เบอร์โทร เพื่อเปิดออเดอร์';
      if (!l.suggested_reply) l.suggested_reply = 'สวัสดีค่ะ ขอบคุณที่ทักมานะคะ' + (last ? ' เรื่อง "' + last.text + '" แอดมินขอเช็กให้สักครู่ค่ะ' : '');
      db.notes.push({ id: db.id(), lead_id: l.id, body: l.ai_summary, kind: 'ai', author_name: 'Sidecar Agent', pinned: false, created_at: now() });
      return bundle(l, 'id');
    }

    if (method === 'POST' && (m = /^\/api\/leads\/(\d+)\/notes$/.exec(p))) {
      const l = getLead(m[1]);
      const text = String(body.body || '').trim();
      if (!text) throw bad('body is required');
      const n = { id: db.id(), lead_id: l.id, body: text, kind: 'staff', author_name: me.name, pinned: !!body.pinned, created_at: now() };
      db.notes.push(n);
      return { ok: true, note: n };
    }

    if (method === 'DELETE' && (m = /^\/api\/notes\/(\d+)$/.exec(p))) {
      const i = db.notes.findIndex((n) => n.id === Number(m[1]));
      if (i < 0) throw notFound('note not found');
      db.notes.splice(i, 1);
      return { ok: true };
    }

    if (method === 'PATCH' && (m = /^\/api\/media\/(\d+)$/.exec(p))) {
      const md = db.media.find((x) => x.id === Number(m[1]));
      if (!md) throw notFound('media not found');
      if ('category' in body) {
        if (!['slip', 'product', 'before_after', 'document', 'other'].includes(body.category)) throw bad('unknown category');
        md.category = body.category;
      }
      if ('caption' in body) md.caption = body.caption ? String(body.caption) : null;
      return { ok: true, media: md };
    }

    if (method === 'PUT' && (m = /^\/api\/leads\/(\d+)\/order$/.exec(p))) {
      const l = getLead(m[1]);
      if (!Array.isArray(body.items) || !body.items.length) throw bad('items are required');
      let o = openOrder(l.id);
      if (!o) {
        o = { id: db.id(), lead_id: l.id, status: 'draft', items: [], discount: 0, shipping_fee: 0, payment_method: null, deposit_amount: null, note: null, created_at: now(), updated_at: now() };
        db.orders.push(o);
      }
      o.items = body.items.map((it) => {
        if (!it.name || !(Number(it.qty) > 0)) throw bad('each item needs a name and qty > 0');
        return { id: db.id(), product_id: it.product_id == null ? null : Number(it.product_id), name: String(it.name), qty: round2(it.qty), unit_price: round2(it.unit_price) };
      });
      o.discount = round2(body.discount);
      o.shipping_fee = round2(body.shipping_fee);
      o.payment_method = ['transfer', 'cod', 'installment'].includes(body.payment_method) ? body.payment_method : null;
      o.deposit_amount = body.deposit_amount == null || body.deposit_amount === '' ? null : round2(body.deposit_amount);
      o.note = body.note ? String(body.note) : null;
      o.staff_edited = true;
      o.updated_at = now();
      rematchSlips(l.id);
      return { ok: true, order: viewOrder(o) };
    }

    if (method === 'POST' && (m = /^\/api\/orders\/(\d+)\/status$/.exec(p))) {
      const o = db.orders.find((x) => x.id === Number(m[1]));
      if (!o) throw notFound('order not found');
      if (!['draft', 'awaiting_payment', 'paid', 'cancelled'].includes(body.status)) throw bad('unknown status');
      o.status = body.status;
      o.updated_at = now();
      const l = getLead(o.lead_id);
      if ((o.status === 'awaiting_payment' || o.status === 'paid') && !l.locked_fields.includes('stage')) l.stage = o.status;
      db.notes.push({ id: db.id(), lead_id: l.id, body: 'ออเดอร์ #' + o.id + ' → ' + o.status + ' โดย ' + me.name, kind: 'system', author_name: null, pinned: false, created_at: now() });
      return { ok: true, order: viewOrder(o), lead: viewLead(l) };
    }

    if (method === 'GET' && (m = /^\/api\/leads\/(\d+)\/summary$/.exec(p))) {
      return { ok: true, text: summaryText(getLead(m[1])) };
    }

    if (p === '/api/products') {
      if (method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const rows = db.products.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.sku || '').toLowerCase().includes(q));
        return { ok: true, products: rows };
      }
      if (method === 'POST') {
        if (!body.name) throw bad('name is required');
        const pr = { id: db.id(), sku: body.sku || null, name: String(body.name), price: round2(body.price), category: body.category || null, active: true };
        db.products.unshift(pr);
        return { ok: true, product: pr };
      }
    }
    if (method === 'PATCH' && (m = /^\/api\/products\/(\d+)$/.exec(p))) {
      const pr = db.products.find((x) => x.id === Number(m[1]));
      if (!pr) throw notFound('product not found');
      if ('name' in body) pr.name = String(body.name);
      if ('price' in body) pr.price = round2(body.price);
      if ('category' in body) pr.category = body.category || null;
      if ('active' in body) pr.active = !!body.active;
      return { ok: true, product: pr };
    }

    if (p === '/api/settings') {
      if (method === 'GET') return { ok: true, settings: { ...db.settings } };
      if (method === 'PUT') {
        if (me.role !== 'admin') throw new HttpError(403, 'forbidden', 'admin only');
        if ('shop_name' in body) db.settings.shop_name = String(body.shop_name || '');
        if ('payment_instructions' in body) db.settings.payment_instructions = String(body.payment_instructions || '');
        return { ok: true, settings: { ...db.settings } };
      }
    }

    throw notFound('no such route: ' + method + ' ' + p);
  }

  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-line-id-token, x-admin-key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  };

  function serveStatic(pathname, res) {
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    // Anything shaped like an OA Manager chat URL gets the stand-in page.
    let rel = /^\/U[^/]*(\/chat(\/[^/]*)?)?\/?$/.test(pathname) || pathname === '/' ? 'extension/dev/fake-chat.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(REPO_ROOT, rel);
    const inside = file === REPO_ROOT || file.startsWith(REPO_ROOT + path.sep);
    const hidden = rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');
    if (!inside || hidden || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    let p = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/sidecar(?=\/|$)/, '') || '/';
    const isApi = p === '/health' || p === '/webhook' || p.startsWith('/api/');
    if (!isApi) { serveStatic(url.pathname, res); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    const send = (status, obj) => {
      res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    try {
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) { try { body = JSON.parse(raw); } catch { throw bad('invalid JSON'); } }
        if (!body || typeof body !== 'object') throw bad('body must be an object');
      }
      send(200, await api(req.method, p, url, req, body));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { ok: false, error: err.code, message: err.message });
      else { console.error(err); send(500, { ok: false, error: 'internal', message: 'mock server error' }); }
    }
  }

  return { handle, db };
}

export function startMockServer(port = 0) {
  const app = createMockApp();
  const server = http.createServer((req, res) => { app.handle(req, res); });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const url = 'http://localhost:' + server.address().port;
      resolve({ url, app, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startMockServer(Number(process.env.PORT) || 8790);
  console.log('Sidecar mock running');
  console.log('  fake LINE OA chat : ' + url + '/Ufakeoa/chat/U1001');
  console.log('  mobile staff page : ' + url + '/staff.html');
  console.log('  API URL           : ' + url + '   token: ' + DEMO_TOKEN);
}
