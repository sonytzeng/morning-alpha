import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyDeliveryRecoveryPlan,
  hasFailedEvidenceDependency,
  isContentOnlyDeliveryFailure,
  resolveDailyDeliveryPhase,
  resolveDailyDeliveryCompletion,
  resolveReportDeliveryStatus,
} from '../supabase/functions/_shared/daily-delivery-recovery.ts';

test('delivery business outcomes distinguish abstention, quality failure, provider failure and suppression',()=>{
  const base={is_trading_day:true,system_failure:false,report_eligible:true,delivered:true,no_recommendation:false,suppressed:false};
  assert.equal(resolveReportDeliveryStatus(base),'DELIVERED');
  for(const [change,status] of [
    [{no_recommendation:true},'DELIVERED_NO_RECOMMENDATION'],
    [{report_eligible:false},'BLOCKED_QUALITY'],
    [{system_failure:true},'FAILED_SYSTEM'],
    [{is_trading_day:false},'SKIPPED_NON_TRADING_DAY'],
    [{suppressed:true},'SUPPRESSED'],
    [{delivered:false},'WAITING'],
  ]) assert.equal(resolveReportDeliveryStatus({...base,...change}),status);
});

test('public market report delivery does not require Premium eligibility', () => {
  const input = { has_report: true, premium_eligible: false, report_eligible: true, reason_codes: [], attempt: 1, taipei_minutes: 445 };
  assert.deepEqual(buildDailyDeliveryRecoveryPlan(input).actions, ['deliver_premium']);
  assert.equal(resolveDailyDeliveryCompletion({ phase: 'deliver', action_failure_count: 0, premium_eligible: false, report_eligible: true, delivered: true }), true);
  assert.equal(resolveDailyDeliveryCompletion({ phase: 'deliver', action_failure_count: 0, premium_eligible: false, report_eligible: true, delivered: false }), false);
});

test('unsupported evidence cannot trigger unchanged-input regeneration retries', () => {
  for (const code of ['research_unsupported_claims_present', 'research_evidence_coverage_below_100', 'schema_mismatch']) {
    const plan = buildDailyDeliveryRecoveryPlan({ has_report: true, premium_eligible: false, report_eligible: false, reason_codes: [code], attempt: 1, taipei_minutes: 435 });
    assert.equal(plan.status, 'blocked_quality');
    assert.deepEqual(plan.actions, []);
    assert.equal(plan.retry_after_seconds, null);
  }
});

test('daily delivery phases reserve recovery time before the 07:30 deadline', () => {
  assert.equal(resolveDailyDeliveryPhase(7 * 60), 'refresh');
  assert.equal(resolveDailyDeliveryPhase(7 * 60 + 5), 'generate');
  assert.equal(resolveDailyDeliveryPhase(7 * 60 + 10), 'repair');
  assert.equal(resolveDailyDeliveryPhase(7 * 60 + 20), 'deliver');
  assert.equal(resolveDailyDeliveryPhase(7 * 60 + 30), 'watchdog');
});

test('traceability failures refresh only the affected evidence and regenerate', () => {
  const plan = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: false,
    reason_codes: ['news_traceability_incomplete'],
    attempt: 2,
    taipei_minutes: 7 * 60 + 12,
  });
  assert.equal(plan.status, 'repairing');
  assert.deepEqual(plan.actions, ['refresh_news', 'regenerate_report']);
});

test('missing or stale market evidence routes to market recovery', () => {
  const plan = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: false,
    reason_codes: ['stale_market_data:TXF'],
    attempt: 1,
    taipei_minutes: 7 * 60 + 15,
  });
  assert.deepEqual(plan.actions, ['refresh_market', 'regenerate_report']);
});

test('an eligible report is delivered only in the delivery window', () => {
  const early = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: true,
    reason_codes: [],
    attempt: 1,
    taipei_minutes: 7 * 60 + 10,
  });
  const ready = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: true,
    reason_codes: [],
    attempt: 1,
    taipei_minutes: 7 * 60 + 25,
  });
  assert.deepEqual(early.actions, []);
  assert.deepEqual(ready.actions, ['deliver_premium']);
});

test('after the deadline an honest incident notice precedes continued recovery', () => {
  const plan = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: false,
    reason_codes: ['verified_catalyst_evidence_missing'],
    attempt: 4,
    taipei_minutes: 7 * 60 + 31,
  });
  assert.equal(plan.status, 'incident');
  assert.equal(plan.deadline_reached, true);
  assert.deepEqual(plan.actions, [
    'deliver_incident',
    'refresh_news',
    'refresh_market',
    'regenerate_report',
  ]);
});

test('a missing report triggers complete source recovery without fabricating a fallback', () => {
  const plan = buildDailyDeliveryRecoveryPlan({
    has_report: false,
    premium_eligible: false,
    reason_codes: [],
    attempt: 1,
    taipei_minutes: 7 * 60 + 8,
  });
  assert.deepEqual(plan.actions, ['refresh_news', 'refresh_market', 'regenerate_report']);
  assert.ok(plan.reason_codes.includes('daily_report_not_publishable'));
});

test('failed evidence dependencies block regeneration and premium delivery', () => {
  assert.equal(hasFailedEvidenceDependency({ refresh_news: { ok: true }, refresh_market: { ok: true } }), false);
  assert.equal(hasFailedEvidenceDependency({ refresh_news: { ok: false }, refresh_market: { ok: true } }), true);
  assert.equal(hasFailedEvidenceDependency({ regenerate_report: { ok: false } }), true);
  assert.equal(hasFailedEvidenceDependency({ deliver_incident: { ok: false } }), false);
});

test('content-only failures use a bounded repair budget instead of repeating the same generation indefinitely', () => {
  const reasons = [
    'member_research_value_sentence_low_quality',
    'decision_snapshot_not_publishable',
  ];
  assert.equal(isContentOnlyDeliveryFailure(reasons), true);

  const secondAttempt = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: false,
    reason_codes: reasons,
    attempt: 2,
    content_repair_attempts: 2,
    taipei_minutes: 7 * 60 + 18,
  });
  assert.deepEqual(secondAttempt.actions, ['regenerate_report']);

  const exhausted = buildDailyDeliveryRecoveryPlan({
    has_report: true,
    premium_eligible: false,
    reason_codes: reasons,
    attempt: 7,
    content_repair_attempts: 3,
    taipei_minutes: 7 * 60 + 31,
  });
  assert.deepEqual(exhausted.actions, ['deliver_incident']);
  assert.equal(exhausted.retry_after_seconds, null);
});
