// Shared shapes. Mirrors docs/sidecar-contract.md.

export const VERSION = "0.2.0";

export const STAGES = [
  "new", "interested", "quoted", "awaiting_payment", "paid", "booked", "won", "lost", "spam",
] as const;
export type Stage = (typeof STAGES)[number];

// Stages the agent may move a lead between. Money and closing stages
// (paid, booked, won) are set by staff only.
export const AGENT_STAGES = ["new", "interested", "quoted", "awaiting_payment", "lost", "spam"] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

export const MEDIA_CATEGORIES = ["slip", "product", "before_after", "document", "other"] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export const ORDER_STATUSES = ["draft", "awaiting_payment", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["transfer", "cod", "installment"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Identity fields a staff edit locks against the agent.
export const LOCKABLE_FIELDS = ["full_name", "phone", "address", "postcode", "stage"] as const;

// ---- profiles ----

export type ProfileName = "retail" | "real_estate";

// A profile-specific field on the lead card, stored in lead.details.
export interface DetailField {
  key: string; label: string; type: "text" | "select";
  options?: { value: string; label: string }[]; placeholder?: string;
}

// What GET /api/config returns: how this deployment's kind of business names things.
export interface ProfileConfig {
  profile: ProfileName;
  stages: { key: Stage; label: string }[];
  detail_fields: DetailField[];
  media_categories: { key: MediaCategory; label: string }[];
  payment_methods: { key: PaymentMethod; label: string }[];
  labels: {
    product: string; products: string; order: string;
    order_empty: string; product_search: string; summary_button: string;
  };
}

export interface Lead {
  id: number; line_user_id: string; chat_id: string | null;
  display_name: string | null; picture_url: string | null;
  full_name: string | null; phone: string | null; address: string | null; postcode: string | null;
  stage: Stage; tags: string[]; interests: string[];
  details: Record<string, string>;
  assignee_id: number | null; assignee_name: string | null;
  ai_summary: string | null; next_action: string | null; suggested_reply: string | null;
  follow_up_at: string | Date | null; locked_fields: string[];
  last_message_at: string | Date | null; last_message_preview: string | null;
  created_at: string | Date; updated_at: string | Date;
}

export type LeadLite = Pick<Lead, "id" | "display_name" | "full_name" | "phone" | "picture_url" | "stage" | "last_message_at">;

export interface Note {
  id: number; lead_id: number; body: string; kind: "ai" | "staff" | "system";
  author_name: string | null; pinned: boolean; created_at: string | Date;
}

export interface SlipInfo {
  amount: number | null; paid_at: string | null; bank: string | null; ref: string | null;
  matches_order: boolean | null;
}

export interface Media {
  id: number; lead_id: number; url: string; category: MediaCategory;
  caption: string | null; slip: SlipInfo | null; created_at: string | Date;
}

export interface OrderItem { id: number; product_id: number | null; name: string; qty: number; unit_price: number; }

export interface Order {
  id: number; lead_id: number; status: OrderStatus; items: OrderItem[];
  discount: number; shipping_fee: number; subtotal: number; total: number;
  payment_method: PaymentMethod | null; deposit_amount: number | null; note: string | null;
  created_at: string | Date; updated_at: string | Date;
}

export interface Product { id: number; sku: string | null; name: string; price: number; category: string | null; active: boolean; }

export interface Msg {
  id: number; direction: "in" | "out"; type: "text" | "image" | "sticker" | "other";
  text: string | null; media_id: number | null; sent_at: string | Date;
}

export interface Staff { id: number; name: string; role: "admin" | "agent"; }

export interface Settings { shop_name: string; payment_instructions: string; }

// ---- brain ----

export interface ConversationInput {
  // Absent means retail. `detail_fields` are the profile's fields the brain may fill.
  profile?: ProfileName;
  detail_fields?: DetailField[];
  shop_name: string;
  products: { name: string; price: number; category: string | null }[];
  lead: {
    display_name: string | null; full_name: string | null; phone: string | null;
    address: string | null; postcode: string | null; stage: Stage;
    interests: string[]; ai_summary: string | null;
    details?: Record<string, string>;
  };
  // Oldest first. `is_new` marks what arrived since the last analysis.
  messages: { direction: "in" | "out"; type: string; text: string | null; sent_at: string; is_new: boolean }[];
  now: string;
}

export interface Analysis {
  full_name: string | null; phone: string | null; address: string | null; postcode: string | null;
  interests: string[];
  stage: AgentStage;
  summary: string; next_action: string; suggested_reply: string;
  order_items: { name: string; qty: number; unit_price: number | null }[];
  follow_up_hours: number | null;
  // Only in profiles that have detail fields.
  details?: Record<string, string | null>;
}

export interface ImageInput { bytes: Uint8Array; contentType: string; shop_name: string; profile?: ProfileName; }

export interface ImageAnalysis {
  category: MediaCategory; caption: string | null;
  slip: { amount: number | null; paid_at: string | null; bank: string | null; ref: string | null } | null;
}

export interface Brain {
  analyzeConversation(input: ConversationInput): Promise<Analysis>;
  analyzeImage(input: ImageInput): Promise<ImageAnalysis>;
}

// ---- runtime wiring ----

export interface Db { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; }

export interface Deps {
  db: Db;
  env: {
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    SIDECAR_ADMIN_KEY: string;
    LIFF_CHANNEL_ID?: string;
    DEBOUNCE_MS?: string;
    // "retail" (default) or "real_estate".
    PROFILE?: string;
    // Where verified webhook calls are relayed, when another system also needs them.
    FORWARD_WEBHOOK_URL?: string;
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
  brain: Brain;
  defer(p: Promise<unknown>): void;
  now(): Date;
  sleep(ms: number): Promise<void>;
  // Relays a verified webhook call unchanged. Set only when FORWARD_WEBHOOK_URL is.
  forward?(rawBody: string, signature: string): Promise<void>;
  // Names of required secrets that are not set. Names only, never values.
  missing?: string[];
  log?(message: string, detail?: unknown): void;
}
