/** Company-specific official event index and same-session benchmark; no bullish inference. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicCache,privateDirectory,immutable,sha,foundationSessions} from './foundation-history.mjs';
import {auditFoundation} from './foundation-validation.mjs';
import {officialDate,officialNumber} from '../../research/entry-official-history.ts';
import {publicationTime} from './foundation-sources.mjs';
export function parseEventIndex(p,{symbol,year,month,from,through,url},at){
 if(p.code===406&&p.message==='查無相符資料')return {rows:[],status:'NO_MATCH_IN_REQUESTED_PERIOD',checked_symbol:symbol,from,through};
 if(p.code!==200||p.result?.companyId!==symbol||JSON.stringify(p.result.titles?.map(t=>t.main))!==JSON.stringify(['公司代號','公司名稱','發言日期','發言時間','主旨','詳細資料'])||!Array.isArray(p.result.data))throw Error('EVENT_INDEX_SCHEMA');
 const rows=p.result.data.map(r=>{const published=publicationTime(r[2],r[3]),title=String(r[4]??'');
  if(r[0]!==symbol||!published||published.slice(0,7)!==`${year}-${String(month).padStart(2,'0')}`||published.slice(0,10)<from||published.slice(0,10)>through||Date.parse(published)>Date.parse(at))throw Error('EVENT_INDEX_TIME_OR_SYMBOL');
  const type=/注意交易|注意股票|處置/.test(title)?'TRADING_ATTENTION':/營收/.test(title)?'REVENUE':/財務報告|財報/.test(title)?'FINANCIAL_REPORT':/法說|法人說明/.test(title)?'EARNINGS_CALL':/股利|除權|除息/.test(title)?'CORPORATE_ACTION':'OTHER_MATERIAL_EVENT';
  // Only event classification, date and hash leave source memory. No contact names/body.
  return {symbol,kind:'EVENT',period:published.slice(0,10),published_at:published,first_seen_at:at,available_at:at,as_of:published,source:url,evidence_hash:sha(r),id:'EVENT-'+sha(r),event_type:type,impact:'UNKNOWN',detail_review:'NOT_REVIEWED',source_version:'MOPS_EVENT_INDEX_V1',data_quality_status:'INDEX_VERIFIED_CONTENT_UNREVIEWED'};});
 return {rows,status:'INDEX_VERIFIED_CONTENT_UNREVIEWED',checked_symbol:symbol,from,through};
}
export function parseIndex(p,month,at,url){
 if(p.stat!=='OK'||String(p.date).slice(0,6)!==month.replace('-','')||JSON.stringify(p.fields)!==JSON.stringify(['日期','開盤指數','最高指數','最低指數','收盤指數'])||!Array.isArray(p.data))throw Error('BENCHMARK_SCHEMA');
 return p.data.map(r=>{const date=officialDate(r[0]),[open,high,low,close]=r.slice(1).map(officialNumber);if(!date?.startsWith(month)||![open,high,low,close].every(n=>n>0)||high<Math.max(open,close)||low>Math.min(open,close)||Date.parse(date+'T13:30:00+08:00')>Date.parse(at))throw Error('BENCHMARK_INVALID');return {date,open,high,low,close,source:url,published_at:null,first_seen_at:at,available_at:at,as_of:date+'T13:30:00+08:00',evidence_hash:sha(r)};});
}
export async function acquireContext({foundationDir,cacheDir}){
 const {history}=auditFoundation(foundationDir),dir=privateDirectory(cacheDir),client=createPublicCache(dir,{minimumInterval:2500,maxRequests:180}),events=[],checks=[],benchmarks=[],failures=[],sources=[];
 for(const symbol of history.rows.map(r=>r.symbol))for(const month of [9,10]){const from=`2026-${String(month).padStart(2,'0')}-01`,through=month===9?'2026-09-30':history.through,form={companyId:symbol,year:'115',month:String(month),firstDay:'1',lastDay:String(Number(through.slice(8)))},url='https://mops.twse.com.tw/mops/api/t05st01';
  try{const c=await client.get(url,'real-stock-context-20261011',(p,at)=>parseEventIndex(p,{symbol,year:2026,month,from,through,url:url+'?'+new URLSearchParams(form)},at),'json',form,'json');events.push(...c.data.rows);checks.push({symbol,from,through,status:c.data.status,events:c.data.rows.length});sources.push({url,form,raw_response_hash:c.raw_response_hash,normalized_hash:c.digest,first_seen_at:c.first_seen_at});}catch(e){failures.push({symbol,month,reason:e.message});}if(month===10)console.log(JSON.stringify({symbol,events:events.length,checks:checks.length,failures:failures.length,...client.stats}));
 }
 for(const month of [...new Set(foundationSessions(history.before,20).map(d=>d.slice(0,7)))]){const url=`https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?date=${month.replace('-','')}01&response=json`;try{const c=await client.get(url,'real-stock-context-20261011',(p,at)=>({rows:parseIndex(p,month,at,url)}));benchmarks.push(...c.data.rows);sources.push({url,raw_response_hash:c.raw_response_hash,normalized_hash:c.digest,first_seen_at:c.first_seen_at});}catch(e){failures.push({month,reason:e.message});}}
 const result={schema:'VNEXT_STOCK_CONTEXT_V1',collected_at:new Date().toISOString(),through:history.through,history_hash:sha(history),events,checks,benchmarks,failures,sources,stats:client.stats};const path=resolve(dir,'stock-context-'+sha(result)+'.json');immutable(path,result);console.log(JSON.stringify({output:path,events:events.length,checks:checks.length,failures,stats:client.stats}));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await acquireContext({foundationDir:process.env.MA_VNEXT_FOUNDATION_DIR,cacheDir:process.env.MA_VNEXT_STOCK_DIR});
