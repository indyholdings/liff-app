// Sidecar mock API + static file server for UI development and the smoke test.
// Node built-ins only. In-memory. Implements the routes in docs/sidecar-contract.md.
//
//   node extension/dev/mock-api.mjs            → http://localhost:8790
//   PROFILE=real_estate node extension/dev/mock-api.mjs   → Globallink Estate demo data
//   ROOT=dist/globallink …                      → serve a branded build instead of the repo
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

// ---------------------------------------------------------------- profiles (GET /api/config)
const PROFILES = {
  retail: {
    profile: 'retail',
    stages: [
      { key: 'new', label: 'ใหม่' }, { key: 'interested', label: 'สนใจ' }, { key: 'quoted', label: 'เสนอราคาแล้ว' },
      { key: 'awaiting_payment', label: 'รอโอน' }, { key: 'paid', label: 'ชำระแล้ว' }, { key: 'booked', label: 'จองคิวแล้ว' },
      { key: 'won', label: 'ปิดการขาย' }, { key: 'lost', label: 'ยกเลิก' }, { key: 'spam', label: 'สแปม' },
    ],
    detail_fields: [],
    media_categories: [
      { key: 'slip', label: 'สลิป' }, { key: 'product', label: 'สินค้า' }, { key: 'before_after', label: 'ก่อน-หลัง' },
      { key: 'document', label: 'เอกสาร' }, { key: 'other', label: 'อื่นๆ' },
    ],
    payment_methods: [
      { key: 'transfer', label: 'โอนเงิน' }, { key: 'cod', label: 'เก็บเงินปลายทาง' }, { key: 'installment', label: 'ผ่อนชำระ' },
    ],
    labels: {
      product: 'สินค้า', products: 'สินค้า', order: 'ออเดอร์', order_empty: 'ยังไม่มีออเดอร์',
      product_search: 'ค้นหาสินค้าเพื่อเพิ่ม…', summary_button: 'ร่างข้อความสรุป',
    },
  },
  real_estate: {
    profile: 'real_estate',
    stages: [
      { key: 'new', label: 'ใหม่' }, { key: 'interested', label: 'รู้ความต้องการ' }, { key: 'quoted', label: 'ส่งทรัพย์แล้ว' },
      { key: 'booked', label: 'นัดดูทรัพย์' }, { key: 'awaiting_payment', label: 'รอมัดจำ' }, { key: 'paid', label: 'วางมัดจำแล้ว' },
      { key: 'won', label: 'ปิดดีล' }, { key: 'lost', label: 'หลุด' }, { key: 'spam', label: 'สแปม' },
    ],
    detail_fields: [
      { key: 'role', label: 'บทบาท', type: 'select', options: [
        { value: 'owner', label: 'เจ้าของทรัพย์' }, { value: 'buyer', label: 'ผู้ซื้อ' }, { value: 'tenant', label: 'ผู้เช่า' },
        { value: 'co_agent', label: 'Co-agent' }, { value: 'resident', label: 'ลูกบ้าน' },
      ] },
      { key: 'intent', label: 'เรื่องที่ติดต่อ', type: 'select', options: [
        { value: 'list_sale', label: 'ฝากขาย' }, { value: 'list_rent', label: 'ฝากเช่า' }, { value: 'buy', label: 'หาซื้อ' },
        { value: 'rent', label: 'หาเช่า' }, { value: 'after_sales', label: 'แจ้งปัญหาหลังเช่า' }, { value: 'service', label: 'One Stop Service' },
      ] },
      { key: 'budget', label: 'งบประมาณ', type: 'text', placeholder: 'เช่น 12,000/เดือน' },
      { key: 'location', label: 'ทำเล/โครงการ', type: 'text', placeholder: 'เช่น ใกล้ BTS / ชื่อโครงการ' },
      { key: 'unit_type', label: 'ประเภทห้อง', type: 'text', placeholder: 'เช่น Studio / 1 ห้องนอน' },
      { key: 'move_in', label: 'ต้องการย้ายเข้า', type: 'text', placeholder: 'เช่น ต้นเดือนหน้า' },
      { key: 'property_code', label: 'รหัสทรัพย์', type: 'text', placeholder: 'เช่น RCD-0001' },
    ],
    media_categories: [
      { key: 'slip', label: 'สลิป' }, { key: 'product', label: 'รูปทรัพย์' }, { key: 'before_after', label: 'สภาพห้อง' },
      { key: 'document', label: 'เอกสาร' }, { key: 'other', label: 'อื่น ๆ' },
    ],
    payment_methods: [{ key: 'transfer', label: 'โอนเงิน' }],
    labels: {
      product: 'ทรัพย์', products: 'ทรัพย์', order: 'ข้อเสนอ/การจอง', order_empty: 'ยังไม่มีข้อเสนอ',
      product_search: 'ค้นหาทรัพย์เพื่อเพิ่ม…', summary_button: 'ร่างข้อความสรุป',
    },
  },
};
const LOCKABLE = ['full_name', 'phone', 'address', 'postcode', 'stage'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
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
      stage: 'new', tags: [], interests: [], details: {}, assignee_id: null, ai_summary: null, next_action: null, suggested_reply: null,
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

// ---------------------------------------------------------------- seed: property agency (PROFILE=real_estate)
// Every person, phone number, unit number and price here is invented for the demo.
function roomSvg({ wall, floor, label }) {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>
<rect width='400' height='250' fill='${wall}'/><rect y='250' width='400' height='150' fill='${floor}'/>
<rect x='40' y='50' width='130' height='120' rx='4' fill='#dcebf2' stroke='#ffffff' stroke-width='8'/><path d='M105 50v120M40 110h130' stroke='#ffffff' stroke-width='6'/>
<rect x='210' y='170' width='160' height='70' rx='10' fill='#193e24'/><rect x='200' y='220' width='180' height='44' rx='10' fill='#2c5a3a'/>
<rect x='226' y='186' width='56' height='34' rx='8' fill='#dee8dc'/><rect x='298' y='186' width='56' height='34' rx='8' fill='#dee8dc'/>
<rect x='60' y='214' width='70' height='50' rx='4' fill='#b98a5a'/><circle cx='95' cy='196' r='18' fill='#dd633a'/>
<rect x='20' y='352' width='360' height='32' rx='8' fill='rgba(16,20,26,.78)'/><text x='200' y='374' ${FONT} font-size='15' fill='#fff' text-anchor='middle'>${label}</text>
</svg>`);
}

const REAL_ESTATE_CHATS = [
  { id: 'U3001', name: 'Mint 🌿', last: '[รูปภาพ]', msgs: [['in', 'สนใจห้อง Studio ที่ Kave Town Colony ค่ะ งบไม่เกิน 12,000'], ['out', 'ได้เลยค่ะ เสาร์นี้สะดวกเข้ามาดูห้องไหมคะ'], ['in', 'เสาร์ 10:30 ได้ค่ะ']] },
  { id: 'U3002', name: 'คุณวิภา', last: 'อยากฝากปล่อยเช่าค่ะ', msgs: [['in', 'มีห้องที่ Modiz บางโพ อยากฝากปล่อยเช่าค่ะ']] },
  { id: 'U3003', name: 'Art Thanawat', last: 'ขอดูห้องอื่นเพิ่มครับ', msgs: [['in', 'หาคอนโด 1 ห้องนอน งบไม่เกิน 3 ล้านครับ'], ['in', 'ขอดูห้องอื่นเพิ่มครับ']] },
  { id: 'U3004', name: 'ปอนด์ (Co-agent)', last: 'มีลูกค้าหาเช่า 2 ห้องนอนครับ', msgs: [['in', 'มีลูกค้าหาเช่า 2 ห้องนอนครับ']] },
  { id: 'Cgbl7777', name: 'น้ำ Nam', last: 'ยังมีห้องว่างไหมคะ', msgs: [['in', 'ยังมีห้องว่างไหมคะ']] },
  { id: 'Unobody', name: 'ลูกค้าเก่าก่อนติดตั้ง', last: '(แชทเก่า)', msgs: [['in', 'แชทนี้เกิดก่อนเชื่อมระบบ']] },
];

function seedRealEstate() {
  const now = Date.now();
  const ago = (min) => new Date(now - min * 60000).toISOString();
  const ahead = (min) => new Date(now + min * 60000).toISOString();
  let seq = 100;
  const id = () => ++seq;
  const db = {
    staff: [
      { id: 1, name: 'ฝน', role: 'admin', token: DEMO_TOKEN, line_user_id: null },
      { id: 2, name: 'บีม', role: 'agent', token: 'demo-token-beam', line_user_id: null },
    ],
    settings: {
      shop_name: 'Globallink Estate',
      payment_instructions: 'โอนมัดจำตามบัญชีที่เจ้าหน้าที่แจ้ง แล้วส่งสลิปในแชทนี้ได้เลยค่ะ\nเจ้าหน้าที่จะตรวจยอดและยืนยันวันนัดทำสัญญาให้อีกครั้ง',
    },
    products: [
      { id: 1, sku: 'RCD-0012', name: 'RCD-0012 · Kave Town Colony · Studio 23 ตร.ม. ชั้น 3 (เช่า/เดือน)', price: 11000, category: 'เช่า', active: true },
      { id: 2, sku: 'RCD-0015', name: 'RCD-0015 · Kave Town Colony · Studio 23 ตร.ม. ชั้น 5 (เช่า/เดือน)', price: 12000, category: 'เช่า', active: true },
      { id: 3, sku: 'RCD-0021', name: 'RCD-0021 · Modiz Collection Bangpho · 1 ห้องนอน 28 ตร.ม. ชั้น 11 (เช่า/เดือน)', price: 24000, category: 'เช่า', active: true },
      { id: 4, sku: 'RCD-0007', name: 'RCD-0007 · North 8 Condo เชียงใหม่ · 2 ห้องนอน 73 ตร.ม. ชั้น 7 (เช่า/เดือน)', price: 35000, category: 'เช่า', active: true },
      { id: 5, sku: 'SCD-0003', name: 'SCD-0003 · Sarin Place · 1 ห้องนอน 34 ตร.ม. ชั้น 12 (ขาย)', price: 2950000, category: 'ขาย', active: true },
      { id: 6, sku: 'RCD-0009', name: 'RCD-0009 · Kave Town Colony · Studio 23 ตร.ม. ชั้น 2 (ปล่อยเช่าแล้ว)', price: 10500, category: 'เช่า', active: false },
    ],
    leads: [], notes: [], media: [], orders: [], messages: [], id,
  };
  const lead = (o) => {
    const l = Object.assign({
      id: id(), chat_id: null, display_name: null, picture_url: null, full_name: null, phone: null, address: null, postcode: null,
      stage: 'new', tags: [], interests: [], details: {}, assignee_id: null, ai_summary: null, next_action: null, suggested_reply: null,
      follow_up_at: null, locked_fields: [], last_message_at: ago(5), last_message_preview: null, created_at: ago(3000), updated_at: ago(5),
    }, o);
    db.leads.push(l);
    return l;
  };
  const note = (lead_id, kind, body, min, author, pinned) => db.notes.push({ id: id(), lead_id, body, kind, author_name: author || (kind === 'ai' ? 'Sidecar Agent' : null), pinned: !!pinned, created_at: ago(min) });
  const msg = (lead_id, direction, text, min, type) => db.messages.push({ id: id(), lead_id, direction, type: type || 'text', text: type && type !== 'text' ? null : text, media_id: null, sent_at: ago(min) });
  const media = (lead_id, category, url, min, caption, slip) => db.media.push({ id: id(), lead_id, url, category, caption: caption || null, slip: slip || null, created_at: ago(min) });

  // 1) someone looking to rent, viewing booked — the main demo chat
  const mint = lead({
    line_user_id: 'U3001', display_name: 'Mint 🌿', picture_url: avatarSvg('#2f7a45', 'M'),
    full_name: 'มินตรา วงศ์ทดสอบ', phone: '0815550101', stage: 'booked', tags: ['QR ล็อบบี้'], interests: ['Kave Town Colony', 'Studio'], assignee_id: 1,
    details: { role: 'tenant', intent: 'rent', budget: 'ไม่เกิน 12,000/เดือน', location: 'Kave Town Colony', unit_type: 'Studio', move_in: '1 ธ.ค.' },
    locked_fields: ['details.move_in'],
    ai_summary: 'นักศึกษาหาเช่าห้อง Studio ที่ Kave Town Colony งบไม่เกิน 12,000 บาท/เดือน ต้องการย้ายเข้า 1 ธ.ค. นัดดูห้องวันเสาร์ 10:30 น.',
    next_action: 'ยืนยันนัดดูห้องวันเสาร์ และเตรียมรายการค่าใช้จ่ายวันเข้าอยู่ให้ลูกค้า',
    suggested_reply: 'สวัสดีค่ะคุณมิ้นท์ ยืนยันนัดดูห้องที่ Kave Town Colony วันเสาร์ 10:30 น. นะคะ ส่วนค่าเช่าและค่าใช้จ่ายวันเข้าอยู่ เจ้าหน้าที่จะสรุปยืนยันให้อีกครั้งก่อนวันนัดค่ะ 🙏',
    follow_up_at: ago(30), last_message_at: ago(6), last_message_preview: '[รูปภาพ]',
  });
  msg(mint.id, 'in', 'สวัสดีค่ะ สนใจห้อง Studio ที่ Kave Town Colony ค่ะ', 200);
  msg(mint.id, 'in', 'งบไม่เกิน 12,000 ต่อเดือนค่ะ อยากย้ายเข้า 1 ธ.ค.', 198);
  msg(mint.id, 'in', 'ชื่อ มินตรา วงศ์ทดสอบ เบอร์ 081-555-0101 ค่ะ', 150);
  msg(mint.id, 'in', 'เสาร์ 10:30 ไปดูห้องได้ค่ะ', 60);
  msg(mint.id, 'in', null, 6, 'image');
  note(mint.id, 'ai', 'หาเช่า Studio ที่ Kave Town Colony งบไม่เกิน 12,000 บาท/เดือน ย้ายเข้า 1 ธ.ค. นัดดูห้องเสาร์ 10:30 น.', 58);
  note(mint.id, 'staff', 'ลูกค้าเลี้ยงแมว 1 ตัว ต้องถามเจ้าของห้องก่อนว่าเลี้ยงสัตว์ได้ไหม', 50, 'ฝน', true);
  note(mint.id, 'staff', 'กุญแจห้องชั้น 3 อยู่ที่นิติ แจ้งนิติล่วงหน้าแล้ว', 30, 'บีม');
  media(mint.id, 'product', roomSvg({ wall: '#efe9dc', floor: '#c9a77c', label: 'Kave Town Colony · Studio ชั้น 3' }), 190, 'รูปห้องที่ลูกค้าสนใจ');
  media(mint.id, 'product', roomSvg({ wall: '#e3ece6', floor: '#b7c4b0', label: 'Kave Town Colony · Studio ชั้น 5' }), 189, null);
  media(mint.id, 'before_after', roomSvg({ wall: '#e9e4f0', floor: '#a9a1b8', label: 'สภาพห้องก่อนเข้าอยู่' }), 120, 'สภาพห้องล่าสุดจากเจ้าของ');
  media(mint.id, 'document', docSvg('บัตรนักศึกษา (ตัวอย่าง)'), 6, 'เอกสารประกอบสัญญาเช่า');

  // 2) the same phone number → "returning customer" notice
  lead({ line_user_id: 'U3007', display_name: 'Mint (สัญญาเดิม)', full_name: 'มินตรา วงศ์ทดสอบ', phone: '0815550101', stage: 'won', details: { role: 'tenant', intent: 'rent', location: 'Sarin Place' }, last_message_at: ago(60 * 24 * 200), last_message_preview: 'ขอบคุณค่ะ คืนห้องเรียบร้อย', ai_summary: 'เคยเช่าห้องที่ Sarin Place ครบสัญญา คืนห้องเรียบร้อย' });

  const wipa = lead({ line_user_id: 'U3002', display_name: 'คุณวิภา', picture_url: avatarSvg('#b5521e', 'ว'), full_name: 'วิภา ใจตัวอย่าง', phone: '0825550102', stage: 'interested', interests: ['Modiz Collection Bangpho'], details: { role: 'owner', intent: 'list_rent', location: 'Modiz Collection Bangpho', unit_type: '1 ห้องนอน 28 ตร.ม.', budget: 'อยากได้ 24,000/เดือน' }, last_message_at: ago(14), last_message_preview: 'อยากฝากปล่อยเช่าค่ะ', ai_summary: 'เจ้าของห้อง 1 ห้องนอนที่ Modiz Collection Bangpho ต้องการฝากปล่อยเช่า ตั้งราคาไว้ 24,000 บาท/เดือน', next_action: 'ขอรูปห้องและเอกสารกรรมสิทธิ์ แล้วนัดสำรวจห้อง', suggested_reply: 'ขอบคุณที่ไว้วางใจ Globallink ค่ะคุณวิภา รบกวนส่งรูปห้องปัจจุบันและแจ้งวันที่สะดวกให้เจ้าหน้าที่เข้าสำรวจห้องได้เลยค่ะ' });
  msg(wipa.id, 'in', 'มีห้องที่ Modiz บางโพ อยากฝากปล่อยเช่าค่ะ', 14);

  lead({ line_user_id: 'U3003', display_name: 'Art Thanawat', picture_url: avatarSvg('#2b6485', 'A'), full_name: 'ธนวัฒน์ ทดลอง', phone: '0835550103', stage: 'quoted', interests: ['1 ห้องนอน', 'ใกล้รถไฟฟ้า'], assignee_id: 2, details: { role: 'buyer', intent: 'buy', budget: 'ไม่เกิน 3 ล้าน', location: 'รัชดา-ลาดพร้าว', unit_type: '1 ห้องนอน' }, last_message_at: ago(60 * 20), last_message_preview: 'ขอดูห้องอื่นเพิ่มครับ', ai_summary: 'หาซื้อคอนโด 1 ห้องนอนย่านรัชดา-ลาดพร้าว งบไม่เกิน 3 ล้าน ส่งทรัพย์ไปแล้ว 1 รายการ ขอดูตัวเลือกเพิ่ม', next_action: 'ส่งทรัพย์ที่ตรงงบเพิ่ม 2 รายการ และถามวันที่สะดวกนัดดู', follow_up_at: ago(60 * 2) });
  lead({ line_user_id: 'U3004', display_name: 'ปอนด์ (Co-agent)', full_name: null, phone: '0845550104', stage: 'new', details: { role: 'co_agent', intent: 'rent', budget: '35,000/เดือน', location: 'เชียงใหม่ นิมมาน', unit_type: '2 ห้องนอน' }, last_message_at: ago(2), last_message_preview: 'มีลูกค้าหาเช่า 2 ห้องนอนครับ', ai_summary: 'Co-agent มีลูกค้าหาเช่า 2 ห้องนอนที่เชียงใหม่ งบ 35,000 บาท/เดือน', next_action: 'ตรวจห้องว่างที่ North 8 Condo และแจ้งเงื่อนไข Co-agent' });
  const aew = lead({ line_user_id: 'U3005', display_name: 'ป้าแอ๋ว', picture_url: avatarSvg('#6a5596', 'ป'), full_name: 'อรทัย สมมติ', phone: '0855550105', stage: 'interested', assignee_id: 1, details: { role: 'resident', intent: 'after_sales', location: 'North 8 Condo เชียงใหม่', property_code: 'RCD-0007' }, last_message_at: ago(95), last_message_preview: 'แอร์น้ำหยดค่ะ', ai_summary: 'ลูกบ้านแจ้งแอร์ห้องนอนน้ำหยด ขอช่างเข้าตรวจ สะดวกช่วงบ่ายวันธรรมดา', next_action: 'ถามนิติเรื่องช่างประจำอาคาร แล้วแจ้งวันเข้าตรวจให้ลูกบ้าน', follow_up_at: ahead(120) });
  media(aew.id, 'before_after', roomSvg({ wall: '#dfe7ee', floor: '#9fb0bf', label: 'แอร์ห้องนอน — จุดที่น้ำหยด' }), 95, 'รูปที่ลูกบ้านส่งมา');

  const beam = lead({ line_user_id: 'U3006', display_name: 'Beam', picture_url: avatarSvg('#1b7570', 'B'), full_name: 'พีรพล นามสมมุติ', phone: '0865550106', stage: 'paid', assignee_id: 2, details: { role: 'tenant', intent: 'rent', budget: '25,000/เดือน', location: 'Modiz Collection Bangpho', unit_type: '1 ห้องนอน', move_in: '15 ธ.ค.', property_code: 'RCD-0021' }, last_message_at: ago(60 * 5), last_message_preview: 'โอนมัดจำแล้วครับ', ai_summary: 'ตกลงเช่า RCD-0021 โอนมัดจำ 5,000 บาทแล้ว รอนัดวันทำสัญญา', next_action: 'นัดวันทำสัญญาเช่าและส่งรายการเอกสารที่ต้องเตรียม' });
  media(beam.id, 'slip', slipSvg({ amount: '5,000.00', bank: 'ธนาคารตัวอย่าง', time: 'วันนี้ 09:12 น.', ref: '0000 5550 0106 XY', to: 'บัญชีรับมัดจำ (ตัวอย่าง)' }), 60 * 5, 'สลิปมัดจำ', { amount: 5000, paid_at: ago(60 * 5 + 3), bank: 'ธนาคารตัวอย่าง', ref: '000055500106XY', matches_order: true });
  db.orders.push({ id: id(), lead_id: beam.id, status: 'paid', items: [{ id: id(), product_id: 3, name: db.products[2].name, qty: 1, unit_price: 24000 }], discount: 0, shipping_fee: 0, payment_method: 'transfer', deposit_amount: 5000, note: 'สัญญา 12 เดือน', created_at: ago(60 * 6), updated_at: ago(60 * 5), staff_edited: true });

  lead({ line_user_id: 'U3008', display_name: 'Ton', stage: 'lost', details: { role: 'tenant', intent: 'rent' }, last_message_at: ago(60 * 24 * 6), last_message_preview: 'ได้ห้องที่อื่นแล้วครับ', ai_summary: 'ได้ห้องจากที่อื่นแล้ว' });
  lead({ line_user_id: 'U3009', display_name: 'รับยิงแอด เพิ่มยอดขาย', stage: 'spam', last_message_at: ago(60 * 24 * 2), last_message_preview: 'สนใจทำการตลาดออนไลน์ไหมคะ' });

  // A customer whose OA Manager chat id differs from the Messaging API user id → link by hand.
  const nam = lead({ line_user_id: 'U4001', display_name: 'น้ำ Nam', picture_url: avatarSvg('#8c6d0a', 'น'), phone: '0875550107', stage: 'new', details: { intent: 'rent' }, last_message_at: ago(20), last_message_preview: 'ยังมีห้องว่างไหมคะ', ai_summary: 'ถามหาห้องว่าง ยังไม่ระบุงบและทำเล', next_action: 'ถามงบ ทำเล และวันที่ต้องการย้ายเข้า' });
  msg(nam.id, 'in', 'ยังมีห้องว่างไหมคะ', 20);

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

export function createMockApp(opts = {}) {
  const profile = opts.profile === 'real_estate' ? 'real_estate' : 'retail';
  const config = PROFILES[profile];
  const db = profile === 'real_estate' ? seedRealEstate() : seed();
  const staticRoot = opts.root ? path.resolve(opts.root) : REPO_ROOT;
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
    if (profile === 'real_estate') {
      const out = ['สรุปข้อเสนอ — ' + db.settings.shop_name, '', 'คุณ ' + (l.full_name || l.display_name || 'ลูกค้า')];
      if (l.phone) out.push('เบอร์ ' + l.phone);
      out.push('', 'ทรัพย์');
      o.items.forEach((it, i) => out.push(`${i + 1}. ${it.name} = ${money(it.qty * it.unit_price)} บาท`));
      out.push('', 'ราคารวม ' + money(o.total) + ' บาท');
      if (o.deposit_amount) {
        out.push('มัดจำ ' + money(o.deposit_amount) + ' บาท');
        out.push('คงเหลือ ' + money(o.total - o.deposit_amount) + ' บาท');
      }
      if (o.note) out.push('หมายเหตุ: ' + o.note);
      if (db.settings.payment_instructions) out.push('', db.settings.payment_instructions);
      return out.join('\n');
    }
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
    if (method === 'GET' && p === '/health') return { ok: true, version: 'mock-0.1.0', configured: true, missing: [] };
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
    if (method === 'GET' && p === '/api/config') return { ok: true, config };
    if (method === 'GET' && p === '/api/staff') return { ok: true, staff: db.staff.map(staffView) };

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
        if (Array.isArray(body.unlock)) l.locked_fields = l.locked_fields.filter((f) => !body.unlock.includes(f));
        if (body.details !== undefined) {
          if (!body.details || typeof body.details !== 'object' || Array.isArray(body.details)) throw bad('details must be an object');
          for (const key of Object.keys(body.details)) {
            const field = config.detail_fields.find((f) => f.key === key);
            if (!field) throw bad('unknown detail: ' + key);
            const v = body.details[key] == null ? '' : String(body.details[key]).trim();
            if (v && field.type === 'select' && !field.options.some((o) => o.value === v)) throw bad('unknown value for ' + key);
            const lockKey = 'details.' + key;
            if (v) {
              l.details[key] = v;
              if (!l.locked_fields.includes(lockKey)) l.locked_fields.push(lockKey);
            } else {
              delete l.details[key];
              l.locked_fields = l.locked_fields.filter((f) => f !== lockKey);
            }
          }
        }
        for (const k of Object.keys(body)) {
          if (!allowed.includes(k)) continue;
          let v = body[k];
          if (k === 'stage' && !STAGES.includes(v)) throw bad('unknown stage');
          if (k === 'phone') v = normPhone(v);
          if ((k === 'tags' || k === 'interests') && !Array.isArray(v)) throw bad(k + ' must be an array');
          if (k === 'assignee_id' && v != null && !db.staff.some((s) => s.id === v)) throw bad('unknown assignee');
          l[k] = v === '' ? null : v;
          if (!LOCKABLE.includes(k)) continue;
          // An edit locks the field; clearing it hands the field back to the agent.
          if (l[k] == null) l.locked_fields = l.locked_fields.filter((f) => f !== k);
          else if (!l.locked_fields.includes(k)) l.locked_fields.push(k);
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
        const all = url.searchParams.get('all') === '1';
        const rows = db.products.filter((x) => (all || x.active) && (!q || x.name.toLowerCase().includes(q) || (x.sku || '').toLowerCase().includes(q)));
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
      if ('sku' in body) pr.sku = body.sku || null;
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
    const isChatPage = /^\/U[^/]*(\/chat(\/[^/]*)?)?\/?$/.test(pathname) || pathname === '/';
    let rel = isChatPage ? 'extension/dev/fake-chat.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    // Files come from the static root (the repo, or a branded build). The dev stand-in pages are
    // not part of a build, so those always come from the repo.
    const base = rel.startsWith('extension/dev/') ? REPO_ROOT : staticRoot;
    const file = path.resolve(base, rel);
    const inside = file === base || file.startsWith(base + path.sep);
    const hidden = rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules');
    if (!inside || hidden || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (isChatPage && profile === 'real_estate') {
      // The stand-in chat list has to name this profile's demo customers.
      const chats = '<script>window.__FAKE_CHATS = ' + JSON.stringify(REAL_ESTATE_CHATS).replace(/</g, '\\u003c') + ';</script>\n';
      res.end(fs.readFileSync(file, 'utf8').replace('<script src="/extension/dev/fake-chat.js"></script>', chats + '<script src="/extension/dev/fake-chat.js"></script>'));
      return;
    }
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

export function startMockServer(port = 0, opts = {}) {
  const app = createMockApp(opts);
  const server = http.createServer((req, res) => { app.handle(req, res); });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const url = 'http://localhost:' + server.address().port;
      resolve({ url, app, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.env.PROFILE === 'real_estate' ? 'real_estate' : 'retail';
  const { url } = await startMockServer(Number(process.env.PORT) || 8790, { profile, root: process.env.ROOT || undefined });
  console.log('Sidecar mock running (profile: ' + profile + (process.env.ROOT ? ', root: ' + process.env.ROOT : '') + ')');
  console.log('  fake LINE OA chat : ' + url + '/Ufakeoa/chat/' + (profile === 'real_estate' ? 'U3001' : 'U1001'));
  console.log('  mobile staff page : ' + url + '/staff.html');
  console.log('  API URL           : ' + url + '   token: ' + DEMO_TOKEN);
}
