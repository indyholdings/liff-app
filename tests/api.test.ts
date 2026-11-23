import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_KEY, BASE, createDb, createHarness, emptyAnalysis, leadRow, resetDb, type Harness, type TestDb } from "./helpers.ts";
import { handle } from "../supabase/functions/sidecar/src/router.ts";

let pg: TestDb;
let h: Harness;
before(async () => { pg = await createDb(); });
after(async () => { await pg.close(); });
beforeEach(async () => {
  await resetDb(pg);
  h = createHarness(pg);
  await h.seedStaff();
});

async function newLead(userId: string, text = "สวัสดีค่ะ", name?: string): Promise<number> {
  if (name) h.profiles.set(userId, { displayName: name });
  await h.webhook([h.textEvent(userId, text)]);
  await h.settle();
  return (await leadRow(pg, userId)).id;
}

describe("routing, CORS and auth", () => {
  it("serves /health with and without the Supabase path prefix", async () => {
    for (const path of ["/health", "/sidecar/health", "/functions/v1/sidecar/health"]) {
      const res = await handle(new Request(BASE + path), h.deps);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(typeof body.version, "string");
      assert.deepEqual(body.missing, []);
    }
  });

  it("reports missing secret names on /health", async () => {
    h.deps.missing = ["LINE_CHANNEL_SECRET"];
    const body = await (await handle(new Request(BASE + "/health"), h.deps)).json();
    assert.equal(body.ok, true);
    assert.equal(body.configured, false);
    assert.deepEqual(body.missing, ["LINE_CHANNEL_SECRET"]);
  });

  it("answers OPTIONS with 204 and sends CORS headers on every response", async () => {
    const pre = await handle(new Request(BASE + "/api/leads", { method: "OPTIONS" }), h.deps);
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    assert.match(pre.headers.get("access-control-allow-headers")!, /authorization, content-type, x-line-id-token, x-admin-key/);
    assert.match(pre.headers.get("access-control-allow-methods")!, /PATCH/);
    const err = await handle(new Request(BASE + "/api/me"), h.deps);
    assert.equal(err.status, 401);
    assert.equal(err.headers.get("access-control-allow-origin"), "*");
  });

  it("rejects a missing or unknown token on every staff route", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/me"], ["GET", "/api/leads"], ["GET", "/api/leads/1"], ["GET", "/api/leads/by-chat/U1"],
      ["PATCH", "/api/leads/1"], ["POST", "/api/leads/1/link-chat"], ["POST", "/api/leads/1/analyze"],
      ["POST", "/api/leads/1/notes"], ["DELETE", "/api/notes/1"], ["PATCH", "/api/media/1"],
      ["PUT", "/api/leads/1/order"], ["POST", "/api/orders/1/status"], ["GET", "/api/leads/1/summary"],
      ["GET", "/api/products"], ["POST", "/api/products"], ["PATCH", "/api/products/1"],
      ["GET", "/api/settings"], ["PUT", "/api/settings"], ["POST", "/api/staff/link-line"], ["GET", "/api/staff"],
      ["GET", "/api/nope"],
    ];
    for (const [method, path] of routes) {
      const none = await h.api(method, path, method === "GET" || method === "DELETE" ? undefined : {}, { Authorization: "" });
      assert.equal(none.status, 401, `${method} ${path} without a token`);
      assert.equal(none.body.ok, false);
      assert.equal(none.body.error, "unauthorized");
      const wrong = await h.api(method, path, method === "GET" || method === "DELETE" ? undefined : {}, { Authorization: "Bearer nope" });
      assert.equal(wrong.status, 401, `${method} ${path} with a wrong token`);
    }
  });

  it("returns 404 for unknown routes and ids", async () => {
    assert.equal((await h.api("GET", "/api/nope")).status, 404);
    assert.equal((await h.api("GET", "/api/leads/999")).status, 404);
    assert.equal((await handle(new Request(BASE + "/nothing"), h.deps)).status, 404);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await handle(new Request(BASE + "/api/products", {
      method: "POST", headers: { Authorization: "Bearer test-staff-token" }, body: "{oops",
    }), h.deps);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "bad_request");
  });
});

