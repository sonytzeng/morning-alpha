// SYNTHETIC_TEST_ONLY: these values test arithmetic/source binding, not approval.
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {marketSnapshotHash as hash} from '../../research/taiwan-market-universe.mjs';
import {TPEX_ACTION_SOURCES,taiwanActionUrl,buildTaiwanMarketActionCoverage} from '../../research/taiwan-market-actions.mjs';
import {annualFinancialInputs} from '../../research/taiwan-market-financial-inputs.mjs';
import {calculateTaiwanLongPeerReference} from '../../research/taiwan-market-long-price.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
export const BVPS_TEST_CUTOFF='2026-11-11T11:00:00Z';
export const BVPS_TEST_RECEIVED='2026-11-11T10:00:00Z';
export function resealBvpsRecord(row){delete row.record_hash;row.record_hash=hash(row);return row;}
function capture(source_id,source_url,symbol,tag){
 const c={source_id,source_url,source_sha256:sha('SYNTHETIC_BYTES:'+source_id),source_bytes:1000,
  received_at:BVPS_TEST_RECEIVED,row_index:Number(symbol)-1000,row_path:[Number(symbol)-1000],symbol_field:'SecuritiesCompanyCode',
  source_row_hash:sha('SYNTHETIC_ROW:'+source_id+':'+symbol+':'+tag)};
 return {...c,capture_id:hash({source_id,url:source_url,source_sha256:c.source_sha256,received_at:c.received_at})};
}
export function bvpsFinancialRecord(symbol,period,family,fields){
 const c=capture('MOPS_'+family+'_TPEX_'+period+'_CSV_20261111_123456',
  'https://mopsov.twse.com.tw/server-java/t105sb02',symbol,hash(fields));
 Object.assign(c,{row_index:Number(symbol)-999,row_path:[Number(symbol)-999],symbol_field:'3',
  parent_html_sha256:sha('SYNTHETIC_PARENT:'+period+family),parent_html_record_hash:sha('SYNTHETIC_PARENT_ROW:'+period+family+symbol),
  decoded_text_sha256:sha('SYNTHETIC_DECODED:'+period+family),encoding:'CP950'});
 const row={security_id:'TPEX:'+symbol,market:'TPEX',symbol,period,family,fields,
  field_units:Object.fromEntries(Object.keys(fields).map(k=>[k,k==='每股參考淨值'?'PER_SHARE_UNIT_NOT_EXPLICIT':'TWD_THOUSANDS'])),
  period_identity_basis:'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST',source_cells_matched_parent_html:true,
  amount_unit:'TWD_THOUSANDS',amount_unit_basis:'MATCHED_PARENT_HTML_EXPLICIT_UNIT',source_capture:c,source_url:c.source_url,
  available_at:BVPS_TEST_RECEIVED,first_seen_at:BVPS_TEST_RECEIVED,
  period_basis:family==='BALANCE'?'POINT_IN_TIME_AS_REPORTED':'YTD_AS_REPORTED',
  period_scope:family==='BALANCE'?'POINT_IN_TIME':period.endsWith('Q4')?'FULL_FISCAL_YEAR_AS_REPORTED':'CUMULATIVE_THROUGH_Q'+period.at(-1),
  period_definition_source:{url:'https://mopsfin.twse.com.tw/'},fixture_provenance:'SYNTHETIC_TEST_ONLY'};
 return resealBvpsRecord(row);
}
export function bvpsExRow({symbol='1000',date='115/08/20',cash='1.50',stock='0',rights='0'}={}){
 const hasRights=Number(stock)>0||Number(rights)>0,label=Number(cash)>0?(hasRights?'除權息':'除息'):'除權';
 return [date,symbol,'Synthetic','100','98.5','0','1.5','1.5',label,'108','90','98.5','98.5',cash,stock,'0','0','0','0',rights,rights];
}
export function buildBvpsActions(f,{from='2026-06-30',through='2026-11-11',rows={},omit=[]}={}){
 const companies=f.securities.map(s=>({...s.company})),body={schema:'TAIWAN_MARKET_UNIVERSE_V1',coverage_complete:true,total:companies.length,companies};
 const universe={...body,universe_hash:hash(body)};
 const captures=Object.entries(TPEX_ACTION_SOURCES).filter(([id])=>!omit.includes(id)).map(([source_id,spec])=>{
  const data=rows[source_id]??[],url=taiwanActionUrl(source_id,from,through);
  const payload={date:from.replaceAll('-','')+'~'+through.replaceAll('-',''),stat:'ok',tables:[{title:'',fields:[...spec.fields],totalCount:data.length,data,summary:[]}]};
  const bytes=Buffer.from(JSON.stringify(payload));
  return {bytes,receipt:{schema:'TAIWAN_HISTORY_SOURCE_RECEIPT_V1',source_id,market:'TPEX',family:spec.family,url,task_id:sha(url),
   date:null,from,through,state:'CAPTURED',status:200,started_at:BVPS_TEST_RECEIVED,received_at:BVPS_TEST_RECEIVED,
   bytes:bytes.length,sha256:sha(bytes),raw_bytes_complete:true,content_encoding:'identity',historical_knowledge:false,fixture_provenance:'SYNTHETIC_TEST_ONLY'}};
 });
 return buildTaiwanMarketActionCoverage({universe,captures,from,through,cutoff:f.cutoff});
}
export function refreshBvpsQuality(f){
 const annual_metrics=new Map(f.securities.map(s=>[s.security_id,annualFinancialInputs(f.financial_rows.filter(r=>r.security_id===s.security_id),f.cutoff).metrics]));
 f.annual_quality=new Map(f.securities.map(s=>[s.security_id,calculateTaiwanLongPeerReference({security_id:s.security_id,securities:[s],annual_metrics,cutoff:f.cutoff}).issuer_quality]));
 return f;
}
export function taiwanMarketBvpsFixture(multiples=[1,2,3,4,5]){
 const f={security_id:'TPEX:1000',horizon:'MEDIUM',cutoff:BVPS_TEST_CUTOFF,expected_quote_date:'2026-11-11',securities:[],financial_rows:[]};
 for(const [index,pb]of [100,...multiples].entries()){
  const symbol=String(1000+index),security_id='TPEX:'+symbol;
  f.securities.push({security_id,company:{security_id,market:'TPEX',symbol,company:'SYNTHETIC '+symbol,industry_code:'24',instrument_kind:'ORDINARY_COMPANY_EQUITY'},
   observations:[{family:'PRICE',kind:'DAILY_OHLCVA',market:'TPEX',symbol,date:'2026-11-11',currency:'TWD',close:pb*10,valid_trade:true,
    available_at:BVPS_TEST_RECEIVED,source_capture:capture('tpex_prices','https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',symbol,pb)}]});
  f.financial_rows.push(bvpsFinancialRecord(symbol,'2026Q2','BALANCE',{'資產總計':'1000','負債總計':'500','權益總計':'500','每股參考淨值':'10.00'}));
  for(const year of [2023,2024,2025]){
   f.financial_rows.push(bvpsFinancialRecord(symbol,year+'Q4','INCOME',{'本期淨利（淨損）':'100','淨利（淨損）歸屬於母公司業主':'80'}));
   f.financial_rows.push(bvpsFinancialRecord(symbol,year+'Q4','BALANCE',{'資產總計':'1000','權益總計':'500'}));
   f.financial_rows.push(bvpsFinancialRecord(symbol,year+'Q4','CASHFLOW',{'營業活動之淨現金流入（流出）':'120',
    '期初現金及約當現金餘額':String(100+(year-2023)*50),'本期現金及約當現金增加（減少）數':'50','期末現金及約當現金餘額':String(150+(year-2023)*50)}));
  }
 }
 f.corporate_actions=buildBvpsActions(f);return refreshBvpsQuality(f);
}
