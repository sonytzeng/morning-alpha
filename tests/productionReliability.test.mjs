import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAILY_LIFECYCLE_RANKS,
  buildCanonicalDecisionContract,
  buildCanonicalMemberResearchRevision,
  buildRuntimeIdempotencyKey,
  classifyRuntimeFailure,
  classifyMutationCounters,
  evaluateCanonicalSemanticCoherenceGate,
  evaluatePublicPremiumLeakageGate,
  evaluateSemanticCoherenceGate,
  reconcileHttpReceipt,
  resolveCanonicalDataQuality,
  resolveLifecycleTransition,
  resolvePendingHorizon,
  resolvePrimaryBackupDecision,
  simulateHistoricalFailureMatrix,
  validateClosingWindowData,
} from '../supabase/functions/_shared/production-architecture-core.mjs';
import {
  INTERNAL_AUTH_ERROR_CODES,
  authorizeInternalRequest,
  buildInternalFunctionHeaders,
  parseBearerAuthorizationHeader,
} from '../supabase/functions/_shared/internal-function-auth.mjs';

const headers = (values = {}) => ({ get: (name) => values[name.toLowerCase()] || null });
const credentials = {
  currentToken: 'current-secret',
  previousToken: 'previous-secret',
  previousExpiresAt: '2026-08-28T00:00:00.000Z',
  version: 'v1',
};

