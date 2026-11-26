// Staff API. Every route needs a staff token (or a LIFF id token bound to a
// staff row), except minting a token, which needs the admin key.

import type { Deps, Lead, Order, Staff, Stage } from "./types.ts";
import {
  LOCKABLE_FIELDS, MEDIA_CATEGORIES, ORDER_STATUSES, PAYMENT_METHODS, STAGES,
} from "./types.ts";
import * as repo from "./repo.ts";
import { analyseLead } from "./agent.ts";
import { buildOrderSummary } from "./summary.ts";
import { cleanDetail, getProfile } from "./profiles.ts";
import {
  badRequest, cleanText, HttpError, isoOrNull, normalizePhone, notFound, ok, randomToken,
  round2, sha256Hex, timingSafeEqual, uniqueStrings,
} from "./util.ts";

type Handler = (ctx: Ctx) => Promise<Response>;
interface Ctx { req: Request; url: URL; deps: Deps; params: string[]; staff: Staff; body: Record<string, unknown>; }

async function authenticate(req: Request, deps: Deps): Promise<Staff> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (bearer) {
    const staff = await repo.staffByTokenHash(deps.db, await sha256Hex(bearer));
    if (staff) return staff;
    throw new HttpError("unauthorized", "Unknown staff token");
  }
  const idToken = req.headers.get("x-line-id-token");
  if (idToken) {
    const identity = await deps.line.verifyIdToken(idToken);
    const staff = identity ? await repo.staffByLineUser(deps.db, identity.sub) : null;
    if (staff) return staff;
    throw new HttpError("unauthorized", "This LINE account is not linked to a staff member");
  }
  throw new HttpError("unauthorized", "Staff token required");
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const text = await req.text();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Body is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest("Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest("Invalid id");
  return n;
}

function money(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw badRequest(`${field} must be a number of 0 or more`);
  return round2(n);
}

async function requireLead(deps: Deps, id: number): Promise<Lead> {
  const lead = await repo.leadById(deps.db, id);
  if (!lead) throw notFound("Lead not found");
  return lead;
}

function publicOrder(order: repo.OrderWithFlag | null): Order | null {
  if (!order) return null;
  const { staff_edited: _flag, ...rest } = order;
  return rest;
}

async function bundle(deps: Deps, lead: Lead, match: "chat_id" | "id") {
  const [notes, mediaRows, order, messages, samePhone] = await Promise.all([
    repo.listNotes(deps.db, lead.id),
    repo.listMedia(deps.db, lead.id),
    repo.currentOrder(deps.db, lead.id),
    repo.recentMessages(deps.db, lead.id, 30),
    lead.phone ? repo.leadsWithPhone(deps.db, lead.phone, lead.id) : Promise.resolve([]),
  ]);
  const media = await Promise.all(mediaRows.map((row) => repo.toMedia(row, (path, expires) => deps.storage.signedUrl(path, expires))));
  return {
    lead, match, candidates: [], notes, media, order: publicOrder(order),
    messages: messages.map((m) => ({
      id: m.id, direction: m.direction, type: m.type, text: m.text, media_id: m.media_id, sent_at: m.sent_at,
    })),
    same_phone: samePhone,
  };
}

const emptyBundle = (candidates: unknown[]) => ({
  lead: null, match: "none", candidates, notes: [], media: [], order: null, messages: [], same_phone: [],
});

// ---- handlers ----

const me: Handler = async ({ staff }) => ok({ staff });

const config: Handler = async ({ deps }) => ok({ config: getProfile(deps.env.PROFILE) });

const staffList: Handler = async ({ deps }) => ok({ staff: await repo.listStaff(deps.db) });

const leadsList: Handler = async ({ url, deps }) => {
  const stage = url.searchParams.get("stage") || undefined;
  if (stage && !(STAGES as readonly string[]).includes(stage)) throw badRequest("Unknown stage");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  const result = await repo.listLeads(deps.db, {
    stage: stage as Stage | undefined,
    q: url.searchParams.get("q")?.trim() || undefined,
    due: url.searchParams.get("due") === "1",
    limit, offset, now: deps.now(),
  });
  return ok(result);
};

const leadGet: Handler = async ({ deps, params }) => ok(await bundle(deps, await requireLead(deps, intParam(params[0])), "id"));

const leadByChat: Handler = async ({ url, deps, params }) => {
  let chatId: string;
  try {
    chatId = decodeURIComponent(params[0]);
  } catch {
    throw badRequest("Invalid chat id");
  }
  const lead = await repo.leadByChat(deps.db, chatId);
  if (lead) return ok(await bundle(deps, lead, "chat_id"));
  const name = url.searchParams.get("name")?.trim();
  return ok(emptyBundle(name ? await repo.leadsByDisplayName(deps.db, name) : []));
};

