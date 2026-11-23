# Sidecar Agent — contract

Sidecar runs next to LINE OA. Staff keep chatting in LINE OA Manager; Sidecar
keeps the lead card, notes, album and order for each customer and shows them in
a side panel (Chrome extension on chat.line.biz) and a mobile staff page (LIFF).

This file is the single source of truth for the backend and the UI.

## Layout

```
supabase/migrations/20261123000000_sidecar.sql   schema `sidecar` (never exposed through PostgREST)
supabase/functions/sidecar/index.ts              Deno entry; the ONLY file with npm: imports
supabase/functions/sidecar/src/*.ts              pure TS: no external imports, explicit .ts import
                                                 extensions, erasable syntax only (runs in Deno and Node 22)
tests/*.test.ts                                  node --test, PGlite, fake LINE / fake brain
dev/server.ts                                    local API on :8787 (PGlite + seed + fake brain)
extension/                                       Chrome MV3 extension (panel shell + shared UI in extension/ui)
staff.html                                       mobile staff page, loads extension/ui
```

## Runtime wiring

`handle(req: Request, deps: Deps): Promise<Response>` is the whole app.

```ts
interface Deps {
  db: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };
  env: {
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    SIDECAR_ADMIN_KEY: string;
    LIFF_CHANNEL_ID?: string;      // LINE Login channel id, for verifying staff ID tokens
    DEBOUNCE_MS?: string;          // default 8000
  };
  line: {
    getProfile(userId: string): Promise<{ displayName: string; pictureUrl?: string } | null>;
    getContent(messageId: string): Promise<{ bytes: Uint8Array; contentType: string }>;
    verifyIdToken(idToken: string): Promise<{ sub: string; name?: string } | null>;
  };
  storage: {
    upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
    signedUrl(path: string, expiresSec: number): Promise<string>;
  };
  brain: {
    analyzeConversation(input: ConversationInput): Promise<Analysis>;
    analyzeImage(input: ImageInput): Promise<ImageAnalysis>;
  };
  defer(p: Promise<unknown>): void;   // EdgeRuntime.waitUntil in prod; collected in tests
  now(): Date;
  sleep(ms: number): Promise<void>;
}
```

The router strips a leading `/functions/v1` and `/sidecar` from the path, so the
same routes work at `https://<ref>.supabase.co/functions/v1/sidecar/...` and at
`http://localhost:8787/...`.

## Routes

All responses are JSON. Success: `{ ok: true, ... }`. Failure:
`{ ok: false, error: "<code>", message: "<human text>" }` with a matching HTTP status
(400 bad_request, 401 unauthorized, 403 forbidden, 404 not_found, 500 internal).