test('internal auth returns stable missing/invalid/version/expired codes and supports rotation window', async () => {
  assert.equal((await authorizeInternalRequest(headers(), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.MISSING);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'wrong' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.INVALID);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'current-secret', 'x-internal-auth-version': 'v2' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.VERSION_MISMATCH);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'current-secret' }), credentials)).ok, true);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'previous-secret' }), credentials, new Date('2026-08-27T00:00:00Z'))).ok, true);
  assert.equal((await authorizeInternalRequest(headers({ 'x-cron-secret': 'previous-secret' }), credentials, new Date('2026-08-29T00:00:00Z'))).error_code, INTERNAL_AUTH_ERROR_CODES.EXPIRED);
  assert.equal((await authorizeInternalRequest(headers({ authorization: 'Bearer current-secret' }), credentials)).ok, true);
  assert.equal((await authorizeInternalRequest(headers({ authorization: 'Basic current-secret' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.INVALID);
  assert.equal((await authorizeInternalRequest(headers({ authorization: 'Bearer   ' }), credentials)).error_code, INTERNAL_AUTH_ERROR_CODES.INVALID);
});

test('Bearer parser rejects missing, wrong-scheme, empty, and malformed credentials without echoing tokens', () => {
  assert.equal(parseBearerAuthorizationHeader('').error_code, INTERNAL_AUTH_ERROR_CODES.MISSING);
  for (const invalid of ['Basic abc', 'Bearer', 'Bearer   ', 'Bearer one two']) {
    const result = parseBearerAuthorizationHeader(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, INTERNAL_AUTH_ERROR_CODES.INVALID);
    assert.equal(JSON.stringify(result).includes('abc'), false);
  }
  assert.deepEqual(parseBearerAuthorizationHeader('  Bearer token-value  '), { ok: true, token: 'token-value', error_code: null });
});

test('internal outbound headers follow the active auth version without using bearer service credentials', () => {
  const outbound = buildInternalFunctionHeaders({ cronSecret: 'current-secret', serviceRoleKey: 'service-key', version: 'v2', source: 'test' });
  assert.equal(outbound['x-internal-auth-version'], 'v2');
  assert.equal(outbound.apikey, 'service-key');
  assert.equal(outbound.Authorization, undefined);
});

test('daily lifecycle is monotonic and contains all sixteen production states', () => {
  assert.equal(Object.keys(DAILY_LIFECYCLE_RANKS).length, 16);
  assert.deepEqual(resolveLifecycleTransition('CLOSING_VERIFIED', 'LEARNING_COMPLETED'), { allowed: true, reason_code: 'STATE_ADVANCE' });
  assert.deepEqual(resolveLifecycleTransition('LEARNING_COMPLETED', 'CLOSING_VERIFIED'), { allowed: false, reason_code: 'STATE_RANK_REGRESSION_BLOCKED' });
  assert.equal(resolveLifecycleTransition('LEARNING_COMPLETED', 'LEARNING_COMPLETED').reason_code, 'IDEMPOTENT_REPLAY');
});

test('runtime idempotency keys are stable and reject incomplete input', () => {
  const input = { trading_date: '2026-08-27', job_name: 'runtime_checkpoint', checkpoint: '0930' };
  assert.equal(buildRuntimeIdempotencyKey(input), buildRuntimeIdempotencyKey(input));
  assert.throws(() => buildRuntimeIdempotencyKey({ trading_date: '2026-08-27' }), /INCOMPLETE/);
});

test('backup is watchdog-only and respects success plus active leases', () => {
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', completed: true }).status, 'SKIPPED_ALREADY_SUCCEEDED');
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', in_flight: true, lease_expires_at: '2026-08-27T10:10:00Z', now: '2026-08-27T10:00:00Z' }).status, 'SKIPPED_ACTIVE_LEASE');
  assert.equal(resolvePrimaryBackupDecision({ role: 'backup', primary_timed_out: true }).status, 'WATCHDOG_TAKEOVER');
});

test('HTTP receipts distinguish queueing from business success and bound retries', () => {
  assert.equal(reconcileHttpReceipt({ http_status: 200, payload: { success: true } }).status, 'SUCCEEDED');
  assert.equal(reconcileHttpReceipt({ http_status: 200, payload: { success: false } }).status, 'FAILED');
  for (const status of [401, 403]) assert.equal(reconcileHttpReceipt({ http_status: status }).dead_letter, true);
  assert.equal(reconcileHttpReceipt({ http_status: 409, gate_can_recover: true }).retryable, true);
  assert.equal(reconcileHttpReceipt({ http_status: 429 }).retryable, true);
  assert.equal(reconcileHttpReceipt({ http_status: 500 }).retryable, true);
  assert.equal(reconcileHttpReceipt({ timed_out: true }).status, 'TIMED_OUT');
});

test('runtime failure classifier separates auth, quality, transient, permanent, and duplicate outcomes', () => {
  assert.deepEqual(classifyRuntimeFailure({ http_status: 401 }), { error_class: 'AUTH', retryable: false, dead_letter: true });
  assert.deepEqual(classifyRuntimeFailure({ http_status: 409 }), { error_class: 'QUALITY_BLOCK', retryable: false, dead_letter: false });
  assert.equal(classifyRuntimeFailure({ http_status: 409, input_revision_changed: true }).retryable, true);
  assert.equal(classifyRuntimeFailure({ http_status: 429 }).error_class, 'TRANSIENT');
  assert.equal(classifyRuntimeFailure({ http_status: 503 }).error_class, 'TRANSIENT');
  assert.equal(classifyRuntimeFailure({ timed_out: true }).error_class, 'TRANSIENT');
  assert.equal(classifyRuntimeFailure({ http_status: 422 }).error_class, 'PERMANENT');
  assert.equal(classifyRuntimeFailure({ idempotent_replay: true }).error_class, 'DUPLICATE');
});

test('runtime orchestration fails closed for pending close evidence and incomplete learning', () => {
  const orchestrator = readFileSync(new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url), 'utf8');
  const learning = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const recovery = readFileSync(new URL('../supabase/functions/ma-ops-safe-recovery/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(orchestrator, /payload\.pending === true|payload\.skipped === true\s*\|\|/);
  assert.match(orchestrator, /String\(payload\.data_status \|\| ''\) === 'ready'/);
  assert.match(orchestrator, /result\.payload\.skipped !== true && result\.payload\.degraded !== true/);
  assert.match(orchestrator, /body\.source === 'supabase_cron_watchdog'/);
  assert.doesNotMatch(orchestrator, /source: 'supabase_cron_backup'/);
  assert.match(learning, /existingRun && String\(existingRun\.status\) === 'succeeded'/);
  assert.match(recovery, /retry_closing_health/);
  assert.match(recovery, /source: 'ma-ops-safe-recovery'/);
  assert.match(orchestrator, /body\.source === 'ma-ops-safe-recovery'/);
  assert.match(orchestrator, /p_state: 'HEALTH_AUDITED'/);
  assert.match(orchestrator, /p_state: 'DAY_COMPLETED'/);
});

test('semantic coherence rejects divergent primary theses and contradictions', () => {
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運 陽明', sections: ['油價傳導航運與陽明'], contradictions: [] }).eligible, true);
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運 陽明', sections: ['Nvidia 半導體 台積電'], contradictions: [] }).eligible, false);
  assert.equal(evaluateSemanticCoherenceGate({ primary_thesis: '油價 航運', sections: ['油價 航運'], contradictions: ['data_quality'] }).eligible, false);
});

test('public projection blocks premium symbols, reasoning fields, and excessive entity overlap', () => {
  assert.equal(evaluatePublicPremiumLeakageGate({ public_symbols: ['2609'], premium_only_symbols: ['2330'] }).eligible, true);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_symbols: ['2330'], premium_only_symbols: ['2330'] }).eligible, false);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_fields: ['confirmation'] }).eligible, false);
  assert.equal(evaluatePublicPremiumLeakageGate({ public_entities: ['油價','航運'], premium_entities: ['油價','航運'], max_entity_overlap: 0.5 }).eligible, false);
});