const leadPatch: Handler = async ({ deps, params, body }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  const patch: Record<string, unknown> = {};
  const locked = new Set(lead.locked_fields);

  for (const field of ["full_name", "address", "postcode"] as const) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") throw badRequest(`${field} must be text`);
    patch[field] = cleanText(body[field], 500);
  }
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === "") patch.phone = null;
    else {
      const phone = normalizePhone(body.phone);
      if (!phone) throw badRequest("phone does not look like a Thai phone number");
      patch.phone = phone;
    }
  }
  if (body.stage !== undefined) {
    if (!(STAGES as readonly string[]).includes(body.stage as string)) throw badRequest("Unknown stage");
    patch.stage = body.stage;
  }
  for (const field of ["tags", "interests"] as const) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field])) throw badRequest(`${field} must be a list`);
    patch[field] = uniqueStrings(body[field], 30);
  }
  if (body.assignee_id !== undefined) {
    if (body.assignee_id === null) patch.assignee_id = null;
    else {
      const assignee = Number.isInteger(body.assignee_id) ? await repo.staffById(deps.db, body.assignee_id as number) : null;
      if (!assignee) throw badRequest("Unknown assignee");
      patch.assignee_id = assignee.id;
    }
  }
  if (body.follow_up_at !== undefined) {
    if (body.follow_up_at === null || body.follow_up_at === "") patch.follow_up_at = null;
    else {
      const when = isoOrNull(body.follow_up_at);
      if (!when) throw badRequest("follow_up_at must be a date");
      patch.follow_up_at = when;
    }
  }

  // Profile fields: keys are merged, an empty value removes the key. The same
  // lock rule applies, under the name details.<key>.
  if (body.details !== undefined) {
    if (!body.details || typeof body.details !== "object" || Array.isArray(body.details)) {
      throw badRequest("details must be an object");
    }
    const fields = new Map(getProfile(deps.env.PROFILE).detail_fields.map((f) => [f.key, f]));
    const details = { ...(lead.details ?? {}) };
    for (const [key, raw] of Object.entries(body.details as Record<string, unknown>)) {
      const field = fields.get(key);
      if (!field) throw badRequest(`Unknown detail: ${key}`);
      if (raw === null || (typeof raw === "string" && !raw.trim())) {
        delete details[key];
        locked.delete(`details.${key}`);
        continue;
      }
      const value = cleanDetail(field, raw);
      if (!value) {
        throw badRequest(field.type === "select" ? `details.${key} is not one of the listed values` : `details.${key} must be text`);
      }
      details[key] = value;
      locked.add(`details.${key}`);
    }
    patch.details = details;
  }

  // A staff edit wins over the agent from now on. Clearing a field hands it back.
  for (const field of LOCKABLE_FIELDS) {
    if (!(field in patch)) continue;
    if (patch[field] === null) locked.delete(field);
    else locked.add(field);
  }
  if (Array.isArray(body.unlock)) for (const field of body.unlock) locked.delete(String(field));
  patch.locked_fields = [...locked];

  await repo.updateLead(deps.db, lead.id, patch, deps.now());
  return ok({ lead: await repo.leadById(deps.db, lead.id) });
};

const leadLinkChat: Handler = async ({ deps, params, body }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  const chatId = cleanText(body.chat_id, 200);
  if (!chatId) throw badRequest("chat_id is required");
  await repo.linkChat(deps.db, lead.id, chatId, deps.now());
  return ok({ lead: await repo.leadById(deps.db, lead.id) });
};

const leadAnalyze: Handler = async ({ deps, params }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  await analyseLead(deps, lead.id);
  return ok(await bundle(deps, (await repo.leadById(deps.db, lead.id))!, "id"));
};

const noteAdd: Handler = async ({ deps, params, body, staff }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  const text = cleanText(body.body, 5000);
  if (!text) throw badRequest("body is required");
  return ok({ note: await repo.addNote(deps.db, lead.id, text, "staff", staff.name, body.pinned === true) });
};

const noteDelete: Handler = async ({ deps, params, staff }) => {
  const by = { name: staff.name, isAdmin: staff.role === "admin" };
  if (!(await repo.deleteNote(deps.db, intParam(params[0]), by))) throw notFound("Note not found or not yours to delete");
  return ok();
};

