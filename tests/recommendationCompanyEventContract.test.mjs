// Synthetic parser regressions only; not official facts, causal approval or E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMPANY_EVENT_SOURCES, normalizeCompanyEvents, acquireCompanyEvents} from '../supabase/functions/_shared/recommendation-company-events.ts';
const source = COMPANY_EVENT_SOURCES[0], received = '2026-09-07T01:00:00.000Z';
const row = (symbol='2330') => ({'公司代號':symbol,'發言日期':'1150907','發言時間':'080000',
  '主旨 ':'SYNTHETIC_SOURCE_SUBJECT','說明':'PRIVATE_EXPLANATION_NOT_RETAINED'});

test('receipt requires explicit timezone and a real calendar rather than Date.parse normalization',async()=>{
  for(const at of ['2026-09-07T09:00:00','2026-09-31T01:00:00Z','2026-09-07T24:00:00Z',
    '2026-09-07','2026-09-07T01:00:00.000001Z']){
    await assert.rejects(normalizeCompanyEvents(source,[row()],at,['2330']),/COMPANY_EVENT_CONTRACT/);
  }
  for(const at of [received,'2026-09-07T09:00:00+08:00']){
    const out=await normalizeCompanyEvents(source,[row()],at,['2330']);
    assert.equal(out[0].available_at,at);assert.equal(out[0].published_at,'2026-09-07T00:00:00.000Z');
  }
});
test('conflicting issuer aliases cannot silently attribute an official announcement to either stock',async()=>{
  for(const primary of ['2330','9999']){
    const input={...row(primary),SecuritiesCompanyCode:'2317'};
    await assert.rejects(normalizeCompanyEvents(source,[input],received,['2330','2317']),/COMPANY_EVENT_FIELD_CONFLICT/);
  }
  const consistent={...row(),SecuritiesCompanyCode:2330};
  assert.deepEqual(await normalizeCompanyEvents(source,[consistent],received,['2330']),
    await normalizeCompanyEvents(source,[row()],received,['2330']));
});
test('contradictory subject labels cannot choose a different official identifying hash',async()=>{
  await assert.rejects(normalizeCompanyEvents(source,[{...row(),'主旨':'DIFFERENT_SYNTHETIC_SUBJECT'}],received,['2330']),
    /COMPANY_EVENT_FIELD_CONFLICT/);
  const consistent={...row(),'主旨':' SYNTHETIC_SOURCE_SUBJECT '};
  assert.deepEqual(await normalizeCompanyEvents(source,[consistent],received,['2330']),
    await normalizeCompanyEvents(source,[row()],received,['2330']));
});
test('all event identities and source labels are captured before asynchronous hashing',async()=>{
  const mutable={...source},rows=[row('2330'),row('2317')];
  const expected=await normalizeCompanyEvents(source,structuredClone(rows),received,['2330','2317']);
  const pending=normalizeCompanyEvents(mutable,rows,received,['2330','2317']);
  mutable.url='https://example.test/UNAPPROVED';mutable.exchange='TPEX';
  rows[1]['公司代號']='9999';rows[1]['主旨 ']='MUTATED_AFTER_VERIFICATION';
  assert.deepEqual(await pending,expected);
});
test('source allowlist identities are immutable, including their nested records',()=>{
  assert(Object.isFrozen(COMPANY_EVENT_SOURCES));
  assert(COMPANY_EVENT_SOURCES.every(Object.isFrozen));
});
test('malformed public response is isolated without credentials, retries or contact reflection',async()=>{
  const calls=[];
  const result=await acquireCompanyEvents({symbols:['2330'],now:()=>received,signal:AbortSignal.timeout(2000),
    fetcher:async(url,init)=>{calls.push(url);assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');
      return Response.json([{...row(),SecuritiesCompanyCode:'2317'}]);}});
  assert.deepEqual(calls,COMPANY_EVENT_SOURCES.map(s=>s.url));
  assert(result.every(r=>r.status==='SOURCE_UNAVAILABLE_OR_INVALID'&&r.events.length===0));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_EXPLANATION|SYNTHETIC_SOURCE_SUBJECT|DIFFERENT/);
});
