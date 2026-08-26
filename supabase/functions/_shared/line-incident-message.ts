export type DeliveryIncidentCategory = 'data' | 'content' | 'system';

const CONTENT_REASON_PATTERNS = [
  /^content_/,
  /^member_research_/,
  /^recommendation_reasoning_/,
  /^decision_mode_/,
  /^generic_content_/,
  /^evidence_quality_contract_missing$/,
  /^decision_snapshot_not_publishable$/,
];

const DATA_REASON_PATTERNS = [
  /^source_data_incomplete$/,
  /^fresh_catalyst_evidence_missing$/,
  /^verified_catalyst_evidence_missing$/,
  /^news_traceability_incomplete$/,
  /^blank_market_change_detected$/,
  /^stale_market_data:/,
  /^unavailable_market_data:/,
  /^market_data(?::|$)/,
  /^market_news(?::|$)/,
];

export function classifyDeliveryIncident(reasonCodes: unknown): DeliveryIncidentCategory {
  const reasons = Array.isArray(reasonCodes)
    ? reasonCodes.map(String).map((reason) => reason.trim()).filter(Boolean)
    : [];
  const hasDataFailure = reasons.some((reason) => DATA_REASON_PATTERNS.some((pattern) => pattern.test(reason)));
  const hasContentFailure = reasons.some((reason) => CONTENT_REASON_PATTERNS.some((pattern) => pattern.test(reason)));

  if (hasDataFailure) return 'data';
  if (hasContentFailure) return 'content';
  return 'system';
}

export function buildDeliveryIncidentLineMessage(
  siteUrl: string,
  reasonCodes: unknown,
): { type: 'text'; text: string } {
  const category = classifyDeliveryIncident(reasonCodes);
  const reportUrl = `${siteUrl.replace(/\/$/, '')}/report/today`;

  if (category === 'content') {
    return {
      type: 'text',
      text: [
        'Morning Alpha｜盤前內容品質驗收未通過',
        '',
        '今日市場與新聞資料已完成，但盤前分析文案尚未通過 Editorial／Premium Gate。',
        '系統已阻擋不合格版本，並進入內容修復流程；這不是資料供應商延遲。',
        '',
        '修復並重新驗證通過後，才會補送正式盤前內容。',
        reportUrl,
      ].join('\n'),
    };
  }

  if (category === 'data') {
    return {
      type: 'text',
      text: [
        'Morning Alpha｜盤前資料延遲',
        '',
        '今日盤前資料尚未達到完整性與新鮮度標準。',
        '系統正在自動補抓資料並重新產生報告；未達標內容不會冒充正式分析推送。',
        '',
        '資料恢復且品質驗收通過後，才會補送正式盤前內容。',
        reportUrl,
      ].join('\n'),
    };
  }

  return {
    type: 'text',
    text: [
      'Morning Alpha｜盤前流程異常',
      '',
      '今日盤前流程尚未完成正式發布驗收。',
      '系統已阻擋未完成版本並保留稽核紀錄，目前正在執行安全修復。',
      '',
      '流程恢復且品質驗收通過後，才會補送正式盤前內容。',
      reportUrl,
    ].join('\n'),
  };
}