describe("staff tokens", () => {
  it("mints a token with the admin key, usable once issued", async () => {
    const res = await h.api("POST", "/api/admin/staff", { name: "ต้น", role: "agent" }, { Authorization: "", "X-Admin-Key": ADMIN_KEY });
    assert.equal(res.status, 200);
    assert.equal(res.body.staff.name, "ต้น");
    assert.match(res.body.token, /^sc_[A-Za-z0-9_-]{40,}$/);
    const stored = (await pg.query(`select token_hash from sidecar.staff where name = 'ต้น'`)).rows[0].token_hash;
    assert.match(stored, /^[0-9a-f]{64}$/);
    assert.notEqual(stored, res.body.token);
    const me = await h.api("GET", "/api/me", undefined, { Authorization: `Bearer ${res.body.token}` });
    assert.deepEqual(me.body.staff, { id: res.body.staff.id, name: "ต้น", role: "agent" });
  });

  it("refuses a wrong or missing admin key", async () => {
    assert.equal((await h.api("POST", "/api/admin/staff", { name: "x" }, { "X-Admin-Key": "wrong" })).status, 401);
    assert.equal((await h.api("POST", "/api/admin/staff", { name: "x" })).status, 401);
    assert.equal((await h.api("POST", "/api/admin/staff", {}, { "X-Admin-Key": ADMIN_KEY })).status, 400);
  });

  it("signs staff in by LIFF id token after linking", async () => {
    h.idTokens.set("idtok", { sub: "Ustaff", name: "Rita" });
    const before = await h.api("GET", "/api/me", undefined, { Authorization: "", "X-Line-Id-Token": "idtok" });
    assert.equal(before.status, 401);
    const link = await h.api("POST", "/api/staff/link-line", {}, { "X-Line-Id-Token": "idtok" });
    assert.equal(link.status, 200);
    const after = await h.api("GET", "/api/me", undefined, { Authorization: "", "X-Line-Id-Token": "idtok" });
    assert.equal(after.status, 200);
    assert.equal(after.body.staff.name, "ริต้า");
    const bad = await h.api("POST", "/api/staff/link-line", {}, { "X-Line-Id-Token": "unknown" });
    assert.equal(bad.status, 401);
  });

  it("lists staff for the assignee picker", async () => {
    await h.seedStaff("ต้น", "agent", "t2");
    const res = await h.api("GET", "/api/staff");
    assert.deepEqual(res.body.staff.map((s: any) => s.name).sort(), ["ต้น", "ริต้า"].sort());
  });
});

