import { supabase } from '@/lib/supabase';
import type { FeatureKey, ServerReportHistoryResponse, ServerReportPayloadResponse, SubscriptionTier, UserEntitlement } from '@/types/subscription';

const GET_REPORT_PAYLOAD_URL = 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/get-report-payload';
const AUTHENTICATED_CACHE_TTL_MS = 10_000;
const PUBLIC_CACHE_TTL_MS = 30_000;

type CacheEntry = { expiresAt: number; value: unknown };
const responseCache = new Map<string, CacheEntry>();
const inflightRequests = new Map<string, Promise<unknown>>();

async function cachedRequest<T>(key: string, ttlMs: number, request: () => Promise<T>): Promise<T> {
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) responseCache.delete(key);

  const inflight = inflightRequests.get(key);
  if (inflight) return inflight as Promise<T>;

  const promise = request()
    .then((value) => {
      responseCache.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });
  inflightRequests.set(key, promise);
  return promise;
}

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
  const userId = sessionData.session?.user.id || 'anonymous';
  const cacheKey = `report-payload:${userId}:${params.reportDate || 'latest'}`;
  const cacheTtlMs = accessToken ? AUTHENTICATED_CACHE_TTL_MS : PUBLIC_CACHE_TTL_MS;
  const body: Record<string, unknown> = {
    report_date: params.reportDate || null,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return cachedRequest<ServerReportPayloadResponse>(cacheKey, cacheTtlMs, async () => {
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
  });
}

export async function callGetReportHistory(limit = 30): Promise<ServerReportHistoryResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token || '';
  const userId = sessionData.session?.user.id || 'anonymous';
  const normalizedLimit = Math.min(30, Math.max(1, Math.trunc(limit) || 30));
  const cacheKey = `report-history:${userId}:${normalizedLimit}`;
  const cacheTtlMs = accessToken ? AUTHENTICATED_CACHE_TTL_MS : PUBLIC_CACHE_TTL_MS;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return cachedRequest<ServerReportHistoryResponse>(cacheKey, cacheTtlMs, async () => {
    const response = await fetch(GET_REPORT_PAYLOAD_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ history_limit: normalizedLimit }),
    });
    const json = await response.json().catch(() => null) as ServerReportHistoryResponse | null;
    if (!response.ok || !json) {
      throw new Error(json?.error || `get-report-history failed: ${response.status}`);
    }
    return json;
  });
}
