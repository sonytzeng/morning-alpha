/** Local, offline, Owner-only research. No provider calls or Production writes. */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {auditEntryProjection} from '../../tests/helpers/entryRetainedProjection.mjs';
import {APPROVED_PROJECTIONS} from '../../tests/entryOpportunityRealReplay.integration.mjs';
import {snapshotHash,sourceSafe} from '../../src/features/vnext/contracts.ts';
import {buildRealResearch,verifyResearchLock} from '../../src/features/vnext/realResearch.ts';
import {auditHistory} from '../../research/entry-history.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function privatePath(path,directory=false){
 const p=realpathSync(path),s=lstatSync(path);assert(!s.isSymbolicLink()&&(directory?s.isDirectory():s.isFile()),'REGULAR_PRIVATE_PATH_REQUIRED');
 assert(p!==root&&!p.startsWith(root+'/')&&!(s.mode&0o077),'PRIVATE_PATH_OUTSIDE_REPOSITORY_REQUIRED');return p;
}
function read(path){privatePath(path);assert(lstatSync(path).size<8_000_000,'PRIVATE_FILE_LIMIT');return JSON.parse(readFileSync(path,'utf8'));}
const safeNumber=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function sourceFact({symbol,kind,source,raw,firstSeen,available,asOf=null,published=null,period=null,summary,values,limitations=[]}){
 assert(sourceSafe(source),'UNSAFE_SOURCE');
 return {id:digest({symbol,kind,source,raw}),symbol,kind,source,evidence_hash:digest(raw),published_at:published,
  first_seen_at:firstSeen??null,available_at:available??null,as_of:asOf,period,summary,values,limitations};
}
function captureFacts(p,symbol){
 const cutoff=p.input.identity.generated_at,capture=p.input.captures.find(c=>c.symbol===symbol&&c.status==='PASS');
 const bars=(capture?.rows??[]).filter(r=>r.symbol===symbol&&Date.parse(r.ingested_at)<=Date.parse(cutoff)).map(r=>({date:r.trading_date,
  ...Object.fromEntries(['open','high','low','close'].map(k=>[k,safeNumber(r.raw_payload[k])])),volume:safeNumber(r.raw_payload.volume_shares),amount:safeNumber(r.raw_payload.amount_twd),
  available_at:r.ingested_at,source_ref:'https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+symbol,as_of:r.captured_at})).sort((a,b)=>a.date.localeCompare(b.date));
 const coverage=Object.fromEntries([20,60,120].map(d=>{const a=auditHistory(bars,p.input.identity.report_date,cutoff,d);return [d,{complete:a.complete,valid:a.valid,reason:a.gaps[0]?.reason??null}];}));
 coverage[250]={complete:false,valid:bars.length,reason:'ONLY_45_ORIGINAL_RETAINED_SESSIONS_NO_250D_PIT'};
 const facts=[],last=bars.at(-1),b20=bars.slice(-20);
 if(capture&&last&&coverage[20].complete){
  const average=b20.reduce((a,b)=>a+b.close,0)/20,volume=b20.slice(0,-1).reduce((a,b)=>a+b.volume,0)/19;
  const base={symbol,source:last.source_ref,raw:capture,firstSeen:capture.received_at,available:capture.received_at,asOf:last.as_of,period:last.date,published:null};
  facts.push(sourceFact({...base,kind:'PRICE_VOLUME',summary:'原截止時間已保存的20日量價；原始發布時間未保存。',values:{close:last.close,mean20:average,low20:Math.min(...b20.map(b=>b.low)),volume_ratio20:volume>0?last.volume/volume:null,volume:last.volume,amount:last.amount},limitations:[]}));
  facts.push(sourceFact({...base,kind:'TECHNICAL_STRUCTURE',summary:'從當時量價計算的價格位置，不是已驗證支撐或買進訊號。',values:{mean20:average,low20:Math.min(...b20.map(b=>b.low))},limitations:['DERIVED_PRICE_LOCATION_NOT_CONFIRMED_STRUCTURE','CORPORATE_ACTION_CLEARANCE_MISSING']}));
 }
 for(const source of p.input.sources.filter(s=>s.status==='PASS'))for(const row of source.rows.filter(r=>r.symbol===symbol)){
  if(source.kind==='shares'){
   const values=[row.foreign?.net,row.trust?.net,row.dealer?.net];
   facts.push(sourceFact({symbol,kind:'INSTITUTIONAL',source:source.source,raw:row,firstSeen:source.received_at,available:row.available_at,
    period:row.session,summary:'三大法人當日買賣股數，非金額、非多週布局。',values:{net_shares:values.every(x=>safeNumber(x)!==null)?values.reduce((a,b)=>a+b,0):null,unit:row.unit},limitations:row.unit==='SHARES'?['SINGLE_SESSION_NOT_MULTI_WEEK_POSITIONING']:['INSTITUTIONAL_UNIT_INVALID']}));
  } else if(source.kind==='growth')facts.push(sourceFact({symbol,kind:'REVENUE',source:source.source,raw:row,firstSeen:source.received_at,available:row.available_at,
   period:row.period,summary:'官方月營收實績；出表日期不冒充精確發布時間。',values:{revenue_yoy:safeNumber(row.revenue_yoy),revenue_mom:safeNumber(row.revenue_mom),source_date:row.source_date??null},limitations:['SINGLE_MONTH_NOT_REVENUE_TREND']}));
 }
 for(const row of p.input.quarterly_actuals.filter(r=>r.symbol===symbol))facts.push(sourceFact({symbol,kind:'EPS',source:row.source,raw:row,
  firstSeen:null,available:row.available_at,period:row.period,summary:'已保存報表每股盈餘實績，不是市場共識；未補推單季或累計口徑。',values:{eps:safeNumber(row.eps_actual_as_reported)},limitations:['FIRST_SEEN_NOT_RETAINED','SINGLE_QUARTER_NOT_EARNINGS_TREND','EPS_PERIOD_BASIS_NOT_RETAINED']}));
 for(const e of p.input.events.filter(e=>e.symbol===symbol))facts.push(sourceFact({symbol,kind:'NEWS',source:e.source_ref,raw:e,
  firstSeen:null,available:e.available_at,published:e.published_at,asOf:e.published_at,
  summary:'有官方重大公告紀錄，但此最小留存不含標題及內文，不能判定利多或產業影響。',values:{event_type:e.event_type},limitations:['ANNOUNCEMENT_BODY_NOT_RETAINED','IMPACT_REVIEW_REQUIRED','FIRST_SEEN_NOT_RETAINED']}));
 return {facts,coverage};
}
export async function loadRetainedResearch(fixtureDir,displayNamesPath){
 const dir=privatePath(fixtureDir,true),names=displayNamesPath?read(displayNamesPath):null;
 if(names){assert.equal(names.schema,'VNEXT_DISPLAY_NAMES_ONLY');assert(names.rows.every(r=>/^\d{4}$/.test(r.symbol)&&typeof r.stock_name==='string'&&r.stock_name.length<50));}
 const reports=[];
 for(const date of Object.keys(APPROVED_PROJECTIONS)){
  const p=read(resolve(dir,date+'.json'));auditEntryProjection(p);assert.equal(await snapshotHash(p),APPROVED_PROJECTIONS[date],'RETAINED_CAPSULE_HASH_MISMATCH');
  const stocks=p.input.data.universe.filter(s=>s.is_active).map(s=>({symbol:s.symbol,company:names?.rows.find(n=>n.symbol===s.symbol)?.stock_name??s.symbol,
   sector:s.sector,...captureFacts(p,s.symbol)}));
  const events=p.input.events.map(e=>({id:e.source_hash,symbol:e.symbol,source:e.source_ref,published_at:e.published_at,available_at:e.available_at,evidence_hash:e.source_hash,title:null}));
  const report=await buildRealResearch({business_date:date,cutoff:p.input.identity.generated_at,source_lock_at:p.locked_at,input_hash:APPROVED_PROJECTIONS[date],stocks,events});
  assert(await verifyResearchLock(report));reports.push(report);
 }
 return reports;
}
export function auditOfficialCache(cacheDir){
 const dir=privatePath(cacheDir,true),files=readdirSync(dir),monthly=[],daily=[];
 for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f))){
  const c=read(resolve(dir,file));assert.equal(c.schema,'ENTRY_PUBLIC_CACHE_V1');assert.equal(c.digest,digest(c.data),'CACHE_HASH_MISMATCH');assert(sourceSafe(c.url));
  if(c.data.bars&&c.data.exchange==='TWSE')monthly.push(c.data);
  if(c.data.daily&&c.data.exact_volume_amount===true)daily.push(c.data);
 }
 const symbols=[...new Set([...monthly.map(r=>r.symbol),...daily.flatMap(r=>r.daily.map(d=>d.symbol))])].sort();
 const actions=read(resolve(dir,files.filter(f=>/^action-audit-\d+\.json$/.test(f)).sort().at(-1)));
 const at=new Date().toISOString(),rows=symbols.map(symbol=>{
  const bars=monthly.filter(r=>r.symbol===symbol).flatMap(r=>r.bars).concat(daily.flatMap(r=>r.daily.filter(d=>d.symbol===symbol&&d.bar).map(d=>d.bar)));
  const coverage=Object.fromEntries([20,60,120].map(n=>[n,auditHistory(bars,'2026-10-08',at,n)]));
  return {symbol,coverage,first_receipt:bars.map(b=>b.available_at).sort()[0],last_receipt:bars.map(b=>b.available_at).sort().at(-1)};
 });
 return {scope:'RETROSPECTIVE_CACHE_ONLY_NOT_ORIGINAL_CUTOFF',observed_at:at,universe:symbols.length,
  coverage:{...Object.fromEntries([20,60,120].map(n=>[n,rows.filter(r=>r.coverage[n].complete).length])),250:0},
  rows,action_events:actions.events.length,complete_action_clearance:actions.complete_action_clearance,
  adjusted_returns_permitted:false,supply_chain:'UNKNOWN',rights:'OWNER_PRIVATE_RESEARCH_ONLY_REDISTRIBUTION_NOT_CLEARED'};
}
export function persistResearchLock(report,directory){
 mkdirSync(directory,{recursive:true,mode:0o700});const dir=privatePath(directory,true);
 const path=resolve(dir,report.business_date+'-'+report.snapshot_hash+'.json'),data=JSON.stringify(report);
 try{writeFileSync(path,data,{mode:0o600,flag:'wx'});return {state:'CREATED',path};}
 catch(e){if(e.code!=='EEXIST')throw e;assert.equal(readFileSync(privatePath(path),'utf8'),data,'IMMUTABLE_LOCK_CONFLICT');return {state:'ALREADY_LOCKED',path};}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert(!process.env.CI,'REAL_EVIDENCE_NEVER_PUBLIC_CI');
 const reports=await loadRetainedResearch(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
 const cache=auditOfficialCache(process.env.MA_ENTRY_HISTORY_CACHE_DIR);
 for(const r of reports){const first=persistResearchLock(r,process.env.MA_VNEXT_LOCK_DIR),second=persistResearchLock(r,process.env.MA_VNEXT_LOCK_DIR);
  console.log(JSON.stringify({date:r.business_date,cutoff:r.cutoff,universe:r.universe,coverage:r.coverage,counts:r.counts,events:r.events.length,input_hash:r.input_hash,snapshot_hash:r.snapshot_hash,lock:first.state,idempotency:second.state,forward:0,outcome:0,production_writes:0}));}
 console.log(JSON.stringify({official_cache:cache.coverage,company_actions:cache.action_events,adjusted_returns_permitted:false,production_writes:0}));
}
