/** Bounded credential-free public acquisition -> retained source join -> ORIGINAL
 * V1 evaluator. This is an isolated study, never a Production caller or backfill.
 * No arbitrary URL, env, database, SDK, retries or public content output.
 * CLI: --input <existing refresh bundle> --input-sha256 <physical hash> --out <private dir>
 */
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPinnedPrivate,validateReceipts} from '../vnext/event-alignment-refresh.mjs';
import {privateDirectory,immutable} from '../vnext/foundation-history.mjs';
import {eventAlignmentFromDailyReceipts,withObservedCanonicalSectors} from '../../research/recommendation-event-alignment-candidate.ts';
import {buildOfficialV1SourceCandidate} from '../../research/recommendation-official-source-join.ts';
import {emptyEvidenceData} from '../../supabase/functions/_shared/decision-v1-data.ts';
import {COMPANY_EVENT_SOURCES,normalizeCompanyEvents} from '../../supabase/functions/_shared/recommendation-company-events.ts';
import {isMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {prepareIssuerActualCanonicalIntake} from '../../research/issuer-actual-canonical-intake.ts';
export const PUBLIC_V1_LIMITS=Object.freeze({requests:2,total_ms:20000,request_ms:6000,source_bytes:3_000_000,total_bytes:6_000_000});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function bounded(work,signal){return new Promise((resolve,reject)=>{
 let done=false;const finish=(f,v)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);f(v);};
 const abort=()=>finish(reject,Error('PUBLIC_SOURCE_DEADLINE'));
 Promise.resolve(work).then(v=>finish(resolve,v),()=>finish(reject,Error('PUBLIC_SOURCE_TRANSPORT')));
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
function cancel(body){try{void body?.cancel().catch(()=>{});}catch{/* no reflected provider error */}}
async function readSource(url,{fetcher,signal,state,now}){
 if(signal.aborted||state.requests>=2)throw Error('PUBLIC_SOURCE_BUDGET');state.requests++;
 const response=await bounded(Promise.resolve().then(()=>fetcher(url,{method:'GET',credentials:'omit',redirect:'error',
  headers:{Accept:'application/json'},signal})).then(r=>{if(signal.aborted){cancel(r.body);throw Error('PUBLIC_SOURCE_DEADLINE');}return r;}),signal);
 const result={source:url,http:response.status,status:'HTTP_REJECTED',bytes:0,sha256:null,received_at:now(),body:null};
 if(response.status!==200||response.redirected||response.url&&response.url!==url){cancel(response.body);return result;}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>PUBLIC_V1_LIMITS.source_bytes)){cancel(response.body);throw Error('PUBLIC_SOURCE_BYTES');}
 const reader=response.body?.getReader();if(!reader)throw Error('PUBLIC_SOURCE_BODY');let size=0,count=0;const parts=[];
 try{for(;;){const {done,value}=await bounded(reader.read(),signal);if(done)break;
  size+=value.byteLength;state.bytes+=value.byteLength;
  if(++count>4096||size>PUBLIC_V1_LIMITS.source_bytes||state.bytes>PUBLIC_V1_LIMITS.total_bytes)throw Error('PUBLIC_SOURCE_BYTES');
  parts.push(Buffer.from(value));
 }}finally{try{void reader.cancel().catch(()=>{});reader.releaseLock();}catch{/* never wait beyond deadline */}}
 const body=Buffer.concat(parts);new TextDecoder('utf-8',{fatal:true}).decode(body);
 return {...result,status:'RECEIVED',bytes:size,sha256:digest(body),received_at:now(),body};
}
export async function evaluatePublicV1(bundle,{fetcher=fetch,now=()=>new Date().toISOString(),monotonic=()=>performance.now(),reportedFinancialReceipts=[]}={}){
 // Bind the retained input before the first await/network request. Caller-side
 // mutations must not remove/retarget source packets after the original scope.
 bundle=structuredClone(bundle);reportedFinancialReceipts=structuredClone(reportedFinancialReceipts);
 const began=monotonic(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PUBLIC_V1_LIMITS.total_ms);
 const check=()=>{if(controller.signal.aborted||monotonic()-began>=PUBLIC_V1_LIMITS.total_ms)throw Error('PUBLIC_SOURCE_DEADLINE');};
 try{
 if(bundle?.schema!=='EVENT_ALIGNMENT_REFRESH_BUNDLE_V1'||!bundle.input||!Array.isArray(bundle.new_receipts))throw Error('PUBLIC_V1_INPUT');
 const start=now(),date=new Date(Date.parse(start)+8*3600000).toISOString().slice(0,10);
 if(!isMarketTradingDate('TW',date))throw Error('PUBLIC_V1_NOT_TRADING_DAY');
 const identity={report_date:date,today_date:date,generated_at:start,data_as_of:start,
  revision_id:'isolated-official:'+start.replace(/[.:]/g,''),is_trading_day:true};
 const retained=[...bundle.input.receipts,...(bundle.input.overlay_receipts??[]),...bundle.new_receipts];
 await validateReceipts(retained,start);
 check();
 const selected=new Map();for(const r of retained){const old=selected.get(r.task.url);
  if(!old||Date.parse(r.available_at)>Date.parse(old.available_at))selected.set(r.task.url,r);
  else if(Date.parse(r.available_at)===Date.parse(old.available_at)&&await snapshotHash(r)!==await snapshotHash(old))throw Error('PUBLIC_V1_RETAINED_CONFLICT');}
 const sectors=await withObservedCanonicalSectors(emptyEvidenceData(),identity,bundle.input.observation,await snapshotHash(bundle.input.observation));
 if(sectors.status!=='CURRENT_OBSERVATION_JOINED'||sectors.data.universe.length!==72)throw Error('PUBLIC_V1_SECTOR_SCOPE');
 const prices=await eventAlignmentFromDailyReceipts(identity,sectors.data,[...selected.values()]);
 check();
 const state={requests:0,bytes:0},sources=[],announcements=[];
  for(const source of COMPANY_EVENT_SOURCES){
   check();
   const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(PUBLIC_V1_LIMITS.request_ms)]);
   try{const r=await readSource(source.url,{fetcher,signal,state,now});
    const {body,...receipt}=r;sources.push(receipt);if(r.status!=='RECEIVED')continue;
    // Parse now; never save raw explanation, contact fields or title payloads.
    const facts=await normalizeCompanyEvents(source,JSON.parse(body.toString('utf8')),r.received_at,prices.data.universe.map(r=>String(r.symbol)));
    receipt.status='NORMALIZED_SOURCE_FACTS';receipt.matched_rows=facts.length;
    announcements.push({source,received_at:r.received_at,response_body:body,response_sha256:r.sha256});
   }catch(e){const status=controller.signal.aborted?'DEADLINE':
    /^PUBLIC_SOURCE_(DEADLINE|BYTES|BODY|BUDGET|TRANSPORT)$/.test(e.message)?e.message:'SOURCE_SCHEMA_INVALID';
    const existing=sources.find(r=>r.source===source.url);
    if(existing)existing.status=status;else sources.push({source:source.url,status,http:null,sha256:null});}
  }
 // TWSE website terms restrict non-approved automated downloading outside its
 // open-data exception. BFI82U is not admitted by the verified dataset list:
 // never make that GET merely because an old private adapter can parse it.
 check();
 const cutoff=now();if(new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10)!==date)throw Error('PUBLIC_V1_CROSSED_DATE');
 const result=await buildOfficialV1SourceCandidate({data:prices.data,identity:{...identity,generated_at:cutoff,data_as_of:cutoff},
  announcements,reported_financial_receipts:reportedFinancialReceipts,
  retained_issuer_actuals:bundle.input.retained_issuer_actuals??[]});
 const actualIntake=await prepareIssuerActualCanonicalIntake(prices.data,{...identity,generated_at:cutoff,data_as_of:cutoff},
  bundle.input.retained_issuer_actuals??[]);
 check();
 // No subject review or causal mapping is invented. These events are retained
 // as time-stamped source facts; independent content/causal review remains open.
 const source_input_sha256=await snapshotHash(bundle);check();
 return {schema:'OFFICIAL_PUBLIC_V1_WIRING_RECEIPT_V1',started_at:start,cutoff,source_input_sha256,elapsed_ms:Math.round(monotonic()-began),
  source_receipts:sources,requests:state.requests,bytes:state.bytes,limits:PUBLIC_V1_LIMITS,
  http_success:sources.filter(r=>r.http===200).length,market_normalization:'NOT_ACQUIRED_AUTOMATION_RIGHTS_PENDING',
  normalized_sources:sources.filter(r=>r.status==='NORMALIZED_SOURCE_FACTS').length,
  official_event_facts:result.official_events.length,events_by_symbol:Object.fromEntries(prices.data.universe.map(r=>[
   r.symbol,result.official_events.filter(e=>e.symbol===r.symbol).length])),
  actual_rows:result.data.earnings.filter(r=>r.actual_only===true).length,
  held_issuer_actual_rows:result.data.earnings.filter(r=>r.provider==='RETAINED_ISSUER_PDF_UNADMITTED').length,
  held_issuer_actual_symbols:new Set(result.data.earnings.filter(r=>r.provider==='RETAINED_ISSUER_PDF_UNADMITTED').map(r=>r.symbol)).size,
  held_issuer_actual_receipts:result.source_receipts.filter(r=>r.parser_result_sha256),
  canonical_actual_intake_rows:actualIntake.prepared.length,
  reported_financial_snapshot_rows:result.data.earnings.filter(r=>r.reported_snapshot_only===true).length,
  reported_financial_symbols:new Set(result.data.earnings.filter(r=>r.reported_snapshot_only===true).map(r=>r.symbol)).size,
  retained_last_price_date:prices.data.quotes.filter(r=>/^\d/.test(String(r.symbol))).map(r=>r.trading_date).sort().at(-1)??null,
  before:result.before,after:result.after,reason_distribution:result.decision.phase_evaluation.reason_distribution,
  assessment_phase:result.decision.phase_evaluation.evaluation_phase,source_join_failures:result.data.failures,
  candidate_input_sha256:result.input_sha256,original_thresholds_changed:false,production_operations:0,
  captured_official_facts:{market_flow:null,announcements:result.official_events,canonical_actual_intake:actualIntake,
   reported_financial_sources:result.data.earnings.filter(r=>r.reported_snapshot_only===true).map(r=>r.actual_source)},
  forward_sample:0,outcome_sample:0,member_publication_approved:false,publication_eligibility:'HOLD',
  license_scope:'EXACT_DATASET_OGL_REVIEW_SEPARATE_FROM_SOURCE_ADMISSION_AND_PUBLICATION',
  limitations:['RETAINED_PRICE_WINDOW_NOT_FRESHENED_BY_THIS_STUDY','PER_STOCK_ACTUAL_TWD_NOT_OBTAINED',
   'FOUR_QUARTER_CONSENSUS_GUIDANCE_INCOMPLETE','CAUSAL_AND_INDEPENDENT_QUALITY_REVIEW_REQUIRED']};
 }finally{clearTimeout(timer);}
}
export async function runCli(args){
 const began=performance.now();
 const values={};if(![6,10].includes(args.length))throw Error('PUBLIC_V1_CLI');
 for(let i=0;i<args.length;i+=2){if(!['--input','--input-sha256','--out','--financial-input','--financial-sha256'].includes(args[i])||Object.hasOwn(values,args[i]))throw Error('PUBLIC_V1_CLI');values[args[i]]=args[i+1];}
 if(!values['--input']||!values['--input-sha256']||!values['--out']||Boolean(values['--financial-input'])!==Boolean(values['--financial-sha256']))throw Error('PUBLIC_V1_CLI');
 const directory=privateDirectory(values['--out']),input=readPinnedPrivate(values['--input'],values['--input-sha256']);
 let reportedFinancialReceipts=[];
 if(values['--financial-input']){
  const manifest=readPinnedPrivate(values['--financial-input'],values['--financial-sha256']);
  if(manifest.schema!=='OFFICIAL_FINANCIAL_RECEIPT_SET_V1'||!Array.isArray(manifest.receipts)||manifest.receipts.length>3
   ||manifest.receipts.some(r=>typeof r.path!=='string'||!/^receipt-\d\d-[a-f0-9]{64}\.json$/.test(r.path.split('/').at(-1))))throw Error('PUBLIC_FINANCIAL_MANIFEST');
  reportedFinancialReceipts=manifest.receipts.map(r=>readPinnedPrivate(r.path,r.sha256));
 }
 const result=await evaluatePublicV1(input,{reportedFinancialReceipts}),file=resolve(directory,'public-v1-'+await snapshotHash(result)+'.json');
 if(performance.now()-began>=PUBLIC_V1_LIMITS.total_ms)throw Error('PUBLIC_SOURCE_DEADLINE');
 immutable(file,result);
 const {captured_official_facts,...summary}=result;return {file,...summary};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await runCli(process.argv.slice(2))));}
 catch(e){console.error(JSON.stringify({status:'STOPPED',reason:/^[A-Z_0-9]+$/.test(e.message)?e.message:'PUBLIC_V1_INPUT_OR_SOURCE_CONTRACT',production_operations:0}));process.exitCode=1;}
}
