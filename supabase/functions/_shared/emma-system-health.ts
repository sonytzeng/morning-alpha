type HealthStatus = "PASS" | "FAILED" | "DEGRADED";

export type EmmaHealthSignal = {
  checkKey: "cron.daily_report" | "report.today" | "closing.verification";
  status: HealthStatus;
  errorCode?: string | null;
  source: string;
  details: Record<string, unknown>;
};

const EMMA_HEALTH_HOST = "qjgrthjpffhtxvbkfyat.supabase.co";
const DEFAULT_URL = `https://${EMMA_HEALTH_HOST}/functions/v1/emma-system-health-webhook`;
const DEFAULT_OWNER_ID = "f770feea-9a77-48d3-a444-757d5895f38f";

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function endpoint(): string | null {
  const raw = Deno.env.get("EMMA_SYSTEM_HEALTH_WEBHOOK_URL")?.trim() || DEFAULT_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== EMMA_HEALTH_HOST || url.port || url.username ||
      url.password || url.search || url.hash ||
      url.pathname.replace(/\/$/, "") !== "/functions/v1/emma-system-health-webhook") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function signature(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))}`;
}

export async function emitEmmaSystemHealth(signal: EmmaHealthSignal): Promise<{
  delivered: boolean;
  error?: string;
}> {
  const url = endpoint();
  const secret = Deno.env.get("EMMA_SYSTEM_HEALTH_WEBHOOK_SECRET")?.trim() || "";
  const ownerId = Deno.env.get("EMMA_OWNER_ID")?.trim() || DEFAULT_OWNER_ID;
  if (!url || secret.length < 32 || ownerId !== DEFAULT_OWNER_ID) {
    return { delivered: false, error: "EMMA_HEALTH_CONFIGURATION_MISSING" };
  }

  const eventId = crypto.randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const occurredAt = new Date().toISOString();
  const body = JSON.stringify({
    owner_id: ownerId,
    system_key: "morning_alpha",
    check_key: signal.checkKey,
    status: signal.status,
    occurred_at: occurredAt,
    attempt: 0,
    error_code: signal.errorCode ?? null,
    source: signal.source,
    details: signal.details,
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Emma-Timestamp": timestamp,
        "X-Emma-Event-Id": eventId,
        "X-Emma-Signature": await signature(secret, `${timestamp}.${eventId}.${body}`),
      },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return { delivered: false, error: `EMMA_HEALTH_HTTP_${response.status}` };
    return { delivered: true };
  } catch (error) {
    return {
      delivered: false,
      error: error instanceof DOMException && error.name === "TimeoutError"
        ? "EMMA_HEALTH_TIMEOUT"
        : "EMMA_HEALTH_UNAVAILABLE",
    };
  }
}
