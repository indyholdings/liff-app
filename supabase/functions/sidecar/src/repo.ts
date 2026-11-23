// All SQL lives here. Queries use $n parameters and run unchanged on postgres.js
// (edge function) and PGlite (tests, dev server).
//
// Three conventions keep the two drivers in step:
//   - arrays and jsonb go in as JSON text ($n::text::jsonb), so no driver-specific
//     array or json encoding is involved;
//   - arrays come out as to_jsonb(col), numerics as ::float8, so JSON gets plain
//     arrays and numbers;
//   - ids are int4, counts are cast to int.

import type {
  Db, Lead, LeadLite, Media, MediaCategory, Msg, Note, Order, OrderItem, OrderStatus,
  PaymentMethod, Product, Settings, SlipInfo, Staff, Stage,
} from "./types.ts";
import { STAGES } from "./types.ts";
import { round2 } from "./util.ts";

const LEAD_COLS = `
  l.id, l.line_user_id, l.chat_id, l.display_name, l.picture_url,
  l.full_name, l.phone, l.address, l.postcode, l.stage,
  to_jsonb(l.tags) as tags, to_jsonb(l.interests) as interests,
  l.assignee_id, s.name as assignee_name,
  l.ai_summary, l.next_action, l.suggested_reply, l.follow_up_at,
  to_jsonb(l.locked_fields) as locked_fields,
  l.last_message_at, l.last_message_preview, l.created_at, l.updated_at`;
const LEAD_FROM = `from sidecar.leads l left join sidecar.staff s on s.id = l.assignee_id`;
const LITE_COLS = `l.id, l.display_name, l.full_name, l.phone, l.picture_url, l.stage, l.last_message_at`;
const TEXT_ARRAY = (n: number) => `array(select jsonb_array_elements_text($${n}::text::jsonb))`;

async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const { rows } = await db.query(sql, params);
  return (rows[0] as T) ?? null;
}

async function many<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query(sql, params);
  return rows as T[];
}

// ---- staff ----

export function staffByTokenHash(db: Db, hash: string) {
  return one<Staff>(db, `select id, name, role from sidecar.staff where token_hash = $1 and active`, [hash]);
}

export function staffByLineUser(db: Db, lineUserId: string) {
  return one<Staff>(db, `select id, name, role from sidecar.staff where line_user_id = $1 and active`, [lineUserId]);
}

export function staffById(db: Db, id: number) {
  return one<Staff>(db, `select id, name, role from sidecar.staff where id = $1 and active`, [id]);
}

export function listStaff(db: Db) {
  return many<Staff>(db, `select id, name, role from sidecar.staff where active order by name, id`);
}

export function createStaff(db: Db, name: string, role: string, tokenHash: string) {
  return one<Staff>(
    db,
    `insert into sidecar.staff (name, role, token_hash) values ($1, $2, $3) returning id, name, role`,
    [name, role, tokenHash],
  ) as Promise<Staff>;
}

export async function bindStaffLine(db: Db, staffId: number, lineUserId: string): Promise<Staff> {
  await db.query(`update sidecar.staff set line_user_id = null where line_user_id = $1 and id <> $2`, [lineUserId, staffId]);
  return await one<Staff>(
    db, `update sidecar.staff set line_user_id = $2 where id = $1 returning id, name, role`, [staffId, lineUserId],
  ) as Staff;
}

// ---- leads ----

export function leadById(db: Db, id: number) {
  return one<Lead>(db, `select ${LEAD_COLS} ${LEAD_FROM} where l.id = $1`, [id]);
}

export async function leadByChat(db: Db, chatId: string): Promise<Lead | null> {
  return (await one<Lead>(db, `select ${LEAD_COLS} ${LEAD_FROM} where l.line_user_id = $1`, [chatId])) ??
    (await one<Lead>(db, `select ${LEAD_COLS} ${LEAD_FROM} where l.chat_id = $1 order by l.id limit 1`, [chatId]));
}

export function leadsByDisplayName(db: Db, name: string) {
  return many<LeadLite>(
    db,
    `select ${LITE_COLS} from sidecar.leads l where lower(l.display_name) = lower($1)
     order by l.last_message_at desc nulls last, l.id desc limit 10`,
    [name],
  );
}

