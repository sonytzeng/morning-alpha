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

export function buildFeatures(tier: SubscriptionTier): Record<FeatureKey, boolean> {
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

export function buildEntitlementFromTier(tier: SubscriptionTier): UserEntitlement {
  return {
    tier,
    features: buildFeatures(tier),
    isLoggedIn: tier !== 'free',
    isAdmin: tier === 'admin',
  };
}

export async function getCurrentEntitlement(): Promise<UserEntitlement> {
  const response = await callGetReportPayload();
  return {
    ...buildEntitlementFromTier(response.tier),
    isLoggedIn: response.authenticated === true,
  };
}

export function hasFeature(entitlement: UserEntitlement | null | undefined, featureKey: FeatureKey): boolean {
  if (!entitlement) return false;
  return entitlement.features[featureKey] === true;
}

export function getTierLabel(tier: SubscriptionTier): string {
  return TIER_LABELS[tier] || TIER_LABELS.free;
}

export async function callGetReportPayload(params: {
  reportDate?: string | null;
} = {}): Promise<ServerReportPayloadResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token || '';
  const body: Record<string, unknown> = {
    report_date: params.reportDate || null,
  };

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
