export const RUNTIME_QUALITY_POLICY = Object.freeze({
  version: 'MA_RUNTIME_POLICY_V1',
  premium_publish_min: 90,
  member_value_min: 90,
  high_quality_min: 90,
  publish_min: 80,
  auto_repair_min: 70,
  safe_mode_below: 70,
  confidence_high_min: 75,
  abstention_min_confidence: 55,
  abstention_min_coverage: 70,
  abstention_min_evidence: 3,
  daily_ai_call_budget: 20,
  daily_ai_token_budget: 120_000,
  max_recovery_attempts: 4,
});

export const PRODUCTION_DAY_CHECKPOINTS = Object.freeze([
  '0900',
  '0930',
  '1030',
  '1300',
  '1410',
  '1430',
]);

const CRITICAL_PRODUCTION_SOURCES = Object.freeze([
  'SPX',
  'SOX',
  'NVDA',
  'TSM',
  'TAIEX',
  '2330',
]);

export function simulateFullTradingDay(input = {}, policy = RUNTIME_QUALITY_POLICY) {
  const tradingDate = String(input.trading_date || '');
  const sourceStatus = input.source_status && typeof input.source_status === 'object'
    ? input.source_status
    : {};
  const missingCriticalSources = CRITICAL_PRODUCTION_SOURCES.filter(
    (source) => String(sourceStatus[source] ?? 'ready').toLowerCase() !== 'ready',
  );
  const txfStatus = String(sourceStatus.TXF ?? 'unavailable_entitlement');
  const contentScores = Array.isArray(input.content_scores) && input.content_scores.length > 0
    ? input.content_scores.map((value) => clamp(value, 0, 100))
    : [76, 92];
  const maxAttempts = Math.max(1, Math.trunc(finiteNumber(input.max_repair_attempts, policy.max_recovery_attempts)));
  const repairAttempts = [];
  let finalContentScore = 0;
  for (let index = 0; index < Math.min(contentScores.length, maxAttempts); index += 1) {
    finalContentScore = contentScores[index];
    repairAttempts.push({
      attempt: index + 1,
      content_score: finalContentScore,
      action: index === 0 ? 'evaluate_all_sections' : 'repair_failed_sections_only',
      eligible: finalContentScore >= policy.premium_publish_min,
    });
    if (finalContentScore >= policy.premium_publish_min) break;
  }
  const contentEligible = finalContentScore >= policy.premium_publish_min;
  const checkpoints = PRODUCTION_DAY_CHECKPOINTS.map((checkpoint, index) => ({
    checkpoint,
    state_rank: (index + 2) * 10,
    status: missingCriticalSources.length === 0 ? 'SUCCEEDED' : 'DEGRADED',
    immutable_snapshot_key: `${tradingDate}:intraday_or_close:${checkpoint}`,
  }));
  const reasonCodes = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) reasonCodes.push('invalid_simulation_date');
  if (missingCriticalSources.length > 0) reasonCodes.push('critical_source_missing');
  if (!contentEligible) reasonCodes.push('content_score_below_90');
  const go = reasonCodes.length === 0;
  return {
    contract_version: 'PRODUCTION_DAY_SIMULATION_V1',
    dry_run: true,
    trading_date: tradingDate,
    timezone: 'Asia/Taipei',
    result: go ? 'GO' : 'NO_GO',
    source_gate: {
      critical_sources: CRITICAL_PRODUCTION_SOURCES,
      missing_critical_sources: missingCriticalSources,
      important_sources: ['TXF'],
      txf_status: txfStatus,
      txf_blocks_publication: false,
    },
    premarket: {
      status: missingCriticalSources.length === 0 ? 'SUCCEEDED' : 'BLOCKED',
      decision_mode: missingCriticalSources.length === 0 ? 'recommendations_or_no_trade' : 'blocked',
      content_score: finalContentScore,
      premium_eligible: contentEligible && missingCriticalSources.length === 0,
      repair_attempts: repairAttempts,
    },
    checkpoints,
    delivery: {
      status: go ? 'SIMULATED_ELIGIBLE' : 'SIMULATED_BLOCKED',
      line_messages_sent: 0,
    },
    closing: {
      status: go ? 'SIMULATED_VERIFIED' : 'SIMULATED_DEGRADED',
      replayed_checkpoints: checkpoints.map((item) => item.checkpoint),
    },
    learning: {
      status: 'SIMULATED_ISOLATED',
      production_rules_mutated: false,
    },
    writes_performed: 0,
    notifications_sent: 0,
    reason_codes: reasonCodes,
  };
}

