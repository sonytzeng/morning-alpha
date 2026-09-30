import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previousMarketTradingDate, GLOBAL8_SOURCE_SYMBOLS, validateGlobal8Session } from '../supabase/functions/_shared/market-session-contract.mjs';
import { classifyCanonicalFailure, evaluateProviderRetryEntry, selectPrimaryFailure } from '../supabase/functions/_shared/provider-failure-contract.mjs';
import { classifyRequiredProviderFailure } from '../supabase/functions/_shared/required-provider-validation.mjs';
import { classifyProviderFailure } from '../supabase/functions/_shared/market-runtime-stability.mjs';
import { checkpointCollectionContract } from '../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';
import { isSnapshotInCloseWindow } from '../supabase/functions/_shared/intraday-runtime-contract.ts';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';

test('official calendar data is identical across runtime boundaries', () => {
  assert.equal(readFileSync(new URL('../src/lib/market-calendar-data.json', import.meta.url),'utf8'),
    readFileSync(new URL('../supabase/functions/_shared/market-calendar-data.json', import.meta.url),'utf8'));
});
for (const [day, expected] of [['2026-09-30','2026-09-29'], ['2026-09-21','2026-09-18'], ['2026-09-29','2026-09-24'],
  ['2026-10-27','2026-10-23'], ['2026-05-04','2026-04-30'], ['2026-02-23','2026-02-11'], ['2026-01-02','2025-12-31']]) {
  test(`TW authoritative previous session ${day}`, () => assert.equal(previousMarketTradingDate('TW',day),expected));
}

test('18:00 precision difference remains NON_REACHABLE_GUARDED_RISK, not a weakened business gate',()=>{
  const date='2026-09-30',correlationId='10000000-0000-4000-8000-000000000001';
  for(const time of ['17:59:59.999','18:00:00.000','18:00:00.001']){
    const stamp=`${date}T${time}+08:00`;
    // Document the isolated legacy helper instead of claiming it has exact-ms
    // parity. The real 14:10/14:30 collection guard rejects all three inputs.
    assert.equal(isSnapshotInCloseWindow({symbol:'TAIEX',phase:'close',trading_date:date,value:100,change_percent:0,source:'AUDITED_FIXTURE',captured_at:stamp},date),true);
    for(const checkpoint of ['1410','1430'])assert.deepEqual(checkpointCollectionContract({phase:'close',checkpoint,tradingDate:date,observedAt:stamp,correlationId}),{valid:false,error:'OUTSIDE_REAL_CHECKPOINT_WINDOW'});
  }
});

test('shared taxonomy rollout preserves the existing deployed News 429 bounded cooldown',async()=>{
 const source=readFileSync(new URL('../supabase/functions/fetch-global-market-news/index.ts',import.meta.url),'utf8');
 let calls=0;const waits=[];
 const fetchGNews=isolatedFunction(source,'fetchGNews',{PROVIDER_FETCH_TIMEOUT_MS:5000,AbortController,
  fetch:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'100'}});},
  setTimeout:(fn,ms)=>{waits.push(ms);if(ms<=2000)queueMicrotask(fn);return 1;},clearTimeout:()=>{}});
 const failures=[];const items=await fetchGNews('LOCAL_FAKE',[],failures);assert(Array.isArray(items));assert.equal(items.length,0);
 assert.equal(calls,1);assert(waits.includes(2000));assert.equal(classifyProviderFailure(failures[0]).failure_code,'PROVIDER_RATE_LIMIT');
});
for (const [key, symbol] of Object.entries(GLOBAL8_SOURCE_SYMBOLS)) {
  test(`${key} latest completed US session, stale, holiday and future`, () => {
    const verify = (source,now) => validateGlobal8Session(key,symbol,source,now).valid;
    assert.equal(verify('2026-09-29T20:00:00Z','2026-09-29T23:00:00Z'),true);
    assert.equal(verify('2026-09-28T20:00:00Z','2026-09-29T23:00:00Z'),false);
    assert.equal(verify('2026-09-25T20:00:00Z','2026-09-27T23:00:00Z'),true);
    assert.equal(verify('2026-09-04T20:00:00Z','2026-09-07T23:00:00Z'),true);
    assert.equal(verify('2026-09-29T23:00:00.001Z','2026-09-29T23:00:00Z'),false);
    assert.equal(verify('2026-09-21T20:00:00Z','2026-09-29T23:00:00Z'),false);
    assert.equal(verify('2026-11-27T18:00:00Z','2026-11-27T23:00:00Z'),true);
    assert.equal(verify('2025-12-31T21:00:00Z','2026-01-01T23:00:00Z'),true);
  });
}
for (const [failure,code,retryable] of [
  [{status:403},'PROVIDER_ENTITLEMENT',false], [{status:401},'PROVIDER_ENTITLEMENT',false],
  [{status:429},'PROVIDER_RATE_LIMIT',true], [{status:500},'PROVIDER_HTTP_5XX',true],
  [{error:'TIMEOUT'},'PROVIDER_TIMEOUT',true], [{error:'TEMPORARY_MALFORMED_RESPONSE'},'PROVIDER_INVALID_RESPONSE',true],
  [{error:'PROVIDER_FUTURE_EVIDENCE'},'PROVIDER_INVALID_RESPONSE',false],
  [{error:'PROVIDER_RESPONSE_CONTRACT_INVALID'},'PROVIDER_INVALID_RESPONSE',false],
]) {
  test(`shared classification and bounded retry ${JSON.stringify(failure)}`, () => {
    const input={...failure,symbol:'TXF',endpoint:'futopt'};
    const classified=classifyProviderFailure(input);
    assert.equal(classified.failure_code,code);
    assert.equal(classified.retryable,retryable);
    assert.equal(classifyRequiredProviderFailure(input),code);
    assert.equal(classifyCanonicalFailure(classified).retryable,retryable);
    assert.equal(selectPrimaryFailure([input],'ATOMIC_CARDINALITY').primary,code);
    for (const time of ['07:00','07:40','08:00','08:30','08:35','08:44']) {
      const result=evaluateProviderRetryEntry({phase:'premarket',atomicBatchId:null,tradingDate:'2026-09-30',
        observedAt:`2026-09-30T${time}:00+08:00`, failures:[classified,{symbol:'TXF',endpoint:'atomic_checkpoint_assembly',failure_code:'ATOMIC_CARDINALITY'}]});
      assert.equal(result.waiting,retryable,time);
    }
    assert.equal(evaluateProviderRetryEntry({phase:'premarket',atomicBatchId:null,tradingDate:'2026-09-30',
      observedAt:'2026-09-30T08:45:00+08:00',failures:[classified]}).waiting,false);
  });
}
