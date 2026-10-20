/** Candidate-only, whole-receipt refresh. Importing this module does no I/O.
 * CLI: node --experimental-strip-types scripts/vnext/event-alignment-refresh.mjs
 *   plan|refresh --input /private/.../input.json --input-sha256 <physical SHA256>
 *   refresh additionally requires --out /private/.../new-directory
 *   replay --bundle /private/.../refresh-<hash>.json --bundle-sha256 <physical SHA256>
 * No URL/cutoff override, env, DB, credentials, retries, causal review or release.
 */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync,writeFileSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {resolve,dirname,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ADAPTER_VERSION,fetchSource} from '../../src/features/vnext/dailyAdapter.ts';
import {snapshotHash,compareTime,validObservationTime} from '../../src/features/vnext/contracts.ts';
import {historyUrl,tpexDailyUrl,officialDate} from '../../research/entry-official-history.ts';
import {eventAlignmentFromDailyReceipts,eventAlignmentFromRetainedEvidence,withObservedCanonicalSectors} from '../../research/recommendation-event-alignment-candidate.ts';
import {normalizeOfficialDailyOpenDataCandidate,OFFICIAL_DAILY_OPEN_LIMITS} from '../../research/official-daily-open-data-candidate.ts';
import {emptyEvidenceData} from '../../supabase/functions/_shared/decision-v1-data.ts';
import {isMarketTradingDate,previousMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';
import {RECOMMENDATION_UNIVERSE} from '../../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {V2_INDEX_URL} from '../../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {v2Hash} from '../../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';

export const REFRESH_LIMITS=Object.freeze({requests:64,total_ms:150000,request_ms:12000,interval_ms:1600,aggregate_bytes:8_000_000});
const LICENSE='HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED',ROOT=fileURLToPath(new URL('../../',import.meta.url));
const SHA=/^[a-f0-9]{64}$/,DATE=/^\d{4}-\d{2}-\d{2}$/,MONTH=/^\d{4}-\d{2}$/;
const symbols=[...RECOMMENDATION_UNIVERSE].sort(),physical=b=>createHash('sha256').update(b).digest('hex');
class RefreshFailure extends Error {constructor(code){super(code);this.code=code;}}
const requireFact=(fact,code)=>{if(!fact)throw new RefreshFailure(code);};
const stamp=at=>typeof at==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(at)?Date.parse(at):NaN;
export const localDate=at=>{requireFact(Number.isFinite(stamp(at)),'CUTOFF_INVALID');return new Date(stamp(at)+8*3600000).toISOString().slice(0,10);};
const indexURL=month=>V2_INDEX_URL+'?date='+month.replace('-','')+'01&response=json';
const sameSymbols=a=>Array.isArray(a)&&JSON.stringify([...a].sort())===JSON.stringify(symbols);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const openReceiptKeys=['schema','id','url','http','bytes','raw_sha256','first_seen_at','available_at','fields','row_count',
 'native_dates','original_published_at','original_version','source_session_scope','source_admission','canonical_admission','publication_approval'];
const openMetadataKeys=['dataset','request_count','requested_at','universe_symbols','licensing','normalization'];
const openDatasetURLs=Object.freeze({TWSE_11549:'https://data.gov.tw/dataset/11549',TPEX_11370:'https://data.gov.tw/dataset/11370',
 TPEX_11371:'https://data.gov.tw/dataset/11371',TAIEX_11555:'https://data.gov.tw/dataset/11555'});
function validateOpenReceipt(receipt){
 requireFact(object(receipt)&&openReceiptKeys.every(k=>Object.hasOwn(receipt,k))
  &&Object.keys(receipt).every(k=>openReceiptKeys.includes(k)||openMetadataKeys.includes(k)),'OPEN_RESOURCE_ENVELOPE_INVALID');
 // These six retained capture annotations are metadata ONLY. Keep the entire
 // object in the pinned private input; never interpret them as source/quality/
 // rights authority or as counts of admitted evidence. Normalizer gates remain.
 if(Object.hasOwn(receipt,'dataset'))requireFact(typeof receipt.dataset==='string'
  &&Object.hasOwn(openDatasetURLs,receipt.id)&&receipt.dataset===openDatasetURLs[receipt.id],'OPEN_RESOURCE_METADATA_INVALID');
 if(Object.hasOwn(receipt,'request_count'))requireFact(Number.isInteger(receipt.request_count)&&receipt.request_count===1,'OPEN_RESOURCE_METADATA_INVALID');
 if(Object.hasOwn(receipt,'requested_at'))requireFact(typeof receipt.requested_at==='string'&&validObservationTime(receipt.requested_at)
  &&typeof receipt.first_seen_at==='string'&&validObservationTime(receipt.first_seen_at)
  &&compareTime(receipt.requested_at,receipt.first_seen_at)<=0,'OPEN_RESOURCE_METADATA_INVALID');
 if(Object.hasOwn(receipt,'universe_symbols'))requireFact(receipt.id==='TAIEX_11555'&&receipt.universe_symbols===null
  ||Number.isSafeInteger(receipt.universe_symbols)&&receipt.universe_symbols>=0&&receipt.universe_symbols<=symbols.length,'OPEN_RESOURCE_METADATA_INVALID');
 if(Object.hasOwn(receipt,'licensing'))requireFact(receipt.licensing==='EXACT_REGISTERED_OGL_V1_RESOURCE_ATTRIBUTION_AND_THIRD_PARTY_CONDITIONS_REMAIN','OPEN_RESOURCE_METADATA_INVALID');
 if(Object.hasOwn(receipt,'normalization'))requireFact(receipt.normalization==='CSV_SHAPE_ONLY_NOT_ORIGINAL_V1_EVIDENCE','OPEN_RESOURCE_METADATA_INVALID');
}
/** Saved bytes only: never fetch a CSV or manufacture a VNext SourceReceipt.
 * The private input's physical hash binds the original receipt and canonical
 * base64 together. Existing normalization owns all source/hash/time/scope gates. */
function officialOpen(input,cutoff){
 if(!Object.hasOwn(input,'official_open_resources'))return null;
 const saved=input.official_open_resources;
 requireFact(Array.isArray(saved)&&saved.length>0&&saved.length<=OFFICIAL_DAILY_OPEN_LIMITS.resources,'OPEN_RESOURCE_LIMIT');
 const resources=saved.map(resource=>{
  requireFact(exact(resource,['receipt','response_body_base64']),'OPEN_RESOURCE_ENVELOPE_INVALID');validateOpenReceipt(resource.receipt);
  const encoded=resource.response_body_base64;
  requireFact(typeof encoded==='string'&&encoded.length>0&&encoded.length<=4*Math.ceil(OFFICIAL_DAILY_OPEN_LIMITS.bytes_per_resource/3)
   &&encoded.length%4===0,'OPEN_RESOURCE_BASE64_LIMIT');
  const bytes=Buffer.from(encoded,'base64');
  // Round-trip rejects whitespace, URL alphabet, missing/extra padding, invalid
  // characters and nonzero unused pad bits before any source is normalized.
  requireFact(bytes.length>0&&bytes.length<=OFFICIAL_DAILY_OPEN_LIMITS.bytes_per_resource
   &&bytes.toString('base64')===encoded,'OPEN_RESOURCE_BASE64_NONCANONICAL');
  requireFact(Array.isArray(resource.receipt.native_dates)&&resource.receipt.native_dates.length===1
   &&typeof resource.receipt.native_dates[0]==='string','OPEN_RESOURCE_DATE_SCOPE_INVALID');
  return {receipt:resource.receipt,response_body:bytes};
 });
 const dates=resources.map(r=>officialDate(r.receipt.native_dates[0]));
 requireFact(DATE.test(dates[0])&&dates.every(date=>date===dates[0]),'OPEN_RESOURCE_DATE_SCOPE_INVALID');
 return normalizeOfficialDailyOpenDataCandidate({trading_date:dates[0],cutoff,resources});
}
function identity(at){const date=localDate(at);return {report_date:date,today_date:date,generated_at:at,data_as_of:at,
 revision_id:'isolated-event-refresh:'+at,is_trading_day:isMarketTradingDate('TW',date)};}
function taskValid(t){
 requireFact(t&&t.format==='json'&&typeof t.key==='string'&&t.key.length>0&&typeof t.scope==='string'
  &&Number.isFinite(t.max_age_days)&&t.max_age_days>=0&&Array.isArray(t.symbols)
  &&new Set(t.symbols).size===t.symbols.length&&!('form'in t),'SOURCE_TASK_INVALID');
 let expected;
 if(t.kind==='PRICE'){
  requireFact(t.exchange==='TWSE'&&t.symbols.length===1&&symbols.includes(t.symbols[0])&&MONTH.test(t.month),'PRICE_TASK_INVALID');
  expected=historyUrl('TWSE',t.symbols[0],t.month);
 }else if(t.kind==='OTC_PRICE'){
  requireFact(t.exchange==='TPEX'&&DATE.test(t.date)&&isMarketTradingDate('TW',t.date)&&t.symbols.length>0&&t.symbols.every(s=>symbols.includes(s)),'OTC_TASK_INVALID');
  expected=tpexDailyUrl(t.date);
 }else{
  requireFact(t.kind==='BENCHMARK'&&MONTH.test(t.month)&&(t.symbols.length===0||JSON.stringify(t.symbols)===JSON.stringify(['TAIEX'])),'BENCHMARK_TASK_INVALID');
  expected=indexURL(t.month);
 }
 requireFact(t.url===expected,'SOURCE_URL_INVALID');
}
/** Raw response bytes are not present in the old receipt. raw_hash is preserved
 * as an inventory attestation, NOT falsely claimed re-derived from payload. */
export async function validateReceipts(receipts,cutoff){
 requireFact(Array.isArray(receipts)&&receipts.length<=1500,'RECEIPT_LIMIT');
 const keys=new Set();
 for(const r of receipts){
  taskValid(r.task);requireFact(!keys.has(r.task.key),'DUPLICATE_RECEIPT_KEY');keys.add(r.task.key);
  requireFact(r.status==='OK'&&r.reason===null&&r.version===ADAPTER_VERSION&&r.published_at===null
   &&Number.isFinite(stamp(r.first_seen_at))&&stamp(r.first_seen_at)<=stamp(cutoff)
   &&r.first_seen_at===r.available_at&&r.as_of===r.available_at&&SHA.test(r.raw_hash)&&SHA.test(r.payload_hash),'RECEIPT_METADATA_INVALID');
  requireFact(r.payload_hash===await snapshotHash(r.payload),'RECEIPT_PAYLOAD_HASH_MISMATCH');
  requireFact(Array.isArray(r.payload?.rows)&&r.payload.rows.length<=1000,'RECEIPT_ROWS_INVALID');
  const seen=new Set();
  for(const b of r.payload.rows){
   const t=r.task,k=(b.symbol??'TAIEX')+':'+b.date;
   requireFact(!seen.has(k)&&DATE.test(b.date)&&isMarketTradingDate('TW',b.date)
    &&b.available_at===r.available_at&&b.first_seen_at===r.available_at&&b.published_at===null
    &&stamp(b.available_at)>=stamp(b.date+'T13:30:00+08:00')&&b.as_of===b.date+'T13:30:00+08:00'
    &&SHA.test(b.evidence_hash)&&[b.open,b.high,b.low,b.close].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)
    &&b.high>=Math.max(b.open,b.low,b.close)&&b.low<=Math.min(b.open,b.close),'BAR_METADATA_INVALID');seen.add(k);
   requireFact((t.kind==='OTC_PRICE'?b.date===t.date:b.date.startsWith(t.month+'-')),'BAR_TASK_DATE_MISMATCH');
   if(t.kind==='BENCHMARK'){
    requireFact(b.source===t.url&&b.id==='benchmark-'+b.date&&b.session_scope==='TAIEX_OFFICIAL'&&b.volume===null&&b.amount===null,'BENCHMARK_ROW_INVALID');
   }else{
    requireFact(t.symbols.includes(b.symbol)&&b.source===t.url&&b.source_ref===t.url&&b.id===`bar-${b.symbol}-${b.date}`
     &&b.session_scope===(t.kind==='PRICE'?'OFFICIAL_STOCK_DAY':'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES')
     &&Number.isSafeInteger(b.volume)&&b.volume>0&&Number.isSafeInteger(b.amount)&&b.amount>0,'STOCK_ROW_OR_UNIT_INVALID');
    const bar=Object.fromEntries(['date','open','high','low','close','volume','amount','source_ref','available_at'].map(k=>[k,b[k]]));
    requireFact(await snapshotHash(bar)===b.evidence_hash,'BAR_EVIDENCE_HASH_MISMATCH');
   }
  }
 }
}
async function latestWhole(receipts){
 const map=new Map();
 for(const r of receipts){const prior=map.get(r.task.url);
  if(!prior||stamp(r.available_at)>stamp(prior.available_at))map.set(r.task.url,r);
  else if(stamp(r.available_at)===stamp(prior.available_at))requireFact(await v2Hash(r)===await v2Hash(prior),'TIED_RESOURCE_CONFLICT');
 }
 const selected=[...map.values()].sort((a,b)=>a.task.url.localeCompare(b.task.url));
 requireFact(new Set(selected.map(r=>r.task.key)).size===selected.length,'SELECTED_KEY_CONFLICT');return selected;
}
async function prove(input,receipts,at){
 const id=identity(at),joined=await withObservedCanonicalSectors(emptyEvidenceData(),id,input.observation,await v2Hash(input.observation));
 requireFact(joined.status==='CURRENT_OBSERVATION_JOINED','CANONICAL_OBSERVATION_UNAVAILABLE');
 const base=await eventAlignmentFromDailyReceipts(id,joined.data,receipts),native=officialOpen(input,at);let result=base,openSummary;
 if(native){
  const data=structuredClone(base.data);data.quotes.push(...native.data.quotes);
  result=await eventAlignmentFromRetainedEvidence(data,id,await v2Hash(data));
  const retainedBase={...result.data,quotes:result.data.quotes.slice(0,base.data.quotes.length)};
  const baseHash=await v2Hash(base.data),decisionHash=await v2Hash(base.decision);
  requireFact(await v2Hash(retainedBase)===baseHash&&result.data.quotes.length===base.data.quotes.length+native.data.quotes.length,'HELD_APPEND_CHANGED_BASE');
  requireFact(await v2Hash(result.decision)===decisionHash,'HELD_APPEND_CHANGED_DECISION');
  openSummary={classification:'HELD_NATIVE_FACTS_NOT_CANONICAL_ADMISSION',trading_date:native.trading_date,
   resources:native.sources.length,held_quotes:native.data.quotes.length,stock_facts:native.counts.stocks_with_facts,
   benchmark_facts:native.counts.benchmark_facts,verified_quotes:0,
   held_cells:native.data.quotes.map(q=>({symbol:q.symbol,trading_date:q.trading_date})),
   held_quotes_sha256:await v2Hash(native.data.quotes),base_data_sha256:baseHash,joined_data_sha256:await v2Hash(result.data),
   base_data_preserved:true,decision_sha256:decisionHash,decision_unchanged:true,
   evaluated_count:result.decision.phase_evaluation.evaluated_count,
   source_admission:false,canonical_admission:false,publication_approval:false};
 }
 requireFact(base.issues.length===0&&result.issues.length===0&&result.same_date_totals.symbols===72&&result.same_date_totals.denominator===1440
  &&result.coverage.every(c=>c.same_date.calendar_sessions_covered===20),'ADAPTER_REJECTED_OR_DENOMINATOR_CHANGED');
 return {cutoff:at,report_date:id.report_date,same_date_totals:result.same_date_totals,
  taiex_sessions:result.coverage[0].same_date.taiex_close,source_sha256:result.source_sha256,candidate_input_sha256:result.candidate_input_sha256,
  availability:{first:receipts.map(r=>r.available_at).sort((a,b)=>stamp(a)-stamp(b))[0],last:receipts.map(r=>r.available_at).sort((a,b)=>stamp(a)-stamp(b)).at(-1)},
  coverage:result.coverage.map(c=>({symbol:c.symbol,same_date:c.same_date,sector_mapping:c.sector_mapping,causal_review:c.causal_review})),
  assessment_session:result.assessment_session,decision_action:result.decision.action,...(openSummary?{official_open:openSummary}:{})};
}
export async function planEventAlignmentRefresh(envelope,cutoff=new Date().toISOString()){
 const input=structuredClone(envelope);localDate(cutoff);
 requireFact(input?.schema==='EVENT_ALIGNMENT_REFRESH_INPUT_V1'&&sameSymbols(input.observation?.rows?.map(r=>r.symbol))
  &&input.observation.rows.every(r=>r.is_active===true)&&(!('inventory_receipt_sha256'in input)||SHA.test(input.inventory_receipt_sha256)),'INPUT_SCOPE_INVALID');
 await validateReceipts(input.receipts,cutoff);await validateReceipts(input.overlay_receipts??[],cutoff);
 const all=[...input.receipts,...(input.overlay_receipts??[])],exchange=new Map();
 for(const r of all)if(r.task.kind!=='BENCHMARK')for(const s of r.task.symbols){
  requireFact(!exchange.has(s)||exchange.get(s)===r.task.exchange,'EXCHANGE_CONFLICT');exchange.set(s,r.task.exchange);
 }
 requireFact(sameSymbols([...exchange.keys()]),'SOURCE_UNIVERSE_INCOMPLETE');
 const selected=await latestWhole(all),original=await prove(input,await latestWhole(input.receipts),cutoff),before=await prove(input,selected,cutoff);
 const first=before.coverage[0].same_date.expected_session_dates[0],warmup=previousMarketTradingDate('TW',first);
 // Existing pre-window data is retained. No extra request or synthetic previous close.
 for(const s of symbols)requireFact(selected.some(r=>r.task.kind!=='BENCHMARK'&&r.payload.rows.some(b=>b.symbol===s&&b.date===warmup)),'EXISTING_WARMUP_MISSING');
 requireFact(selected.some(r=>r.task.kind==='BENCHMARK'&&r.payload.rows.some(b=>b.date===warmup)),'BENCHMARK_WARMUP_MISSING');
 const resources=new Map(),otc=[...exchange].filter(([,e])=>e==='TPEX').map(([s])=>s).sort();
 const held=new Set((before.official_open?.held_cells??[]).map(c=>c.symbol+':'+c.trading_date)),missingAdmission=[];
 const heldOnly=(symbol,date)=>{
  if(!held.has(symbol+':'+date))return false;
  missingAdmission.push({symbol,trading_date:date,classification:'RAW_PRESENT_CANONICAL_ADMISSION_MISSING'});return true;
 };
 const add=async t=>{taskValid(t);if(!resources.has(t.url))resources.set(t.url,t);};
 const base={format:'json',scope:'EVENT_ALIGNMENT_REFRESH_V1:'+before.report_date,max_age_days:0};
 for(const c of before.coverage)for(const date of c.same_date.missing_stock_dates){
  if(heldOnly(c.symbol,date))continue;
  const t=exchange.get(c.symbol)==='TWSE'?{...base,kind:'PRICE',symbols:[c.symbol],exchange:'TWSE',month:date.slice(0,7),url:historyUrl('TWSE',c.symbol,date.slice(0,7))}
   :{...base,kind:'OTC_PRICE',symbols:otc,exchange:'TPEX',date,url:tpexDailyUrl(date)};
  await add({...t,key:'event-refresh:'+await snapshotHash(t)});
 }
 for(const date of before.coverage[0].same_date.missing_taiex_dates){if(heldOnly('TAIEX',date))continue;
  const month=date.slice(0,7),t={...base,kind:'BENCHMARK',symbols:['TAIEX'],month,url:indexURL(month)};
  await add({...t,key:'event-refresh:'+await snapshotHash(t)});
 }
 // A complete20-session inventory may legitimately need65 distinct resources.
 // Do not raise the64-request budget or reject the entire recoverable plan:
 // schedule one bounded prefix and expose the rest as UNATTEMPTED, never done.
 // Existing immutable receipts let the next plan recalculate only actual gaps.
 const allTasks=[...resources.values()].sort((a,b)=>a.url.localeCompare(b.url));
 const tasks=allTasks.slice(0,REFRESH_LIMITS.requests),deferred=allTasks.slice(REFRESH_LIMITS.requests);
 const budget=deferred.length?{classification:'REQUEST_BUDGET_DEFERRED',maximum_requests:REFRESH_LIMITS.requests,
  total_missing_resources:allTasks.length,scheduled_resources:tasks.length,deferred_resources:deferred.length,
  deferred_task_keys:deferred.map(t=>t.key),complete_plan_sha256:await v2Hash(allTasks)}:null;
 return {input,selected,tasks,...(budget?{deferred_tasks:deferred}:{}),warmup,original,before,summary:{schema:'EVENT_ALIGNMENT_REFRESH_PLAN_V1',cutoff,report_date:before.report_date,
  input_sha256:await v2Hash(input),inventory_receipt_sha256:input.inventory_receipt_sha256??null,
  original_receipts:input.receipts.length,overlay_receipts:(input.overlay_receipts??[]).length,selected_receipts:selected.length,
  planned_gets:tasks.length,planned_by_kind:Object.fromEntries(['PRICE','OTC_PRICE','BENCHMARK'].map(k=>[k,tasks.filter(t=>t.kind===k).length])),
  warmup_date:warmup,original,before,...(before.official_open?{missing_admission:missingAdmission}:{}),...(budget?{request_budget:budget}:{}),
  limits:REFRESH_LIMITS,resource_license:LICENSE,production_operations:0,formal_v1_changed:false,reviewed_causal_events:0}};
}
function bounded(work,signal){return new Promise((resolve,reject)=>{
 let done=false;const finish=(f,v)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);f(v);};
 const abort=()=>finish(reject,new RefreshFailure('DEADLINE'));
 // Attach both handlers even if already aborted or work rejects synchronously.
 Promise.resolve(work).then(v=>finish(resolve,v),e=>finish(reject,e));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
function sleep(ms,signal){return new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new RefreshFailure('DEADLINE'));};
 timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
