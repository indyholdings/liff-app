import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatMoney, hmacSha256Base64, normalizePhone, sha256Hex, timingSafeEqual, uniqueStrings,
} from "../supabase/functions/sidecar/src/util.ts";
import { routePath } from "../supabase/functions/sidecar/src/router.ts";
import { verifySignature } from "../supabase/functions/sidecar/src/webhook.ts";
import { createHash } from "node:crypto";
import {
  BrainError, CONVERSATION_SCHEMA, conversationSchemaWithDetails, createBrain, IMAGE_SCHEMA,
} from "../supabase/functions/sidecar/src/brain.ts";
import { defaultModel, getProfile } from "../supabase/functions/sidecar/src/profiles.ts";
import type { ConversationInput } from "../supabase/functions/sidecar/src/types.ts";

describe("util", () => {
  it("normalises Thai phone numbers", () => {
    assert.equal(normalizePhone("+66812345678"), "0812345678");
    assert.equal(normalizePhone("66812345678"), "0812345678");
    assert.equal(normalizePhone("081-234-5678"), "0812345678");
    assert.equal(normalizePhone("081 234 5678"), "0812345678");
    assert.equal(normalizePhone("0929479744"), "0929479744");
    assert.equal(normalizePhone("812345678"), "0812345678");
    assert.equal(normalizePhone("02-123-4567"), "021234567");
    assert.equal(normalizePhone("0661234567"), "0661234567");
    assert.equal(normalizePhone("12345"), null);
    assert.equal(normalizePhone(""), null);
    assert.equal(normalizePhone(null), null);
  });

  it("formats money with thousands separators", () => {
    assert.equal(formatMoney(1599), "1,599");
    assert.equal(formatMoney(15999.5), "15,999.50");
    assert.equal(formatMoney(1234567.891), "1,234,567.89");
    assert.equal(formatMoney(0), "0");
    assert.equal(formatMoney(-200), "-200");
  });

  it("hashes and signs with known vectors", async () => {
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // RFC 4231 test case 2
    assert.equal(await hmacSha256Base64("Jefe", "what do ya want for nothing?"), "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=");
    assert.equal(await verifySignature("Jefe", "what do ya want for nothing?", "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM="), true);
    assert.equal(await verifySignature("Jefe", "tampered", "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM="), false);
    assert.equal(await verifySignature("", "x", "y"), false);
    assert.equal(await verifySignature("Jefe", "x", null), false);
  });

  it("compares strings without short-circuiting on length", () => {
    assert.equal(timingSafeEqual("abc", "abc"), true);
    assert.equal(timingSafeEqual("abc", "abd"), false);
    assert.equal(timingSafeEqual("abc", "abcd"), false);
    assert.equal(timingSafeEqual("", ""), true);
  });

  it("dedupes labels case-insensitively", () => {
    assert.deepEqual(uniqueStrings(["Filler", " filler ", "", 3, "Botox"]), ["Filler", "Botox"]);
  });

  it("strips the Supabase function prefix from paths", () => {
    assert.equal(routePath("/functions/v1/sidecar/api/leads"), "/api/leads");
    assert.equal(routePath("/sidecar/webhook"), "/webhook");
    assert.equal(routePath("/sidecar"), "/");
    assert.equal(routePath("/api/leads/"), "/api/leads");
    assert.equal(routePath("/sidecarx/health"), "/sidecarx/health");
  });
});

const input: ConversationInput = {
  shop_name: "JAIFU",
  products: [{ name: "iPhone 13 128GB", price: 13900, category: "iPhone" }, { name: "AirPods Pro 2", price: 5490, category: null }],
  lead: { display_name: "มายด์", full_name: null, phone: null, address: null, postcode: null, stage: "new", interests: [], ai_summary: null },
  messages: [{ direction: "in", type: "text", text: "สนใจ iPhone 13 ค่ะ", sent_at: "2026-11-23T10:00:00.000Z", is_new: true }],
  now: "2026-11-23T10:00:05.000Z",
};

const goodAnalysis = {
  full_name: null, phone: " 0815550101 ", address: null, postcode: null, interests: ["iPhone 13 128GB"],
  stage: "interested", summary: "สนใจ iPhone 13", next_action: "แจ้งราคา", suggested_reply: "สวัสดีค่ะ",
  order_items: [{ name: "iPhone 13 128GB", qty: 1, unit_price: 13900 }], follow_up_hours: 24,
};

function stubClient(response: unknown) {
  const calls: any[] = [];
  return {
    calls,
    client: { beta: { messages: { create: async (params: any) => { calls.push(params); return response; } } } },
  };
}

const textResponse = (value: unknown) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] });

