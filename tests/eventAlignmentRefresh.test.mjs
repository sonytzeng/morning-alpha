import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,lstatSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {planEventAlignmentRefresh,refreshEventAlignment,replayEventAlignmentRefresh,validateReceipts,runCli,REFRESH_LIMITS,localDate} from '../scripts/vnext/event-alignment-refresh.mjs';
import {normalizeSource,ADAPTER_VERSION} from '../src/features/vnext/dailyAdapter.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {v2Hash} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {historyUrl,tpexDailyUrl} from '../research/entry-official-history.ts';
import {V2_INDEX_URL} from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import {normalizeOfficialDailyOpenDataCandidate,OFFICIAL_DAILY_OPEN_PROFILES as OPEN_PROFILES,OFFICIAL_DAILY_OPEN_LIMITS} from '../research/official-daily-open-data-candidate.ts';
import {eventAlignmentFromDailyReceipts,eventAlignmentFromRetainedEvidence,withObservedCanonicalSectors} from '../research/recommendation-event-alignment-candidate.ts';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {csvRows} from '../src/features/vnext/dailyParsers.mjs';

// Entirely invented prices and taxonomy. This is contract evidence, not a real
// acquisition, canonical observation, causal review, market result or test of CI.
const AT='2026-10-17T08:00:00.000Z',OLD='2026-10-15T06:00:00.000Z',OVER='2026-10-17T07:00:00.000Z';
const OTC='3081 3324 3363 3529 4743 4908 4979 6274 6488 6547 8299'.split(' '),FULL=['2303','2330','2344'];
const TWSE=RECOMMENDATION_UNIVERSE.filter(s=>!OTC.includes(s));
const DATES=[];let date='2026-10-17';for(let i=0;i<21;i++){date=previousMarketTradingDate('TW',date);DATES.unshift(date);}
const roc=d=>String(Number(d.slice(0,4))-1911)+d.slice(4).replaceAll('-','/');
function task(kind,symbol,monthOrDate,suffix='old'){
 const common={key:`synthetic:${kind}:${symbol}:${monthOrDate}:${suffix}`,kind,format:'json',scope:'SYNTHETIC_TEST_ONLY',max_age_days:0};
 return kind==='PRICE'?{...common,symbols:[symbol],exchange:'TWSE',month:monthOrDate,url:historyUrl('TWSE',symbol,monthOrDate)}
  :kind==='OTC_PRICE'?{...common,symbols:[...OTC],exchange:'TPEX',date:monthOrDate,url:tpexDailyUrl(monthOrDate)}
   :{...common,symbols:[],month:monthOrDate,url:V2_INDEX_URL+'?date='+monthOrDate.replace('-','')+'01&response=json'};
}
function raw(t,through='2026-10-16'){
 const dates=DATES.filter(d=>d<=through&&(t.kind==='OTC_PRICE'?d===t.date:d.startsWith(t.month)));
 if(t.kind==='PRICE')return {stat:'OK',date:t.month.replace('-','')+'01',title:t.symbols[0]+' 隔離合成',
  fields:['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'],data:dates.map(d=>[roc(d),'1000000','100000000','100','110','99',String(100+DATES.indexOf(d)/10)])};
 if(t.kind==='BENCHMARK')return {stat:'OK',date:t.month.replace('-','')+'01',fields:['日期','開盤指數','最高指數','最低指數','收盤指數'],
  data:dates.map(d=>[roc(d),'20000','21000','19900',String(20000+DATES.indexOf(d))])};
 return {stat:'ok',date:t.date.replaceAll('-','/'),tables:[{fields:['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'],
  data:dates.flatMap(d=>OTC.map(s=>[s,'隔離合成',String(100+DATES.indexOf(d)/10),'0','100','110','99','100','1000000','100000000']))}]};
}
async function receipt(t,at,through){const r=raw(t,through),payload=await normalizeSource(t,r,at);return {task:t,first_seen_at:at,available_at:at,published_at:null,
 as_of:at,version:ADAPTER_VERSION,raw_hash:await snapshotHash(JSON.stringify(r)),payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};}
async function fixture(){
 const receipts=[],overlay_receipts=[];
 for(const month of ['2026-09','2026-10']){
  for(const s of TWSE)receipts.push(await receipt(task('PRICE',s,month),OLD,'2026-10-14'));
  receipts.push(await receipt(task('BENCHMARK','TAIEX',month),OLD,'2026-10-14'));
  for(const s of FULL)overlay_receipts.push(await receipt(task('PRICE',s,month,'overlay'),OVER,'2026-10-16'));
  overlay_receipts.push(await receipt(task('BENCHMARK','TAIEX',month,'overlay'),OVER,'2026-10-16'));
 }
 for(const d of DATES.filter(d=>d<='2026-10-14'))receipts.push(await receipt(task('OTC_PRICE','all',d),OLD,d));
 return {schema:'EVENT_ALIGNMENT_REFRESH_INPUT_V1',observation:{source:'public.sector_stock_map',observed_at:'2026-10-17T07:30:00.000001Z',
  rows:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,sector:'SYNTHETIC_'+symbol,is_active:true,created_at:'2026-06-08T02:23:01Z',updated_at:'2026-06-08T02:23:01Z'}))},receipts,overlay_receipts};
}
const SOURCE=await fixture();
const sha=b=>createHash('sha256').update(b).digest('hex');
function clock(){let ms=0;return {monotonic:()=>ms,now:()=>new Date(Date.parse(AT)+ms).toISOString(),wait:async n=>{ms+=n;},advance:n=>{ms+=n;}};}
async function isolated(fn){const dir=mkdtempSync(join(tmpdir(),'event-refresh-unit-'));try{return await fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}}

