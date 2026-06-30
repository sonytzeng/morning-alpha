import { supabase } from '@/lib/supabase';
import type { FeatureKey, ServerReportPayloadResponse, SubscriptionTier, UserEntitlement } from '@/types/subscription';

const GET_REPORT_PAYLOAD_URL = 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/get-report-payload';

const FEATURE_KEYS: FeatureKey[] = [
  'today_report_full',
  'opportunities_full',
  'member_note_full',
  'war_room_full',
  'vip_fund_flow',
  'vip_accuracy_history',
  'vip_alerts',
];

const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: '免費版',
  member: '會員版',
  vip: 'VIP 版',
  admin: '管理員',
};

function normalizeTier(value: string | null): SubscriptionTier {
  if (value === 'member' || value === 'vip' || value === 'admin') return value;
  return 'free';
}

function getDemoTierOverride(): SubscriptionTier | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const rawQueryTier = params.get('tier');
  if (rawQueryTier) {
    const tier = normalizeTier(rawQueryTier);
    window.localStorage.setItem('morning_alpha_demo_tier', tier);
    return tier;
  }
  const storedTier = window.localStorage.getItem('morning_alpha_demo_tier');
  return storedTier ? normalizeTier(storedTier) : null;
}

function buildFeatures(tier: SubscriptionTier): Record<FeatureKey, boolean> {
  const features = Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Record<FeatureKey, boolean>;

  if (tier === 'member' || tier === 'vip' || tier === 'admin') {
    features.today_report_full = true;
    features.opportunities_full = true;
    features.member_note_full = true;
    features.war_room_full = true;
  }

  if (tier === 'vip' || tier === 'admin') {
    features.vip_fund_flow = true;
    features.vip_accuracy_history = true;
    features.vip_alerts = true;
  }

  return features;
}

export async function getCurrentEntitlement(): Promise<UserEntitlement> {
  // TODO: replace this with server-verified entitlement.
  // Frontend gating is not data security.
  const tier = getDemoTierOverride() || 'free';

  return {
    tier,
    features: buildFeatures(tier),
    isLoggedIn: tier !== 'free',
    isAdmin: tier === 'admin',
  };
}

export function hasFeature(entitlement: UserEntitlement | null | undefined, featureKey: FeatureKey): boolean {
  if (!entitlement) return false;
  if (entitlement.isAdmin) return true;
  return entitlement.features[featureKey] === true;
}

export function getTierLabel(tier: SubscriptionTier): string {
  return TIER_LABELS[tier] || TIER_LABELS.free;
}

export async function callGetReportPayload(params: {
  reportDate?: string | null;
  tier?: SubscriptionTier | null;
} = {}): Promise<ServerReportPayloadResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token || '';
  const demoTier = params.tier || getDemoTierOverride();

  const body: Record<string, unknown> = {
    report_date: params.reportDate || null,
  };

  // P28-2 scaffold: this sends ?tier=member/vip/admin only for dev payload testing
  // and only the Edge Function may decide whether to honor it. TODO P29: remove
  // frontend tier override after DB verified entitlement is live.
  if (!accessToken && demoTier) {
    body.tier = demoTier;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(GET_REPORT_PAYLOAD_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => null) as ServerReportPayloadResponse | null;
  if (!response.ok || !json) {
    throw new Error(json?.error || `get-report-payload failed: ${response.status}`);
  }
  return json;
}