describe("leads", () => {
  it("lists leads newest first with counts, search, stage and due filters", async () => {
    const a = await newLead("U1", "a", "มายด์");
    h.clock = new Date(h.clock.getTime() + 60_000);
    const b = await newLead("U2", "b", "Kiki Miller");
    await h.api("PATCH", `/api/leads/${a}`, { stage: "awaiting_payment", phone: "081-555-0101", follow_up_at: "2026-11-23T09:00:00Z" });
    await h.api("PATCH", `/api/leads/${b}`, { follow_up_at: "2026-12-01T09:00:00Z" });

    const all = await h.api("GET", "/api/leads");
    assert.deepEqual(all.body.leads.map((l: any) => l.id), [b, a]);
    assert.equal(all.body.counts.awaiting_payment, 1);
    assert.equal(all.body.counts.interested, 1);
    assert.equal(all.body.counts.won, 0);
    assert.equal(all.body.due_count, 1);
    assert.deepEqual(all.body.leads[0].tags, []);
    assert.equal(typeof all.body.leads[0].last_message_at, "string");

    assert.deepEqual((await h.api("GET", "/api/leads?stage=awaiting_payment")).body.leads.map((l: any) => l.id), [a]);
    assert.deepEqual((await h.api("GET", "/api/leads?q=kiki")).body.leads.map((l: any) => l.id), [b]);
    assert.deepEqual((await h.api("GET", "/api/leads?q=0815550")).body.leads.map((l: any) => l.id), [a]);
    assert.deepEqual((await h.api("GET", "/api/leads?due=1")).body.leads.map((l: any) => l.id), [a]);
    assert.deepEqual((await h.api("GET", "/api/leads?limit=1&offset=1")).body.leads.map((l: any) => l.id), [a]);
    assert.equal((await h.api("GET", "/api/leads?stage=nope")).status, 400);
  });

  it("returns the full bundle for a lead", async () => {
    const id = await newLead("U1", "สนใจค่ะ", "มายด์");
    const b = (await h.api("GET", `/api/leads/${id}`)).body;
    assert.equal(b.ok, true);
    assert.equal(b.match, "id");
    assert.equal(b.lead.line_user_id, "U1");
    assert.equal(b.lead.display_name, "มายด์");
    assert.deepEqual(b.candidates, []);
    assert.equal(b.order, null);
    assert.deepEqual(b.media, []);
    assert.deepEqual(b.same_phone, []);
    assert.deepEqual(b.messages.map((m: any) => [m.direction, m.type, m.text]), [["in", "text", "สนใจค่ะ"]]);
    assert.equal(b.notes[0].kind, "ai");
    for (const key of ["id", "chat_id", "full_name", "phone", "address", "postcode", "stage", "tags", "interests",
      "assignee_id", "assignee_name", "ai_summary", "next_action", "suggested_reply", "follow_up_at",
      "locked_fields", "last_message_at", "last_message_preview", "created_at", "updated_at", "picture_url"]) {
      assert.ok(key in b.lead, `lead.${key}`);
    }
  });

  it("matches a chat by LINE user id, by linked chat id, then offers candidates by name", async () => {
    const id = await newLead("U1", "hi", "มายด์");
    const direct = (await h.api("GET", "/api/leads/by-chat/U1")).body;
    assert.equal(direct.match, "chat_id");
    assert.equal(direct.lead.id, id);

    const unknown = (await h.api("GET", "/api/leads/by-chat/Cabc")).body;
    assert.equal(unknown.ok, true);
    assert.equal(unknown.lead, null);
    assert.equal(unknown.match, "none");
    assert.deepEqual(unknown.candidates, []);
    assert.deepEqual(unknown.notes, []);

    const byName = (await h.api("GET", `/api/leads/by-chat/Cabc?name=${encodeURIComponent("มายด์")}`)).body;
    assert.equal(byName.lead, null);
    assert.deepEqual(byName.candidates.map((c: any) => c.id), [id]);
    assert.deepEqual(Object.keys(byName.candidates[0]).sort(),
      ["display_name", "full_name", "id", "last_message_at", "phone", "picture_url", "stage"]);

    const linked = await h.api("POST", `/api/leads/${id}/link-chat`, { chat_id: "Cabc" });
    assert.equal(linked.body.lead.chat_id, "Cabc");
    const after = (await h.api("GET", "/api/leads/by-chat/Cabc")).body;
    assert.equal(after.match, "chat_id");
    assert.equal(after.lead.id, id);

    // Linking the same chat to another lead moves it.
    const other = await newLead("U2", "hi", "อีกคน");
    await h.api("POST", `/api/leads/${other}/link-chat`, { chat_id: "Cabc" });
    assert.equal((await h.api("GET", "/api/leads/by-chat/Cabc")).body.lead.id, other);
    assert.equal((await h.api("POST", `/api/leads/${id}/link-chat`, {})).status, 400);
  });

  it("patches fields, locks staff edits and unlocks on clear", async () => {
    const id = await newLead("U1");
    const staffId = (await h.api("GET", "/api/me")).body.staff.id;
    const res = await h.api("PATCH", `/api/leads/${id}`, {
      full_name: " ริต้า แพนเค้ก ", phone: "+66929479744", address: "1/3 ทองหล่อ", postcode: "10600",
      stage: "quoted", tags: ["Filler", "filler", "VIP"], interests: ["Botox"], assignee_id: staffId,
      follow_up_at: "2026-11-25T03:00:00.000Z",
    });
    assert.equal(res.status, 200);
    const lead = res.body.lead;
    assert.equal(lead.full_name, "ริต้า แพนเค้ก");
    assert.equal(lead.phone, "0929479744");
    assert.equal(lead.stage, "quoted");
    assert.deepEqual(lead.tags, ["Filler", "VIP"]);
    assert.deepEqual(lead.interests, ["Botox"]);
    assert.equal(lead.assignee_id, staffId);
    assert.equal(lead.assignee_name, "ริต้า");
    assert.equal(lead.follow_up_at, "2026-11-25T03:00:00.000Z");
    assert.deepEqual([...lead.locked_fields].sort(), ["address", "full_name", "phone", "postcode", "stage"]);

    const cleared = (await h.api("PATCH", `/api/leads/${id}`, { phone: "", assignee_id: null, follow_up_at: null })).body.lead;
    assert.equal(cleared.phone, null);
    assert.equal(cleared.assignee_id, null);
    assert.equal(cleared.follow_up_at, null);
    assert.ok(!cleared.locked_fields.includes("phone"));
    assert.ok(cleared.locked_fields.includes("full_name"));

    const unlocked = (await h.api("PATCH", `/api/leads/${id}`, { unlock: ["stage"] })).body.lead;
    assert.ok(!unlocked.locked_fields.includes("stage"));
    assert.equal(unlocked.stage, "quoted");

    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { stage: "nope" })).status, 400);
    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { phone: "12" })).status, 400);
    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { assignee_id: 9999 })).status, 400);
    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { tags: "x" })).status, 400);
    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { follow_up_at: "soon" })).status, 400);
  });

  it("shows other leads with the same phone", async () => {
    const a = await newLead("U1");
    const b = await newLead("U2");
    await h.api("PATCH", `/api/leads/${a}`, { phone: "0815550101" });
    await h.api("PATCH", `/api/leads/${b}`, { phone: "081-555-0101" });
    assert.deepEqual((await h.api("GET", `/api/leads/${a}`)).body.same_phone.map((l: any) => l.id), [b]);
  });

  it("re-runs the analysis on demand", async () => {
    const id = await newLead("U1");
    h.nextAnalysis = emptyAnalysis({ summary: "สรุปใหม่", next_action: "โทรหาลูกค้า" });
    const res = await h.api("POST", `/api/leads/${id}/analyze`);
    assert.equal(res.status, 200);
    assert.equal(res.body.lead.ai_summary, "สรุปใหม่");
    assert.equal(res.body.lead.next_action, "โทรหาลูกค้า");
    assert.equal(res.body.notes[0].body, "สรุปใหม่");
  });
});

