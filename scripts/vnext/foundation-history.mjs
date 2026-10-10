/** Explicit private research acquisition. No Production client, credentials or scheduler. */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {previousMarketTradingDate,MARKET_CALENDAR_VERSION} from '../../supabase/functions/_shared/market-session-contract.mjs';
import {historyUrl,tpexDailyUrl,parseOfficialHistory,parseTpexDaily} from '../../research/entry-official-history.ts';
import {auditEntryProjection} from '../../tests/helpers/entryRetainedProjection.mjs';
import {APPROVED_PROJECTIONS} from '../../tests/entryOpportunityRealReplay.integration.mjs';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const root=fileURLToPath(new URL('../../',import.meta.url));
export function privateDirectory(path){mkdirSync(path,{recursive:true,mode:0o700});const real=realpathSync(path),s=lstatSync(path);if(s.isSymbolicLink()||!s.isDirectory()||(s.mode&0o077)||real===root.slice(0,-1)||real.startsWith(root))throw Error('PRIVATE_OUTSIDE_REPO_REQUIRED');return real;}
export function readPrivate(path){const s=lstatSync(path);if(s.isSymbolicLink()||!s.isFile()||(s.mode&0o077)||s.size>16_000_000)throw Error('PRIVATE_FILE_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
export function immutable(path,value){try{writeFileSync(path,JSON.stringify(value),{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(readPrivate(path))!==sha(value))throw e;}}
export function foundationSessions(before,count=250){if(!/^202[56]-\d{2}-\d{2}$/.test(before)||new Date(before+'T00:00:00Z').toISOString().slice(0,10)!==before)throw Error('DATE_INVALID');if(![20,60,120,250].includes(count))throw Error('COUNT_INVALID');let d=before;const dates=[];for(let i=0;i<count;i++){d=previousMarketTradingDate('TW',d);if(!d)throw Error('CALENDAR_COVERAGE_MISSING');dates.unshift(d);}return dates;}
export async function approvedUniverse(directory){const p=readPrivate(resolve(privateDirectory(directory),'2026-10-08.json'));auditEntryProjection(p);if(await snapshotHash(p)!==APPROVED_PROJECTIONS['2026-10-08'])throw Error('RETAINED_CAPSULE_HASH_MISMATCH');const symbols=p.input.data.universe.filter(s=>s.is_active).map(s=>s.symbol).sort();if(symbols.length!==72||new Set(symbols).size!==72||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('UNIVERSE_INVALID');return symbols;}
export function auditBars(bars,dates,cutoff){const at=Date.parse(cutoff);if(!Number.isFinite(at))throw Error('CUTOFF_INVALID');const gaps=[];for(const date of dates){const rows=bars.filter(b=>b.date===date);if(rows.length!==1){gaps.push({date,reason:rows.length?'DUPLICATE_SESSION':'SESSION_MISSING'});continue;}const b=rows[0];if(![b.open,b.high,b.low,b.close,b.volume,b.amount].every(n=>Number.isFinite(n)&&n>0)||!Number.isSafeInteger(b.volume)||!Number.isSafeInteger(b.amount)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)){gaps.push({date,reason:'OHLCV_AMOUNT_INVALID'});continue;}const seen=Date.parse(b.available_at);if(!Number.isFinite(seen)||seen>at||seen<Date.parse(date+'T13:30:00+08:00'))gaps.push({date,reason:'NOT_AVAILABLE_AT_CUTOFF'});}return {requested:dates.length,valid:dates.length-gaps.length,complete:gaps.length===0,gaps};}
export function createPublicCache(directory,{minimumInterval=1600,maxRequests=1800,fetcher=fetch}={}){
 const dir=privateDirectory(directory),stats={requests:0,hits:0,retries:0};let last=0;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function get(url,scope,normalize,format='json'){
  if(!['json','text'].includes(format))throw Error('FORMAT_INVALID');
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!['www.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw','pr.tsmc.com'].includes(u.hostname))throw Error('SOURCE_NOT_ALLOWED');
  const path=resolve(dir,sha({url,scope})+'.json');try{const c=readPrivate(path);if(c.url!==url||c.scope!==scope||c.digest!==sha(c.data))throw Error('CACHE_HASH_MISMATCH');stats.hits++;return c;}catch(e){if(e.code!=='ENOENT')throw e;}
  for(let attempt=0;attempt<3;attempt++){
   if(stats.requests>=maxRequests)throw Error('REQUEST_BUDGET_EXHAUSTED');await pause(Math.max(0,minimumInterval-(Date.now()-last)));last=Date.now();stats.requests++;
   try{const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(r.status===429||r.status>=500){await r.body?.cancel();if(attempt===2)throw Error('HTTP_'+r.status);stats.retries++;const retry=r.headers.get('retry-after'),seconds=Number(retry),delay=retry===null?0:Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now();if(delay>60000)throw Error('RETRY_AFTER_OUTSIDE_BUDGET');await pause(Math.max(2000*2**attempt,Number.isFinite(delay)?delay:0));continue;}
    if(!r.ok){await r.body?.cancel();throw Error('HTTP_'+r.status);}const reader=r.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8_000_000){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}parts.push(value);}}finally{reader.releaseLock();}
    const raw=Buffer.concat(parts),at=new Date().toISOString(),data=normalize(format==='text'?raw.toString('utf8'):JSON.parse(raw.toString('utf8')),at),c={schema:'VNEXT_PUBLIC_CACHE_V1',url,scope,first_seen_at:at,available_at:at,raw_response_hash:createHash('sha256').update(raw).digest('hex'),source_version:'OFFICIAL_AS_RETRIEVED_V1',data,digest:sha(data)};immutable(path,c);return c;
   }catch(e){if(!['TimeoutError','AbortError'].includes(e.name)&&e.message!=='fetch failed'||attempt===2)throw e;stats.retries++;await pause(2000*2**attempt);}
  }throw Error('RETRY_EXHAUSTED');
 }
 return {get,stats};
}
export async function acquire250({legacyDir,cacheDir,before='2026-10-12'}){
 if(process.env.CI)throw Error('PRIVATE_RESEARCH_NOT_CI');const legacy=privateDirectory(legacyDir),cache=privateDirectory(cacheDir),dates=foundationSessions(before),through=dates.at(-1),months=[...new Set(dates.map(d=>d.slice(0,7)))];
 const old=new Map();for(const name of readdirSync(legacy).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){const c=readPrivate(resolve(legacy,name));if(c.schema!=='ENTRY_PUBLIC_CACHE_V1'||c.digest!==sha(c.data))throw Error('LEGACY_CACHE_HASH');old.set(c.url,c);}
 const directory=[...old.values()].flatMap(c=>Array.isArray(c.data)?c.data:[]).filter(r=>r.classification_scope);
 const universe=await approvedUniverse(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR);
 const classified=universe.map(symbol=>{const rows=directory.filter(d=>d.symbol===symbol);if(rows.length!==1)throw Error('EXCHANGE_AMBIGUOUS');return {symbol,exchange:rows[0].exchange};});
 const client=createPublicCache(cache),tpex=classified.filter(s=>s.exchange==='TPEX').map(s=>s.symbol),stocks=new Map(universe.map(s=>[s,[]])),warmup=new Map(universe.map(s=>[s,[]])),warmupDate=previousMarketTradingDate('TW',dates[0]),failures=[];let reused=0;
 async function get(url,normalize,reusable){const prior=old.get(url);if(prior&&reusable){reused++;return {data:prior.data,digest:prior.digest,raw_response_hash:null,source_version:'ENTRY_PUBLIC_CACHE_V1',first_seen_at:prior.data.received_at};}return client.get(url,through,normalize);}
 const retain=(symbol,b,c)=>(b.date===warmupDate?warmup:stocks).get(symbol).push({...b,first_seen_at:b.available_at,published_at:null,as_of:b.date+'T13:30:00+08:00',session:'TW_COMPLETED_DAILY',session_scope:c.data.volume_amount_scope,source_version:c.source_version,evidence_hash:sha(b),source_response_hash:c.raw_response_hash,source_record_hash:c.digest,price_basis:'RAW_UNADJUSTED',first_seen_scope:'LOCAL_COLLECTION_NOT_MARKET_FIRST_PUBLICATION'});
 for(const date of dates){try{const c=await get(tpexDailyUrl(date),(p,at)=>parseTpexDaily(p,date,tpex,at),true);for(const symbol of tpex){const r=c.data.daily.find(d=>d.symbol===symbol);if(r?.bar)retain(symbol,r.bar,c);else failures.push({symbol,date,reason:r?.reason??'SYMBOL_MISSING'});}}catch(e){failures.push({date,exchange:'TPEX',reason:e.message});}if(dates.indexOf(date)%25===0)console.log(JSON.stringify({stage:'TPEX',completed:dates.indexOf(date)+1,reused,...client.stats,failures:failures.length}));}
 for(const item of classified.filter(s=>s.exchange==='TWSE')){for(const month of months){try{const c=await get(historyUrl('TWSE',item.symbol,month),(p,at)=>parseOfficialHistory('TWSE',item.symbol,month,p,at),month<through.slice(0,7));for(const b of c.data.bars.filter(b=>dates.includes(b.date)||b.date===warmupDate))retain(item.symbol,b,c);for(const r of c.data.rejected.filter(r=>dates.includes(r.date)))failures.push({symbol:item.symbol,...r});}catch(e){failures.push({symbol:item.symbol,month,reason:e.message});}}console.log(JSON.stringify({stage:'TWSE',symbol:item.symbol,reused,...client.stats,failures:failures.length}));}
 const at=new Date().toISOString(),rows=classified.map(s=>{const bars=stocks.get(s.symbol).sort((a,b)=>a.date.localeCompare(b.date));return {...s,bars,warmup:bars.length<250?warmup.get(s.symbol):[],traded250_dates:[...warmup.get(s.symbol),...bars].sort((a,b)=>a.date.localeCompare(b.date)).slice(-250).map(b=>b.date),coverage:Object.fromEntries([20,60,120,250].map(n=>[n,auditBars(bars,dates.slice(-n),at)]))};});
 const result={schema:'VNEXT_FOUNDATION_HISTORY_V1',observed_at:at,before,from:dates[0],through,calendar_version:MARKET_CALENDAR_VERSION,universe_hash:sha(classified),universe:72,classification:'CURRENT_72_NOT_HISTORICAL_UNIVERSE',mode:'RETROSPECTIVE_ACQUISITION_NOT_FORWARD',rows,coverage:Object.fromEntries([20,60,120,250].map(n=>[n,rows.filter(r=>r.coverage[n].complete).length])),failures,stats:{reused,...client.stats},forward_sample:0,outcome_sample:0,production_writes:0};
 const path=resolve(cache,'history-'+sha(result)+'.json');immutable(path,result);console.log(JSON.stringify({output:path,coverage:result.coverage,failures:result.failures,stats:result.stats}));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await acquire250({legacyDir:process.env.MA_ENTRY_HISTORY_CACHE_DIR,cacheDir:process.env.MA_VNEXT_FOUNDATION_DIR});
