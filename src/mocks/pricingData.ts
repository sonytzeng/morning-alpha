export interface PricingPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  isPopular: boolean;
  isPremium: boolean;
  buttonText: string;
}

export const pricingPlans: PricingPlan[] = [
  {
    id: 'free',
    name: '免費版',
    price: 'NT$0',
    period: '全部開放',
    description: '產品養成期，幫你建立每天回來看的習慣',
    features: [
      '每日 AI 情緒燈號',
      '今日一句提醒',
      '今天不要犯的錯',
      '每日市場方向',
      'AI 市場陪伴',
      '每日市場氣氛',
      '明天市場可能劇本',
      '10 萬元模擬配置',
    ],
    isPopular: true,
    isPremium: false,
    buttonText: '免費開始',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '即將推出',
    period: '',
    description: '讓 AI 成為你的市場記憶，建立長期信任',
    features: [
      '30 天市場情緒歷史',
      'AI 趨勢追蹤',
      'AI 判斷紀錄',
      'AI 問答助理',
      'AI 市場週報',
      'AI 情緒歷史',
    ],
    isPopular: false,
    isPremium: false,
    buttonText: '加入早鳥名單',
  },
];