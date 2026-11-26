// Profiles (retail / real_estate), lead details and webhook forwarding.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { BASE, createDb, createHarness, emptyAnalysis, leadRow, resetDb, type Harness, type TestDb } from "./helpers.ts";
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

const estate = () => { h.deps.env.PROFILE = "real_estate"; };

async function newLead(userId: string, text = "สวัสดีค่ะ"): Promise<number> {
  await h.webhook([h.textEvent(userId, text)]);
  await h.settle();
  return (await leadRow(pg, userId)).id;
}

describe("profile config", () => {
  it("serves the retail profile by default, with no detail fields", async () => {
    const res = await h.api("GET", "/api/config");
    assert.equal(res.status, 200);
    const c = res.body.config;
    assert.equal(c.profile, "retail");
    assert.deepEqual(c.stages.map((s: { key: string }) => s.key),
      ["new", "interested", "quoted", "awaiting_payment", "paid", "booked", "won", "lost", "spam"]);
    assert.deepEqual(c.stages.map((s: { label: string }) => s.label),
      ["ใหม่", "สนใจ", "เสนอราคาแล้ว", "รอโอน", "ชำระแล้ว", "จองคิวแล้ว", "ปิดการขาย", "ยกเลิก", "สแปม"]);
    assert.deepEqual(c.detail_fields, []);
    assert.deepEqual(c.payment_methods.map((m: { key: string }) => m.key), ["transfer", "cod", "installment"]);
    assert.equal(c.labels.product, "สินค้า");
    assert.equal(c.labels.order, "ออเดอร์");
    assert.equal(c.media_categories.find((m: { key: string }) => m.key === "product").label, "สินค้า");
  });

  it("serves the real_estate profile when the deployment is set to it", async () => {
    estate();
    const c = (await h.api("GET", "/api/config")).body.config;
    assert.equal(c.profile, "real_estate");
    assert.deepEqual(c.stages.map((s: { key: string; label: string }) => `${s.key} ${s.label}`), [
      "new ใหม่", "interested รู้ความต้องการ", "quoted ส่งทรัพย์แล้ว", "booked นัดดูทรัพย์",
      "awaiting_payment รอมัดจำ", "paid วางมัดจำแล้ว", "won ปิดดีล", "lost หลุด", "spam สแปม",
    ]);
    assert.deepEqual(c.detail_fields.map((f: { key: string }) => f.key),
      ["role", "intent", "budget", "location", "unit_type", "move_in", "property_code"]);
    assert.deepEqual(c.detail_fields[0].options.map((o: { value: string }) => o.value),
      ["owner", "buyer", "tenant", "co_agent", "resident"]);
    assert.deepEqual(c.detail_fields[1].options.map((o: { label: string }) => o.label),
      ["ฝากขาย", "ฝากเช่า", "หาซื้อ", "หาเช่า", "แจ้งปัญหาหลังเช่า", "One Stop Service"]);
    assert.deepEqual(c.payment_methods, [{ key: "transfer", label: "โอนเงิน" }]);
    assert.equal(c.labels.product, "ทรัพย์");
    assert.equal(c.labels.order, "ข้อเสนอ/การจอง");
    assert.deepEqual(c.media_categories.map((m: { label: string }) => m.label),
      ["สลิป", "รูปทรัพย์", "สภาพห้อง", "เอกสาร", "อื่น ๆ"]);
  });

  it("falls back to retail for an unknown profile name and needs a staff token", async () => {
    h.deps.env.PROFILE = "hotel";
    assert.equal((await h.api("GET", "/api/config")).body.config.profile, "retail");
    assert.equal((await h.api("GET", "/api/config", undefined, { Authorization: "" })).status, 401);
  });

  it("shows the profile on /health", async () => {
    const health = async () => (await (await handle(new Request(BASE + "/health"), h.deps)).json());
    assert.equal((await health()).profile, "retail");
    estate();
    assert.equal((await health()).profile, "real_estate");
  });
});

