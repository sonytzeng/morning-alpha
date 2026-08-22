export type MembershipState =
  | 'owner'
  | 'beta_full'
  | 'trialing'
  | 'paid_active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'free';

export interface MembershipAccess {
  tier: 'free' | 'member' | 'vip' | 'admin';
  state: MembershipState;
  active: boolean;
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  source: string | null;
}

export interface MembershipOffer {
  signup_mode: 'closed' | 'beta_full' | 'trialing';
  trial_days: number;
  billing_mode: 'disabled' | 'manual' | 'provider';
  beta_access_ends_at: string | null;
}

export interface MemberAccessResponse {
  success: boolean;
  authenticated: boolean;
  user: {
    id: string;
    email: string | null;
  };
  membership: MembershipAccess;
  offer: MembershipOffer;
  server_time: string;
  error?: string;
}
