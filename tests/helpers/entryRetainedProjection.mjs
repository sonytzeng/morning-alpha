import assert from 'node:assert/strict';
import {v2Hash,evaluateV2Shadow} from '../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {entryInputFromV2} from '../../research/entry-v2-adapter.ts';
import {evaluateEntry,STRATEGIES} from '../../research/entry-opportunity.ts';

// Offline research only. Never import this fixture adapter into a Production
// writer: the projection digest is NOT the full retained input digest.
const schema={
 '':'schema original_input_sha256 locked_at canonical_market input expected',
 'canonical_market':'value source_ref observed_at available_at',
 'canonical_market.value':'direction regime',
 'input':'identity data captures sources events events_complete quarterly_actuals benchmark_history v1',
 'input.identity':'report_date revision_id generated_at data_as_of is_trading_day today_date',
 'input.data':'quotes universe',
 'input.data.quotes.*':'id symbol provider trading_date phase session value change_percent captured_at ingested_at raw_payload',
 'input.data.quotes.*.raw_payload':'contract endpoint evidence_session_date provider_is_close',
 'input.data.universe.*':'symbol sector is_active',
 'input.captures.*':'symbol endpoint received_at status payload_hash rows',
 'input.captures.*.rows.*':'id symbol trading_date captured_at ingested_at raw_payload',
 'input.captures.*.rows.*.raw_payload':'contract open high low close volume_shares volume_unit amount_twd amount_unit',
 'input.sources.*':'kind source received_at status http rows',
 'input.sources.*.rows.*':'symbol session source available_at unit period source_date revenue_yoy revenue_mom actual_only consensus foreign trust dealer',
 'input.events.*':'symbol exchange source_ref source_hash published_at available_at event_type event_fact bullishness impact_review raw_retained',
 'input.quarterly_actuals.*':'symbol eps_actual_as_reported available_at period source',
 'input.benchmark_history.*':'date close source available_at',
 'input.v1':'report_date generated_at phase_evaluation',
 'input.v1.phase_evaluation':'candidates',
 'input.v1.phase_evaluation.candidates.*':'symbol status reasons',
 'expected':'counts candidates',
 'expected.counts':'WATCH READY NONE BLOCKED',
 'expected.candidates.*':'symbol status market liquidity relative_strength sector fundamental institutional',
 'expected.candidates.*.market':'daily_change_percent',
 'expected.candidates.*.fundamental':'revenue_yoy revenue_mom period eps_actual_as_reported eps_period eps_basis eps_trend fundamental_direction acceleration acceleration_reason consensus',
 'expected.candidates.*.institutional':'normalized_pressure net_shares foreign trust dealer relative_to_daily_volume unit session',
};
for(const k of ['foreign','trust','dealer']){
 schema['input.sources.*.rows.*.'+k]='buy sell net';
 schema['expected.candidates.*.institutional.'+k]='buy sell net direction';
}
const hosts=new Set(['www.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw','api.fugle.tw']);
export function auditEntryProjection(p){
 const walk=(v,path='')=>{
  if(Array.isArray(v)){for(const x of v)walk(x,path+'.*');return;}
  if(v&&typeof v==='object'){
   assert(schema[path], 'UNREVIEWED_OBJECT_PATH:'+path);
   const allowed=schema[path].split(' ');
   for(const [k,x]of Object.entries(v)){assert(allowed.includes(k),'UNREVIEWED_FIELD:'+path+'.'+k);walk(x,path?path+'.'+k:k);}
  }else if(typeof v==='string'){
   assert(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(v),'EMAIL_NOT_ALLOWED');
   assert(!/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer |sb_secret_|sbp_/.test(v),'CREDENTIAL_NOT_ALLOWED');
   if(v.startsWith('https://')){const u=new URL(v);assert(hosts.has(u.hostname)&&!u.username&&!u.password,'UNREVIEWED_SOURCE');
    assert([...u.searchParams.keys()].every(k=>['date','response','selectType'].includes(k)),'UNREVIEWED_SOURCE_QUERY');}
  }
 };walk(p);
 assert.equal(p.schema,'ENTRY_MINIMIZED_RETAINED_V1');
 assert.match(p.original_input_sha256,/^[a-f0-9]{64}$/);
 assert(p.input.captures.every(c=>c.endpoint==='historical/candles'),'UNNECESSARY_PROVIDER_CAPTURE');
 assert(p.input.data.quotes.every(q=>q.symbol==='TAIEX'),'UNNECESSARY_MARKET_QUOTE');
 assert(Number.isFinite(Date.parse(p.locked_at))&&Date.parse(p.locked_at)>=Date.parse(p.input.identity.generated_at),'SOURCE_LOCK_TIME_INVALID');
 return {privacy:'PASS',full_provider_payload_retained:false,production_write:false};
}
export async function replayEntryProjection(p,{projectionSha256,provenance}){
 auditEntryProjection(p);
 assert(['REAL_RETAINED','SYNTHETIC_TEST'].includes(provenance));
 assert.equal(await v2Hash(p),projectionSha256,'PROJECTION_HASH_MISMATCH');
 const baseline=await evaluateV2Shadow(p.input);
 const actual=baseline.candidates.map(c=>Object.fromEntries([
  ['symbol',c.symbol],['status',c.status],...['market','liquidity','relative_strength','sector','fundamental','institutional'].map(k=>[k,c.evidence[k].value]),
 ]));
 assert.deepEqual(baseline.counts,p.expected.counts,'SAVED_V2_COUNTS_DRIFT');
 assert.deepEqual(actual,p.expected.candidates,'SAVED_V2_FACTS_DRIFT');
 const normalized=await entryInputFromV2(p.input,await v2Hash(p.input),p.canonical_market,'HISTORICAL_REPLAY',provenance);
 const result=await evaluateEntry(normalized);
 assert.deepEqual(result,await evaluateEntry(structuredClone(normalized)),'NON_DETERMINISTIC_REPLAY');
 assert.equal(result.forward_sample,0);assert.equal(result.outcome_sample,0);
 const states=['ENTRY_READY','WAIT_CONFIRMATION','AVOID_ENTRY','INSUFFICIENT_EVIDENCE'];
 const counts=cs=>Object.fromEntries(states.map(s=>[s,cs.filter(c=>c.status===s).length]));
 const missing=normalized.stocks.filter(s=>s.sector_return===null).map(s=>({symbol:s.symbol,field:'sector_return',
  source:'AS_OF_V2_UNIVERSE_AND_COMPLETED_PEER_CANDLES',required_valid_peers:3,
  mapped_peers:p.input.data.universe.filter(x=>x.symbol!==s.symbol&&x.sector===p.input.data.universe.find(x=>x.symbol===s.symbol)?.sector).length}));
 return {result,normalized,summary:{date:result.business_date,cutoff:result.evaluation_time,source_locked_at:p.locked_at,
  original_input_sha256:p.original_input_sha256,original_hash_verification:'RETAINED_LEDGER_ATTESTATION_NOT_RECOMPUTED_FROM_PROJECTION',
  projection_sha256:projectionSha256,projection_input_sha256:await v2Hash(p.input),provenance,
  saved_v2_diff:0,universe:result.universe,scanned:result.scanned,counts:result.counts,
  strategies:Object.fromEntries(STRATEGIES.map(s=>[s,counts(result.candidates.filter(c=>c.strategy===s))])),
  missing,official_events_require_review:baseline.candidates.filter(c=>c.pending.includes('MATERIAL_EVENT_IMPACT_UNASSESSED')).length,
  historical_only:true,forward_sample:0,outcome_sample:0,production_writes:0,analysis_value:'INSUFFICIENT_SAMPLE'}};
}