export function simulateHistoricalFailureMatrix(policy = RUNTIME_QUALITY_POLICY) {
  const definitions = [
    { name: 'normal_2026_08_17', trading_date: '2026-08-17', expected: 'GO', input: { content_scores: [93] } },
    { name: 'normal_2026_08_18', trading_date: '2026-08-18', expected: 'GO', input: { content_scores: [91] } },
    { name: 'normal_2026_08_19', trading_date: '2026-08-19', expected: 'GO', input: { content_scores: [78, 94] } },
    { name: 'incomplete_data_2026_08_20', trading_date: '2026-08-20', expected: 'NO_GO', input: { source_status: { TAIEX: 'missing' }, content_scores: [92] } },
    { name: 'api_failure_2026_08_21', trading_date: '2026-08-21', expected: 'NO_GO', input: { source_status: { SPX: 'api_error' }, content_scores: [92] } },
  ];
  const scenarios = definitions.map((definition) => {
    const simulation = simulateFullTradingDay({
      trading_date: definition.trading_date,
      ...definition.input,
    }, policy);
    const snapshotKeys = simulation.checkpoints.map((item) => item.immutable_snapshot_key);
    return {
      name: definition.name,
      trading_date: definition.trading_date,
      expected: definition.expected,
      actual: simulation.result,
      passed: simulation.result === definition.expected
        && new Set(snapshotKeys).size === PRODUCTION_DAY_CHECKPOINTS.length
        && simulation.notifications_sent === 0
        && simulation.writes_performed === 0,
      no_duplicate_snapshot: new Set(snapshotKeys).size === PRODUCTION_DAY_CHECKPOINTS.length,
      no_duplicate_notification: simulation.notifications_sent === 0,
      no_production_write: simulation.writes_performed === 0,
      reason_codes: simulation.reason_codes,
    };
  });
  return {
    contract_version: 'HISTORICAL_FAILURE_MATRIX_V1',
    result: scenarios.every((scenario) => scenario.passed) ? 'PASS' : 'FAIL',
    normal_day_count: scenarios.filter((scenario) => scenario.name.startsWith('normal_')).length,
    incomplete_day_count: scenarios.filter((scenario) => scenario.name.startsWith('incomplete_')).length,
    api_failure_count: scenarios.filter((scenario) => scenario.name.startsWith('api_failure_')).length,
    scenarios,
  };
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finiteNumber(value)));
}

function unique(values) {
  return Array.from(new Set((values || []).map(String).filter(Boolean)));
}

export function gradeContentScore(score, policy = RUNTIME_QUALITY_POLICY) {
  const normalized = clamp(score, 0, 100);
  if (normalized >= policy.high_quality_min) return 'high_quality';
  if (normalized >= policy.publish_min) return 'publish';
  if (normalized >= policy.auto_repair_min) return 'degraded';
  return 'reject';
}

export function resolveAbstentionDecision(input, policy = RUNTIME_QUALITY_POLICY) {
  const coverage = clamp(input?.coverage_score, 0, 100);
  const confidence = clamp(input?.confidence_score, 0, 100);
  const evidenceCount = Math.max(0, Math.trunc(finiteNumber(input?.evidence_count)));
  const missingCriticalSources = unique(input?.missing_critical_sources);
  const reasons = [];

  if (input?.is_trading_day === false) reasons.push('market_closed');
  if (coverage < policy.abstention_min_coverage) reasons.push('coverage_below_policy');
  if (confidence < policy.abstention_min_confidence) reasons.push('confidence_below_policy');
  if (evidenceCount < policy.abstention_min_evidence) reasons.push('evidence_below_policy');
  if (missingCriticalSources.length > 0) reasons.push('critical_source_missing');

  const shouldAbstain = reasons.length > 0;
  const evidenceBackedNoTrade = shouldAbstain
    && input?.is_trading_day !== false
    && evidenceCount >= policy.abstention_min_evidence
    && missingCriticalSources.length === 0;

  return {
    policy_version: policy.version,
    should_abstain: shouldAbstain,
    decision_mode: shouldAbstain ? (evidenceBackedNoTrade ? 'no_trade' : 'blocked') : 'recommendations',
    safe_mode: shouldAbstain && !evidenceBackedNoTrade,
    reason_codes: reasons,
    coverage_score: coverage,
    confidence_score: confidence,
    evidence_count: evidenceCount,
  };
}

