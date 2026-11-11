/** Supplement delayed OpenAPI snapshots with explicitly dated official reports.
 * Preserve the report's session scope; these quotes do not replace historical bars. */
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {TextDecoder} from 'node:util';
import {marketSnapshotHash,officialDate} from './taiwan-market-universe.mjs';
import {officialNumber,marketCaptureId} from './taiwan-market-facts.mjs';
const fail=code=>{throw Error('TAIWAN_POSTCLOSE_'+code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const latest=(security,family)=>security.observations.filter(o=>o.family===family&&!o.invalidated).sort((a,b)=>(b.date??'').localeCompare(a.date??''))[0];
function factsBody(facts,cutoff){const {facts_hash,...body}=facts??{};
 if(facts?.schema!=='TAIWAN_MARKET_FACT_SET_V1'||marketSnapshotHash(body)!==facts_hash||!Number.isFinite(Date.parse(cutoff))||Date.parse(facts.cutoff)>Date.parse(cutoff))fail('FACTS');
 return {...body,cutoff,securities:globalThis.structuredClone(facts.securities),datasets:globalThis.structuredClone(facts.datasets)};
}
function finish(body){return {...body,facts_hash:marketSnapshotHash(body)};}
export function addTaiwanLatestHistoryQuotes({facts,history,cutoff}){
 const body=factsBody(facts,cutoff);if(!history)return facts;
 if(!Array.isArray(history.stocks))fail('HISTORY');
 const byId=new Map(body.securities.map(s=>[s.security_id,s])),datasets=new Map(),seen=new Set();
 for(const stock of history.stocks){const {history_hash,...rest}=stock;
  if(stock.schema!=='TAIWAN_SECURITY_HISTORY_V1'||history_hash!==marketSnapshotHash(rest)||seen.has(stock.security_id))fail('HISTORY_BINDING');seen.add(stock.security_id);
  const security=byId.get(stock.security_id);if(!security)continue;
  const bar=[...stock.bars].sort((a,b)=>b.date.localeCompare(a.date))[0];if(!bar||bar.date<=(latest(security,'PRICE')?.date??''))continue;
  if(bar.market!==security.company.market||bar.symbol!==security.company.symbol||!['TWSE','TPEX'].includes(bar.market)
   ||officialDate(bar.date)!==bar.date||bar.price_basis!=='RAW_UNADJUSTED'
   ||![bar.open,bar.high,bar.low,bar.close,bar.volume,bar.amount].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)
   ||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)
   ||Date.parse(bar.available_at)>Date.parse(cutoff)||Date.parse(bar.available_at)<Date.parse(bar.date+'T13:30:00+08:00')
   ||!['INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES','TWSE_REPORTED_EXCLUDES_BLOCK_TRADES','OFFICIAL_STOCK_DAY'].includes(bar.session_scope))fail('HISTORY_QUOTE');
  const c=bar.source_capture;
  if(!c||c.received_at!==bar.available_at||c.capture_id!==marketSnapshotHash({source_id:c.source_id,url:c.source_url,source_sha256:c.source_sha256,received_at:c.received_at}))fail('HISTORY_SOURCE');
  security.observations.push({schema:'TAIWAN_MARKET_OBSERVATION_V1',kind:'DAILY_OHLCVA',family:'PRICE',symbol:bar.symbol,market:bar.market,
   source_as_of:bar.date,date:bar.date,available_at:bar.available_at,source_capture:c,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,amount:bar.amount,
   currency:'TWD',volume_unit:'SHARES',amount_unit:'TWD',price_basis:bar.price_basis,session_scope:bar.session_scope,
   all_trades_session_complete:bar.all_trades_session_complete,valid_trade:true,execution_price_available:false,
   historical_bar_scope_unchanged:true});
  const d=datasets.get(c.capture_id)??{source_id:c.source_id,market:bar.market,family:'PRICE',capture_id:c.capture_id,source_sha256:c.source_sha256,
   source_bytes:c.source_bytes,received_at:c.received_at,rows:null,normalized_quote_rows_added:0,matched:0,not_in_roster:0,placeholder_rows:0,rejected:[],source_dates:[bar.date],session_scope:bar.session_scope};
  d.matched++;d.normalized_quote_rows_added++;datasets.set(c.capture_id,d);
 }
 body.datasets.push(...datasets.values());body.captured_dataset_count+=datasets.size;body.expected_dataset_count+=datasets.size;return finish(body);
}
export function addTaiwanTwseDatedValuation({facts,receipt,bytes,cutoff}){
 const body=factsBody(facts,cutoff),match=/^https:\/\/www\.twse\.com\.tw\/rwd\/zh\/afterTrading\/BWIBBU_d\?date=(\d{8})&selectType=ALL&response=json$/.exec(receipt?.url??'');
 if(!match||receipt.schema!=='TAIWAN_PUBLIC_SOURCE_RECEIPT_V1'||receipt.format!=='json'||receipt.state!=='CAPTURED'||receipt.status!==200
  ||receipt.source_id!=='TWSE_VALUATION_'+match[1]||!Buffer.isBuffer(bytes)||bytes.length!==receipt.bytes||bytes.length>16000000||sha(bytes)!==receipt.sha256
  ||!Number.isFinite(Date.parse(receipt.received_at))||!Number.isFinite(Date.parse(receipt.started_at))||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)||Date.parse(receipt.received_at)>Date.parse(cutoff))fail('VALUATION_CAPTURE');
 const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),date=officialDate(match[1]);
 const fields=['證券代號','證券名稱','收盤價','殖利率(%)','股利年度','本益比','股價淨值比','財報年/季'];
 if(payload.stat!=='OK'||payload.date!==match[1]||marketSnapshotHash(payload.fields)!==marketSnapshotHash(fields)
  ||!Array.isArray(payload.data)||payload.data.length!==receipt.row_count||payload.data.length>10000
  ||Date.parse(date+'T13:30:00+08:00')>Date.parse(receipt.received_at))fail('VALUATION_REPORT');
 const byId=new Map(body.securities.map(s=>[s.security_id,s])),seen=new Set(),capture_id=marketCaptureId(receipt);let matched=0,missing=0;
 for(let i=0;i<payload.data.length;i++){const row=payload.data[i];if(!Array.isArray(row)||row.length!==fields.length||!/^\d{4,6}$/.test(row[0])||seen.has(row[0]))fail('VALUATION_ROW');seen.add(row[0]);
  const security=byId.get('TWSE:'+row[0]);if(!security){missing++;continue;}if(date<=(latest(security,'VALUATION')?.date??''))continue;
  const q=/^(\d{3,4})\/([1-4])$/.exec(String(row[7])),financial_period=q?String(Number(q[1])+(q[1].length===3?1911:0))+'Q'+q[2]:null;
  security.observations.push({schema:'TAIWAN_MARKET_OBSERVATION_V1',kind:'OFFICIAL_VALUATION_AS_REPORTED',family:'VALUATION',symbol:row[0],market:'TWSE',
   date,source_as_of:date,available_at:receipt.received_at,close:officialNumber(row[2]),pe:officialNumber(row[5]),pb:officialNumber(row[6]),
   dividend_yield_percent:officialNumber(row[3]),dividend_year_as_reported:String(row[4]),financial_period,eps_inferred_from_price:null,
   financial_period_not_imputed:!financial_period,source_capture:{capture_id,source_id:receipt.source_id,source_url:receipt.url,source_sha256:receipt.sha256,
    source_bytes:receipt.bytes,received_at:receipt.received_at,row_index:i,row_path:['data',i],symbol_field:'0',source_row_hash:marketSnapshotHash(row)}});matched++;
 }
 if(matched){body.datasets.push({source_id:receipt.source_id,market:'TWSE',family:'VALUATION',capture_id,source_sha256:receipt.sha256,source_bytes:receipt.bytes,
  received_at:receipt.received_at,rows:payload.data.length,matched,not_in_roster:missing,placeholder_rows:0,rejected:[],source_dates:[date]});body.captured_dataset_count++;body.expected_dataset_count++;}
 return finish(body);
}
