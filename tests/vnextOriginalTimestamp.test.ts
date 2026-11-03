import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTime, FROZEN_V1_REF, snapshotHash, validObservationTime as validTime } from '../src/features/vnext/contracts.ts';
import type { Evidence, EventRevision, Observation, SupplyRelation } from '../src/features/vnext/contracts.ts';
import {
  evaluateObservation, evidenceIssues, eventTimeline, lockObservation,
  publicationGate, supplyRelationStatus, validationReadiness,
} from '../src/features/vnext/engine.ts';
import type { ValidationCoverage } from '../src/features/vnext/engine.ts';
import { fixture } from './fixtures/vnext.mjs';

// SYNTHETIC CONTRACT FIXTURES ONLY; no database, ingress, or market facts.
const before = '2026-10-08T00:00:00.123455Z';
const cutoff = '2026-10-08T00:00:00.123456Z';
const after = '2026-10-08T00:00:00.123457Z';
const taipeiCutoff = '2026-10-08T08:00:00.123456+08:00';

function originalFixture() {
  const f = fixture();
  const observation: Observation = {
    ...f.observation, created_at: cutoff, as_of: cutoff,
    available_at: cutoff, last_verified_at: cutoff,
  };
  return {
    ...f, observation, evidence: f.evidence as Evidence[],
    policy: { ...f.policy, now: cutoff, approval_at: cutoff },
  };
}

function currentEvidence(): Evidence {
  return {
    ...originalFixture().evidence[0], as_of: cutoff, published_at: cutoff,
    first_seen_at: cutoff, available_at: cutoff, last_verified_at: cutoff, valid_until: after,
  };
}

function event(): EventRevision {
  return {
    event_id: 'synthetic-event', revision: 1, source: 'SYNTHETIC_OFFICIAL',
    source_event_id: 'synthetic-announcement', published_at: cutoff,
    first_seen_at: cutoff, available_at: cutoff, last_verified_at: cutoff,
    title: 'Synthetic timestamp contract', evidence_ids: ['synthetic-0'],
    affected_companies: ['TEST'], expected_horizons: ['SHORT'],
    invalidation: 'Synthetic correction', classification: 'CONFIRMED_FACT',
    snapshot_hash: 'a'.repeat(64),
  };
}

test('original timestamps accept whole seconds and every 1–6 digit ISO fraction', () => {
  for (const zone of ['Z', '+00:00', '-00:00', '+08:00', '-05:30', '+23:59', '-23:59']) {
    for (const fraction of ['', '.1', '.12', '.123', '.1234', '.12345', '.123456']) {
      const value = `2024-02-29T23:59:59${fraction}${zone}`;
      assert.equal(validTime(value), true, value);
      assert.equal(compareTime(value, value), 0, value);
    }
  }
  for (const year of ['0000', '0096', '2000', '2024', '2400']) {
    assert.equal(validTime(`${year}-02-29T00:00:00.000001Z`), true, year);
  }
});

test('original timestamps reject calendar normalization, invalid zones and excess precision', () => {
  const invalid = [
    '1900-02-29T00:00:00.123456Z', '2026-02-29T00:00:00.123456Z',
    '2100-02-29T00:00:00.123456Z', '2024-02-30T00:00:00.123456Z',
    '2026-04-31T00:00:00.123456Z', '2026-00-01T00:00:00.123456Z',
    '2026-13-01T00:00:00.123456Z', '2026-10-00T00:00:00.123456Z',
    '2026-10-08T24:00:00.123456Z', '2026-10-08T00:60:00.123456Z',
    '2026-10-08T00:00:60.123456Z', '2026-10-08T00:00:00.123456+24:00',
    '2026-10-08T00:00:00.123456-24:00', '2026-10-08T00:00:00.123456+08:60',
    '2026-10-08T00:00:00.123456+0800', '2026-10-08T00:00:00.123456',
    '2026-10-08T00:00:00.1234567Z', '2026-10-08T00:00:00.Z',
    '2026-10-08 00:00:00.123456Z', '2026-10-08t00:00:00.123456z',
    '2026-10-08T00:00:00.123456Z\n', '', 'not-time',
  ];
  for (const value of invalid) {
    assert.equal(validTime(value), false, value);
    assert.equal(Number.isNaN(compareTime(value, cutoff)), true, value);
    assert.equal(Number.isNaN(compareTime(cutoff, value)), true, value);
  }
  for (const value of [null, undefined, 0, {}, new Date()]) {
    assert.equal(validTime(value as unknown as string), false);
  }
});