function cancel(body){try{void Promise.resolve(body?.cancel()).catch(()=>{});}catch{/* never reflect errors */}}
async function responseFor(task,fetcher,signal,state){
 requireFact(!signal.aborted&&state.requests<REFRESH_LIMITS.requests,'DEADLINE_OR_REQUEST_LIMIT');
 const response=await bounded(Promise.resolve().then(()=>{
  requireFact(!signal.aborted,'DEADLINE');state.requests++;
  return fetcher(task.url,{method:'GET',credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal});
 }).then(r=>{if(signal.aborted){cancel(r?.body);throw new RefreshFailure('DEADLINE');}return r;}),signal);
 if(response.status!==200){cancel(response.body);throw new RefreshFailure(response.status===403?'HTTP_403':response.status===429?'HTTP_429':'HTTP_NON_200');}
 if(response.redirected||response.url&&response.url!==task.url){cancel(response.body);throw new RefreshFailure('REDIRECT_OR_RESOURCE_MISMATCH');}
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>REFRESH_LIMITS.aggregate_bytes-state.bytes)){cancel(response.body);throw new RefreshFailure('RESPONSE_BYTE_BUDGET');}
 const reader=response.body?.getReader();requireFact(reader,'RESPONSE_BODY_MISSING');const parts=[];let size=0,chunks=0;
 try{for(;;){const {done,value}=await bounded(reader.read(),signal);if(done)break;
  requireFact(value instanceof Uint8Array&&++chunks<=4096,'STREAM_INVALID');size+=value.byteLength;state.bytes+=value.byteLength;
  requireFact(state.bytes<=REFRESH_LIMITS.aggregate_bytes,'RESPONSE_BYTE_BUDGET');parts.push(Buffer.from(value));
 }}finally{try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
 const bytes=Buffer.concat(parts);new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 state.responses.push({task_key:task.key,accepted_bytes:size,physical_sha256:physical(bytes)});
 // Existing fetchSource still performs its own JSON parse, normalize and hash.
 return new Response(bytes,{status:200,headers:{'Content-Type':'application/json'}});
}
function outside(path){const rel=relative(realpathSync(ROOT),realpathSync(path));return rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel);}
function privateDir(path){mkdirSync(path,{recursive:true,mode:0o700});const s=lstatSync(path);requireFact(!s.isSymbolicLink()&&s.isDirectory()&&!(s.mode&0o077)&&outside(path),'PRIVATE_DIRECTORY_REQUIRED');return realpathSync(path);}
export function readPinnedPrivate(path,expected){
 requireFact(SHA.test(expected),'PHYSICAL_HASH_REQUIRED');const parent=lstatSync(dirname(path));
 requireFact(!parent.isSymbolicLink()&&parent.isDirectory()&&!(parent.mode&0o077)&&outside(dirname(path)),'PRIVATE_DIRECTORY_REQUIRED');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
 try{const s=fstatSync(fd);requireFact(s.isFile()&&!(s.mode&0o077)&&s.size<=32_000_000,'PRIVATE_FILE_REQUIRED');bytes=readFileSync(fd);}
 finally{closeSync(fd);}requireFact(physical(bytes)===expected,'PHYSICAL_INPUT_HASH_MISMATCH');return JSON.parse(bytes.toString('utf8'));
}
function save(dir,prefix,body){const bytes=Buffer.from(JSON.stringify(body)),hash=physical(bytes),path=resolve(dir,prefix+'-'+hash+'.json');
 // wx: no replacement, including any pre-existing symlink/file.
 writeFileSync(path,bytes,{mode:0o600,flag:'wx'});return {path,sha256:hash};}