export function leadsWithPhone(db: Db, phone: string, exceptId: number) {
  return many<LeadLite>(
    db,
    `select ${LITE_COLS} from sidecar.leads l where l.phone = $1 and l.id <> $2
     order by l.last_message_at desc nulls last, l.id desc limit 10`,
    [phone, exceptId],
  );
}

export interface LeadFilter { stage?: Stage; q?: string; due?: boolean; limit: number; offset: number; now: Date; }

export async function listLeads(db: Db, f: LeadFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.stage) { params.push(f.stage); where.push(`l.stage = $${params.length}`); }
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    const n = params.length;
    where.push(`(l.display_name ilike $${n} or l.full_name ilike $${n} or l.phone ilike $${n})`);
  }
  if (f.due) { params.push(f.now.toISOString()); where.push(`l.follow_up_at <= $${params.length}::timestamptz`); }
  params.push(f.limit, f.offset);
  const leads = await many<Lead>(
    db,
    `select ${LEAD_COLS} ${LEAD_FROM} ${where.length ? "where " + where.join(" and ") : ""}
     order by l.last_message_at desc nulls last, l.id desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const row of await many<{ stage: Stage; n: number }>(
    db, `select stage, count(*)::int as n from sidecar.leads group by stage`,
  )) counts[row.stage] = row.n;
  const due = await one<{ n: number }>(
    db, `select count(*)::int as n from sidecar.leads where follow_up_at <= $1::timestamptz`, [f.now.toISOString()],
  );
  return { leads, counts, due_count: due?.n ?? 0 };
}

// Creates the lead on first contact. `inserted` tells the caller to fetch the LINE profile.
export function upsertLeadByLineUser(db: Db, lineUserId: string, oaId: string | null) {
  return one<{ id: number; display_name: string | null; inserted: boolean }>(
    db,
    `insert into sidecar.leads (line_user_id, oa_id) values ($1, $2)
     on conflict (line_user_id) do update set oa_id = coalesce(excluded.oa_id, sidecar.leads.oa_id)
     returning id, display_name, (xmax = 0) as inserted`,
    [lineUserId, oaId],
  ) as Promise<{ id: number; display_name: string | null; inserted: boolean }>;
}

const TEXT_COLUMNS = new Set([
  "display_name", "picture_url", "full_name", "phone", "address", "postcode", "stage",
  "chat_id", "ai_summary", "next_action", "suggested_reply", "last_message_preview",
]);
const ARRAY_COLUMNS = new Set(["tags", "interests", "locked_fields"]);
const TIME_COLUMNS = new Set(["follow_up_at", "last_message_at", "processing_at"]);

// Partial update. Keys outside the whitelists are ignored.
export async function updateLead(db: Db, id: number, patch: Record<string, unknown>, now: Date): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (TEXT_COLUMNS.has(key)) { params.push(value); sets.push(`${key} = $${params.length}`); }
    else if (ARRAY_COLUMNS.has(key)) { params.push(JSON.stringify(value ?? [])); sets.push(`${key} = ${TEXT_ARRAY(params.length)}`); }
    else if (TIME_COLUMNS.has(key)) { params.push(value); sets.push(`${key} = $${params.length}::timestamptz`); }
    else if (key === "assignee_id") { params.push(value); sets.push(`assignee_id = $${params.length}`); }
  }
  if (!sets.length) return;
  params.push(now.toISOString());
  sets.push(`updated_at = $${params.length}::timestamptz`);
  await db.query(`update sidecar.leads set ${sets.join(", ")} where id = $1`, params);
}

export async function linkChat(db: Db, leadId: number, chatId: string, now: Date): Promise<void> {
  await db.query(`update sidecar.leads set chat_id = null where chat_id = $1 and id <> $2`, [chatId, leadId]);
  await updateLead(db, leadId, { chat_id: chatId }, now);
}

// Takes the analysis slot for a lead. A slot older than two minutes is treated as abandoned.
export async function claimLead(db: Db, leadId: number, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - 120_000).toISOString();
  const row = await one(
    db,
    `update sidecar.leads set processing_at = $2::timestamptz
     where id = $1 and (processing_at is null or processing_at < $3::timestamptz) returning id`,
    [leadId, now.toISOString(), stale],
  );
  return row !== null;
}

export async function releaseLead(db: Db, leadId: number): Promise<void> {
  await db.query(`update sidecar.leads set processing_at = null where id = $1`, [leadId]);
}

// ---- webhook events and messages ----

// True the first time an event id is seen, false on a LINE redelivery.
export async function recordWebhookEvent(db: Db, eventId: string): Promise<boolean> {
  const row = await one(
    db,
    `insert into sidecar.webhook_events (webhook_event_id) values ($1)
     on conflict (webhook_event_id) do nothing returning webhook_event_id`,
    [eventId],
  );
  return row !== null;
}

export async function forgetWebhookEvent(db: Db, eventId: string): Promise<void> {
  await db.query(`delete from sidecar.webhook_events where webhook_event_id = $1`, [eventId]);
}

export interface NewMessage {
  lead_id: number; line_message_id: string | null; direction: "in" | "out";
  type: Msg["type"]; text: string | null; sent_at: Date;
}

// Returns null when the LINE message id is already stored.
export async function insertMessage(db: Db, m: NewMessage): Promise<number | null> {
  const row = await one<{ id: number }>(
    db,
    `insert into sidecar.messages (lead_id, line_message_id, direction, type, text, sent_at)
     values ($1, $2, $3, $4, $5, $6::timestamptz)
     on conflict (line_message_id) do nothing returning id`,
    [m.lead_id, m.line_message_id, m.direction, m.type, m.text, m.sent_at.toISOString()],
  );
  return row?.id ?? null;
}

export async function setMessageMedia(db: Db, messageId: number, mediaId: number): Promise<void> {
  await db.query(`update sidecar.messages set media_id = $2 where id = $1`, [messageId, mediaId]);
}

export async function latestInboundMessageId(db: Db, leadId: number): Promise<number | null> {
  const row = await one<{ id: number | null }>(
    db, `select max(id)::int as id from sidecar.messages where lead_id = $1 and direction = 'in'`, [leadId],
  );
  return row?.id ?? null;
}

export interface MsgForBrain extends Msg { analysed: boolean; media_category: string | null; media_caption: string | null; }

// Last `limit` messages, oldest first.
export async function recentMessages(db: Db, leadId: number, limit = 30): Promise<MsgForBrain[]> {
  const rows = await many<MsgForBrain>(
    db,
    `select m.id, m.direction, m.type, m.text, m.media_id, m.sent_at, m.analysed,
            md.category as media_category, md.caption as media_caption
     from sidecar.messages m left join sidecar.media md on md.id = m.media_id
     where m.lead_id = $1 order by m.id desc limit $2`,
    [leadId, limit],
  );
  return rows.reverse();
}

export async function markAnalysed(db: Db, leadId: number, upToMessageId: number): Promise<void> {
  await db.query(
    `update sidecar.messages set analysed = true where lead_id = $1 and id <= $2 and not analysed`,
    [leadId, upToMessageId],
  );
}

// ---- notes ----

const NOTE_COLS = `id, lead_id, body, kind, author_name, pinned, created_at`;

export function listNotes(db: Db, leadId: number) {
  return many<Note>(
    db, `select ${NOTE_COLS} from sidecar.notes where lead_id = $1 order by pinned desc, id desc limit 200`, [leadId],
  );
}

export function addNote(db: Db, leadId: number, body: string, kind: Note["kind"], authorName: string | null, pinned = false) {
  return one<Note>(
    db,
    `insert into sidecar.notes (lead_id, body, kind, author_name, pinned) values ($1, $2, $3, $4, $5)
     returning ${NOTE_COLS}`,
    [leadId, body, kind, authorName, pinned],
  ) as Promise<Note>;
}

// Only staff notes can be deleted: agent and system notes are the record of what
// happened on the lead. An agent removes their own notes; an admin any staff note.
export async function deleteNote(db: Db, id: number, by: { name: string; isAdmin: boolean }): Promise<boolean> {
  return (await one(
    db,
    `delete from sidecar.notes
      where id = $1 and kind = 'staff' and ($2::boolean or author_name = $3)
      returning id`,
    [id, by.isAdmin, by.name],
  )) !== null;
}

// ---- media ----

export interface MediaRow {
  id: number; lead_id: number; storage_path: string; category: MediaCategory;
  caption: string | null; slip: SlipInfo | null; created_at: Date | string;
}
const MEDIA_COLS = `id, lead_id, storage_path, category, caption, slip, created_at`;

export function listMedia(db: Db, leadId: number) {
  return many<MediaRow>(
    db, `select ${MEDIA_COLS} from sidecar.media where lead_id = $1 order by id desc limit 200`, [leadId],
  );
}

export function mediaById(db: Db, id: number) {
  return one<MediaRow>(db, `select ${MEDIA_COLS} from sidecar.media where id = $1`, [id]);
}

export function insertMedia(db: Db, leadId: number, storagePath: string, contentType: string) {
  return one<MediaRow>(
    db,
    `insert into sidecar.media (lead_id, storage_path, content_type) values ($1, $2, $3) returning ${MEDIA_COLS}`,
    [leadId, storagePath, contentType],
  ) as Promise<MediaRow>;
}

export function updateMedia(
  db: Db, id: number,
  patch: { category?: MediaCategory; caption?: string | null; slip?: SlipInfo | null },
) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (patch.category !== undefined) { params.push(patch.category); sets.push(`category = $${params.length}`); }
  if (patch.caption !== undefined) { params.push(patch.caption); sets.push(`caption = $${params.length}`); }
  if (patch.slip !== undefined) {
    params.push(patch.slip === null ? null : JSON.stringify(patch.slip));
    sets.push(`slip = $${params.length}::text::jsonb`);
  }
  if (!sets.length) return mediaById(db, id);
  return one<MediaRow>(db, `update sidecar.media set ${sets.join(", ")} where id = $1 returning ${MEDIA_COLS}`, params);
}

export async function toMedia(row: MediaRow, signedUrl: (path: string, expiresSec: number) => Promise<string>): Promise<Media> {
  return {
    id: row.id, lead_id: row.lead_id, url: await signedUrl(row.storage_path, 3600),
    category: row.category, caption: row.caption, slip: row.slip, created_at: row.created_at,
  };
}

// ---- products and settings ----

const PRODUCT_COLS = `id, sku, name, price::float8 as price, category, active`;

export function listProducts(db: Db, opts: { q?: string; includeInactive?: boolean } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeInactive) where.push(`active`);
  if (opts.q) {
    params.push(`%${opts.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    where.push(`(name ilike $1 or sku ilike $1 or category ilike $1)`);
  }
  return many<Product>(
    db,
    `select ${PRODUCT_COLS} from sidecar.products ${where.length ? "where " + where.join(" and ") : ""}
     order by lower(name), id limit 300`,
    params,
  );
}

