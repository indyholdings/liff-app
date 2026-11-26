// Local Sidecar for UI work and demos: the real router and SQL on an in-process
// Postgres (PGlite), with LINE, storage and the model replaced by fakes.
//
//   npm run dev            → http://localhost:8787   retail demo (second-hand Apple shop)
//   npm run dev:gbl        → http://localhost:8788   real_estate demo (PROFILE=real_estate, a property agency)
//   staff token            dev-staff-token   (Authorization: Bearer dev-staff-token)
//   admin key              dev-admin-key
//
// Dev-only route:
//   POST /dev/line-message { userId, displayName?, text? , image?: { kind: "slip" | "product", amount? } }
// It sends a correctly signed LINE webhook call through the real handler, so the
// lead card updates the way it would in production (debounce is 300 ms here).
//
// Any other GET path is served as a static file from the repository root, so
// http://localhost:8787/staff.html works against this API.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

import { handle } from "../supabase/functions/sidecar/src/router.ts";
import { hmacSha256Base64, normalizePhone, sha256Hex } from "../supabase/functions/sidecar/src/util.ts";
import type {
  Analysis, Brain, ConversationInput, Deps, ImageAnalysis,
} from "../supabase/functions/sidecar/src/types.ts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT) || 8787;
const SECRET = "dev-channel-secret";
const STAFF_TOKEN = "dev-staff-token";
const ADMIN_KEY = "dev-admin-key";
// Which demo to seed and which profile the app runs as. Anything else is retail.
const ESTATE = process.env.PROFILE === "real_estate";

// ---- fake brain: regexes instead of a model, so demos are deterministic ----

function fakeAnalysis(input: ConversationInput): Analysis {
  const mine = input.messages.filter((m) => m.direction === "in" && m.type === "text").map((m) => m.text ?? "");
  const all = mine.join("\n");
  const latest = mine.at(-1) ?? "";

  const phone = normalizePhone(/(?:\+66|0)[\d\- ]{8,12}/.exec(all)?.[0] ?? null);
  const name = /ชื่อ\s*([^\s,]+(?:\s+(?!เบอร์|โทร|ที่อยู่)[^\s,\d]+)?)/.exec(all)?.[1] ?? null;
  const address = /ที่อยู่\s*[:：]?\s*([^\n]+?)(?=\s*\d{5}|\n|$)/.exec(all)?.[1]?.trim() ?? null;
  const postcode = /(?<!\d)(\d{5})(?!\d)/.exec(all.replace(/(?:\+66|0)[\d\- ]{8,12}/g, ""))?.[1] ?? null;

  const lower = all.toLowerCase();
  const wanted = input.products.filter((p) => {
    const short = p.name.toLowerCase().replace(/\s+\d+gb$/, "");
    return lower.includes(p.name.toLowerCase()) || lower.includes(short);
  });
  const buying = /(เอา|สั่ง|ซื้อ|จอง|รับ)/.test(all);
  const paying = /(โอน|สลิป|จ่าย|ชำระ)/.test(all) || input.messages.some((m) => (m.text ?? "").includes("slip"));

  let stage: Analysis["stage"] = "new";
  if (wanted.length || /(สนใจ|ราคา|เท่าไหร่|เท่าไร|มีไหม|ผ่อน)/.test(all)) stage = "interested";
  if (buying && wanted.length) stage = "awaiting_payment";
  if (paying) stage = "awaiting_payment";
  if (/(ไม่เอา|ยกเลิก)/.test(latest)) stage = "lost";

  const what = wanted.map((p) => p.name).join(", ") || "สินค้า";
  const summary = stage === "awaiting_payment"
    ? `ลูกค้าต้องการ ${what}\nรอชำระเงิน / ตรวจสลิป`
    : stage === "lost"
    ? "ลูกค้าแจ้งยกเลิก"
    : stage === "interested"
    ? `ลูกค้าสอบถาม ${what}`
    : "ลูกค้าทักเข้ามา ยังไม่ระบุความต้องการ";

  const first = wanted[0];
  return {
    full_name: name, phone, address, postcode,
    interests: wanted.map((p) => p.name),
    stage,
    summary,
    next_action: stage === "awaiting_payment"
      ? "ส่งสรุปยอดและช่องทางชำระเงิน แล้วรอสลิป"
      : stage === "interested" ? "ตอบราคาและสภาพเครื่อง ชวนปิดการขาย" : "ทักทายและถามความต้องการ",
    suggested_reply: first
      ? `สวัสดีค่ะ ${first.name} ราคา ${first.price.toLocaleString("en-US")} บาทค่ะ สนใจรับเครื่องแบบไหนดีคะ`
      : "สวัสดีค่ะ สนใจสินค้าตัวไหนสอบถามได้เลยนะคะ",
    order_items: buying ? wanted.map((p) => ({ name: p.name, qty: 1, unit_price: p.price })) : [],
    follow_up_hours: stage === "awaiting_payment" ? 24 : stage === "interested" ? 48 : null,
  };
}

// ---- fake brain for the property-agency demo ----

const projectOf = (unitName: string) => unitName.split("·")[0].trim();

