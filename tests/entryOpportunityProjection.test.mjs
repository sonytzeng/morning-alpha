import test from 'node:test';
import assert from 'node:assert/strict';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {v2Hash,evaluateV2Shadow} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {auditEntryProjection,replayEntryProjection} from './helpers/entryRetainedProjection.mjs';
import {entryPrivatePathOutsideRepository} from './entryOpportunityRealReplay.integration.mjs';
import {resolve} from 'node:path';
const pick=(v,keys)=>Object.fromEntries(keys.split(' ').filter(k=>k in v).map(k=>[k,v[k]]));
async function fixture(){
 const input=v2Fixture(),baseline=await evaluateV2Shadow(input),original=await v2Hash(input);
 input.data={quotes:input.data.quotes.map(q=>({...pick(q,'id symbol provider trading_date phase session value change_percent captured_at ingested_at'),
  raw_payload:q.raw_payload?pick(q.raw_payload,'contract endpoint evidence_session_date provider_is_close'):null})),
  universe:input.data.universe.map(s=>pick(s,'symbol sector is_active'))};
 input.captures=input.captures.map(c=>({...pick(c,'symbol endpoint received_at status payload_hash'),rows:c.rows.map(b=>({
  ...pick(b,'id symbol trading_date captured_at ingested_at'),raw_payload:pick(b.raw_payload,'contract open high low close volume_shares volume_unit amount_twd amount_unit')}))}));
 input.v1={...pick(input.v1,'report_date generated_at'),phase_evaluation:{candidates:[]}};
 const at=input.identity.generated_at;
 return {schema:'ENTRY_MINIMIZED_RETAINED_V1',original_input_sha256:original,locked_at:at,
  canonical_market:{value:{direction:'偏弱',regime:'range'},source_ref:'SYNTHETIC_CANONICAL',observed_at:at,available_at:at},input,
  expected:{counts:baseline.counts,candidates:baseline.candidates.map(c=>Object.fromEntries([['symbol',c.symbol],['status',c.status],
   ...['market','liquidity','relative_strength','sector','fundamental','institutional'].map(k=>[k,c.evidence[k].value])]))}};
}
test('minimized projection replays exact V2 facts without claiming its hash is the original capsule hash',async()=>{
 const p=await fixture(),hash=await v2Hash(p),before=structuredClone(p);
 const r=await replayEntryProjection(p,{projectionSha256:hash,provenance:'SYNTHETIC_TEST'});
 assert.deepEqual(p,before);assert.equal(r.summary.saved_v2_diff,0);assert.equal(r.result.candidates.length,216);
 assert.notEqual(r.summary.original_input_sha256,r.summary.projection_input_sha256);
 assert.equal(r.result.source_evidence_hash,r.summary.projection_input_sha256);
 assert.equal(r.result.provenance,'SYNTHETIC_TEST');assert.equal(r.result.forward_sample,0);
});
test('privacy whitelist rejects contacts, credentials, arbitrary raw payload, extra symbols and source query credentials',async()=>{
 assert.equal(entryPrivatePathOutsideRepository(process.cwd()),false);
 assert.equal(entryPrivatePathOutsideRepository(resolve('..not-a-parent')),false);
 assert.equal(entryPrivatePathOutsideRepository(resolve('..')),true);
 const base=await fixture();
 for(const mutate of [p=>p.email='x@example.com',p=>p.input.data.universe[0].owner_id='private',
  p=>p.input.captures[0].rows[0].raw_payload.unreviewed={},p=>p.input.sources[0].source='https://www.twse.com.tw/?api_key=not-real',
  p=>p.input.data.quotes[0].symbol='2330',p=>p.canonical_market.source_ref='Bearer synthetic-not-a-secret',
  p=>p.canonical_market.value.direction='x@example.com']){
  const p=structuredClone(base);mutate(p);assert.throws(()=>auditEntryProjection(p));
 }
});
test('projection corruption and baseline mismatch stop replay; invalid cutoff evidence is never promoted',async()=>{
 const base=await fixture(),hash=await v2Hash(base);
 const tampered=structuredClone(base);tampered.input.captures[0].rows[0].raw_payload.close+=1;
 await assert.rejects(replayEntryProjection(tampered,{projectionSha256:hash,provenance:'SYNTHETIC_TEST'}),/HASH/);
 const mismatch=structuredClone(base);mismatch.expected.candidates[0].status='WRONG';
 await assert.rejects(replayEntryProjection(mismatch,{projectionSha256:await v2Hash(mismatch),provenance:'SYNTHETIC_TEST'}),/FACTS_DRIFT/);
 const future=structuredClone(base);future.input.captures[0].received_at='2999-01-01T00:00:00Z';
 await assert.rejects(replayEntryProjection(future,{projectionSha256:await v2Hash(future),provenance:'SYNTHETIC_TEST'}),/DRIFT/);
});