const mediaPatch: Handler = async ({ deps, params, body }) => {
  const id = intParam(params[0]);
  const patch: { category?: (typeof MEDIA_CATEGORIES)[number]; caption?: string | null } = {};
  if (body.category !== undefined) {
    if (!(MEDIA_CATEGORIES as readonly string[]).includes(body.category as string)) throw badRequest("Unknown category");
    patch.category = body.category as (typeof MEDIA_CATEGORIES)[number];
  }
  if (body.caption !== undefined) patch.caption = cleanText(body.caption, 300);
  const row = await repo.updateMedia(deps.db, id, patch);
  if (!row) throw notFound("Media not found");
  return ok({ media: await repo.toMedia(row, (path, expires) => deps.storage.signedUrl(path, expires)) });
};

const orderPut: Handler = async ({ deps, params, body }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  if (!Array.isArray(body.items)) throw badRequest("items must be a list");
  if (body.items.length > 50) throw badRequest("Too many items");
  const items = body.items.map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const name = cleanText(it.name, 200);
    if (!name) throw badRequest(`items[${i}].name is required`);
    const qty = Number(it.qty ?? 1);
    if (!Number.isInteger(qty) || qty <= 0 || qty > 9999) throw badRequest(`items[${i}].qty must be a whole number above 0`);
    const productId = it.product_id == null ? null : Number(it.product_id);
    if (productId !== null && (!Number.isInteger(productId) || productId <= 0)) throw badRequest(`items[${i}].product_id is invalid`);
    return { product_id: productId, name, qty, unit_price: money(it.unit_price, `items[${i}].unit_price`, 0) };
  });
  const method = body.payment_method ?? null;
  if (method !== null && !(PAYMENT_METHODS as readonly string[]).includes(method as string)) throw badRequest("Unknown payment_method");
  const deposit = body.deposit_amount == null || body.deposit_amount === "" ? null : money(body.deposit_amount, "deposit_amount", 0);
  const order = await repo.saveOpenOrder(deps.db, lead.id, {
    items,
    discount: money(body.discount, "discount", 0),
    shipping_fee: money(body.shipping_fee, "shipping_fee", 0),
    payment_method: method as (typeof PAYMENT_METHODS)[number] | null,
    deposit_amount: deposit,
    note: cleanText(body.note, 1000),
  }, true, deps.now());
  return ok({ order: publicOrder(order) });
};

const orderStatus: Handler = async ({ deps, params, body }) => {
  const existing = await repo.orderById(deps.db, intParam(params[0]));
  if (!existing) throw notFound("Order not found");
  if (!(ORDER_STATUSES as readonly string[]).includes(body.status as string)) throw badRequest("Unknown status");
  const status = body.status as (typeof ORDER_STATUSES)[number];
  const order = await repo.setOrderStatus(deps.db, existing.id, status, deps.now());
  const lead = await requireLead(deps, existing.lead_id);
  if ((status === "awaiting_payment" || status === "paid") && !lead.locked_fields.includes("stage") && lead.stage !== status) {
    await repo.updateLead(deps.db, lead.id, { stage: status }, deps.now());
  }
  return ok({ order: publicOrder(order), lead: await repo.leadById(deps.db, lead.id) });
};

const leadSummary: Handler = async ({ deps, params }) => {
  const lead = await requireLead(deps, intParam(params[0]));
  const order = await repo.currentOrder(deps.db, lead.id);
  if (!order || !order.items.length) throw notFound("This lead has no order yet");
  const profile = getProfile(deps.env.PROFILE).profile;
  return ok({ text: buildOrderSummary(order, lead, await repo.getSettings(deps.db), profile) });
};

const productsList: Handler = async ({ url, deps }) =>
  ok({
    products: await repo.listProducts(deps.db, {
      q: url.searchParams.get("q")?.trim() || undefined,
      includeInactive: url.searchParams.get("all") === "1",
    }),
  });

const productCreate: Handler = async ({ deps, body }) => {
  const name = cleanText(body.name, 200);
  if (!name) throw badRequest("name is required");
  return ok({
    product: await repo.createProduct(deps.db, {
      sku: cleanText(body.sku, 80), name, price: money(body.price, "price", 0), category: cleanText(body.category, 80),
    }),
  });
};

