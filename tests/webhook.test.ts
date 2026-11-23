import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb, createHarness, emptyAnalysis, leadRow, resetDb, type TestDb } from "./helpers.ts";
import type { Analysis } from "../supabase/functions/sidecar/src/types.ts";

let pg: TestDb;
before(async () => { pg = await createDb(); });
after(async () => { await pg.close(); });
beforeEach(async () => { await resetDb(pg); });

describe("webhook signature", () => {
  it("accepts a correctly signed body and stores the message", async () => {
    const h = createHarness(pg);
    h.profiles.set("U1", { displayName: "มายด์", pictureUrl: "https://pic.test/1.jpg" });
    const res = await h.webhook([h.textEvent("U1", "สนใจ iPhone 13 ค่ะ")]);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    await h.settle();
    const lead = await leadRow(pg, "U1");
    assert.equal(lead.display_name, "มายด์");
    assert.equal(lead.picture_url, "https://pic.test/1.jpg");
    assert.equal(lead.oa_id, "Ubot");
    assert.equal(lead.last_message_preview, "สนใจ iPhone 13 ค่ะ");
    const { rows } = await pg.query(`select direction, type, text, analysed from sidecar.messages`);
    assert.deepEqual(rows, [{ direction: "in", type: "text", text: "สนใจ iPhone 13 ค่ะ", analysed: true }]);
  });

  it("rejects a wrong or missing signature and stores nothing", async () => {
    const h = createHarness(pg);
    const bad = await h.webhook([h.textEvent("U1", "hi")], { signature: "AAAA" });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, "unauthorized");
    const none = await h.webhook([h.textEvent("U1", "hi")], { signature: "" });
    assert.equal(none.status, 401);
    const { rows } = await pg.query(`select count(*)::int as n from sidecar.leads`);
    assert.equal(rows[0].n, 0);
  });

  it("answers LINE's verify call, which has no events", async () => {
    const h = createHarness(pg);
    assert.equal((await h.webhook([])).status, 200);
  });

  it("returns 503 not_configured when a required secret is missing", async () => {
    const h = createHarness(pg);
    h.deps.missing = ["ANTHROPIC_API_KEY"];
    const res = await h.webhook([h.textEvent("U1", "hi")]);
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "not_configured");
    assert.match(res.body.message, /ANTHROPIC_API_KEY/);
  });

  it("ignores group chats", async () => {
    const h = createHarness(pg);
    const event = h.textEvent("U1", "hi") as any;
    event.source = { type: "group", groupId: "G1", userId: "U1" };
    assert.equal((await h.webhook([event])).status, 200);
    assert.equal((await pg.query(`select count(*)::int as n from sidecar.leads`)).rows[0].n, 0);
  });
});