export async function refreshEventAlignment(envelope,directory,{fetcher=globalThis.fetch,now=()=>new Date().toISOString(),
 monotonic=()=>performance.now(),wait=sleep,signal,deadlineMs=REFRESH_LIMITS.total_ms}={}){
 requireFact(Number.isInteger(deadlineMs)&&deadlineMs>0&&deadlineMs<=REFRESH_LIMITS.total_ms,'DEADLINE_BUDGET_INVALID');
 const started=now(),began=monotonic(),total=new AbortController(),timer=setTimeout(()=>total.abort(),deadlineMs);
 const combined=signal?AbortSignal.any([signal,total.signal]):total.signal;let plan;
 const state={requests:0,bytes:0,responses:[]},newReceipts=[],attempts=[],receiptFiles=[];let halt=null,last=began-REFRESH_LIMITS.interval_ms;
 const check=()=>requireFact(!combined.aborted&&monotonic()-began<deadlineMs,'DEADLINE');
 const freshNow=()=>{const at=now();requireFact(stamp(at)>=stamp(started)&&localDate(at)===localDate(started),'CLOCK_OR_TAIPEI_DATE_CHANGED');return at;};
 let dir;
 try{
  plan=await planEventAlignmentRefresh(envelope,started);dir=privateDir(directory);
  for(const task of plan.tasks){
   if(halt){attempts.push({task_key:task.key,status:'NOT_ATTEMPTED',reason:halt});continue;}
   const request=new AbortController(),requestSignal=AbortSignal.any([combined,request.signal]);let requestTimer;
   try{
    check();const delay=Math.max(0,REFRESH_LIMITS.interval_ms-(monotonic()-last));if(delay)await bounded(wait(delay,combined),combined);
    check();requireFact(monotonic()-last>=REFRESH_LIMITS.interval_ms,'CLOCK_OR_PACING_FAILURE');last=monotonic();
    requestTimer=setTimeout(()=>request.abort(),Math.min(REFRESH_LIMITS.request_ms,deadlineMs));
    const receipt=await bounded(fetchSource(task,()=>responseFor(task,fetcher,requestSignal,state),freshNow,requestSignal),requestSignal);
    check();requireFact(!requestSignal.aborted,'DEADLINE');const cutoff=freshNow();await validateReceipts([receipt],cutoff);check();
    // A newer whole monthly receipt may not silently discard retained warmup.
    const prior=plan.selected.find(r=>r.task.url===task.url);
    for(const b of prior?.payload.rows.filter(b=>b.date===plan.warmup)??[])
     requireFact(receipt.payload.rows.some(n=>n.date===b.date&&n.symbol===b.symbol),'REPLACEMENT_DROPS_WARMUP');
    const saved=save(dir,'receipt',{schema:'EVENT_ALIGNMENT_REFRESH_RECEIPT_V1',receipt,response:state.responses.at(-1)});
    newReceipts.push(receipt);receiptFiles.push(saved);attempts.push({task_key:task.key,status:'RECEIVED',available_at:receipt.available_at,payload_sha256:receipt.payload_hash});
   }catch(error){halt=combined.aborted?'DEADLINE':error instanceof RefreshFailure?error.code:'UNKNOWN_SOURCE_OR_CONTRACT_FAILURE';
    attempts.push({task_key:task.key,status:'STOPPED',reason:halt});
   }finally{clearTimeout(requestTimer);request.abort();}
  }
 }finally{clearTimeout(timer);}
 const cutoff=freshNow();requireFact(plan,'PLAN_NOT_PREPARED');
 const after=await prove(plan.input,await latestWhole([...plan.selected,...newReceipts]),cutoff);
 for(const task of plan.deferred_tasks??[])attempts.push({task_key:task.key,status:'NOT_ATTEMPTED',reason:'REQUEST_BUDGET_DEFERRED'});
 const summary={schema:'EVENT_ALIGNMENT_REFRESH_RESULT_V1',started_at:started,cutoff,report_date:localDate(cutoff),
  input_sha256:await v2Hash(plan.input),original:plan.original,before:plan.before,after,
  ...(plan.before.official_open?{missing_admission:plan.summary.missing_admission}:{}),
  requests:state.requests,new_receipts:newReceipts.length,planned_gets:plan.tasks.length,response_bytes_observed:state.bytes,
  halted:halt??(plan.deferred_tasks?.length?'REQUEST_BUDGET_DEFERRED':null),attempts,
  ...(plan.summary.request_budget?{request_budget:plan.summary.request_budget}:{}),
  elapsed_ms:Math.round(monotonic()-began),limits:{...REFRESH_LIMITS,total_ms:deadlineMs},
  source_join_status:after.same_date_totals.stock_ohlcv_and_taiex===1440?'OBSERVED_20_SESSION_SOURCE_JOIN':'HOLD_INCOMPLETE_SOURCE_SAMPLE',
  availability:'ACTUAL_RECEIPT_NOT_EARLIEST_PUBLICATION_NOT_BACKDATED',resource_license:LICENSE,production_operations:0,
  formal_v1_changed:false,reviewed_causal_events:0,forward_sample:0,outcome_sample:0};
 const saved=save(dir,'refresh',{schema:'EVENT_ALIGNMENT_REFRESH_BUNDLE_V1',input:plan.input,new_receipts:newReceipts,receipt_files:receiptFiles,summary});
 return {summary,bundle:saved.path,bundle_sha256:saved.sha256};
}
export async function replayEventAlignmentRefresh(bundle){
 const copy=structuredClone(bundle);requireFact(copy.schema==='EVENT_ALIGNMENT_REFRESH_BUNDLE_V1','BUNDLE_INVALID');
 const plan=await planEventAlignmentRefresh(copy.input,copy.summary.started_at);
 await validateReceipts(copy.new_receipts,copy.summary.cutoff);
 requireFact(copy.new_receipts.every(r=>stamp(r.available_at)>=stamp(copy.summary.started_at)
  &&plan.tasks.some(t=>t.url===r.task.url&&t.key===r.task.key)),'NEW_RECEIPT_SCOPE_OR_TIME_INVALID');
 const after=await prove(plan.input,await latestWhole([...plan.selected,...copy.new_receipts]),copy.summary.cutoff);
 requireFact(await v2Hash(copy.summary.request_budget??null)===await v2Hash(plan.summary.request_budget??null),'REPLAY_PROOF_MISMATCH');
 requireFact(localDate(copy.summary.cutoff)===plan.before.report_date&&await v2Hash(after)===await v2Hash(copy.summary.after)
  &&await v2Hash(plan.original)===await v2Hash(copy.summary.original)&&await v2Hash(plan.before)===await v2Hash(copy.summary.before),'REPLAY_PROOF_MISMATCH');
 if(plan.before.official_open)requireFact(Array.isArray(copy.summary.missing_admission)
  &&await v2Hash(copy.summary.missing_admission)===await v2Hash(plan.summary.missing_admission),'REPLAY_PROOF_MISMATCH');
 return {schema:'EVENT_ALIGNMENT_REFRESH_REPLAY_V1',original:plan.original,before:plan.before,after,
  ...(plan.summary.request_budget?{request_budget:plan.summary.request_budget}:{}),resource_license:LICENSE,production_operations:0,
  ...(plan.before.official_open?{missing_admission:plan.summary.missing_admission}:{}),
  formal_v1_changed:false,reviewed_causal_events:0,availability:'SAVED_ACTUAL_CUTOFF_NOT_CURRENT_VIEW'};
}
export async function runCli(args,{now=()=>new Date().toISOString(),fetcher=globalThis.fetch}={}){
 const [mode,...rest]=args,options={};requireFact(['plan','refresh','replay'].includes(mode)&&rest.length%2===0,'CLI_ARGUMENTS_INVALID');
 const allowed=mode==='replay'?['--bundle','--bundle-sha256']:mode==='refresh'?['--input','--input-sha256','--out']:['--input','--input-sha256'];
 for(let i=0;i<rest.length;i+=2){requireFact(allowed.includes(rest[i])&&!Object.hasOwn(options,rest[i])&&rest[i+1],'CLI_ARGUMENTS_INVALID');options[rest[i]]=rest[i+1];}
 requireFact(allowed.every(k=>options[k]),'CLI_ARGUMENTS_INVALID');
 if(mode==='replay')return replayEventAlignmentRefresh(readPinnedPrivate(options['--bundle'],options['--bundle-sha256']));
 const input=readPinnedPrivate(options['--input'],options['--input-sha256']);
 return mode==='plan'?(await planEventAlignmentRefresh(input,now())).summary:refreshEventAlignment(input,options['--out'],{now,fetcher});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await runCli(process.argv.slice(2))));}
 catch(e){console.error(JSON.stringify({status:'STOPPED',reason:e instanceof RefreshFailure?e.code:'UNKNOWN_INPUT_OR_CONTRACT_FAILURE',production_operations:0}));process.exitCode=1;}
}
