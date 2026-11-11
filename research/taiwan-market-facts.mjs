/** Normalize whole-market public captures. Every observation keeps its original
 * row location, response digest and actual receipt time; absent values stay null. */
import {createHash} from 'node:crypto';
import {TAIWAN_COMPANY_SOURCES,marketSnapshotHash,officialDate,parseOfficialCompanyCsv} from './taiwan-market-universe.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error('TAIWAN_FACTS_'+code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const instant = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const taipeiDate = v => new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);
const string = v => String(v??'').trim();
const choose = (row,names) => { for(const name of names) if(Object.hasOwn(row,name)) return row[name]; return null; };
const value = (row,names) => officialNumber(choose(row,names));
const primaryDate = row => officialDate(choose(row,['Date','出表日期']));
const quarter = row => {
 const y=string(choose(row,['年度','Year'])),q=string(choose(row,['季別','Season']));
 if(!/^\d{3,4}$/.test(y)||!/^0?[1-4]$/.test(q))return null;
 const year=Number(y)+(y.length===3?1911:0);if(year<1912||year>2200)fail('FINANCIAL_YEAR');
 return `${year}Q${Number(q)}`;
};

export function officialNumber(input) {
 if(input===null||input===undefined)return null;
 let s=string(input);if(['','--','---','-','N/A','NA','不適用'].includes(s))return null;
 if(/^\([\d,.]+\)$/.test(s))s='-'+s.slice(1,-1);
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))return null;
 const n=Number(s.replaceAll(',',''));return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null;
}
export function officialMonth(input) {
 const s=string(input);let y,m;
 if(/^\d{5}$/.test(s)){y=Number(s.slice(0,3))+1911;m=Number(s.slice(3));}
 else if(/^\d{6}$/.test(s)){y=Number(s.slice(0,4));m=Number(s.slice(4));}
 else if(/^\d{4}-\d\d$/.test(s)){y=Number(s.slice(0,4));m=Number(s.slice(5));}
 else if(/^\d{3,4}\/\d{1,2}$/.test(s)){const p=s.split('/');y=Number(p[0])+(p[0].length===3?1911:0);m=Number(p[1]);}
 else fail('MONTH');
 if(y<1912||y>2200||m<1||m>12)fail('MONTH');return `${y}-${String(m).padStart(2,'0')}`;
}

export function marketCaptureId(receipt) {
 return marketSnapshotHash({source_id:receipt.source_id,url:receipt.url,source_sha256:receipt.sha256,received_at:receipt.received_at});
}
/** This is a data receipt, not a claim of commercial reuse clearance. */
export function readOfficialMarketCapture({receipt,bytes,spec,cutoff}) {
 if(!object(receipt)||!object(spec)||receipt.schema!=='TAIWAN_PUBLIC_SOURCE_RECEIPT_V1'||receipt.state!=='CAPTURED'
  ||receipt.status!==200||receipt.source_id!==spec.id||receipt.url!==spec.url||receipt.format!==spec.format
  ||!instant(receipt.started_at)||!instant(receipt.received_at)||!instant(cutoff)
  ||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)||Date.parse(receipt.received_at)>Date.parse(cutoff)
  ||!Buffer.isBuffer(bytes)||bytes.length!==receipt.bytes||bytes.length<1||bytes.length>spec.byte_limit
  ||sha(bytes)!==receipt.sha256)fail('CAPTURE_BINDING');
 let decoded,rows;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);rows=spec.format==='csv'?parseOfficialCompanyCsv(decoded):JSON.parse(decoded.replace(/^\uFEFF/,''));}catch{fail('CAPTURE_PARSE');}
 if(!Array.isArray(rows)||rows.length>20000||rows.length!==receipt.row_count)fail('CAPTURE_ROWS');
 return {receipt:structuredClone(receipt),spec,rows,capture_id:marketCaptureId(receipt)};
}

