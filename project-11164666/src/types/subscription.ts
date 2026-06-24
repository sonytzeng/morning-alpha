export type SubscriptionTier = 'free' | 'member' | 'vip' | 'admin';

export type FeatureKey =
  | 'today_report_full'
  | 'opportunities_full'
  | 'member_note_full'
  | 'war_room_full'
  | 'vip_fund_flow'
  | 'vip_accuracy_history'
  | 'vip_alerts';

export interface UserEntitlement {
  tier: SubscriptionTier;
  features: Record<FeatureKey, boolean>;
  isLoggedIn: boolean;
  isAdmin: boolean;
}
