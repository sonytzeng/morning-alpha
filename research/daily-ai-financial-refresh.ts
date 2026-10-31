import {canonical} from './entry-opportunity.ts';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';

export const DAILY_AI_FINANCIAL_URLS={
 TWSE_EPS:'https://openapi.twse.com.tw/v1/opendata/t187ap14_L',
 TWSE_INCOME:'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci',
 TPEX_EPS:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap14_O',
 TWSE_VALUATION:'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d',
 TPEX_VALUATION:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
} as const;
type FinancialSource=typeof DAILY_AI_FINANCIAL_URLS[keyof typeof DAILY_AI_FINANCIAL_URLS];
type Row=Record<string,unknown>;
export type DailyAiFinancialRemoval={symbol:string;id:string;source:string;kind:string;period:string|null;evidence_hash:string;reason:string};
export type DailyAiFinancialResponse={source:FinancialSource;state:'CAPTURED'|'UNAVAILABLE';received_at:string|null;
 source_sha256:string|null;source_bytes:number|null;response_text:string|null;error:string|null};
export type DailyAiFinancialRefreshProof={schema:'DAILY_AI_FINANCIAL_REFRESH_V1';observed_at:string;responses:DailyAiFinancialResponse[];
 additions:{symbol:string;fact_id:string;body_text:string;row_text:string}[];removals:DailyAiFinancialRemoval[];
 company_names:{symbol:string;previous_company:string;company:string;source:FinancialSource;row_text:string}[]};
export type DailyAiFinancialRefreshResult={inputs:FunnelInput[];cutoff:string;additionalGaps:string[];gapsBySymbol:Record<string,string[]>;
 receipts:Omit<DailyAiFinancialResponse,'response_text'>[];removed:DailyAiFinancialRemoval[];proof:DailyAiFinancialRefreshProof};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_FINANCIAL_REFRESH_ABORTED');};
const taipeiDay=(s:string)=>new Date(Date.parse(s)+8*3600000).toISOString().slice(0,10);
const day=(s:string)=>/^\d{4}-\d\d-\d\d$/.test(s)&&validObservationTime(s+'T00:00:00Z');
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),n=>n.toString(16).padStart(2,'0')).join('');
const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n:null;
function num(value:unknown){
 if(typeof value==='number')return finite(value);
 if(typeof value!=='string'||!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim()))return null;
 return finite(Number(value.replaceAll(',','').trim()));
}
const field=(r:Row,...keys:string[])=>{for(const k of keys)if(r[k]!==undefined&&r[k]!==null)return r[k];return undefined;};
export function isRestrictedDailyAiFinancialSource(source:string){
 try{const host=new URL(source).hostname;return ['tsmc.com','mediatek.com','honhai.com'].some(root=>host===root||host.endsWith('.'+root));}catch{return false;}
}
/** Remove restricted observations from the new working projection. Original
 * immutable intake snapshots keep their old traces; no fact is re-attributed. */
export function removeRestrictedFinancialFacts(inputs:FunnelInput[]){
 if(!Array.isArray(inputs)||inputs.length!==72||new Set(inputs.map(s=>s.symbol)).size!==72||inputs.some(s=>!Array.isArray(s.facts)))throw Error('AI_FINANCIAL_REFRESH_SCOPE');
 const owned=structuredClone(inputs),removed:DailyAiFinancialRemoval[]=[];
 for(const s of owned)s.facts=s.facts.filter(f=>{
  if(!isRestrictedDailyAiFinancialSource(f.source))return true;
  removed.push({symbol:s.symbol,id:f.id,source:f.source,kind:f.kind,period:f.period,evidence_hash:f.evidence_hash,
   reason:'RESTRICTED_COMPANY_WEBSITE_FACT_REMOVED_WITHOUT_RELABEL'});return false;
 });
 return {inputs:owned,removed};
}
/** Safe failure result for a SOURCE adapter. It still removes restricted facts;
 * missing acquisitions never create EPS, timestamps, ratios or permissions. */