test('SYNTHETIC: all72 /143+8 whole receipts yield exactly58 monthly +2 daily GET, original1296 vs1302/1440',async()=>{
 assert.equal(SOURCE.receipts.length,143);assert.equal(SOURCE.overlay_receipts.length,8);const hash=await v2Hash(SOURCE);
 const p=await planEventAlignmentRefresh(SOURCE,AT);
 assert.equal(p.summary.selected_receipts,143);assert.deepEqual(p.summary.planned_by_kind,{PRICE:58,OTC_PRICE:2,BENCHMARK:0});
 assert.equal(p.original.same_date_totals.stock_ohlcv_and_taiex,1296);assert.equal(p.before.same_date_totals.stock_ohlcv_and_taiex,1302);
 assert.equal(p.before.same_date_totals.denominator,1440);assert.equal(p.before.taiex_sessions,20);assert.equal(p.warmup,'2026-09-15');
 assert(p.tasks.filter(t=>t.kind==='PRICE').every(t=>t.month==='2026-10'&&!FULL.includes(t.symbols[0])));
 assert.deepEqual(p.tasks.filter(t=>t.kind==='OTC_PRICE').map(t=>t.date),['2026-10-15','2026-10-16']);
 const old=SOURCE.receipts.find(r=>r.task.kind==='PRICE'&&r.task.symbols[0]==='2330');
 assert(p.selected.find(r=>r.task.url===old.task.url).first_seen_at===OVER);assert.equal(await v2Hash(SOURCE),hash);
 assert.equal(p.summary.resource_license,'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED');assert.equal(p.summary.production_operations,0);
});
test('SYNTHETIC: old receipt hash/status/firstseen/rawhash rejected even when a newer overlay would hide it',async()=>{
 for(const mutate of [r=>{r.payload.rows[0].close+=1;},r=>{r.status='UNAVAILABLE';},r=>{r.first_seen_at=AT;},r=>{r.raw_hash='unproven';}]){
  const x=structuredClone(SOURCE),r=x.receipts.find(r=>r.task.kind==='PRICE'&&r.task.symbols[0]==='2330');mutate(r);
  await assert.rejects(planEventAlignmentRefresh(x,AT),/RECEIPT_/);
 }
});
test('SYNTHETIC: exact URL, units, duplicate rows, future availability and canonical scope fail closed',async()=>{
 const x=structuredClone(SOURCE.receipts[0]);x.task.url+='&unapproved=1';await assert.rejects(validateReceipts([x],AT),/SOURCE_URL_INVALID/);
 for(const mutate of [r=>{r.payload.rows[0].session_scope='ROUNDED_THOUSANDS_EXCLUDES_BLOCK_TRADES';},r=>{r.payload.rows.push(r.payload.rows[0]);},r=>{r.payload.rows[0].volume=0;}]){
  const r=structuredClone(SOURCE.receipts[0]);mutate(r);r.payload_hash=await snapshotHash(r.payload);await assert.rejects(validateReceipts([r],AT),/BAR_|STOCK_/);
 }
 const future=structuredClone(SOURCE);future.observation.observed_at='2026-10-17T08:00:00.000001Z';await assert.rejects(planEventAlignmentRefresh(future,AT),/CANONICAL_OBSERVATION_UNAVAILABLE/);
 const missing=structuredClone(SOURCE);missing.observation.rows.pop();await assert.rejects(planEventAlignmentRefresh(missing,AT),/INPUT_SCOPE_INVALID/);
});
test('SYNTHETIC: original empty benchmark symbols and sample [TAIEX] schemas both accepted without rewriting',async()=>{
 const r=structuredClone(SOURCE.receipts.find(r=>r.task.kind==='BENCHMARK'));await validateReceipts([r],AT);r.task.symbols=['TAIEX'];await validateReceipts([r],AT);
 r.task.symbols=['2330'];await assert.rejects(validateReceipts([r],AT),/BENCHMARK_TASK_INVALID/);
});
test('SYNTHETIC: newest exactURL selection never splices fields; equal-time conflicting receipt rejects',async()=>{
 const x=structuredClone(SOURCE),r=x.overlay_receipts.find(r=>r.task.kind==='PRICE');r.first_seen_at=r.available_at=SOURCE.receipts.find(o=>o.task.url===r.task.url).available_at;
 r.as_of=r.available_at;for(const b of r.payload.rows){b.available_at=b.first_seen_at=r.available_at;const bar=Object.fromEntries(['date','open','high','low','close','volume','amount','source_ref','available_at'].map(k=>[k,b[k]]));b.evidence_hash=await snapshotHash(bar);}
 r.payload_hash=await snapshotHash(r.payload);await assert.rejects(planEventAlignmentRefresh(x,AT),/TIED_RESOURCE_CONFLICT/);
});
test('SYNTHETIC: 60 bounded GETs call existing parser/unchanged V1, preserve input, immutable0600 receipt files and offline replay',async()=>isolated(async dir=>{
 const c=clock(),starts=[],inputHash=await v2Hash(SOURCE),plan=await planEventAlignmentRefresh(SOURCE,AT);
 const result=await refreshEventAlignment(SOURCE,dir,{...c,fetcher:async(url,options)=>{
  starts.push(c.monotonic());assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
  const t=plan.tasks.find(t=>t.url===url);assert(t);return new Response(JSON.stringify(raw(t)),{headers:{'content-type':'application/json'}});
 }});
 assert.equal(starts.length,60);assert(starts.every((s,i)=>!i||s-starts[i-1]>=1600));assert.equal(result.summary.halted,null);
 assert.equal(result.summary.after.same_date_totals.stock_ohlcv_and_taiex,1440);assert.equal(result.summary.after.same_date_totals.denominator,1440);
 assert.equal(result.summary.after.taiex_sessions,20);assert.equal(result.summary.source_join_status,'OBSERVED_20_SESSION_SOURCE_JOIN');
 assert.equal(result.summary.after.assessment_session,'NOT_A_TRADING_SESSION');assert.equal(result.summary.formal_v1_changed,false);
 assert.equal(result.summary.reviewed_causal_events,0);assert.equal(await v2Hash(SOURCE),inputHash);
 const bytes=readFileSync(result.bundle);assert.equal(sha(bytes),result.bundle_sha256);const bundle=JSON.parse(bytes);
 assert.equal(bundle.new_receipts.length,60);assert(bundle.new_receipts.every(r=>Date.parse(r.first_seen_at)>=Date.parse(AT)&&r.first_seen_at===r.available_at));
 assert.equal(readdirSync(dir).length,61);for(const name of readdirSync(dir))assert.equal(lstatSync(join(dir,name)).mode&0o777,0o600);
 const replay=await replayEventAlignmentRefresh(bundle);assert.equal(replay.after.same_date_totals.stock_ohlcv_and_taiex,1440);
 assert.equal(replay.availability,'SAVED_ACTUAL_CUTOFF_NOT_CURRENT_VIEW');assert.equal(replay.resource_license,'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED');
 bundle.new_receipts[0].payload.rows[0].close+=1;await assert.rejects(replayEventAlignmentRefresh(bundle),/PAYLOAD_HASH_MISMATCH/);
}));
test('SYNTHETIC: 403/429/unknown errors stop remaining plan, no retries or error/response reflection',async()=>{
 for(const status of [403,429,'throw'])await isolated(async dir=>{const c=clock();let calls=0;
  const result=await refreshEventAlignment(SOURCE,dir,{...c,fetcher:async()=>{calls++;if(status==='throw')throw Error('PRIVATE_PROVIDER_TEXT');return new Response('PRIVATE_PROVIDER_TEXT',{status});}});
  assert.equal(calls,1);assert.equal(result.summary.new_receipts,0);assert.equal(result.summary.attempts.filter(a=>a.status==='NOT_ATTEMPTED').length,59);
  assert.equal(result.summary.halted,status==='throw'?'UNKNOWN_SOURCE_OR_CONTRACT_FAILURE':'HTTP_'+status);assert(!JSON.stringify(result).includes('PRIVATE_PROVIDER_TEXT'));
 });
});
test('SYNTHETIC: pre-aborted calls make zero transport requests and CLI disallows arbitrary URL/cutoff',async()=>isolated(async dir=>{
 const a=new AbortController();a.abort();let calls=0;const result=await refreshEventAlignment(SOURCE,dir,{...clock(),signal:a.signal,fetcher:async()=>{calls++;throw Error('MUST_NOT_FETCH');}});
 assert.equal(calls,0);assert.equal(result.summary.halted,'DEADLINE');assert.equal(result.summary.new_receipts,0);
 await assert.rejects(runCli(['refresh','--url','https://example.invalid']),/CLI_ARGUMENTS_INVALID/);
 await assert.rejects(runCli(['plan','--cutoff',AT]),/CLI_ARGUMENTS_INVALID/);
 assert.equal(localDate('2026-10-16T16:00:00Z'),'2026-10-17');
 assert.deepEqual(REFRESH_LIMITS,{requests:64,total_ms:150000,request_ms:12000,interval_ms:1600,aggregate_bytes:8_000_000});
}));
test('SYNTHETIC: declared/streamed aggregate byte limit and malformed JSON never create an admitted receipt',async()=>{
 for(const mode of ['header','stream','malformed'])await isolated(async dir=>{
  const result=await refreshEventAlignment(SOURCE,dir,{...clock(),fetcher:async()=>mode==='header'?new Response('x',{headers:{'content-length':'8000001'}})
   :mode==='stream'?new Response(new Uint8Array(8_000_001)):new Response('{ malformed')});
  assert.equal(result.summary.requests,1);assert.equal(result.summary.new_receipts,0);
  assert.equal(result.summary.halted,mode==='malformed'?'UNKNOWN_SOURCE_OR_CONTRACT_FAILURE':'RESPONSE_BYTE_BUDGET');
 });
});
test('SYNTHETIC: abort-ignoring rejection is observed, no background unhandled rejection or receipt',async()=>isolated(async dir=>{
 const c=clock(),a=new AbortController(),unhandled=[];const listen=e=>unhandled.push(e);process.on('unhandledRejection',listen);
 try{
  const result=await refreshEventAlignment(SOURCE,dir,{...c,signal:a.signal,fetcher:()=>{a.abort();return Promise.reject(Error('LATE_PRIVATE_ERROR'));}});
  await new Promise(r=>setImmediate(r));assert.equal(result.summary.halted,'DEADLINE');assert.equal(result.summary.new_receipts,0);assert.equal(unhandled.length,0);
 }finally{process.removeListener('unhandledRejection',listen);}
}));
test('SYNTHETIC: CLI pinned physical input rejects tamper without transport',async()=>isolated(async dir=>{
 const path=join(dir,'input.json'),bytes=Buffer.from(JSON.stringify(SOURCE));writeFileSync(path,bytes,{mode:0o600});let calls=0;
 const options={now:()=>AT,fetcher:()=>{calls++;throw Error('NO_NETWORK');}};
 const p=await runCli(['plan','--input',path,'--input-sha256',sha(bytes)],options);assert.equal(p.planned_gets,60);assert.equal(calls,0);
 writeFileSync(path,Buffer.concat([bytes,Buffer.from(' ')]));await assert.rejects(runCli(['plan','--input',path,'--input-sha256',sha(bytes)],options),/PHYSICAL_INPUT_HASH_MISMATCH/);
}));

