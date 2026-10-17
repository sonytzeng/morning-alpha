import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {V2_INDEX_URL} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {normalizeSource} from '../src/features/vnext/dailyAdapter.ts';
import {historyUrl} from '../research/entry-official-history.ts';
import {eventAlignmentFromDailyReceipts,eventAlignmentFromV2,withObservedCanonicalSectors} from '../research/recommendation-event-alignment-candidate.ts';
import {acquireEventAlignmentSample,replayEventAlignmentSample,eventAlignmentSamplePlan,OFFICIAL_SAMPLE_LIMITS,saveEventAlignmentReceipt} from '../scripts/vnext/event-alignment-audit.mjs';
import {REAL_CANONICAL_OBSERVATION} from './recommendationEventAlignmentReal.integration.mjs';

// These invented market values/review assertions test contracts, NOT real data.
const identity={...IDENTITY,generated_at:'2026-09-07T00:30:00Z',data_as_of:'2026-09-07T00:30:00Z'};
const received='2026-09-06T23:00:00Z',symbols=['2330','2317','2382'];
const dates=[];let d=identity.report_date;for(let i=0;i<23;i++){d=previousMarketTradingDate('TW',d);dates.unshift(d);}
const roc=date=>String(Number(date.slice(0,4))-1911)+date.slice(4).replaceAll('-','/');
async function receipts(){
 const out=[];
 for(const month of [...new Set(dates.map(d=>d.slice(0,7)))]){
  for(const symbol of symbols){
   const task={key:symbol+month,kind:'PRICE',url:historyUrl('TWSE',symbol,month),format:'json',scope:'SYNTHETIC_TEST',symbols:[symbol],exchange:'TWSE',month,max_age_days:0};
   const raw={stat:'OK',date:month.replace('-','')+'01',title:symbol+' 隔離合成',fields:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:dates.filter(d=>d.startsWith(month)).map(date=>[roc(date),'1000000','100000000','100','110','99',String(100+dates.indexOf(date)/10)])};
   const payload=await normalizeSource(task,raw,received);out.push({task,first_seen_at:received,available_at:received,published_at:null,as_of:received,version:'SYNTHETIC_TEST',raw_hash:await snapshotHash(raw),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
  }
  const task={key:'index'+month,kind:'BENCHMARK',url:V2_INDEX_URL+'?date='+month.replace('-','')+'01&response=json',format:'json',scope:'SYNTHETIC_TEST',symbols:['TAIEX'],month,max_age_days:0};
  const raw={stat:'OK',date:month.replace('-','')+'01',fields:['日期','開盤指數','最高指數','最低指數','收盤指數'],data:dates.filter(d=>d.startsWith(month)).map(date=>[roc(date),'20000','21000','19900',String(20000+dates.indexOf(date))])};
  const payload=await normalizeSource(task,raw,received);out.push({task,first_seen_at:received,available_at:received,published_at:null,as_of:received,version:'SYNTHETIC_TEST',raw_hash:await snapshotHash(raw),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
 }
 const task={key:'directory',kind:'DIRECTORY',url:'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',format:'json',scope:'SYNTHETIC_TEST',symbols,exchange:'TWSE',max_age_days:0};
 const raw=symbols.map(symbol=>({'公司代號':symbol,'公司名稱':'隔離合成','產業別':'24','上市日期':'0830905'})),payload=await normalizeSource(task,raw,received);
 out.push({task,first_seen_at:received,available_at:received,published_at:null,as_of:received,version:'SYNTHETIC_TEST',raw_hash:await snapshotHash(raw),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null});
 return out;
}
function canonical(){const data=evidenceRows();data.quotes=data.quotes.filter(q=>!symbols.includes(q.symbol)&&q.symbol!=='TAIEX');return data;}
async function reviews(data){return await Promise.all(data.mappings.map(async mapping=>{const catalyst=data.catalysts.find(c=>c.id===mapping.catalyst_id),event=data.news[0];return {mapping_id:mapping.id,event_id:event.id,reviewed_at:'2026-09-07T00:10:00Z',evidence_sha256:await v2Hash({mapping,catalyst,event})};}));}
async function resign(receipt){receipt.payload_hash=await snapshotHash(receipt.payload);}

test('SYNTHETIC: real parser shapes join 22 closes, TAIEX and current industry without inventing causal/sector mappings',async()=>{
 const source=await receipts(),before=await v2Hash(source),data=emptyEvidenceData();
 const r=await eventAlignmentFromDailyReceipts(identity,data,source);
 assert.equal(r.coverage.length,3);assert.equal(r.issues.length,0);
 assert(r.coverage.every(c=>c.canonical_closes===22&&c.benchmark_same_sessions===22));
 assert(r.coverage.every(c=>c.current_official_industry_peers.length===2&&c.causal_review==='REVIEWED_CAUSAL_EVENT_MISSING'&&c.sector_mapping==='AS_OF_CANONICAL_SECTOR_MAPPING_MISSING'));
 assert.deepEqual(r.data.mappings,[]);assert.deepEqual(r.data.universe,[]);assert.deepEqual(data,emptyEvidenceData());
 assert.equal(await v2Hash(source),before);assert.deepEqual(r.business_writes,[]);assert.equal(r.production_eligible,false);
 const row=r.data.quotes.find(q=>q.symbol==='2330');assert.equal(row.provider,'twse_official_stock_day');assert.equal(row.ingested_at,received);
 assert.equal(row.raw_payload.volume_unit,'SHARES');assert.equal(row.raw_payload.amount_unit,'TWD');
});
test('SYNTHETIC: exact canonical causal review calls unchanged V1; pending reaction is not a fabricated positive',async()=>{
 const data=canonical(),source=await receipts(),r=await eventAlignmentFromDailyReceipts(identity,data,source,await reviews(data));
 assert.equal(r.data.mappings.length,3);assert(r.coverage.every(c=>c.causal_review==='EXACT_CANONICAL_ROWS_REVIEWED'));
 assert.deepEqual(r.decision,buildEvidenceDecision(r.data,identity));
 assert(r.decision.phase_evaluation.candidates.every(c=>!c.reasons.includes('EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING')));
 assert(r.decision.phase_evaluation.candidates.every(c=>c.post_event_price==='NOT_YET_OBSERVABLE'));
 assert.equal(r.decision.phase_evaluation.ready_count,0);
});
test('SYNTHETIC: announcement/canonical mapping without an explicit review never becomes reviewed causal evidence',async()=>{
 const data=canonical(),r=await eventAlignmentFromDailyReceipts(identity,data,await receipts());
 assert.equal(r.data.mappings.length,0);assert.equal(data.mappings.length,3);
 assert(r.decision.phase_evaluation.candidates.every(c=>c.reasons.includes('SOURCED_COMPANY_CATALYST_MAPPING_MISSING')));
});
test('SYNTHETIC: review binds row bytes, event linkage and review time; stale/future/duplicate assertions reject',async()=>{
 const data=canonical(),source=await receipts(),valid=await reviews(data);
 for(const mutate of [r=>r[0].evidence_sha256='0'.repeat(64),r=>r[0].event_id='other',r=>r[0].reviewed_at='2999-01-01T00:00:00Z',r=>r.push(r[0])]){
  const changed=structuredClone(valid);mutate(changed);const r=await eventAlignmentFromDailyReceipts(identity,data,source,changed);
  assert.equal(r.data.mappings.length,0);assert(r.issues.includes('EVENT_ALIGNMENT_REVIEW_INVALID'));
 }
 const changed=structuredClone(data);changed.mappings[0].transmission_path+=' altered';
 assert((await eventAlignmentFromDailyReceipts(identity,changed,source,valid)).issues.includes('EVENT_ALIGNMENT_REVIEW_INVALID'));
});
test('SYNTHETIC: future receipts cannot fill an earlier cutoff, even when their trading dates are old',async()=>{
 const source=await receipts(),old={...identity,generated_at:'2026-09-06T22:59:59Z',data_as_of:'2026-09-06T22:59:59Z'};
 const r=await eventAlignmentFromDailyReceipts(old,emptyEvidenceData(),source);
 assert.equal(r.data.quotes.length,0);assert(r.issues.some(x=>x.startsWith('EVENT_ALIGNMENT_RECEIPT_NOT_ADMISSIBLE:')));
});
test('SYNTHETIC: rehashing a duplicate/zero-volume/malformed bar cannot hide invalid source content',async()=>{
 for(const mutate of [r=>r.payload.rows.push(r.payload.rows[0]),r=>r.payload.rows[0].volume=0,r=>r.payload.rows[0].high=1,r=>r.payload.rows[0].first_seen_at='2999-01-01T00:00:00Z']){
  const source=await receipts(),r=source.find(r=>r.task.kind==='PRICE');mutate(r);await resign(r);
  const out=await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),source);assert(out.issues.length>0);
 }
 const source=await receipts();source[0].payload.rows[0].close+=1;
 assert((await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),source)).issues.some(r=>r.startsWith('EVENT_ALIGNMENT_RECEIPT_NOT_ADMISSIBLE:')));
});
test('SYNTHETIC: duplicate TAIEX session and source spoof fail closed rather than first-find selection',async()=>{
 const source=await receipts(),index=source.find(r=>r.task.kind==='BENCHMARK');index.payload.rows.push(index.payload.rows[0]);await resign(index);
 const r=await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),source);
 assert(r.issues.includes('EVENT_ALIGNMENT_BENCHMARK_INVALID'));assert(!r.data.quotes.some(q=>q.symbol==='TAIEX'));
 const spoof=await receipts();spoof.find(r=>r.task.kind==='BENCHMARK').task.url='https://example.test/index';
 assert((await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),spoof)).issues.includes('EVENT_ALIGNMENT_BENCHMARK_SOURCE_INVALID'));
});
test('SYNTHETIC: original canonical price conflict cannot be silently replaced by official data',async()=>{
 const data=emptyEvidenceData();data.quotes.push({id:'conflict',symbol:'2330',trading_date:dates.at(-1),phase:'close',value:999,change_percent:0,captured_at:dates.at(-1)+'T13:30:00+08:00',ingested_at:received});
 const r=await eventAlignmentFromDailyReceipts(identity,data,await receipts());
 assert(r.issues.includes('EVENT_ALIGNMENT_CANONICAL_CONFLICT:2330'));assert.equal(r.data.quotes.filter(q=>q.symbol==='2330').length,1);assert.equal(data.quotes[0].value,999);
});
test('SYNTHETIC: unknown/duplicate canonical sectors are not repaired from current industry classification',async()=>{
 const data=canonical();for(const r of data.universe)delete r.created_at;
 const r=await eventAlignmentFromDailyReceipts(identity,data,await receipts());
 assert(r.coverage.every(c=>c.sector_mapping==='AS_OF_CANONICAL_SECTOR_MAPPING_MISSING'));assert(r.data.universe.every(r=>!('created_at'in r)));
});
test('SYNTHETIC: existing V2 factory bar validation, immutable source hash, and original cutoff are reused',async()=>{
 const source=await receipts(),first=await eventAlignmentFromDailyReceipts(identity,canonical(),source);
 const input={identity,data:canonical(),captures:symbols.map(symbol=>({symbol,endpoint:'historical/candles',received_at:received,status:'PASS',rows:first.data.quotes.filter(q=>q.symbol===symbol),payload_hash:null})),sources:[],events:[],events_complete:false,v1:{},benchmark_history:source.filter(r=>r.task.kind==='BENCHMARK').flatMap(r=>r.payload.rows.map(b=>({date:b.date,close:b.close,available_at:b.available_at,source:r.task.url+'#'+b.date})))};
 const hash=await v2Hash(input),r=await eventAlignmentFromV2(input,hash);assert.equal(r.coverage.length,3);assert(r.coverage.every(c=>c.canonical_closes>=20));
 assert.equal(await v2Hash(input),hash);await assert.rejects(eventAlignmentFromV2(input,'0'.repeat(64)),/SOURCE_HASH/);
 const later=structuredClone(input);later.captures[0].rows[0].ingested_at='2999-01-01T00:00:00Z';
 const rejected=await eventAlignmentFromV2(later,await v2Hash(later));assert.equal(rejected.coverage.find(c=>c.symbol==='2330').canonical_closes,0);
});
test('SYNTHETIC negative on real minimal observation: Memory stays Memory, receipt time never becomes June availability',async()=>{
 const observed=structuredClone(REAL_CANONICAL_OBSERVATION),hash=await v2Hash(observed),current={...identity,generated_at:'2026-10-17T07:27:11.146Z'};
 const r=await withObservedCanonicalSectors(emptyEvidenceData(),current,observed,hash);
 assert.equal(r.status,'CURRENT_OBSERVATION_JOINED');assert.deepEqual(r.data.universe,observed.rows);
 assert.equal(r.data.universe.find(r=>r.symbol==='2344').sector,'記憶體');assert.equal(r.available_at_conservative_ms,'2026-10-17T07:27:11.146Z');
 for(const cutoff of ['2026-10-08T06:33:01.624Z','2026-10-17T07:27:11.145Z']){
  const past=await withObservedCanonicalSectors(emptyEvidenceData(),{...current,generated_at:cutoff},observed,hash);assert.equal(past.status,'UNKNOWN');assert.equal(past.data.universe.length,0);
 }
 observed.rows[2].sector='半導體';assert.equal((await withObservedCanonicalSectors(emptyEvidenceData(),current,observed,hash)).status,'UNKNOWN');
});
test('SYNTHETIC: missing same-date benchmark observations never shrink the fixed denominator',async()=>{
 const source=await receipts(),index=source.filter(r=>r.task.kind==='BENCHMARK').at(-1);index.payload.rows.splice(-2,1);await resign(index);
 const r=await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),source);
 assert.equal(r.same_date_totals.denominator,60);assert(r.coverage.every(c=>c.same_date.denominator===20&&c.same_date.stock_and_taiex<20));
 assert(r.coverage.every(c=>c.same_date.missing_taiex_dates.length>0));
});
test('SYNTHETIC: canonical observation conflict is atomic and duplicate peer rows never count twice',async()=>{
 const observation=structuredClone(REAL_CANONICAL_OBSERVATION),expected=await v2Hash(observation),data=emptyEvidenceData();
 data.universe=[{...observation.rows[2],sector:'CONFLICT'}];
 const r=await withObservedCanonicalSectors(data,{...identity,generated_at:'2026-10-17T08:00:00Z'},observation,expected);
 assert.equal(r.status,'UNKNOWN');assert.deepEqual(r.data.universe,data.universe,'No partial additions before conflicting last row');
 const duplicate=canonical();duplicate.universe=duplicate.universe.filter(r=>r.symbol!=='2382');duplicate.universe.push(structuredClone(duplicate.universe.find(r=>r.symbol==='2317')));
 const result=await eventAlignmentFromDailyReceipts(identity,duplicate,await receipts());
 assert.equal(result.coverage.find(c=>c.symbol==='2330').sector_mapping,'SECTOR_PEERS_INSUFFICIENT');
 assert.equal(result.coverage.find(c=>c.symbol==='2330').canonical_peer_symbols.length,0);
});
test('SYNTHETIC: derived close change availability is the later of both source observations',async()=>{
 const source=await receipts(),prior=source.filter(r=>r.task.month===dates[0].slice(0,7)&&r.task.kind==='PRICE');
 for(const r of prior){r.available_at=r.first_seen_at='2026-09-07T00:20:00Z';for(const b of r.payload.rows)b.available_at=b.first_seen_at=r.available_at;await resign(r);}
 const r=await eventAlignmentFromDailyReceipts(identity,emptyEvidenceData(),source),b=r.data.quotes.find(q=>q.symbol==='2330'&&q.trading_date==='2026-09-01');
 assert(b);assert.equal(b.ingested_at,'2026-09-07T00:20:00Z');assert.equal(b.raw_payload.original_available_at,received);
});
test('SYNTHETIC: sample plan is exactly ten fixed official GET resources and budgets cannot be enlarged',async()=>{
 const plan=await eventAlignmentSamplePlan('2026-10-17');assert.equal(plan.length,10);assert.equal(new Set(plan.map(t=>t.url)).size,10);
 assert(plan.every(t=>['www.twse.com.tw','openapi.twse.com.tw'].includes(new URL(t.url).hostname)));assert.equal(OFFICIAL_SAMPLE_LIMITS.requests,10);
 await assert.rejects(acquireEventAlignmentSample('/unused',{deadlineMs:120001}),/DEADLINE_BUDGET_INVALID/);
 assert.equal(OFFICIAL_SAMPLE_LIMITS.directory_bytes+OFFICIAL_SAMPLE_LIMITS.event_bytes+6*OFFICIAL_SAMPLE_LIMITS.price_bytes+2*OFFICIAL_SAMPLE_LIMITS.index_bytes,7_792_000);
});
test('SYNTHETIC: unknown transport exception halts once, reflects no error text and retains all missing denominator rows',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-event-boundary-'));let calls=0;
 try{
  const {file,sample}=await acquireEventAlignmentSample(dir,{deadlineMs:500,fetcher:async()=>{calls++;throw Error('DO_NOT_REFLECT_THIS_SENTINEL');}});
  assert.equal(calls,1);assert.equal(sample.requests,1);assert.equal(sample.receipts.length,10);assert(sample.receipts.every(r=>r.status==='UNAVAILABLE'));
  assert.doesNotMatch(JSON.stringify(sample),/DO_NOT_REFLECT_THIS_SENTINEL/);
  const {summary}=await replayEventAlignmentSample(file);assert.equal(summary.same_date_totals.denominator,60);assert.equal(summary.same_date_totals.stock_and_taiex,0);assert.equal(summary.source_join_status,'HOLD_INCOMPLETE_SOURCE_SAMPLE');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SYNTHETIC: total deadline settles an abort-ignoring transport without admitting its late response',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-event-deadline-'));let finish;
 try{
  const started=performance.now(),{file,sample}=await acquireEventAlignmentSample(dir,{deadlineMs:30,signal:new AbortController().signal,fetcher:()=>new Promise(resolve=>{finish=resolve;})});
  assert(performance.now()-started<500);assert.equal(sample.requests,1);assert(sample.receipts.every(r=>r.status==='UNAVAILABLE'));
  const bytes=readFileSync(file);finish(new Response('[]'));await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(readFileSync(file),bytes);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SYNTHETIC: per-response body budget rejects oversized headers and streams without retry',async()=>{
 for(const response of [()=>new Response('[]',{headers:{'content-length':'3000001'}}),()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(3_000_001));c.close();}}))]){
  const dir=mkdtempSync(join(tmpdir(),'ma-event-size-'));let calls=0;
  try{const {sample}=await acquireEventAlignmentSample(dir,{deadlineMs:500,fetcher:async()=>{calls++;return response();}});assert.equal(calls,1);assert.equal(sample.failures[0].reason,'RESPONSE_BYTE_BUDGET');assert(sample.receipts.every(r=>r.status==='UNAVAILABLE'));}
  finally{rmSync(dir,{recursive:true,force:true});}
 }
});
test('SYNTHETIC: a body that ignores abort cannot extend the total deadline or produce an accepted receipt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-event-body-deadline-'));
 try{const started=performance.now(),{sample}=await acquireEventAlignmentSample(dir,{deadlineMs:30,fetcher:async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}))});
  assert(performance.now()-started<500);assert.equal(sample.requests,1);assert(sample.receipts.every(r=>r.status==='UNAVAILABLE'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('SYNTHETIC: audit artifacts are content-addressed wx files, same facts idempotent and corruption never overwritten',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-event-immutable-'));
 try{const body={schema:'SYNTHETIC_CONTROL',value:1},file=await saveEventAlignmentReceipt(dir,body),bytes=readFileSync(file);assert.equal(await saveEventAlignmentReceipt(dir,body),file);assert.deepEqual(readFileSync(file),bytes);
  writeFileSync(file,'corrupt');await assert.rejects(saveEventAlignmentReceipt(dir,body));assert.equal(readFileSync(file,'utf8'),'corrupt');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
