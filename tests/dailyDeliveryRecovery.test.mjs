import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyDeliveryRecoveryPlan,
  resolveDailyDeliveryPhase,
} from '../supabase/functions/_shared/daily-delivery-recovery.ts';

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