export function dailyAiFinancialRefreshUnavailable(inputs:FunnelInput[],observedAt:string):DailyAiFinancialRefreshResult{
 if(!validObservationTime(observedAt))throw Error('AI_FINANCIAL_REFRESH_CLOCK');
 const clean=removeRestrictedFinancialFacts(inputs),gapsBySymbol:Record<string,string[]>={};
 for(const s of clean.inputs)gapsBySymbol[s.symbol]=['FINANCIAL_REFRESH_UNAVAILABLE',...(clean.removed.some(r=>r.symbol===s.symbol)?['RESTRICTED_COMPANY_WEBSITE_FACTS_REMOVED_NOT_RELABELLED_OR_RELICENSED']:[])];
 return {...clean,cutoff:observedAt,additionalGaps:['FINANCIAL_REFRESH_UNAVAILABLE'],gapsBySymbol,receipts:[],
  proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:observedAt,responses:[],additions:[],removals:clean.removed,company_names:[]}};
}
async function fetchResponse(source:FinancialSource,fetcher:typeof fetch,signal:AbortSignal,clock:()=>string,began:string){
 const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let timer:ReturnType<typeof setTimeout>|undefined;
 const work=(async()=>{
  const response=await fetcher(source,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal:combined});
  if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw Error('AI_FINANCIAL_REFRESH_HTTP_OR_SIZE');
  const reader=response.body?.getReader();if(!reader)throw Error('AI_FINANCIAL_REFRESH_BODY');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){stopped(combined);const p=await reader.read();if(p.done)break;size+=p.value.byteLength;
    if(size>2000000)throw Error('AI_FINANCIAL_REFRESH_SIZE');chunks.push(p.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.byteLength;}
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);stopped(combined);const received_at=clock();
  if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began)||taipeiDay(received_at)!==taipeiDay(began))throw Error('AI_FINANCIAL_REFRESH_CLOCK');
  const rows:unknown=JSON.parse(text);
  if(!Array.isArray(rows)||rows.length>5000||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('AI_FINANCIAL_REFRESH_SCHEMA');
  const receipt:DailyAiFinancialResponse={source,state:'CAPTURED',received_at,source_sha256:await digest(text),source_bytes:size,response_text:text,error:null};
  return {receipt,rows:rows as Row[]};
 })();
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('AI_FINANCIAL_REFRESH_TIMEOUT'));},6000);})]);}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
function report(r:Row,received_at:string){
 const roc=String(field(r,'年度','Year')??''),quarter=String(r['季別']??''),exported=String(field(r,'出表日期','Date')??'');
 if(!/^\d{1,3}$/.test(roc)||Number(roc)<80||Number(roc)>300||!/[1-4]/.test(quarter)||quarter.length!==1||!/^\d{7}$/.test(exported))throw Error('AI_FINANCIAL_REFRESH_REPORT_LABEL');
 const year=Number(roc)+1911,q=Number(quarter),exportDate=String(Number(exported.slice(0,3))+1911)+'-'+exported.slice(3,5)+'-'+exported.slice(5,7);
 const end=new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10);
 if(!day(exportDate)||exportDate>taipeiDay(received_at)||end>taipeiDay(received_at))throw Error('AI_FINANCIAL_REFRESH_REPORT_FUTURE');
 return {roc,quarter,period:`${year}-Q${q}`,exported,rank:year*10+q,scope:`YEAR_${roc}_QUARTER_${quarter}_AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_EXPLICIT`};
}
function latest(rows:Row[],symbol:string,received_at:string){
 const matches=rows.filter(r=>String(field(r,'公司代號','SecuritiesCompanyCode')??'')===symbol).map(row=>({row,label:report(row,received_at)}));
 matches.sort((a,b)=>b.label.rank-a.label.rank||b.label.exported.localeCompare(a.label.exported));
 const selected=matches[0];if(!selected)return null;
 if(matches.filter(r=>r.label.rank===selected.label.rank&&r.label.exported===selected.label.exported).length!==1)throw Error('AI_FINANCIAL_REFRESH_AMBIGUOUS_ROW');
 return selected;
}
function valuationReport(row:Row,received_at:string,isTpex:boolean){
 const expected=isTpex?['Date','SecuritiesCompanyCode','CompanyName','PriceEarningRatio','DividendPerShare','YieldRatio','PriceBookRatio']:
  ['Date','Code','Name','ClosePrice','DividendYield','DividendYear','PEratio','PBratio','FiscalYearQuarter'];
 if(Object.keys(row).length!==expected.length||expected.some(k=>typeof row[k]!=='string'))throw Error('AI_FINANCIAL_REFRESH_VALUATION_SCHEMA');
 const raw=String(row.Date),fiscal=isTpex?null:String(row.FiscalYearQuarter),dividendYear=isTpex?null:String(row.DividendYear);
 if(isTpex?!/^\d{7}$/.test(raw)||Number(raw.slice(0,3))<80||Number(raw.slice(0,3))>300:!/^\d{8}$/.test(raw)||!/^\d{4}Q[1-4]$/.test(fiscal!)||!/^\d{3,4}$/.test(dividendYear!))throw Error('AI_FINANCIAL_REFRESH_VALUATION_LABEL');
 const period=isTpex?String(Number(raw.slice(0,3))+1911)+'-'+raw.slice(3,5)+'-'+raw.slice(5,7):raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8);
 const age=(Date.parse(taipeiDay(received_at)+'T00:00:00Z')-Date.parse(period+'T00:00:00Z'))/86400000;
 if(!day(period)||!Number.isInteger(age)||age<0||age>7)throw Error('AI_FINANCIAL_REFRESH_VALUATION_DATE');
 if(fiscal){const end=new Date(Date.UTC(Number(fiscal.slice(0,4)),Number(fiscal.slice(-1))*3,0)).toISOString().slice(0,10);
  if(Number(fiscal.slice(0,4))<1991||end>period)throw Error('AI_FINANCIAL_REFRESH_VALUATION_DATE');}
 return {period,raw,fiscal,dividendYear};
}
function latestValuation(rows:Row[],symbol:string,received_at:string,isTpex:boolean){
 const matches=rows.filter(r=>(isTpex?r.SecuritiesCompanyCode:r.Code)===symbol).map(row=>({row,label:valuationReport(row,received_at,isTpex)}));
 matches.sort((a,b)=>b.label.period.localeCompare(a.label.period));const selected=matches[0];if(!selected)return null;
 if(matches.filter(r=>r.label.period===selected.label.period).length!==1)throw Error('AI_FINANCIAL_REFRESH_AMBIGUOUS_ROW');
 return selected;
}
function optionalValuationNumber(raw:unknown){
 if(typeof raw==='string'&&['','-','--','N/A'].includes(raw.trim()))return null;
 const value=num(raw);if(value===null)throw Error('AI_FINANCIAL_REFRESH_VALUATION_NUMBER');return value;
}
const commonGaps=['PUBLICATION_TIME_UNKNOWN_NEW_FINANCIALS_ARE_RECEIPT_TIME_OBSERVATIONS','EPS_REPORTED_QUARTER_LABEL_SINGLE_VS_YTD_NOT_PROVEN_NO_TTM_OR_DIFFERENCING',
 'FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA','CAPEX_DEMAND_MOAT_VALUATION_REQUIRE_SEPARATE_EVIDENCE'];
