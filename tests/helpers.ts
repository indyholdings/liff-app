// Test harness: the real router and SQL on an in-process Postgres (PGlite),
// with LINE, storage and the model replaced by fakes.

import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { handle } from "../supabase/functions/sidecar/src/router.ts";
import { hmacSha256Base64, sha256Hex } from "../supabase/functions/sidecar/src/util.ts";
import type {
  Analysis, ConversationInput, Deps, ImageAnalysis, ImageInput,
} from "../supabase/functions/sidecar/src/types.ts";

// Every migration, in order. The storage bucket one is left out: it needs
// Supabase's storage schema, which a bare Postgres does not have.
const MIGRATIONS_DIR = new URL("../supabase/migrations/", import.meta.url);
export const MIGRATION = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql") && !name.includes("bucket"))
  .sort()
  .map((name) => readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"))
  .join("\n");

export const SECRET = "test-channel-secret";
export const ADMIN_KEY = "test-admin-key";
export const STAFF_TOKEN = "test-staff-token";
export const BASE = "http://localhost";

// The slice of a database the tests use. PGlite by default; set TEST_DATABASE_URL
// to run the same suite on a real Postgres through postgres.js, the driver the
// edge function uses (see `npm run test:pg`).
export interface TestDb {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export async function createDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    // Same options and call shape as supabase/functions/sidecar/index.ts.
    const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    const db: TestDb = {
      query: async (text, params = []) => ({ rows: [...(await sql.unsafe(text, params as never[]))] as any[] }),
      exec: (text) => sql.unsafe(text),
      close: () => sql.end(),
    };
    await db.exec("drop schema if exists sidecar cascade");
    await db.exec(MIGRATION);
    return db;
  }
  const pg = new PGlite();
  await pg.exec(MIGRATION);
  return {
    query: (text, params) => pg.query(text, params as any[]) as Promise<{ rows: any[] }>,
    exec: (text) => pg.exec(text),
    close: () => pg.close(),
  };
}

export async function resetDb(pg: TestDb): Promise<void> {
  await pg.exec(`
    truncate sidecar.order_items, sidecar.orders, sidecar.notes, sidecar.messages, sidecar.media,
      sidecar.webhook_events, sidecar.leads, sidecar.products, sidecar.staff restart identity cascade;
    update sidecar.settings set value = 'ร้านทดสอบ' where key = 'shop_name';
    update sidecar.settings set value = 'โอนเข้าบัญชี 000-0-00000-0' where key = 'payment_instructions';
  `);
}

export const emptyAnalysis = (over: Partial<Analysis> = {}): Analysis => ({
  full_name: null, phone: null, address: null, postcode: null, interests: [], stage: "interested",
  summary: "ลูกค้าสอบถามสินค้า", next_action: "ตอบราคา", suggested_reply: "สวัสดีค่ะ",
  order_items: [], follow_up_hours: null, ...over,
});

export interface Harness {
  pg: TestDb;
  deps: Deps;
  // What the fakes saw.
  conversationCalls: ConversationInput[];
  imageCalls: ImageInput[];
  uploads: Map<string, { bytes: Uint8Array; contentType: string }>;
  // What the fakes return next.
  nextAnalysis: Analysis | (() => Promise<Analysis>);
  nextImage: ImageAnalysis;
  content: { bytes: Uint8Array; contentType: string };
  profiles: Map<string, { displayName: string; pictureUrl?: string }>;
  idTokens: Map<string, { sub: string; name?: string }>;
  clock: Date;
  logs: string[];
  // Background work.
  settle(): Promise<void>;
  releaseSleeps(): void;
  pendingSleeps(): number;
  // Requests.
  api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  webhook(events: unknown[], opts?: { signature?: string; destination?: string }): Promise<{ status: number; body: any }>;
  textEvent(userId: string, text: string, id?: string): Record<string, unknown>;
  imageEvent(userId: string, id?: string): Record<string, unknown>;
  seedStaff(name?: string, role?: string, token?: string): Promise<number>;
}