export function classifyMarketRegime(input) {
  const trend = clamp(input?.trend_score, -100, 100);
  const volatility = clamp(input?.volatility_score, 0, 100);
  const liquidity = clamp(input?.liquidity_score, 0, 100);
  const breadth = clamp(input?.breadth_score, -100, 100);

  if (volatility >= 75 || liquidity <= 25) return 'stress';
  if (Math.abs(trend) <= 20 && volatility >= 55) return 'volatile_range';
  if (trend >= 35 && breadth >= 15) return 'risk_on_trend';
  if (trend <= -35 && breadth <= -15) return 'risk_off_trend';
  return 'range';
}

export function buildBullBearDebate(input) {
  const support = unique(input?.supporting_evidence);
  const counter = unique(input?.counter_evidence);
  const confidence = clamp(input?.confidence_score, 0, 100);
  const regime = String(input?.market_regime || 'unknown');
  const evidenceDelta = support.length - counter.length;
  const abstain = input?.abstention?.should_abstain === true;

  let verdict = 'neutral';
  if (!abstain && evidenceDelta >= 2 && confidence >= 60) verdict = 'bull';
  if (!abstain && evidenceDelta <= -2 && confidence >= 60) verdict = 'bear';

  return {
    contract_version: 'BULL_BEAR_DEBATE_V1',
    bull_case: support,
    bear_case: counter,
    market_regime: regime,
    verdict: abstain ? 'abstain' : verdict,
    confidence_score: confidence,
    disagreement_score: clamp(50 - Math.abs(evidenceDelta) * 10, 0, 100),
    reason_codes: abstain ? unique(input?.abstention?.reason_codes) : [],
  };
}

function overlapScore(left, right) {
  const a = new Set(unique(left));
  const b = new Set(unique(right));
  if (a.size === 0 && b.size === 0) return 1;
  const union = new Set([...a, ...b]);
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return union.size === 0 ? 0 : intersection / union.size;
}

export function computeHistoricalSimilarity(target, candidate) {
  const regime = String(target?.market_regime || '') === String(candidate?.market_regime || '') ? 1 : 0;
  const confidence = 1 - Math.min(1, Math.abs(finiteNumber(target?.confidence_score) - finiteNumber(candidate?.confidence_score)) / 100);
  const market = 1 - Math.min(1, Math.abs(finiteNumber(target?.market_score) - finiteNumber(candidate?.market_score)) / 100);
  const sectors = overlapScore(target?.sectors, candidate?.sectors);
  const risks = overlapScore(target?.risk_flags, candidate?.risk_flags);
  return Math.round(clamp((regime * 0.3 + confidence * 0.2 + market * 0.2 + sectors * 0.2 + risks * 0.1) * 100, 0, 100) * 100) / 100;
}

export function resolveCostGuardrail(usage, policy = RUNTIME_QUALITY_POLICY) {
  const calls = Math.max(0, Math.trunc(finiteNumber(usage?.calls)));
  const tokens = Math.max(0, Math.trunc(finiteNumber(usage?.tokens)));
  const reasons = [];
  if (calls >= policy.daily_ai_call_budget) reasons.push('daily_ai_call_budget_exhausted');
  if (tokens >= policy.daily_ai_token_budget) reasons.push('daily_ai_token_budget_exhausted');
  return {
    policy_version: policy.version,
    allowed: reasons.length === 0,
    safe_mode: reasons.length > 0,
    calls,
    tokens,
    remaining_calls: Math.max(0, policy.daily_ai_call_budget - calls),
    remaining_tokens: Math.max(0, policy.daily_ai_token_budget - tokens),
    reason_codes: reasons,
  };
}

