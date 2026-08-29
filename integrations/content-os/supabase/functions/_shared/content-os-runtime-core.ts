import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.57.4";
import {
  asObject,
  type JsonRecord,
  RuntimeError,
  textValue,
} from "./content-os-contract-core.ts";

export {
  asObject,
  type JsonRecord,
  RuntimeError,
  textValue,
} from "./content-os-contract-core.ts";

export type RuntimeClient = SupabaseClient;

const MAX_JSON_BYTES = 256_000;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new RuntimeError(
      "PROVIDER_CONFIGURATION_BLOCKED",
      503,
      `${name} is not configured.`,
    );
  }
  return value;
}

function optionalEnv(name: string): string | null {
  return textValue(Deno.env.get(name));
}

function serviceRoleKey(): string {
  const encoded = optionalEnv("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as JsonRecord;
      const value = textValue(keys.default);
      if (value) return value;
    } catch {
      // Hosted projects may still expose the legacy service-role variable.
    }
  }
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function adminClient(): RuntimeClient {
  return createClient(requiredEnv("SUPABASE_URL"), serviceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    const canonical: JsonRecord = {};
    for (const key of Object.keys(value as JsonRecord).sort()) {
      canonical[key] = canonicalJsonValue((value as JsonRecord)[key]);
    }
    return canonical;
  }
  return value;
}

export async function sha256Hex(value: unknown): Promise<string> {
  const serialized = typeof value === "string"
    ? value
    : JSON.stringify(canonicalJsonValue(value));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export async function authenticateWorker(
  request: Request,
  admin: RuntimeClient,
): Promise<void> {
  const token = request.headers.get("x-content-os-scheduler-token")?.trim() ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "").trim();
  if (!token) throw new RuntimeError("AUTHENTICATION_REQUIRED", 401);
  if (constantTimeEqual(token, serviceRoleKey())) return;
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin.rpc(
    "verify_content_os_scheduler_token_hash",
    {
      presented_hash: tokenHash,
    },
  );
  if (error || data !== true) {
    throw new RuntimeError("AUTHENTICATION_INVALID", 401);
  }
}

export async function readJson(request: Request): Promise<JsonRecord> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    throw new RuntimeError("REQUEST_TOO_LARGE", 413);
  }
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonRecord;
    }
  } catch {
    // Mapped below to the stable public error code.
  }
  throw new RuntimeError("JSON_OBJECT_REQUIRED", 400);
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-request-id, x-content-os-scheduler-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  });
  const origin = request.headers.get("origin");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(request),
  });
}

export function databaseError(error: unknown, code: string): RuntimeError {
  const message = textValue(asObject(error).message) ?? code;
  return new RuntimeError(code, 503, message);
}

export async function serve(
  request: Request,
  handler: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  try {
    return await handler(request);
  } catch (error) {
    const runtimeError = error instanceof RuntimeError
      ? error
      : new RuntimeError("INTERNAL_SERVER_ERROR", 500);
    console.error(JSON.stringify({
      event: "content_os_public_social_error",
      code: runtimeError.code,
      status: runtimeError.status,
    }));
    return jsonResponse(
      request,
      { ok: false, error: runtimeError.code },
      runtimeError.status,
    );
  }
}
