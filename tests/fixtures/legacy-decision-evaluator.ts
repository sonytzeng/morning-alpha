// Archived synthetic V1 evaluator for regression fixtures ONLY. No production imports.
import { DECISION_SCORE_VERSION } from '../../src/features/decision-v1/contract.ts';
import type { Action, Decision, Evidence, Opportunity, Score, Transmission } from '../../src/features/decision-v1/contract.ts';

const CONFIDENCE = ['completeness', 'freshness', 'source_agreement', 'signal_agreement', 'historical_calibration'] as const;
const ENTRY = ['regime_fit', 'risk_reward', 'valuation', 'price_position', 'catalyst', 'fundamental', 'not_priced_in', 'institutional', 'evidence_quality', 'historical_validation'] as const;
const MAX_AGE_HOURS: Record<Evidence['kind'], number> = { market: 24, event: 96, fundamental: 2880, calibration: 8760 };
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' && !/^(null|undefined|unknown|n\/a|—)$/i.test(value.trim()) ? value.trim() : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : [];
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const ratio = (value: unknown): value is number => numeric(value) && value >= 0 && value <= 1;
const timestamp = (value: unknown) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
export const normalizeDecisionSymbol = (value: unknown) => text(value).toUpperCase().replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, '');

function validEvidence(input: Record<string, unknown>): Evidence[] {
  const asOf = timestamp(input.data_as_of);
  if (!Array.isArray(input.evidence) || !Number.isFinite(asOf)) return [];
  const counts = new Map<string, number>();
  for (const value of input.evidence) { const id = text(object(value).id); counts.set(id, (counts.get(id) ?? 0) + 1); }
  return input.evidence.flatMap((value): Evidence[] => {
    const e = object(value);
    const kind = e.kind;
    if (kind !== 'market' && kind !== 'event' && kind !== 'fundamental' && kind !== 'calibration') return [];
    const observed = timestamp(e.observed_at);
    const age = asOf - observed;
    if (!text(e.id) || counts.get(text(e.id)) !== 1 || !text(e.source) || !text(e.summary)
      || e.report_date !== input.report_date || e.revision_id !== input.revision_id
      || !Number.isFinite(age) || age < 0 || age > MAX_AGE_HOURS[kind] * 3600000) return [];
    return [{ id: text(e.id), source: text(e.source), summary: text(e.summary), kind,
      report_date: text(e.report_date), revision_id: text(e.revision_id), observed_at: text(e.observed_at) }];
  });
}

function references(value: unknown, evidence: Evidence[]): string[] | null {
  const refs = strings(value);
  return refs.length && refs.every((id) => evidence.some((e) => e.id === id)) ? refs : null;
}
function measurement(value: unknown, evidence: Evidence[]) {
  const m = object(value);
  const refs = references(m.evidence_ids, evidence);
  return m.method === 'measured' && ratio(m.value) && refs ? { value: m.value, refs } : null;
}
function score(value: number, inputs: Record<string, number>, refs: string[], calculation: string, meaning: Score['meaning'] = 'quality_index'): Score {
  return { value: Math.round(Math.max(0, Math.min(100, value)) * 10) / 10, score_version: DECISION_SCORE_VERSION,
    inputs, evidence_ids: [...new Set(refs)], calculation, meaning };
}
function singleScore(value: unknown, evidence: Evidence[], name: string): Score | null {
  const m = measurement(value, evidence);
  return m ? score(m.value * 100, { [name]: m.value }, m.refs, `${name} × 100 (measured ratio)`) : null;
}
function composite(value: unknown, keys: readonly string[], evidence: Evidence[], penalty = false): Score | null {
  const input = object(value), inputs: Record<string, number> = {}, refs: string[] = [];
  for (const key of [...keys, ...(penalty ? ['missing_evidence_penalty'] : [])]) {
    const m = measurement(input[key], evidence);
    if (!m) return null;
    inputs[key] = m.value;
    refs.push(...m.refs);
  }
  const mean = keys.reduce((sum, key) => sum + inputs[key], 0) / keys.length;
  return score(100 * (mean - (inputs.missing_evidence_penalty ?? 0)), inputs, refs,
    `100 × (mean(${keys.join(',')})${penalty ? ' − missing_evidence_penalty' : ''}); not a win probability`);
}

