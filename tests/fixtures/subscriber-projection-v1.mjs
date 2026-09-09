// Synthetic subscriber-read shapes only. Never a provider response, calibrated
// model, recommendation, production record, or authenticated identity fixture.
export const PROJECTION_SCENARIOS = [
  'READY', 'PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED', 'NOT_DUE',
  'MARKET_READY_RECOMMENDATION_BLOCKED', 'MISSING_CONFIDENCE', 'STALE',
  'CLOSING_COMPLETE', 'RUNTIME_INVALIDATED',
];
export const INCOMPLETE = '今日分析尚未完成／證據不足';
export const RECOMMENDATION_BLOCKED = '推薦評估證據不足，今日暫不發布正式個股推薦';

export function subscriberProjectionFixture(name, options = {}) {
  if (!PROJECTION_SCENARIOS.includes(name)) throw new Error('UNKNOWN_SYNTHETIC_PROJECTION_SCENARIO');
  const todayDate = options.todayDate || '2026-09-09';
  const previous = new Date(`${todayDate}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 1);
  const reportDate = name === 'STALE' ? previous.toISOString().slice(0, 10) : todayDate;
  const revision = `synthetic-subscriber-${name.toLowerCase()}`;
  const generatedAt = `${reportDate}T07:30:00+08:00`;
  const unavailable = ['PARTIAL', 'BLOCKED', 'FAILED', 'INVALIDATED'].includes(name);
  const confidence = unavailable || name === 'MISSING_CONFIDENCE' ? null : 73;
  const blocked = unavailable || ['MARKET_READY_RECOMMENDATION_BLOCKED', 'STALE', 'RUNTIME_INVALIDATED'].includes(name);
  const stock = { symbol: '2330', name: '合成測試公司', stock_name: '合成測試公司', role: 'MAIN_THESIS',
    reason: '合成隔離證據，不是正式推薦。', thesis: '合成隔離證據，不是正式推薦。',
    confirmation: '等待合成測試資料確認。', invalidation: '合成測試風險。' };
  const close = { status: 'NOT_DUE', report_date: reportDate };
  const body = {
    report_date: reportDate, revision_id: revision, generated_at: generatedAt, data_as_of: generatedAt,
    market_status: 'OPEN', is_trading_day: true, report_mode: 'normal_overnight',
    report_status: unavailable ? name : 'READY', market_bias: '偏多', confidence_score: unavailable || name === 'MISSING_CONFIDENCE' ? 100 : 73,
    quality_score: 100, content_score: 100, premium_content_status: blocked ? 'blocked' : 'eligible',
    daily_sentence: unavailable ? '內部 QA 條件失效，綜合評分 100/100' : '成交量增加5%，先等市場方向確認。',
    today_quote: unavailable ? '內部 QA 條件失效，綜合評分 100/100' : '成交量增加5%，先等市場方向確認。',
    canonical_decision: { id: revision, status: unavailable ? name : 'READY', action: unavailable ? 'STOP' : 'WAIT',
      decision_mode: blocked ? 'market_only' : 'recommendations', confidence_score: confidence,
      daily_sentence: unavailable ? '內部 QA 條件失效，綜合評分 100/100' : '成交量增加5%，先等市場方向確認。',
      reasons: ['成交量增加5%；綜合評分 100/100', '台股站回100日均線', '股價100元；殖利率5%'],
      recommendations: blocked ? [] : [stock] },
    content_publish_gate: { overall_status: unavailable ? 'blocked' : 'eligible', blocking_issues: unavailable ? ['SYNTHETIC_UNPUBLISHED'] : [] },
    market_report_gate: { eligible: !unavailable, report_status: unavailable ? name : 'READY' },
    recommendation_status: blocked ? 'BLOCKED' : 'QUALIFIED',
    recommendation_gate: { status: blocked ? 'BLOCKED' : 'QUALIFIED', eligible: !blocked, universe_evaluation_complete: false },
    today_beneficiary_stocks: blocked ? [] : [stock], today_beneficiary_stocks_v10: blocked ? [] : [stock],
    closing_verification_v2: close,
    closing_verification: { status: 'completed', data_status: 'complete', report_date: reportDate,
      opening_decision_snapshot_id: revision, verified_at: `${reportDate}T14:30:00+08:00`, prediction_result: 'hit',
      actual_taiex_change: 1, actual_2330_close: { change_percent: 1 }, actual_txf_close: { change_percent: 1 }, missing_data: [] },
    intraday_sync_status: { report_date: reportDate, lifecycle_complete: true, windows: {
      '1430': { status: 'completed', completed_at: `${reportDate}T14:30:00+08:00`, evidence: { synthetic: true } },
    } },
  };
  // Legacy enums deliberately have no new wire state: the public production
  // reader captured below still uses those aliases. Other cases test V1 wire.
  if (!['BLOCKED', 'FAILED', 'INVALIDATED'].includes(name)) body.subscriber_state = {
    schema_version: 'ma-subscriber-state-v1', report_date: reportDate, revision_id: revision, generated_at: generatedAt,
    publication: unavailable ? 'UNPUBLISHED' : 'PUBLISHED', analysis: unavailable ? 'PARTIAL' : 'READY',
    closing: 'NOT_DUE', recommendation: blocked ? 'BLOCKED' : 'QUALIFIED',
    confidence: { status: confidence === null ? 'UNAVAILABLE' : 'AVAILABLE', value: confidence }, reason_codes: [],
  };
  if (name === 'CLOSING_COMPLETE') {
    body.subscriber_state.closing = 'COMPLETE';
    body.closing_verification_v2 = globalThis.structuredClone(body.closing_verification);
  }
  if (name === 'RUNTIME_INVALIDATED') body.intraday_sync_status.windows['1030'] = {
    status: 'FAILED', report_date: reportDate, revision_id: revision,
    failed_at: `${reportDate}T10:30:00+08:00`,
    evidence: { checkpoint: '1030', condition: '合成已發生的盤中條件失效，非正式市場證據' },
  };
  return body;
}

export function subscriberFixtureEnvelope(body, actualServerResponse) {
  const tier = actualServerResponse.tier;
  if (!['free', 'member', 'vip', 'admin'].includes(tier)) throw new Error('UNVERIFIED_LOCAL_SERVER_TIER');
  const payload = globalThis.structuredClone(body);
  // Mirror the real endpoint's already-verified tier trimming. This projection
  // does not establish the identity, profile, JWT, or membership result.
  if (tier === 'free') {
    delete payload.today_beneficiary_stocks; delete payload.today_beneficiary_stocks_v10;
    delete payload.canonical_decision.recommendations;
  }
  return { ...actualServerResponse, report_date: body.report_date, today_date: actualServerResponse.today_date,
    revision_id: body.revision_id, generated_at: body.generated_at, data_as_of: body.data_as_of,
    market_status: body.market_status, is_trading_day: body.is_trading_day,
    ...(Object.prototype.hasOwnProperty.call(body, 'subscriber_state') ? { subscriber_state: body.subscriber_state } : {}), payload };
}