function fakeEstateAnalysis(input: ConversationInput): Analysis {
  const mine = input.messages.filter((m) => m.direction === "in" && m.type === "text").map((m) => m.text ?? "");
  const all = mine.join("\n");
  const latest = mine.at(-1) ?? "";
  const lower = all.toLowerCase();

  const phone = normalizePhone(/(?:\+66|0)[\d\- ]{8,12}/.exec(all)?.[0] ?? null);
  const name = /ชื่อ\s*([^\s,]+(?:\s+(?!เบอร์|โทร|งบ)[^\s,\d]+)?)/.exec(all)?.[1] ?? null;

  let intent: string | null = null;
  if (/ฝากขาย/.test(all)) intent = "list_sale";
  else if (/(ฝากเช่า|ปล่อยเช่า)/.test(all)) intent = "list_rent";
  else if (/(แอร์|น้ำรั่ว|ซ่อม|ชำรุด|ไฟดับ)/.test(all)) intent = "after_sales";
  else if (/(หาซื้อ|อยากซื้อ|สนใจซื้อ|ซื้อคอนโด)/.test(all)) intent = "buy";
  else if (/(หาเช่า|หาห้อง|อยากเช่า|ขอเช่า|ห้องเช่า)/.test(all)) intent = "rent";

  let role: string | null = null;
  if (/(co-?agent|เอเจนต์|เอเจนซี่)/i.test(all)) role = "co_agent";
  else if (intent === "list_sale" || intent === "list_rent") role = "owner";
  else if (intent === "buy") role = "buyer";
  else if (intent === "rent") role = "tenant";
  else if (intent === "after_sales") role = "resident";

  const budgetMatch = /งบ(?:ประมาณ)?\s*((?:ไม่เกิน\s*)?[\d,.]+(?:\s*-\s*[\d,.]+)?\s*(?:ล้าน|บาท)?)/.exec(all)?.[1]?.trim() ?? null;
  const budget = budgetMatch && intent === "rent" && !/ล้าน/.test(budgetMatch) ? `${budgetMatch.replace(/\s*บาท$/, "")}/เดือน` : budgetMatch;

  const wanted = input.products.filter((p) => lower.includes(projectOf(p.name).toLowerCase()));
  const projects = [...new Set(wanted.map((p) => projectOf(p.name)))];
  const near = /ใกล้\s*([^\s,]+(?:\s(?!งบ)[^\s,\d]+)?)/.exec(all)?.[1] ?? null;
  const location = projects[0] ?? (near ? `ใกล้ ${near}` : null);

  const unitType = /(studio|สตูดิโอ|\d\s*ห้องนอน)/i.exec(all)?.[1] ?? null;
  const moveIn = /(?:ย้ายเข้า|เข้าอยู่)\s*([^\n,]{2,40})/.exec(all)?.[1]?.trim() ?? null;
  const code = /\b([RSB](?:CD|HM|LN)-\d{4})\b/.exec(all)?.[1] ?? null;

  const reserving = /(จอง|ตกลงเอา|เอาห้องนี้)/.test(all);
  const paying = /(โอน|สลิป|มัดจำแล้ว)/.test(all) || input.messages.some((m) => (m.text ?? "").includes("slip"));

  let stage: Analysis["stage"] = "new";
  if (intent || wanted.length || budget) stage = "interested";
  if ((reserving && wanted.length) || paying) stage = "awaiting_payment";
  if (/(ไม่เอา|ยกเลิก|ได้ห้องแล้ว|ได้ที่อื่นแล้ว)/.test(latest)) stage = "lost";
  if (/(รับทำการตลาด|เพิ่มยอดขาย)/.test(all)) stage = "spam";

  const INTENT_TH: Record<string, string> = {
    list_sale: "ฝากขาย", list_rent: "ฝากเช่า", buy: "หาซื้อ", rent: "หาเช่า", after_sales: "แจ้งปัญหาหลังเช่า",
  };
  const need = [intent ? INTENT_TH[intent] : null, unitType, location, budget ? `งบ ${budget}` : null].filter(Boolean).join(" · ");
  const summary = stage === "spam"
    ? "ข้อความโฆษณา ไม่เกี่ยวกับทรัพย์"
    : stage === "lost"
    ? "ลูกค้าแจ้งว่าไม่ไปต่อ"
    : stage === "awaiting_payment"
    ? `ลูกค้าต้องการจอง ${wanted[0]?.name ?? "ทรัพย์"}\nรอมัดจำ / ตรวจสลิป`
    : need ? `ลูกค้า${need}` : "ลูกค้าทักเข้ามา ยังไม่ระบุความต้องการ";

  const missing = !intent ? "ต้องการซื้อ เช่า หรือฝากทรัพย์" : !budget && (intent === "rent" || intent === "buy") ? "งบประมาณ" : !location ? "ทำเลที่สนใจ" : null;
  return {
    full_name: name, phone, address: null, postcode: null,
    interests: projects,
    stage,
    summary,
    next_action: stage === "awaiting_payment"
      ? "ส่งสรุปรายละเอียดทรัพย์และช่องทางโอนมัดจำ แล้วรอสลิป"
      : intent === "after_sales" ? "รับเรื่อง ถามเลขห้อง แล้วประสานนิติ/ช่าง"
      : missing ? `ถาม${missing}` : "ส่งทรัพย์ที่ตรงความต้องการ 2-3 รายการ แล้วชวนนัดดู",
    suggested_reply: intent === "after_sales"
      ? "รับเรื่องแล้วนะคะ รบกวนแจ้งเลขห้องและส่งรูปจุดที่มีปัญหาเพิ่มเติมได้เลยค่ะ เจ้าหน้าที่จะตรวจสอบและแจ้งกลับค่ะ"
      : missing
      ? `สวัสดีค่ะ ยินดีให้บริการค่ะ รบกวนแจ้ง${missing}เพิ่มเติมหน่อยนะคะ เจ้าหน้าที่จะได้คัดทรัพย์ที่ตรงให้ค่ะ`
      : "ขอบคุณค่ะ เจ้าหน้าที่จะตรวจสอบห้องว่างและส่งรายละเอียดให้ในแชทนี้นะคะ",
    order_items: reserving && wanted[0] ? [{ name: wanted[0].name, qty: 1, unit_price: wanted[0].price }] : [],
    follow_up_hours: stage === "awaiting_payment" ? 24 : stage === "interested" ? 48 : null,
    details: {
      role, intent, budget, location, unit_type: unitType, move_in: moveIn, property_code: code,
    },
  };
}

// Dev images are tiny JSON payloads ({ kind, amount }) instead of real pictures.
function fakeImage(bytes: Uint8Array): ImageAnalysis {
  let spec: { kind?: string; amount?: number } = {};
  try {
    spec = JSON.parse(new TextDecoder().decode(bytes));
  } catch { /* not a dev payload */ }
  if (spec.kind === "slip") {
    return {
      category: "slip", caption: "สลิปโอนเงิน",
      slip: { amount: spec.amount ?? null, paid_at: new Date().toISOString(), bank: "KBank", ref: "DEV" + Date.now() },
    };
  }
  if (spec.kind === "product") return { category: "product", caption: ESTATE ? "รูปห้องจากลูกค้า" : "รูปสินค้าจากลูกค้า", slip: null };
  if (spec.kind === "room") return { category: "before_after", caption: "สภาพห้อง", slip: null };
  return { category: "other", caption: null, slip: null };
}