function opportunity(value: unknown, evidence: Evidence[]): Opportunity | null {
  const o = object(value), t = object(o.transmission), checks = object(o.checks);
  const refs = references(o.evidence_ids, evidence), chainRefs = references(t.evidence_ids, evidence);
  const invalidation = strings(o.invalidation_conditions);
  const symbol = normalizeDecisionSymbol(o.symbol);
  const quality = composite(o.factors, ENTRY, evidence);
  const chainKeys = ['catalyst', 'cause', 'market_impact', 'sector', 'company_exposure', 'fundamental_explanation', 'price_reaction', 'priced_in', 'risk_reward'];
  const impact = t.fundamental_impact;
  if (!/^\d{4,6}$/.test(symbol) || !text(o.company_name) || !text(o.thesis) || !refs || !chainRefs || !quality
    || !invalidation.length || chainKeys.some((key) => !text(t[key]))
    || !['event', 'fundamental', 'market'].every((kind) => chainRefs.some((id) => evidence.some((e) => e.id === id && e.kind === kind)))
    || (impact !== 'POSITIVE' && impact !== 'INTACT' && impact !== 'DAMAGED')
    || !['EXTENDED', 'SELLOFF', 'NORMAL'].includes(text(o.price_state))
    || !['COMPLETED', 'PENDING', 'FAILED'].includes(text(o.confirmation))) return null;
  const transmission: Transmission = {
    catalyst: text(t.catalyst), cause: text(t.cause), market_impact: text(t.market_impact), sector: text(t.sector),
    company_exposure: text(t.company_exposure), fundamental_impact: impact,
    fundamental_explanation: text(t.fundamental_explanation), price_reaction: text(t.price_reaction),
    priced_in: text(t.priced_in), risk_reward: text(t.risk_reward), evidence_ids: chainRefs,
  };
  const pricedIn = singleScore(o.priced_in_score, evidence, 'priced_in');
  const risk = singleScore(o.risk_score, evidence, 'risk');
  const catalyst = singleScore(o.catalyst_score, evidence, 'catalyst');
  if (!pricedIn || !risk || !catalyst) return null;
  const actualConfirmation = references(o.confirmation_evidence_ids, evidence);
  // No prose classification. A failed checkpoint requires evidence, just like a completed one.
  if (o.confirmation !== 'PENDING' && !actualConfirmation) return null;
  let action: Action = o.confirmation === 'COMPLETED' ? 'ACTIVE_WATCH' : 'WAIT_FOR_CONFIRMATION';
  let classification: Opportunity['classification'] = 'CATALYST_WATCH';
  let mispricing: Score | null = null;
  if (impact === 'DAMAGED' || checks.company_negative === 'PRESENT' || o.confirmation === 'FAILED') {
    classification = 'FUNDAMENTAL_DAMAGE'; action = 'AVOID';
  } else if (o.price_state === 'EXTENDED' || pricedIn.value >= 80) {
    action = 'DO_NOT_CHASE';
  } else if (o.price_state === 'SELLOFF') {
    const completeReview = ['revenue_exposure', 'supply_chain', 'guidance', 'sector_demand', 'institutional', 'valuation', 'price_reaction']
      .every((key) => checks[key] === true);
    if (!completeReview || checks.company_negative !== 'ABSENT' || o.selloff_origin !== 'MARKET_WIDE') return null;
    mispricing = singleScore(o.mispricing_score, evidence, 'mispricing');
    if (!mispricing) return null;
    classification = 'MISPRICING_CANDIDATE';
    // A price decline is never a confirmation, even if the score is high.
    action = 'WAIT_FOR_CONFIRMATION';
  } else if (risk.value >= 70 || quality.value < 50) {
    action = 'WAIT_FOR_PULLBACK';
  }
  return { symbol, company_name: text(o.company_name), thesis: text(o.thesis), transmission, action, classification,
    catalyst_score: catalyst, priced_in_score: pricedIn, risk_score: risk, opportunity_score: quality, mispricing_score: mispricing,
    evidence: evidence.filter((e) => [...refs, ...chainRefs, ...quality.evidence_ids, ...(actualConfirmation ?? [])].includes(e.id)), invalidation_conditions: invalidation, data_quality: 'complete' };
}

