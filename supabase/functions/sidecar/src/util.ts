// Small helpers with no dependencies. WebCrypto only, so the same code runs in Deno and Node.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-line-id-token, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

export function ok(body: Record<string, unknown> = {}): Response {
  return json(200, { ok: true, ...body });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const STATUS: Record<string, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404,
  internal: 500, not_configured: 503,
};

// An error the router turns into `{ ok: false, error, message }`.
export class HttpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS[code] ?? 500;
  }
}

export function fail(code: string, message: string): Response {
  return json(STATUS[code] ?? 500, { ok: false, error: code, message });
}

export const badRequest = (message: string) => new HttpError("bad_request", message);
export const notFound = (message: string) => new HttpError("not_found", message);

const encoder = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return toBase64(new Uint8Array(sig));
}

// Compares without leaking where the strings differ. Length is not secret here
// (signatures and hashes have a fixed length).
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "sc_" + toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// Thai phone numbers as digits with a leading 0: "+66 81-234-5678" -> "0812345678".
// Returns null when the input does not look like a phone number.
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("0066")) digits = digits.slice(4);
  else if (digits.startsWith("66") && digits.length >= 10) digits = digits.slice(2);
  if (!digits.startsWith("0")) digits = "0" + digits;
  // 9 digits for landlines (02xxxxxxx), 10 for mobiles.
  if (digits.length < 9 || digits.length > 10) return null;
  return digits;
}

export function cleanText(value: unknown, max = 2000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// "1,599" or "1,599.50": decimals only when there are any.
export function formatMoney(n: number): string {
  const value = round2(n);
  const [whole, frac] = Math.abs(value).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (value < 0 ? "-" : "") + (frac === "00" ? grouped : `${grouped}.${frac}`);
}

export function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function uniqueStrings(values: unknown, max = 20): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const text = v.trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text.slice(0, 80));
    if (out.length >= max) break;
  }
  return out;
}

// Background work and request failures end up here. The edge entry sends it to
// the function logs; tests collect it.
export function logError(deps: { log?(message: string, detail?: unknown): void }, message: string, detail?: unknown): void {
  if (deps.log) deps.log(message, detail);
  else console.error(`[sidecar] ${message}`, detail ?? "");
}
