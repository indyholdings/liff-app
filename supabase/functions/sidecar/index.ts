// Supabase Edge Function entry (Deno). Wires real services into the pure app in
// ./src and is the only file that imports from npm.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   SIDECAR_LINE_CHANNEL_SECRET, SIDECAR_LINE_CHANNEL_ACCESS_TOKEN   Messaging API channel of the sales OA
//   ANTHROPIC_API_KEY                                                Claude API
//   SIDECAR_ADMIN_KEY                                                any long random string; mints staff tokens
// Optional:
//   SIDECAR_LIFF_CHANNEL_ID   LINE Login channel id, lets staff sign in from the LIFF page
//   SIDECAR_MODEL             defaults to claude-opus-5-5
//   SIDECAR_DEBOUNCE_MS       defaults to 8000
//
// Function secrets are shared by every function in the project, and this project's
// `line-webhook` / `line-send` functions already use LINE_CHANNEL_SECRET and
// LINE_CHANNEL_ACCESS_TOKEN for another LINE channel. Sidecar therefore reads its own
// names and never falls back to those, so connecting it cannot repoint or break them.
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL are provided by Supabase.

import postgres from "npm:postgres@3.4.5";
import Anthropic from "npm:@anthropic-ai/sdk@1.12.0";
import { createClient } from "npm:@supabase/supabase-js@2";

import { handle } from "./src/router.ts";
import { BrainError, createBrain } from "./src/brain.ts";
import type { Brain, Deps } from "./src/types.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const env = (name: string): string => Deno.env.get(name) ?? "";

const REQUIRED = ["SIDECAR_LINE_CHANNEL_SECRET", "SIDECAR_LINE_CHANNEL_ACCESS_TOKEN", "ANTHROPIC_API_KEY", "SIDECAR_ADMIN_KEY"];
const missing = REQUIRED.filter((name) => !env(name));

const BUCKET = "sidecar-media";

// One connection per function instance. Transaction-mode poolers do not support
// prepared statements, so they are off.
let sqlClient: ReturnType<typeof postgres> | null = null;
function sql() {
  sqlClient ??= postgres(env("SUPABASE_DB_URL"), { prepare: false, max: 1, idle_timeout: 20 });
  return sqlClient;
}

const db: Deps["db"] = {
  async query(text, params = []) {
    const rows = await sql().unsafe(text, params as never[]);
    return { rows: [...rows] };
  },
};

const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const storage: Deps["storage"] = {
  async upload(path, bytes, contentType) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  },
  async signedUrl(path, expiresSec) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresSec);
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message ?? "no data"}`);
    return data.signedUrl;
  },
};

const lineHeaders = () => ({ Authorization: `Bearer ${env("SIDECAR_LINE_CHANNEL_ACCESS_TOKEN")}` });

const line: Deps["line"] = {
  async getProfile(userId) {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: lineHeaders() });
    if (!res.ok) return null;
    const body = await res.json();
    return { displayName: body.displayName, pictureUrl: body.pictureUrl };
  },
  async getContent(messageId) {
    const res = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      { headers: lineHeaders() },
    );
    if (!res.ok) throw new Error(`LINE content ${messageId}: HTTP ${res.status}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  },
  async verifyIdToken(idToken) {
    const clientId = env("SIDECAR_LIFF_CHANNEL_ID");
    if (!clientId) return null;
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.sub === "string" ? { sub: body.sub, name: body.name } : null;
  },
};

const notConfigured = async (): Promise<never> => {
  throw new BrainError("bad_output", "ANTHROPIC_API_KEY is not set");
};

const brain: Brain = env("ANTHROPIC_API_KEY")
  ? createBrain(
    // The card is filled in the background, so a slow call only delays it; cap it
    // well inside the edge function's background-task window.
    new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), timeout: 60_000, maxRetries: 2 }),
    { model: env("SIDECAR_MODEL") || undefined },
  )
  : { analyzeConversation: notConfigured, analyzeImage: notConfigured };

const deps: Deps = {
  db,
  env: {
    LINE_CHANNEL_SECRET: env("SIDECAR_LINE_CHANNEL_SECRET"),
    LINE_CHANNEL_ACCESS_TOKEN: env("SIDECAR_LINE_CHANNEL_ACCESS_TOKEN"),
    SIDECAR_ADMIN_KEY: env("SIDECAR_ADMIN_KEY"),
    LIFF_CHANNEL_ID: env("SIDECAR_LIFF_CHANNEL_ID") || undefined,
    DEBOUNCE_MS: env("SIDECAR_DEBOUNCE_MS") || undefined,
  },
  line,
  storage,
  brain,
  defer(promise) {
    const guarded = promise.catch((err) => console.error("[sidecar] background task failed", err));
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(guarded);
  },
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  missing,
  log: (message, detail) => console.error(`[sidecar] ${message}`, detail ?? ""),
};

Deno.serve((req) => handle(req, deps));