// Saved exact-resource fixtures are entirely invented CSV bytes. No private
// archive, captured market values, actual endpoint request or admission grant.
const HELD_AT='2026-10-18T23:05:00.000Z',NATIVE_DATE='2026-10-16';
const NATIVE_TIMES={first_seen_at:'2026-10-16T06:00:00.123456Z',available_at:'2026-10-17T07:59:00.234567Z'};
const csv=rows=>rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
function openResources(date=NATIVE_DATE){
 const native=String(Number(date.slice(0,4))-1911)+date.slice(4).replaceAll('-','');
 return Object.entries(OPEN_PROFILES).map(([id,profile])=>{
  const stock=symbol=>{
   const values={'日期':native,'資料日期':native,'證券代號':symbol,'代號':symbol,
    '證券名稱':'SYNTHETIC_PRIVATE_NATIVE_ROW','名稱':'SYNTHETIC_PRIVATE_NATIVE_ROW',
    '開盤價':'100','最高價':'140','最低價':'90','收盤價':'123','漲跌價差':'+2.00',
    '開盤':'100','最高':'140','最低':'90','收盤':'123','漲跌':'+2.00','均價':'110',
    '成交股數':'1000000','成交金額':'100000000','成交筆數':'100','最後買價':'122','最後賣價':'124',
    '發行股數':'100000000','次日參考價':'123','次日漲停價':'135','次日跌停價':'111'};
   return profile.headers.map(h=>values[h]);
  };
  const rows=id==='TAIEX_11555'?[[native,'發行量加權股價指數','20000','+','10','0.05','']]
   :(id==='TWSE_11549'?TWSE:OTC).map(stock);
  const body=Buffer.from('\uFEFF'+csv([profile.headers,...rows]));
  return {receipt:{schema:'EXACT_REGISTERED_OPEN_RESOURCE_RAW_RECEIPT_V1',id,url:profile.url,http:200,
   bytes:body.length,raw_sha256:sha(body),...NATIVE_TIMES,fields:[...profile.headers],row_count:rows.length,native_dates:[native],
   original_published_at:null,original_version:null,source_session_scope:'NOT_YET_REVIEWED',
   source_admission:false,canonical_admission:false,publication_approval:false},response_body_base64:body.toString('base64')};
 });
}
function normalizedOpen(resources,date=NATIVE_DATE,cutoff=HELD_AT){
 return normalizeOfficialDailyOpenDataCandidate({trading_date:date,cutoff,resources:resources.map(r=>({receipt:r.receipt,response_body:Buffer.from(r.response_body_base64,'base64')}))});
}
async function sourceThrough(through){
 const input=structuredClone(SOURCE);input.receipts=[];input.overlay_receipts=[];
 for(const month of ['2026-09','2026-10']){
  for(const s of TWSE)input.receipts.push(await receipt(task('PRICE',s,month),OVER,through));
  input.receipts.push(await receipt(task('BENCHMARK','TAIEX',month),OVER,through));
 }
 for(const d of DATES.filter(d=>d<=through))input.receipts.push(await receipt(task('OTC_PRICE','all',d),OVER,d));
 return input;
}
const SINGLE_GAP=await sourceThrough('2026-10-15');
function annotatedOpenResources(){
 return openResources().map(resource=>({...resource,receipt:{...resource.receipt,
  dataset:'https://data.gov.tw/dataset/'+resource.receipt.id.split('_')[1],request_count:1,requested_at:'2026-10-16T05:59:59.699Z',
  universe_symbols:resource.receipt.id==='TAIEX_11555'?null:resource.receipt.id==='TWSE_11549'?61:11,
  licensing:'EXACT_REGISTERED_OGL_V1_RESOURCE_ATTRIBUTION_AND_THIRD_PARTY_CONDITIONS_REMAIN',
  normalization:'CSV_SHAPE_ONLY_NOT_ORIGINAL_V1_EVIDENCE'}}));
}
test('SOURCE_CONTRACT_REPRO SYNTHETIC: complete 23-key exact receipts retain all six real-shape metadata fields and unchanged raw bytes without authority',async()=>isolated(async dir=>{
 const resources=annotatedOpenResources(),original=openResources(),input=structuredClone(SINGLE_GAP);input.official_open_resources=resources;
 const physicalBefore=sha(Buffer.from(JSON.stringify(input))),inputHash=await v2Hash(input);
 for(const [i,resource]of resources.entries()){
  assert.equal(Object.keys(resource.receipt).length,23);
  if(resource.receipt.id==='TAIEX_11555')assert.equal(resource.receipt.universe_symbols,null);
  else assert.equal(typeof resource.receipt.universe_symbols,'number');
  for(const key of Object.keys(original[i].receipt))assert.deepEqual(resource.receipt[key],original[i].receipt[key]);
  assert.equal(resource.response_body_base64,original[i].response_body_base64);
 }
 let calls=0;
 const result=await refreshEventAlignment(input,dir,{now:()=>HELD_AT,monotonic:()=>0,fetcher:async()=>{calls++;throw Error('NO_HTTP');}});
 assert.equal(calls,0);assert.equal(result.summary.after.official_open.held_quotes,73);assert.equal(result.summary.after.official_open.verified_quotes,0);
 assert.equal(result.summary.input_sha256,inputHash);assert.equal(sha(Buffer.from(JSON.stringify(input))),physicalBefore);
 const bundleBytes=readFileSync(result.bundle),bundle=JSON.parse(bundleBytes);assert.equal(sha(bundleBytes),result.bundle_sha256);
 assert.deepEqual(bundle.input.official_open_resources,resources);assert.equal(await v2Hash(bundle.input),inputHash);
 for(const resource of bundle.input.official_open_resources){assert.equal(Object.keys(resource.receipt).length,23);
  assert.equal(sha(Buffer.from(resource.response_body_base64,'base64')),resource.receipt.raw_sha256);}
 const baseline=await planEventAlignmentRefresh({...structuredClone(SINGLE_GAP),official_open_resources:original},HELD_AT);
 assert.notEqual(baseline.summary.input_sha256,inputHash,'full input hash includes retained metadata');
 assert.deepEqual(result.summary.before.official_open,baseline.before.official_open,'metadata never grants evidence or rights');
 for(const key of ['source_admission','canonical_admission','publication_approval'])assert.equal(result.summary.before.official_open[key],false);
 const replay=await replayEventAlignmentRefresh(bundle);assert.deepEqual(replay.after,result.summary.after);
 assert(!JSON.stringify(result.summary).includes('licensing'));assert(!JSON.stringify(replay).includes('requested_at'));
}));
test('SOURCE_CONTRACT_REPRO SYNTHETIC: required keys, unknown annotations, exact dataset, bounded integer metadata, microsecond request ordering and metadata authority tamper reject',async()=>{
 const cases=[
  r=>{delete r.raw_sha256;},r=>{r.unknown_annotation=true;},r=>{r.dataset='https://data.gov.tw/dataset/11370';},r=>{r.dataset+='?unbound=1';},
  r=>{r.request_count=0;},r=>{r.request_count=1.1;},r=>{r.request_count='1';},
  r=>{r.requested_at='2026-10-16T06:00:00.123457Z';},r=>{r.requested_at='2026-02-30T00:00:00Z';},
  r=>{r.universe_symbols=[61];},r=>{r.universe_symbols='61';},r=>{r.universe_symbols=null;},r=>{r.universe_symbols=-1;},r=>{r.universe_symbols=73;},r=>{r.universe_symbols=0.5;},
  r=>{r.licensing='APPROVED';},r=>{r.normalization='ORIGINAL_V1_EVIDENCE';},r=>{r.source_admission=true;},r=>{r.canonical_admission=true;},r=>{r.publication_approval=true;},
 ];
 for(const mutate of cases){const input=structuredClone(SINGLE_GAP);input.official_open_resources=annotatedOpenResources();mutate(input.official_open_resources[0].receipt);
  await assert.rejects(planEventAlignmentRefresh(input,HELD_AT),/OPEN_RESOURCE_|OPEN_DATA_/);
 }
});