export function buildRetryDecision(input, policy = RUNTIME_QUALITY_POLICY) {
  const attempt = Math.max(1, Math.trunc(finiteNumber(input?.attempt, 1)));
  const maxAttempts = Math.max(1, Math.trunc(finiteNumber(input?.max_attempts, policy.max_recovery_attempts)));
  const retryable = input?.retryable !== false;
  const deadLetter = !retryable || attempt >= maxAttempts;
  const baseDelay = Math.max(5, Math.trunc(finiteNumber(input?.base_delay_seconds, 30)));
  return {
    attempt,
    max_attempts: maxAttempts,
    retryable: retryable && !deadLetter,
    dead_letter: deadLetter,
    retry_after_seconds: deadLetter ? null : Math.min(900, baseDelay * 2 ** Math.max(0, attempt - 1)),
    reason_code: deadLetter ? 'retry_budget_exhausted' : 'retry_scheduled',
  };
}
export const DAILY_LIFECYCLE_RANKS = Object.freeze({
  SCHEDULED: 0,
  PREMARKET_CAPTURED: 10,
  REPORT_GENERATED: 20,
  EDITORIAL_APPROVED: 30,
  PREMARKET_DELIVERED: 40,
  MARKET_OPEN_CAPTURED: 50,
  CHECKPOINT_0930_CAPTURED: 60,
  CHECKPOINT_1030_CAPTURED: 70,
  CHECKPOINT_1300_CAPTURED: 80,
  CLOSE_1410_CAPTURED: 90,
  CLOSE_1430_CAPTURED: 100,
  CLOSING_VERIFIED: 110,
  FEEDBACK_COMPLETED: 120,
  LEARNING_COMPLETED: 130,
  HEALTH_AUDITED: 140,
  DAY_COMPLETED: 150,
});

export function resolveLifecycleTransition(currentState, requestedState) {
  const currentRank = DAILY_LIFECYCLE_RANKS[currentState];
  const requestedRank = DAILY_LIFECYCLE_RANKS[requestedState];
  if (!Number.isInteger(requestedRank)) return { allowed: false, reason_code: 'INVALID_STATE' };
  if (Number.isInteger(currentRank) && requestedRank < currentRank) return { allowed: false, reason_code: 'STATE_RANK_REGRESSION_BLOCKED' };
  return { allowed: true, reason_code: requestedRank === currentRank ? 'IDEMPOTENT_REPLAY' : 'STATE_ADVANCE' };
}

export function buildRuntimeIdempotencyKey({ trading_date, job_name, checkpoint, revision = 'canonical' } = {}) {
  const parts = [trading_date, job_name, checkpoint, revision].map((value) => String(value || '').trim());
  if (parts.some((value) => !value)) throw new Error('IDEMPOTENCY_KEY_INPUT_INCOMPLETE');
  return parts.join(':');
}

export function resolvePrimaryBackupDecision(input = {}) {
  if (input.completed === true) return { execute: false, status: 'SKIPPED_ALREADY_SUCCEEDED' };
  if (input.in_flight === true && input.lease_expires_at && Date.parse(input.lease_expires_at) > Date.parse(input.now || new Date().toISOString())) {
    return { execute: false, status: 'SKIPPED_ACTIVE_LEASE' };
  }
  if (input.role === 'backup' && input.primary_timed_out !== true && input.primary_failed !== true) {
    return { execute: false, status: 'SKIPPED_PRIMARY_STILL_ELIGIBLE' };
  }
  return { execute: true, status: input.role === 'backup' ? 'WATCHDOG_TAKEOVER' : 'PRIMARY_EXECUTION' };
}

export function reconcileHttpReceipt(input = {}) {
  const status = Math.trunc(finiteNumber(input.http_status));
  const businessSuccess = input.payload?.success === true || input.payload?.ok === true;
  if (status >= 200 && status < 300 && businessSuccess) return { status: 'SUCCEEDED', retryable: false, dead_letter: false };
  if (status === 401 || status === 403) return { status: 'DEAD_LETTERED', retryable: false, dead_letter: true };
  if (input.timed_out === true) return { status: 'TIMED_OUT', retryable: true, dead_letter: false };
  if (status === 409) return { status: 'FAILED', retryable: input.gate_can_recover === true, dead_letter: false };
  if (status === 429 || status >= 500) return { status: 'FAILED', retryable: true, dead_letter: false };
  return { status: 'FAILED', retryable: false, dead_letter: true };
}

function normalizedTokens(value) {
  const text = String(value || '').toLowerCase();
  const words = text.replace(/[\p{Script=Han}]/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter((token) => token.length >= 2);
  const han = (text.match(/[\p{Script=Han}]+/gu) || []).flatMap((segment) => {
    if (segment.length < 2) return [];
    return Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2));
  });
  return unique([...words, ...han]);
}

