/** Explicit, local research CLI. Public exchange GET only. Never run in Production/CI. */
import {readFile,mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {historyUrl,parseOfficialHistory,companyDirectory,tpexDailyUrl,parseTpexDaily} from './entry-official-history.ts';
import {historySessions,auditHistory} from './entry-history.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function retryDelay(attempt,retryAfter,now=Date.now()){
 const seconds=Number(retryAfter),date=Date.parse(retryAfter??'');
 const provider=retryAfter===null?0:Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:0;
 return Math.min(60000,Math.max(1500*2**attempt,provider));
}
export async function runAcquisition({fixtureDir,cacheDir,businessDate,limit=72}){
 if(process.env.CI||!fixtureDir||!cacheDir||![1,2,72].includes(limit))throw Error('LOCAL_RESEARCH_SCOPE_REQUIRED');
 const fixture=await realpath(fixtureDir);await mkdir(cacheDir,{recursive:true,mode:0o700});const cache=await realpath(cacheDir);
 for(const dir of [fixture,cache]){const s=await lstat(dir);if(dir===root||dir.startsWith(root+'/')||s.isSymbolicLink()||(s.mode&0o077))throw Error('PRIVATE_DIRECTORY_REQUIRED');}
 const file=resolve(fixture,'2026-10-08.json'),s=await lstat(file);if(s.isSymbolicLink()||(s.mode&0o077))throw Error('PRIVATE_FIXTURE_REQUIRED');
 const p=JSON.parse(await readFile(file,'utf8'));
 if(p.schema!=='ENTRY_MINIMIZED_RETAINED_V1')throw Error('FIXTURE_SCHEMA_INVALID');
 const universe=p.input.data.universe.filter(r=>r.is_active===true).map(r=>({symbol:String(r.symbol),sector:r.sector}));
 if(universe.length!==72||new Set(universe.map(r=>r.symbol)).size!==72||universe.some(r=>!/^\d{4}$/.test(r.symbol)))throw Error('UNIVERSE_INVALID');
 const sessions=historySessions(businessDate,120),months=[...new Set(sessions.map(d=>d.slice(0,7)))];
 if(months.length>8)throw Error('REQUEST_BUDGET_EXCEEDED');
 let requests=0,cacheHits=0,retries=0,last=0;const failures=[];
 const allowed=new Set(['https://openapi.twse.com.tw/v1/opendata/t187ap03_L','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
  ...universe.flatMap(r=>months.flatMap(m=>['TWSE','TPEX'].map(e=>historyUrl(e,r.symbol,m)))),...sessions.map(tpexDailyUrl)]);
 async function get(url,normalize){
  if(!allowed.has(url))throw Error('URL_OUTSIDE_MANIFEST');
  const key=hash(url),path=resolve(cache,key+'.json');
  try{const stat=await lstat(path);if(stat.isSymbolicLink()||(stat.mode&0o077))throw Error('CACHE_PERMISSIONS');const c=JSON.parse(await readFile(path,'utf8'));
   if(c.url!==url||c.schema!=='ENTRY_PUBLIC_CACHE_V1'||c.digest!==hash(c.data))throw Error('CACHE_INTEGRITY');cacheHits++;return c.data;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  let failure='NOT_REQUESTED';
  for(let attempt=0;attempt<3;attempt++){
   await sleep(Math.max(0,1500-(Date.now()-last)));last=Date.now();requests++;
   try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(r.status===429||r.status>=500){failure='HTTP_'+r.status;if(attempt<2){retries++;await sleep(retryDelay(attempt,r.headers.get('retry-after')));continue;}break;}
    if(!r.ok){failure='HTTP_'+r.status;break;}
    const text=await r.text();if(text.length>8*1024*1024)throw Error('RESPONSE_TOO_LARGE');
    const receivedAt=new Date().toISOString(),data=normalize(JSON.parse(text),receivedAt);
    await writeFile(path,JSON.stringify({schema:'ENTRY_PUBLIC_CACHE_V1',url,digest:hash(data),data}),{mode:0o600,flag:'wx'});return data;
   }catch(e){failure=e.name==='TimeoutError'?'TIMEOUT':e instanceof SyntaxError?'INVALID_JSON':e.message;
    if(!['TIMEOUT','fetch failed'].includes(failure)||attempt===2)break;retries++;await sleep(retryDelay(attempt,null));}
  }
  throw Error(failure);
 }
 const directories=[];
 for(const [exchange,url]of [['TWSE','https://openapi.twse.com.tw/v1/opendata/t187ap03_L'],['TPEX','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O']]){
  directories.push(...await get(url,(r,at)=>companyDirectory(exchange,r,url,at)));
 }
 const results=[];
 const selected=limit===72?universe:[...universe.filter(r=>r.symbol==='2330'),...universe.filter(r=>r.symbol==='6488')].slice(0,limit);
 const tpexSymbols=selected.filter(u=>directories.find(d=>d.symbol===u.symbol)?.exchange==='TPEX').map(u=>u.symbol);
 const exactDaily=[];
 // One all-market request per date, minimized to selected symbols before caching.
 if(tpexSymbols.length)for(const date of sessions){
  try{const r=await get(tpexDailyUrl(date),(p,at)=>parseTpexDaily(p,date,tpexSymbols,at));
   // A narrower earlier cache is not silently accepted as complete.
   if(tpexSymbols.some(s=>!r.daily.some(d=>d.symbol===s)))throw Error('CACHE_SYMBOL_SCOPE_INCOMPLETE');exactDaily.push(...r.daily);
  }catch(e){failures.push({exchange:'TPEX',date,reason:e.message});}
  if((exactDaily.length/tpexSymbols.length)%20===0)console.log(JSON.stringify({exact_tpex_sessions:exactDaily.length/tpexSymbols.length,requests,cache_hits:cacheHits,failure_count:failures.length}));
 }
 for(const item of selected){
  const maps=directories.filter(d=>d.symbol===item.symbol);
  if(maps.length!==1){results.push({symbol:item.symbol,reason:'EXCHANGE_CLASSIFICATION_MISSING_OR_AMBIGUOUS'});continue;}
  const exchange=maps[0].exchange,bars=[],rejected=[];
  if(exchange==='TPEX'){for(const r of exactDaily.filter(d=>d.symbol===item.symbol)){if(r.bar)bars.push(r.bar);else rejected.push({reason:r.reason});}}
  else for(const month of months){try{const r=await get(historyUrl(exchange,item.symbol,month),(p,at)=>parseOfficialHistory(exchange,item.symbol,month,p,at));bars.push(...r.bars);rejected.push(...r.rejected);}
   catch(e){failures.push({symbol:item.symbol,month,reason:e.message});}}
  const cutoff=new Date().toISOString();
  const coverage=Object.fromEntries([20,60,120].map(n=>[n,auditHistory(bars,businessDate,cutoff,n)]));
  results.push({symbol:item.symbol,exchange,coverage,rejected});
  console.log(JSON.stringify({completed:results.length,total:selected.length,requests,cache_hits:cacheHits,retries,coverage:Object.fromEntries([20,60,120].map(n=>[n,results.filter(r=>r.coverage?.[n].complete).length])),failure_count:failures.length}));
 }
 const missingPeerSymbols=['1590','2049','4566','2208','2634','8033'];
 const peers=missingPeerSymbols.map(symbol=>{
  const own=directories.find(r=>r.symbol===symbol),candidates=own?directories.filter(d=>d.symbol!==symbol&&d.industry_code===own.industry_code):[];
  return {symbol,official_industry:own?.industry_code??null,official_exchange:own?.exchange??null,
   current_official_industry_peers:candidates.map(c=>({symbol:c.symbol,exchange:c.exchange,in_official_72:universe.some(u=>u.symbol===c.symbol)})),
   existing_theme_peers:universe.filter(u=>u.symbol!==symbol&&u.sector===universe.find(x=>x.symbol===symbol)?.sector).map(u=>u.symbol),
   expansion:'RESEARCH_PROPOSAL_ONLY_REQUIRES_SEMANTIC_AND_TRADEABILITY_REVIEW',official_universe_changed:false};
 });
 const report={schema:'ENTRY_HISTORY_ACQUISITION_AUDIT_V1',business_date:businessDate,observed_at:new Date().toISOString(),
  source_fixture_sha256:hash(p),original_input_sha256:p.original_input_sha256,universe_sha256:hash(universe),
  provenance:'RETROSPECTIVE_PUBLIC_ACQUISITION',as_of_20261007_or_08:false,forward_sample:0,outcome_sample:0,production_writes:0,
  coverage:Object.fromEntries([20,60,120].map(n=>[n,results.filter(r=>r.coverage?.[n].complete).length])),universe:selected.length,requests,cache_hits:cacheHits,retries,results,failures,peers};
 const output=resolve(cache,'audit-'+businessDate+'-'+Date.now()+'.json');await writeFile(output,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({audit:output,coverage:report.coverage,requests,cache_hits:cacheHits,retries,failures:failures.length,production_writes:0}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await runAcquisition({fixtureDir:process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,cacheDir:process.env.MA_ENTRY_HISTORY_CACHE_DIR,businessDate:process.env.MA_ENTRY_HISTORY_DATE??'2026-10-08',limit:Number(process.env.MA_ENTRY_HISTORY_LIMIT??72)});
}