export function marketSourceBinding(capture,row,row_index,symbol_field) {
 return {capture_id:capture.capture_id,source_id:capture.receipt.source_id,source_url:capture.receipt.url,
  source_sha256:capture.receipt.sha256,source_bytes:capture.receipt.bytes,received_at:capture.receipt.received_at,
  row_index,row_path:[row_index],source_row_hash:marketSnapshotHash(row),symbol_field};
}
function symbolField(row) { return ['公司代號','SecuritiesCompanyCode','Code'].find(k=>Object.hasOwn(row,k))??null; }
function common(capture,row,index,symbol_field) {
 const date=capture.spec.family.startsWith('ACTION')?null:primaryDate(row);
 if(date&&date>taipeiDate(capture.receipt.received_at))fail('FUTURE_SOURCE_DATE');
 return {schema:'TAIWAN_MARKET_OBSERVATION_V1',symbol:string(row[symbol_field]),market:capture.spec.market,
  family:capture.spec.family,source_as_of:date,available_at:capture.receipt.received_at,
  source_capture:marketSourceBinding(capture,row,index,symbol_field)};
}
function price(row,base) {
 if(base.market==='EMERGING'){
  const values={high:value(row,['Highest']),low:value(row,['Lowest']),average:value(row,['Average']),last:value(row,['LatestPrice']),
   previous_average:value(row,['PreviousAveragePrice']),bid:value(row,['BuyingPrice']),ask:value(row,['SellingPrice']),
   volume:value(row,['TransactionVolume'])};
  const valid=values.volume!==null&&Number.isSafeInteger(values.volume)&&values.volume>0&&values.high>0&&values.low>0
   &&values.high>=values.low&&values.average>=values.low&&values.average<=values.high&&values.last>=values.low&&values.last<=values.high;
  return {...base,kind:'EMERGING_NATIVE_QUOTE',date:base.source_as_of,...values,open:null,close:null,amount:null,currency:'TWD',
   volume_unit:'SHARES',price_basis:'NEGOTIATED_MARKET_WEIGHTED_AVERAGE_AND_LAST_NOT_OPEN_CLOSE',
   quote_time_as_reported:string(row.Time),suspend_time_as_reported:string(row.SuspendTime),valid_trade:valid,
   execution_price_available:false};
 }
 const vals=base.market==='TWSE'?['OpeningPrice','HighestPrice','LowestPrice','ClosingPrice','TradeVolume','TradeValue'].map(k=>officialNumber(row[k]))
  :['Open','High','Low','Close','TradingShares','TransactionAmount'].map(k=>officialNumber(row[k]));
 const [open,high,low,close,volume,amount]=vals;
 const valid=vals.every(v=>v!==null&&v>0)&&high>=Math.max(open,close)&&low<=Math.min(open,close)
  &&Number.isSafeInteger(volume)&&Number.isSafeInteger(amount);
 return {...base,kind:'DAILY_OHLCVA',date:base.source_as_of,open,high,low,close,volume,amount,currency:'TWD',volume_unit:'SHARES',
  amount_unit:'TWD',price_basis:'RAW_EXCHANGE_AS_RETRIEVED',valid_trade:valid,execution_price_available:false};
}
function revenue(row,base) {
 const period=officialMonth(row['資料年月']);if(period>base.source_as_of.slice(0,7))fail('FUTURE_REVENUE_PERIOD');
 const current=value(row,['營業收入-當月營收']),prior=value(row,['營業收入-去年當月營收']);
 const yoy=value(row,['營業收入-去年同月增減(%)']);
 const calculated=current!==null&&prior!==null&&prior>0?(current/prior-1)*100:null;
 return {...base,kind:'MONTHLY_REVENUE_AS_REPORTED',period,
  current,previous_month:value(row,['營業收入-上月營收']),prior_year_same_month:prior,
  ytd:value(row,['累計營業收入-當月累計營收']),prior_year_ytd:value(row,['累計營業收入-去年累計營收']),
  yoy_percent:yoy,mom_percent:value(row,['營業收入-上月比較增減(%)']),ytd_yoy_percent:value(row,['累計營業收入-前期比較增減(%)']),
  yoy_arithmetic_verified:calculated!==null&&yoy!==null&&Math.abs(calculated-yoy)<=0.02,
  amount_unit:'AS_REPORTED_NO_CURRENCY_CONVERSION',revenue_scope:'ISSUER_REPORTED_INDUSTRY_SPECIFIC',
  notes:string(row['備註']).slice(0,1500)};
}
function financial(row,base,spec) {
 const period=quarter(row);
 if(period){const end=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.at(-1))*3,0)).toISOString().slice(0,10);
  if(end>base.source_as_of)fail('FUTURE_FINANCIAL_PERIOD');}
 const basis=spec.family==='BALANCE'?'POINT_IN_TIME':'PERIOD_AS_REPORTED_NOT_ASSUMED_SINGLE_QUARTER_OR_TTM';
 const numbers={
  revenue:value(row,['營業收入']),operating_profit:value(row,['營業利益（損失）','營業利益']),
  net_profit:value(row,['本期淨利（淨損）','本期淨利(淨損)','稅後淨利']),
  parent_net_profit:value(row,['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主']),
  eps_basic:value(row,['基本每股盈餘（元）','基本每股盈餘(元)','基本每股盈餘']),
  assets:value(row,['資產總計','資產總額']),liabilities:value(row,['負債總計','負債總額']),
  equity:value(row,['權益總計','權益總額']),parent_equity:value(row,['歸屬於母公司業主之權益合計','歸屬於母公司業主之權益']),
  book_value_per_share:value(row,['每股參考淨值']),current_assets:value(row,['流動資產']),current_liabilities:value(row,['流動負債']),
 };
 const balance_ok=numbers.assets!==null&&numbers.liabilities!==null&&numbers.equity!==null
  ?Math.abs(numbers.assets-numbers.liabilities-numbers.equity)<=Math.max(2,Math.abs(numbers.assets)*0.000001):null;
 return {...base,kind:spec.family==='EPS_AS_REPORTED'?spec.family:spec.family+'_AS_REPORTED',statement_class:spec.industry_statement??null,period,period_basis:basis,
  amount_unit:'AS_REPORTED_NO_CURRENCY_CONVERSION',per_share_basis:'BASIC_WHERE_EXPLICITLY_LABELLED',...numbers,
  balance_identity_verified:balance_ok,ttm_eps:null,diluted_eps:null,annualized_eps:null,
  unspecified_eps_as_reported:spec.market==='EMERGING'&&spec.family==='EPS_AS_REPORTED'?value(row,['EPS']):null};
}
function valuation(row,base) {
 return {...base,kind:'OFFICIAL_VALUATION_AS_REPORTED',date:base.source_as_of,
  pe:value(row,['PEratio','PriceEarningRatio']),pb:value(row,['PBratio','PriceBookRatio']),
  dividend_yield_percent:value(row,['DividendYield','YieldRatio']),close:value(row,['ClosePrice']),
  dividend_year_as_reported:string(row.DividendYear)||null,
  financial_period:/^\d{4}Q[1-4]$/.test(string(row.FiscalYearQuarter))?string(row.FiscalYearQuarter):null,
  eps_inferred_from_price:null,financial_period_not_imputed:!row.FiscalYearQuarter};
}
function announcement(row,base) {
 let published_at=null;
 try {const d=officialDate(row['發言日期']),t=string(row['發言時間']).padStart(6,'0');
  if(/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(t)){
   const proposed=`${d}T${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4)}+08:00`;
   if(Date.parse(proposed)<=Date.parse(base.available_at))published_at=proposed;
  }
 } catch { /* Preserve unknown original publication time. */ }
 return {...base,kind:'OFFICIAL_ISSUER_ANNOUNCEMENT',published_at,
  title:string(choose(row,['主旨','主旨 '])).slice(0,1000),text:string(row['說明']).slice(0,7000),
  text_truncated:string(row['說明']).length>7000,rule_as_reported:string(row['符合條款']),
  event_date_as_reported:string(row['事實發生日']),sentiment_or_beneficiary_not_inferred:true};
}

