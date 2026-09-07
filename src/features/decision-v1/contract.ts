/** Product-only, side-effect-free contract. Never imports a producer or writes a report. */
export const DECISION_SCORE_VERSION = 'ma-decision-v1.0' as const;
export type Action = 'ACTIVE_WATCH' | 'WAIT_FOR_PULLBACK' | 'WAIT_FOR_CONFIRMATION'
  | 'HOLD_WATCH' | 'DO_NOT_CHASE' | 'DEFENSIVE' | 'AVOID'
  | 'NO_QUALIFIED_OPPORTUNITY' | 'INSUFFICIENT_DATA' | 'NOT_APPLICABLE';
export type Direction = 'BULLISH' | 'BEARISH' | 'RANGE';
export type Regime = 'TREND' | 'RANGE' | 'RISK_OFF' | 'HIGH_VOLATILITY';
export type Evidence = {
  id: string; source: string; summary: string; observed_at: string;
  report_date: string; revision_id: string;
  kind: 'market' | 'event' | 'fundamental' | 'calibration';
  table?: string; row_id?: string; available_at?: string; source_url?: string;
  fields?: Record<string, string | number>; freshness_seconds?: number;
};
/** Ratios are measured, not LLM ratings; each measurement retains source evidence. */
export type Measure = { value: number; evidence_ids: string[]; method: 'measured' };
export type ConfidenceInputs = {
  completeness: Measure; freshness: Measure; source_agreement: Measure;
  signal_agreement: Measure; historical_calibration: Measure; missing_evidence_penalty: Measure;
};
export type EntryInputs = {
  regime_fit: Measure; risk_reward: Measure; valuation: Measure; price_position: Measure;
  catalyst: Measure; fundamental: Measure; not_priced_in: Measure;
  institutional: Measure; evidence_quality: Measure; historical_validation: Measure;
};
export type Score = {
  value: number; score_version: typeof DECISION_SCORE_VERSION;
  evidence_ids: string[]; calculation: string; inputs: Record<string, number>;
  meaning: 'probability' | 'quality_index';
};
export type Transmission = {
  catalyst: string; cause: string; market_impact: string; sector: string;
  company_exposure: string; fundamental_impact: 'POSITIVE' | 'INTACT' | 'DAMAGED' | 'UNKNOWN';
  fundamental_explanation: string; price_reaction: string; priced_in: string;
  risk_reward: string; evidence_ids: string[];
};
export type OpportunityInput = {
  symbol: string; company_name: string; thesis: string; transmission: Transmission;
  factors: EntryInputs; risk_score: Measure; catalyst_score: Measure;
  priced_in_score: Measure; mispricing_score: Measure;
  evidence_ids: string[]; invalidation_conditions: string[];
  checks: {
    company_negative: 'ABSENT' | 'PRESENT' | 'UNKNOWN';
    revenue_exposure: boolean; supply_chain: boolean; guidance: boolean; sector_demand: boolean;
    institutional: boolean; valuation: boolean; price_reaction: boolean;
  };
  price_state: 'EXTENDED' | 'SELLOFF' | 'NORMAL';
  selloff_origin: 'MARKET_WIDE' | 'COMPANY' | 'UNKNOWN';
  confirmation: 'COMPLETED' | 'PENDING' | 'FAILED';
  confirmation_evidence_ids: string[];
};
export type DecisionInput = {
  contract_version: 'decision-v1'; report_date: string; revision_id: string;
  generated_at: string; data_as_of: string; is_trading_day: boolean;
  market_direction: Direction; market_regime: Regime;
  direction_model: {
    probability: number; method: 'out_of_sample_calibrated'; model_version: string;
    calibration_end: string; sample_count: number; evidence_ids: string[];
  } | null;
  confidence: ConfidenceInputs; entry: EntryInputs; market_risk: Measure;
  price_state: 'EXTENDED' | 'SELLOFF' | 'NORMAL';
  reason_summary: string; evidence: Evidence[]; stock_opportunities: OpportunityInput[];
  screening: { status: 'COMPLETE' | 'INCOMPLETE'; universe_count: number; evidence_ids: string[] };
};
export type Opportunity = {
  symbol: string; company_name: string; thesis: string; transmission: Transmission;
  action: Action; classification: 'MISPRICING_CANDIDATE' | 'FUNDAMENTAL_DAMAGE' | 'CATALYST_WATCH';
  catalyst_score: Score | null; priced_in_score: Score | null; risk_score: Score | null;
  opportunity_score: Score; mispricing_score: Score | null;
  evidence: Evidence[]; invalidation_conditions: string[];
  data_quality: 'complete';
};
export type Decision = {
  schema_version?: 'decision-evidence-v1';
  calibration_status?: 'INSUFFICIENT_HISTORY';
  direction_evidence_score?: Score | null;
  factor_availability?: Record<string, { status: 'AVAILABLE' | 'UNAVAILABLE' | 'CONFLICTING'; value: number | null; evidence_ids: string[]; calculation: string }>;
  screening?: { status: 'COMPLETE' | 'INCOMPLETE'; universe_count: number; evaluated_count: number; rejected: { symbol: string; reasons: string[] }[] };
  assessment_id?: string;
  catalysts?: { source: string; published_at: string; event_type: string; affected_sector: string[]; affected_company: string[]; fundamental_impact: 'UNAVAILABLE'; evidence: string[] }[];
  report_date: string; revision_id: string; generated_at: string; data_as_of: string;
  market_direction: Direction | null; market_regime: Regime | null;
  direction_probability: Score | null; model_confidence: Score | null;
  entry_environment_score: Score | null; market_risk_score: Score | null;
  action: Action; reason_summary: string; evidence: Evidence[];
  confidence_evidence: Evidence[]; primary_catalysts: string[]; sector_impacts: string[];
  data_freshness: 'unavailable' | 'valid_at_assessment'; evidence_quality: 'insufficient' | 'complete';
  stock_opportunities: Opportunity[]; rejected_opportunity_count: number;
  issues: string[];
};
