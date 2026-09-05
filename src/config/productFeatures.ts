import type { UserEntitlement } from '@/types/subscription';

export type ProductFeatureKey = 'beginner_learning' | 'beginner_report_mode' | 'alpha_coach';
export type ProductFeatureAudience = 'public' | 'owner';

export type ProductFeatureDefinition = {
  enabled: boolean;
  audience: ProductFeatureAudience;
};

/** Local release switches only; protected data still requires server entitlement. */
export const PRODUCT_FEATURE_FLAGS: Record<ProductFeatureKey, ProductFeatureDefinition> = {
  beginner_learning: { enabled: true, audience: 'public' },
  beginner_report_mode: { enabled: true, audience: 'owner' },
  alpha_coach: { enabled: false, audience: 'owner' },
};

export function canUseProductFeature(
  feature: ProductFeatureKey,
  entitlement?: Pick<UserEntitlement, 'tier' | 'isLoggedIn' | 'isAdmin'> | null,
): boolean {
  const definition = PRODUCT_FEATURE_FLAGS[feature];
  if (!definition.enabled) return false;
  if (definition.audience === 'public') return true;
  return entitlement?.isLoggedIn === true
    && entitlement.isAdmin === true
    && entitlement.tier === 'admin';
}