describe("webhook idempotency and bursts", () => {
  it("skips a redelivered event", async () => {
    const h = createHarness(pg);
    const event = h.textEvent("U1", "สวัสดีค่ะ", "same");
    await h.webhook([event]);
    await h.webhook([event]);
    await h.settle();
    assert.equal((await pg.query(`select count(*)::int as n from sidecar.messages`)).rows[0].n, 1);
    assert.equal(h.conversationCalls.length, 1);
  });

  it("analyses a burst of messages once, with all of them", async () => {
    const h = createHarness(pg, { manualSleep: true });
    await h.webhook([h.textEvent("U1", "สวัสดีค่ะ")]);
    await h.webhook([h.textEvent("U1", "iPhone 13 ยังมีไหม")]);
    await h.webhook([h.textEvent("U1", "ราคาเท่าไหร่คะ")]);
    assert.equal(h.conversationCalls.length, 0, "nothing runs inside the debounce window");
    h.releaseSleeps();
    await h.settle();
    assert.equal(h.conversationCalls.length, 1);
    const texts = h.conversationCalls[0].messages.map((m) => m.text);
    assert.deepEqual(texts, ["สวัสดีค่ะ", "iPhone 13 ยังมีไหม", "ราคาเท่าไหร่คะ"]);
    assert.ok(h.conversationCalls[0].messages.every((m) => m.is_new));
  });

  it("does not drop a message that arrives while an analysis is running", async () => {
    const h = createHarness(pg, { manualSleep: true });
    let finishFirst!: (a: Analysis) => void;
    h.nextAnalysis = () => new Promise<Analysis>((resolve) => { finishFirst = resolve; });

    await h.webhook([h.textEvent("U1", "ข้อความแรก")]);
    h.releaseSleeps();                                   // first task passes its debounce and calls the brain
    while (h.conversationCalls.length < 1) await new Promise((r) => setImmediate(r));

    await h.webhook([h.textEvent("U1", "ข้อความที่สอง")]);
    h.releaseSleeps();                                   // second task: debounce over, lead is still claimed
    while (h.pendingSleeps() < 1) await new Promise((r) => setImmediate(r));
    assert.equal(h.conversationCalls.length, 1);

    h.nextAnalysis = emptyAnalysis({ summary: "รอบสอง" });
    finishFirst(emptyAnalysis({ summary: "รอบแรก" }));
    while (h.pendingSleeps() > 0 || h.conversationCalls.length < 2) {
      h.releaseSleeps();
      await new Promise((r) => setImmediate(r));
    }
    await h.settle();
    assert.equal(h.conversationCalls.length, 2);
    assert.equal((await leadRow(pg, "U1")).ai_summary, "รอบสอง");
    assert.equal((await leadRow(pg, "U1")).processing_at, null);
    assert.equal((await pg.query(`select count(*)::int as n from sidecar.messages where not analysed`)).rows[0].n, 0);
  });

  it("stores stickers and unknown message types", async () => {
    const h = createHarness(pg);
    const sticker = h.textEvent("U1", "") as any;
    sticker.message = { id: "st-1", type: "sticker" };
    const video = h.textEvent("U1", "") as any;
    video.message = { id: "vd-1", type: "video" };
    await h.webhook([sticker, video]);
    await h.settle();
    const { rows } = await pg.query(`select type, text from sidecar.messages order by id`);
    assert.deepEqual(rows, [{ type: "sticker", text: null }, { type: "other", text: null }]);
    assert.equal((await leadRow(pg, "U1")).last_message_preview, "[ข้อความประเภทอื่น]");
  });

  it("creates a lead on follow without a message", async () => {
    const h = createHarness(pg);
    h.profiles.set("U9", { displayName: "ลูกค้าใหม่" });
    await h.webhook([{ type: "follow", webhookEventId: "f1", timestamp: 1, source: { type: "user", userId: "U9" } }]);
    await h.settle();
    assert.equal((await leadRow(pg, "U9")).display_name, "ลูกค้าใหม่");
    assert.equal(h.conversationCalls.length, 0);
  });
});

