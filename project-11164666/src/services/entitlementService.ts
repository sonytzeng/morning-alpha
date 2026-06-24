import type { FeatureKey, SubscriptionTier, UserEntitlement } from '@/types/subscription';

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
  // P27 UI scaffold only.
  // TODO P28: replace this with server-side entitlement payload / Supabase verified entitlement.
  // TODO P29: enforce reports payload trimming and RLS. Frontend gating is not data security.
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const rawQueryTier = params?.get('tier') || null;
  const queryTier = rawQueryTier ? normalizeTier(rawQueryTier) : null;
  const storedTier = typeof window !== 'undefined' ? normalizeTier(window.localStorage.getItem('morning_alpha_demo_tier')) : 'free';
  const tier = queryTier || storedTier;

  if (typeof window !== 'undefined' && rawQueryTier) {
    window.localStorage.setItem('morning_alpha_demo_tier', tier);
  }

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
