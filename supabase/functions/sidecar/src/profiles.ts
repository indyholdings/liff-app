// One codebase, several kinds of business. A profile says how a deployment names
// its stages and catalogue, which extra fields its lead card has, and which model
// reads the chats. It is chosen by the SIDECAR_PROFILE secret.

import type { DetailField, ProfileConfig, ProfileName } from "./types.ts";

const RETAIL: ProfileConfig = {
  profile: "retail",
  stages: [
    { key: "new", label: "ใหม่" },
    { key: "interested", label: "สนใจ" },
    { key: "quoted", label: "เสนอราคาแล้ว" },
    { key: "awaiting_payment", label: "รอโอน" },
    { key: "paid", label: "ชำระแล้ว" },
    { key: "booked", label: "จองคิวแล้ว" },
    { key: "won", label: "ปิดการขาย" },
    { key: "lost", label: "ยกเลิก" },
    { key: "spam", label: "สแปม" },
  ],
  detail_fields: [],
  media_categories: [
    { key: "slip", label: "สลิป" },
    { key: "product", label: "สินค้า" },
    { key: "before_after", label: "ก่อน-หลัง" },
    { key: "document", label: "เอกสาร" },
    { key: "other", label: "อื่น ๆ" },
  ],
  payment_methods: [
    { key: "transfer", label: "โอนเงิน" },
    { key: "cod", label: "เก็บเงินปลายทาง" },
    { key: "installment", label: "ผ่อนชำระ" },
  ],
  labels: {
    product: "สินค้า", products: "สินค้า", order: "ออเดอร์",
    order_empty: "ยังไม่มีออเดอร์", product_search: "ค้นหาสินค้าเพื่อเพิ่ม…",
    summary_button: "ร่างข้อความสรุป",
  },
};

const REAL_ESTATE_FIELDS: DetailField[] = [
  {
    key: "role", label: "บทบาท", type: "select",
    options: [
      { value: "owner", label: "เจ้าของทรัพย์" },
      { value: "buyer", label: "ผู้ซื้อ" },
      { value: "tenant", label: "ผู้เช่า" },
      { value: "co_agent", label: "Co-agent" },
      { value: "resident", label: "ลูกบ้าน" },
    ],
  },
  {
    key: "intent", label: "เรื่องที่ติดต่อ", type: "select",
    options: [
      { value: "list_sale", label: "ฝากขาย" },
      { value: "list_rent", label: "ฝากเช่า" },
      { value: "buy", label: "หาซื้อ" },
      { value: "rent", label: "หาเช่า" },
      { value: "after_sales", label: "แจ้งปัญหาหลังเช่า" },
      { value: "service", label: "One Stop Service" },
    ],
  },
  { key: "budget", label: "งบประมาณ", type: "text", placeholder: "เช่น 12,000/เดือน หรือ 3 ล้าน" },
  { key: "location", label: "ทำเล/โครงการ", type: "text", placeholder: "เช่น ใกล้ BTS กรุงธนบุรี" },
  { key: "unit_type", label: "ประเภทห้อง", type: "text", placeholder: "เช่น Studio, 1 ห้องนอน" },
  { key: "move_in", label: "ต้องการย้ายเข้า", type: "text", placeholder: "เช่น ต้นเดือน ม.ค." },
  { key: "property_code", label: "รหัสทรัพย์", type: "text", placeholder: "เช่น RCD-0001" },
];

const REAL_ESTATE: ProfileConfig = {
  profile: "real_estate",
  stages: [
    { key: "new", label: "ใหม่" },
    { key: "interested", label: "รู้ความต้องการ" },
    { key: "quoted", label: "ส่งทรัพย์แล้ว" },
    { key: "booked", label: "นัดดูทรัพย์" },
    { key: "awaiting_payment", label: "รอมัดจำ" },
    { key: "paid", label: "วางมัดจำแล้ว" },
    { key: "won", label: "ปิดดีล" },
    { key: "lost", label: "หลุด" },
    { key: "spam", label: "สแปม" },
  ],
  detail_fields: REAL_ESTATE_FIELDS,
  media_categories: [
    { key: "slip", label: "สลิป" },
    { key: "product", label: "รูปทรัพย์" },
    { key: "before_after", label: "สภาพห้อง" },
    { key: "document", label: "เอกสาร" },
    { key: "other", label: "อื่น ๆ" },
  ],
  payment_methods: [{ key: "transfer", label: "โอนเงิน" }],
  labels: {
    product: "ทรัพย์", products: "ทรัพย์", order: "ข้อเสนอ/การจอง",
    order_empty: "ยังไม่มีข้อเสนอ", product_search: "ค้นหาทรัพย์เพื่อเพิ่ม…",
    summary_button: "ร่างสรุปรายละเอียดทรัพย์",
  },
};

const PROFILES: Record<ProfileName, ProfileConfig> = { retail: RETAIL, real_estate: REAL_ESTATE };

// The model each profile uses unless SIDECAR_MODEL says otherwise.
const DEFAULT_MODELS: Record<ProfileName, string> = {
  retail: "claude-opus-5-5",
  real_estate: "claude-haiku-5-5",
};

export function profileName(name: string | undefined | null): ProfileName {
  return name === "real_estate" ? "real_estate" : "retail";
}

// Unknown or missing names fall back to retail.
export function getProfile(name: string | undefined | null): ProfileConfig {
  return PROFILES[profileName(name)];
}

export function defaultModel(name: string | undefined | null): string {
  return DEFAULT_MODELS[profileName(name)];
}

// A value staff or the agent wants to put in lead.details, cleaned and checked
// against the field. Returns null when the value is empty or not allowed.
export function cleanDetail(field: DetailField, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, 300);
  if (!value) return null;
  if (field.type === "select" && !(field.options ?? []).some((o) => o.value === value)) return null;
  return value;
}
