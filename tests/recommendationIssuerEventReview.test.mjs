import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { snapshotHash } from '../src/features/vnext/contracts.ts';
import { emptyEvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { prepareIssuerEventReview, previewIssuerEventReview } from '../research/recommendation-issuer-event-review-candidate.ts';

// This pins the reviewed fact projection, not original issuer response bytes.
const HASH = '65eaa00f1d741ae4decffd567ff35e41156d01116eef9ba3bb21c12fde20e121';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/issuer-event-review-official-facts-20261017.json', import.meta.url), 'utf8'));
const cutoff = '2026-10-17T09:00:00Z';
const clone = () => structuredClone(fixture);
const hash = f => snapshotHash({ facts: f.facts, draft: f.draft });
const run = async (f = clone(), at = cutoff, expected) =>
  prepareIssuerEventReview(f.facts, f.draft, f.policy, expected ?? await hash(f), at);
async function invalid(mutate) {
  const f = clone(); mutate(f);
  await assert.rejects(run(f), /ISSUER_REVIEW_CONTRACT_INVALID/);
}

test('REAL fact projection: latest four issuer-reported standalone quarters, not the prior Q2 window', async () => {
  assert.equal(await hash(fixture), HASH);
  const r = await run(clone(), cutoff, HASH);
  assert.deepEqual(r.actuals.map(a => a.period), ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3']);
  assert.deepEqual(r.actuals.map(a => a.revenue_twd_billion), [1046.09, 1134.1, 1270.38, 1494.24]);
  assert.deepEqual(r.actuals.map(a => a.eps_twd), [19.5, 22.08, 27.25, 29.43]);
  assert.deepEqual(r.actuals.map(a => a.revenue_twd), [1046090000000, 1134100000000, 1270380000000, 1494240000000]);
  assert.equal(r.observed_standalone_actual_quarters, 4);
  assert.equal(r.direct_common_share_basis_quarters, 2, 'Indexed excerpts must not become direct-document proof');
  assert(r.actuals.every(a => a.currency === 'TWD' && a.revenue_precision_twd === 10000000
    && a.conversion === 'BILLION_SCALE_ONLY_NOT_YTD_SUBTRACTION' && a.consensus === null));
});

test('REAL issuer guidance stays separate: Q4 USD ranges, unknown direction/reliableGuidance, no stable default', async () => {
  const r = await run();
  assert.equal(r.issuer_guidance.length, 1);
  assert.equal(r.issuer_guidance[0].target_period, '2026-Q4');
  assert.deepEqual(r.issuer_guidance[0].revenue_usd_billion, [52.3, 54.3]);
  assert.deepEqual(r.issuer_guidance[0].gross_margin_pct, [65, 67]);
  assert.equal(r.issuer_guidance[0].direction, null);
  assert.equal(r.issuer_guidance[0].reliableGuidance, null);
  assert(r.actuals.every(a => !Object.hasOwn(a, 'guidance_direction') && !Object.hasOwn(a, 'reliableGuidance')));
});

test('REAL 2330 event draft has direct issuer relationship, limited path, counterevidence and cancellation with locators', async () => {
  const r = await run();
  assert.equal(r.status, 'PENDING_OWNER_REVIEW');
  assert.equal(r.review.symbol, '2330');
  assert.equal(r.review.approved, false);
  assert.equal(r.causal_review, null);
  assert.equal(r.review.counterevidence.length, 2);
  assert.equal(r.review.cancellation_conditions.length, 2);
  const claims = [r.review.company_relation, r.review.transmission_path, ...r.review.counterevidence,
    r.review.confirmation_condition, r.review.invalidation_condition, ...r.review.cancellation_conditions];
  assert(claims.every(c => c.text && c.evidence.length && c.evidence.every(e => fixture.policy.allowed_source_urls.includes(e.source_url) && e.locator)));
  assert.match(r.review.counterevidence[0].text, /毛利率季減/);
  assert(r.blockers.includes('EXACT_EVENT_PUBLICATION_TIME_UNPROVEN'));
  assert(r.blockers.includes('SOME_ORDINARY_SHARE_BASIS_INDEXED_ONLY'));
});

test('REAL first-seen never becomes the old source date, midnight publication or an immutable original version', async () => {
  const r = await run();
  assert(r.actuals.every(a => a.first_seen_at.startsWith('2026-10-17T') && a.available_at >= a.first_seen_at
    && a.original_published_at === null && a.original_version === null));
  assert.equal(r.actuals[0].available_at, '2026-10-17T08:48:35Z');
  assert.equal(r.resource_license, 'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED');
  assert.equal(r.formal_admission, false); assert.equal(r.member_publication, false);
});

test('past cutoffs cannot be repaired by current issuer retrieval, even with historical publication labels', async () => {
  for (const at of ['2026-01-16T00:00:00Z', '2026-10-16T23:59:59Z', '2026-10-17T08:45:12Z']) {
    const r = await run(clone(), at);
    assert.equal(r.actuals.length, 0); assert.equal(r.issuer_guidance.length, 0);
    assert.equal(r.review, null); assert.equal(r.status, 'HOLD_NOT_AVAILABLE_AT_CUTOFF');
  }
});

test('source/draft changes cannot survive the previously pinned projection hash', async () => {
  for (const mutate of [f => f.facts.actuals[0].eps_twd++, f => f.draft.transmission_path.text += 'tamper',
    f => f.facts.sources[0].published_date = '2026-01-16']) {
    const f = clone(); mutate(f); await assert.rejects(run(f, cutoff, HASH), /SOURCE_HASH_MISMATCH/);
  }
});

test('SYNTHETIC semantic counterexamples: rehashing YTD/full-year or subtractive/foreign-currency labels does not admit them', async () => {
  for (const mutate of [f => f.facts.actuals[0].period_basis = 'YTD', f => f.facts.actuals[0].period = '2025',
    f => f.facts.actuals[0].period_start = '2025-01-01', f => f.facts.actuals[0].currency = 'USD',
    f => f.facts.actuals[0].eps_basis = 'ADR', f => f.facts.actuals[0].derived_by = 'YTD_SUBTRACTION',
    f => f.facts.actuals[0].revenue_precision_twd_billion = 0]) await invalid(mutate);
});

test('SYNTHETIC latest-window, duplicate, missing-quarter and board-approval substitutions reject', async () => {
  for (const mutate of [f => f.facts.latest_reported_period = '2026-Q2', f => f.facts.actuals.pop(),
    f => f.facts.actuals[0] = structuredClone(f.facts.actuals[1]),
    f => f.facts.actuals[0].period = '2025-Q3', f => f.facts.sources[0].kind = 'BOARD_APPROVAL']) await invalid(mutate);
});

test('SYNTHETIC zero/negative EPS is preserved as an explicit reported value, never fabricated from other quarters', async () => {
  const f = clone(); f.facts.actuals[0].eps_twd = 0; f.facts.actuals[1].eps_twd = -1.25;
  const r = await run(f); assert.deepEqual(r.actuals.slice(0, 2).map(a => a.eps_twd), [0, -1.25]);
  assert.deepEqual(r.actuals.slice(2).map(a => a.eps_twd), [27.25, 29.43]);
});

test('SYNTHETIC guidance never defaults stable, changes quarter/currency basis or borrows an old release', async () => {
  for (const mutate of [f => f.facts.guidance[0].direction = 'stable', f => f.facts.guidance[0].reliableGuidance = true,
    f => f.facts.guidance[0].target_period = '2026-Q3', f => f.facts.guidance[0].revenue_usd_billion = [54.3, 52.3],
    f => f.facts.guidance[0].source_id = 'release-q1-2026']) await invalid(mutate);
});

test('SYNTHETIC URLs are exact caller-policy allowlist entries, not raw-payload/redirect destinations', async () => {
  for (const url of ['http://investor.tsmc.com/x', 'https://127.0.0.1/private',
    'https://investor.tsmc.com.evil.invalid/x', 'https://user:secret@investor.tsmc.com/x',
    fixture.facts.sources[0].url + '?token=not-a-real-token', fixture.facts.sources[0].url + '#fragment',
    'https://investor.tsmc.com/unreviewed-other-document']) await invalid(f => { f.facts.sources[0].url = url; });
});

test('SYNTHETIC raw content, extra authority/PII and automatically approved reviews are not accepted fields', async () => {
  for (const mutate of [f => f.facts.raw_html = 'DO_NOT_RETAIN', f => f.facts.sources[0].raw_pdf = 'DO_NOT_RETAIN',
    f => f.draft.approved = true, f => f.draft.owner_review = { status: 'APPROVED' },
    f => f.facts.actuals[0].consensus = 99]) await invalid(mutate);
});

test('SYNTHETIC missing/duplicate facts, classification-as-causality and indexed-only draft evidence reject', async () => {
  for (const mutate of [f => f.draft.transmission_path.fact_ids = ['not-present'],
    f => f.facts.facts.push(structuredClone(f.facts.facts[0])),
    f => f.facts.facts[0].kind = 'INDUSTRY_CLASSIFICATION',
    f => f.draft.company_relation.fact_ids = ['n2-margin-dilution'],
    f => f.facts.facts[0].source_id = 'management-q1-2026-indexed',
    f => f.draft.event_source_id = 'release-q1-2026']) await invalid(mutate);
});

test('SYNTHETIC missing counterevidence, cancellation or source bindings fail closed', async () => {
  for (const mutate of [f => f.draft.counterevidence = [], f => f.draft.cancellation_conditions = [],
    f => f.draft.confirmation_condition.fact_ids = [], f => f.draft.invalidation_condition.text = '']) await invalid(mutate);
});

test('SYNTHETIC invalid dates, missing timezone and publication-after-receipt cannot become point-in-time proof', async () => {
  for (const mutate of [f => f.facts.sources[0].published_date = '2026-02-30',
    f => f.facts.sources[0].first_seen_at = '2026-10-17T08:45:13',
    f => f.facts.sources[0].first_seen_at = '2026-10-18T00:00:00Z',
    f => f.facts.sources[0].published_at = '2026-10-18T00:00:00Z',
    f => f.draft.proposed_at = '2026-01-01T00:00:00Z']) await invalid(mutate);
});

test('hashing does not validate an issuer statement or grant approval, even when exact time/version are supplied', async () => {
  const f = clone(); f.facts.sources.find(s => s.id === f.draft.event_source_id).published_at = '2026-10-15T06:00:00Z';
  f.facts.sources.find(s => s.id === f.draft.event_source_id).version = 'SYNTHETIC_EXACT_VERSION_NOT_REAL_PROOF';
  const r = await run(f); assert.equal(r.review.approved, false); assert.equal(r.causal_review, null);
  assert(r.blockers.includes('OWNER_REVIEW_REQUIRED')); assert.equal(r.production_eligible, false);
});

test('hashed facts, draft and caller policy are snapshot-isolated across asynchronous work', async () => {
  const f = clone(), expected = await hash(f), before = JSON.stringify(f);
  const pending = prepareIssuerEventReview(f.facts, f.draft, f.policy, expected, cutoff);
  f.facts.actuals[0].eps_twd = 999; f.draft.title = 'MUTATED'; f.policy.allowed_source_urls.length = 0;
  const r = await pending; assert.equal(r.actuals[0].eps_twd, 19.5); assert.notEqual(r.review.title, 'MUTATED');
  const untouched = clone(); await run(untouched); assert.equal(JSON.stringify(untouched), before);
});

test('existing adapter wiring creates no canonical event/earnings/mapping or CausalReview and preserves V1 method', async () => {
  const f = clone(), data = emptyEvidenceData(), before = await snapshotHash(data);
  const identity = { report_date: '2026-10-17', today_date: '2026-10-17', generated_at: cutoff,
    data_as_of: cutoff, revision_id: 'issuer-review-preview-only', is_trading_day: false };
  const r = await previewIssuerEventReview(f.facts, f.draft, f.policy, HASH, identity, data, []);
  assert.equal(r.adapter_reviews_supplied, 0); assert.equal(r.canonical_rows_created, 0);
  for (const key of ['news', 'catalysts', 'mappings', 'earnings']) assert.deepEqual(r.alignment.data[key], []);
  assert.deepEqual(r.alignment.decision, buildEvidenceDecision(data, identity));
  assert.equal(await snapshotHash(data), before); assert.deepEqual(r.alignment.business_writes, []);
  assert.equal(r.review.review.approved, false); assert.equal(r.alignment.production_eligible, false);
});

test('preview snapshots cutoff, canonical data and receipt array together before asynchronous review', async () => {
  for (const mutate of [
    ({ identity }) => { identity.generated_at = '2026-10-16T09:00:00Z'; },
    ({ data }) => { data.failures.push('LATE_SHARED_INPUT'); },
    ({ receipts }) => { receipts.push({ task: { kind: 'PRICE', symbols: [] }, status: 'UNAVAILABLE' }); },
  ]) {
    const f = clone(), inputs = {
      identity: { report_date: '2026-10-17', today_date: '2026-10-17', generated_at: cutoff,
        data_as_of: cutoff, revision_id: 'snapshot-preview', is_trading_day: false },
      data: emptyEvidenceData(), receipts: [],
    };
    const pending = previewIssuerEventReview(f.facts, f.draft, f.policy, HASH, inputs.identity, inputs.data, inputs.receipts);
    mutate(inputs);
    const r = await pending;
    assert.equal(r.review.cutoff, cutoff); assert.equal(r.alignment.cutoff, cutoff);
    assert.deepEqual(r.alignment.data.failures, []); assert.deepEqual(r.alignment.issues, []);
    assert.equal(r.review.review.approved, false); assert.equal(r.adapter_reviews_supplied, 0);
  }
});

test('candidate is detached and original R9 evaluator/event adapter bytes remain unchanged', () => {
  const path = p => new URL(p, import.meta.url);
  const source = readFileSync(path('../research/recommendation-issuer-event-review-candidate.ts'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|Deno\.env|process\.env|createClient|node:fs|node:child_process/);
  for (const [file, expected] of [
    ['../supabase/functions/_shared/decision-v1-evidence.ts', '2ef106edc162fb28b7579322dff9b89057b184a2166f51ce57ed31781190d848'],
    ['../research/recommendation-event-alignment-candidate.ts', '9e6513ed982f1f6aa6fd158af37344e0a3978cceab23c1d7e93f70ec4ca7be28'],
  ]) assert.equal(createHash('sha256').update(readFileSync(path(file))).digest('hex'), expected);
});
