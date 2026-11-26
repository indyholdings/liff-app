// The whole app: handle(request, deps) -> response.

import type { Deps } from "./types.ts";
import { VERSION } from "./types.ts";
import { handleApi } from "./api.ts";
import { handleWebhook } from "./webhook.ts";
import { getProfile } from "./profiles.ts";
import { fail, HttpError, logError, ok, preflight } from "./util.ts";

// The same routes work behind https://<ref>.supabase.co/functions/v1/sidecar and at the server root.
export function routePath(pathname: string): string {
  let path = pathname.replace(/^\/functions\/v1(?=\/|$)/, "").replace(/^\/sidecar(?=\/|$)/, "");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return preflight();
    const url = new URL(req.url);
    const path = routePath(url.pathname);

    if (path === "/health" && req.method === "GET") {
      const missing = deps.missing ?? [];
      return ok({ version: VERSION, configured: missing.length === 0, missing, profile: getProfile(deps.env.PROFILE).profile });
    }
    if (path === "/webhook" && req.method === "POST") return await handleWebhook(req, deps);
    if (path === "/api" || path.startsWith("/api/")) return await handleApi(req, url, path, deps);
    return fail("not_found", "No such route");
  } catch (err) {
    if (err instanceof HttpError) return fail(err.code, err.message);
    logError(deps, "request failed", err);
    return fail("internal", "Something went wrong");
  }
}
