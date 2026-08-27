import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolveEffectiveMemberAccess } from '../supabase/functions/_shared/member-entitlement.ts';

const NOW = Date.parse('2026-08-23T00:00:00.000Z');
const FUTURE = '2026-09-06T00:00:00.000Z';
const PAST = '2026-08-22T00:00:00.000Z';

test('Sony admin is permanent owner regardless of billing fields', () => {
  const access = resolveEffectiveMemberAccess(
    { role: 'admin', subscription_status: 'inactive', paid_until: null },
    null,
    NOW,
  );
  assert.equal(access.tier, 'admin');
  assert.equal(access.state, 'owner');
  assert.equal(access.active, true);
  assert.equal(access.accessEndsAt, null);
});

test('beta access unlocks the full member tier without consuming the trial', () => {
  const access = resolveEffectiveMemberAccess(
    { role: 'free', subscription_status: 'inactive' },
    {
      state: 'beta_full',
      tier: 'member',
      source: 'beta',
      access_started_at: PAST,
      access_ends_at: null,
      trial_started_at: null,
      trial_ends_at: null,
    },
    NOW,
  );
  assert.equal(access.tier, 'member');
  assert.equal(access.state, 'beta_full');
  assert.equal(access.active, true);
  assert.equal(access.trialStartsAt, null);
});

test('active 14-day trial receives member access and expires at server time', () => {
  const active = resolveEffectiveMemberAccess(
    { role: 'free' },
    { state: 'trialing', tier: 'member', trial_started_at: PAST, trial_ends_at: FUTURE },
    NOW,
  );
  assert.equal(active.tier, 'member');
  assert.equal(active.active, true);

  const expired = resolveEffectiveMemberAccess(
    { role: 'free' },
    { state: 'trialing', tier: 'member', trial_started_at: '2026-08-01T00:00:00Z', trial_ends_at: PAST },
    NOW,
  );
  assert.equal(expired.tier, 'free');
  assert.equal(expired.state, 'expired');
  assert.equal(expired.active, false);
});

test('canceled subscription retains access only through its paid period', () => {
  const stillPaid = resolveEffectiveMemberAccess(
    { role: 'free' },
    { state: 'canceled', tier: 'vip', access_ends_at: FUTURE, cancel_at_period_end: true },
    NOW,
  );
  assert.equal(stillPaid.tier, 'vip');
  assert.equal(stillPaid.active, true);

  const ended = resolveEffectiveMemberAccess(
    { role: 'free' },
    { state: 'canceled', tier: 'vip', access_ends_at: PAST, cancel_at_period_end: true },
    NOW,
  );
  assert.equal(ended.tier, 'free');
  assert.equal(ended.state, 'expired');
});

test('past-due state fails closed', () => {
  const access = resolveEffectiveMemberAccess(
    { role: 'free' },
    { state: 'past_due', tier: 'member', access_ends_at: FUTURE },
    NOW,
  );
  assert.equal(access.tier, 'free');
  assert.equal(access.active, false);
});

test('migration keeps entitlement writes server-only and payment events idempotent', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260822183421_member_access_trial_state_machine.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /alter table public\.member_entitlements enable row level security/i);
  assert.match(migration, /revoke all on table public\.member_entitlements from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.ensure_member_entitlement_v1\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /unique \(provider, provider_event_id\)/i);
  assert.match(migration, /lower\('sonytzeng@gmail\.com'\)/i);
});
