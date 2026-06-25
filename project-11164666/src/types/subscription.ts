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

export interface ServerReportPayloadResponse {
  tier: SubscriptionTier;
  report_date: string | null;
  payload: Record<string, unknown> | null;
  locked_sections: string[];
  source: 'server_trimmed_payload';
  dev_override?: boolean;
  authenticated?: boolean;
  error?: string;
}
