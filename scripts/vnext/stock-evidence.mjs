/** Explicit, bounded, private official archive acquisition. No credentials or Production access. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicCache,privateDirectory,immutable,sha,foundationSessions} from './foundation-history.mjs';
import {auditFoundation} from './foundation-validation.mjs';
import {officialNumber,officialDate} from '../../research/entry-official-history.ts';
const n=officialNumber;
const clean=s=>s.replace(/<[^<>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const end=(y,m)=>new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
const receipt=(at,asof)=>{if(!Number.isFinite(Date.parse(at))||Date.parse(asof)>Date.parse(at))throw Error('FUTURE_PERIOD');};
function trace(symbol,kind,period,source,at,asof,raw,basis,values){receipt(at,asof);return {symbol,kind,period,source,published_at:null,first_seen_at:at,available_at:at,as_of:asof,evidence_hash:sha(raw),id:kind+'-'+sha({symbol,period,source,raw}),basis,values,data_quality_status:'OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_UNKNOWN',source_version:'OFFICIAL_ARCHIVE_RETRIEVED_V1',historical_knowledge:false};}
export function csvRows(text){
 if(text.length>8_000_000)throw Error('CSV_SIZE_LIMIT');
 const rows=[];let row=[],cell='',quoted=false;
 const push=()=>{row.push(cell);cell='';if(row.length>128)throw Error('CSV_COLUMN_LIMIT');};
 const finish=()=>{push();if(row.some(Boolean))rows.push(row);if(rows.length>25_000)throw Error('CSV_ROW_LIMIT');row=[];};
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted)push();else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;finish();}else cell+=c;if(cell.length>32768)throw Error('CSV_CELL_LIMIT');}
 if(quoted)throw Error('CSV_UNCLOSED');if(cell||row.length)finish();return rows;
}
export function parseRevenue(text,{period,symbols,url},at){
 const [fields,...data]=csvRows(text.replace(/^\uFEFF/,''));if(!fields?.includes('公司代號')||!fields.includes('資料年月')||new Set(fields).size!==fields.length)throw Error('REVENUE_SCHEMA');
 const out=[],rejected=[],seen=new Set(),[year,month]=period.split('-').map(Number);
 for(const cells of data){const symbol=cells[fields.indexOf('公司代號')];if(!symbols.includes(symbol))continue;
  if(cells.length!==fields.length||seen.has(symbol))throw Error('REVENUE_DUPLICATE_OR_COLUMNS');seen.add(symbol);
  const r=Object.fromEntries(fields.map((f,i)=>[f,cells[i]]));
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
export function* financialRows(text){
 if(text.length>8_000_000)throw Error('FINANCIAL_SIZE_LIMIT');
 let row=null,cell=null,count=0;
 // One linear tag scan. Never retry an unterminated row regex at every opener.
 for(const token of text.matchAll(/<\/?(tr|td|th)\b[^<>]*>/gi)){
  const name=token[1].toLowerCase(),closing=token[0][1]==='/';
  if(name==='tr'){
   if(!closing){if(row!==null)throw Error('FINANCIAL_NESTED_ROW');row=[];}
   else if(row!==null){if(cell!==null)throw Error('FINANCIAL_UNCLOSED_CELL');if(++count>5000)throw Error('FINANCIAL_ROW_LIMIT');yield row;row=null;}
  }else if(row!==null){
   if(!closing){if(cell!==null)throw Error('FINANCIAL_NESTED_CELL');cell={name,start:token.index+token[0].length};}
   else{if(cell===null||cell.name!==name)throw Error('FINANCIAL_CELL_MISMATCH');if(token.index-cell.start>32768)throw Error('FINANCIAL_CELL_LIMIT');row.push(clean(text.slice(cell.start,token.index)));if(row.length>128)throw Error('FINANCIAL_COLUMN_LIMIT');cell=null;}
  }
 }
 if(row!==null||cell!==null)throw Error('FINANCIAL_UNCLOSED_ROW');
}
export function parseFinancial(text,{kind,year,quarter,symbols,url,exchange},at){
 if(!text.includes('公開資訊觀測站')||!text.includes(exchange==='TWSE'?'上市公司':'上櫃公司'))throw Error('FINANCIAL_SCHEMA');
 const rows=[],seen=new Set();let fields=[];
 for(const cells of financialRows(text)){
  if(cells[0]==='公司代號'){fields=cells;continue;}const symbol=cells[0];if(!symbols.includes(symbol))continue;
  if(!fields.length||cells.length!==fields.length||seen.has(symbol))throw Error('FINANCIAL_COLUMNS_OR_DUPLICATE');seen.add(symbol);
  const r=Object.fromEntries(fields.map((f,i)=>[f,cells[i]]));const get=(...keys)=>{for(const key of keys)if(Object.hasOwn(r,key))return n(r[key]);return null;};
  const values=kind==='FINANCIAL_YTD'?{eps:get('基本每股盈餘（元）'),revenue:get('營業收入'),gross_profit:get('營業毛利（毛損）淨額','營業毛利（毛損）'),operating_profit:get('營業利益（損失）','營業利益'),net_profit:get('本期淨利（淨損）','本期稅後淨利（淨損）')}
   :{operating_cash_flow:get('營業活動之淨現金流入（流出）'),investing_cash_flow:get('投資活動之淨現金流入（流出）'),financing_cash_flow:get('籌資活動之淨現金流入（流出）'),capex:null};
  if(Object.values(values).every(v=>v===null))throw Error('FINANCIAL_VALUES_MISSING');
  rows.push({...trace(symbol,kind,`${year}-Q${quarter}`,url,at,end(year,quarter*3)+'T23:59:59+08:00',{fields,cells},'AS_REPORTED_YTD',values),exchange,unit:'TWD_THOUSAND_EXCEPT_EPS_TWD_PER_SHARE',restatement_status:'AS_RETRIEVED_NOT_ORIGINAL_VINTAGE',quarter_eps_derivation:'NOT_SUBTRACTED_WEIGHTED_SHARES_UNKNOWN',capex_status:'NOT_INFERRED_FROM_NET_INVESTING_CASH_FLOW'});
 }
 // A successful request does not prove the response period. Never attach the
 // requested year/season to a different filing, form echo, or application shell.
 const period=financialResponsePeriod(text);
 if(period===null)return {rows:[],source_rows:seen.size,
  // Preserve actual reported values, not a fabricated accounting period. A
  // stable metadata gap is a quarantined successful capture, not a transient
  // transport error that should consume three more Provider attempts.
  unverified_rows:rows.map(row=>({...row,
   requested_period:row.period,period:null,as_of:null,source_period:null,standalone_quarter_actual:false,
   period_verification:'REQUEST_BINDING_ONLY_NOT_RESPONSE_PROOF',
   data_quality_status:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'})),
  rejected:rows.map(row=>({symbol:row.symbol,reason:'FINANCIAL_RESPONSE_PERIOD_UNPROVEN'}))};
 if(period.year!==year||period.quarter!==quarter)throw Error('FINANCIAL_RESPONSE_PERIOD_MISMATCH');
 if(!rows.length)throw Error('FINANCIAL_SOURCE_ROWS_EMPTY');
 return {rows:rows.map(row=>({...row,source_period:period,
  period_verification:'RESPONSE_REPORT_HEADING_MATCHED_REQUEST',
  // Even a matching YTD report is not a standalone-quarter EPS statement.
  standalone_quarter_actual:false})),rejected:[],source_rows:seen.size};
}
/** Only report headings/captions count. Request inputs, scripts and company
 * data cells are not publication/period evidence. No date or EPS subtraction. */
