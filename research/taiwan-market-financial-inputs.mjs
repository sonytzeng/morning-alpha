/** Verified MOPS CSV documents are loaded as records, never mistaken for a
 * manifest's numeric record count. Original captures and first-seen times stay intact. */
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {marketSnapshotHash} from './taiwan-market-universe.mjs';
import {officialNumber} from './taiwan-market-facts.mjs';

const fail=code=>{throw Error('TAIWAN_FINANCIAL_INPUT_'+code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function financialValue(row,names){
 const fields=row?.fields??{};
 for(const key of names){const original=Object.keys(fields).find(k=>k.replace(/\s/g,'')===key.replace(/\s/g,''));
  if(original!==undefined)return officialNumber(fields[original]);}
 return null;
}
export function verifiedFinancialRecord(row){
 if(!object(row)||!object(row.source_capture)||!object(row.fields)||!object(row.field_units)
  ||row.period_identity_basis!=='CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST'
  ||row.source_cells_matched_parent_html!==true||row.amount_unit!=='TWD_THOUSANDS'
  ||row.amount_unit_basis!=='MATCHED_PARENT_HTML_EXPLICIT_UNIT'||!/^\d{4}Q[1-4]$/.test(row.period??''))return false;
 const {record_hash,...body}=row;
 if(record_hash!==marketSnapshotHash(body))fail('RECORD_HASH');
 const c=row.source_capture;
 if(row.security_id!==row.market+':'+row.symbol||c.received_at!==row.available_at||row.first_seen_at!==row.available_at
  ||row.source_url!==c.source_url||c.source_url!=='https://mopsov.twse.com.tw/server-java/t105sb02'
  ||c.capture_id!==marketSnapshotHash({source_id:c.source_id,url:c.source_url,source_sha256:c.source_sha256,received_at:c.received_at})
  ||!Number.isSafeInteger(c.row_index)||c.row_index<1||c.row_path?.length!==1||c.row_path[0]!==c.row_index||c.symbol_field!=='3'
  ||!Number.isFinite(Date.parse(row.available_at))||!Number.isSafeInteger(c.source_bytes)||c.source_bytes<1
  ||![c.source_sha256,c.source_row_hash,c.parent_html_sha256,c.parent_html_record_hash,c.decoded_text_sha256].every(h=>/^[a-f0-9]{64}$/.test(h??'')))fail('SOURCE_BINDING');
 const isBalance=row.family==='BALANCE';
 if(!['INCOME','BALANCE','CASHFLOW'].includes(row.family)
  ||row.period_basis!==(isBalance?'POINT_IN_TIME_AS_REPORTED':'YTD_AS_REPORTED'))return false;
 if(isBalance)return row.period_scope==='POINT_IN_TIME';
 return row.period_scope===(row.period.endsWith('Q4')?'FULL_FISCAL_YEAR_AS_REPORTED':'CUMULATIVE_THROUGH_Q'+row.period.at(-1))
  &&row.period_definition_source?.url==='https://mopsfin.twse.com.tw/';
}
const fieldNames={
 revenue:['營業收入'],net_profit:['本期淨利（淨損）','本期淨利(淨損)','本期稅後淨利（淨損）'],
 parent_net_profit:['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主'],
 equity:['權益總計','權益總額'],assets:['資產總計','資產總額'],liabilities:['負債總計','負債總額'],
 operating_cashflow:['營業活動之淨現金流入（流出）','營業活動之淨現金流入(流出)','營業活動之淨現金流量'],
 basic_eps:['基本每股盈餘（元）','基本每股盈餘(元)','基本每股盈餘'],
 cash_opening:['期初現金及約當現金餘額'],cash_closing:['期末現金及約當現金餘額'],
 cash_change:['本期現金及約當現金增加（減少）數','本期現金及約當現金增加(減少)數'],
};
export function financialValues(row){return Object.fromEntries(Object.entries(fieldNames).map(([key,names])=>[key,financialValue(row,names)]));}
export function compactFinancialFields(row){
 const needed=new Set([...Object.values(fieldNames).flat(),'每股參考淨值'].map(k=>k.replace(/\s/g,'')));
 const fields=Object.fromEntries(Object.entries(row.fields).filter(([k])=>needed.has(k.replace(/\s/g,''))));
 return {fields,field_units:Object.fromEntries(Object.keys(fields).map(k=>[k,row.field_units?.[k]??null]))};
}
export function annualFinancialInputs(records,cutoff){
 const year=Number(new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,4));
 const years=[year-3,year-2,year-1];
 const pick=(family,y)=>records.filter(r=>r.family===family&&r.period===y+'Q4'&&verifiedFinancialRecord(r))
  .sort((a,b)=>Date.parse(b.available_at)-Date.parse(a.available_at))[0]??null;
 const annuals=years.map(year=>({year,income:pick('INCOME',year),balance:pick('BALANCE',year),cashflow:pick('CASHFLOW',year)}));
 const metrics=annuals.map((a,index)=>{
  const i=financialValues(a.income),b=financialValues(a.balance),c=financialValues(a.cashflow),complete=!!(a.income&&a.balance&&a.cashflow);
  const previous=index?financialValues(annuals[index-1].cashflow):null;
  const matched=(left,right)=>left===null||right===null?null:Math.abs(left-right)<=2;
  const cashflow_reconciliation={
   within_year:matched(c.cash_opening===null||c.cash_change===null?null:c.cash_opening+c.cash_change,c.cash_closing),
   opening_matches_previous_closing:matched(c.cash_opening,previous?.cash_closing??null),
   tolerance_twd_thousands:2,
   interpretation:'MISMATCH_REQUIRES_RESTATEMENT_OR_RECLASSIFICATION_REVIEW_NOT_FRAUD_INFERENCE'};
  return {year:a.year,revenue:i.revenue,parent_net_profit:i.parent_net_profit,net_profit:i.net_profit,
   equity:b.equity,assets:b.assets,liabilities:b.liabilities,operating_cashflow:c.operating_cashflow,basic_eps:i.basic_eps,
   cashflow_reconciliation,period_verified:complete,unit_verified:complete,source_captures:{income:a.income?.source_capture??null,balance:a.balance?.source_capture??null,cashflow:a.cashflow?.source_capture??null}};
 });
 return {years,annuals,metrics};
}
export function latestFinancialBridge(records,family){
 const record=records.filter(r=>r.family===family&&verifiedFinancialRecord(r)).sort((a,b)=>b.period.localeCompare(a.period)
  ||Date.parse(b.available_at)-Date.parse(a.available_at))[0];
 if(!record)return null;
 const v=financialValues(record),balanceVerified=v.assets!==null&&v.liabilities!==null&&v.equity!==null
  &&Math.abs(v.assets-v.liabilities-v.equity)<=Math.max(2,Math.abs(v.assets)*0.000001);
 return {...v,eps_basic:v.basic_eps,period:record.period,available_at:record.available_at,source_capture:record.source_capture,
  balance_identity_verified:balanceVerified,source_record:record};
}
async function readJson(file){const size=(await stat(file)).size;if(size>256000000)fail('FILE_SIZE');return JSON.parse(await readFile(file,'utf8'));}
export async function loadTaiwanFinancialHistory(file){
 const manifest=await readJson(file);
 if(manifest.schema==='TAIWAN_FINANCIAL_INPUT_SET_V1'){
  const {input_hash,...body}=manifest;if(input_hash!==marketSnapshotHash(body)||!Array.isArray(manifest.records))fail('INPUT_HASH');
  for(const row of manifest.records)if(!verifiedFinancialRecord(row))fail('RECORD_UNVERIFIED');return manifest;
 }
 const {manifest_hash,...body}=manifest;
 if(manifest.schema!=='TAIWAN_FINANCIAL_CSV_MANIFEST_V1'||manifest_hash!==marketSnapshotHash(body)||!Array.isArray(manifest.documents))fail('MANIFEST');
 const records=[],seen=new Set();
 for(const entry of manifest.documents){const doc=await readJson(resolve(dirname(file),entry.file));const {financial_history_hash,...data}=doc;
  if(financial_history_hash!==entry.financial_history_hash||financial_history_hash!==marketSnapshotHash(data)
   ||doc.all_cells_matched_parent!==true||!Array.isArray(doc.records)||doc.company_count!==doc.records.length||doc.source_id!==entry.source_id)fail('DOCUMENT_BINDING');
  for(const row of doc.records){if(!verifiedFinancialRecord(row)||seen.has(row.record_hash))fail('RECORD_UNVERIFIED_OR_DUPLICATE');seen.add(row.record_hash);records.push(row);}
 }
 if(records.length!==manifest.records)fail('RECORD_COUNT');
 const result={schema:'TAIWAN_FINANCIAL_INPUT_SET_V1',source_manifest_hash:manifest_hash,records,methodology_approved:false};
 return {...result,input_hash:marketSnapshotHash(result)};
}
export async function loadTaiwanResearchHistory(file){
 const input=await readJson(file);if(!Array.isArray(input.stocks)||input.stocks.length>10000)fail('HISTORY_MANIFEST');
 if(input.schema!=='TAIWAN_HISTORY_CHECKPOINT_V1')return input;
 const stocks=[],seen=new Set();
 for(const entry of input.stocks){const stock=entry.file?await readJson(resolve(dirname(file),entry.file)):entry;
  const {history_hash,...body}=stock;
  if(stock.schema!=='TAIWAN_SECURITY_HISTORY_V1'||stock.security_id!==entry.security_id||history_hash!==entry.history_hash
   ||history_hash!==marketSnapshotHash(body)||seen.has(stock.security_id))fail('HISTORY_BINDING');seen.add(stock.security_id);stocks.push(stock);
 }
 return {schema:'TAIWAN_RESEARCH_HISTORY_INPUT_V1',source_universe_hash:input.universe_hash,stocks};
}
