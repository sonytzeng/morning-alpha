import test from 'node:test';
import assert from 'node:assert/strict';
import {historySessions,auditHistory,fugleHistoryRequest,auditRetainedHistory,ENTRY_LOOKBACKS} from '../research/entry-history.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
test('strategy-specific frozen inputs, calendar-based 20/60/120 plans, not 65 calendar days',()=>{
 assert.deepEqual(ENTRY_LOOKBACKS.PULLBACK_ENTRY,{slow_average:20,fast_average:10,support:5,volume_comparison:6,confirmation:2});
 assert.equal(ENTRY_LOOKBACKS.OVERSOLD_REVERSAL.selling_pressure,6);assert.equal(ENTRY_LOOKBACKS.BREAKOUT_CONTINUATION.resistance_and_volume,20);
 for(const n of [20,60,120]){const dates=historySessions('2026-10-08',n);assert.equal(dates.length,n);assert.equal(new Set(dates).size,n);assert.equal(dates.at(-1),'2026-10-07');
  const request=fugleHistoryRequest('2330','2026-10-08',n);assert.equal(new URL(request.url).searchParams.get('adjusted'),'false');assert.equal(request.executed,false);assert.equal(request.expected_sessions.length,n);}
 assert.throws(()=>fugleHistoryRequest('../secret','2026-10-08',20),/SYMBOL/);
 assert.throws(()=>historySessions('2026-10-10',20),/INVALID/);
});
test('coverage rejects missing days, duplicates, bad units/values, backdated and late availability',()=>{
 const bars=historySessions('2026-10-08',120).map(date=>({date,open:100,close:101,high:102,low:99,volume:1e6,amount:1e8,source_ref:'SYNTHETIC_HISTORY',available_at:date+'T15:00:00+08:00'}));
 const at='2026-10-08T08:00:00+08:00';assert(auditHistory(bars,'2026-10-08',at,120).complete);
 assert.equal(auditHistory(bars.slice(-45),'2026-10-08',at,60).valid,45);
 for(const mutate of [b=>b.pop(),b=>b.push(b.at(-1)),b=>b.at(-1).amount=0,b=>b.at(-1).available_at='2026-10-09',b=>b.at(-1).available_at=b.at(-1).date+'T08:00:00+08:00']){
  const c=structuredClone(bars);mutate(c);assert.equal(auditHistory(c,'2026-10-08',at,20).complete,false);}
});
test('retained integration binds hash, reports real peer coverage without substituting fake peers',async()=>{
 const input=v2Fixture();const report=await auditRetainedHistory(input,await v2Hash(input));
 assert.equal(report.stocks.length,72);assert.equal(report.forward_sample,0);assert.equal(report.corporate_action_proof,'NOT_PRESENT_IN_RETAINED_V2_CONTRACT');
 assert.equal(report.coverage[60],0);assert.equal(report.coverage[120],0);
 await assert.rejects(auditRetainedHistory(input,'0'.repeat(64)),/HASH/);
 input.data.universe.push(input.data.universe[0]);await assert.rejects(auditRetainedHistory(input,await v2Hash(input)),/DUPLICATE/);
});
