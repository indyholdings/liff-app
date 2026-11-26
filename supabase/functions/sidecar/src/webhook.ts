// LINE Messaging API webhook. Verifies the signature, stores what the customer
// sent, answers 200 straight away and leaves the thinking to background tasks.

import type { Deps, Msg } from "./types.ts";
import * as repo from "./repo.ts";
import { analyseAfterDebounce, processImage } from "./agent.ts";
import { fail, hmacSha256Base64, logError, ok, timingSafeEqual } from "./util.ts";

interface LineEvent {
  type: string;
  webhookEventId?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string };
  message?: { id?: string; type?: string; text?: string };
}

export async function verifySignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!secret || !signature) return false;
  return timingSafeEqual(await hmacSha256Base64(secret, rawBody), signature);
}

function preview(type: Msg["type"], text: string | null): string {
  if (type === "image") return "[รูปภาพ]";
  if (type === "sticker") return "[สติกเกอร์]";
  if (type === "other") return "[ข้อความประเภทอื่น]";
  return (text ?? "").replace(/\s+/g, " ").slice(0, 80);
}

async function fillProfile(deps: Deps, leadId: number, userId: string): Promise<void> {
  try {
    const profile = await deps.line.getProfile(userId);
    if (!profile) return;
    await repo.updateLead(deps.db, leadId, {
      display_name: profile.displayName ?? null,
      picture_url: profile.pictureUrl ?? null,
    }, deps.now());
  } catch (err) {
    logError(deps, `lead ${leadId}: profile fetch failed`, err);
  }
}

async function handleEvent(deps: Deps, event: LineEvent, destination: string | null): Promise<void> {
  // One-to-one chats only. Groups and rooms are not customer leads.
  const userId = event.source?.userId;
  if (event.source?.type !== "user" || !userId) return;
  if (event.type !== "message" && event.type !== "follow") return;
  if (event.webhookEventId && !(await repo.recordWebhookEvent(deps.db, event.webhookEventId))) return;
  try {
    await storeEvent(deps, event, userId, destination);
  } catch (err) {
    // Let a LINE redelivery try this event again.
    if (event.webhookEventId) await repo.forgetWebhookEvent(deps.db, event.webhookEventId).catch(() => {});
    throw err;
  }
}

async function storeEvent(deps: Deps, event: LineEvent, userId: string, destination: string | null): Promise<void> {
  const lead = await repo.upsertLeadByLineUser(deps.db, userId, destination);
  if (lead.inserted || !lead.display_name) deps.defer(fillProfile(deps, lead.id, userId));
  if (event.type !== "message" || !event.message) return;

  const kind = event.message.type;
  const type: Msg["type"] = kind === "text" ? "text" : kind === "image" ? "image" : kind === "sticker" ? "sticker" : "other";
  const text = type === "text" ? (event.message.text ?? "").slice(0, 5000) : null;
  const sentAt = typeof event.timestamp === "number" ? new Date(event.timestamp) : deps.now();

  const messageId = await repo.insertMessage(deps.db, {
    lead_id: lead.id, line_message_id: event.message.id ?? null, direction: "in", type, text, sent_at: sentAt,
  });
  if (messageId === null) return; // already stored

  await repo.updateLead(deps.db, lead.id, {
    last_message_at: sentAt.toISOString(), last_message_preview: preview(type, text),
  }, deps.now());

  if (type === "image" && event.message.id) {
    const lineMessageId = event.message.id;
    deps.defer(
      processImage(deps, lead.id, messageId, lineMessageId).then(() => analyseAfterDebounce(deps, lead.id, messageId)),
    );
  } else {
    deps.defer(analyseAfterDebounce(deps, lead.id, messageId));
  }
}

export async function handleWebhook(req: Request, deps: Deps): Promise<Response> {
  if (deps.missing?.length) {
    return fail("not_configured", `Missing secrets: ${deps.missing.join(", ")}`);
  }
  const rawBody = await req.text();
  if (!(await verifySignature(deps.env.LINE_CHANNEL_SECRET, rawBody, req.headers.get("x-line-signature")))) {
    return fail("unauthorized", "Invalid LINE signature");
  }
  const signature = req.headers.get("x-line-signature") ?? "";
  let payload: { destination?: string; events?: LineEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return fail("bad_request", "Body is not JSON");
  }
  let failed = false;
  for (const event of payload.events ?? []) {
    try {
      await handleEvent(deps, event, payload.destination ?? null);
    } catch (err) {
      failed = true;
      logError(deps, "webhook event failed", err);
    }
  }
  // A LINE channel has one webhook URL, so another system that needs these events
  // gets the call relayed unchanged. It goes out even when storing failed here:
  // a problem in Sidecar must not silence the other system. If LINE then
  // redelivers, the receiver sees the events again, marked as a redelivery.
  const forward = deps.forward;
  if (forward) {
    deps.defer(
      Promise.resolve().then(() => forward(rawBody, signature)).catch((err) => logError(deps, "webhook relay failed", err)),
    );
  }
  // A non-2xx answer makes LINE redeliver; events already stored are skipped by id.
  return failed ? fail("internal", "Some events could not be stored") : ok();
}