test('canonical quality is monotonic and never upgrades partial to complete', () => {
  assert.equal(resolveCanonicalDataQuality(['complete', 'partial', 'sufficient']), 'partial');
  assert.equal(resolveCanonicalDataQuality(['complete', 'degraded']), 'degraded');
  assert.equal(resolveCanonicalDataQuality([]), 'insufficient');
});

test('canonical decision contract keeps only the primary recommendation theme', () => {
  const snapshot = {
    id: 'snapshot-1', report_date: '2026-08-27', version: 3, action: 'SELECTIVE',
    generated_text: {
      daily_sentence: 'oil 先傳導至航運，09:30 驗證陽明。', next_checkpoint: '09:30',
      recommendations: [
        { symbol: '2609', sector: '航運', event_source: 'oil', transmission_path: 'oil → 航運 → 2609', confirmation_condition: '09:30 航運同步', invalidation_condition: '航運未同步', source_refs: ['NEWS002'] },
        { symbol: '2615', sector: '航運', event_source: 'oil', transmission_path: 'oil → 航運 → 2615', confirmation_condition: '09:30 航運同步', invalidation_condition: '航運未同步', source_refs: ['NEWS002'] },
        { symbol: '2882', sector: '金融', event_source: 'US10Y', transmission_path: 'US10Y → 金融 → 2882', confirmation_condition: '金融抗跌', invalidation_condition: '金融轉弱', source_refs: ['NEWS001'] },
      ],
    },
  };
  const contract = buildCanonicalDecisionContract({ report_date: '2026-08-27', snapshot, ai: { data_quality: 'complete', v10_data_quality_status: 'partial', member_research_note_v2: { data_status: 'partial' } } });
  assert.deepEqual(contract.primary_symbols, ['2609', '2615']);
  assert.equal(contract.primary_event, 'oil');
  assert.equal(contract.primary_taiwan_theme, '航運');
  assert.equal(contract.data_quality_status, 'partial');
});

test('canonical contract drops absent optional signals instead of serializing undefined', () => {
  const snapshot = {
    id: 'snapshot-missing-value-guard', report_date: '2026-08-27', version: 4, action: 'WAIT',
    generated_text: {
      daily_sentence: 'oil 先傳導至航運。', next_checkpoint: '09:30',
      recommendations: [
        {
          symbol: '2609', name: '陽明', sector: '航運', event_source: 'oil',
          transmission_path: 'oil → 航運 → 2609', confirmation_condition: '09:30 航運同步',
          confirmation: undefined, validation_signal: null, watch_point: '',
          invalidation_condition: '航運未同步', invalidation: undefined,
          stop_condition: null, stop_observing_condition: '', source_refs: ['NEWS002'],
        },
      ],
    },
  };
  const contract = buildCanonicalDecisionContract({ report_date: '2026-08-27', snapshot, ai: { data_quality: 'partial' } });
  const member = buildCanonicalMemberResearchRevision({ canonical_contract: contract, snapshot, ai: {} });
  assert.deepEqual(contract.validation_signals, ['09:30 航運同步']);
  assert.deepEqual(contract.invalidation_conditions, ['航運未同步']);
  assert.doesNotMatch(JSON.stringify({ contract, member }), /undefined/);
});