test('exact chronology normalizes offsets and fractional widths without rounding microseconds', () => {
  const equivalent = [
    [cutoff, taipeiCutoff],
    ['2026-10-07T18:30:00.123456-05:30', cutoff],
    ['2026-01-01T00:00:00.000001+08:00', '2025-12-31T16:00:00.000001Z'],
    ['2024-03-01T00:00:00.000001+08:00', '2024-02-29T16:00:00.000001Z'],
    ['2026-10-08T00:00:00.1Z', '2026-10-08T00:00:00.100000Z'],
    ['2026-10-08T00:00:00Z', '2026-10-08T00:00:00.000000+00:00'],
    ['0000-01-01T00:00:00.000001+01:00', '0000-01-01T00:00:00.000001+01:00'],
  ];
  for (const [a, b] of equivalent) {
    assert.equal(compareTime(a, b), 0, `${a} = ${b}`);
    assert.equal(compareTime(b, a), 0);
  }
  const ordered = [
    [before, taipeiCutoff], [taipeiCutoff, after],
    ['2026-10-08T00:00:00.123Z', '2026-10-08T00:00:00.123001Z'],
    ['2026-10-07T23:59:59.999999Z', '2026-10-08T00:00:00Z'],
    ['1969-12-31T23:59:59.999999Z', '1970-01-01T00:00:00.000000Z'],
    ['0000-01-01T00:00:00.000001Z', '0000-01-01T00:00:00.000002Z'],
    ['9999-12-31T23:59:59.999998Z', '9999-12-31T23:59:59.999999Z'],
  ];
  for (const [a, b] of ordered) {
    assert.equal(compareTime(a, b), -1, `${a} < ${b}`);
    assert.equal(compareTime(b, a), 1);
  }
});

test('evidence PIT allows the exact cutoff but rejects every future or reversed 1µs edge', () => {
  const e = currentEvidence();
  assert.deepEqual(evidenceIssues(e, taipeiCutoff), []);
  const invalid: Partial<Evidence>[] = [
    { as_of: after }, { published_at: after }, { first_seen_at: after },
    { available_at: after, last_verified_at: after },
    { last_verified_at: after }, { last_verified_at: before },
  ];
  for (const patch of invalid) {
    assert.ok(evidenceIssues({ ...e, ...patch }, cutoff).includes('POINT_IN_TIME_INVALID'), JSON.stringify(patch));
  }
  assert.ok(evidenceIssues({ ...e, valid_until: taipeiCutoff }, cutoff).includes('STALE_EVIDENCE'));
  assert.deepEqual(evidenceIssues({ ...e, valid_until: after }, cutoff), []);
});

test('original observation accepts transaction microseconds and retains strict PIT ordering', () => {
  const { observation: o, evidence } = originalFixture();
  assert.equal(evaluateObservation(o, evidence, taipeiCutoff).eligible, true);
  const invalid: Partial<Observation>[] = [
    { as_of: after }, { available_at: after },
    { last_verified_at: after }, { last_verified_at: before },
    { created_at: after }, { next_review_at: cutoff }, { next_review_at: before },
    { expires_at: cutoff }, { expires_at: before },
  ];
  for (const patch of invalid) {
    const result = evaluateObservation({ ...o, ...patch }, evidence, cutoff);
    assert.equal(result.eligible, false, JSON.stringify(patch));
    assert.ok(result.issues.includes('OBSERVATION_TIME_INVALID'), JSON.stringify(patch));
  }
  for (const field of ['available_at', 'last_verified_at'] as const) {
    const rows = structuredClone(evidence);
    rows[0][field] = after;
    const result = evaluateObservation(o, rows, cutoff);
    assert.equal(result.eligible, false);
    assert.ok(result.issues.includes('POINT_IN_TIME_INVALID'));
  }
  assert.ok(evaluateObservation(o, evidence, 'invalid').issues.includes('OBSERVATION_TIME_INVALID'));
});

