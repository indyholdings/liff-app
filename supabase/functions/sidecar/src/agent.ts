// What the agent does after a customer writes: read the burst once, update the
// lead card, and file images into the album. Everything here runs in the
// background (deps.defer); a failure is logged and leaves the lead untouched.

import type { Analysis, ConversationInput, Deps, Lead, SlipInfo, Stage } from "./types.ts";
import { AGENT_STAGES } from "./types.ts";
import * as repo from "./repo.ts";
import { cleanText, formatMoney, isoOrNull, logError, normalizePhone, uniqueStrings } from "./util.ts";

const CLAIM_RETRY_MS = 3000;
const CLAIM_ATTEMPTS = 20;
const MAX_IMAGE_BYTES = 4_500_000;
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function debounceMs(deps: Deps): number {
  const raw = deps.env.DEBOUNCE_MS;
  if (raw === undefined || raw === "") return 8000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 8000;
}

// Waits out the debounce window, then analyses the lead unless a newer customer
// message arrived meanwhile (that message's own task will do it). If another
// analysis holds the lead, waits for it instead of dropping the burst.
export async function analyseAfterDebounce(deps: Deps, leadId: number, messageId: number): Promise<void> {
  try {
    await deps.sleep(debounceMs(deps));
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      if ((await repo.latestInboundMessageId(deps.db, leadId)) !== messageId) return;
      if (await repo.claimLead(deps.db, leadId, deps.now())) {
        try {
          await analyseLead(deps, leadId);
        } finally {
          await repo.releaseLead(deps.db, leadId);
        }
        return;
      }
      await deps.sleep(CLAIM_RETRY_MS);
    }
    logError(deps, `lead ${leadId}: gave up waiting for a running analysis`);
  } catch (err) {
    logError(deps, `lead ${leadId}: analysis failed`, err);
  }
}

function describeForBrain(m: repo.MsgForBrain): string | null {
  if (m.type === "image") {
    const parts = ["[รูปภาพ", m.media_category ? `: ${m.media_category}` : "", m.media_caption ? ` — ${m.media_caption}` : "", "]"];
    return parts.join("");
  }
  if (m.type === "sticker") return "[สติกเกอร์]";
  if (m.type === "other") return "[ข้อความประเภทอื่น]";
  return m.text;
}

// Runs the brain on the lead's recent conversation and applies the result.
// Callers hold the lead's claim (webhook path) or accept a concurrent run (manual re-analyse).
export async function analyseLead(deps: Deps, leadId: number): Promise<void> {
  const lead = await repo.leadById(deps.db, leadId);
  if (!lead) return;
  const messages = await repo.recentMessages(deps.db, leadId, 30);
  if (!messages.length) return;
  const [products, settings] = await Promise.all([repo.listProducts(deps.db), repo.getSettings(deps.db)]);

  const input: ConversationInput = {
    shop_name: settings.shop_name,
    products: products.map((p) => ({ name: p.name, price: p.price, category: p.category })),
    lead: {
      display_name: lead.display_name, full_name: lead.full_name, phone: lead.phone,
      address: lead.address, postcode: lead.postcode, stage: lead.stage,
      interests: lead.interests, ai_summary: lead.ai_summary,
    },
    messages: messages.map((m) => ({
      direction: m.direction, type: m.type, text: describeForBrain(m),
      sent_at: isoOrNull(m.sent_at) ?? "", is_new: !m.analysed,
    })),
    now: deps.now().toISOString(),
  };

  const analysis = await deps.brain.analyzeConversation(input);
  await applyAnalysis(deps, lead, analysis);
  await repo.markAnalysed(deps.db, leadId, messages[messages.length - 1].id);
}

const FUNNEL: Stage[] = [...AGENT_STAGES];

async function applyAnalysis(deps: Deps, lead: Lead, a: Analysis): Promise<void> {
  const now = deps.now();
  const locked = new Set(lead.locked_fields);
  const patch: Record<string, unknown> = {};

  // Identity fields: fill what is empty and unlocked. A value already on the card
  // stays, and null from the model never clears anything.
  const candidates: Record<string, string | null> = {
    full_name: cleanText(a.full_name, 200),
    phone: normalizePhone(a.phone),
    address: cleanText(a.address, 500),
    postcode: /^\d{5}$/.test(String(a.postcode ?? "").trim()) ? String(a.postcode).trim() : null,
  };
  for (const [field, value] of Object.entries(candidates)) {
    const current = (lead as unknown as Record<string, unknown>)[field];
    if (value && !locked.has(field) && !current) patch[field] = value;
  }

  const interests = uniqueStrings([...lead.interests, ...(a.interests ?? [])]);
  if (interests.join("|") !== lead.interests.join("|")) patch.interests = interests;

  // The agent moves a lead only inside the pre-payment funnel. Paid, booked and
  // won are staff decisions, in both directions.
  if (!locked.has("stage") && FUNNEL.includes(lead.stage) && FUNNEL.includes(a.stage) && a.stage !== lead.stage) {
    patch.stage = a.stage;
  }

  const summary = cleanText(a.summary, 1000);
  if (summary) patch.ai_summary = summary;
  patch.next_action = cleanText(a.next_action, 500);
  patch.suggested_reply = cleanText(a.suggested_reply, 2000);

  if (typeof a.follow_up_hours === "number" && a.follow_up_hours > 0) {
    patch.follow_up_at = new Date(now.getTime() + Math.min(a.follow_up_hours, 24 * 60) * 3_600_000).toISOString();
  } else {
    // The customer just wrote back, so a follow-up that was already due is settled.
    const due = isoOrNull(lead.follow_up_at);
    if (due && new Date(due).getTime() <= now.getTime()) patch.follow_up_at = null;
  }

  await repo.updateLead(deps.db, lead.id, patch, now);

  if (summary && summary !== (lead.ai_summary ?? "").trim()) {
    await repo.addNote(deps.db, lead.id, summary, "ai", "Sidecar");
  }

  await suggestOrder(deps, lead.id, a);
}