const brain: Brain = {
  analyzeConversation: async (input) => (ESTATE ? fakeEstateAnalysis(input) : fakeAnalysis(input)),
  analyzeImage: async (input) => fakeImage(input.bytes),
};

// ---- fake LINE and storage ----

const profiles = new Map<string, { displayName: string; pictureUrl?: string }>();
const lineContent = new Map<string, Uint8Array>();
const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();

function placeholder(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="${color}"/>` +
    `<text x="160" y="170" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">${label}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function mediaUrl(path: string): string {
  if (path.includes("slip")) return placeholder("SLIP", "#0f766e");
  if (path.includes("room")) return placeholder("ROOM", "#b45309");
  if (path.includes("unit")) return placeholder("UNIT", "#193e24");
  if (path.includes("product")) return placeholder("PRODUCT", "#1d4ed8");
  if (path.includes("doc")) return placeholder("DOCUMENT", "#7c3aed");
  const file = stored.get(path);
  if (file) {
    try {
      const spec = JSON.parse(new TextDecoder().decode(file.bytes));
      if (spec.kind === "slip") return placeholder(`SLIP ${spec.amount ?? ""}`, "#0f766e");
      if (spec.kind === "product") return ESTATE ? placeholder("UNIT", "#193e24") : placeholder("PRODUCT", "#1d4ed8");
      if (spec.kind === "room") return placeholder("ROOM", "#b45309");
    } catch { /* fall through */ }
  }
  return placeholder("IMAGE", "#64748b");
}

// ---- database and seed ----

const pg = new PGlite();
// Every migration in order, except the storage bucket (PGlite has no storage schema).
const MIGRATIONS = join(ROOT, "supabase/migrations");
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("bucket")).sort()) {
  await pg.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
}

