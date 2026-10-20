/** Runtime-portable copies of the reviewed archive parsers. No filesystem, credentials, or automatic requests. */
import {createHash} from 'node:crypto';
import {officialDate,officialNumber} from '../../../research/entry-official-history.ts';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
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
export function publicationTime(date,time){
 const d=officialDate(String(date??'')),s=String(time??'').trim().replaceAll(':','');
 if(!d||!/^\d{5,6}$/.test(s))return null;
 const p=s.padStart(6,'0'),h=Number(p.slice(0,2)),m=Number(p.slice(2,4)),sec=Number(p.slice(4));
 if(h>23||m>59||sec>59)return null;return `${d}T${p.slice(0,2)}:${p.slice(2,4)}:${p.slice(4)}+08:00`;
}
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

// End of byte-equivalent, filesystem-free parser copies.