describe("agent updates to the lead card", () => {
  it("fills empty fields, normalises the phone and writes an ai note", async () => {
    const h = createHarness(pg);
    h.nextAnalysis = emptyAnalysis({
      full_name: "สมหญิง ใจดี", phone: "+66 81-555-0101", address: "1/3 ทองหล่อ", postcode: "10110",
      interests: ["iPhone 13"], stage: "interested", summary: "สนใจ iPhone 13", follow_up_hours: 24,
    });
    await h.webhook([h.textEvent("U1", "ชื่อสมหญิง เบอร์ +66815550101")]);
    await h.settle();
    const lead = await leadRow(pg, "U1");
    assert.equal(lead.full_name, "สมหญิง ใจดี");
    assert.equal(lead.phone, "0815550101");
    assert.equal(lead.address, "1/3 ทองหล่อ");
    assert.equal(lead.postcode, "10110");
    assert.deepEqual(lead.interests, ["iPhone 13"]);
    assert.equal(lead.stage, "interested");
    assert.equal(lead.next_action, "ตอบราคา");
    assert.equal(lead.follow_up_at.toISOString(), "2026-11-24T10:00:00.000Z");
    const { rows } = await pg.query(`select body, kind, author_name from sidecar.notes`);
    assert.deepEqual(rows, [{ body: "สนใจ iPhone 13", kind: "ai", author_name: "Sidecar" }]);
  });

  it("never replaces a value with null or with a different guess", async () => {
    const h = createHarness(pg);
    h.nextAnalysis = emptyAnalysis({ full_name: "สมหญิง", phone: "0815550101" });
    await h.webhook([h.textEvent("U1", "a")]);
    await h.settle();
    h.nextAnalysis = emptyAnalysis({ full_name: null, phone: "0899999999", interests: ["AirPods"] });
    await h.webhook([h.textEvent("U1", "b")]);
    await h.settle();
    const lead = await leadRow(pg, "U1");
    assert.equal(lead.full_name, "สมหญิง");
    assert.equal(lead.phone, "0815550101");
    assert.deepEqual(lead.interests, ["AirPods"]);
  });

  it("keeps locked fields and staff-owned stages", async () => {
    const h = createHarness(pg);
    await h.seedStaff();
    await h.webhook([h.textEvent("U1", "a")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    // Staff clear nothing but set the stage and a name: both become locked.
    await h.api("PATCH", `/api/leads/${id}`, { full_name: "ชื่อที่แอดมินแก้", stage: "quoted" });
    h.nextAnalysis = emptyAnalysis({ full_name: "ชื่อจากเอไอ", stage: "lost", phone: "0815550101" });
    await h.webhook([h.textEvent("U1", "b")]);
    await h.settle();
    let lead = await leadRow(pg, "U1");
    assert.equal(lead.full_name, "ชื่อที่แอดมินแก้");
    assert.equal(lead.stage, "quoted");
    assert.equal(lead.phone, "0815550101", "unlocked empty field is still filled");

    // Unlocked, but paid is a staff stage: the agent does not move a lead out of it.
    await h.api("PATCH", `/api/leads/${id}`, { unlock: ["stage"] });
    await pg.query(`update sidecar.leads set stage = 'paid' where id = $1`, [id]);
    await h.webhook([h.textEvent("U1", "c")]);
    await h.settle();
    lead = await leadRow(pg, "U1");
    assert.equal(lead.stage, "paid");
  });

  it("drafts an order from what the customer asked for, until staff edit it", async () => {
    const h = createHarness(pg);
    await h.seedStaff();
    await pg.query(`insert into sidecar.products (name, price) values ('iPhone 13 128GB', 13900), ('AirPods Pro 2', 5490)`);
    h.nextAnalysis = emptyAnalysis({
      order_items: [{ name: "iphone 13 128gb", qty: 1, unit_price: null }, { name: "เคสใส", qty: 2, unit_price: 190 }],
    });
    await h.webhook([h.textEvent("U1", "เอา iPhone 13 กับเคส 2 อัน")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    let order = (await h.api("GET", `/api/leads/${id}`)).body.order;
    assert.equal(order.status, "draft");
    assert.deepEqual(order.items.map((i: any) => [i.name, i.qty, i.unit_price, i.product_id !== null]), [
      ["iPhone 13 128GB", 1, 13900, true], ["เคสใส", 2, 190, false],
    ]);
    assert.equal(order.total, 14280);

    await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "AirPods Pro 2", qty: 1, unit_price: 5490 }] });
    await h.webhook([h.textEvent("U1", "เปลี่ยนใจ")]);
    await h.settle();
    order = (await h.api("GET", `/api/leads/${id}`)).body.order;
    assert.deepEqual(order.items.map((i: any) => i.name), ["AirPods Pro 2"], "a staff-edited order is left alone");
  });

  it("survives a brain failure and leaves the lead untouched", async () => {
    const h = createHarness(pg);
    h.nextAnalysis = () => Promise.reject(new Error("model unavailable"));
    const res = await h.webhook([h.textEvent("U1", "hello")]);
    assert.equal(res.status, 200);
    await h.settle();
    const lead = await leadRow(pg, "U1");
    assert.equal(lead.ai_summary, null);
    assert.equal(lead.processing_at, null, "the claim is released");
    assert.ok(h.logs.some((l) => l.includes("analysis failed")));
    assert.equal((await pg.query(`select count(*)::int as n from sidecar.messages where analysed`)).rows[0].n, 0);
  });
});

