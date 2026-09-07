// Synthetic, isolated fixture. Never a production-market claim or seed.
export const DAY = '2026-09-07';
export function decisionFixture() {
  const measured = (value) => ({ value, method: 'measured', evidence_ids: ['quote', 'calibration'] });
  const factors = Object.fromEntries(['regime_fit', 'risk_reward', 'valuation', 'price_position', 'catalyst', 'fundamental', 'not_priced_in', 'institutional', 'evidence_quality', 'historical_validation'].map(k => [k, measured(.8)]));
  return {
    contract_version: 'decision-v1', report_date: DAY, revision_id: 'synthetic-v1',
    generated_at: `${DAY}T01:30:00Z`, data_as_of: `${DAY}T01:30:00Z`, is_trading_day: true,
    market_direction: 'BULLISH', market_regime: 'TREND', price_state: 'NORMAL',
    direction_model: { probability: 85, method: 'out_of_sample_calibrated', model_version: 'synthetic-oos-1', calibration_end: '2026-09-01T00:00:00Z', sample_count: 60, evidence_ids: ['calibration'] },
    confidence: { ...Object.fromEntries(['completeness', 'freshness', 'source_agreement', 'signal_agreement', 'historical_calibration'].map(k => [k, measured(.88)])), missing_evidence_penalty: measured(0) },
    entry: structuredClone(factors), market_risk: measured(.2), reason_summary: '隔離測試：事件支持方向，但仍需核對進場條件。',
    evidence: ['market', 'calibration', 'fundamental', 'event'].map((kind, i) => ({ id: ['quote', 'calibration', 'fundamental', 'event'][i], kind, source: 'Synthetic local fixture', summary: '合成測試證據，不代表正式行情', observed_at: i === 1 ? '2026-09-01T00:00:00Z' : `${DAY}T01:27:00Z`, report_date: DAY, revision_id: 'synthetic-v1' })),
    screening: { status: 'COMPLETE', universe_count: 1, evidence_ids: ['quote'] },
    stock_opportunities: [{ symbol: '2344', company_name: '合成測試公司', thesis: '測試事件有可核對的公司影響',
      transmission: { catalyst: '合成事件', cause: '測試原因', market_impact: '測試市場影響', sector: '測試產業', company_exposure: '測試公司曝險', fundamental_impact: 'INTACT', fundamental_explanation: '合成財報無受損證據', price_reaction: '合成價格反應', priced_in: '測試估值尚未充分反映', risk_reward: '僅作邏輯測試', evidence_ids: ['fundamental', 'quote', 'event'] },
      factors, risk_score: measured(.2), catalyst_score: measured(.8), priced_in_score: measured(.3), mispricing_score: measured(.9), evidence_ids: ['quote', 'fundamental'], invalidation_conditions: ['合成測試需求下降時失效'],
      checks: { company_negative: 'ABSENT', revenue_exposure: true, supply_chain: true, guidance: true, sector_demand: true, institutional: true, valuation: true, price_reaction: true },
      price_state: 'NORMAL', selloff_origin: 'MARKET_WIDE', confirmation: 'COMPLETED', confirmation_evidence_ids: ['quote'],
    }],
  };
}
