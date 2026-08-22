import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveEffectiveMemberAccess,
  type MemberEntitlementRow,
  type ProfileAccessRow,
} from "../_shared/member-entitlement.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Cache-Control": "private, no-store",
  Vary: "Origin",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function createServiceClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "SERVER_CONFIGURATION_MISSING" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!bearer) return jsonResponse({ success: false, error: "AUTH_REQUIRED" }, 401);

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await serviceClient.auth.getUser(bearer);
  if (userError || !userData.user) {
    return jsonResponse({ success: false, error: "INVALID_SESSION" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = asObject(await req.json());
  } catch {
    body = {};
  }

  const action = body.action === "status" ? "status" : "activate";
  const profileResult = await serviceClient
    .from("profiles")
    .select("role,subscription_status,membership_tier,paid_until")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    console.error("MEMBER_ACCESS_PROFILE_LOOKUP_FAILED", profileResult.error?.message || "PROFILE_NOT_FOUND");
    return jsonResponse({ success: false, error: "PROFILE_NOT_FOUND" }, 409);
  }

  let entitlement: MemberEntitlementRow | null = null;
  if (action === "activate") {
    const activationResult = await serviceClient.rpc("ensure_member_entitlement_v1", {
      p_user_id: userData.user.id,
    });
    if (activationResult.error) {
      console.error("MEMBER_ACCESS_ACTIVATION_FAILED", activationResult.error.message);
      return jsonResponse({ success: false, error: "ACCESS_ACTIVATION_FAILED" }, 500);
    }
    entitlement = activationResult.data as MemberEntitlementRow | null;
  } else {
    const entitlementResult = await serviceClient
      .from("member_entitlements")
      .select("state,tier,source,access_started_at,access_ends_at,trial_started_at,trial_ends_at,current_period_end,cancel_at_period_end")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (entitlementResult.error) {
      console.error("MEMBER_ACCESS_STATUS_FAILED", entitlementResult.error.message);
      return jsonResponse({ success: false, error: "ACCESS_STATUS_FAILED" }, 500);
    }
    entitlement = entitlementResult.data as MemberEntitlementRow | null;
  }

  const configResult = await serviceClient
    .from("membership_access_config")
    .select("signup_mode,trial_days,billing_mode,beta_access_ends_at")
    .eq("config_key", "primary")
    .maybeSingle();

  if (configResult.error || !configResult.data) {
    console.error("MEMBER_ACCESS_CONFIG_FAILED", configResult.error?.message || "CONFIG_NOT_FOUND");
    return jsonResponse({ success: false, error: "ACCESS_CONFIG_MISSING" }, 500);
  }

  const access = resolveEffectiveMemberAccess(
    profileResult.data as ProfileAccessRow,
    entitlement,
  );

  return jsonResponse({
    success: true,
    authenticated: true,
    user: {
      id: userData.user.id,
      email: userData.user.email || null,
    },
    membership: access,
    offer: {
      signup_mode: configResult.data.signup_mode,
      trial_days: configResult.data.trial_days,
      billing_mode: configResult.data.billing_mode,
      beta_access_ends_at: configResult.data.beta_access_ends_at,
    },
    server_time: new Date().toISOString(),
  });
});