async function seed(): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => pg.query<any>(sql, params);
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const arr = (values: string[]) => JSON.stringify(values);

  await q(`update sidecar.settings set value = 'JAIFU Solutions' where key = 'shop_name'`);
  await q(
    `update sidecar.settings set value = $1 where key = 'payment_instructions'`,
    ["โอนเข้าบัญชี ธ.ตัวอย่าง 000-0-00000-0 ชื่อบัญชี บจก.ตัวอย่าง\nโอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"],
  );

  const staff: number[] = [];
  for (const [name, role, token] of [["ริต้า (dev)", "admin", STAFF_TOKEN], ["ต้น", "agent", "dev-staff-token-2"]]) {
    staff.push((await q(
      `insert into sidecar.staff (name, role, token_hash) values ($1, $2, $3) returning id`,
      [name, role, await sha256Hex(token)],
    )).rows[0].id);
  }

  const products: Record<string, number> = {};
  for (const [sku, name, price, category] of [
    ["IP13-128", "iPhone 13 128GB", 13900, "iPhone"],
    ["IP14P-256", "iPhone 14 Pro 256GB", 27900, "iPhone"],
    ["IP15-128", "iPhone 15 128GB", 24900, "iPhone"],
    ["IPA5-64", "iPad Air 5 64GB", 15900, "iPad"],
    ["MBA-M1", "MacBook Air M1", 19900, "Mac"],
    ["APP2", "AirPods Pro 2", 5490, "Accessories"],
    ["AWSE2", "Apple Watch SE 2", 6900, "Watch"],
    ["CASE", "เคสใสกันกระแทก", 190, "Accessories"],
  ] as [string, string, number, string][]) {
    products[name] = (await q(
      `insert into sidecar.products (sku, name, price, category) values ($1, $2, $3, $4) returning id`,
      [sku, name, price, category],
    )).rows[0].id;
  }

  interface SeedLead {
    user: string; name: string; full?: string; phone?: string; address?: string; postcode?: string;
    stage: string; tags?: string[]; interests?: string[]; assignee?: number; summary?: string; next?: string;
    reply?: string; followUp?: string; minutesAgo: number; messages: string[];
  }
  const leads: SeedLead[] = [
    {
      user: "Udemo0001", name: "Mild 🌸", full: "กมลชนก ตัวอย่าง", phone: "0815550101",
      address: "99/1 ซ.ตัวอย่าง 5 แขวงคลองตัน เขตคลองเตย กรุงเทพฯ", postcode: "10110",
      stage: "awaiting_payment", tags: ["ผ่อน"], interests: ["iPhone 13 128GB", "เคสใสกันกระแทก"], assignee: staff[0],
      summary: "ลูกค้าต้องการ iPhone 13 128GB พร้อมเคส\nรอโอนมัดจำ 1,000 บาท",
      next: "ตามสลิปมัดจำ ถ้ายังเงียบให้ทักอีกครั้งช่วงเย็น",
      reply: "สวัสดีค่ะคุณมายด์ แอดมินล็อกเครื่องไว้ให้แล้วนะคะ โอนมัดจำแล้วส่งสลิปได้เลยค่ะ",
      followUp: ago(30), minutesAgo: 95,
      messages: ["สวัสดีค่ะ iPhone 13 ยังมีไหมคะ", "เอาสีดำค่ะ ขอเคสใสด้วย", "ชื่อกมลชนก เบอร์ 081-555-0101", "เดี๋ยวโอนมัดจำให้ตอนเย็นนะคะ"],
    },
    {
      user: "Udemo0002", name: "Phuong Ha", stage: "interested", interests: ["iPhone 15 128GB"],
      summary: "ลูกค้าสอบถาม iPhone 15 128GB และโปรผ่อน", next: "ตอบราคาและเงื่อนไขผ่อน",
      reply: "สวัสดีค่ะ iPhone 15 128GB ราคา 24,900 บาทค่ะ ผ่อนได้สูงสุด 10 เดือนนะคะ",
      followUp: ago(-60 * 20), minutesAgo: 12,
      messages: ["iPhone 15 ราคาเท่าไหร่คะ", "ผ่อนได้ไหม"],
    },
    {
      user: "Udemo0003", name: "Kiki Miller", full: "กิตติยา ตัวอย่าง", phone: "0825550102", stage: "lost",
      tags: ["ราคา"], interests: ["MacBook Air M1"], summary: "ลูกค้าแจ้งยกเลิก ขอคิดดูก่อนเรื่องราคา",
      next: "ไม่ต้องตาม ถ้ามีโปรลดราคาค่อยแจ้ง", minutesAgo: 60 * 26,
      messages: ["MacBook Air M1 ลดได้อีกไหมคะ", "ขอคิดดูก่อนนะคะ ยกเลิกไปก่อนค่ะ"],
    },
    {
      user: "Udemo0004", name: "Khanh Huyen", stage: "new", minutesAgo: 4,
      summary: "ลูกค้าทักเข้ามา ยังไม่ระบุความต้องการ", next: "ทักทายและถามความต้องการ",
      reply: "สวัสดีค่ะ สนใจสินค้าตัวไหนสอบถามได้เลยนะคะ", messages: ["สวัสดีค่ะ"],
    },
    {
      user: "Udemo0005", name: "Rita Ppc", full: "ริต้า ตัวอย่าง", phone: "0835550103",
      address: "1/3 ถ.ตัวอย่าง แขวงคลองสาน เขตคลองสาน กรุงเทพฯ", postcode: "10600",
      stage: "paid", tags: ["ลูกค้าเก่า"], interests: ["iPad Air 5 64GB"], assignee: staff[1],
      summary: "ชำระครบแล้ว รอจัดส่ง iPad Air 5", next: "แพ็กของและแจ้งเลขพัสดุ", minutesAgo: 60 * 5,
      messages: ["โอนแล้วนะคะ", "ส่งได้วันไหนคะ"],
    },
    {
      user: "Udemo0006", name: "Anh Ngoc Nguyen", full: "อัญชลี ตัวอย่าง", phone: "0845550104", stage: "won",
      tags: ["ลูกค้าเก่า", "รีวิวแล้ว"], interests: ["AirPods Pro 2"], summary: "ได้รับสินค้าแล้ว พอใจ ส่งรีวิวให้",
      next: "ไม่มี", minutesAgo: 60 * 24 * 3, messages: ["ได้รับของแล้วค่ะ ขอบคุณมากนะคะ"],
    },
    {
      user: "Udemo0007", name: "Sales DO More", stage: "spam", summary: "ข้อความโฆษณา ไม่เกี่ยวกับการซื้อ",
      next: "ไม่ต้องตอบ", minutesAgo: 60 * 24 * 9, messages: ["รับทำการตลาดออนไลน์ เพิ่มยอดขาย 10 เท่า สนใจทักเลย"],
    },
    {
      user: "Udemo0008", name: "น้ำฝน", full: "น้ำฝน ตัวอย่าง", phone: "0855550105", stage: "quoted",
      interests: ["iPhone 14 Pro 256GB"], assignee: staff[0], summary: "เสนอราคา iPhone 14 Pro 256GB แล้ว ลูกค้าขอดูรูปเครื่องจริง",
      next: "ส่งรูปเครื่องจริงและสุขภาพแบต", reply: "ได้เลยค่ะ เดี๋ยวแอดมินถ่ายรูปเครื่องจริงส่งให้นะคะ",
      followUp: ago(-60 * 4), minutesAgo: 40, messages: ["14 Pro สีม่วงมีไหมคะ", "ขอดูรูปเครื่องจริงหน่อยค่ะ"],
    },
    {
      user: "Udemo0009", name: "Bank", full: "ธนาคาร ตัวอย่าง", phone: "0815550101", stage: "booked",
      tags: ["ขายฝาก"], interests: ["Apple Watch SE 2"], summary: "นัดเข้ามาดูเครื่องที่ร้านวันเสาร์ 14:00",
      next: "ยืนยันนัดล่วงหน้า 1 วัน", followUp: ago(-60 * 30), minutesAgo: 60 * 8,
      messages: ["เสาร์นี้เข้าไปดูที่ร้านได้ไหมครับ", "บ่ายสองนะครับ"],
    },
  ];

  const ids: Record<string, number> = {};
  for (const l of leads) {
    profiles.set(l.user, { displayName: l.name });
    const last = l.messages.at(-1) ?? "";
    ids[l.user] = (await q(
      `insert into sidecar.leads (oa_id, line_user_id, display_name, full_name, phone, address, postcode, stage,
         tags, interests, assignee_id, ai_summary, next_action, suggested_reply, follow_up_at,
         last_message_at, last_message_preview, created_at)
       values ('Udevbot', $1, $2, $3, $4, $5, $6, $7,
         array(select jsonb_array_elements_text($8::text::jsonb)), array(select jsonb_array_elements_text($9::text::jsonb)),
         $10, $11, $12, $13, $14::timestamptz, $15::timestamptz, $16, $17::timestamptz) returning id`,
      [l.user, l.name, l.full ?? null, l.phone ?? null, l.address ?? null, l.postcode ?? null, l.stage,
        arr(l.tags ?? []), arr(l.interests ?? []), l.assignee ?? null, l.summary ?? null, l.next ?? null,
        l.reply ?? null, l.followUp ?? null, ago(l.minutesAgo), last.slice(0, 80), ago(l.minutesAgo + 60 * 24)],
    )).rows[0].id;
    for (const [i, text] of l.messages.entries()) {
      await q(
        `insert into sidecar.messages (lead_id, line_message_id, direction, type, text, analysed, sent_at)
         values ($1, $2, 'in', 'text', $3, true, $4::timestamptz)`,
        [ids[l.user], `seed-${l.user}-${i}`, text, ago(l.minutesAgo + (l.messages.length - i))],
      );
    }
    if (l.summary) {
      await q(
        `insert into sidecar.notes (lead_id, body, kind, author_name, created_at) values ($1, $2, 'ai', 'Sidecar', $3::timestamptz)`,
        [ids[l.user], l.summary, ago(l.minutesAgo)],
      );
    }
  }

  const mild = ids.Udemo0001;
  await q(`insert into sidecar.notes (lead_id, body, kind, author_name, pinned) values ($1, $2, 'staff', 'ริต้า (dev)', true)`,
    [mild, "ลูกค้าขอสีดำเท่านั้น ถ้าไม่มีให้โทรแจ้งก่อน"]);
  await q(`insert into sidecar.notes (lead_id, body, kind, author_name) values ($1, $2, 'staff', 'ต้น')`,
    [ids.Udemo0005, "ลูกค้าเก่า เคยซื้อ AirPods เมื่อ 3 เดือนก่อน"]);

  const order = (await q(
    `insert into sidecar.orders (lead_id, status, discount, shipping_fee, payment_method, deposit_amount, note, staff_edited)
     values ($1, 'awaiting_payment', 100, 50, 'transfer', 1000, 'สีดำ', true) returning id`, [mild],
  )).rows[0].id;
  await q(`insert into sidecar.order_items (order_id, product_id, name, qty, unit_price) values ($1, $2, 'iPhone 13 128GB', 1, 13900), ($1, $3, 'เคสใสกันกระแทก', 1, 190)`,
    [order, products["iPhone 13 128GB"], products["เคสใสกันกระแทก"]]);

  const paid = (await q(
    `insert into sidecar.orders (lead_id, status, payment_method, staff_edited) values ($1, 'paid', 'transfer', true) returning id`,
    [ids.Udemo0005],
  )).rows[0].id;
  await q(`insert into sidecar.order_items (order_id, product_id, name, qty, unit_price) values ($1, $2, 'iPad Air 5 64GB', 1, 15900)`,
    [paid, products["iPad Air 5 64GB"]]);

  await q(
    `insert into sidecar.media (lead_id, storage_path, content_type, category, caption, slip) values
       ($1, 'seed/slip-rita.svg', 'image/svg+xml', 'slip', 'สลิปโอนเงิน', $3::text::jsonb),
       ($1, 'seed/doc-rita.svg', 'image/svg+xml', 'document', 'บัตรประชาชน (ตัวอย่าง)', null),
       ($2, 'seed/product-mild.svg', 'image/svg+xml', 'product', 'เครื่องเก่าที่จะเทิร์น', null)`,
    [ids.Udemo0005, mild, JSON.stringify({ amount: 15900, paid_at: ago(60 * 5), bank: "KBank", ref: "SEED0001", matches_order: true })],
  );
}