test('next review and expiry switch at the exact microsecond, not the containing millisecond', () => {
  const f = originalFixture();
  const o = { ...f.observation, next_review_at: after, expires_at: '2026-10-08T00:00:00.123458Z' };
  const atCutoff = evaluateObservation(o, f.evidence, cutoff);
  assert.equal(atCutoff.eligible, true);
  assert.equal(atCutoff.state, 'CONDITION_MET');
  const atReview = evaluateObservation(o, f.evidence, after);
  assert.equal(atReview.eligible, false);
  assert.ok(atReview.issues.includes('REVIEW_OVERDUE'));
  assert.notEqual(atReview.state, 'EXPIRED');
  for (const now of ['2026-10-08T08:00:00.123458+08:00', '2026-10-08T00:00:00.123459Z']) {
    const result = evaluateObservation(o, f.evidence, now);
    assert.equal(result.state, 'EXPIRED');
    assert.equal(result.eligible, false);
  }
});

test('event availability and last verification exclude future 1µs revisions', () => {
  const row = event();
  assert.equal(eventTimeline([row], taipeiCutoff).length, 1);
  for (const patch of [{ available_at: after, last_verified_at: after }, { last_verified_at: after }]) {
    assert.deepEqual(eventTimeline([{ ...row, ...patch }], cutoff), []);
  }
  for (const patch of [{ published_at: after }, { first_seen_at: after }, { last_verified_at: before }]) {
    assert.throws(() => eventTimeline([{ ...row, ...patch }], cutoff), /EVENT_INVALID/);
  }
  const prior = { ...row, published_at: before, first_seen_at: before };
  const reversed = { ...prior, revision: 2, available_at: before };
  assert.throws(() => eventTimeline([prior, reversed], cutoff), /EVENT_REVISION_TIME_REVERSED/);
  const next = { ...row, revision: 2, available_at: after, last_verified_at: after };
  assert.equal(eventTimeline([row, next], cutoff)[0].current.revision, 1);
  assert.equal(eventTimeline([row, next], after)[0].current.revision, 2);
});

test('supply relation availability, validity and observation boundaries retain microseconds', () => {
  const f = originalFixture();
  const e = f.evidence.find(e => e.kind === 'SUPPLY_CHAIN')!;
  const row: SupplyRelation = {
    id: 'synthetic-relation', from: 'TEST', to: 'OTHER', type: 'SUPPLIER', source: e.source,
    evidence_ids: [e.id], valid_from: cutoff, valid_to: after,
    observed_at: cutoff, available_at: cutoff, confidence: 'DOCUMENTED',
    revenue_exposure: null, verification_status: 'VERIFIED',
  };
  assert.equal(supplyRelationStatus(row, f.evidence, taipeiCutoff), 'SUPPORTED_RELATION_NOT_PRICE_FORECAST');
  for (const patch of [
    { observed_at: after }, { available_at: after }, { valid_from: after },
    { valid_to: taipeiCutoff }, { valid_to: before },
  ]) {
    assert.equal(supplyRelationStatus({ ...row, ...patch }, f.evidence, cutoff), 'UNKNOWN', JSON.stringify(patch));
  }
});