describe("brain", () => {
  it("sends a structured-output request with fallbacks on Opus", async () => {
    const { client, calls } = stubClient(textResponse(goodAnalysis));
    const result = await createBrain(client).analyzeConversation(input);
    const p = calls[0];
    assert.equal(p.model, "claude-opus-5-5");
    assert.equal(p.max_tokens, 4000);
    assert.equal(p.output_config.effort, "low");
    assert.equal(p.output_config.format.type, "json_schema");
    assert.equal(p.output_config.format.schema, CONVERSATION_SCHEMA);
    assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
    assert.equal(p.fallbacks, "default");
    assert.ok(!("thinking" in p) && !("temperature" in p));
    assert.equal(p.system[0].cache_control.type, "ephemeral");
    assert.match(p.system[0].text, /JAIFU/);
    assert.match(p.system[0].text, /AirPods Pro 2 \| 5490 THB\n- iPhone 13 128GB \| 13900 THB \| iPhone/);
    assert.doesNotMatch(p.system[0].text, /2026-11-23/, "nothing volatile in the cached prefix");
    assert.equal(p.messages.length, 1);
    assert.match(p.messages[0].content, /NEW \[2026-11-23T10:00:00.000Z\] CUSTOMER: สนใจ iPhone 13 ค่ะ/);
    assert.equal(result.phone, "0815550101");
    assert.equal(result.stage, "interested");
    assert.deepEqual(result.order_items, [{ name: "iPhone 13 128GB", qty: 1, unit_price: 13900 }]);
  });

  it("omits fallbacks and betas on models that do not take them", async () => {
    const { client, calls } = stubClient(textResponse(goodAnalysis));
    await createBrain(client, { model: "claude-haiku-5-5" }).analyzeConversation(input);
    assert.equal(calls[0].model, "claude-haiku-5-5");
    assert.ok(!("fallbacks" in calls[0]));
    assert.ok(!("betas" in calls[0]));
  });

  it("sends an image as a base64 block before the text", async () => {
    const { client, calls } = stubClient(textResponse({ category: "slip", caption: "สลิป", slip: { amount: 1599, paid_at: null, bank: "KBank", ref: null } }));
    const result = await createBrain(client).analyzeImage({ bytes: new Uint8Array([104, 105]), contentType: "image/jpeg", shop_name: "JAIFU" });
    const content = calls[0].messages[0].content;
    assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGk=" } });
    assert.equal(content[1].type, "text");
    assert.equal(calls[0].output_config.format.schema, IMAGE_SCHEMA);
    assert.deepEqual(result, { category: "slip", caption: "สลิป", slip: { amount: 1599, paid_at: null, bank: "KBank", ref: null } });
  });

  it("drops slip data for non-slip images", async () => {
    const { client } = stubClient(textResponse({ category: "product", caption: null, slip: { amount: 5, paid_at: null, bank: null, ref: null } }));
    const result = await createBrain(client).analyzeImage({ bytes: new Uint8Array([1]), contentType: "image/png", shop_name: "" });
    assert.deepEqual(result, { category: "product", caption: null, slip: null });
  });

  it("reads the answer past a fallback block", async () => {
    const { client } = stubClient({
      stop_reason: "end_turn",
      content: [{ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "x" } }, { type: "text", text: JSON.stringify(goodAnalysis) }],
    });
    assert.equal((await createBrain(client).analyzeConversation(input)).summary, "สนใจ iPhone 13");
  });

  it("throws a typed error on refusal, truncation and unusable output", async () => {
    const cases: [unknown, string][] = [
      [{ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }, "refusal"],
      [{ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"full_na" }] }, "max_tokens"],
      [{ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }, "bad_output"],
      [{ stop_reason: "end_turn", content: [] }, "bad_output"],
      [textResponse({ ...goodAnalysis, stage: "paid" }), "bad_output"],
      [textResponse([1, 2]), "bad_output"],
    ];
    for (const [response, reason] of cases) {
      await assert.rejects(
        createBrain(stubClient(response).client).analyzeConversation(input),
        (err: unknown) => err instanceof BrainError && err.reason === reason,
      );
    }
  });

  it("keeps every schema object closed with all keys required", () => {
    const check = (node: any, path: string) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `${path}.additionalProperties`);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path}.required`);
      }
      for (const bad of ["minimum", "maximum", "multipleOf", "minLength", "maxLength"]) assert.ok(!(bad in node), `${path}.${bad}`);
      for (const [key, value] of Object.entries(node)) {
        if (Array.isArray(value)) value.forEach((v, i) => check(v, `${path}.${key}[${i}]`));
        else check(value, `${path}.${key}`);
      }
    };
    check(CONVERSATION_SCHEMA, "conversation");
    check(IMAGE_SCHEMA, "image");
    check(conversationSchemaWithDetails(getProfile("real_estate").detail_fields), "conversation+details");
  });
});

describe("brain per profile", () => {
  const estate = getProfile("real_estate");
  const estateInput: ConversationInput = {
    ...input,
    profile: "real_estate",
    detail_fields: estate.detail_fields,
    shop_name: "Globallink Estate",
    products: [{ name: "Kave Town Colony · Studio 23 ตร.ม.", price: 11000, category: "เช่า" }],
    lead: { ...input.lead, details: { intent: "rent" } },
    messages: [{ direction: "in", type: "text", text: "หาห้องเช่าใกล้ ม.กรุงเทพ งบ 12,000", sent_at: "2026-11-26T03:00:00.000Z", is_new: true }],
  };
  const estateAnalysis = {
    ...goodAnalysis, phone: null, interests: ["Kave Town Colony"], order_items: [],
    details: { role: "tenant", intent: "rent", budget: " 12,000/เดือน ", location: "ใกล้ ม.กรุงเทพ", unit_type: null, move_in: null, property_code: "" },
  };

  it("keeps the retail request exactly as it was before profiles", async () => {
    // Pinned from the request the code sent before profiles existed. If this
    // fails, the retail prompt, schema or request shape changed.
    const answer = textResponse({ ...goodAnalysis, phone: null, interests: [], stage: "new", summary: "x", next_action: "", suggested_reply: "", order_items: [], follow_up_hours: null });
    const image = textResponse({ category: "other", caption: null, slip: null });
    for (const extra of [{}, { profile: "retail" as const, detail_fields: [], lead: { ...input.lead, details: {} } }]) {
      const calls: any[] = [];
      const client = { beta: { messages: { create: async (p: any) => { calls.push(p); return calls.length === 1 ? answer : image; } } } };
      const brain = createBrain(client);
      await brain.analyzeConversation({ ...input, ...extra });
      await brain.analyzeImage({ bytes: new Uint8Array([1, 2]), contentType: "image/png", shop_name: "JAIFU", ...("profile" in extra ? { profile: "retail" as const } : {}) });
      assert.equal(
        createHash("sha256").update(JSON.stringify(calls)).digest("hex"),
        "c6b0cb4f8bdc42271c058422257026c28740cfc48d1bf53481c269f9e7db9dfa",
      );
    }
  });

  it("sends the property-agency prompt and a details schema for real_estate", async () => {
    const { client, calls } = stubClient(textResponse(estateAnalysis));
    const result = await createBrain(client, { model: defaultModel("real_estate") }).analyzeConversation(estateInput);
    const p = calls[0];
    assert.equal(p.model, "claude-haiku-5-5");
    assert.ok(!("fallbacks" in p) && !("betas" in p) && !("thinking" in p) && !("temperature" in p));
    assert.equal(p.output_config.effort, "low");
    const schema = p.output_config.format.schema;
    assert.notEqual(schema, CONVERSATION_SCHEMA);
    assert.ok(schema.required.includes("details"));
    assert.deepEqual(schema.properties.details.required, ["role", "intent", "budget", "location", "unit_type", "move_in", "property_code"]);
    assert.deepEqual(schema.properties.details.properties.intent.anyOf[0].enum, ["list_sale", "list_rent", "buy", "rent", "after_sales", "service"]);
    assert.deepEqual(schema.properties.details.properties.budget, { anyOf: [{ type: "string" }, { type: "null" }] });
    assert.ok(!("details" in CONVERSATION_SCHEMA.properties), "the retail schema is not touched");

    const system = p.system[0].text;
    assert.match(system, /property agency/);
    assert.match(system, /Globallink Estate/);
    assert.match(system, /role: .*One of: owner \(เจ้าของทรัพย์\), buyer \(ผู้ซื้อ\), tenant \(ผู้เช่า\), co_agent \(Co-agent\), resident \(ลูกบ้าน\)\./);
    assert.match(system, /an officer will check and confirm/);
    assert.match(system, /Kave Town Colony · Studio 23 ตร.ม. \| 11000 THB \| เช่า/);
    assert.doesNotMatch(system, /2026-11-26/, "nothing volatile in the cached prefix");
    assert.equal(p.system[0].cache_control.type, "ephemeral");
    assert.match(p.messages[0].content, /"details": \{\n\s+"intent": "rent"\n\s+\}/, "the card shows what is already known");

    assert.deepEqual(result.details, {
      role: "tenant", intent: "rent", budget: "12,000/เดือน", location: "ใกล้ ม.กรุงเทพ",
      unit_type: null, move_in: null, property_code: null,
    });
  });

  it("uses the property image prompt only for real_estate", async () => {
    const answer = textResponse({ category: "product", caption: "รูปห้อง", slip: null });
    const a = stubClient(answer);
    await createBrain(a.client).analyzeImage({ bytes: new Uint8Array([1]), contentType: "image/png", shop_name: "", profile: "real_estate" });
    assert.match(a.calls[0].system[0].text, /property agency/);
    assert.equal(a.calls[0].output_config.format.schema, IMAGE_SCHEMA);
    const b = stubClient(answer);
    await createBrain(b.client).analyzeImage({ bytes: new Uint8Array([1]), contentType: "image/png", shop_name: "" });
    assert.doesNotMatch(b.calls[0].system[0].text, /property agency/);
  });

  it("picks the model by profile and falls back to retail for unknown names", () => {
    assert.equal(defaultModel(undefined), "claude-opus-5-5");
    assert.equal(defaultModel("retail"), "claude-opus-5-5");
    assert.equal(defaultModel("real_estate"), "claude-haiku-5-5");
    assert.equal(getProfile("nope").profile, "retail");
    assert.equal(getProfile(undefined).profile, "retail");
  });
});
