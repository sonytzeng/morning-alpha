export interface UserAccount {
  plan: string;
  planId: string;
  nextBillingDate: string;
  linePushEnabled: boolean;
  linePushTime: string;
  watchedSectors: string[];
  subscriptionStatus: 'active' | 'paused' | 'cancelled';
  email: string;
  username: string;
  joinedAt: string;
}

export const mockUserAccount: UserAccount = {
  plan: 'Pro',
  planId: 'pro',
  nextBillingDate: '2026-06-25',
  linePushEnabled: true,
  linePushTime: '07:00',
  watchedSectors: ['AI / 半導體', '金融', 'ETF 投資人'],
  subscriptionStatus: 'active',
  email: 'user@example.com',
  username: '投資人小陳',
  joinedAt: '2026-03-15',
};

export const availableSectors = [
  '大盤情緒',
  'AI / 半導體',
  '金融',
  '航運',
  '傳產',
  'ETF 投資人',
  '生技',
  '綠能',
  '營建',
  '觀光',
];