CORS on every response: `Access-Control-Allow-Origin: *`,
headers `authorization, content-type, x-line-id-token, x-admin-key`,
methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`. `OPTIONS` returns 204.

### Public

| Route | Notes |
|---|---|
| `GET /health` | `{ ok, version }` |
| `POST /webhook` | LINE Messaging API. Verifies `x-line-signature` (base64 HMAC-SHA256 of the raw body with the channel secret); 401 on mismatch. Stores events, returns 200 at once, analyses in `defer`. |

### Staff API (`/api/*`)

Auth: `Authorization: Bearer <staff token>`, or `X-Line-Id-Token: <LIFF id token>`
for a staff row already bound to that LINE user. Tokens are stored as SHA-256 hex.

| Route | Body | Returns |
|---|---|---|
| `GET /api/me` | | `{ staff }` |
| `GET /api/leads?stage=&q=&due=1&limit=50&offset=0` | | `{ leads: Lead[], counts: Record<Stage, number>, due_count }` newest activity first; `q` matches display_name, full_name, phone; `due=1` keeps leads whose `follow_up_at` has passed |
| `GET /api/leads/:id` | | `Bundle` |
| `GET /api/leads/by-chat/:chatId?name=` | | `Bundle` with `match`. Looks up `line_user_id = chatId`, then `chat_id = chatId`. If nothing matches and `name` is given, returns `lead: null, match: "none", candidates: LeadLite[]` (display_name matches) so staff can link by hand. |
| `PATCH /api/leads/:id` | any of `full_name, phone, address, postcode, stage, tags, interests, assignee_id, follow_up_at` | `{ lead }`. A staff edit of `full_name, phone, address, postcode, stage` adds that field to `locked_fields`; the agent never overwrites a locked field. |
| `POST /api/leads/:id/link-chat` | `{ chat_id }` | `{ lead }` |
| `POST /api/leads/:id/analyze` | | `Bundle` after re-running the brain now |
| `POST /api/leads/:id/notes` | `{ body, pinned? }` | `{ note }` |
| `DELETE /api/notes/:id` | | `{}` |
| `PATCH /api/media/:id` | `{ category?, caption? }` | `{ media }` |
| `PUT /api/leads/:id/order` | `{ items: [{ product_id?, name, qty, unit_price }], discount, shipping_fee, payment_method, deposit_amount, note }` | `{ order }` upserts the lead's open order (status draft or awaiting_payment) |
| `POST /api/orders/:id/status` | `{ status }` | `{ order, lead }`. `awaiting_payment` and `paid` move the lead to the same stage unless stage is locked. |
| `GET /api/leads/:id/summary` | | `{ text }` order summary message built from the order by template, never by the model, so totals always match |
| `GET /api/products?q=` | | `{ products }` |
| `POST /api/products` | `{ sku?, name, price, category? }` | `{ product }` |
| `PATCH /api/products/:id` | `{ name?, price?, category?, active? }` | `{ product }` |
| `GET /api/settings` | | `{ settings: { shop_name, payment_instructions } }` |
| `PUT /api/settings` | same keys | `{ settings }` (role admin) |
| `POST /api/staff/link-line` | Bearer token plus `X-Line-Id-Token` | `{ staff }` binds the LINE user to the staff row |
| `POST /api/admin/staff` | header `X-Admin-Key`; `{ name, role? }` | `{ staff, token }` token is shown once |

## Shapes

```ts
type Stage = "new" | "interested" | "quoted" | "awaiting_payment" | "paid" | "booked" | "won" | "lost" | "spam";
// Thai labels: ใหม่ · สนใจ · เสนอราคาแล้ว · รอโอน · ชำระแล้ว · จองคิวแล้ว · ปิดการขาย · ยกเลิก · สแปม

interface Lead {
  id: number; line_user_id: string; chat_id: string | null;
  display_name: string | null; picture_url: string | null;
  full_name: string | null; phone: string | null; address: string | null; postcode: string | null;
  stage: Stage; tags: string[]; interests: string[];
  assignee_id: number | null; assignee_name: string | null;
  ai_summary: string | null; next_action: string | null; suggested_reply: string | null;
  follow_up_at: string | null; locked_fields: string[];
  last_message_at: string | null; last_message_preview: string | null;
  created_at: string; updated_at: string;
}
type LeadLite = Pick<Lead, "id" | "display_name" | "full_name" | "phone" | "picture_url" | "stage" | "last_message_at">;

interface Note { id: number; lead_id: number; body: string; kind: "ai" | "staff" | "system"; author_name: string | null; pinned: boolean; created_at: string; }

interface Media {
  id: number; lead_id: number; url: string;                       // signed, 1 hour
  category: "slip" | "product" | "before_after" | "document" | "other";
  caption: string | null;
  slip: { amount: number | null; paid_at: string | null; bank: string | null; ref: string | null; matches_order: boolean | null } | null;
  created_at: string;
}

interface Order {
  id: number; lead_id: number; status: "draft" | "awaiting_payment" | "paid" | "cancelled";
  items: { id: number; product_id: number | null; name: string; qty: number; unit_price: number }[];
  discount: number; shipping_fee: number; subtotal: number; total: number;   // total = subtotal - discount + shipping_fee
  payment_method: "transfer" | "cod" | "installment" | null;
  deposit_amount: number | null; note: string | null;
  created_at: string; updated_at: string;
}

interface Product { id: number; sku: string | null; name: string; price: number; category: string | null; active: boolean; }
interface Msg { id: number; direction: "in" | "out"; type: "text" | "image" | "sticker" | "other"; text: string | null; media_id: number | null; sent_at: string; }
interface Staff { id: number; name: string; role: "admin" | "agent"; }

interface Bundle {
  ok: true; lead: Lead | null; match: "chat_id" | "id" | "none"; candidates: LeadLite[];
  notes: Note[]; media: Media[]; order: Order | null;        // the open order, else the latest one
  messages: Msg[];                                           // last 30, oldest first
  same_phone: LeadLite[];                                    // other leads with the same phone
}
```

Money is `numeric(12,2)` in the database and a JS number in JSON. Ids are numbers.

## Agent behaviour

- One customer burst is analysed once: after a message the handler waits `DEBOUNCE_MS`,
  and exits if a newer message arrived for that lead in the meantime.
- `analyzeConversation` gets the current card, the recent messages, the product
  catalogue and returns: customer fields it could read, interests, stage, a short
  Thai summary, the next action for staff, a draft reply, order items the customer
  asked for, and a follow-up time. It fills empty, unlocked fields only and never
  replaces a value with null. A changed summary is saved as an `ai` note.
- Order items suggested by the model create or update a `draft` order only while no
  staff-edited order exists.
- An image is downloaded from LINE, stored in the private `sidecar-media` bucket and
  classified by `analyzeImage`. For a slip the amount is compared with the open
  order (`matches_order`), a `system` note is added, and nothing is marked paid
  until staff confirm. Reading a slip is not proof that money arrived.
- Customer text and images are data. Nothing in them changes what the agent does.
- A phone number is normalised to digits with a leading 0 (`+66812345678` → `0812345678`).