describe("images", () => {
  async function leadWithOrder(h: ReturnType<typeof createHarness>, total: number) {
    await h.seedStaff();
    await h.webhook([h.textEvent("U1", "สั่งค่ะ")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "Retinol Serum", qty: 1, unit_price: total }] });
    return id as number;
  }

  it("files a slip that matches the order and marks nothing paid", async () => {
    const h = createHarness(pg);
    const id = await leadWithOrder(h, 1599);
    h.nextImage = { category: "slip", caption: "สลิปโอนเงิน", slip: { amount: 1599, paid_at: "2026-11-23T17:01:00+07:00", bank: "KBank", ref: "REF123" } };
    await h.webhook([h.imageEvent("U1", "slip1")]);
    await h.settle();

    assert.ok(h.uploads.has(`${id}/img-slip1.jpg`));
    const b = (await h.api("GET", `/api/leads/${id}`)).body;
    assert.equal(b.media.length, 1);
    assert.equal(b.media[0].category, "slip");
    assert.equal(b.media[0].url, `https://storage.test/${id}/img-slip1.jpg?expires=3600`);
    assert.deepEqual(b.media[0].slip, { amount: 1599, paid_at: "2026-11-23T17:01:00+07:00", bank: "KBank", ref: "REF123", matches_order: true });
    assert.equal(b.order.status, "draft", "the order is not marked paid");
    assert.notEqual(b.lead.stage, "paid");
    const system = b.notes.find((n: any) => n.kind === "system");
    assert.match(system.body, /1,599 บาท — ตรงกับยอดออเดอร์/);
    const img = b.messages.find((m: any) => m.type === "image");
    assert.equal(img.media_id, b.media[0].id);
    // The follow-up conversation analysis sees the image as a described entry.
    const last = h.conversationCalls.at(-1)!;
    assert.equal(last.messages.at(-1)!.text, "[รูปภาพ: slip — สลิปโอนเงิน]");
  });

  it("flags a slip whose amount differs from the order", async () => {
    const h = createHarness(pg);
    const id = await leadWithOrder(h, 15999);
    h.nextImage = { category: "slip", caption: null, slip: { amount: 1599, paid_at: null, bank: null, ref: null } };
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    const b = (await h.api("GET", `/api/leads/${id}`)).body;
    assert.equal(b.media[0].slip.matches_order, false);
    assert.match(b.notes.find((n: any) => n.kind === "system").body, /ไม่ตรงกับยอดออเดอร์ \(15,999 บาท\)/);
  });

  it("accepts a slip for the deposit amount", async () => {
    const h = createHarness(pg);
    const id = await leadWithOrder(h, 15999);
    await h.api("PUT", `/api/leads/${id}/order`, { items: [{ name: "Botox", qty: 1, unit_price: 15999 }], deposit_amount: 1000 });
    h.nextImage = { category: "slip", caption: null, slip: { amount: 1000, paid_at: null, bank: null, ref: null } };
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    assert.equal((await h.api("GET", `/api/leads/${id}`)).body.media[0].slip.matches_order, true);
  });

  it("has nothing to compare when there is no order", async () => {
    const h = createHarness(pg);
    await h.seedStaff();
    h.nextImage = { category: "slip", caption: null, slip: { amount: 500, paid_at: null, bank: null, ref: null } };
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    const b = (await h.api("GET", `/api/leads/${id}`)).body;
    assert.equal(b.media[0].slip.matches_order, null);
    assert.match(b.notes.find((n: any) => n.kind === "system").body, /ยังไม่มีออเดอร์ให้เทียบ/);
  });

  it("files a product photo without slip data", async () => {
    const h = createHarness(pg);
    await h.seedStaff();
    h.content = { bytes: new Uint8Array([9, 9]), contentType: "image/png" };
    h.nextImage = { category: "product", caption: "iPhone สีดำ", slip: null };
    await h.webhook([h.imageEvent("U1", "p1")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    assert.ok(h.uploads.has(`${id}/img-p1.png`));
    const b = (await h.api("GET", `/api/leads/${id}`)).body;
    assert.equal(b.media[0].category, "product");
    assert.equal(b.media[0].caption, "iPhone สีดำ");
    assert.equal(b.media[0].slip, null);
    assert.equal(h.imageCalls[0].contentType, "image/png");
  });

  it("stores an image it cannot analyse", async () => {
    const h = createHarness(pg);
    await h.seedStaff();
    h.content = { bytes: new Uint8Array([1]), contentType: "image/heic" };
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    const id = (await leadRow(pg, "U1")).id;
    assert.equal(h.imageCalls.length, 0);
    assert.equal((await h.api("GET", `/api/leads/${id}`)).body.media[0].category, "other");
  });
});