describe("notes and media", () => {
  it("adds, pins, lists and deletes notes", async () => {
    const id = await newLead("U1");
    const a = await h.api("POST", `/api/leads/${id}/notes`, { body: "ลูกค้าแพ้ยาชา" , pinned: true });
    assert.equal(a.status, 200);
    assert.deepEqual([a.body.note.kind, a.body.note.author_name, a.body.note.pinned], ["staff", "ริต้า", true]);
    await h.api("POST", `/api/leads/${id}/notes`, { body: "โทรกลับพรุ่งนี้" });
    const notes = (await h.api("GET", `/api/leads/${id}`)).body.notes;
    assert.equal(notes[0].body, "ลูกค้าแพ้ยาชา", "pinned first");
    assert.equal((await h.api("POST", `/api/leads/${id}/notes`, { body: "  " })).status, 400);
    assert.equal((await h.api("DELETE", `/api/notes/${a.body.note.id}`)).status, 200);
    assert.equal((await h.api("DELETE", `/api/notes/${a.body.note.id}`)).status, 404);
  });

  it("lets an agent delete only their own staff notes, and nobody delete agent or system notes", async () => {
    const id = await newLead("U1");
    await h.seedStaff("ต้น", "agent", "agent-token");
    const asAgent = { Authorization: "Bearer agent-token" };
    const adminNote = (await h.api("POST", `/api/leads/${id}/notes`, { body: "โน้ตของแอดมิน" })).body.note;
    const agentNote = (await h.api("POST", `/api/leads/${id}/notes`, { body: "โน้ตของต้น" }, asAgent)).body.note;
    await pg.query(`insert into sidecar.notes (lead_id, body, kind) values ($1, 'ได้รับสลิป', 'system')`, [id]);
    const systemNote = (await h.api("GET", `/api/leads/${id}`)).body.notes.find((n: { kind: string }) => n.kind === "system");

    assert.equal((await h.api("DELETE", `/api/notes/${adminNote.id}`, undefined, asAgent)).status, 404, "agent cannot delete another person's note");
    assert.equal((await h.api("DELETE", `/api/notes/${systemNote.id}`)).status, 404, "system notes stay, even for an admin");
    assert.equal((await h.api("DELETE", `/api/notes/${agentNote.id}`, undefined, asAgent)).status, 200, "agent deletes their own");
    assert.equal((await h.api("DELETE", `/api/notes/${adminNote.id}`)).status, 200);
    const left = (await h.api("GET", `/api/leads/${id}`)).body.notes;
    assert.equal(left.filter((n: { kind: string }) => n.kind === "staff").length, 0);
    assert.ok(left.some((n: { kind: string }) => n.kind === "system"));
  });

  it("recategorises media", async () => {
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    const mediaId = (await h.api("GET", `/api/leads/${id}`)).body.media[0].id;
    const res = await h.api("PATCH", `/api/media/${mediaId}`, { category: "before_after", caption: "ก่อนทำ" });
    assert.equal(res.body.media.category, "before_after");
    assert.equal(res.body.media.caption, "ก่อนทำ");
    assert.match(res.body.media.url, /^https:\/\/storage\.test\//);
    assert.equal((await h.api("PATCH", `/api/media/${mediaId}`, { category: "selfie" })).status, 400);
    assert.equal((await h.api("PATCH", "/api/media/999", { caption: "x" })).status, 404);
  });
});

describe("orders and summary", () => {
  it("computes totals, keeps one open order and builds the summary from it", async () => {
    const id = await newLead("U1", "hi", "Kanlaya");
    await h.api("PATCH", `/api/leads/${id}`, { full_name: "ริต้า แพนเค้ก", phone: "0929479744", address: "1/3 ทองหล่อ คลองสาน กรุงเทพฯ", postcode: "10600" });
    assert.equal((await h.api("GET", `/api/leads/${id}/summary`)).status, 404, "no order yet");

    const first = await h.api("PUT", `/api/leads/${id}/order`, {
      items: [{ name: "KKS Retinol Serum 30ml", qty: 2, unit_price: 1599 }, { name: "Botox", qty: 1, unit_price: 15999.5 }],
      discount: 200, shipping_fee: 50, payment_method: "transfer", deposit_amount: 1000, note: "นัดวันเสาร์",
    });
    assert.equal(first.status, 200);
    const order = first.body.order;
    assert.equal(order.status, "draft");
    assert.equal(order.subtotal, 19197.5);
    assert.equal(order.total, 19047.5);
    assert.equal(order.discount, 200);
    assert.equal(order.deposit_amount, 1000);
    assert.equal(order.items.length, 2);
    assert.ok(!("staff_edited" in order));

    const second = await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "Botox", qty: 1, unit_price: 15999 }] });
    assert.equal(second.body.order.id, order.id, "the open order is updated in place");
    assert.equal(second.body.order.total, 15999);
    assert.equal(second.body.order.payment_method, null);

    await h.api("PUT", `/api/leads/${id}/order`, {
      items: [{ name: "KKS Retinol Serum 30ml", qty: 2, unit_price: 1599 }, { name: "Botox", qty: 1, unit_price: 15999.5 }],
      discount: 200, shipping_fee: 50, payment_method: "transfer", deposit_amount: 1000, note: "นัดวันเสาร์",
    });
    const text = (await h.api("GET", `/api/leads/${id}/summary`)).body.text;
    assert.equal(text, [
      "สรุปรายการสั่งซื้อ ร้านทดสอบ",
      "",
      "ชื่อ: คุณริต้า แพนเค้ก",
      "เบอร์โทร: 0929479744",
      "ที่อยู่: 1/3 ทองหล่อ คลองสาน กรุงเทพฯ 10600",
      "",
      "รายการ",
      "1. KKS Retinol Serum 30ml x2 = 3,198 บาท",
      "2. Botox x1 = 15,999.50 บาท",
      "",
      "ยอดรวมสินค้า: 19,197.50 บาท",
      "ส่วนลด: -200 บาท",
      "ค่าจัดส่ง: 50 บาท",
      "ยอดสุทธิ: 19,047.50 บาท",
      "มัดจำ: 1,000 บาท",
      "คงเหลือ: 18,047.50 บาท",
      "ชำระโดย: โอนเงิน",
      "หมายเหตุ: นัดวันเสาร์",
      "",
      "โอนเข้าบัญชี 000-0-00000-0",
    ].join("\n"));
  });

  it("leaves payment instructions out for COD", async () => {
    const id = await newLead("U1");
    await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "เคส", qty: 1, unit_price: 190 }], payment_method: "cod" });
    const text = (await h.api("GET", `/api/leads/${id}/summary`)).body.text;
    assert.match(text, /ยอดสุทธิ: 190 บาท\nชำระโดย: เก็บเงินปลายทาง \(COD\)$/);
    assert.doesNotMatch(text, /โอนเข้าบัญชี/);
  });

  it("validates order input", async () => {
    const id = await newLead("U1");
    assert.equal((await h.api("PUT", `/api/leads/${id}/order`, {})).status, 400);
    assert.equal((await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "", qty: 1, unit_price: 1 }] })).status, 400);
    assert.equal((await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "a", qty: 0, unit_price: 1 }] })).status, 400);
    assert.equal((await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "a", qty: 1, unit_price: -5 }] })).status, 400);
    assert.equal((await h.api("PUT", `/api/leads/${id}/order`, { items: [], payment_method: "bitcoin" })).status, 400);
    assert.equal((await h.api("PUT", "/api/leads/999/order", { items: [] })).status, 404);
  });

  it("moves the lead with the order status unless the stage is locked", async () => {
    const id = await newLead("U1");
    const order = (await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "a", qty: 1, unit_price: 100 }] })).body.order;
    const waiting = await h.api("POST", `/api/orders/${order.id}/status`, { status: "awaiting_payment" });
    assert.equal(waiting.body.order.status, "awaiting_payment");
    assert.equal(waiting.body.lead.stage, "awaiting_payment");
    const paid = await h.api("POST", `/api/orders/${order.id}/status`, { status: "paid" });
    assert.equal(paid.body.lead.stage, "paid");
    assert.equal((await h.api("GET", `/api/leads/${id}`)).body.order.status, "paid", "latest order is shown when none is open");

    // A new order starts after the paid one.
    const next = (await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "b", qty: 1, unit_price: 50 }] })).body.order;
    assert.notEqual(next.id, order.id);

    await h.api("PATCH", `/api/leads/${id}`, { stage: "booked" });
    const locked = await h.api("POST", `/api/orders/${next.id}/status`, { status: "awaiting_payment" });
    assert.equal(locked.body.lead.stage, "booked");

    assert.equal((await h.api("POST", `/api/orders/${next.id}/status`, { status: "shipped" })).status, 400);
    assert.equal((await h.api("POST", "/api/orders/999/status", { status: "paid" })).status, 404);
  });
});