// The property-agency demo. Project names are public condominium projects; every
// person, phone number and conversation is invented.
async function seedEstate(): Promise<void> {
  const q = (sql: string, params: unknown[] = []) => pg.query<any>(sql, params);
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const arr = (values: string[]) => JSON.stringify(values);

  await q(`update sidecar.settings set value = 'Globallink Estate' where key = 'shop_name'`);
  await q(
    `update sidecar.settings set value = $1 where key = 'payment_instructions'`,
    ["โอนมัดจำเข้าบัญชี ธ.ตัวอย่าง 000-0-00000-0 ชื่อบัญชี บจก.ตัวอย่าง\nโอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ เจ้าหน้าที่จะยืนยันการจองให้ค่ะ"],
  );

  const staff: number[] = [];
  for (const [name, role, token] of [["พิม (dev)", "admin", STAFF_TOKEN], ["ซีซาร์", "agent", "dev-staff-token-2"]]) {
    staff.push((await q(
      `insert into sidecar.staff (name, role, token_hash) values ($1, $2, $3) returning id`,
      [name, role, await sha256Hex(token)],
    )).rows[0].id);
  }

  const units: Record<string, number> = {};
  for (const [sku, name, price, category] of [
    ["RCD-0001", "Kave Town Colony · Studio 23 ตร.ม.", 11000, "เช่า"],
    ["RCD-0002", "Kave Town Colony · Studio 23 ตร.ม. ชั้น 5", 12000, "เช่า"],
    ["RCD-0003", "The Astra Condo · 3 ห้องนอน 98 ตร.ม.", 55000, "เช่า"],
    ["SCD-0001", "The Astra Condo · 3 ห้องนอน 98 ตร.ม. (ขาย)", 10700000, "ขาย"],
    ["SCD-0002", "Riva Condo Sathorn-Taksin · 1 ห้องนอน 35 ตร.ม.", 2580000, "ขาย"],
    ["RCD-0004", "North 8 Condo Chiangmai · 2 ห้องนอน 73 ตร.ม.", 35000, "เช่า"],
    ["RCD-0005", "Modiz Collection Bangpho · 1 ห้องนอน 28 ตร.ม.", 24000, "เช่า"],
    ["RCD-0006", "Sarin Place · 1 ห้องนอน 40 ตร.ม.", 15000, "เช่า"],
  ] as [string, string, number, string][]) {
    units[sku] = (await q(
      `insert into sidecar.products (sku, name, price, category) values ($1, $2, $3, $4) returning id`,
      [sku, name, price, category],
    )).rows[0].id;
  }

  interface SeedLead {
    user: string; name: string; full?: string; phone?: string; stage: string; tags?: string[]; interests?: string[];
    details?: Record<string, string>; assignee?: number; summary?: string; next?: string; reply?: string;
    followUp?: string; minutesAgo: number; messages: string[];
  }
  const leads: SeedLead[] = [
    {
      user: "Ugbl0001", name: "Ploy 🌿", full: "พลอยไพลิน ตัวอย่าง", phone: "0815550111", stage: "awaiting_payment",
      tags: ["นักศึกษา"], interests: ["Kave Town Colony"], assignee: staff[0],
      details: { role: "tenant", intent: "rent", budget: "12,000/เดือน", location: "ใกล้ ม.กรุงเทพ รังสิต", unit_type: "Studio", move_in: "ต้นเดือน ธ.ค.", property_code: "RCD-0001" },
      summary: "หาเช่า Studio ใกล้ ม.กรุงเทพ รังสิต งบ 12,000/เดือน\nตกลงจอง Kave Town Colony Studio 23 ตร.ม. รอโอนมัดจำ 5,000 บาท",
      next: "ตามสลิปมัดจำ ถ้ายังเงียบให้ทักอีกครั้งช่วงเย็น",
      reply: "สวัสดีค่ะคุณพลอย เจ้าหน้าที่กันห้องไว้ให้แล้วนะคะ โอนมัดจำแล้วส่งสลิปในแชทนี้ได้เลยค่ะ",
      followUp: ago(30), minutesAgo: 95,
      messages: ["สวัสดีค่ะ หาห้องเช่าใกล้ ม.กรุงเทพ ค่ะ งบ 12,000", "Kave Town Colony ยังมีห้องว่างไหมคะ", "ชื่อพลอยไพลิน เบอร์ 081-555-0111", "ตกลงจองห้องนี้ค่ะ เดี๋ยวโอนมัดจำให้ตอนเย็น"],
    },
    {
      user: "Ugbl0002", name: "Bank T.", full: "ธนากร ตัวอย่าง", phone: "0825550112", stage: "quoted",
      interests: ["Riva Condo Sathorn-Taksin"], assignee: staff[1],
      details: { role: "buyer", intent: "buy", budget: "ไม่เกิน 3 ล้าน", location: "ใกล้ BTS กรุงธนบุรี", unit_type: "1 ห้องนอน" },
      summary: "หาซื้อ 1 ห้องนอน ใกล้ BTS กรุงธนบุรี งบไม่เกิน 3 ล้าน\nส่งรายละเอียด Riva Condo ให้แล้ว ลูกค้าขอดูรูปห้องจริง",
      next: "ส่งรูปห้องจริงและชวนนัดดูทรัพย์", reply: "ได้เลยครับ เดี๋ยวเจ้าหน้าที่ส่งรูปห้องจริงให้ในแชทนี้ สะดวกเข้าชมห้องช่วงไหนครับ",
      followUp: ago(-60 * 4), minutesAgo: 40,
      messages: ["สนใจซื้อคอนโดใกล้ BTS กรุงธนบุรี งบไม่เกิน 3 ล้านครับ", "ขอดูรูปห้องจริงของ Riva หน่อยครับ"],
    },
    {
      user: "Ugbl0003", name: "คุณลีนา", full: "ลีนา ตัวอย่าง", phone: "0835550113", stage: "interested",
      tags: ["เจ้าของทรัพย์"], interests: ["The Astra Condo"],
      details: { role: "owner", intent: "list_sale", location: "The Astra Condo", unit_type: "3 ห้องนอน", property_code: "SCD-0001" },
      summary: "เจ้าของต้องการฝากขาย The Astra Condo 3 ห้องนอน 98 ตร.ม.\nยังไม่ได้ส่งเอกสารสิทธิ์และรูปห้อง",
      next: "ขอรูปห้องและสำเนาโฉนด แล้วนัดสำรวจทรัพย์", minutesAgo: 60 * 3,
      messages: ["สวัสดีค่ะ อยากฝากขายห้องที่ The Astra Condo ค่ะ", "3 ห้องนอน 98 ตารางเมตร ชั้น 11 ค่ะ"],
    },
    {
      user: "Ugbl0004", name: "Mint", stage: "new", minutesAgo: 4,
      summary: "ลูกค้าทักเข้ามา ยังไม่ระบุความต้องการ", next: "ถามต้องการซื้อ เช่า หรือฝากทรัพย์",
      reply: "สวัสดีค่ะ ยินดีให้บริการค่ะ สนใจหาซื้อ หาเช่า หรือฝากทรัพย์ แจ้งได้เลยนะคะ", messages: ["สวัสดีค่ะ"],
    },
    {
      user: "Ugbl0005", name: "A-Home Agent", full: "อรุณี ตัวอย่าง", phone: "0845550114", stage: "booked",
      tags: ["Co-agent"], interests: ["The Astra Condo"], assignee: staff[0],
      details: { role: "co_agent", intent: "rent", budget: "55,000/เดือน", location: "The Astra Condo", unit_type: "3 ห้องนอน", move_in: "กลางเดือน ธ.ค." },
      summary: "Co-agent มีลูกค้าต่างชาติหาเช่า 3 ห้องนอน งบ 55,000/เดือน\nนัดดูห้อง The Astra Condo วันเสาร์ 14:00",
      next: "ยืนยันนัดล่วงหน้า 1 วัน และเตรียมกุญแจกับนิติ", followUp: ago(-60 * 30), minutesAgo: 60 * 8,
      messages: ["สวัสดีค่ะ เอเจนต์จาก A-Home ค่ะ มีลูกค้าหาเช่า 3 ห้องนอน งบ 55,000", "ขอนัดดูห้องเสาร์นี้บ่ายสองได้ไหมคะ"],
    },
    {
      user: "Ugbl0006", name: "Fah", full: "ฟ้าใส ตัวอย่าง", phone: "0855550115", stage: "interested",
      tags: ["หลังการขาย"], interests: ["Kave Town Colony"], assignee: staff[0],
      details: { role: "resident", intent: "after_sales", location: "Kave Town Colony", property_code: "RCD-0002" },
      summary: "ลูกบ้านแจ้งแอร์น้ำหยด ห้องที่เช่าอยู่ Kave Town Colony\nส่งรูปจุดที่มีปัญหามาแล้ว", next: "ประสานนิติและช่างแอร์ แจ้งเวลานัดกลับ",
      reply: "รับเรื่องแล้วนะคะ เจ้าหน้าที่จะประสานช่างและแจ้งเวลานัดกลับในแชทนี้ค่ะ", followUp: ago(15), minutesAgo: 70,
      messages: ["แอร์ในห้องน้ำหยดค่ะ ช่วยดูให้หน่อยได้ไหมคะ", "ส่งรูปให้แล้วนะคะ"],
    },
    {
      user: "Ugbl0007", name: "คุณหนึ่ง", full: "หนึ่งฤทัย ตัวอย่าง", phone: "0865550116", stage: "won",
      tags: ["เจ้าของทรัพย์"], interests: ["Kave Town Colony"],
      details: { role: "owner", intent: "list_rent", location: "Kave Town Colony", unit_type: "Studio", property_code: "RCD-0001" },
      summary: "เจ้าของฝากเช่า Kave Town Colony Studio เซ็นสัญญาฝากเรียบร้อย ลงประกาศแล้ว", next: "ไม่มี", minutesAgo: 60 * 24 * 6,
      messages: ["ฝากเช่าห้อง Studio ที่ Kave Town Colony ค่ะ", "เซ็นสัญญาฝากแล้วนะคะ ขอบคุณค่ะ"],
    },
    {
      user: "Ugbl0008", name: "Tan KU", stage: "interested",
      details: { role: "tenant", intent: "rent", budget: "8,000-10,000/เดือน", location: "ใกล้ ม.เกษตร บางเขน", move_in: "ม.ค." },
      summary: "นักศึกษาหาเช่าใกล้ ม.เกษตร บางเขน งบ 8,000-10,000/เดือน เข้าอยู่ ม.ค.", next: "ส่งทรัพย์ที่ตรงความต้องการ 2-3 รายการ แล้วชวนนัดดู",
      reply: "ขอบคุณครับ เจ้าหน้าที่จะตรวจสอบห้องว่างใกล้ ม.เกษตร และส่งรายละเอียดให้ในแชทนี้นะครับ",
      followUp: ago(-60 * 20), minutesAgo: 12,
      messages: ["หาห้องเช่าใกล้ ม.เกษตร ครับ งบ 8,000-10,000", "เข้าอยู่ ม.ค. ครับ"],
    },
    {
      user: "Ugbl0009", name: "Mew", full: "มิว ตัวอย่าง", phone: "0875550117", stage: "paid",
      interests: ["Sarin Place"], assignee: staff[1],
      details: { role: "tenant", intent: "rent", budget: "15,000/เดือน", location: "Sarin Place", unit_type: "1 ห้องนอน", move_in: "1 ธ.ค.", property_code: "RCD-0006" },
      summary: "วางมัดจำ Sarin Place 1 ห้องนอน แล้ว รอนัดเซ็นสัญญาเช่า", next: "นัดวันเซ็นสัญญาและส่งมอบห้อง", minutesAgo: 60 * 5,
      messages: ["โอนมัดจำแล้วนะคะ", "เซ็นสัญญาได้วันไหนคะ"],
    },
    {
      user: "Ugbl0010", name: "Jane", stage: "lost",
      details: { role: "tenant", intent: "rent", budget: "24,000/เดือน", location: "Modiz Collection Bangpho" },
      interests: ["Modiz Collection Bangpho"], summary: "ลูกค้าแจ้งว่าได้ห้องที่อื่นแล้ว", next: "ไม่ต้องตาม",
      minutesAgo: 60 * 26, messages: ["สนใจ Modiz Collection Bangpho ค่ะ", "ขอโทษนะคะ ได้ห้องที่อื่นแล้วค่ะ"],
    },
    {
      user: "Ugbl0011", name: "Sales DO More", stage: "spam", summary: "ข้อความโฆษณา ไม่เกี่ยวกับทรัพย์",
      next: "ไม่ต้องตอบ", minutesAgo: 60 * 24 * 9, messages: ["รับทำการตลาดออนไลน์ เพิ่มยอดขาย 10 เท่า สนใจทักเลย"],
    },
  ];

  const ids: Record<string, number> = {};
  for (const l of leads) {
    profiles.set(l.user, { displayName: l.name });
    const last = l.messages.at(-1) ?? "";
    ids[l.user] = (await q(
      `insert into sidecar.leads (oa_id, line_user_id, display_name, full_name, phone, stage,
         tags, interests, details, assignee_id, ai_summary, next_action, suggested_reply, follow_up_at,
         last_message_at, last_message_preview, created_at)
       values ('Udevbot', $1, $2, $3, $4, $5,
         array(select jsonb_array_elements_text($6::text::jsonb)), array(select jsonb_array_elements_text($7::text::jsonb)),
         $8::text::jsonb, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz, $15, $16::timestamptz) returning id`,
      [l.user, l.name, l.full ?? null, l.phone ?? null, l.stage, arr(l.tags ?? []), arr(l.interests ?? []),
        JSON.stringify(l.details ?? {}), l.assignee ?? null, l.summary ?? null, l.next ?? null, l.reply ?? null,
        l.followUp ?? null, ago(l.minutesAgo), last.slice(0, 80), ago(l.minutesAgo + 60 * 24)],
    )).rows[0].id;
    for (const [i, text] of l.messages.entries()) {
      await q(
        `insert into sidecar.messages (lead_id, line_message_id, direction, type, text, analysed, sent_at)
         values ($1, $2, 'in', 'text', $3, true, $4::timestamptz)`,
        [ids[l.user], `seed-${l.user}-${i}`, text, ago(l.minutesAgo + (l.messages.length - i))],
      );
    }
    if (l.summary) {
      await q(
        `insert into sidecar.notes (lead_id, body, kind, author_name, created_at) values ($1, $2, 'ai', 'Sidecar', $3::timestamptz)`,
        [ids[l.user], l.summary, ago(l.minutesAgo)],
      );
    }
  }

  const ploy = ids.Ugbl0001;
  await q(`insert into sidecar.notes (lead_id, body, kind, author_name, pinned) values ($1, $2, 'staff', 'พิม (dev)', true)`,
    [ploy, "ผู้ปกครองเป็นคนโอนมัดจำ ขอใบรับเงินในชื่อผู้ปกครอง"]);
  await q(`insert into sidecar.notes (lead_id, body, kind, author_name) values ($1, $2, 'staff', 'ซีซาร์')`,
    [ids.Ugbl0005, "Co-agent 50% ตามเงื่อนไขบริษัท แจ้งแล้ว"]);

  // The open offer: one unit, a 5,000 deposit to reserve it.
  const offer = (await q(
    `insert into sidecar.orders (lead_id, status, payment_method, deposit_amount, note, staff_edited)
     values ($1, 'awaiting_payment', 'transfer', 5000, 'สัญญา 12 เดือน เข้าอยู่ต้นเดือน ธ.ค.', true) returning id`, [ploy],
  )).rows[0].id;
  await q(`insert into sidecar.order_items (order_id, product_id, name, qty, unit_price) values ($1, $2, $3, 1, 11000)`,
    [offer, units["RCD-0001"], "Kave Town Colony · Studio 23 ตร.ม."]);

  const reserved = (await q(
    `insert into sidecar.orders (lead_id, status, payment_method, deposit_amount, staff_edited)
     values ($1, 'paid', 'transfer', 5000, true) returning id`, [ids.Ugbl0009],
  )).rows[0].id;
  await q(`insert into sidecar.order_items (order_id, product_id, name, qty, unit_price) values ($1, $2, $3, 1, 15000)`,
    [reserved, units["RCD-0006"], "Sarin Place · 1 ห้องนอน 40 ตร.ม."]);

  await q(
    `insert into sidecar.media (lead_id, storage_path, content_type, category, caption, slip) values
       ($1, 'seed/slip-mew.svg', 'image/svg+xml', 'slip', 'สลิปโอนมัดจำ', $5::text::jsonb),
       ($1, 'seed/doc-mew.svg', 'image/svg+xml', 'document', 'บัตรประชาชน (ตัวอย่าง)', null),
       ($2, 'seed/room-fah-1.svg', 'image/svg+xml', 'before_after', 'แอร์น้ำหยดบริเวณหัวเตียง', null),
       ($2, 'seed/room-fah-2.svg', 'image/svg+xml', 'before_after', 'คราบน้ำบนผนัง', null),
       ($3, 'seed/unit-leena-1.svg', 'image/svg+xml', 'product', 'ห้องนั่งเล่น The Astra Condo', null),
       ($3, 'seed/unit-leena-2.svg', 'image/svg+xml', 'product', 'ห้องนอนใหญ่', null),
       ($4, 'seed/unit-bank.svg', 'image/svg+xml', 'product', 'รูปประกาศที่ลูกค้าส่งมาถาม', null)`,
    [ids.Ugbl0009, ids.Ugbl0006, ids.Ugbl0003, ids.Ugbl0002,
      JSON.stringify({ amount: 5000, paid_at: ago(60 * 5), bank: "KBank", ref: "SEED0001", matches_order: true })],
  );
}

