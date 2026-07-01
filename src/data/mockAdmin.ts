export interface AdminNewsSource {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'error' | 'paused';
  lastImportAt: string;
  articlesToday: number;
  apiKeyStatus: 'valid' | 'expired' | 'missing';
}

export const adminNewsSources: AdminNewsSource[] = [
  {
    id: 'src-001',
    name: 'Finnhub',
    type: '財經 API',
    status: 'active',
    lastImportAt: '2026-05-25 07:15:32',
    articlesToday: 42,
    apiKeyStatus: 'valid',
  },
  {
    id: 'src-002',
    name: 'GNews',
    type: '新聞 API',
    status: 'active',
    lastImportAt: '2026-05-25 07:12:08',
    articlesToday: 28,
    apiKeyStatus: 'valid',
  },
  {
    id: 'src-003',
    name: 'NewsAPI',
    type: '新聞 API',
    status: 'active',
    lastImportAt: '2026-05-25 07:18:45',
    articlesToday: 35,
    apiKeyStatus: 'valid',
  },
  {
    id: 'src-004',
    name: 'Google News RSS',
    type: 'RSS 訂閱',
    status: 'active',
    lastImportAt: '2026-05-25 07:10:22',
    articlesToday: 56,
    apiKeyStatus: 'valid',
  },
  {
    id: 'src-005',
    name: '公開資訊觀測站',
    type: '台灣官方',
    status: 'active',
    lastImportAt: '2026-05-25 07:05:18',
    articlesToday: 12,
    apiKeyStatus: 'valid',
  },
];

export interface AdminKeyword {
  id: string;
  word: string;
  category: string;
  impact: 'high' | 'medium' | 'low';
  frequency: number;
  enabled: boolean;
}

export const adminKeywords: AdminKeyword[] = [
  { id: 'kw-001', word: 'TSMC ADR', category: '台股', impact: 'high', frequency: 156, enabled: true },
  { id: 'kw-002', word: 'Nvidia', category: '科技股', impact: 'high', frequency: 142, enabled: true },
  { id: 'kw-003', word: 'Semiconductor', category: '半導體', impact: 'high', frequency: 138, enabled: true },
  { id: 'kw-004', word: 'Federal Reserve', category: '央行', impact: 'high', frequency: 125, enabled: true },
  { id: 'kw-005', word: 'US Treasury Yield', category: '利率', impact: 'high', frequency: 118, enabled: true },
  { id: 'kw-006', word: 'Oil Prices', category: '商品', impact: 'medium', frequency: 95, enabled: true },
  { id: 'kw-007', word: 'China Economy', category: '經濟', impact: 'high', frequency: 88, enabled: true },
  { id: 'kw-008', word: 'Japan Semiconductor', category: '半導體', impact: 'medium', frequency: 76, enabled: true },
  { id: 'kw-009', word: 'Korea Semiconductor', category: '半導體', impact: 'medium', frequency: 72, enabled: true },
  { id: 'kw-010', word: 'Taiwan Stock Market', category: '台股', impact: 'high', frequency: 68, enabled: true },
  { id: 'kw-011', word: '公開資訊觀測站重大訊息', category: '台股', impact: 'high', frequency: 45, enabled: true },
];

export interface AdminMarketDataStatus {
  id: string;
  name: string;
  source: string;
  status: 'synced' | 'pending' | 'error';
  lastUpdated: string;
  nextUpdate: string;
}

export const adminMarketData: AdminMarketDataStatus[] = [
  { id: 'md-001', name: 'Nasdaq', source: 'Yahoo Finance', status: 'synced', lastUpdated: '07:20', nextUpdate: '07:30' },
  { id: 'md-002', name: 'S&P 500', source: 'Yahoo Finance', status: 'synced', lastUpdated: '07:20', nextUpdate: '07:30' },
  { id: 'md-003', name: '費半指數', source: 'NASDAQ', status: 'synced', lastUpdated: '07:22', nextUpdate: '07:32' },
  { id: 'md-004', name: '台積電 ADR', source: 'NYSE', status: 'synced', lastUpdated: '07:21', nextUpdate: '07:31' },
  { id: 'md-005', name: '美元指數', source: 'ICE', status: 'synced', lastUpdated: '07:19', nextUpdate: '07:29' },
  { id: 'md-006', name: '美國十年期公債', source: 'US Treasury', status: 'synced', lastUpdated: '07:18', nextUpdate: '07:28' },
  { id: 'md-007', name: '原油 (WTI)', source: 'NYMEX', status: 'synced', lastUpdated: '07:23', nextUpdate: '07:33' },
  { id: 'md-008', name: '黃金', source: 'COMEX', status: 'synced', lastUpdated: '07:24', nextUpdate: '07:34' },
];

export interface AdminReportStatus {
  id: string;
  date: string;
  status: 'generated' | 'generating' | 'pending' | 'error';
  generatedAt: string | null;
  aiConfidence: number | null;
  sectionsCompleted: number;
  totalSections: number;
}

export const adminReportStatus: AdminReportStatus[] = [
  { id: 'rs-001', date: '2026-05-25', status: 'generated', generatedAt: '07:25:12', aiConfidence: 78, sectionsCompleted: 6, totalSections: 6 },
  { id: 'rs-002', date: '2026-05-24', status: 'generated', generatedAt: '07:24:45', aiConfidence: 62, sectionsCompleted: 6, totalSections: 6 },
  { id: 'rs-003', date: '2026-05-23', status: 'generated', generatedAt: '07:26:03', aiConfidence: 55, sectionsCompleted: 6, totalSections: 6 },
  { id: 'rs-004', date: '2026-05-22', status: 'generated', generatedAt: '07:23:18', aiConfidence: 82, sectionsCompleted: 6, totalSections: 6 },
  { id: 'rs-005', date: '2026-05-21', status: 'generated', generatedAt: '07:25:55', aiConfidence: 48, sectionsCompleted: 6, totalSections: 6 },
];