/** Evaluate at a supplied report identity; never uses browser time to advance a checkpoint. */
export function evaluateDecisionV1(value: unknown, todayDate: string): Decision {
  const input = object(value);
  const result: Decision = {
    report_date: text(input.report_date), revision_id: text(input.revision_id), generated_at: text(input.generated_at), data_as_of: text(input.data_as_of),
    market_direction: null, market_regime: null, direction_probability: null, model_confidence: null,
    entry_environment_score: null, market_risk_score: null, action: 'INSUFFICIENT_DATA',
    reason_summary: '目前缺少可核對的評估資料；先不新增機會，不能把未完成評估當成沒有機會。',
    evidence: [], confidence_evidence: [], primary_catalysts: [], sector_impacts: [],
    data_freshness: 'unavailable', evidence_quality: 'insufficient', stock_opportunities: [], rejected_opportunity_count: 0, issues: [],
  };
  const generated = timestamp(input.generated_at), asOf = timestamp(input.data_as_of);
  if (input.contract_version !== 'decision-v1' || !/^\d{4}-\d{2}-\d{2}$/.test(result.report_date)
    || result.report_date !== todayDate || !result.revision_id || !Number.isFinite(generated) || !Number.isFinite(asOf)
    || asOf > generated || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(generated)) !== todayDate) {
    result.issues.push('MISSING_OR_STALE_IDENTITY'); return result;
  }
  if (input.is_trading_day === false) {
    return { ...result, action: 'NOT_APPLICABLE', reason_summary: '今日非交易日；不建立新的交易機會，等待下一個交易日。' };
  }
  const evidence = validEvidence(input);
  result.evidence = evidence;
  if (input.is_trading_day !== true || !evidence.some((e) => e.kind === 'market')) {
    result.issues.push('MISSING_MARKET_EVIDENCE'); return result;
  }
  result.data_freshness = 'valid_at_assessment';
  if (input.market_direction === 'BULLISH' || input.market_direction === 'BEARISH' || input.market_direction === 'RANGE') result.market_direction = input.market_direction;
  if (input.market_regime === 'TREND' || input.market_regime === 'RANGE' || input.market_regime === 'RISK_OFF' || input.market_regime === 'HIGH_VOLATILITY') result.market_regime = input.market_regime;
  const model = object(input.direction_model), modelRefs = references(model.evidence_ids, evidence);
  if (result.market_direction && model.method === 'out_of_sample_calibrated' && text(model.model_version) && numeric(model.probability)
    && model.probability >= 0 && model.probability <= 100 && numeric(model.sample_count) && model.sample_count >= 20
    && Number.isInteger(model.sample_count) && timestamp(model.calibration_end) < asOf && modelRefs
    && modelRefs.some((id) => evidence.some((e) => e.id === id && e.kind === 'calibration'))) {
    result.direction_probability = score(model.probability, { calibrated_probability: model.probability, sample_count: model.sample_count }, modelRefs,
      `out_of_sample_calibrated:${text(model.model_version)}; calibration_end=${text(model.calibration_end)}`, 'probability');
  } else result.issues.push('DIRECTION_CALIBRATION_UNAVAILABLE');
  result.model_confidence = composite(input.confidence, CONFIDENCE, evidence, true);
  result.confidence_evidence = evidence.filter(e => result.model_confidence?.evidence_ids.includes(e.id));
  result.entry_environment_score = composite(input.entry, ENTRY, evidence);
  result.market_risk_score = singleScore(input.market_risk, evidence, 'market_risk');
  const screening = object(input.screening);
  if (!result.market_direction || !result.market_regime || !result.direction_probability || !result.model_confidence || !result.entry_environment_score
    || result.model_confidence.inputs.completeness <= 0 || result.model_confidence.inputs.freshness <= 0
    || result.entry_environment_score.inputs.evidence_quality <= 0
    || !result.market_risk_score || !text(input.reason_summary) || screening.status !== 'COMPLETE'
    || !numeric(screening.universe_count) || !Number.isInteger(screening.universe_count) || screening.universe_count <= 0
    || !references(screening.evidence_ids, evidence) || !Array.isArray(input.stock_opportunities)
    || !['EXTENDED', 'SELLOFF', 'NORMAL'].includes(text(input.price_state))) {
    result.issues.push('ASSESSMENT_INCOMPLETE'); return result;
  }
  const evaluated = input.stock_opportunities.map((o) => opportunity(o, evidence));
  result.rejected_opportunity_count = evaluated.filter((o) => !o).length;
  const unique = new Map<string, Opportunity>();
  for (const item of evaluated) {
    if (!item) continue;
    const existing = unique.get(item.symbol);
    if (!existing) { unique.set(item.symbol, item); continue; }
    // Conflicting duplicates fail closed, never cherry-pick the bullish record.
    if (existing.action !== item.action || existing.thesis !== item.thesis) {
      result.issues.push('CONFLICTING_SYMBOL_EVIDENCE'); return result;
    }
    existing.evidence = [...new Map([...existing.evidence, ...item.evidence].map((e) => [e.id, e])).values()];
    existing.invalidation_conditions = [...new Set([...existing.invalidation_conditions, ...item.invalidation_conditions])];
  }
  result.stock_opportunities = [...unique.values()];
  result.primary_catalysts = [...new Set(result.stock_opportunities.map(o => o.transmission.catalyst))];
  result.sector_impacts = [...new Set(result.stock_opportunities.map(o => `${o.transmission.sector}：${o.transmission.fundamental_explanation}`))];
  result.evidence_quality = result.rejected_opportunity_count === 0 ? 'complete' : 'insufficient';
  result.reason_summary = text(input.reason_summary);
  if (result.rejected_opportunity_count > 0) {
    result.action = 'INSUFFICIENT_DATA'; result.issues.push('OPPORTUNITY_EVIDENCE_INCOMPLETE');
    result.reason_summary = '部分候選的證據或失效條件尚未齊全；目前不能宣告沒有合格機會。';
  } else if (unique.size > 0 && result.stock_opportunities.every((o) => o.action === 'AVOID')) result.action = 'AVOID';
  else if (input.market_regime === 'RISK_OFF' || result.market_risk_score.value >= 70) result.action = 'DEFENSIVE';
  else if (input.price_state === 'EXTENDED') result.action = 'DO_NOT_CHASE';
  else if (unique.size === 0) result.action = 'NO_QUALIFIED_OPPORTUNITY';
  else if (result.model_confidence.value < 50) result.action = 'WAIT_FOR_CONFIRMATION';
  else if (result.entry_environment_score.value < 50) result.action = 'WAIT_FOR_PULLBACK';
  else if (result.stock_opportunities.every((o) => o.action === 'DO_NOT_CHASE' || o.action === 'AVOID')) result.action = 'DO_NOT_CHASE';
  else if (result.stock_opportunities.some((o) => o.action === 'ACTIVE_WATCH')) result.action = 'ACTIVE_WATCH';
  else result.action = 'WAIT_FOR_CONFIRMATION';
  // A company score cannot promote an entry that the market-level gate disallows.
  if (result.action === 'INSUFFICIENT_DATA') result.stock_opportunities = [];
  else if (['DO_NOT_CHASE', 'DEFENSIVE', 'WAIT_FOR_CONFIRMATION', 'WAIT_FOR_PULLBACK'].includes(result.action)) {
    result.stock_opportunities = result.stock_opportunities.map(o =>
      ['AVOID', 'DO_NOT_CHASE'].includes(o.action) ? o : { ...o, action: result.action });
  }
  return result;
}

export const ACTION_LABEL: Record<Action, string> = {
  ACTIVE_WATCH: '條件已確認，列入觀察', WAIT_FOR_PULLBACK: '等待較合理的進場條件',
  WAIT_FOR_CONFIRMATION: '等待證據確認', HOLD_WATCH: '維持觀察，不新增部位',
  DO_NOT_CHASE: '價格已偏熱，先不追高', DEFENSIVE: '先控風險，暫緩進場', AVOID: '避開已受損的劇本',
  NO_QUALIFIED_OPPORTUNITY: '今天沒有符合標準的新增機會', INSUFFICIENT_DATA: '評估尚未完成，先等待', NOT_APPLICABLE: '今日休市，等待下一個交易日',
};
export function actionTone(action: Action): 'green' | 'amber' | 'red' | 'blue' {
  return action === 'ACTIVE_WATCH' ? 'green' : action === 'AVOID' || action === 'DEFENSIVE' ? 'red' : action === 'NOT_APPLICABLE' ? 'blue' : 'amber';
}
