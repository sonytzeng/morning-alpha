/** Explicit public acquisition OR offline replay. No env, credentials, SDK,
 * Production, retries or redistribution. Normalization reuses existing parsers.
 * node --experimental-strip-types scripts/vnext/event-alignment-audit.mjs --acquire /private/tmp/<private-dir>
 * node --experimental-strip-types scripts/vnext/event-alignment-audit.mjs <private-sample.json> */
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {emptyEvidenceData} from '../../supabase/functions/_shared/decision-v1-data.ts';
import {isMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';
import {historyUrl} from '../../research/entry-official-history.ts';
import {V2_INDEX_URL} from '../../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {directoryPlan,fetchSource} from '../../src/features/vnext/dailyAdapter.ts';
import {normalizeCompanyEvents,COMPANY_EVENT_SOURCES} from '../../supabase/functions/_shared/recommendation-company-events.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {v2Hash} from '../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {eventAlignmentFromDailyReceipts} from '../../research/recommendation-event-alignment-candidate.ts';
import {privateDirectory,immutable,readPrivate} from './foundation-history.mjs';

export const SAMPLE_SYMBOLS=Object.freeze(['2330','2303','2344']);
export const OFFICIAL_SAMPLE_LIMITS=Object.freeze({requests:10,total_ms:120000,request_ms:12000,interval_ms:1600,
 aggregate_bytes:8_000_000,directory_bytes:3_000_000,event_bytes:3_000_000,price_bytes:256_000,index_bytes:128_000});
const localDate=at=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
const license='HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED';
const root=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
class SampleFailure extends Error {constructor(code){super(code);this.code=code;}}
function bounded(work,signal){
 return new Promise((resolve,reject)=>{
  let done=false;const finish=(f,value)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);f(value);};
  const abort=()=>finish(reject,new SampleFailure('DEADLINE'));
  signal.addEventListener('abort',abort,{once:true});Promise.resolve(work).then(v=>finish(resolve,v),e=>finish(reject,e));if(signal.aborted)abort();
 });
}
function pause(ms,signal){return new Promise((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new SampleFailure('DEADLINE'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
function cancel(body){try{void body?.cancel().catch(()=>{});}catch{/* fixed failure diagnostics only */}}
export async function eventAlignmentSamplePlan(date){
 const month=date.slice(0,7),previous=new Date(month+'-01T00:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);
 const months=[previous.toISOString().slice(0,7),month],tasks=[];
 tasks.push({...((await directoryPlan(date))[0]),symbols:[...SAMPLE_SYMBOLS]});
 for(const m of months){
  for(const symbol of SAMPLE_SYMBOLS)tasks.push({key:`event-price:${symbol}:${m}`,kind:'PRICE',url:historyUrl('TWSE',symbol,m),format:'json',scope:'EVENT_ALIGNMENT_SAMPLE_ONLY',symbols:[symbol],exchange:'TWSE',month:m,max_age_days:0});
  tasks.push({key:'event-index:'+m,kind:'BENCHMARK',url:V2_INDEX_URL+'?date='+m.replace('-','')+'01&response=json',format:'json',scope:'EVENT_ALIGNMENT_SAMPLE_ONLY',symbols:['TAIEX'],month:m,max_age_days:0});
 }
 tasks.push({key:'event-unreviewed-announcements',kind:'EVENT',url:COMPANY_EVENT_SOURCES[0].url,format:'json',scope:'EVENT_ALIGNMENT_SAMPLE_ONLY',symbols:[...SAMPLE_SYMBOLS],max_age_days:0});
 if(tasks.length!==10||new Set(tasks.map(t=>t.key)).size!==10)throw new SampleFailure('PLAN_INVALID');return tasks;
}
async function boundedResponse(fetcher,task,signal,state){
 if(state.requests>=10||signal.aborted)throw new SampleFailure('REQUEST_BUDGET_OR_DEADLINE');
 state.requests++;
 const work=Promise.resolve().then(()=>fetcher(task.url,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal})).then(r=>{
  if(signal.aborted){cancel(r.body);throw new SampleFailure('DEADLINE');}return r;
 });
 const response=await bounded(work,signal);
 if(!response.ok){cancel(response.body);throw new SampleFailure('HTTP_'+response.status);}
 const limit=task.kind==='DIRECTORY'?OFFICIAL_SAMPLE_LIMITS.directory_bytes:task.kind==='EVENT'?OFFICIAL_SAMPLE_LIMITS.event_bytes:task.kind==='PRICE'?OFFICIAL_SAMPLE_LIMITS.price_bytes:OFFICIAL_SAMPLE_LIMITS.index_bytes;
 const length=response.headers.get('content-length');if(length!==null&&/^\d+$/.test(length)&&Number(length)>limit){cancel(response.body);throw new SampleFailure('RESPONSE_BYTE_BUDGET');}
 const reader=response.body?.getReader();if(!reader)throw new SampleFailure('RESPONSE_BODY_MISSING');
 const parts=[];let size=0;
 try{for(;;){const {done,value}=await bounded(reader.read(),signal);if(done)break;
  size+=value.byteLength;state.bytes+=value.byteLength;
  if(size>limit||state.bytes>OFFICIAL_SAMPLE_LIMITS.aggregate_bytes)throw new SampleFailure('RESPONSE_BYTE_BUDGET');parts.push(value);
 }}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=Buffer.concat(parts);state.responses.push({key:task.key,source:task.url,accepted_bytes:size,physical_sha256:createHash('sha256').update(bytes).digest('hex'),resource_license:license});
 return new Response(bytes,{status:response.status,headers:{'Content-Type':'application/json'}});
}

export async function acquireEventAlignmentSample(directory,{fetcher=fetch,now=()=>new Date().toISOString(),signal,deadlineMs=120000}={}){
 if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>120000)throw new SampleFailure('DEADLINE_BUDGET_INVALID');
 const dir=privateDirectory(directory),start=now(),date=localDate(start),tasks=await eventAlignmentSamplePlan(date);
 const total=new AbortController(),timer=setTimeout(()=>total.abort(),deadlineMs),combined=signal?AbortSignal.any([signal,total.signal]):total.signal;
 const monotonicStart=performance.now(),state={requests:0,bytes:0,responses:[]},receipts=[],failures=[];let lastStart=monotonicStart-1600,halt=null;
 try{for(const task of tasks){
  if(halt||combined.aborted||performance.now()-monotonicStart>=deadlineMs){halt??='DEADLINE';failures.push({key:task.key,reason:'NOT_ATTEMPTED_'+halt});continue;}
  const request=new AbortController();let requestTimer;const requestSignal=AbortSignal.any([combined,request.signal]);
  try{
   await pause(Math.max(0,1600-(performance.now()-lastStart)),combined);
   if(combined.aborted||performance.now()-monotonicStart>=deadlineMs)throw new SampleFailure('DEADLINE');lastStart=performance.now();
   requestTimer=setTimeout(()=>request.abort(),Math.min(12000,deadlineMs));
   const boundedFetcher=()=>boundedResponse(fetcher,task,requestSignal,state);
   let receipt;
   if(task.kind==='EVENT'){
    const response=await bounded(boundedFetcher(),requestSignal),raw=await bounded(response.text(),requestSignal),at=now();
    const payload={rows:await normalizeCompanyEvents(COMPANY_EVENT_SOURCES[0],JSON.parse(raw),at,SAMPLE_SYMBOLS)};
    receipt={task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'EXISTING_COMPANY_EVENT_PARSER',raw_hash:await snapshotHash(raw),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};
   }else receipt=await bounded(fetchSource(task,boundedFetcher,now,requestSignal),requestSignal);
   if(combined.aborted||performance.now()-monotonicStart>=deadlineMs)throw new SampleFailure('DEADLINE');
   receipts.push(receipt);
  }catch(error){
   const reason=combined.aborted?'DEADLINE':error instanceof SampleFailure?error.code:'UNKNOWN_SOURCE_OR_CONTRACT_FAILURE';
   failures.push({key:task.key,reason});
   // No retries, including unknown exceptions; no error text/body/header echo.
   if(reason==='UNKNOWN_SOURCE_OR_CONTRACT_FAILURE'||reason==='DEADLINE'||reason==='RESPONSE_BYTE_BUDGET'||reason==='HTTP_401'||reason==='HTTP_403')halt=reason;
  }finally{clearTimeout(requestTimer);}
 }}finally{clearTimeout(timer);}
 const at=now();if(localDate(at)!==date)throw new SampleFailure('ACQUISITION_CROSSED_TAIPEI_DATE');
 // Failed/unattempted resources stay in the requested scope and denominator.
 for(const task of tasks.filter(t=>!receipts.some(r=>r.task.key===t.key)))receipts.push({task,first_seen_at:at,available_at:at,published_at:null,as_of:at,version:'UNAVAILABLE_NOT_EVIDENCE',raw_hash:null,payload_hash:null,payload:{rows:[]},status:'UNAVAILABLE',reason:failures.find(f=>f.key===task.key)?.reason??'NOT_ATTEMPTED'});
 const body={schema:'EVENT_ALIGNMENT_OFFICIAL_SAMPLE_V2',started_at:start,observed_at:at,symbols:[...SAMPLE_SYMBOLS],
  identity:{report_date:date,today_date:date,generated_at:at,data_as_of:at,revision_id:'isolated-event-sample:'+at,is_trading_day:isMarketTradingDate('TW',date)},
  receipts,failures,requests:state.requests,response_bytes_observed:state.bytes,responses:state.responses,limits:{...OFFICIAL_SAMPLE_LIMITS,total_ms:deadlineMs},
  elapsed_ms:Math.round(performance.now()-monotonicStart),availability:'ACTUAL_RECEIPT_NOT_BACKDATED',resource_license:license,production_operations:0};
 const file=resolve(dir,'event-alignment-'+await v2Hash(body)+'.json');immutable(file,body);return {file,sample:body};
}

export async function saveEventAlignmentReceipt(directory,body){const dir=privateDirectory(directory),file=resolve(dir,'event-alignment-audit-'+await v2Hash(body)+'.json');immutable(file,body);return file;}
export async function replayEventAlignmentSample(file){
 const path=resolve(file),stat=lstatSync(path),parent=dirname(path),rel=relative(root,realpathSync(path));
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>16_000_000||(stat.mode&0o077)||lstatSync(parent).isSymbolicLink()||(lstatSync(parent).mode&0o077)
  ||!(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)))throw Error('PRIVATE_SAMPLE_REQUIRED');
 const sample=readPrivate(path);
 if(sample.schema!=='EVENT_ALIGNMENT_OFFICIAL_SAMPLE_V2'||path.split('/').at(-1)!=='event-alignment-'+await v2Hash(sample)+'.json'
  ||JSON.stringify(sample.symbols)!==JSON.stringify(SAMPLE_SYMBOLS)||!Number.isInteger(sample.requests)||sample.requests<0||sample.requests>10
  ||sample.limits.total_ms>120000||sample.production_operations!==0||sample.resource_license!==license)throw Error('SAMPLE_LINEAGE_INVALID');
 const plan=await eventAlignmentSamplePlan(sample.identity.report_date);
 if(sample.receipts.length!==10||!plan.every(t=>sample.receipts.filter(r=>r.task.key===t.key&&r.task.url===t.url).length===1))throw Error('SAMPLE_SCOPE_INVALID');
 const result=await eventAlignmentFromDailyReceipts(sample.identity,emptyEvidenceData(),sample.receipts);
 const ready=result.coverage.length===3&&result.coverage.every(c=>c.same_date.stock_ohlcv_and_taiex===20)&&result.issues.length===0;
 return {sample,result,summary:{schema:sample.schema,source_sha256:await v2Hash(sample),cutoff:sample.observed_at,requests:sample.requests,
  official_receipts:sample.receipts.filter(r=>r.status==='OK').length,failures:sample.failures,coverage:result.coverage,issues:result.issues,same_date_totals:result.same_date_totals,
  source_join_status:ready?'OBSERVED_20_SESSION_SOURCE_JOIN':'HOLD_INCOMPLETE_SOURCE_SAMPLE',resource_license:license,
  assessment_session:result.assessment_session,decision_action:result.decision.action,reviewed_causal_events:0,formal_v1_changed:false,
  forward_sample:0,outcome_sample:0,production_operations:0,raw_data_exported:false,availability:sample.availability}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const acquire=process.argv[2]==='--acquire',target=process.argv[acquire?3:2];if(!target)throw Error('EXPLICIT_PRIVATE_PATH_REQUIRED');
 const file=acquire?(await acquireEventAlignmentSample(target)).file:target;
 const {summary}=await replayEventAlignmentSample(file);console.log(JSON.stringify({private_sample:file,...summary}));
}