// Turns what the customer asked for into a draft order, as long as staff have not
// touched the order themselves.
async function suggestOrder(deps: Deps, leadId: number, a: Analysis): Promise<void> {
  const wanted = (a.order_items ?? []).filter((it) => cleanText(it?.name));
  if (!wanted.length) return;
  const open = await repo.openOrder(deps.db, leadId);
  if (open && (open.staff_edited || open.status !== "draft")) return;

  const products = await repo.listProducts(deps.db);
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));
  const items = wanted.slice(0, 20).map((it) => {
    const name = cleanText(it.name, 200)!;
    const product = byName.get(name.toLowerCase()) ?? null;
    const price = typeof it.unit_price === "number" && it.unit_price >= 0 ? it.unit_price : product?.price ?? 0;
    const qty = Number.isInteger(it.qty) && it.qty > 0 ? Math.min(it.qty, 999) : 1;
    return { product_id: product?.id ?? null, name: product?.name ?? name, qty, unit_price: price };
  });
  await repo.saveOpenOrder(deps.db, leadId, {
    items,
    discount: open?.discount ?? 0, shipping_fee: open?.shipping_fee ?? 0,
    payment_method: open?.payment_method ?? null, deposit_amount: open?.deposit_amount ?? null,
    note: open?.note ?? null,
  }, false, deps.now());
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

// Downloads a customer image from LINE, stores it in the album and classifies it.
// A slip is compared with the open order and flagged for staff. It never marks
// anything paid: reading a slip is not proof that money arrived.
export async function processImage(
  deps: Deps, leadId: number, messageId: number, lineMessageId: string,
): Promise<void> {
  try {
    const { bytes, contentType } = await deps.line.getContent(lineMessageId);
    const type = (contentType || "image/jpeg").split(";")[0].trim().toLowerCase();
    const path = `${leadId}/${lineMessageId}.${extensionFor(type)}`;
    await deps.storage.upload(path, bytes, type);
    const media = await repo.insertMedia(deps.db, leadId, path, type);
    await repo.setMessageMedia(deps.db, messageId, media.id);

    if (!VISION_TYPES.has(type) || bytes.length > MAX_IMAGE_BYTES) {
      logError(deps, `media ${media.id}: stored without analysis (${type}, ${bytes.length} bytes)`);
      return;
    }

    const settings = await repo.getSettings(deps.db);
    const result = await deps.brain.analyzeImage({ bytes, contentType: type, shop_name: settings.shop_name });

    let slip: SlipInfo | null = null;
    if (result.category === "slip") {
      const amount = typeof result.slip?.amount === "number" ? result.slip.amount : null;
      const order = await repo.openOrder(deps.db, leadId);
      let matches: boolean | null = null;
      if (amount !== null && order) {
        const targets = [order.total, order.deposit_amount].filter((n): n is number => typeof n === "number" && n > 0);
        matches = targets.some((t) => Math.abs(t - amount) < 0.01);
      }
      slip = {
        amount, paid_at: result.slip?.paid_at ?? null, bank: result.slip?.bank ?? null,
        ref: result.slip?.ref ?? null, matches_order: matches,
      };
      const amountText = amount === null ? "อ่านยอดไม่ได้" : `ยอด ${formatMoney(amount)} บาท`;
      const verdict = matches === true
        ? "ตรงกับยอดออเดอร์"
        : matches === false
        ? `ไม่ตรงกับยอดออเดอร์ (${formatMoney(order!.total)} บาท)`
        : order ? "เทียบยอดไม่ได้" : "ยังไม่มีออเดอร์ให้เทียบ";
      await repo.addNote(
        deps.db, leadId,
        `ลูกค้าส่งสลิป ${amountText} — ${verdict} รอแอดมินตรวจยอดเข้าและกดยืนยัน`,
        "system", "Sidecar",
      );
    }
    await repo.updateMedia(deps.db, media.id, {
      category: result.category, caption: cleanText(result.caption, 300), slip,
    });
  } catch (err) {
    logError(deps, `lead ${leadId}: image ${lineMessageId} failed`, err);
  }
}