export function createProduct(db: Db, p: { sku: string | null; name: string; price: number; category: string | null }) {
  return one<Product>(
    db,
    `insert into sidecar.products (sku, name, price, category) values ($1, $2, $3, $4) returning ${PRODUCT_COLS}`,
    [p.sku, p.name, p.price, p.category],
  ) as Promise<Product>;
}

export function updateProduct(
  db: Db, id: number,
  patch: { name?: string; price?: number; category?: string | null; active?: boolean; sku?: string | null },
) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const key of ["name", "price", "category", "active", "sku"] as const) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (!sets.length) return one<Product>(db, `select ${PRODUCT_COLS} from sidecar.products where id = $1`, [id]);
  return one<Product>(db, `update sidecar.products set ${sets.join(", ")} where id = $1 returning ${PRODUCT_COLS}`, params);
}

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await many<{ key: string; value: string }>(db, `select key, value from sidecar.settings`);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { shop_name: map.shop_name ?? "", payment_instructions: map.payment_instructions ?? "" };
}

export async function putSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  for (const key of ["shop_name", "payment_instructions"] as const) {
    if (typeof patch[key] !== "string") continue;
    await db.query(
      `insert into sidecar.settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      [key, patch[key]],
    );
  }
  return getSettings(db);
}

// ---- orders ----

interface OrderRow {
  id: number; lead_id: number; status: OrderStatus; discount: number; shipping_fee: number;
  payment_method: PaymentMethod | null; deposit_amount: number | null; note: string | null;
  staff_edited: boolean; created_at: Date | string; updated_at: Date | string;
}
const ORDER_COLS = `id, lead_id, status, discount::float8 as discount, shipping_fee::float8 as shipping_fee,
  payment_method, deposit_amount::float8 as deposit_amount, note, staff_edited, created_at, updated_at`;

export type OrderWithFlag = Order & { staff_edited: boolean };

async function hydrateOrder(db: Db, row: OrderRow | null): Promise<OrderWithFlag | null> {
  if (!row) return null;
  const items = await many<OrderItem>(
    db,
    `select id, product_id, name, qty, unit_price::float8 as unit_price
     from sidecar.order_items where order_id = $1 order by id`,
    [row.id],
  );
  const subtotal = round2(items.reduce((sum, it) => sum + it.qty * it.unit_price, 0));
  return {
    id: row.id, lead_id: row.lead_id, status: row.status, items,
    discount: row.discount, shipping_fee: row.shipping_fee,
    subtotal, total: round2(subtotal - row.discount + row.shipping_fee),
    payment_method: row.payment_method, deposit_amount: row.deposit_amount, note: row.note,
    created_at: row.created_at, updated_at: row.updated_at, staff_edited: row.staff_edited,
  };
}

export async function orderById(db: Db, id: number) {
  return hydrateOrder(db, await one<OrderRow>(db, `select ${ORDER_COLS} from sidecar.orders where id = $1`, [id]));
}

// The order still being worked on: draft or awaiting payment.
export async function openOrder(db: Db, leadId: number) {
  return hydrateOrder(db, await one<OrderRow>(
    db,
    `select ${ORDER_COLS} from sidecar.orders
     where lead_id = $1 and status in ('draft', 'awaiting_payment') order by id desc limit 1`,
    [leadId],
  ));
}

// What the card shows: the open order, else the latest one.
export async function currentOrder(db: Db, leadId: number) {
  return (await openOrder(db, leadId)) ??
    hydrateOrder(db, await one<OrderRow>(
      db, `select ${ORDER_COLS} from sidecar.orders where lead_id = $1 order by id desc limit 1`, [leadId],
    ));
}

export interface OrderInput {
  items: { product_id: number | null; name: string; qty: number; unit_price: number }[];
  discount: number; shipping_fee: number; payment_method: PaymentMethod | null;
  deposit_amount: number | null; note: string | null;
}

// Writes the lead's open order, creating a draft when there is none.
export async function saveOpenOrder(
  db: Db, leadId: number, input: OrderInput, staffEdited: boolean, now: Date,
): Promise<OrderWithFlag> {
  const existing = await openOrder(db, leadId);
  let orderId: number;
  if (existing) {
    orderId = existing.id;
    await db.query(
      `update sidecar.orders set discount = $2, shipping_fee = $3, payment_method = $4, deposit_amount = $5,
         note = $6, staff_edited = staff_edited or $7, updated_at = $8::timestamptz where id = $1`,
      [orderId, input.discount, input.shipping_fee, input.payment_method, input.deposit_amount,
        input.note, staffEdited, now.toISOString()],
    );
    await db.query(`delete from sidecar.order_items where order_id = $1`, [orderId]);
  } else {
    const row = await one<{ id: number }>(
      db,
      `insert into sidecar.orders (lead_id, discount, shipping_fee, payment_method, deposit_amount, note, staff_edited)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [leadId, input.discount, input.shipping_fee, input.payment_method, input.deposit_amount, input.note, staffEdited],
    );
    orderId = row!.id;
  }
  for (const it of input.items) {
    await db.query(
      `insert into sidecar.order_items (order_id, product_id, name, qty, unit_price) values ($1, $2, $3, $4, $5)`,
      [orderId, it.product_id, it.name, it.qty, it.unit_price],
    );
  }
  return (await orderById(db, orderId))!;
}

export async function setOrderStatus(db: Db, orderId: number, status: OrderStatus, now: Date) {
  await db.query(
    `update sidecar.orders set status = $2, staff_edited = true, updated_at = $3::timestamptz where id = $1`,
    [orderId, status, now.toISOString()],
  );
  return orderById(db, orderId);
}
