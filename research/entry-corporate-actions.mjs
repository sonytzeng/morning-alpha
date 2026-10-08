/** Research inventory, NOT an adjustment engine or complete action-clearance proof. */
import {readFile,writeFile,lstat,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {officialDate,officialNumber} from './entry-official-history.ts';
import {historySessions} from './entry-history.ts';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const ACTION_SOURCES=[
 {kind:'EX_RIGHT',exchange:'TWSE',base:'https://www.twse.com.tw/rwd/zh/exRight/TWT49U',fields:['資料日期','股票代號','股票名稱','除權息前收盤價','除權息參考價']},
 {kind:'CAPITAL_REDUCTION',exchange:'TWSE',base:'https://www.twse.com.tw/rwd/zh/reducation/TWTAUU',fields:['恢復買賣日期','股票代號','名稱','停止買賣前收盤價格','恢復買賣參考價']},
 {kind:'PAR_VALUE_CHANGE',exchange:'TWSE',base:'https://www.twse.com.tw/rwd/zh/change/TWTB8U',fields:['恢復買賣日期','股票代號','名稱','停止買賣前收盤價格','恢復買賣參考價']},
 {kind:'EX_RIGHT',exchange:'TPEX',base:'https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ',fields:['除權息日期','代號','名稱','除權息前收盤價','除權息參考價']},
 {kind:'CAPITAL_REDUCTION',exchange:'TPEX',base:'https://www.tpex.org.tw/www/zh-tw/bulletin/revivt',fields:['恢復買賣日期','股票代號','名稱','最後交易日之收盤價格','減資恢復買賣開始日參考價格']},
 {kind:'PAR_VALUE_CHANGE',exchange:'TPEX',base:'https://www.tpex.org.tw/www/zh-tw/bulletin/pvChgRslt',fields:['恢復買賣日期','證券代號','證券名稱','最後交易日之收盤價格','恢復買賣開始參考價']},
];
const eventDate=v=>officialDate(String(v).replace('年','/').replace('月','/').replace('日',''));
export function parseActionInventory(spec,p,symbols,source,at,from,through){
 if(!ACTION_SOURCES.includes(spec)||!Number.isFinite(Date.parse(at)))throw Error('ACTION_SOURCE_INVALID');
 if(String(p.stat).toLowerCase()!=='ok')throw Error('ACTION_PROVIDER_NOT_OK');
 const table=spec.exchange==='TWSE'?p:p.tables?.[0];
 if(!table||!Array.isArray(table.fields)||!Array.isArray(table.data)||spec.fields.some((f,i)=>table.fields[i]!==f))throw Error('ACTION_SCHEMA_CHANGED');
 return table.data.flatMap(r=>{
  if(!Array.isArray(r))throw Error('ACTION_ROW_INVALID');const symbol=String(r[1]).trim();if(!symbols.includes(symbol))return [];
  const date=eventDate(r[0]);if(!date||date<from||date>through)throw Error('ACTION_DATE_OUTSIDE_WINDOW');
  const cash=spec.kind==='EX_RIGHT'&&spec.exchange==='TPEX'&&table.fields[13]==='現金股利'?officialNumber(r[13]):null;
  const stockPer1000=spec.kind==='EX_RIGHT'&&spec.exchange==='TPEX'&&table.fields[14]==='每仟股無償配股'?officialNumber(r[14]):null;
  return [{symbol,kind:spec.kind,exchange:spec.exchange,effective_date:date,source_ref:source,available_at:at,
   before_reference:officialNumber(r[3]),after_reference:officialNumber(r[4]),cash_per_share:cash,
   bonus_shares_per_1000:stockPer1000,new_shares_per_old_share:null,
   adjustment_applied:false,adjustment_status:'ENTITLEMENT_AND_PRICE_POLICY_NOT_VERIFIED',
   detail_key:spec.exchange==='TWSE'&&spec.kind==='EX_RIGHT'&&new RegExp('^'+symbol+',\\d{8}$').test(String(r[11]))?String(r[11]):null}];
 });
}
export function parseTwseDividendDetail(p,symbol,source,at){
 if(String(p.stat).toLowerCase()!=='ok'||p.data?.length!==1||!p.fields?.[2]?.includes('每股配發現金股利')||!p.fields?.[4]?.includes('每千股無償配股')||String(p.data[0][0]).trim()!==symbol)throw Error('DIVIDEND_DETAIL_MISMATCH');
 const amount=(v,unit)=>{const s=String(v).trim();if(!s.endsWith(unit))return null;return officialNumber(s.slice(0,-unit.length));};
 return {source_ref:source,available_at:at,cash_per_share:amount(p.data[0][2],'元／股'),bonus_shares_per_1000:amount(p.data[0][4],'股'),
  cash_subscription_shares:amount(p.data[0][6],'股'),subscription_price:amount(p.data[0][7],'元／股'),
  adjustment_applied:false,coverage:'DETAIL_ONLY_NOT_COMPLETE_ACTION_CLEARANCE'};
}
export async function acquireActionInventory(cacheDir,fixtureDir,businessDate='2026-10-08'){
 if(process.env.CI)throw Error('LOCAL_ONLY');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),cache=await realpath(cacheDir),fixture=await realpath(fixtureDir);
 for(const dir of [cache,fixture])if(dir===root||dir.startsWith(root+'/')||((await lstat(dir)).mode&0o077))throw Error('PRIVATE_DIRECTORY_REQUIRED');
 const path=resolve(fixture,'2026-10-08.json'),st=await lstat(path);if(st.isSymbolicLink()||(st.mode&0o077))throw Error('PRIVATE_FIXTURE_REQUIRED');
 const p=JSON.parse(await readFile(path,'utf8')),symbols=p.input.data.universe.filter(r=>r.is_active).map(r=>r.symbol);
 if(symbols.length!==72||new Set(symbols).size!==72||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('UNIVERSE_INVALID');
 const dates=historySessions(businessDate,120),from=dates[0],through=dates.at(-1);let requests=0,hits=0;
 async function get(url,normalize){
  const file=resolve(cache,'actions-'+digest(url)+'.json');
  try{const stat=await lstat(file);if(stat.isSymbolicLink()||(stat.mode&0o077))throw Error('CACHE_PERMISSIONS');
   const c=JSON.parse(await readFile(file,'utf8'));if(c.url!==url||c.digest!==digest(c.data))throw Error('CACHE_INTEGRITY');hits++;return c.data;
  }catch(e){if(e.code!=='ENOENT')throw e;}
  let reason='UNAVAILABLE';
  for(let attempt=0;attempt<3;attempt++){
   await sleep(2000*(attempt+1));requests++;
   try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if(!r.ok){reason='HTTP_'+r.status;if(r.status===429||r.status>=500)continue;break;}
    const text=await r.text();if(text.length>8*1024*1024)throw Error('RESPONSE_TOO_LARGE');const at=new Date().toISOString(),data=normalize(JSON.parse(text),at);
    await writeFile(file,JSON.stringify({url,data,digest:digest(data)}),{flag:'wx',mode:0o600});return data;
   }catch(e){reason=e.name==='TimeoutError'?'TIMEOUT':e.message;if(!['TIMEOUT','fetch failed'].includes(reason))break;}
  }throw Error(reason);
 }
 const sources=[],events=[],failures=[];
 for(const spec of ACTION_SOURCES){const u=new URL(spec.base),format=d=>spec.exchange==='TPEX'?d.replaceAll('-','/'):d.replaceAll('-','');
  u.searchParams.set('startDate',format(from));u.searchParams.set('endDate',format(through));u.searchParams.set('response','json');
  try{const data=await get(u.href,(p,at)=>({source_ref:u.href,available_at:at,events:parseActionInventory(spec,p,symbols,u.href,at,from,through)}));events.push(...data.events);sources.push({kind:spec.kind,exchange:spec.exchange,source_ref:u.href,available_at:data.available_at,count:data.events.length});}
  catch(e){failures.push({kind:spec.kind,exchange:spec.exchange,reason:e.message});}}
 for(const event of events.filter(e=>e.detail_key)){
  const [symbol,date]=event.detail_key.split(','),u=new URL('https://www.twse.com.tw/rwd/zh/exRight/TWT49UDetail');u.searchParams.set('STK_NO',symbol);u.searchParams.set('T1',date);u.searchParams.set('response','json');
  try{event.detail=await get(u.href,(p,at)=>parseTwseDividendDetail(p,symbol,u.href,at));}
  catch(e){failures.push({symbol,effective_date:event.effective_date,reason:e.message});}
 }
 const report={schema:'ENTRY_ACTION_INVENTORY_V1',from,through,observed_at:new Date().toISOString(),sources,events,failures,
  provenance:'RETROSPECTIVE_PUBLIC_ACQUISITION',availability:'ACTUAL_RECEIPT_NOT_BACKDATED',requests,cache_hits:hits,
  missing:['COMPLETE_RIGHTS_DEMERGER_AND_OTHER_ACTION_COVERAGE','ENTITLEMENT_LEDGER_AND_LOCKED_PRICE_ADJUSTMENT_POLICY'],
  complete_action_clearance:false,adjusted_return_eligible:false,production_writes:0};
 const output=resolve(cache,'action-audit-'+Date.now()+'.json');await writeFile(output,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({audit:output,source_counts:sources.map(s=>({exchange:s.exchange,kind:s.kind,count:s.count})),events:events.length,failures,missing:report.missing,adjusted_return_eligible:false}));return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await acquireActionInventory(process.env.MA_ENTRY_HISTORY_CACHE_DIR,process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR);