/** Missing/placeholder financial rows are explicitly accounted for. Company
 * identifiers are joined with their market; warrants/ETFs never enter by code alone. */
export function normalizeTaiwanMarketFacts({universe,catalog,captures,cutoff}) {
 const {universe_hash,...universeBody}=universe??{};
 if(universe?.schema!=='TAIWAN_MARKET_UNIVERSE_V1'||marketSnapshotHash(universeBody)!==universe_hash
  ||catalog?.schema!=='TAIWAN_OFFICIAL_DATASET_CATALOG_V1'||!instant(cutoff)||!Array.isArray(captures))fail('INPUT');
 const specs=new Map(catalog.sources.map(s=>[s.id,s]));
 for(const [id,s] of Object.entries(TAIWAN_COMPANY_SOURCES))specs.set(id,{...s,id,family:'ROSTER',byte_limit:8000000});
 const securities=new Map(universe.companies.map(company=>[company.security_id,{security_id:company.security_id,company,
  observations:[],issues:[]}])) ,datasets=[],seenSources=new Set();
 for(const entry of captures){
  const spec=specs.get(entry.receipt?.source_id);if(!spec)continue;
  if(seenSources.has(spec.id))fail('DUPLICATE_SOURCE_CAPTURE');seenSources.add(spec.id);
  const capture=readOfficialMarketCapture({...entry,spec,cutoff}),seenRows=new Map();
  const stats={source_id:spec.id,market:spec.market,family:spec.family,capture_id:capture.capture_id,source_sha256:entry.receipt.sha256,
   source_bytes:entry.receipt.bytes,received_at:entry.receipt.received_at,rows:capture.rows.length,matched:0,not_in_roster:0,
   placeholder_rows:0,rejected:[],source_dates:[]};const dates=new Set();
  for(let i=0;i<capture.rows.length;i++){
   const row=capture.rows[i];if(!object(row)){stats.rejected.push({row_index:i,error:'ROW_OBJECT_REQUIRED'});continue;}
   const field=symbolField(row),symbol=field?string(row[field]):'';
   if(!symbol){stats.placeholder_rows++;continue;}
   const security_id=spec.market+':'+symbol,target=securities.get(security_id);
   if(!target){stats.not_in_roster++;continue;}
   try {
    const base=common(capture,row,i,field);if(base.source_as_of)dates.add(base.source_as_of);let observation;
    if(spec.family==='ROSTER')observation={...base,kind:'OFFICIAL_SECURITY_IDENTITY',company:target.company.company,
     industry_code:target.company.industry_code,instrument_kind:target.company.instrument_kind,
     listing_status:target.company.listing_status,listed_at:target.company.listed_at,price_availability:'NOT_INFERRED_FROM_ROSTER'};
    else if(spec.family==='PRICE')observation=price(row,base);
    else if(spec.family==='REVENUE')observation=revenue(row,base);
    else if(['INCOME','BALANCE','EPS_AS_REPORTED'].includes(spec.family))observation=financial(row,base,spec);
    else if(spec.family==='VALUATION')observation=valuation(row,base);
    else if(spec.family==='ANNOUNCEMENT')observation=announcement(row,base);
    else if(spec.family.startsWith('ACTION'))observation={...base,kind:'CORPORATE_ACTION_ROW_AS_REPORTED',
     event_date:officialDate(choose(row,['Date','ExRrightsExDividendDate'])),raw_fields:row,coverage_complete:false,
     coverage_scope:spec.family==='ACTION_DAILY'?'ONE_DAY_SNAPSHOT':'ANNOUNCEMENT_SNAPSHOT_NOT_COMPLETE_HISTORY'};
    else fail('FAMILY_UNSUPPORTED');
    const uniqueKey=security_id+':'+spec.family;
    if(!['ANNOUNCEMENT','ACTION_DAILY','ACTION_ANNOUNCEMENT'].includes(spec.family)&&seenRows.has(uniqueKey)){
     const previous=seenRows.get(uniqueKey);previous.invalidated='DUPLICATE_SOURCE_SECURITY';observation.invalidated='DUPLICATE_SOURCE_SECURITY';
     target.issues.push({source_id:spec.id,code:'DUPLICATE_SOURCE_SECURITY'});
    }
    seenRows.set(uniqueKey,observation);target.observations.push(observation);stats.matched++;
   }catch(error){const issue={row_index:i,security_id,error:String(error.message)};stats.rejected.push(issue);target.issues.push({source_id:spec.id,code:issue.error});}
  }
  stats.source_dates=[...dates].sort();datasets.push(stats);
 }
 const body={schema:'TAIWAN_MARKET_FACT_SET_V1',universe_hash,cutoff,securities:[...securities.values()],datasets,
  expected_dataset_count:catalog.sources.length+3,captured_dataset_count:datasets.length,
  missing_datasets:[...specs.keys()].filter(id=>!seenSources.has(id)),source_time_basis:'ACTUAL_RECEIPT_NOT_BACKDATED',
  financial_history_inferred:false,methodology_approved:false,member_published:false};
 return {...body,facts_hash:marketSnapshotHash(body)};
}