export interface AdminPushLog {
  id: string;
  type: 'line' | 'email';
  status: 'success' | 'failed' | 'pending';
  sentAt: string;
  recipientCount: number;
  successCount: number;
  messagePreview: string;
}

export const adminPushLogs: AdminPushLog[] = [
  { id: 'pl-001', type: 'line', status: 'success', sentAt: '2026-05-25 07:30:05', recipientCount: 342, successCount: 338, messagePreview: '【台股盤前情報】05/25 美股科技股反彈...' },
  { id: 'pl-002', type: 'line', status: 'success', sentAt: '2026-05-24 07:30:12', recipientCount: 338, successCount: 335, messagePreview: '【台股盤前情報】05/24 美股拉回整理...' },
  { id: 'pl-003', type: 'line', status: 'success', sentAt: '2026-05-23 07:30:08', recipientCount: 335, successCount: 331, messagePreview: '【台股盤前情報】05/23 Fed 會議紀要偏鷹...' },
  { id: 'pl-004', type: 'email', status: 'success', sentAt: '2026-05-25 07:35:22', recipientCount: 156, successCount: 152, messagePreview: '台股盤前 AI 情報站 - 05/25 完整報告...' },
  { id: 'pl-005', type: 'email', status: 'failed', sentAt: '2026-05-24 07:35:15', recipientCount: 152, successCount: 148, messagePreview: '台股盤前 AI 情報站 - 05/24 完整報告...' },
];

export interface AdminMember {
  id: string;
  email: string;
  plan: string;
  status: 'active' | 'cancelled' | 'trial';
  joinedAt: string;
  lastActive: string;
  lineConnected: boolean;
}

export const adminMembers: AdminMember[] = [
  { id: 'mem-001', email: 'user1@example.com', plan: 'Premium', status: 'active', joinedAt: '2026-01-10', lastActive: '2026-05-25 07:15', lineConnected: true },
  { id: 'mem-002', email: 'user2@example.com', plan: 'Pro', status: 'active', joinedAt: '2026-02-20', lastActive: '2026-05-25 06:50', lineConnected: true },
  { id: 'mem-003', email: 'user3@example.com', plan: 'Pro', status: 'active', joinedAt: '2026-03-05', lastActive: '2026-05-24 22:30', lineConnected: false },
  { id: 'mem-004', email: 'user4@example.com', plan: 'Free', status: 'active', joinedAt: '2026-04-12', lastActive: '2026-05-25 07:20', lineConnected: false },
  { id: 'mem-005', email: 'user5@example.com', plan: 'Premium', status: 'active', joinedAt: '2026-01-25', lastActive: '2026-05-25 07:10', lineConnected: true },
  { id: 'mem-006', email: 'user6@example.com', plan: 'Pro', status: 'cancelled', joinedAt: '2026-02-15', lastActive: '2026-05-10 18:00', lineConnected: true },
  { id: 'mem-007', email: 'user7@example.com', plan: 'Free', status: 'trial', joinedAt: '2026-05-20', lastActive: '2026-05-25 07:05', lineConnected: false },
  { id: 'mem-008', email: 'user8@example.com', plan: 'Pro', status: 'active', joinedAt: '2026-03-18', lastActive: '2026-05-25 06:45', lineConnected: true },
];

export const adminStats = {
  totalMembers: 342,
  activeMembers: 298,
  proMembers: 156,
  premiumMembers: 48,
  freeMembers: 138,
  todayReports: 1,
  todayNewsImported: 173,
  todayPushesSent: 490,
  avgAiConfidence: 65,
};

export interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'completed' | 'failed' | 'running';
  startedAt: string | null;
  completedAt: string | null;
  details: string;
}

export const todayWorkflowSteps: WorkflowStep[] = [
  { id: 'wf-001', name: '全球新聞匯入', status: 'completed', startedAt: '07:00:00', completedAt: '07:18:45', details: '已從 5 個來源匯入 173 則新聞' },
  { id: 'wf-002', name: '市場數據匯入', status: 'completed', startedAt: '07:18:45', completedAt: '07:24:32', details: '9 個市場指數、7 個商品匯率已同步' },
  { id: 'wf-003', name: 'AI 分析生成', status: 'completed', startedAt: '07:24:32', completedAt: '07:25:12', details: '6 個族群分析完成，劇本成立度 78' },
  { id: 'wf-004', name: '網站發布', status: 'completed', startedAt: '07:25:12', completedAt: '07:25:18', details: '報告已發布至 /report/today' },
  { id: 'wf-005', name: 'LINE 推播', status: 'completed', startedAt: '07:30:00', completedAt: '07:30:05', details: '已推播 342 人，成功 338 人' },
];

export interface LinePushStatus {
  scheduledTime: string;
  status: 'scheduled' | 'sent' | 'failed';
  recipientCount: number;
  successCount: number;
  failedCount: number;
  messagePreview: string;
}

export const linePushStatus: LinePushStatus = {
  scheduledTime: '07:30',
  status: 'sent',
  recipientCount: 342,
  successCount: 338,
  failedCount: 4,
  messagePreview: '【台股盤前情報】05/25 美股科技股反彈、費半走強，AI 與半導體族群盤前情緒偏多。 dollar 轉強可能影響外資布局意願。詳細報告請見連結。',
};