test('Content OS public reason reuses canonical supply-chain evidence when no display reason exists', () => {
  const source = readFileSync(new URL('../supabase/functions/content-os-morning-alpha-source/index.ts', import.meta.url), 'utf8');
  assert.match(source, /publicTopicSource\.taiwan_supply_chain_relation/);
  assert.doesNotMatch(source, /可能影響|受惠於|有利於|預期轉強/);
});

test('canonical member revision removes unrelated primary themes without inventing evidence', () => {
  const snapshot = {
    id: 'snapshot-1', report_date: '2026-08-27', version: 3, action: 'SELECTIVE',
    generated_text: {
      daily_sentence: 'oil 先傳導至航運，09:30 驗證陽明。', next_checkpoint: '09:30',
      recommendations: [
        { symbol: '2609', sector: '航運', event_source: 'oil', transmission_path: 'oil → 航運 → 2609', confirmation_condition: '09:30 航運同步', invalidation_condition: '航運未同步', source_refs: ['NEWS002'] },
        { symbol: '2882', sector: '金融', event_source: 'US10Y', transmission_path: 'US10Y → 金融 → 2882', confirmation_condition: '金融抗跌', invalidation_condition: '金融轉弱', source_refs: ['NEWS001'] },
      ],
    },
  };
  const contract = buildCanonicalDecisionContract({ report_date: '2026-08-27', snapshot, ai: { data_quality: 'partial' } });
  const member = buildCanonicalMemberResearchRevision({ canonical_contract: contract, snapshot, ai: { member_research_note_v2: { today_core_thesis: 'NVIDIA → 半導體' } } });
  assert.equal(member.today_core_thesis, snapshot.generated_text.daily_sentence);
  assert.deepEqual(member.beneficiary_candidates.map((item) => item.symbol), ['2609']);
  assert.doesNotMatch(JSON.stringify(member), /NVIDIA|半導體|2882/);
});