await (ESTATE ? seedEstate() : seed());

// ---- wiring ----

const deps: Deps = {
  db: { query: (sql, params) => pg.query(sql, params as any[]) as Promise<{ rows: any[] }> },
  env: {
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "dev", SIDECAR_ADMIN_KEY: ADMIN_KEY, DEBOUNCE_MS: "300",
    ...(ESTATE ? { PROFILE: "real_estate" } : {}),
  },
  line: {
    getProfile: async (userId) => profiles.get(userId) ?? { displayName: `ลูกค้า ${userId.slice(-4)}` },
    getContent: async (messageId) => ({ bytes: lineContent.get(messageId) ?? new Uint8Array(), contentType: "image/png" }),
    verifyIdToken: async (token) => (token.startsWith("dev-line:") ? { sub: token.slice(9), name: "dev" } : null),
  },
  storage: {
    upload: async (path, bytes, contentType) => { stored.set(path, { bytes, contentType }); },
    signedUrl: async (path) => mediaUrl(path),
  },
  brain,
  defer: (p) => { p.catch((err) => console.error("[dev] background task failed", err)); },
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  missing: [],
};

let counter = 0;

async function simulateLineMessage(body: any): Promise<Response> {
  const userId = String(body.userId ?? "").trim();
  if (!userId) return Response.json({ ok: false, error: "bad_request", message: "userId is required" }, { status: 400 });
  if (body.displayName) profiles.set(userId, { displayName: String(body.displayName) });
  const id = `dev-${Date.now()}-${++counter}`;
  let message: Record<string, unknown>;
  if (body.image) {
    lineContent.set(id, new TextEncoder().encode(JSON.stringify(body.image)));
    message = { id, type: "image" };
  } else {
    message = { id, type: "text", text: String(body.text ?? "") };
  }
  const raw = JSON.stringify({
    destination: "Udevbot",
    events: [{ type: "message", webhookEventId: id, timestamp: Date.now(), source: { type: "user", userId }, message }],
  });
  return handle(new Request(`http://localhost:${PORT}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-line-signature": await hmacSha256Base64(SECRET, raw) },
    body: raw,
  }), deps);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8",
};

async function staticFile(pathname: string): Promise<Response | null> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "") || "index.html";
  const file = resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + "/")) return null;
  if (rel.startsWith("node_modules") || rel.startsWith(".")) return null;
  try {
    return new Response(await readFile(file), {
      headers: { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch {
    return null;
  }
}

const isApp = (path: string) =>
  path === "/health" || path === "/webhook" || path === "/api" || path.startsWith("/api/") ||
  path.startsWith("/sidecar/") || path.startsWith("/functions/v1/");

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    });

    let response: Response;
    if (url.pathname === "/dev/line-message" && req.method === "POST") {
      response = await simulateLineMessage(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    } else if (req.method === "OPTIONS" || isApp(url.pathname)) {
      response = await handle(request, deps);
    } else {
      response = (req.method === "GET" ? await staticFile(url.pathname) : null) ?? await handle(request, deps);
    }

    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error("[dev] request failed", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "internal", message: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Sidecar dev API  http://localhost:${PORT}   (profile: ${ESTATE ? "real_estate" : "retail"})`);
  console.log(`  staff token    ${STAFF_TOKEN}   (admin; agent token: dev-staff-token-2)`);
  console.log(`  admin key      ${ADMIN_KEY}`);
  console.log(`  try            curl -H "Authorization: Bearer ${STAFF_TOKEN}" http://localhost:${PORT}/api/leads`);
  console.log(`  simulate       curl -X POST http://localhost:${PORT}/dev/line-message -H "Content-Type: application/json" \\`);
  console.log(ESTATE
    ? `                   -d '{"userId":"Unew1","displayName":"ลูกค้าใหม่","text":"หาห้องเช่าใกล้ BTS กรุงธนบุรี งบ 15,000 ค่ะ เบอร์ 0891234567"}'`
    : `                   -d '{"userId":"Unew1","displayName":"ลูกค้าใหม่","text":"สนใจ iPhone 13 ค่ะ เบอร์ 0891234567"}'`);
});