export function financialResponsePeriod(text){
 if(typeof text!=='string'||text.length>8_000_000)throw Error('FINANCIAL_SIZE_LIMIT');
 const periods=new Map();let open=null,count=0;
 const tokens=/<!--|<\/?(h[1-6]|caption|script|style|textarea|template)\b[^<>]*>/gi;
 for(let token;(token=tokens.exec(text))!==null;){
  if(token[0]==='<!--'){
   const end=text.indexOf('-->',tokens.lastIndex);if(end<0)throw Error('FINANCIAL_HEADING_STRUCTURE');
   tokens.lastIndex=end+3;continue;
  }
  const tag=token[1].toLowerCase(),closing=token[0][1]==='/';
  if(['script','style','textarea','template'].includes(tag)){
   if(closing)throw Error('FINANCIAL_HEADING_STRUCTURE');
   const close=new RegExp('</'+tag+'\\s*>','gi');close.lastIndex=tokens.lastIndex;
   const end=close.exec(text);if(!end)throw Error('FINANCIAL_HEADING_STRUCTURE');
   if(tag==='template'&&/<template\b/i.test(text.slice(tokens.lastIndex,end.index)))throw Error('FINANCIAL_HEADING_STRUCTURE');
   tokens.lastIndex=close.lastIndex;continue;
  }
  if(++count>200)throw Error('FINANCIAL_HEADING_LIMIT');
  if(!closing){if(open!==null)throw Error('FINANCIAL_HEADING_STRUCTURE');open={tag,start:token.index+token[0].length};continue;}
  if(open===null||open.tag!==tag)throw Error('FINANCIAL_HEADING_STRUCTURE');
  if(token.index-open.start>4096)throw Error('FINANCIAL_HEADING_LIMIT');
  const label=clean(text.slice(open.start,token.index));open=null;
  for(const m of label.matchAll(/(?:民國\s*)?(\d{3,4})\s*年\s*第?\s*([1-4一二三四])\s*季(?:度)?/g)){
   const year=Number(m[1])+(m[1].length===3?1911:0),quarter=Number(m[2])||'一二三四'.indexOf(m[2])+1;
   if(year<2000||year>2100)throw Error('FINANCIAL_RESPONSE_PERIOD_INVALID');
   periods.set(`${year}-Q${quarter}`,{year,quarter});
  }
 }
 if(open!==null)throw Error('FINANCIAL_HEADING_STRUCTURE');
 if(periods.size>1)throw Error('FINANCIAL_RESPONSE_PERIOD_CONFLICT');
 return periods.size===1?[...periods.values()][0]:null;
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