export function evaluateSemanticCoherenceGate(input = {}) {
  const primary = normalizedTokens(input.primary_thesis);
  const sections = (input.sections || []).map(normalizedTokens).filter((tokens) => tokens.length > 0);
  const contradictions = unique(input.contradictions);
  const incoherent = primary.length === 0 || sections.some((tokens) => overlapScore(primary, tokens) === 0);
  return {
    eligible: !incoherent && contradictions.length === 0,
    contradiction_count: contradictions.length + (incoherent ? 1 : 0),
    reason_codes: [...(incoherent ? ['PRIMARY_THESIS_DIVERGENCE'] : []), ...(contradictions.length ? ['SEMANTIC_CONTRADICTION'] : [])],
  };
}

export function evaluatePublicPremiumLeakageGate(input = {}) {
  const publicSymbols = new Set(unique(input.public_symbols).map((value) => value.toUpperCase()));
  const premiumOnly = new Set(unique(input.premium_only_symbols).map((value) => value.toUpperCase()));
  const leakedSymbols = [...publicSymbols].filter((value) => premiumOnly.has(value));
  const forbiddenFields = unique(input.public_fields).filter((field) => ['confirmation','invalidation','premium_reasoning','source_refs'].includes(field));
  const publicEntities = unique(input.public_entities);
  const premiumEntities = unique(input.premium_entities);
  const entityOverlap = publicEntities.length === 0 || premiumEntities.length === 0 ? 0 : overlapScore(publicEntities, premiumEntities);
  const threshold = finiteNumber(input.max_entity_overlap, 0.8);
  return {
    eligible: leakedSymbols.length === 0 && forbiddenFields.length === 0 && entityOverlap <= threshold,
    leaked_symbols: leakedSymbols,
    leaked_fields: forbiddenFields,
    named_entity_overlap: entityOverlap,
    reason_codes: [...(leakedSymbols.length ? ['PREMIUM_SYMBOL_LEAKAGE'] : []), ...(forbiddenFields.length ? ['PREMIUM_REASONING_LEAKAGE'] : []), ...(entityOverlap > threshold ? ['ENTITY_OVERLAP_EXCEEDED'] : [])],
  };
}

export function classifyMutationCounters(beforeRows = [], afterRows = [], keyOf = (row) => row?.id) {
  const before = new Map(beforeRows.map((row) => [String(keyOf(row)), JSON.stringify(row)]));
  const after = new Map(afterRows.map((row) => [String(keyOf(row)), JSON.stringify(row)]));
  let created = 0; let updated = 0; let unchanged = 0;
  for (const [key, value] of after) {
    if (!before.has(key)) created += 1;
    else if (before.get(key) === value) unchanged += 1;
    else updated += 1;
  }
  return { created_count: created, updated_count: updated, unchanged_count: unchanged };
}

export function resolvePendingHorizon({ report_date, target_date, horizon_trading_days, trading_days = [] } = {}) {
  const index = trading_days.indexOf(report_date);
  if (index < 0) return { status: 'insufficient', reason_code: 'REPORT_DATE_NOT_IN_CALENDAR' };
  const maturity = trading_days[index + Math.max(1, Math.trunc(finiteNumber(horizon_trading_days, 1)))];
  if (!maturity || target_date < maturity) return { status: 'pending', maturity_date: maturity || null };
  return { status: 'matured', maturity_date: maturity };
}

export function validateClosingWindowData(rows = [], options = {}) {
  const required = unique(options.required_symbols || ['TAIEX', '2330', 'TXF']);
  const tradingDate = String(options.trading_date || '');
  const min = Date.parse(options.window_start || `${tradingDate}T14:00:00+08:00`);
  const max = Date.parse(options.window_end || `${tradingDate}T14:40:00+08:00`);
  const validSymbols = new Set();
  const rejected = [];
  for (const row of rows) {
    const captured = Date.parse(row?.captured_at || '');
    const symbol = String(row?.symbol || '').toUpperCase().replace(/^TWSE:/, '').replace(/\.TW$/, '');
    if (row?.trading_date !== tradingDate || row?.phase !== 'close' || !Number.isFinite(captured) || captured < min || captured > max) rejected.push(symbol || 'UNKNOWN');
    else validSymbols.add(symbol);
  }
  const missing = required.map((value) => value.toUpperCase()).filter((value) => !validSymbols.has(value));
  return { valid: missing.length === 0, missing_symbols: missing, rejected_symbols: unique(rejected), no_intraday_fallback: true };
}