describe("products and settings", () => {
  it("creates, searches, updates and deactivates products", async () => {
    const a = await h.api("POST", "/api/products", { sku: "IP13-128", name: "iPhone 13 128GB", price: "13900", category: "iPhone" });
    assert.deepEqual(a.body.product, { id: a.body.product.id, sku: "IP13-128", name: "iPhone 13 128GB", price: 13900, category: "iPhone", active: true });
    await h.api("POST", "/api/products", { name: "AirPods Pro 2", price: 5490.5 });
    assert.deepEqual((await h.api("GET", "/api/products")).body.products.map((p: any) => p.name), ["AirPods Pro 2", "iPhone 13 128GB"]);
    assert.deepEqual((await h.api("GET", "/api/products?q=iphone")).body.products.map((p: any) => p.name), ["iPhone 13 128GB"]);
    const patched = await h.api("PATCH", `/api/products/${a.body.product.id}`, { price: 12900, active: false });
    assert.equal(patched.body.product.price, 12900);
    assert.equal(patched.body.product.active, false);
    assert.equal((await h.api("GET", "/api/products")).body.products.length, 1);
    assert.equal((await h.api("GET", "/api/products?all=1")).body.products.length, 2);
    assert.equal((await h.api("POST", "/api/products", { price: 1 })).status, 400);
    assert.equal((await h.api("POST", "/api/products", { name: "x", price: -1 })).status, 400);
    assert.equal((await h.api("PATCH", "/api/products/999", { price: 1 })).status, 404);
  });

  it("reads settings for everyone and writes them for admins only", async () => {
    assert.deepEqual((await h.api("GET", "/api/settings")).body.settings, {
      shop_name: "ร้านทดสอบ", payment_instructions: "โอนเข้าบัญชี 000-0-00000-0",
    });
    const put = await h.api("PUT", "/api/settings", { shop_name: "JAIFU" });
    assert.deepEqual(put.body.settings, { shop_name: "JAIFU", payment_instructions: "โอนเข้าบัญชี 000-0-00000-0" });
    await h.seedStaff("ต้น", "agent", "agent-token");
    const denied = await h.api("PUT", "/api/settings", { shop_name: "x" }, { Authorization: "Bearer agent-token" });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, "forbidden");
  });
});