test('canonical semantic gate blocks mixed shipping, semiconductor, and finance themes', () => {
  const contract = {
    report_date: '2026-08-27', snapshot_id: 'snapshot-1', snapshot_version: 2,
    primary_event: 'oil', primary_causal_chain: ['oil', '航運', '2609'], primary_taiwan_theme: '航運',
    primary_symbols: ['2609'], validation_checkpoint: '09:30', validation_signals: ['航運同步'],
    invalidation_conditions: ['航運未同步'], action: 'SELECTIVE', data_quality_status: 'partial', evidence_refs: ['NEWS002'],
  };
  const blocked = evaluateCanonicalSemanticCoherenceGate({
    canonical_contract: contract,
    sections: { public_thesis: 'oil 航運 2609', member_thesis: 'NVIDIA 半導體 台積電', taiwan_transmission: '利率 金融 富邦金' },
    recommendations: [{ symbol: '2330', sector: '半導體' }],
    quality_inputs: ['partial', 'complete'],
    quality_counters: {}, evidence_coverage: 100, content_score: 100, checked_at: '2026-08-27T00:00:00Z',
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.reason_codes.includes('PRIMARY_THESIS_DIVERGENCE'));
  assert.ok(blocked.reason_codes.includes('RECOMMENDATION_OUTSIDE_CANONICAL_THESIS'));
  const passed = evaluateCanonicalSemanticCoherenceGate({
    canonical_contract: contract,
    sections: { public_thesis: 'oil 航運 2609', member_thesis: 'oil 航運 2609', taiwan_transmission: 'oil 航運 2609' },
    recommendations: [{ symbol: '2609', sector: '航運' }],
    quality_inputs: ['partial'],
    quality_counters: {}, evidence_coverage: 100, content_score: 100, checked_at: '2026-08-27T00:00:00Z',
  });
  assert.equal(passed.status, 'PASSED');
});

test('canonical semantic gate accepts an evidence-backed explicit no-trade decision', () => {
  const snapshot = {
    id: 'snapshot-stop', report_date: '2026-08-31', version: 7, action: 'STOP',
    source_refs: [{ title: 'SOX and TSM evidence', url: 'https://example.com/evidence' }],
    generated_text: {
      daily_sentence: '隔夜訊號未形成正向主線，今日不建立受惠股。',
      next_checkpoint: '09:30',
      reasons: ['09:30 只確認 TAIEX 與 2330 是否同步止跌。'],
      recommendations: [],
    },
  };
  const ai = { data_quality: 'degraded', v10_data_quality_status: 'insufficient_positive_evidence' };
  const contract = buildCanonicalDecisionContract({ report_date: '2026-08-31', snapshot, ai });
  const member = buildCanonicalMemberResearchRevision({ canonical_contract: contract, snapshot, ai });
  assert.equal(contract.primary_event, snapshot.generated_text.daily_sentence);
  assert.deepEqual(contract.primary_symbols, []);
  assert.ok(contract.validation_signals.length > 0);
  const passed = evaluateCanonicalSemanticCoherenceGate({
    canonical_contract: contract,
    sections: {
      public_thesis: snapshot.generated_text.daily_sentence,
      member_thesis: member.today_core_thesis,
      taiwan_transmission: member.taiwan_transmission,
      line_summary: member.line_summary,
      content_os_topic: member.content_os_topic,
    },
    recommendations: member.beneficiary_candidates,
    quality_inputs: ['degraded', 'insufficient_positive_evidence'],
    quality_counters: {}, evidence_coverage: 100, content_score: 100,
    checked_at: '2026-08-31T00:00:00Z',
  });
  assert.equal(passed.status, 'PASSED');
});

test('CLE counters count real inserts, updates, and unchanged entities', () => {
  const before = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
  const after = [{ id: 'a', value: 1 }, { id: 'b', value: 3 }, { id: 'c', value: 4 }];
  assert.deepEqual(classifyMutationCounters(before, after), { created_count: 1, updated_count: 1, unchanged_count: 1 });
  assert.deepEqual(classifyMutationCounters(after, after), { created_count: 0, updated_count: 0, unchanged_count: 3 });
});

test('pending horizons use trading-day calendar rather than natural days', () => {
  const days = ['2026-08-27','2026-08-28','2026-08-31','2026-09-01','2026-09-02','2026-09-03'];
  assert.equal(resolvePendingHorizon({ report_date: days[0], target_date: days[1], horizon_trading_days: 3, trading_days: days }).status, 'pending');
  assert.equal(resolvePendingHorizon({ report_date: days[0], target_date: days[3], horizon_trading_days: 3, trading_days: days }).status, 'matured');
});

test('closing validation rejects missing, stale, wrong-date, and intraday data', () => {
  const rows = ['TAIEX','2330','TXF'].map((symbol) => ({ symbol, trading_date: '2026-08-27', phase: 'close', captured_at: '2026-08-27T14:20:00+08:00' }));
  assert.equal(validateClosingWindowData(rows, { trading_date: '2026-08-27' }).valid, true);
  assert.equal(validateClosingWindowData(rows.slice(0, 2), { trading_date: '2026-08-27' }).valid, false);
  assert.equal(validateClosingWindowData(rows.map((row) => ({ ...row, phase: 'intraday' })), { trading_date: '2026-08-27' }).valid, false);
  assert.equal(validateClosingWindowData(rows.map((row) => ({ ...row, captured_at: '2026-08-27T13:00:00+08:00' })), { trading_date: '2026-08-27' }).valid, false);
});

test('daily delivery phases use separate durable receipts through the public 07:30 deadline', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260827084613_production_reliability_daily_lifecycle.sql', import.meta.url), 'utf8');
  for (const phase of ['refresh', 'generate', 'repair', 'deliver', 'watchdog']) {
    assert.match(sql, new RegExp(`daily-\\w+-.*invoke_daily_delivery_tick_v2\\('${phase}'`));
    assert.match(sql, new RegExp(`'daily_'\\|\\|p_phase`));
  }
  assert.match(sql, /morning-alpha-daily-deliver-primary','23 23/);
  assert.match(sql, /morning-alpha-daily-deliver-watchdog','27 23/);
  assert.match(sql, /morning-alpha-daily-deadline-primary','30 23/);
  assert.match(sql, /morning-alpha-daily-deadline-watchdog','35 23/);
  assert.match(sql, /update public\.trading_day_state/);
  assert.match(sql, /when 'LEARNING_COMPLETED' then 130/);
});