const productPatch: Handler = async ({ deps, params, body }) => {
  const patch: Parameters<typeof repo.updateProduct>[2] = {};
  if (body.name !== undefined) {
    const name = cleanText(body.name, 200);
    if (!name) throw badRequest("name cannot be empty");
    patch.name = name;
  }
  if (body.price !== undefined) patch.price = money(body.price, "price", 0);
  if (body.category !== undefined) patch.category = cleanText(body.category, 80);
  if (body.sku !== undefined) patch.sku = cleanText(body.sku, 80);
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") throw badRequest("active must be true or false");
    patch.active = body.active;
  }
  const product = await repo.updateProduct(deps.db, intParam(params[0]), patch);
  if (!product) throw notFound("Product not found");
  return ok({ product });
};

const settingsGet: Handler = async ({ deps }) => ok({ settings: await repo.getSettings(deps.db) });

const settingsPut: Handler = async ({ deps, body, staff }) => {
  if (staff.role !== "admin") throw new HttpError("forbidden", "Only an admin can change settings");
  const patch: Record<string, string> = {};
  for (const key of ["shop_name", "payment_instructions"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") throw badRequest(`${key} must be text`);
    patch[key] = (body[key] as string).trim().slice(0, 2000);
  }
  return ok({ settings: await repo.putSettings(deps.db, patch) });
};

const staffLinkLine: Handler = async ({ req, deps, staff }) => {
  const idToken = req.headers.get("x-line-id-token");
  if (!idToken) throw badRequest("X-Line-Id-Token header is required");
  const identity = await deps.line.verifyIdToken(idToken);
  if (!identity) throw new HttpError("unauthorized", "LINE id token could not be verified");
  return ok({ staff: await repo.bindStaffLine(deps.db, staff.id, identity.sub) });
};

async function adminCreateStaff(req: Request, deps: Deps): Promise<Response> {
  const key = req.headers.get("x-admin-key") ?? "";
  if (!deps.env.SIDECAR_ADMIN_KEY) throw new HttpError("not_configured", "SIDECAR_ADMIN_KEY is not set");
  if (!key || !timingSafeEqual(key, deps.env.SIDECAR_ADMIN_KEY)) throw new HttpError("unauthorized", "Invalid admin key");
  const body = await readBody(req);
  const name = cleanText(body.name, 120);
  if (!name) throw badRequest("name is required");
  const role = body.role ?? "agent";
  if (role !== "admin" && role !== "agent") throw badRequest("role must be admin or agent");
  const token = randomToken();
  const staff = await repo.createStaff(deps.db, name, role, await sha256Hex(token));
  return ok({ staff, token });
}

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/me$/, me],
  ["GET", /^\/api\/config$/, config],
  ["GET", /^\/api\/staff$/, staffList],
  ["POST", /^\/api\/staff\/link-line$/, staffLinkLine],
  ["GET", /^\/api\/leads$/, leadsList],
  ["GET", /^\/api\/leads\/by-chat\/([^/]+)$/, leadByChat],
  ["GET", /^\/api\/leads\/(\d+)$/, leadGet],
  ["PATCH", /^\/api\/leads\/(\d+)$/, leadPatch],
  ["POST", /^\/api\/leads\/(\d+)\/link-chat$/, leadLinkChat],
  ["POST", /^\/api\/leads\/(\d+)\/analyze$/, leadAnalyze],
  ["POST", /^\/api\/leads\/(\d+)\/notes$/, noteAdd],
  ["DELETE", /^\/api\/notes\/(\d+)$/, noteDelete],
  ["PATCH", /^\/api\/media\/(\d+)$/, mediaPatch],
  ["PUT", /^\/api\/leads\/(\d+)\/order$/, orderPut],
  ["POST", /^\/api\/orders\/(\d+)\/status$/, orderStatus],
  ["GET", /^\/api\/leads\/(\d+)\/summary$/, leadSummary],
  ["GET", /^\/api\/products$/, productsList],
  ["POST", /^\/api\/products$/, productCreate],
  ["PATCH", /^\/api\/products\/(\d+)$/, productPatch],
  ["GET", /^\/api\/settings$/, settingsGet],
  ["PUT", /^\/api\/settings$/, settingsPut],
];

export async function handleApi(req: Request, url: URL, path: string, deps: Deps): Promise<Response> {
  if (path === "/api/admin/staff" && req.method === "POST") return adminCreateStaff(req, deps);
  for (const [method, pattern, handler] of ROUTES) {
    if (method !== req.method) continue;
    const match = pattern.exec(path);
    if (!match) continue;
    const staff = await authenticate(req, deps);
    return handler({ req, url, deps, params: match.slice(1), staff, body: await readBody(req) });
  }
  // Unknown routes still require a valid token before they reveal anything.
  await authenticate(req, deps);
  throw notFound("No such route");
}
