import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { buildCheckpointEvidence, checkpointCollectionContract, validRetainedCheckpointRow, quoteFromCheckpointEvidence } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const id = 'e768a334-1d1b-4191-9f10-0c6fb1f11111';
const input = { phase: 'intraday', checkpoint: '0930', tradingDate: '2026-09-07', observedAt: '2026-09-07T09:30:00+08:00', correlationId: id };
const config = { market: 'TW', displaySymbol: 'TAIEX', name: '加權指數' };
const quote = { value: 21000, change: 200, changePercent: 1, capturedAt: '2026-09-07T09:27:00+08:00', provider: 'LOCAL_SYNTHETIC', sourceSymbol: 'IX0001', raw: {} };
const row = () => ({ ...buildCheckpointEvidence(input, quote, config).row, snapshot_version: 1 });

test('09:27 quote belongs to real 09:30 collection; provider and collection times remain distinct', () => {
  const r = row();
  assert.equal(r.captured_at, input.observedAt);
  assert.equal(r.source_timestamp, quote.capturedAt);
  assert.equal(validRetainedCheckpointRow(r, input, config), true);
});
for (const [label, value] of [['null', null], ['undefined', undefined], ['empty', ''], ['space', ' '], ['nan', NaN], ['infinity', Infinity], ['boolean', false], ['invalid', 'not-a-number']]) {
  test(`missing/non-numeric ${label} cannot become complete evidence`, () => {
    for (const field of ['value', 'changePercent', 'change']) assert.equal(buildCheckpointEvidence(input, { ...quote, [field]: value }, config).valid, false);
    for (const field of ['value', 'change_percent']) assert.equal(validRetainedCheckpointRow({ ...row(), [field]: value }, input, config), false);
  });
}
test('numeric strings and actual zero percent remain valid, not synthetic zero', () => {
  assert.equal(buildCheckpointEvidence(input, { ...quote, value: '123.45', changePercent: '0', change: 0 }, config).valid, true);
});
test('09:20 cannot satisfy 09:30; 09:30 cannot satisfy 10:30', () => {
  assert.equal(buildCheckpointEvidence(input, { ...quote, capturedAt: '2026-09-07T09:20:00+08:00' }, config).valid, false);
  assert.equal(buildCheckpointEvidence({ ...input, checkpoint: '1030', observedAt: '2026-09-07T10:30:00+08:00' }, quote, config).valid, false);
});
test('wrong day, phase, future timestamp or correlation fail closed', () => {
  assert.equal(buildCheckpointEvidence(input, { ...quote, capturedAt: '2026-09-06T09:30:00+08:00' }, config).valid, false);
  assert.equal(buildCheckpointEvidence(input, { ...quote, capturedAt: '2026-09-07T09:32:00+08:00' }, config).valid, false);
  assert.equal(checkpointCollectionContract({ ...input, phase: 'close' }).valid, false);
  assert.equal(checkpointCollectionContract({ ...input, tradingDate: '2026-09-06' }).valid, false);
  assert.equal(validRetainedCheckpointRow({ ...row(), correlation_id: 'wrong' }, input, config), false);
});
test('successful evidence can be reused later using its ORIGINAL collection/correlation', () => {
  assert.equal(validRetainedCheckpointRow(row(), { ...input, observedAt: '2026-09-07T14:30:00+08:00' }, config), true);
  assert.deepEqual(quoteFromCheckpointEvidence(row()), quote);
});
test('late new execution is rejected rather than manufacturing prior checkpoint', () => {
  assert.equal(checkpointCollectionContract({ ...input, observedAt: '2026-09-07T10:30:00+08:00' }).valid, false);
});
test('PREMARKET and RECOVERY have separate immutable identities', () => {
  const morning = { ...input, phase: 'premarket', checkpoint: 'premarket', observedAt: '2026-09-07T07:20:00+08:00' };
  assert.equal(checkpointCollectionContract(morning).checkpoint, 'PREMARKET');
  assert.equal(checkpointCollectionContract({ ...morning, observedAt: '2026-09-07T12:00:00+08:00' }).valid, false);
  assert.equal(checkpointCollectionContract({ ...input, phase: 'manual_backfill', checkpoint: 'manual' }).checkpoint, 'RECOVERY');
});
test('close collection retains true official close quote, not a morning price', () => {
  const close = { ...input, phase: 'close', checkpoint: '1410', observedAt: '2026-09-07T14:15:00+08:00' };
  assert.equal(buildCheckpointEvidence(close, { ...quote, capturedAt: '2026-09-07T13:30:00+08:00' }, config).valid, true);
  assert.equal(buildCheckpointEvidence(close, quote, config).valid, false);
});
test('US prior-session timestamps are preserved, not relabelled Taiwan today', () => {
  const q = { ...quote, capturedAt: '2026-09-05T04:00:00+08:00' };
  const r = buildCheckpointEvidence(input, q, { ...config, market: 'US', displaySymbol: 'SPX' });
  assert.equal(r.valid, true);
  assert.equal(r.row.source_timestamp, q.capturedAt);
});

test('verified Production v63 provider lanes, routing, auth dependencies and strategy declarations are preserved', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('docs/operations/core-fetch-source-manifest-20260907.json', root)));
  const source = readFileSync(new URL('supabase/functions/fetch-market-data-v10/index.ts', root), 'utf8');
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(source), manifest.candidate_source_sha256);
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const declarations = new Map(file.statements.flatMap(node => {
    const name = node.name?.getText(file) || node.declarationList?.declarations.map(d => d.name.getText(file)).join(',');
    return name ? [[name, node.getText(file)]] : [];
  }));
  assert.equal(manifest.protected_declarations.length, 43);
  for (const row of manifest.protected_declarations) assert.equal(hash(declarations.get(row.name)), row.sha256, row.name);
  for (const row of manifest.dependencies) assert.equal(hash(readFileSync(new URL(row.path, root))), row.candidate_sha256, row.path);
});
