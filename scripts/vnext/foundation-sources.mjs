/** Public-source research candidate. Immutable private cache; no Production client. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {ACTION_SOURCES,parseActionInventory,parseTwseDividendDetail} from '../../research/entry-corporate-actions.mjs';
import {officialDate,officialNumber} from '../../research/entry-official-history.ts';
import {approvedUniverse,createPublicCache,foundationSessions,immutable,privateDirectory,readPrivate,sha} from './foundation-history.mjs';
export const OFFICIAL_SOURCES=Object.freeze([
 {exchange:'TWSE',kind:'EVENT',url:'https://openapi.twse.com.tw/v1/opendata/t187ap04_L'},
 {exchange:'TPEX',kind:'EVENT',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O'},
 {exchange:'TWSE',kind:'REVENUE',url:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'},
 {exchange:'TPEX',kind:'REVENUE',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O'},
 {exchange:'TWSE',kind:'EPS',url:'https://openapi.twse.com.tw/v1/opendata/t187ap14_L'},
 {exchange:'TPEX',kind:'EPS',url:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O'},
]);
export function publicationTime(date,time){
 const d=officialDate(String(date??'')),s=String(time??'').trim().replaceAll(':','');
 if(!d||!/^\d{5,6}$/.test(s))return null;
 const p=s.padStart(6,'0'),h=Number(p.slice(0,2)),m=Number(p.slice(2,4)),sec=Number(p.slice(4));
 if(h>23||m>59||sec>59)return null;return `${d}T${p.slice(0,2)}:${p.slice(2,4)}:${p.slice(4)}+08:00`;
}
const eventType=title=>/法說|法人說明|說明會/.test(title)?'EARNINGS_CALL':/營收/.test(title)?'REVENUE_ANNOUNCEMENT':/財務報告|財報|財務報表/.test(title)?'FINANCIAL_REPORT':/股利|除權|除息/.test(title)?'DIVIDEND_ANNOUNCEMENT':'MATERIAL_ANNOUNCEMENT';
export function parseOfficialFacts(spec,p,symbols,at){
 if(!OFFICIAL_SOURCES.includes(spec)||!Array.isArray(p)||!Number.isFinite(Date.parse(at)))throw Error('SOURCE_SCHEMA_INVALID');
 const rows=[],rejected=[],seen=new Set();for(const raw of p){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('SOURCE_ROW_INVALID');
  const r=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k.trim(),v]));
  const symbol=String(r['公司代號']??r.SecuritiesCompanyCode??'').trim();
  if(!/^\d{4,6}$/.test(symbol))throw Error('SYMBOL_FIELD_MISSING');if(!symbols.includes(symbol))continue;
  const recordHash=sha(raw);if(seen.has(recordHash))continue;seen.add(recordHash);
  const sourceDate=officialDate(String(r['出表日期']??r.Date??''));
  const base={symbol,kind:spec.kind,exchange:spec.exchange,source:spec.url,published_at:null,first_seen_at:at,available_at:at,as_of:null,source_date:sourceDate,evidence_hash:sha(raw),source_version:'OFFICIAL_AS_RETRIEVED_V1',impact:'UNKNOWN',historical_coverage:'LATEST_SNAPSHOT_ONLY'};
  if(spec.kind==='EVENT'){
   const published=publicationTime(r['發言日期'],r['發言時間']),title=String(r['主旨']??'').trim();
   if(!published||Date.parse(published)>Date.parse(at)||!title){rejected.push({symbol,reason:published?'EVENT_FUTURE_OR_TITLE_MISSING':'PUBLICATION_TIME_UNVERIFIABLE'});continue;}
   // Do not retain personal contacts, officer names, or the full free-text payload.
   rows.push({...base,published_at:published,as_of:published,event_type:eventType(title),subject_hash:sha(title),content_status:'SOURCE_HASH_RETAINED_BODY_REVIEW_REQUIRED',source_record_locator:{symbol,published_at:published}});
  }else{
   const period=spec.kind==='REVENUE'?String(r['資料年月']??''):`${r['年度']??r.Year??''}-Q${r['季別']??''}`;
   const values=spec.kind==='REVENUE'?{revenue_yoy:officialNumber(r['營業收入-去年同月增減(%)']),revenue_mom:officialNumber(r['營業收入-上月比較增減(%)'])}:{eps_as_reported:officialNumber(r['基本每股盈餘(元)']??r['基本每股盈餘'])};
   const taipeiDate=new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
   if(!sourceDate||sourceDate>taipeiDate||!period||Object.values(values).some(v=>v===null)){rejected.push({symbol,reason:'ACTUAL_PERIOD_OR_VALUE_UNVERIFIABLE'});continue;}
   rows.push({...base,period,values,publication_precision:'DATE_ONLY_NOT_EXACT_TIMESTAMP',period_basis:spec.kind==='EPS'?'AS_REPORTED_CUMULATIVE_BASIS_NOT_INFERRED':'MONTHLY',consensus:false});
  }
 }
 return {rows,rejected,source_rows:p.length,matched:rows.length,scope:'CURRENT_72_PRIVATE_RESEARCH',first_seen_at:at};
}
export function parseVerifiedSupplier(html,at){
 const plain=html.replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
 if(!plain.includes('2025/11/28')||!plain.includes('TSMC 2025 Supply Chain Management Forum')||!plain.includes('JENTECH PRECISION INDUSTRIAL CO., LTD')||!plain.includes('Excellent Production Support'))throw Error('RELATION_SOURCE_CHANGED');
 // Identity independently verified against TWSE company directory (3653 English name).
 return {supplier:'3653',customer:'2330',type:'SUPPLIER',source:'https://pr.tsmc.com/english/news/3274',source_date:'2025-11-28',published_at:null,publication_precision:'DATE_ONLY',first_seen_at:at,available_at:at,as_of:'2025-11-25',evidence_hash:sha('TSMC_2025_SUPPLIER_AWARD:JENTECH PRECISION INDUSTRIAL CO., LTD'),scope:'NAMED_2025_SUPPLIER_NOT_CURRENT_ORDER_OR_REVENUE_PROOF',inferred:false,impact:'UNKNOWN',commercial_redistribution:'NOT_CLEARED'};
}
export async function acquireSources({cacheDir,legacyDir,fixtureDir,before='2026-10-12',reviewedRelationPath}){
 if(process.env.CI)throw Error('PRIVATE_RESEARCH_NOT_CI');
 const cache=privateDirectory(cacheDir),legacy=privateDirectory(legacyDir),symbols=await approvedUniverse(fixtureDir),dates=foundationSessions(before),from=dates[0],through=dates.at(-1),scope=new Date(Date.now()+8*3600000).toISOString().slice(0,10)+'-foundation-v1';
 const client=createPublicCache(cache,{minimumInterval:2200,maxRequests:400}),actions=[],facts=[],sources=[],failures=[];let reused=0;
 const auditSource=(c,kind)=>sources.push({kind,url:c.url,first_seen_at:c.first_seen_at,raw_response_hash:c.raw_response_hash,normalized_hash:c.digest,...(Number.isInteger(c.data.source_rows)?{source_rows:c.data.source_rows,matched:c.data.matched}:{})});
 for(const spec of ACTION_SOURCES){const u=new URL(spec.base),fmt=d=>spec.exchange==='TPEX'?d.replaceAll('-','/'):d.replaceAll('-','');u.searchParams.set('startDate',fmt(from));u.searchParams.set('endDate',fmt(through));u.searchParams.set('response','json');
  try{const c=await client.get(u.href,through,(p,at)=>parseActionInventory(spec,p,symbols,u.href,at,from,through));auditSource(c,spec.kind);actions.push(...c.data.map(r=>({...r,published_at:null,first_seen_at:r.available_at,as_of:r.effective_date,source_version:c.source_version,evidence_hash:sha(r),source_response_hash:c.raw_response_hash})));}catch(e){failures.push({source:u.href,reason:e.message});}}
 for(const action of actions.filter(a=>a.detail_key)){const [symbol,date]=action.detail_key.split(','),u=new URL('https://www.twse.com.tw/rwd/zh/exRight/TWT49UDetail');u.searchParams.set('STK_NO',symbol);u.searchParams.set('T1',date);u.searchParams.set('response','json');
  try{const oldPath=resolve(legacy,'actions-'+sha(u.href)+'.json');if(existsSync(oldPath)){const c=readPrivate(oldPath);if(c.url!==u.href||c.digest!==sha(c.data))throw Error('LEGACY_ACTION_HASH');action.detail=c.data;reused++;}else{const c=await client.get(u.href,through,(p,at)=>parseTwseDividendDetail(p,symbol,u.href,at));action.detail=c.data;auditSource(c,'DIVIDEND_DETAIL');}}catch(e){failures.push({symbol,source:u.href,reason:e.message});}}
 for(const spec of OFFICIAL_SOURCES){try{const c=await client.get(spec.url,scope,(p,at)=>parseOfficialFacts(spec,p,symbols,at));facts.push(...c.data.rows);auditSource(c,spec.kind);failures.push(...c.data.rejected.map(r=>({...r,source:spec.url})));}catch(e){failures.push({source:spec.url,reason:e.message});}}
 const relations=[];try{
  const identity=await client.get('https://openapi.twse.com.tw/v1/opendata/t187ap03_L',scope,p=>{if(!Array.isArray(p))throw Error('DIRECTORY_SCHEMA');const r=p.find(r=>String(r['公司代號'])==='3653');if(!r||!JSON.stringify(r).toUpperCase().includes('JENTECH'))throw Error('RELATION_IDENTITY_UNVERIFIED');return {symbol:'3653',english_name:'JENTECH',verified:true};});auditSource(identity,'COMPANY_IDENTITY');
  if(reviewedRelationPath){
   // A separately reviewed public-source excerpt, not a fabricated raw HTTP response.
   const r=readPrivate(reviewedRelationPath);
   if(r.schema!=='VNEXT_REVIEWED_PRIMARY_EXCERPT_V1'||r.source!=='https://pr.tsmc.com/english/news/3274'||r.supplier!=='3653'||r.customer!=='2330'||r.type!=='SUPPLIER'||r.source_date!=='2025-11-28'||r.retrieval!=='PUBLIC_WEB_READER'||r.evidence_hash!==sha(r.assertion)||!Number.isFinite(Date.parse(r.first_seen_at))||Date.parse(r.first_seen_at)>Date.now()||r.first_seen_at<'2025-11-28')throw Error('REVIEWED_RELATION_INVALID');
   relations.push({supplier:r.supplier,customer:r.customer,type:r.type,source:r.source,source_date:r.source_date,published_at:null,publication_precision:'DATE_ONLY',first_seen_at:r.first_seen_at,available_at:r.first_seen_at,as_of:'2025-11-25',evidence_hash:r.evidence_hash,source_response_hash:null,retrieval:r.retrieval,identity_evidence_hash:identity.digest,scope:'NAMED_2025_SUPPLIER_NOT_CURRENT_ORDER_OR_REVENUE_PROOF',inferred:false,impact:'UNKNOWN',commercial_redistribution:'NOT_CLEARED'});
  }else{const c=await client.get('https://pr.tsmc.com/english/news/3274',scope,parseVerifiedSupplier,'text');relations.push({...c.data,source_response_hash:c.raw_response_hash,identity_evidence_hash:identity.digest});auditSource(c,'RELATION');}
 }catch(e){failures.push({kind:'RELATION',reason:e.message});}
 const result={schema:'VNEXT_FOUNDATION_SOURCES_V1',observed_at:new Date().toISOString(),from,through,universe:72,actions,facts,relations,sources,failures,stats:{...client.stats,reused},complete_action_clearance:false,adjusted_return_eligible:false,
  gaps:['DEMERGER_AND_OTHER_ACTION_COMPLETENESS','VERIFIED_SHARE_ENTITLEMENT_LEDGER','HISTORICAL_EVENT_BODY_AND_INDUSTRY_IMPACT','MULTI_PERIOD_FINANCIAL_TRENDS','ORDER_DEMAND_MARGIN_VALUATION_CHAIN'],forward_sample:0,outcome_sample:0,production_writes:0};
 const path=resolve(cache,'sources-'+sha(result)+'.json');immutable(path,result);console.log(JSON.stringify({output:path,actions:actions.length,facts:Object.fromEntries(OFFICIAL_SOURCES.map(s=>[s.exchange+'_'+s.kind,facts.filter(f=>f.exchange===s.exchange&&f.kind===s.kind).length])),relations:relations.length,failures,stats:result.stats}));return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await acquireSources({cacheDir:process.env.MA_VNEXT_FOUNDATION_DIR,legacyDir:process.env.MA_ENTRY_HISTORY_CACHE_DIR,fixtureDir:process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,reviewedRelationPath:process.env.MA_VNEXT_REVIEWED_RELATION});