test('historical replay stays isolated from production writes and notifications', () => {
  const result = simulateHistoricalFailureMatrix();
  assert.equal(result.result, 'PASS');
  assert.equal(result.scenarios.length, 5);
  assert.ok(result.scenarios.every((scenario) => scenario.no_production_write && scenario.no_duplicate_notification));
});

test('migration enforces receipts, RLS, idempotency, state monotonicity and isolated replay', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260827084613_production_reliability_daily_lifecycle.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'runtime_http_dispatches', 'runtime_http_dispatch_attempts', 'runtime_lifecycle_events', 'runtime_replay_artifacts',
    'force row level security', 'security_invoker=true', 'STATE_RANK_REGRESSION_BLOCKED', 'net._http_response',
    "status in ('PENDING','PROCESSING','SENT','FAILED','DEAD_LETTERED')", 'production_writes = 0', 'notifications_sent = 0',
    "when 'SCHEDULED' then 0 when 'RUNNING' then 1 when 'FAILED' then 2",
    'coalesce(v_response.timed_out,false)',
    'report_status', 'editorial_status', 'premium_status', 'line_status', 'content_os_status',
    'closing_status', 'learning_status', 'next_scheduled_at', 'recovery_executed',
    "v_success and v_row.job_name='closing_health'", "'HEALTH_AUDITED'", "'DAY_COMPLETED'",
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(sql, /service_role_key|cron_secret\s*[:=]\s*['"][^'"]+/i);
});

test('semantic reliability migration is append-only, fail-closed, and service-role isolated', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260827153000_semantic_content_reliability.sql', import.meta.url), 'utf8');
  for (const fragment of [
    'member_content_revisions', 'semantic_coherence_reviews', 'content_os_sync_incidents',
    'learning_metric_corrections', 'production_acceptance_results', 'force row level security',
    'publish_member_content_revision_v1', 'record_content_os_incident_v1',
    'record_learning_metric_correction_v1', 'capture_morning_alpha_acceptance_v1',
    'pg_advisory_xact_lock', 'on conflict (idempotency_key) do nothing',
    'morning-alpha-acceptance-primary', 'morning-alpha-acceptance-watchdog',
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.match(sql, /revoke all on public\.member_content_revisions[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /update\s+public\.member_content_revisions|delete\s+from\s+public\.member_content_revisions/i);
  assert.doesNotMatch(sql, /service_role_key|cron_secret\s*[:=]\s*['"][^'"]+/i);
});

test('terminal recovery reconciles only after durable success and captures fresh acceptance', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260830090000_reconcile_acceptance_and_replay_idempotency.sql', import.meta.url), 'utf8');
  const orchestrator = readFileSync(new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url), 'utf8');
  for (const fragment of [
    'reconcile_runtime_terminal_failures_v1', 'DAY_COMPLETED', 'SEMANTIC_NOT_PASSED',
    'CONTENT_OS_NOT_HEALTHY', 'DEAD_LETTER_PRESENT', 'PREMARKET_HEALTH_MISSING',
    'CLOSING_HEALTH_MISSING', 'SUPERSEDED_BY_DURABLE_STATE', 'runtime_lifecycle_events',
  ]) assert.match(sql, new RegExp(fragment, 'i'));
  assert.match(sql, /where trading_date = p_business_date[\s\S]+dispatch_status = 'FAILED'/i);
  assert.match(sql, /revoke all on function public\.reconcile_runtime_terminal_failures_v1[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /update\s+public\.(reports|decision_snapshots|editorial_reviews|member_content_revisions|learning_runs|line_delivery_outbox)/i);
  assert.match(orchestrator, /reconcile_runtime_terminal_failures_v1/);
  assert.match(orchestrator, /capture_morning_alpha_acceptance_v1/);
  assert.match(orchestrator, /RECOVERY_ACCEPTANCE_FAILED/);
  assert.match(orchestrator, /verdict !== 'PASS'/);
  assert.match(orchestrator, /requestedRecoveryDate/);
  assert.match(orchestrator, /target_date: businessDate/);
  assert.match(orchestrator, /INVALID_RECOVERY_BUSINESS_DATE/);
});

test('quality-block classifier preserves strict 409 handling but permits audited terminal reconciliation', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260830091500_allow_terminal_reconciliation_after_quality_block.sql', import.meta.url), 'utf8');
  const reconciliationGuard = sql.indexOf("old.dispatch_status = 'FAILED'");
  const strict409Classifier = sql.indexOf('new.http_status = 409');
  assert.ok(reconciliationGuard >= 0 && strict409Classifier > reconciliationGuard);
  for (const fragment of [
    "current_user = 'postgres'", "new.dispatch_status = 'SKIPPED'",
    "new.response_error_code = 'SUPERSEDED_BY_DURABLE_STATE'",
    "{terminal_reconciliation,reason_code}", "{terminal_reconciliation,correlation_id}",
    "new.dispatch_status := 'FAILED'", "new.response_error_code := 'QUALITY_BLOCK'",
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  assert.doesNotMatch(sql, /disable\s+trigger|drop\s+trigger|response_success\s*:=\s*true|http_status\s*:=\s*null/i);
});

test('delivery, payload, and Content OS all require the same semantic member revision', () => {
  const orchestrator = readFileSync(new URL('../supabase/functions/daily-delivery-orchestrator/index.ts', import.meta.url), 'utf8');
  const payload = readFileSync(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');
  const contentOs = readFileSync(new URL('../supabase/functions/content-os-morning-alpha-source/index.ts', import.meta.url), 'utf8');
  for (const source of [orchestrator, payload, contentOs]) assert.match(source, /current_member_content_revisions_v1/);
  assert.match(orchestrator, /semantic_member_revision_not_publishable/);
  assert.match(payload, /resolveCanonicalDataQuality/);
  assert.doesNotMatch(payload, /premiumGate\.eligible\s*\?\s*[\s\S]{0,80}["']complete["']/);
  assert.match(contentOs, /evaluateCanonicalSemanticCoherenceGate/);
  assert.match(contentOs, /record_content_os_incident_v1/);
  assert.match(contentOs, /resolve_content_os_incident_v1/);
});

test('safe recovery exposes only scoped, audited repair and replay actions', () => {
  const recovery = readFileSync(new URL('../supabase/functions/ma-ops-safe-recovery/index.ts', import.meta.url), 'utf8');
  const generator = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');
  const learning = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  assert.match(recovery, /rebuild_member_content_revision/);
  assert.match(recovery, /reconcile_learning_metrics/);
  assert.match(recovery, /replay_strategy[\s\S]+target:\s*'strategy-replay-engine'[\s\S]+defaultBody:\s*\{\s*dry_run:\s*true\s*\}/);
  assert.match(recovery, /RECOVERY_APPROVAL_EVIDENCE_REQUIRED/);
  assert.match(recovery, /get_ma_ops_health_cron_secret/);
  assert.match(recovery, /presentedCronToken/);
  assert.match(recovery, /currentToken: schedulerToken/);
  assert.doesNotMatch(recovery, /x-internal-service-key/);
  assert.match(generator, /canonical_member_recovery/);
  assert.match(generator, /notifications_sent:0/);
  assert.match(learning, /record_learning_metric_correction_v1/);
  assert.match(learning, /business_rows_mutated:\s*0/);
  assert.match(learning, /notifications_sent:\s*0/);
});