/** Exact as-reported re-observation of five official open datasets. The source
 * export date is never used as publication time. Amount scale is not inferred;
 * only EPS in its reported unit and ratios of same-row monetary units are used. */
export async function refreshDailyAiFinancials(input:{inputs:FunnelInput[];businessDate:string;fetcher:typeof fetch;clock:()=>string;signal:AbortSignal}):Promise<DailyAiFinancialRefreshResult>{
 stopped(input.signal);const began=input.clock();
 if(!validObservationTime(began)||!day(input.businessDate)||taipeiDay(began)!==input.businessDate)throw Error('AI_FINANCIAL_REFRESH_SCOPE');
 const clean=removeRestrictedFinancialFacts(input.inputs),sources=Object.values(DAILY_AI_FINANCIAL_URLS),responses:DailyAiFinancialResponse[]=new Array(sources.length),tables=new Map<string,Row[]>();let cursor=0;
 const worker=async()=>{for(;;){const i=cursor++;if(i>=sources.length)return;stopped(input.signal);const source=sources[i];
  try{const r=await fetchResponse(source,input.fetcher,input.signal,input.clock,began);responses[i]=r.receipt;tables.set(source,r.rows);}
  catch(error){if(input.signal.aborted)throw Error('AI_FINANCIAL_REFRESH_ABORTED');if(error instanceof Error&&error.message==='AI_FINANCIAL_REFRESH_CLOCK')throw error;
   responses[i]={source,state:'UNAVAILABLE',received_at:null,source_sha256:null,source_bytes:null,response_text:null,
    error:error instanceof Error&&/^AI_FINANCIAL_REFRESH_[A-Z_]+$/.test(error.message)?error.message:'AI_FINANCIAL_REFRESH_UNAVAILABLE'};}
 }};
 await Promise.all([worker(),worker()]);stopped(input.signal);
 const additions:DailyAiFinancialRefreshProof['additions']=[],company_names:DailyAiFinancialRefreshProof['company_names']=[],removed=clean.removed.slice(),gapsBySymbol:Record<string,string[]>={};
 const make=async(stock:FunnelInput,row:Row,kind:'EPS_AS_REPORTED'|'FINANCIAL_AS_REPORTED'|'VALUATION_AS_REPORTED',values:ResearchFact['values'],receipt:DailyAiFinancialResponse)=>{
  const isValuation=kind==='VALUATION_AS_REPORTED',label=isValuation?valuationReport(row,receipt.received_at!,receipt.source===DAILY_AI_FINANCIAL_URLS.TPEX_VALUATION):report(row,receipt.received_at!),row_text=canonical(row),rowHash=await digest(row_text);
  const body={symbol:stock.symbol,kind,period:label.period,basis:'AS_REPORTED',values,source:receipt.source,published_at:null,
   first_seen_at:receipt.received_at,available_at:receipt.received_at,as_of:receipt.received_at,source_sha256:receipt.source_sha256,
   source_bytes:receipt.source_bytes,source_received_at:receipt.received_at,
   source_locator:isValuation?{company_code:stock.symbol,quote_date_as_reported:row.Date,financial_year_quarter_as_reported:row.FiscalYearQuarter??null,dividend_year_as_reported:row.DividendYear??null,row_sha256:rowHash}:
    {company_code:stock.symbol,reported_year_roc:field(row,'年度','Year'),reported_quarter:row['季別'],source_export_date_not_publication:field(row,'出表日期','Date'),row_sha256:rowHash},
   data_quality_status:isValuation?'OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_VALUATION':'OFFICIAL_OPEN_API_OBSERVED_AFTER_RECEIPT_PUBLICATION_UNKNOWN_AS_REPORTED_PERIOD_BASIS_NOT_INFERRED',actual_only:true,historical_knowledge:false,source_admitted:false,member_publication_approved:false};
  const body_text=canonical(body),hash=await digest(body_text),id=`official-open-api:${stock.symbol}:${kind}:${label.period}:${hash}`;
  const old=stock.facts.filter(f=>f.kind===kind&&f.period===label.period&&f.source===receipt.source&&f.id.startsWith('official-open-api:'));
  stock.facts=stock.facts.filter(f=>!old.includes(f));
  for(const f of old)removed.push({symbol:stock.symbol,id:f.id,source:f.source,kind:f.kind,period:f.period,evidence_hash:f.evidence_hash,
   reason:'OFFICIAL_API_SAME_REPORTED_PERIOD_SUPERSEDED_BY_NEW_RECEIPT'});
  stock.facts.push({id,...body,evidence_hash:hash});additions.push({symbol:stock.symbol,fact_id:id,body_text,row_text});
 };
 for(const stock of clean.inputs){
  const gaps=[...commonGaps];if(clean.removed.some(r=>r.symbol===stock.symbol))gaps.push('RESTRICTED_COMPANY_WEBSITE_FACTS_REMOVED_NOT_RELABELLED_OR_RELICENSED');
  let eps:{row:Row;label:ReturnType<typeof report>}|null=null,epsReceipt:DailyAiFinancialResponse|undefined;
  for(const source of [DAILY_AI_FINANCIAL_URLS.TWSE_EPS,DAILY_AI_FINANCIAL_URLS.TPEX_EPS]){
   const receipt=responses.find(r=>r.source===source);if(!receipt||receipt.state!=='CAPTURED')continue;
   try{const selected=latest(tables.get(source)!,stock.symbol,receipt.received_at!);if(selected){eps=selected;epsReceipt=receipt;break;}}
   catch{gaps.push('FINANCIAL_API_COMPANY_ROW_AMBIGUOUS_OR_INVALID');}
  }
  if(eps&&epsReceipt){const decimal=field(eps.row,'基本每股盈餘(元)','基本每股盈餘'),value=num(decimal);
   if(value!==null){await make(stock,eps.row,'EPS_AS_REPORTED',{value,reported_decimal:String(decimal),unit:'SOURCE_REPORTED_YUAN_PER_SHARE',measurement_basis:'BASIC_AS_REPORTED',
    reported_year_roc:eps.label.roc,reported_quarter:eps.label.quarter,period_scope:eps.label.scope,period_basis:'AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED',no_single_quarter_or_ttm_inference:'TRUE'},epsReceipt);
    if(epsReceipt.source===DAILY_AI_FINANCIAL_URLS.TPEX_EPS){gaps.push('TPEX_EPS_UNIT_YUAN_MAPPED_FROM_OFFICIAL_DATASET20757_COLUMN_NO_CURRENCY_REINFERENCE');
     const name=eps.row.CompanyName;if(stock.company===stock.symbol&&typeof name==='string'&&name===name.trim()&&name.length>0&&name.length<=100&&!/[\u0000-\u001f\u007f]/.test(name)&&name!==stock.symbol){
      company_names.push({symbol:stock.symbol,previous_company:stock.company,company:name,source:epsReceipt.source,row_text:canonical(eps.row)});stock.company=name;
     }
    }
   }else gaps.push('FINANCIAL_API_REPORTED_EPS_MISSING_NOT_INFERRED');
  }else gaps.push('NO_MATCHING_COMPANY_EPS_ROW_IN_ACTUAL_OPEN_API_RESPONSE');
  const incomeReceipt=responses.find(r=>r.source===DAILY_AI_FINANCIAL_URLS.TWSE_INCOME);
  if(incomeReceipt?.state==='CAPTURED'){
   try{const income=latest(tables.get(DAILY_AI_FINANCIAL_URLS.TWSE_INCOME)!,stock.symbol,incomeReceipt.received_at!);
    if(income){const r=income.row,revenue=num(r['營業收入']),gross=num(r['營業毛利（毛損）淨額']||r['營業毛利（毛損）']),op=num(r['營業利益（損失）']),net=num(r['本期淨利（淨損）']);
     const values:ResearchFact['values']={reported_year_roc:income.label.roc,reported_quarter:income.label.quarter,period_scope:income.label.scope,
      period_basis:'AS_REPORTED_SINGLE_VS_CUMULATIVE_NOT_INFERRED',unit:'PERCENT_RATIO_OF_SAME_REPORTED_MONETARY_UNIT',source_monetary_scale:'NOT_EXPLICIT_IN_API_ROW_NO_SCALED_AMOUNT_CLAIMS',
      calculation_basis:'GROSS_OPERATING_NET_PROFIT_DIVIDED_BY_REPORTED_REVENUE_TIMES_100',no_single_quarter_or_ttm_inference:'TRUE'};
     if(revenue!==null&&revenue!==0){for(const [key,n] of [['gross_margin_percent',gross],['operating_margin_percent',op],['net_margin_percent',net]] as const){
       if(n!==null){const ratio=Math.round(n/revenue*100*1000000)/1000000;if(Number.isFinite(ratio))values[key]=ratio;}}
     }else gaps.push('FINANCIAL_API_REPORTED_REVENUE_MISSING_OR_ZERO_NO_RATIO_INFERENCE');
     if(['gross_margin_percent','operating_margin_percent','net_margin_percent'].some(k=>Object.hasOwn(values,k)))await make(stock,r,'FINANCIAL_AS_REPORTED',values,incomeReceipt);
     else gaps.push('FINANCIAL_API_SAME_UNIT_RATIOS_UNAVAILABLE');
    }else gaps.push('NO_MATCHING_GENERAL_INDUSTRY_INCOME_ROW_IN_ACTUAL_OPEN_API_RESPONSE');
   }catch{gaps.push('FINANCIAL_API_COMPANY_ROW_AMBIGUOUS_OR_INVALID');}
  }else gaps.push('FINANCIAL_GENERAL_INDUSTRY_INCOME_SOURCE_UNAVAILABLE');
  let valuationAdded=false,valuationCaptured=false;
  for(const source of [DAILY_AI_FINANCIAL_URLS.TWSE_VALUATION,DAILY_AI_FINANCIAL_URLS.TPEX_VALUATION]){
   const receipt=responses.find(r=>r.source===source);if(receipt?.state!=='CAPTURED')continue;valuationCaptured=true;
   try{const isTpex=source===DAILY_AI_FINANCIAL_URLS.TPEX_VALUATION,selected=latestValuation(tables.get(source)!,stock.symbol,receipt.received_at!,isTpex);
    if(!selected)continue;const r=selected.row,close=isTpex?null:num(r.ClosePrice),pe=optionalValuationNumber(isTpex?r.PriceEarningRatio:r.PEratio),pb=optionalValuationNumber(isTpex?r.PriceBookRatio:r.PBratio),yieldPercent=optionalValuationNumber(isTpex?r.YieldRatio:r.DividendYield),dividend=isTpex?optionalValuationNumber(r.DividendPerShare):null;
    if((!isTpex&&(close===null||close<=0))||(pe!==null&&pe<=0)||(yieldPercent!==null&&yieldPercent<0)||(dividend!==null&&dividend<0))throw Error('AI_FINANCIAL_REFRESH_VALUATION_NUMBER');
    const values:ResearchFact['values']={quote_date:selected.label.period,close_price:close,pe_ratio:pe,pb_ratio:pb,dividend_yield_percent:yieldPercent,
     dividend_year_as_reported:selected.label.dividendYear,financial_year_quarter_as_reported:selected.label.fiscal,price_unit:'SOURCE_REPORTED_PRICE_PER_SHARE',ratio_unit:'TIMES',yield_unit:'PERCENT',
     calculation_basis:isTpex?'OFFICIAL_TPEX_PUBLISHED_RATIOS_NOT_RECONSTRUCTED':'OFFICIAL_TWSE_PUBLISHED_RATIOS_NOT_RECONSTRUCTED',earnings_reference_basis:isTpex?'TPEX_REPORTED_FOUR_QUARTER_EARNINGS':'TWSE_PREVIOUSLY_FILED_NEAR_FOUR_FULL_QUARTERS',
     yield_basis:isTpex?'TPEX_OFFICIAL_REPORTED_YIELD_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY':'TWSE_DECLARED_DISTRIBUTION_COMPONENTS_NOT_FORWARD_OR_CASH_ONLY',no_eps_or_forward_yield_inference:'TRUE'};
    if(isTpex){values.dividend_per_share_as_reported=dividend;values.unpublished_fields='CLOSE_PRICE_FINANCIAL_YEAR_QUARTER_DIVIDEND_YEAR_NOT_PUBLISHED_BY_THIS_API';gaps.push('TPEX_VALUATION_CLOSE_FISCAL_QUARTER_DIVIDEND_YEAR_NOT_PUBLISHED_BY_THIS_API');}
    await make(stock,r,'VALUATION_AS_REPORTED',values,receipt);valuationAdded=true;gaps.push('OFFICIAL_VALUATION_NOT_FOUR_QUARTER_EPS_OR_FORWARD_CASH_YIELD');break;
   }catch{gaps.push('FINANCIAL_API_VALUATION_COMPANY_ROW_AMBIGUOUS_OR_INVALID');}
  }
  if(!valuationAdded)gaps.push(valuationCaptured?'NO_MATCHING_OFFICIAL_VALUATION_ROW_IN_ACTUAL_OPEN_API_RESPONSE':'FINANCIAL_OFFICIAL_VALUATION_SOURCE_UNAVAILABLE');
  gapsBySymbol[stock.symbol]=[...new Set(gaps)];
 }
 stopped(input.signal);const cutoff=input.clock();
 if(!validObservationTime(cutoff)||Date.parse(cutoff)<Date.parse(began)||taipeiDay(cutoff)!==input.businessDate
  ||responses.some(r=>r.received_at&&Date.parse(r.received_at)>Date.parse(cutoff)))throw Error('AI_FINANCIAL_REFRESH_CLOCK');
 for(const s of clean.inputs)s.cutoff=cutoff;
 const additionalGaps=['FINANCIAL_OPEN_API_AS_REPORTED_NOT_SINGLE_QUARTER_OR_TTM',...(responses.some(r=>r.state==='UNAVAILABLE')?['FINANCIAL_OPEN_API_PARTIAL_ACQUISITION']:[])];
 return {inputs:clean.inputs,cutoff,additionalGaps,gapsBySymbol,receipts:responses.map(({response_text,...r})=>{void response_text;return r;}),removed,
  proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:cutoff,responses,additions,removals:removed,company_names}};
}