test('publication approval and license times fail closed at future or expired 1µs boundaries', () => {
  const f = originalFixture();
  assert.equal(publicationGate(f.observation, f.evidence, f.licenses, f.policy).allowed, true);
  assert.equal(publicationGate(f.observation, f.evidence, f.licenses, { ...f.policy, approval_at: taipeiCutoff }).allowed, true);
  for (const approval_at of [before, after]) {
    const result = publicationGate(f.observation, f.evidence, f.licenses, { ...f.policy, approval_at });
    assert.equal(result.allowed, false);
    assert.ok(result.issues.includes('PUBLICATION_NOT_APPROVED'));
  }
  for (const patch of [{ reviewed_at: after }, { expires_at: taipeiCutoff }, { expires_at: before }]) {
    const licenses = f.licenses.map(l => ({ ...l, ...patch }));
    const result = publicationGate(f.observation, f.evidence, licenses, f.policy);
    assert.equal(result.allowed, false);
    assert.ok(result.issues.includes('LICENSE_NOT_CLEARED'));
  }
  const currentLicense = f.licenses.map(l => ({ ...l, reviewed_at: cutoff, expires_at: after }));
  assert.equal(publicationGate(f.observation, f.evidence, currentLicense, f.policy).allowed, true);
  assert.equal(publicationGate(f.observation, f.evidence, f.licenses, { ...f.policy, now: 'invalid' }).allowed, false);
});

test('validation splits keep strict 1µs gaps and reject equal or reversed boundaries', () => {
  const coverage: ValidationCoverage = {
    point_in_time: true, historical_universe: true, corporate_actions: true,
    executable_prices: true, cost_model_version: 'SYNTHETIC_COST', regimes: ['UP', 'DOWN', 'RANGE'],
    frozen_v1_ref: FROZEN_V1_REF, available_sessions: 300,
    train_end: before, validation_start: cutoff, validation_end: cutoff,
    oos_start: after, oos_end: after, frozen_at: before,
    baselines: ['TAIEX', 'RANDOM_ELIGIBLE', 'MOMENTUM', 'FROZEN_V1', 'CANDIDATE'], walk_forward: true,
  };
  assert.equal(validationReadiness('SHORT', coverage).data_ready, true);
  for (const patch of [
    { train_end: cutoff }, { validation_start: after }, { validation_end: after },
    { oos_end: cutoff }, { frozen_at: after },
  ]) {
    assert.ok(validationReadiness('SHORT', { ...coverage, ...patch }).issues.includes('SPLIT_LEAKAGE'), JSON.stringify(patch));
  }
});

test('original snapshot hashing stays byte-for-byte compatible and lock retains microseconds', async () => {
  const legacy = fixture();
  const { snapshot_hash: _, ...legacyPayload } = legacy.observation;
  const legacyHash = await snapshotHash({
    observation: legacyPayload,
    evidence: legacy.evidence.filter(e => legacy.observation.evidence_ids.includes(e.id)).sort((a, b) => a.id.localeCompare(b.id)),
  });
  // Captured from the original implementation before the precision change.
  assert.equal(legacyHash, 'a3743658383750f9dfde5e46df5968d3cb0da0f349e90a2becc184e819623732');
  const f = originalFixture();
  const { snapshot_hash: __, ...payload } = f.observation;
  f.observation.snapshot_hash = await snapshotHash({
    observation: payload,
    evidence: f.evidence.filter(e => f.observation.evidence_ids.includes(e.id)).sort((a, b) => a.id.localeCompare(b.id)),
  });
  const locked = await lockObservation(f.observation, f.evidence);
  assert.deepEqual(locked, f.observation);
  assert.notEqual(locked, f.observation);
  assert.equal(locked.created_at, cutoff);
  await assert.rejects(() => lockObservation({ ...f.observation, created_at: taipeiCutoff }, f.evidence), /SNAPSHOT_MISMATCH/);
  f.evidence[0].summary = 'Synthetic tampering';
  await assert.rejects(() => lockObservation(f.observation, f.evidence), /SNAPSHOT_MISMATCH/);
});

test('rehashing cannot admit original evidence verified or available 1µs after creation', async () => {
  for (const patch of [
    { last_verified_at: after }, { available_at: after, last_verified_at: after },
  ]) {
    const f = originalFixture();
    Object.assign(f.evidence[0], patch);
    const { snapshot_hash: _, ...payload } = f.observation;
    f.observation.snapshot_hash = await snapshotHash({
      observation: payload,
      evidence: f.evidence.filter(e => f.observation.evidence_ids.includes(e.id)).sort((a, b) => a.id.localeCompare(b.id)),
    });
    await assert.rejects(() => lockObservation(f.observation, f.evidence), /OBSERVATION_INVALID/);
  }
});
