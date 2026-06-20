
// ===== Cron API Route: /functions/v1/cron-generate-report =====
// Purpose: Secure entry point for external cron services (e.g. cron-job.org)
// V2 Flow: Validate x-cron-secret → fire & forget generate-daily-report-v7 → return 200 immediately
// cron-job.org only triggers, does NOT wait for AI report completion (avoids 30s timeout)
// Required env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method !== "POST") {
    console.error(`[CRON:${requestId}] failed - method not allowed: ${req.method}`);
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Only POST is accepted." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`[CRON:${requestId}] start - received POST request`);

  try {
    const cronSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");

    if (!expectedSecret) {
      console.error(`[CRON:${requestId}] failed - CRON_SECRET not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error: CRON_SECRET not set" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (cronSecret !== expectedSecret) {
      console.error(`[CRON:${requestId}] failed - invalid x-cron-secret`);
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized: invalid x-cron-secret" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[CRON:${requestId}] secret validated, dispatching generate-daily-report-v7 in background...`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[CRON:${requestId}] failed - missing Supabase credentials`);
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error: Supabase credentials missing" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const targetUrl = `${supabaseUrl}/functions/v1/generate-daily-report-v7`;

    // Fire & forget: do NOT await V7 — let it run in background
    const backgroundPromise = (async () => {
      try {
        console.log(`[CRON:${requestId}] background - firing V7...`);
        const bgStart = Date.now();

        const response = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": expectedSecret,
          },
          body: JSON.stringify({ triggered_by: "cron", request_id: requestId }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
          const errorMsg = result?.error || result?.detail || `HTTP ${response.status}`;
          console.error(`[CRON:${requestId}] background - V7 failed: ${errorMsg}`);
        } else {
          const elapsed = Date.now() - bgStart;
          console.log(
            `[CRON:${requestId}] background - V7 success: report_date=${result?.report_date || "?"}, bias=${result?.market_bias || "?"}, score=${result?.confidence_score || "?"}, duration=${elapsed}ms`
          );
        }
      } catch (bgErr) {
        const msg = bgErr instanceof Error ? bgErr.message : String(bgErr);
        console.error(`[CRON:${requestId}] background - V7 exception: ${msg}`);
      }
    })();

    // EdgeRuntime.waitUntil keeps the background Promise alive after response
    if (typeof EdgeRuntime !== "undefined" && typeof (EdgeRuntime as Record<string, unknown>).waitUntil === "function") {
      (EdgeRuntime as unknown as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(backgroundPromise);
    } else {
      // Fallback: attach as unhandled rejection handler won't kill it on Deno
      backgroundPromise.catch(() => {});
    }

    console.log(`[CRON:${requestId}] success - accepted immediately (V7 running in background)`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Report generation accepted",
        triggered: "generate-daily-report-v7",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[CRON:${requestId}] failed - exception: ${message}`);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
