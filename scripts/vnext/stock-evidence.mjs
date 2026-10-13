/** Explicit, bounded, private official archive acquisition. No credentials or Production access. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicCache,privateDirectory,immutable,sha,foundationSessions} from './foundation-history.mjs';
import {auditFoundation} from './foundation-validation.mjs';
import {officialNumber,officialDate} from '../../research/entry-official-history.ts';
const n=officialNumber;
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const end=(y,m)=>new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
const receipt=(at,asof)=>{if(!Number.isFinite(Date.parse(at))||Date.parse(asof)>Date.parse(at))throw Error('FUTURE_PERIOD');};
function trace(symbol,kind,period,source,at,asof,raw,basis,values){receipt(at,asof);return {symbol,kind,period,source,published_at:null,first_seen_at:at,available_at:at,as_of:asof,evidence_hash:sha(raw),id:kind+'-'+sha({symbol,period,source,raw}),basis,values,data_quality_status:'OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_UNKNOWN',source_version:'OFFICIAL_ARCHIVE_RETRIEVED_V1',historical_knowledge:false};}
export function csvRows(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV_UNCLOSED');if(cell||row.length){row.push(cell);rows.push(row);}return rows;
}
export function parseRevenue(text,{period,symbols,url},at){
 const [fields,...data]=csvRows(text.replace(/^\uFEFF/,''));if(!fields?.includes('公司代號')||!fields.includes('資料年月')||new Set(fields).size!==fields.length)throw Error('REVENUE_SCHEMA');
 const out=[],rejected=[],seen=new Set(),[year,month]=period.split('-').map(Number);
 for(const cells of data){const r=Object.fromEntries(fields.map((f,i)=>[f,cells[i]])),symbol=r['公司代號'];if(!symbols.includes(symbol))continue;
  if(cells.length!==fields.length||seen.has(symbol))throw Error('REVENUE_DUPLICATE_OR_COLUMNS');seen.add(symbol);
  const m=/^(\d{3,4})[/-](\d{1,2})$/.exec(r['資料年月']),current=n(r['營業收入-當月營收']),prior=n(r['營業收入-上月營收']),lastyear=n(r['營業收入-去年當月營收']);
  if(!m||Number(m[1])+(m[1].length===3?1911:0)!==year||Number(m[2])!==month||current===null)throw Error('REVENUE_PERIOD_OR_VALUE');
  const ratio=(base,key)=>{const v=n(r[key]);if(base===null||base<=0)return null;if(v===null||Math.abs((current/base-1)*100-v)>.03)throw Error('REVENUE_RATIO_MISMATCH');return v;};
  let values;try{values={revenue_thousand_twd:current,prior_month_thousand_twd:prior,prior_year_thousand_twd:lastyear,yoy_percent:ratio(lastyear,'營業收入-去年同月增減(%)'),mom_percent:ratio(prior,'營業收入-上月比較增減(%)')};}catch(e){rejected.push({symbol,reason:e.message});continue;}
  if(values.yoy_percent===null)rejected.push({symbol,reason:'YOY_BASE_UNAVAILABLE'});
  out.push({...trace(symbol,'REVENUE',period,url,at,end(year,month)+'T23:59:59+08:00',{period,values},'MONTHLY',values),source_date:officialDate(r['出表日期']),publication_precision:'UNKNOWN_NOT_SOURCE_EXPORT_DATE',actual_only:true,consensus:false});
 }return {rows:out,rejected,source_rows:data.length};
}
export function parseInstitutional(p,{exchange,date,symbols,url},at){
 let fields,data,sourceDate;
 if(exchange==='TWSE'){if(p.stat!=='OK')throw Error('INSTITUTIONAL_SOURCE_EMPTY');({fields,data}=p);sourceDate=officialDate(p.date);}
 else {const t=p.tables?.find(t=>t.title==='三大法人買賣明細資訊');if(!t)throw Error('INSTITUTIONAL_SCHEMA');({fields,data}=t);sourceDate=officialDate(t.date);}
 if(sourceDate!==date||!Array.isArray(fields)||!Array.isArray(data))throw Error('INSTITUTIONAL_DATE');
 const seen=new Set(),rows=[];
 for(const r of data){const symbol=String(r[0]).trim();if(!symbols.includes(symbol))continue;if(seen.has(symbol)||r.length!==fields.length)throw Error('INSTITUTIONAL_DUPLICATE_OR_COLUMNS');seen.add(symbol);
  let foreign,trust,dealer,total;
  if(exchange==='TWSE'){const read=k=>n(r[fields.indexOf(k)]);foreign=read('外陸資買賣超股數(不含外資自營商)');trust=read('投信買賣超股數');dealer=read('自營商買賣超股數');total=read('三大法人買賣超股數');}
  else {if(fields.length!==24||fields[0]!=='代號'||fields[23]!=='三大法人買賣超股數合計'||[4,7,10,13,16,19,22].some(i=>fields[i]!=='買賣超股數'))throw Error('TPEX_COLUMN_CONTRACT');foreign=n(r[4]);trust=n(r[13]);dealer=n(r[22]);total=n(r[23]);for(const i of [2,5,8,11,14,17,20])if(n(r[i])===null||n(r[i+1])===null||n(r[i])-n(r[i+1])!==n(r[i+2]))throw Error('TPEX_SHARES_ACCOUNTING');}
  if(![foreign,trust,dealer,total].every(Number.isSafeInteger)||foreign+trust+dealer!==total)throw Error('INSTITUTIONAL_TOTAL_MISMATCH');
  rows.push(trace(symbol,'INSTITUTIONAL',date,url,at,date+'T13:30:00+08:00',r,'SHARES',{net_shares:total,foreign_net_shares:foreign,trust_net_shares:trust,dealer_net_shares:dealer}));
 }return {rows,source_rows:data.length,rejected:[]};
}
/** Each industry has a different header. Never position-map one industry's figures onto another. */
export function parseFinancial(text,{kind,year,quarter,symbols,url,exchange},at){
 if(!text.includes('公開資訊觀測站')||!text.includes(exchange==='TWSE'?'上市公司':'上櫃公司'))throw Error('FINANCIAL_SCHEMA');
 const rows=[],seen=new Set();let fields=[];
 for(const match of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...match[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m=>clean(m[1]));
  if(cells[0]==='公司代號'){fields=cells;continue;}const symbol=cells[0];if(!symbols.includes(symbol))continue;
  if(!fields.length||cells.length!==fields.length||seen.has(symbol))throw Error('FINANCIAL_COLUMNS_OR_DUPLICATE');seen.add(symbol);
  const r=Object.fromEntries(fields.map((f,i)=>[f,cells[i]]));const get=(...keys)=>{for(const key of keys)if(Object.hasOwn(r,key))return n(r[key]);return null;};
  const values=kind==='FINANCIAL_YTD'?{eps:get('基本每股盈餘（元）'),revenue:get('營業收入'),gross_profit:get('營業毛利（毛損）淨額','營業毛利（毛損）'),operating_profit:get('營業利益（損失）','營業利益'),net_profit:get('本期淨利（淨損）','本期稅後淨利（淨損）')}
   :{operating_cash_flow:get('營業活動之淨現金流入（流出）'),investing_cash_flow:get('投資活動之淨現金流入（流出）'),financing_cash_flow:get('籌資活動之淨現金流入（流出）'),capex:null};
  if(Object.values(values).every(v=>v===null))throw Error('FINANCIAL_VALUES_MISSING');
  rows.push({...trace(symbol,kind,`${year}-Q${quarter}`,url,at,end(year,quarter*3)+'T23:59:59+08:00',{fields,cells},'AS_REPORTED_YTD',values),exchange,unit:'TWD_THOUSAND_EXCEPT_EPS_TWD_PER_SHARE',restatement_status:'AS_RETRIEVED_NOT_ORIGINAL_VINTAGE',quarter_eps_derivation:'NOT_SUBTRACTED_WEIGHTED_SHARES_UNKNOWN',capex_status:'NOT_INFERRED_FROM_NET_INVESTING_CASH_FLOW'});
 }return {rows,rejected:[],source_rows:seen.size};
}
export async function acquireStockEvidence({foundationDir,cacheDir}){
 if(process.env.CI)throw Error('PRIVATE_RESEARCH_NOT_CI');const {history}=auditFoundation(foundationDir),dir=privateDirectory(cacheDir),client=createPublicCache(dir,{minimumInterval:2500,maxRequests:300}),rows=[],sources=[],failures=[];
 // One warm-up month supports 36 actual reported months where September is
 // not yet in the official archive. Never fabricate September for those firms.
 const months=Array.from({length:37},(_,i)=>{const d=new Date(Date.UTC(2023,8+i,1));return d.toISOString().slice(0,7);}),dates=foundationSessions(history.before,20);
 const add=async(spec,normalize,format='json',form=null)=>{try{const c=await client.get(spec.url,'real-stock-v1-20261011',normalize,format,form);rows.push(...c.data.rows);sources.push({url:spec.url,kind:spec.kind,first_seen_at:c.first_seen_at,raw_response_hash:c.raw_response_hash,normalized_hash:c.digest,form});failures.push(...c.data.rejected.map(r=>({...r,source:spec.url})));}catch(e){failures.push({source:spec.url,kind:spec.kind,reason:e.message});}console.log(JSON.stringify({stage:spec.kind,sources:sources.length,failures:failures.length,...client.stats}));};
 for(const exchange of ['TWSE','TPEX']){const market=exchange==='TWSE'?'sii':'otc',symbols=history.rows.filter(r=>r.exchange===exchange).map(r=>r.symbol);
  for(const period of months){const [year,month]=period.split('-').map(Number),spec={kind:'REVENUE',period,symbols,url:`https://mopsov.twse.com.tw/nas/t21/${market}/t21sc03_${year-1911}_${month}.csv`};await add(spec,(p,at)=>parseRevenue(p,spec,at),'text');}
  for(const date of dates){const roc=`${Number(date.slice(0,4))-1911}/${date.slice(5).replace('-','/')}`,url=exchange==='TWSE'?`https://www.twse.com.tw/rwd/zh/fund/T86?date=${date.replaceAll('-','')}&selectType=ALL&response=json`:`https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&d=${roc}&o=json`,spec={kind:'INSTITUTIONAL',date,exchange,symbols,url};await add(spec,(p,at)=>parseInstitutional(p,spec,at));}
  for(let k=0;k<10;k++){const year=2024+Math.floor(k/4),quarter=k%4+1;for(const [kind,path] of [['FINANCIAL_YTD','04'],['CASHFLOW_YTD','20']]){const form={encodeURIComponent:'1',firstin:'1',off:'1',step:'1',isQuery:'Y',TYPEK:market,year:String(year-1911),season:String(quarter).padStart(2,'0')},base=`https://mopsov.twse.com.tw/mops/web/ajax_t163sb${path}`,spec={kind,year,quarter,symbols,exchange,url:base};await add(spec,(p,at)=>parseFinancial(p,{...spec,url:base+'?'+new URLSearchParams(form)},at),'text',form);}}
 }
 const payload={schema:'VNEXT_REAL_STOCK_EVIDENCE_V1',collected_at:new Date().toISOString(),through:history.through,history_hash:sha(history),universe:history.rows.map(r=>r.symbol),rows,sources,failures,stats:client.stats,forward_sample:0,outcome_sample:0,production_operations:0};
 const file=resolve(dir,'stock-evidence-'+sha(payload)+'.json');immutable(file,payload);console.log(JSON.stringify({output:file,facts:rows.length,sources:sources.length,failures:failures.length,stats:client.stats}));return payload;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await acquireStockEvidence({foundationDir:process.env.MA_VNEXT_FOUNDATION_DIR,cacheDir:process.env.MA_VNEXT_STOCK_DIR});
