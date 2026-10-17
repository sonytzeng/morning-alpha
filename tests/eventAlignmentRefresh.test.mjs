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
