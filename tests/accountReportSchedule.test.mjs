import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
import {resolveMarketStatus} from '../src/lib/market-status.ts';

const body=readFileSync(new URL('../src/pages/account/components/MorningHeroCard.tsx',import.meta.url),'utf8');
const next=isolatedFunction(body,'nextScheduledReportLabel',{resolveMarketStatus,exports:{}});

test('Friday after07:30 and weekend display the next legal Monday, not tomorrow',()=>{
 for(const t of ['2026-10-16T00:00:00Z','2026-10-17T05:00:00Z','2026-10-18T15:59:59Z'])
  assert.equal(next(new Date(t)),'2026-10-19 07:30');
});
test('official holiday and Taipei day rollover are not browser-local calendar days',()=>{
 assert.equal(next(new Date('2026-10-08T00:00:00Z')),'2026-10-12 07:30');
 assert.equal(next(new Date('2026-10-09T00:00:00Z')),'2026-10-12 07:30');
 assert.equal(next(new Date('2026-10-15T23:29:59Z')),'2026-10-16 07:30');
 assert.equal(next(new Date('2026-10-15T23:30:00Z')),'2026-10-19 07:30');
});
test('invalid or unsupported calendar dates do not invent an opening or update time',()=>{
 assert.equal(next(new Date(NaN)),'交易日待確認');
 assert.equal(next(new Date('2027-01-04T00:00:00Z')),'交易日待確認');
 assert.equal(next(new Date('2026-12-31T01:00:00Z')),'交易日待確認');
});
test('unpublished report still waits for actual evidence and copy never promises future data readiness',()=>{
 assert.match(body,/unpublished \? '等待有效市場資料' : nextScheduledReportLabel\(new Date\(\)\)/);
 assert.doesNotMatch(body,/'明日 07:30'/);
 assert.match(body,/依台灣交易日排程更新/);
});
