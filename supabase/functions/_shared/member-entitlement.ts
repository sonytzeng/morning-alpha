export type SubscriptionTier = "free" | "member" | "vip" | "admin";

export type MembershipState =
  | "owner"
  | "beta_full"
  | "trialing"
  | "paid_active"
  | "past_due"
  | "canceled"
  | "expired"
  | "free";

export type ProfileAccessRow = {
  role?: string | null;
  subscription_status?: string | null;
  membership_tier?: string | null;
  paid_until?: string | null;
};

export type MemberEntitlementRow = {
  state?: string | null;
  tier?: string | null;
  source?: string | null;
  access_started_at?: string | null;
  access_ends_at?: string | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

export type EffectiveMemberAccess = {
  tier: SubscriptionTier;
  state: MembershipState;
  active: boolean;
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  source: string | null;
};

function normalizeTier(value: unknown): SubscriptionTier {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "member" || normalized === "vip" || normalized === "admin") return normalized;
  return "free";
}

function normalizeState(value: unknown): MembershipState {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "owner" ||
    normalized === "beta_full" ||
    normalized === "trialing" ||
    normalized === "paid_active" ||
    normalized === "past_due" ||
    normalized === "canceled" ||
    normalized === "expired"
  ) return normalized;
  return "free";
}

function timestampIsFuture(value: unknown, nowMs: number): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > nowMs;
}

function legacyProfileAccess(profile: ProfileAccessRow | null, nowMs: number): EffectiveMemberAccess {
  const roleTier = normalizeTier(profile?.role);
  if (roleTier === "admin") {
    return {
      tier: "admin",
      state: "owner",
      active: true,
      accessStartsAt: null,
      accessEndsAt: null,
      trialStartsAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      source: "legacy_profile",
    };
  }

  const subscriptionStatus = typeof profile?.subscription_status === "string"
    ? profile.subscription_status.trim().toLowerCase()
    : "";
  const paidUntil = typeof profile?.paid_until === "string" && profile.paid_until.trim()
    ? profile.paid_until
    : null;
  const paidWindowValid = paidUntil === null || timestampIsFuture(paidUntil, nowMs);
  if (subscriptionStatus === "active" && paidWindowValid) {
    const membershipTier = normalizeTier(profile?.membership_tier);
    const resolvedTier = roleTier === "vip" || roleTier === "member"
      ? roleTier
      : membershipTier === "vip" || membershipTier === "member"
        ? membershipTier
        : "member";
    return {
      tier: resolvedTier,
      state: "paid_active",
      active: true,
      accessStartsAt: null,
      accessEndsAt: paidUntil,
      trialStartsAt: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      source: "legacy_profile",
    };
  }

  return {
    tier: "free",
    state: "free",
    active: false,
    accessStartsAt: null,
    accessEndsAt: null,
    trialStartsAt: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    source: null,
  };
}

export function resolveEffectiveMemberAccess(
  profile: ProfileAccessRow | null,
  entitlement: MemberEntitlementRow | null,
  nowMs = Date.now(),
): EffectiveMemberAccess {
  const roleTier = normalizeTier(profile?.role);
  const state = normalizeState(entitlement?.state);
  const entitlementTier = normalizeTier(entitlement?.tier);

  if (roleTier === "admin" || state === "owner") {
    return {
      tier: "admin",
      state: "owner",
      active: true,
      accessStartsAt: entitlement?.access_started_at || null,
      accessEndsAt: null,
      trialStartsAt: entitlement?.trial_started_at || null,
      trialEndsAt: entitlement?.trial_ends_at || null,
      cancelAtPeriodEnd: false,
      source: entitlement?.source || "profile_admin",
    };
  }

  if (!entitlement || state === "free") return legacyProfileAccess(profile, nowMs);

  const tier: SubscriptionTier = entitlementTier === "vip" ? "vip" : "member";
  const accessEndsAt = entitlement.access_ends_at || entitlement.current_period_end || null;
  const trialEndsAt = entitlement.trial_ends_at || null;
  let active = false;

  if (state === "beta_full") {
    active = accessEndsAt === null || timestampIsFuture(accessEndsAt, nowMs);
  } else if (state === "trialing") {
    active = timestampIsFuture(trialEndsAt, nowMs);
  } else if (state === "paid_active") {
    active = accessEndsAt === null || timestampIsFuture(accessEndsAt, nowMs);
  } else if (state === "canceled") {
    active = timestampIsFuture(accessEndsAt, nowMs);
  }

  return {
    tier: active ? tier : "free",
    state: active ? state : state === "past_due" ? "past_due" : "expired",
    active,
    accessStartsAt: entitlement.access_started_at || null,
    accessEndsAt,
    trialStartsAt: entitlement.trial_started_at || null,
    trialEndsAt,
    cancelAtPeriodEnd: entitlement.cancel_at_period_end === true,
    source: entitlement.source || null,
  };
}