describe("lead details", () => {
  it("starts empty and stays empty in retail, where no key is allowed", async () => {
    const id = await newLead("U1");
    assert.deepEqual((await h.api("GET", `/api/leads/${id}`)).body.lead.details, {});
    assert.equal((await h.api("PATCH", `/api/leads/${id}`, { details: { budget: "3 ล้าน" } })).status, 400);
    assert.deepEqual((await h.api("GET", "/api/leads")).body.leads[0].details, {});
  });

  it("merges keys, removes empty ones and rejects unknown keys and values", async () => {
    estate();
    const id = await newLead("U1");
    const first = await h.api("PATCH", `/api/leads/${id}`, {
      details: { role: "tenant", intent: "rent", budget: "  12,000/เดือน  ", location: "ใกล้ BTS กรุงธนบุรี" },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.lead.details, {
      role: "tenant", intent: "rent", budget: "12,000/เดือน", location: "ใกล้ BTS กรุงธนบุรี",
    });

    const second = (await h.api("PATCH", `/api/leads/${id}`, {
      details: { budget: "15,000/เดือน", location: null, move_in: "" , unit_type: "x".repeat(400) },
    })).body.lead;
    assert.equal(second.details.budget, "15,000/เดือน");
    assert.equal(second.details.role, "tenant", "keys that were not sent are kept");
    assert.ok(!("location" in second.details) && !("move_in" in second.details));
    assert.equal(second.details.unit_type.length, 300);

    for (const bad of [
      { details: { colour: "red" } },
      { details: { role: "landlord" } },
      { details: { intent: "หาเช่า" } },
      { details: { budget: 12000 } },
      { details: "rent" },
      { details: ["rent"] },
      { details: null },
    ]) {
      assert.equal((await h.api("PATCH", `/api/leads/${id}`, bad)).status, 400, JSON.stringify(bad));
    }
    const after = (await h.api("GET", `/api/leads/${id}`)).body.lead;
    assert.equal(after.details.budget, "15,000/เดือน", "a rejected patch changes nothing");
    assert.deepEqual((await h.api("GET", "/api/leads/by-chat/U1")).body.lead.details, after.details);
  });

  it("locks a staff-edited key as details.<key> and unlocks it on clear or on request", async () => {
    estate();
    const id = await newLead("U1");
    let lead = (await h.api("PATCH", `/api/leads/${id}`, { details: { intent: "buy", budget: "3 ล้าน" }, full_name: "สมชาย" })).body.lead;
    assert.deepEqual([...lead.locked_fields].sort(), ["details.budget", "details.intent", "full_name"]);

    lead = (await h.api("PATCH", `/api/leads/${id}`, { details: { budget: null } })).body.lead;
    assert.deepEqual([...lead.locked_fields].sort(), ["details.intent", "full_name"]);

    lead = (await h.api("PATCH", `/api/leads/${id}`, { unlock: ["details.intent"] })).body.lead;
    assert.deepEqual(lead.locked_fields, ["full_name"]);
    assert.equal(lead.details.intent, "buy", "unlocking keeps the value");
  });
});

describe("agent and details", () => {
  it("fills empty, unlocked keys and nothing else", async () => {
    estate();
    const id = await newLead("U1");
    await h.api("PATCH", `/api/leads/${id}`, { details: { intent: "buy" } });        // locked by staff
    await pg.query(`update sidecar.leads set details = details || '{"location":"อโศก"}'::jsonb where id = $1`, [id]); // known, not locked

    h.nextAnalysis = emptyAnalysis({
      details: {
        role: "tenant", intent: "rent", budget: " 12,000/เดือน ", location: "ลาดพร้าว",
        unit_type: null, move_in: "", property_code: "RCD-0001",
      },
    });
    await h.webhook([h.textEvent("U1", "หาห้องเช่า งบ 12,000 ค่ะ")]);
    await h.settle();

    const lead = (await h.api("GET", `/api/leads/${id}`)).body.lead;
    assert.deepEqual(lead.details, {
      intent: "buy",                 // locked: kept
      location: "อโศก",              // already known: kept
      role: "tenant", budget: "12,000/เดือน", property_code: "RCD-0001",
    });
    assert.deepEqual(lead.locked_fields, ["details.intent"], "the agent's own writes lock nothing");

    const sent = h.conversationCalls.at(-1)!;
    assert.equal(sent.profile, "real_estate");
    assert.equal(sent.detail_fields!.length, 7);
    assert.deepEqual(sent.lead.details, { intent: "buy", location: "อโศก" });
  });

  it("drops a role or intent that is not in the list, and keys the profile does not have", async () => {
    estate();
    const id = await newLead("U1");
    h.nextAnalysis = emptyAnalysis({
      details: { role: "landlord", intent: "เช่า", budget: "3 ล้าน", shoe_size: "42" } as Record<string, string>,
    });
    await h.webhook([h.textEvent("U1", "สนใจซื้อคอนโด")]);
    await h.settle();
    assert.deepEqual((await h.api("GET", `/api/leads/${id}`)).body.lead.details, { budget: "3 ล้าน" });
  });

  it("ignores details from the model in retail", async () => {
    const id = await newLead("U1");
    h.nextAnalysis = emptyAnalysis({ details: { budget: "3 ล้าน", role: "buyer" } });
    await h.webhook([h.textEvent("U1", "สนใจค่ะ")]);
    await h.settle();
    assert.deepEqual((await h.api("GET", `/api/leads/${id}`)).body.lead.details, {});
    assert.equal(h.conversationCalls.at(-1)!.profile, "retail");
    assert.deepEqual(h.conversationCalls.at(-1)!.detail_fields, []);
  });

  it("tells the image brain which profile it works for", async () => {
    estate();
    await h.webhook([h.imageEvent("U1")]);
    await h.settle();
    assert.equal(h.imageCalls[0].profile, "real_estate");
  });
});

describe("property offer summary", () => {
  it("renders the unit, deposit and balance, with no delivery or COD wording", async () => {
    estate();
    await pg.query(`update sidecar.settings set value = 'Globallink Estate' where key = 'shop_name'`);
    const id = await newLead("U1");
    await h.api("PATCH", `/api/leads/${id}`, { full_name: "สมหญิง ตัวอย่าง", phone: "081-555-0101", address: "99/1 บางนา", postcode: "10260" });
    const unit = (await h.api("POST", "/api/products", { name: "Kave Town Colony · Studio 23 ตร.ม.", price: 11000, category: "เช่า" })).body.product;
    await h.api("PUT", `/api/leads/${id}/order`, {
      items: [{ product_id: unit.id, name: unit.name, qty: 1, unit_price: 11000 }],
      discount: 0, shipping_fee: 0, payment_method: "transfer", deposit_amount: 5000, note: "สัญญา 12 เดือน เข้าอยู่ 1 ธ.ค.",
    });
    const res = await h.api("GET", `/api/leads/${id}/summary`);
    assert.equal(res.status, 200);
    assert.equal(res.body.text, [
      "สรุปรายละเอียดทรัพย์ Globallink Estate",
      "",
      "ชื่อ: คุณสมหญิง ตัวอย่าง",
      "เบอร์โทร: 0815550101",
      "",
      "ทรัพย์",
      "1. Kave Town Colony · Studio 23 ตร.ม. — 11,000 บาท",
      "",
      "มัดจำ: 5,000 บาท",
      "คงเหลือ: 6,000 บาท",
      "หมายเหตุ: สัญญา 12 เดือน เข้าอยู่ 1 ธ.ค.",
      "",
      "โอนเข้าบัญชี 000-0-00000-0",
    ].join("\n"));
    assert.doesNotMatch(res.body.text, /COD|ปลายทาง|จัดส่ง|ที่อยู่/);
  });

  it("adds a total when there is more than one line or an adjustment", async () => {
    estate();
    const id = await newLead("U1");
    await h.api("PUT", `/api/leads/${id}/order`, {
      items: [{ name: "ห้อง A", qty: 1, unit_price: 2500000 }, { name: "ที่จอดรถ", qty: 2, unit_price: 150000 }],
      discount: 50000, shipping_fee: 0, payment_method: null, deposit_amount: null, note: null,
    });
    const text = (await h.api("GET", `/api/leads/${id}/summary`)).body.text;
    assert.match(text, /1\. ห้อง A — 2,500,000 บาท\n2\. ที่จอดรถ — x2 = 300,000 บาท/);
    assert.match(text, /ส่วนลด: -50,000 บาท\nยอดรวม: 2,750,000 บาท/);
    assert.doesNotMatch(text, /มัดจำ|คงเหลือ/);
  });

  it("leaves the retail summary as it was", async () => {
    const id = await newLead("U1");
    await h.api("PUT", `/api/leads/${id}/order`, {
      items: [{ name: "iPhone 13 128GB", qty: 1, unit_price: 13900 }],
      discount: 0, shipping_fee: 0, payment_method: "transfer", deposit_amount: null, note: null,
    });
    const text = (await h.api("GET", `/api/leads/${id}/summary`)).body.text;
    assert.match(text, /^สรุปรายการสั่งซื้อ ร้านทดสอบ\n/);
    assert.match(text, /1\. iPhone 13 128GB x1 = 13,900 บาท/);
    assert.match(text, /ยอดสุทธิ: 13,900 บาท\nชำระโดย: โอนเงิน/);
  });
});

describe("webhook forwarding", () => {
  function relay() {
    const calls: { raw: string; signature: string }[] = [];
    h.deps.forward = async (raw, signature) => { calls.push({ raw, signature }); };
    return calls;
  }

  it("relays a verified call once, with the exact body and signature", async () => {
    const calls = relay();
    const event = h.textEvent("U1", "สวัสดีค่ะ ✨");
    const res = await h.webhook([event], { destination: "Uoa" });
    await h.settle();
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].raw, JSON.stringify({ destination: "Uoa", events: [event] }));
    assert.match(calls[0].signature, /^[A-Za-z0-9+/]+=*$/);
    assert.equal((await leadRow(pg, "U1")).line_user_id, "U1", "Sidecar stored the message too");
  });

  it("relays LINE's verify call and group events it does not store itself", async () => {
    const calls = relay();
    await h.webhook([]);
    await h.webhook([{ type: "message", webhookEventId: "g1", source: { type: "group", groupId: "G1", userId: "U9" }, message: { id: "m-g1", type: "text", text: "hi" } }]);
    await h.settle();
    assert.equal(calls.length, 2);
  });

  it("does not relay a call with a bad signature", async () => {
    const calls = relay();
    const res = await h.webhook([h.textEvent("U1", "x")], { signature: "bm9wZQ==" });
    await h.settle();
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  });

  it("answers LINE 200 even when the relay fails, and logs it", async () => {
    h.deps.forward = async () => { throw new Error("relay target is down"); };
    const res = await h.webhook([h.textEvent("U1", "สวัสดีค่ะ")]);
    await h.settle();
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(h.logs.some((line) => line.includes("webhook relay failed") && line.includes("relay target is down")));
    assert.ok(await leadRow(pg, "U1"));
  });

  it("does nothing extra when no relay is configured", async () => {
    const res = await h.webhook([h.textEvent("U1", "สวัสดีค่ะ")]);
    await h.settle();
    assert.equal(res.status, 200);
    assert.equal(h.logs.length, 0);
  });
});
