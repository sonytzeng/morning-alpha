// Explicit private real-data replay, not part of public CI or synthetic proof.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {emptyEvidenceData,loadDecisionEvidence,DATA_QUERIES} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {eventAlignmentFromDailyReceipts,eventAlignmentFromRetainedEvidence,withObservedCanonicalSectors} from '../research/recommendation-event-alignment-candidate.ts';
import {replayEventAlignmentSample,saveEventAlignmentReceipt,SAMPLE_SYMBOLS} from '../scripts/vnext/event-alignment-audit.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Human-supplied, minimal read-only observation; NOT independently re-queried
// here. Exact original values; no company names, identities or expanded export.
export const REAL_CANONICAL_OBSERVATION=Object.freeze({source:'public.sector_stock_map',observed_at:'2026-10-17T07:27:11.145456Z',rows:[
 {symbol:'2303',sector:'半導體',is_active:true,created_at:'2026-06-08T02:23:01.665616Z',updated_at:'2026-06-08T02:23:01.665616Z'},
 {symbol:'2330',sector:'半導體',is_active:true,created_at:'2026-06-08T02:23:01.665616Z',updated_at:'2026-06-08T02:23:01.665616Z'},
 {symbol:'2344',sector:'記憶體',is_active:true,created_at:'2026-06-08T02:23:01.665616Z',updated_at:'2026-06-08T02:23:01.665616Z'},
]});
export async function verifyRetainedEventAlignment(){
 const bytes=readFileSync(new URL('./fixtures/recommendation-retained-20261006.json',import.meta.url)),capsule=JSON.parse(bytes),raw=gunzipSync(Buffer.from(capsule.data,'base64'));
 assert.equal(hash(raw),capsule.sha256);const retained={...emptyEvidenceData(),...JSON.parse(raw)},runs=[];
 for(const[date,cutoff]of Object.entries({'2026-10-02':'2026-10-01T23:05:19.521Z','2026-10-05':'2026-10-04T23:05:25.164Z','2026-10-06':'2026-10-05T23:05:13.729Z'})){
  const identity={report_date:date,today_date:date,generated_at:cutoff,data_as_of:cutoff,revision_id:'isolated-retained-event:'+date,is_trading_day:true};
  const data=await loadDecisionEvidence(async q=>{const key=Object.keys(DATA_QUERIES).find(k=>DATA_QUERIES[k].table===q.table);return {data:retained[key].filter(r=>q.filters.every(f=>f.operator==='lte'?Date.parse(r[f.column])<=Date.parse(f.value):Date.parse(r[f.column])>=Date.parse(f.value))).sort((a,b)=>Date.parse(b[q.order])-Date.parse(a[q.order])).slice(0,q.limit),error:null};},identity);
  const baseline=buildEvidenceDecision(data,identity),sourceHash=await v2Hash(data),candidate=await eventAlignmentFromRetainedEvidence(data,identity,sourceHash);
  assert.deepEqual(candidate.decision,baseline,'Original retained V1 must remain byte-equivalent');assert.equal(await v2Hash(data),sourceHash);
  assert.equal(candidate.decision.phase_evaluation.blocked_count,72);assert.equal(candidate.decision.phase_evaluation.ready_count,0);
  assert.equal(candidate.same_date_totals.denominator,1440);assert.equal(candidate.same_date_totals.stock_ohlcv_amount,0);
  assert(candidate.coverage.every(c=>c.causal_review==='REVIEWED_CAUSAL_EVENT_MISSING'));assert.equal(candidate.resource_license,'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED');
  runs.push({date,cutoff,source_sha256:sourceHash,decision_sha256:await v2Hash(baseline),unchanged_v1_equivalent:true,
   status:candidate.decision.phase_evaluation.status,blocked:72,ready:0,same_date_totals:candidate.same_date_totals,coverage:candidate.coverage});
 }
 return {fixture_physical_sha256:hash(bytes),fixture_normalized_bytes_sha256:hash(raw),runs};
}
export async function verifyRealEventAlignment(file){
 const {sample,result,summary}=await replayEventAlignmentSample(file);
 assert.equal(result.coverage.length,3,'Must actually retain all three real symbols');
 for(const symbol of SAMPLE_SYMBOLS){
  const c=result.coverage.find(c=>c.symbol===symbol);assert(c);
  assert(c.canonical_closes>=20,'Real OHLCV window missing: '+symbol);
  assert(c.benchmark_same_sessions>=20,'Real TAIEX join missing: '+symbol);
  assert.equal(c.causal_review,'REVIEWED_CAUSAL_EVENT_MISSING');
  assert.equal(c.sector_mapping,'AS_OF_CANONICAL_SECTOR_MAPPING_MISSING');
  assert.equal(c.current_official_industry_peers.length,2);
  assert.equal(c.same_date.denominator,20);assert.equal(c.same_date.stock_ohlcv_and_taiex,20);
 }
 assert.equal(result.data.mappings.length,0);assert.equal(result.data.universe.length,0);
 assert.equal(result.production_eligible,false);assert.deepEqual(result.business_writes,[]);
 assert.equal(result.issues.length,0,'Real source conflicts must not be hidden');
 assert.equal(sample.requests,10);assert(sample.response_bytes_observed<=sample.limits.aggregate_bytes);assert.equal(sample.failures.length,0);
 for(const receipt of sample.receipts){
  assert.equal(receipt.first_seen_at,receipt.available_at);assert(Date.parse(receipt.first_seen_at)>=Date.parse(sample.started_at));
 }
 // Genuine newly retrieved bytes cannot repair the earlier saved report.
 const old={...sample.identity,report_date:'2026-10-08',today_date:'2026-10-08',generated_at:'2026-10-08T06:33:01.624Z',data_as_of:'2026-10-08T06:33:01.624Z',is_trading_day:true};
 const rejected=await eventAlignmentFromDailyReceipts(old,emptyEvidenceData(),sample.receipts);
 assert.equal(rejected.data.quotes.length,0);assert(rejected.issues.some(r=>r.startsWith('EVENT_ALIGNMENT_RECEIPT_NOT_ADMISSIBLE:')));
 assert.equal(rejected.same_date_totals.denominator,60);assert.equal(rejected.same_date_totals.stock_ohlcv_and_taiex,0);
 const observationHash=await v2Hash(REAL_CANONICAL_OBSERVATION);
 const joined=await withObservedCanonicalSectors(emptyEvidenceData(),sample.identity,REAL_CANONICAL_OBSERVATION,observationHash);
 assert.equal(joined.status,'CURRENT_OBSERVATION_JOINED');assert.deepEqual(joined.data.universe,REAL_CANONICAL_OBSERVATION.rows);
 const current=await eventAlignmentFromDailyReceipts(sample.identity,joined.data,sample.receipts);
 assert.deepEqual(current.decision,buildEvidenceDecision(current.data,sample.identity));assert.equal(current.issues.length,0);
 for(const symbol of SAMPLE_SYMBOLS){const c=current.coverage.find(c=>c.symbol===symbol);assert.equal(c.sector_mapping,'SECTOR_PEERS_INSUFFICIENT');assert.equal(c.canonical_peer_symbols.length,symbol==='2344'?0:1);assert.equal(c.same_date.stock_ohlcv_and_taiex,20);}
 assert.equal(current.data.universe.find(r=>r.symbol==='2344').sector,'記憶體');assert.equal(current.data.mappings.length,0);
 const past=await withObservedCanonicalSectors(emptyEvidenceData(),old,REAL_CANONICAL_OBSERVATION,observationHash);
 assert.equal(past.status,'UNKNOWN');assert.equal(past.data.universe.length,0,'June row timestamps cannot backdate October observation');
 const altered=structuredClone(REAL_CANONICAL_OBSERVATION);altered.rows.find(r=>r.symbol==='2344').sector='半導體';
 assert.equal((await withObservedCanonicalSectors(emptyEvidenceData(),sample.identity,altered,observationHash)).status,'UNKNOWN','Do not rewrite Memory to fill peer count');
 const retained=await verifyRetainedEventAlignment();
 const evaluatorHash=hash(readFileSync(new URL('../supabase/functions/_shared/decision-v1-evidence.ts',import.meta.url)));
 assert.equal(evaluatorHash,'2ef106edc162fb28b7579322dff9b89057b184a2166f51ce57ed31781190d848');
 const evidence={schema:'EVENT_ALIGNMENT_REAL_AUDIT_V2',evaluator_sha256:evaluatorHash,
  candidate_sha256:hash(readFileSync(new URL('../research/recommendation-event-alignment-candidate.ts',import.meta.url))),
  script_sha256:hash(readFileSync(new URL('../scripts/vnext/event-alignment-audit.mjs',import.meta.url))),
  test_sha256:hash(readFileSync(new URL('./recommendationEventAlignmentReal.integration.mjs',import.meta.url))),
  retained,official:summary,current_canonical:{observation:REAL_CANONICAL_OBSERVATION,observation_sha256:observationHash,
   retrieval:'USER_SUPPLIED_READ_ONLY_OBSERVATION_NOT_REQUERIED',available_at_conservative_ms:joined.available_at_conservative_ms,
   candidate_input_sha256:current.candidate_input_sha256,coverage:current.coverage,decision_sha256:await v2Hash(current.decision),unchanged_v1_equivalent:true},
  historical_cutoff_rejected:true,resource_license:'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED',reviewed_causal_events:0,production_operations:0,
  limitation:'Official current sample is a non-trading-day source join, not a full trading-phase gate PASS; three original retained trading-cutoff runs execute full V1 and remain BLOCKED.'};
 const receipt=await saveEventAlignmentReceipt(resolve(file,'..'),evidence);
 return {real_offline_integration:'PASS',receipt,evaluator_sha256:evaluatorHash,official_same_date:current.same_date_totals,
  retained_cutoffs:retained.runs.map(({coverage,...r})=>r),canonical_peer_counts:Object.fromEntries(current.coverage.map(c=>[c.symbol,c.canonical_peer_symbols.length])),
  sector_2344:'記憶體',reviewed_causal_events:0,resource_license:evidence.resource_license,historical_cutoff_rejected:true,not_a_trading_or_production_pass:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 globalThis.fetch=()=>{throw Error('OFFLINE_REAL_REPLAY_NO_NETWORK');};
 if(!process.argv[2])throw Error('EXPLICIT_PRIVATE_SAMPLE_REQUIRED');
 console.log(JSON.stringify(await verifyRealEventAlignment(process.argv[2])));
}