test('SYNTHETIC: 73 held native quotes append after unchanged base facts, decision and 72/1440 verified coverage stay unchanged',async()=>{
 const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources();const originalHash=await v2Hash(input);
 const baseline=await planEventAlignmentRefresh(SINGLE_GAP,HELD_AT),p=await planEventAlignmentRefresh(input,HELD_AT);
 const open=p.before.official_open,normalized=normalizedOpen(input.official_open_resources);
 assert.equal(open.held_quotes,73);assert.equal(open.stock_facts,72);assert.equal(open.benchmark_facts,1);assert.equal(open.verified_quotes,0);
 assert.equal(open.classification,'HELD_NATIVE_FACTS_NOT_CANONICAL_ADMISSION');assert.equal(open.decision_unchanged,true);assert.equal(open.base_data_preserved,true);
 assert.deepEqual(p.before.same_date_totals,baseline.before.same_date_totals);assert.equal(p.before.coverage.length,72);
 assert.equal(p.before.same_date_totals.denominator,1440);assert.equal(p.before.same_date_totals.stock_ohlcv_and_taiex,1368);
 assert.equal(p.before.decision_action,baseline.before.decision_action);assert.equal(open.evaluated_count,0);
 const id={report_date:'2026-10-19',today_date:'2026-10-19',generated_at:HELD_AT,data_as_of:HELD_AT,
  revision_id:'isolated-event-refresh:'+HELD_AT,is_trading_day:true};
 const joined=await withObservedCanonicalSectors(emptyEvidenceData(),id,input.observation,await v2Hash(input.observation));
 const base=await eventAlignmentFromDailyReceipts(id,joined.data,p.selected),data=structuredClone(base.data);data.quotes.push(...normalized.data.quotes);
 const result=await eventAlignmentFromRetainedEvidence(data,id,await v2Hash(data));
 assert.equal(open.base_data_sha256,await v2Hash(base.data));assert.equal(open.joined_data_sha256,await v2Hash(result.data));
 assert.equal(open.held_quotes_sha256,await v2Hash(normalized.data.quotes));assert.equal(open.decision_sha256,await v2Hash(base.decision));
 assert.deepEqual(result.decision,base.decision);assert.deepEqual(result.data.quotes.slice(0,base.data.quotes.length),base.data.quotes);
 for(const key of ['universe','news','mappings','catalysts','flows','earnings','evaluations','failures'])assert.deepEqual(result.data[key],base.data[key]);
 for(const q of result.data.quotes.slice(base.data.quotes.length)){
  assert.equal(q.quality_status,'source_scope_unreviewed');assert.equal(q.raw_payload.contract,'OFFICIAL_DAILY_OPEN_DATA_CANDIDATE_V1');
  assert.equal(q.first_seen_at,NATIVE_TIMES.first_seen_at);assert.equal(q.available_at,NATIVE_TIMES.available_at);
  assert.notEqual(q.first_seen_at,q.available_at);assert.equal(q.published_at,null);assert.equal(q.original_version,null);
  assert.equal(q.raw_payload.original_published_at,null);assert.equal(q.raw_payload.original_version,null);assert.equal(q.raw_payload.source_version,null);
  for(const key of ['source_admission','canonical_admission','publication_approval'])assert.equal(q[key],false);
 }
 assert.equal(await v2Hash(input),originalHash);const publicText=JSON.stringify(p.summary);
 for(const privateValue of ['SYNTHETIC_PRIVATE_NATIVE_ROW','raw_record','native_cells','response_body_base64',input.official_open_resources[0].response_body_base64])assert(!publicText.includes(privateValue));
});
test('SYNTHETIC: saved held same-day cells are missing admission, not raw; no duplicate request when all resource gaps are covered',async()=>{
 const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources();
 const baseline=await planEventAlignmentRefresh(SINGLE_GAP,HELD_AT),p=await planEventAlignmentRefresh(input,HELD_AT);
 assert.deepEqual(baseline.summary.planned_by_kind,{PRICE:61,OTC_PRICE:1,BENCHMARK:1});assert.equal(p.tasks.length,0);
 assert.equal(p.summary.missing_admission.length,73);assert(p.summary.missing_admission.every(c=>c.trading_date===NATIVE_DATE&&c.classification==='RAW_PRESENT_CANONICAL_ADMISSION_MISSING'));
 assert(p.before.coverage.every(c=>c.same_date.missing_stock_dates.includes(NATIVE_DATE)&&c.same_date.missing_taiex_dates.includes(NATIVE_DATE)));
});
test('SYNTHETIC: one held day never suppresses a monthly resource still needed for another day or an OTC batch with another missing symbol',async()=>{
 const input=structuredClone(SOURCE);input.official_open_resources=openResources();
 const p=await planEventAlignmentRefresh(input,HELD_AT);
 assert.deepEqual(p.summary.planned_by_kind,{PRICE:58,OTC_PRICE:1,BENCHMARK:0});
 assert.deepEqual(p.tasks.filter(t=>t.kind==='OTC_PRICE').map(t=>t.date),['2026-10-15']);
 assert(p.tasks.filter(t=>t.kind==='PRICE').every(t=>t.month==='2026-10'&&!FULL.includes(t.symbols[0])));
 assert.equal(p.summary.missing_admission.length,69); // 58 missing TWSE + 11 OTC, existing benchmark already complete.
 const partial=structuredClone(SINGLE_GAP);partial.official_open_resources=openResources().filter(r=>r.receipt.id!=='TPEX_11370');
 const otc=await planEventAlignmentRefresh(partial,HELD_AT);
 assert.deepEqual(otc.summary.planned_by_kind,{PRICE:0,OTC_PRICE:1,BENCHMARK:0}); // 11371 comparison cannot fill primary stock facts.
 assert.equal(otc.summary.missing_admission.length,62);
});
test('SYNTHETIC: one invalid native stock fact leaves its OTC resource needed; invalid benchmark is not a held cell',async()=>{
 for(const id of ['TPEX_11370','TAIEX_11555']){
  const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources();
  const resource=input.official_open_resources.find(r=>r.receipt.id===id),rows=csvRows(Buffer.from(resource.response_body_base64,'base64').toString().replace(/^\uFEFF/,''));
  rows[1][id==='TPEX_11370'?9:2]='0'; // invalid required shares/close, not an invented usable fact.
  const bytes=Buffer.from(csv(rows));resource.response_body_base64=bytes.toString('base64');resource.receipt.bytes=bytes.length;resource.receipt.raw_sha256=sha(bytes);
  const p=await planEventAlignmentRefresh(input,HELD_AT);
  assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].kind,id==='TPEX_11370'?'OTC_PRICE':'BENCHMARK');
  assert.equal(p.before.official_open.held_quotes,72);assert.equal(p.summary.missing_admission.length,72);
 }
});
test('SYNTHETIC: different native date cannot fill the missing date, and held facts cannot replace required retained warmup',async()=>{
 const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources('2026-10-15');
 const p=await planEventAlignmentRefresh(input,HELD_AT);assert.equal(p.tasks.length,63);assert.deepEqual(p.summary.missing_admission,[]);
 const warmup=structuredClone(SINGLE_GAP);warmup.official_open_resources=openResources('2026-09-15');
 const r=warmup.receipts.find(r=>r.task.kind==='PRICE'&&r.task.symbols[0]==='2330'&&r.task.month==='2026-09');
 r.payload.rows=r.payload.rows.filter(b=>b.date!=='2026-09-15');r.payload_hash=await snapshotHash(r.payload);
 await assert.rejects(planEventAlignmentRefresh(warmup,HELD_AT),/EXISTING_WARMUP_MISSING/);
});
test('SYNTHETIC: saved exact resource envelope, date, schema, canonical base64, byte length, source hash and original times fail closed',async()=>{
 const cases=[
  ['resource limit',x=>{x.official_open_resources.push(x.official_open_resources[0]);}],
  ['empty option',x=>{x.official_open_resources=[];}],
  ['not an array',x=>{x.official_open_resources={};}],
  ['unknown schema',x=>{x.official_open_resources[0].receipt.schema='UNKNOWN';}],
  ['unknown resource',x=>{x.official_open_resources[0].receipt.id='UNKNOWN';}],
  ['unknown field',x=>{x.official_open_resources[0].unexpected=true;}],
  ['incomplete receipt',x=>{delete x.official_open_resources[0].receipt.original_version;}],
  ['wrong date',x=>{x.official_open_resources[0].receipt.native_dates=['1151015'];}],
  ['unknown date',x=>{for(const r of x.official_open_resources)r.receipt.native_dates=['not-a-date'];}],
  ['all receipt dates inconsistent with bytes',x=>{for(const r of x.official_open_resources)r.receipt.native_dates=['1151015'];}],
  ['noncanonical base64',x=>{x.official_open_resources[0].response_body_base64+='\n';}],
  ['invalid alphabet',x=>{x.official_open_resources[0].response_body_base64='!!!!';}],
  ['missing padding',x=>{x.official_open_resources[0].response_body_base64='AA';}],
  ['nonzero unused pad bits',x=>{x.official_open_resources[0].response_body_base64='AB==';}],
  ['encoded limit',x=>{x.official_open_resources[0].response_body_base64='AAAA'.repeat(Math.ceil(OFFICIAL_DAILY_OPEN_LIMITS.bytes_per_resource/3)+1);}],
  ['decoded limit',x=>{x.official_open_resources[0].response_body_base64=Buffer.alloc(OFFICIAL_DAILY_OPEN_LIMITS.bytes_per_resource+1).toString('base64');}],
  ['byte length',x=>{x.official_open_resources[0].receipt.bytes++;}],
  ['hash',x=>{x.official_open_resources[0].receipt.raw_sha256='0'.repeat(64);}],
  ['firstseen after available',x=>{x.official_open_resources[0].receipt.first_seen_at=HELD_AT;}],
  ['future availability microsecond',x=>{x.official_open_resources[0].receipt.available_at='2026-10-18T23:05:00.000001Z';}],
  ['invalid timestamp',x=>{x.official_open_resources[0].receipt.available_at='2026-02-30T00:00:00Z';}],
  ['before completed session',x=>{x.official_open_resources[0].receipt.first_seen_at='2026-10-16T05:29:59Z';}],
  ['publication invention',x=>{x.official_open_resources[0].receipt.original_published_at=NATIVE_TIMES.first_seen_at;}],
  ['version invention',x=>{x.official_open_resources[0].receipt.original_version='invented';}],
  ['admission invention',x=>{x.official_open_resources[0].receipt.source_admission=true;}],
 ];
 for(const [label,mutate]of cases){const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources();mutate(input);
  await assert.rejects(planEventAlignmentRefresh(input,HELD_AT),/OPEN_RESOURCE_|OPEN_DATA_/,label);
 }
});
test('SYNTHETIC: held option is private-bundle-bound, zero fetch, safe summary and replay preserve distinct source times without cutoff override',async()=>isolated(async dir=>{
 const input=structuredClone(SINGLE_GAP);input.official_open_resources=openResources();let calls=0;
 const options={now:()=>HELD_AT,monotonic:()=>0,fetcher:async()=>{calls++;throw Error('MUST_NOT_FETCH_OFFICIAL_CSV');}};
 const result=await refreshEventAlignment(input,dir,options);assert.equal(calls,0);assert.equal(result.summary.requests,0);
 assert.equal(result.summary.planned_gets,0);assert.equal(result.summary.after.official_open.held_quotes,73);
 assert.equal(result.summary.missing_admission.length,73);
 assert.equal(result.summary.source_join_status,'HOLD_INCOMPLETE_SOURCE_SAMPLE');
 const bundle=JSON.parse(readFileSync(result.bundle));assert.deepEqual(bundle.input.official_open_resources,input.official_open_resources);
 assert.deepEqual(bundle.new_receipts,[]);assert.equal(bundle.summary.started_at,HELD_AT);
 const replay=await replayEventAlignmentRefresh(bundle);assert.deepEqual(replay.after,result.summary.after);assert.deepEqual(replay.missing_admission,result.summary.missing_admission);
 assert(!JSON.stringify(result.summary).includes('SYNTHETIC_PRIVATE_NATIVE_ROW'));assert(!JSON.stringify(replay).includes('response_body_base64'));
 const path=join(dir,'input.json'),bytes=Buffer.from(JSON.stringify(input));writeFileSync(path,bytes,{mode:0o600});
 const cli=await runCli(['plan','--input',path,'--input-sha256',sha(bytes)],options);
 assert.equal(cli.cutoff,HELD_AT);assert.equal(cli.planned_gets,0);assert.equal(calls,0);
 await assert.rejects(runCli(['plan','--input',path,'--input-sha256',sha(bytes),'--cutoff',AT],options),/CLI_ARGUMENTS_INVALID/);
 const wrongDiagnostic=structuredClone(bundle);wrongDiagnostic.summary.missing_admission.pop();
 await assert.rejects(replayEventAlignmentRefresh(wrongDiagnostic),/REPLAY_PROOF_MISMATCH/);
 const late=structuredClone(input);for(const r of late.official_open_resources)r.receipt.available_at='2026-10-19T00:00:00Z';
 const lateBytes=Buffer.from(JSON.stringify(late));writeFileSync(path,lateBytes);
 await assert.rejects(runCli(['plan','--input',path,'--input-sha256',sha(lateBytes)],options),/OPEN_DATA_NOT_AVAILABLE_AT_CUTOFF/);
 bundle.input.official_open_resources[0].receipt.available_at='2026-10-18T23:05:00.000001Z';
 await assert.rejects(replayEventAlignmentRefresh(bundle),/OPEN_DATA_NOT_AVAILABLE_AT_CUTOFF/);
}));
test('SYNTHETIC: absence of official option preserves the original plan/refresh/replay field shapes',async()=>isolated(async dir=>{
 const input=await sourceThrough(NATIVE_DATE),plan=await planEventAlignmentRefresh(input,HELD_AT);
 assert.equal(plan.tasks.length,0);assert(!Object.hasOwn(plan.before,'official_open'));assert(!Object.hasOwn(plan.summary,'missing_admission'));
 const result=await refreshEventAlignment(input,dir,{now:()=>HELD_AT,monotonic:()=>0,fetcher:async()=>{throw Error('NO_FETCH');}});
 const replay=await replayEventAlignmentRefresh(JSON.parse(readFileSync(result.bundle)));
 assert(!Object.hasOwn(result.summary,'missing_admission'));assert(!Object.hasOwn(replay,'missing_admission'));assert(!Object.hasOwn(replay.after,'official_open'));
}));
test('SOURCE_CONTRACT_REPRO SYNTHETIC: 65 legitimate missing resources become a64-request checkpoint, never a larger budget or false completion',async()=>isolated(async dir=>{
 const at='2026-10-20T23:05:00.000Z',input=structuredClone(SOURCE);input.official_open_resources=openResources('2026-10-20');
 for(const r of input.official_open_resources){r.receipt.first_seen_at='2026-10-20T06:00:00.000Z';r.receipt.available_at='2026-10-20T07:00:00.000Z';}
 const p=await planEventAlignmentRefresh(input,at),budget=p.summary.request_budget;
 assert.equal(budget.classification,'REQUEST_BUDGET_DEFERRED');assert.equal(budget.total_missing_resources,65);
 assert.equal(p.tasks.length,64);assert.equal(p.deferred_tasks.length,1);assert.equal(budget.maximum_requests,64);
 assert.equal(p.summary.missing_admission.length,73);assert.equal(p.before.official_open.held_quotes,73);
 assert.equal(p.before.official_open.verified_quotes,0);assert.equal(p.before.same_date_totals.denominator,1440);
 assert.equal(new Set([...p.tasks,...p.deferred_tasks].map(t=>t.key)).size,65);
 let ms=0,calls=0;
 const result=await refreshEventAlignment(input,dir,{now:()=>new Date(Date.parse(at)+ms).toISOString(),monotonic:()=>ms,
  wait:async n=>{ms+=n;},fetcher:async url=>{calls++;assert(calls<=64);const t=p.tasks.find(t=>t.url===url);assert(t);
   return new Response(JSON.stringify(raw(t)),{status:200,headers:{'content-type':'application/json'}});}});
 assert.equal(calls,64);assert.equal(result.summary.requests,64);assert.equal(result.summary.halted,'REQUEST_BUDGET_DEFERRED');
 assert.equal(result.summary.request_budget.deferred_resources,1);
 assert.deepEqual(result.summary.attempts.filter(a=>a.reason==='REQUEST_BUDGET_DEFERRED').map(a=>a.task_key),budget.deferred_task_keys);
 assert.equal(result.summary.source_join_status,'HOLD_INCOMPLETE_SOURCE_SAMPLE');
 const bundle=JSON.parse(readFileSync(result.bundle)),replay=await replayEventAlignmentRefresh(bundle);
 assert.deepEqual(replay.request_budget,budget);assert.equal(replay.formal_v1_changed,false);assert.equal(replay.production_operations,0);
 const changed=structuredClone(bundle);changed.summary.request_budget.deferred_resources=0;
 await assert.rejects(replayEventAlignmentRefresh(changed),/REPLAY_PROOF_MISMATCH/);
 assert.deepEqual(REFRESH_LIMITS,{requests:64,total_ms:150000,request_ms:12000,interval_ms:1600,aggregate_bytes:8_000_000});
}));