export function createHarness(pg: TestDb, opts: { manualSleep?: boolean } = {}): Harness {
  const deferred: Promise<unknown>[] = [];
  const sleepers: (() => void)[] = [];
  let seq = 0;

  const h = {
    pg,
    conversationCalls: [], imageCalls: [], uploads: new Map(),
    nextAnalysis: emptyAnalysis(),
    nextImage: { category: "other", caption: null, slip: null } as ImageAnalysis,
    content: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" },
    profiles: new Map(), idTokens: new Map(),
    clock: new Date("2026-11-23T10:00:00.000Z"),
    logs: [],
  } as unknown as Harness;

  h.deps = {
    db: { query: (sql, params) => pg.query(sql, params) },
    env: { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "line-token", SIDECAR_ADMIN_KEY: ADMIN_KEY, DEBOUNCE_MS: "8000" },
    line: {
      getProfile: async (userId) => h.profiles.get(userId) ?? null,
      getContent: async () => h.content,
      verifyIdToken: async (token) => h.idTokens.get(token) ?? null,
    },
    storage: {
      upload: async (path, bytes, contentType) => { h.uploads.set(path, { bytes, contentType }); },
      signedUrl: async (path, expires) => `https://storage.test/${path}?expires=${expires}`,
    },
    brain: {
      analyzeConversation: async (input) => {
        h.conversationCalls.push(input);
        return typeof h.nextAnalysis === "function" ? await h.nextAnalysis() : h.nextAnalysis;
      },
      analyzeImage: async (input) => {
        h.imageCalls.push(input);
        return h.nextImage;
      },
    },
    defer: (p) => { deferred.push(p); },
    now: () => h.clock,
    sleep: (_ms) =>
      opts.manualSleep ? new Promise<void>((resolve) => sleepers.push(resolve)) : Promise.resolve(),
    log: (message, detail) => { h.logs.push(`${message} ${detail instanceof Error ? detail.message : detail ?? ""}`); },
  };

  h.settle = async () => {
    while (deferred.length) await Promise.all(deferred.splice(0));
  };
  h.releaseSleeps = () => { for (const wake of sleepers.splice(0)) wake(); };
  h.pendingSleeps = () => sleepers.length;

  h.api = async (method, path, body, headers = {}) => {
    const res = await handle(new Request(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${STAFF_TOKEN}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), h.deps);
    return { status: res.status, body: await res.json() };
  };

  h.webhook = async (events, o = {}) => {
    const raw = JSON.stringify({ destination: o.destination ?? "Ubot", events });
    const signature = o.signature ?? await hmacSha256Base64(SECRET, raw);
    const res = await handle(new Request(BASE + "/webhook", {
      method: "POST", headers: { "x-line-signature": signature, "Content-Type": "application/json" }, body: raw,
    }), h.deps);
    return { status: res.status, body: await res.json() };
  };

  h.textEvent = (userId, text, id) => {
    seq++;
    return {
      type: "message", webhookEventId: `evt-${id ?? seq}`, timestamp: h.clock.getTime() + seq,
      source: { type: "user", userId }, message: { id: `msg-${id ?? seq}`, type: "text", text },
    };
  };
  h.imageEvent = (userId, id) => {
    seq++;
    return {
      type: "message", webhookEventId: `evt-${id ?? seq}`, timestamp: h.clock.getTime() + seq,
      source: { type: "user", userId }, message: { id: `img-${id ?? seq}`, type: "image" },
    };
  };

  h.seedStaff = async (name = "ริต้า", role = "admin", token = STAFF_TOKEN) => {
    const { rows } = await pg.query<{ id: number }>(
      `insert into sidecar.staff (name, role, token_hash) values ($1, $2, $3) returning id`,
      [name, role, await sha256Hex(token)],
    );
    return rows[0].id;
  };

  return h;
}

export async function leadRow(pg: TestDb, lineUserId: string): Promise<any> {
  const { rows } = await pg.query(`select * from sidecar.leads where line_user_id = $1`, [lineUserId]);
  return rows[0];
}