export function marketObservationEvidence(observation) {
 if(observation.invalidated)fail('INVALIDATED_OBSERVATION');
 const content=JSON.stringify(observation),digest=sha(content);
 if(content.length>12000)fail('EVIDENCE_SIZE');
 const kind=observation.family==='PRICE'?'PRICE':observation.family==='ANNOUNCEMENT'?'NEWS':'FINANCIAL';
 const observed=observation.available_at;
 return {id:'market-'+digest.slice(0,40),symbol:observation.symbol,kind,source:observation.source_capture.source_url,
  published_at:null,available_at:observed,content,time_basis:'OBSERVED_AFTER_RECEIPT',
  first_seen_at:observed,as_of:observed,evidence_hash:digest};
}

/** An actual MOPS monthly-revenue download keeps its original UTF8 bytes/BOM.
 * Its CSV row references use header-inclusive arrays, matching the database RPC. */
export function publicMonthlyRevenueReceipt(original,bytes){
 if(original?.schema!=='TAIWAN_FINANCIAL_CSV_RECEIPT_V1'||original.state!=='CAPTURED'||original.status!==200
  ||original.url!=='https://mopsov.twse.com.tw/server-java/FileDownLoad'||original.method!=='POST'
  ||original.form?.step!=='9'||original.form?.functionName!=='show_file2'||original.form?.filePath!=='/t21/sii/'
  ||!/^t21sc03_\d{3}_\d{1,2}\.csv$/.test(original.form?.fileName??'')||sha(bytes)!==original.sha256||bytes.length!==original.bytes)fail('MONTHLY_RECEIPT');
 const [,y,m]=original.form.fileName.match(/^t21sc03_(\d{3})_(\d{1,2})\.csv$/),period=officialMonth(y+'/'+m);
 const rows=parseOfficialCompanyCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(rows.length+1!==original.csv_row_count)fail('MONTHLY_ROWS');
 return {schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:'MOPS_REVENUE_TWSE_'+period.replace('-','')+'_CSV',url:original.url,
  format:'csv',encoding:'UTF8',row_layout:'HEADER_AND_DATA_ARRAYS_V1',request_method:'POST',request_form:original.form,
  started_at:original.started_at,received_at:original.received_at,state:'CAPTURED',status:200,bytes:original.bytes,sha256:original.sha256,
  decoded_text_sha256:original.sha256,row_count:rows.length+1,data_row_count:rows.length,raw_path:original.raw_path,
  parent_html_sha256:original.parent_html_sha256,attempts:original.attempts};
}
export function addTaiwanMonthlyRevenueCapture({facts,receipt,bytes,cutoff}){
 const {facts_hash,...body}=facts??{},form=receipt?.request_form;
 if(facts_hash!==marketSnapshotHash(body)||receipt?.schema!=='TAIWAN_PUBLIC_SOURCE_RECEIPT_V1'||receipt.state!=='CAPTURED'||receipt.status!==200
  ||receipt.url!=='https://mopsov.twse.com.tw/server-java/FileDownLoad'||receipt.request_method!=='POST'
  ||receipt.encoding!=='UTF8'||receipt.format!=='csv'||receipt.row_layout!=='HEADER_AND_DATA_ARRAYS_V1'
  ||form?.step!=='9'||form?.functionName!=='show_file2'||form?.filePath!=='/t21/sii/'
  ||!/^t21sc03_\d{3}_\d{1,2}\.csv$/.test(form?.fileName??'')||!Buffer.isBuffer(bytes)||bytes.length>16000000
  ||bytes.length!==receipt.bytes||sha(bytes)!==receipt.sha256||receipt.decoded_text_sha256!==receipt.sha256
  ||!instant(receipt.started_at)||!instant(receipt.received_at)||!instant(cutoff)||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)
  ||Date.parse(receipt.received_at)>Date.parse(cutoff)||Date.parse(facts.cutoff)>Date.parse(cutoff))fail('MONTHLY_CAPTURE_BINDING');
 const [,year,month]=form.fileName.match(/^t21sc03_(\d{3})_(\d{1,2})\.csv$/),period=officialMonth(year+'/'+month);
 if(receipt.source_id!=='MOPS_REVENUE_TWSE_'+period.replace('-','')+'_CSV'||facts.datasets.some(d=>d.source_id===receipt.source_id))fail('MONTHLY_IDENTITY');
 const rows=parseOfficialCompanyCsv(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!rows.length||rows.length+1!==receipt.row_count||rows.length!==receipt.data_row_count)fail('MONTHLY_ROWS');
 const headers=Object.keys(rows[0]);if(headers[0]!=='出表日期'||headers[1]!=='資料年月'||headers[2]!=='公司代號')fail('MONTHLY_HEADERS');
 const securities=structuredClone(facts.securities),byId=new Map(securities.map(s=>[s.security_id,s])),seen=new Set(),dates=new Set();let matched=0,notInRoster=0;
 const capture={capture_id:marketCaptureId(receipt),receipt,spec:{market:'TWSE',family:'REVENUE'}};
 for(let i=0;i<rows.length;i++){const row=rows[i],symbol=string(row['公司代號']);if(!/^\d{4,6}$/.test(symbol)||seen.has(symbol))fail('MONTHLY_SYMBOL');seen.add(symbol);
  if(officialMonth(row['資料年月'])!==period)fail('MONTHLY_PERIOD');
  const base=common(capture,row,i+1,'公司代號');base.source_capture={...base.source_capture,row_path:[i+1],source_row_hash:marketSnapshotHash(headers.map(h=>row[h])),symbol_field:'2'};
  dates.add(base.source_as_of);const target=byId.get('TWSE:'+symbol);if(!target){notInRoster++;continue;}
  target.observations.push(revenue(row,base));matched++;
 }
 const dataset={source_id:receipt.source_id,market:'TWSE',family:'REVENUE',capture_id:capture.capture_id,source_sha256:receipt.sha256,
  source_bytes:receipt.bytes,received_at:receipt.received_at,rows:rows.length,matched,not_in_roster:notInRoster,placeholder_rows:0,rejected:[],source_dates:[...dates].sort()};
 const result={...body,cutoff,securities,datasets:[...facts.datasets,dataset],captured_dataset_count:facts.captured_dataset_count+1,expected_dataset_count:facts.expected_dataset_count+1};
 return {...result,facts_hash:marketSnapshotHash(result)};
}
