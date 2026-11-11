/** Whole-market official daily history. Raw HTTP entity bytes and array-row
 * positions remain bound; current membership is never historical membership. */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseTwseDaily,parseTpexDaily,officialDate,officialNumber} from './entry-official-history.ts';
import {marketSnapshotHash} from './taiwan-market-universe.mjs';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';

const fail=code=>{throw Error('TAIWAN_HISTORY_'+code);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const SOURCES={twse_daily:{market:'TWSE',base:'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX'},
 tpex_daily:{market:'TPEX',base:'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes'}};
export function taiwanHistoryUrl(source_id,date){
 const spec=SOURCES[source_id];if(!spec||officialDate(date)!==date)fail('REQUEST_IDENTITY');
 return spec.base+'?date='+(spec.market==='TWSE'?date.replaceAll('-',''):date.replaceAll('-','/'))+(spec.market==='TWSE'?'&type=ALLBUT0999':'')+'&response=json';
}
function verifyUniverse(universe){const {universe_hash,...body}=universe??{};
 if(universe?.schema!=='TAIWAN_MARKET_UNIVERSE_V1'||marketSnapshotHash(body)!==universe_hash||!universe.coverage_complete
  ||!Array.isArray(universe.companies)||universe.companies.length!==universe.total)fail('UNIVERSE');
}
export function decodeTaiwanHistoryCapture({receipt,bytes}){
 const spec=SOURCES[receipt?.source_id];
 if(!spec||receipt.schema!=='TAIWAN_HISTORY_SOURCE_RECEIPT_V1'||receipt.state!=='CAPTURED'||receipt.status!==200
  ||receipt.market!==spec.market||receipt.family!=='PRICE'||receipt.url!==taiwanHistoryUrl(receipt.source_id,receipt.date)
  ||!time(receipt.started_at)||!time(receipt.received_at)||Date.parse(receipt.started_at)>Date.parse(receipt.received_at)
  ||Date.parse(receipt.received_at)<Date.parse(receipt.date+'T17:05:00+08:00')||receipt.raw_bytes_complete!==true
  ||!Buffer.isBuffer(bytes)||bytes.length!==receipt.bytes||bytes.length>16_000_000||sha(bytes)!==receipt.sha256)fail('SOURCE_RECEIPT');
 const encoding=receipt.content_encoding??'';if(!['','identity','gzip'].includes(encoding))fail('CONTENT_ENCODING');
 let entity_bytes,payload;try{entity_bytes=encoding==='gzip'?gunzipSync(bytes,{maxOutputLength:16_000_000}):bytes;
  payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(entity_bytes).replace(/^\uFEFF/,''));}catch{fail('SOURCE_PARSE');}
 if(!object(payload)||!Array.isArray(payload.tables))fail('SOURCE_OBJECT');
 const source_id=spec.market+'_DAILY_'+receipt.date.replaceAll('-',''),source_sha256=sha(entity_bytes);
 const public_receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id,url:receipt.url,format:'json',state:'CAPTURED',status:200,
  started_at:receipt.started_at,received_at:receipt.received_at,bytes:entity_bytes.length,sha256:source_sha256,row_count:null,
  historical_knowledge:false,entity_encoding:'UTF8_JSON_WITHOUT_RESERIALIZATION',
  wire_capture:{source_id:receipt.source_id,source_sha256:receipt.sha256,source_bytes:receipt.bytes,content_encoding:encoding||'identity'}};
 return {payload,entity_bytes,public_receipt};
}
function parseTwsePublishedScope(payload,date,symbols,at){
 const tables=payload.tables.filter(t=>Array.isArray(t.fields)&&t.fields[0]==='證券代號'&&t.fields.includes('收盤價'));
 const partialNote='本統計資訊含一般、零股、盤後定價，不含鉅額、拍賣、標購。';
 if(tables.length!==1||!tables[0].notes?.includes(partialNote))return parseTwseDaily(payload,date,symbols,at);
 const table=tables[0],expected=['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價'];
 const title=`${Number(date.slice(0,4))-1911}年${date.slice(5,7)}月${date.slice(8)}日 每日收盤行情`;
 if(String(payload.stat).toLowerCase()!=='ok'||officialDate(payload.date)!==date||!String(table.title).startsWith(title)
  ||expected.some((f,i)=>table.fields[i]!==f)||!Array.isArray(table.data)||table.data.some(r=>!Array.isArray(r)))fail('PARTIAL_SESSION_SCHEMA');
 const daily=symbols.map(symbol=>{const matches=table.data.filter(r=>r[0]===symbol);
  if(matches.length!==1)return {symbol,bar:null,reason:matches.length?'DUPLICATE_SYMBOL':'SYMBOL_MISSING'};
  const r=matches[0],values=[r[5],r[6],r[7],r[8],r[2],r[4]].map(officialNumber);
  if(values.some(v=>v===null||v<=0))return {symbol,bar:null,reason:'NO_VALID_TRADING_OHLCV_AMOUNT'};
  const [open,high,low,close,volume,amount]=values;
  if(high<Math.max(open,close)||low>Math.min(open,close)||!Number.isSafeInteger(volume)||!Number.isSafeInteger(amount))return {symbol,bar:null,reason:'OHLCV_AMOUNT_INVALID'};
  return {symbol,bar:{date,open,high,low,close,volume,amount,available_at:at,source_ref:taiwanHistoryUrl('twse_daily',date)},reason:null};});
 return {daily,volume_amount_scope:'TWSE_REPORTED_EXCLUDES_BLOCK_TRADES',exact_volume_amount:true};
}
export function normalizeTaiwanHistoryCapture({receipt,bytes,universe}){
 verifyUniverse(universe);const {payload,public_receipt}=decodeTaiwanHistoryCapture({receipt,bytes}),market=receipt.market;
 const securities=universe.companies.filter(c=>c.market===market),symbols=securities.map(c=>c.symbol);
 const parsed=(market==='TWSE'?parseTwsePublishedScope:parseTpexDaily)(payload,receipt.date,symbols,receipt.received_at);
 const locations=new Map();
 for(const [table_index,table]of payload.tables.entries()){
  if(!Array.isArray(table.fields)||!Array.isArray(table.data)||!['證券代號','代號'].includes(table.fields[0]))continue;
  for(const [row_index,row]of table.data.entries()){if(!Array.isArray(row))fail('ROW_ARRAY');const symbol=String(row[0]);
   if(!symbols.includes(symbol))continue;if(locations.has(symbol))fail('DUPLICATE_SYMBOL');locations.set(symbol,{table_index,row_index,row});}
 }
 const capture_id=marketSnapshotHash({source_id:public_receipt.source_id,url:receipt.url,source_sha256:public_receipt.sha256,received_at:receipt.received_at});
 const capture={capture_id,source_id:public_receipt.source_id,source_url:receipt.url,source_sha256:public_receipt.sha256,source_bytes:public_receipt.bytes,received_at:receipt.received_at};
 const rowCapture=symbol=>{const p=locations.get(symbol);return p?{...capture,row_index:p.row_index,source_row_hash:marketSnapshotHash(p.row),
  row_path:['tables',p.table_index,'data',p.row_index],symbol_field:'0'}:null;};
 const observations=[],missing=[];
 for(const row of parsed.daily){const security_id=market+':'+row.symbol;
  if(!row.bar){missing.push({security_id,symbol:row.symbol,date:receipt.date,reason:row.reason,source_capture:rowCapture(row.symbol)});continue;}
  const {source_ref,available_at,...values}=row.bar;void source_ref;void available_at;
  observations.push({security_id,symbol:row.symbol,market,...values,currency:'TWD',price_basis:'RAW_UNADJUSTED',session_scope:parsed.volume_amount_scope,
   all_trades_session_complete:parsed.volume_amount_scope!=='TWSE_REPORTED_EXCLUDES_BLOCK_TRADES',
   source_ref:receipt.url,available_at:receipt.received_at,first_seen_at:receipt.received_at,published_at:null,
   source_capture:rowCapture(row.symbol)});
 }
 const body={schema:'TAIWAN_MARKET_HISTORY_DAY_V1',market,date:receipt.date,universe_hash:universe.universe_hash,
  requested_securities:securities.length,observations,missing,public_receipt,capture,
  source_capture_scope:'EXACT_HTTP_ENTITY_BYTES_AND_ORIGINAL_NESTED_ARRAY_ROW',
  historical_membership_established:false,acquisition_provenance:'POSTHOC_OFFICIAL_DOWNLOAD_NO_BACKDATED_AVAILABILITY',
  strategy_calibrated:false,member_published:false};
 return {...body,history_day_hash:marketSnapshotHash(body)};
}
function verifyDay(day,universe){const {history_day_hash,...body}=day??{};
 if(day?.schema!=='TAIWAN_MARKET_HISTORY_DAY_V1'||marketSnapshotHash(body)!==history_day_hash||day.universe_hash!==universe.universe_hash
  ||day.observations.length+day.missing.length!==day.requested_securities)fail('DAY_BINDING');
}
export function assembleTaiwanSecurityHistory({universe,days,expected_dates,formed_at}){
 verifyUniverse(universe);
 if(!time(formed_at)||!Array.isArray(days)||!Array.isArray(expected_dates)||expected_dates.length<1||expected_dates.length>300
  ||new Set(expected_dates).size!==expected_dates.length||expected_dates.some(d=>officialDate(d)!==d))fail('ASSEMBLY');
 const expected=[...expected_dates].sort(),byId=new Map(universe.companies.map(c=>[c.security_id,{security_id:c.security_id,symbol:c.symbol,market:c.market,company:c.company,bars:[],missing:[]}]))
  ,seen=new Set(),captures=[];
 for(const day of days){verifyDay(day,universe);if(!expected.includes(day.date))continue;
  const key=day.market+':'+day.date;if(seen.has(key)||Date.parse(day.public_receipt.received_at)>Date.parse(formed_at))fail('DUPLICATE_OR_FUTURE_DAY');seen.add(key);
  captures.push({market:day.market,date:day.date,history_day_hash:day.history_day_hash,...day.capture});
  for(const row of day.observations){const stock=byId.get(row.security_id);if(!stock||stock.market!==day.market||row.date!==day.date)fail('BAR_IDENTITY');stock.bars.push(row);}
  for(const row of day.missing){const stock=byId.get(row.security_id);if(!stock)fail('MISSING_IDENTITY');stock.missing.push(row);}
 }
 const stocks=[...byId.values()].map(stock=>{
  stock.bars.sort((a,b)=>a.date.localeCompare(b.date));const have=new Set(stock.bars.map(b=>b.date)),knownMissing=new Set(stock.missing.map(b=>b.date));
  for(const date of expected)if(!have.has(date)&&!knownMissing.has(date))stock.missing.push({security_id:stock.security_id,symbol:stock.symbol,date,
   reason:stock.market==='EMERGING'?'NATIVE_EMERGING_PRICE_HAS_NO_AUCTION_OPEN_CLOSE_METHOD_REQUIRED':'MARKET_DATE_NOT_CAPTURED_OR_NOT_NORMALIZED',source_capture:null});
  stock.missing.sort((a,b)=>a.date.localeCompare(b.date));
  const scopes=[...new Set(stock.bars.map(b=>b.session_scope))],history_issues=[];
  if(scopes.length>1)history_issues.push('MIXED_SESSION_SCOPE');
  if(stock.bars.some(b=>b.all_trades_session_complete!==true))history_issues.push('REPORTED_HISTORY_EXCLUDES_BLOCK_TRADES');
  const body={schema:'TAIWAN_SECURITY_HISTORY_V1',...stock,universe_hash:universe.universe_hash,formed_at,expected_dates:expected,
   unique_sessions:stock.bars.length,session_scopes:scopes,history_issues,price_history_complete:stock.bars.length===expected.length&&expected.length>0&&history_issues.length===0,
   historical_membership_established:false,corporate_action_coverage_complete:false,methodology_approved:false};
  return {...body,history_hash:marketSnapshotHash(body)};
 });
 const body={schema:'TAIWAN_HISTORY_CHECKPOINT_V1',universe_hash:universe.universe_hash,formed_at,expected_dates:expected,captures,stocks,
  counts:{securities:stocks.length,expected_market_dates:expected.length*2,normalized_market_dates:seen.size,
   complete_price_histories:stocks.filter(s=>s.price_history_complete).length,price_observations:stocks.reduce((n,s)=>n+s.bars.length,0)},
  state:seen.size===expected.length*2?'LISTED_OTC_DATES_CAPTURED':'PARTIAL_MARKET_HISTORY',
  emerging_ohlc_inferred:false,historical_universe_backtest_claim:false,member_published:false};
 return {...body,checkpoint_hash:marketSnapshotHash(body)};
}
export function taiwanHistoryAnalysisPackets({history,cutoff}){
 const {history_hash,...body}=history??{};
 if(history?.schema!=='TAIWAN_SECURITY_HISTORY_V1'||marketSnapshotHash(body)!==history_hash||!time(cutoff)
  ||history.bars.some(b=>Date.parse(b.available_at)>Date.parse(cutoff)))fail('PACKET_HISTORY');
 const evidence=history.bars.map(b=>{const content=JSON.stringify({date:b.date,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,amount:b.amount,
  currency:b.currency,price_basis:b.price_basis,session_scope:b.session_scope,market:b.market,source_capture:b.source_capture});
  return {id:'history:'+b.source_capture.source_sha256+':'+history.symbol+':'+b.date,symbol:history.symbol,kind:'PRICE',source:b.source_ref,
   published_at:null,available_at:b.available_at,first_seen_at:b.first_seen_at,as_of:b.available_at,time_basis:'OBSERVED_AFTER_RECEIPT',
   evidence_hash:marketSnapshotHash({source_capture:b.source_capture,content}),content};});
 const packets=[];for(let i=0;i<evidence.length;i+=80){const selected=evidence.slice(i,i+80),packet={symbol:history.symbol,company:history.company,cutoff,
  data_through:JSON.parse(selected.at(-1).content).date,evidence:selected};validateAnalysisPacket(packet);packets.push(packet);}
 return packets;
}
async function writeOnce(path,bytes){try{await writeFile(path,bytes,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||!Buffer.from(await readFile(path)).equals(Buffer.from(bytes)))throw error;}}
export async function normalizeTaiwanHistoryDirectory({receipts_dir,universe_file,output_dir,dates_file}){
 const universe=JSON.parse(await readFile(universe_file,'utf8'));verifyUniverse(universe);
 await Promise.all(['days','http-entity','public-receipts'].map(d=>mkdir(resolve(output_dir,d),{recursive:true})));
 const days=[],failures=[];
 for(const file of (await readdir(receipts_dir)).filter(f=>f.endsWith('.json')).sort()){
  const receipt=JSON.parse(await readFile(resolve(receipts_dir,file),'utf8'));if(receipt.state!=='CAPTURED'||receipt.family!=='PRICE')continue;
  try{const bytes=await readFile(receipt.raw_path),decoded=decodeTaiwanHistoryCapture({receipt,bytes}),day=normalizeTaiwanHistoryCapture({receipt,bytes,universe});
   const name=decoded.public_receipt.source_id+'-'+decoded.public_receipt.sha256+'.json';
   await writeOnce(resolve(output_dir,'http-entity',name),decoded.entity_bytes);
   await writeOnce(resolve(output_dir,'public-receipts',name),JSON.stringify(decoded.public_receipt,null,2)+'\n');
   await writeOnce(resolve(output_dir,'days',name),JSON.stringify(day,null,2)+'\n');days.push(day);
  }catch(error){failures.push({source_id:receipt.source_id,date:receipt.date,error:error instanceof Error?error.message:String(error)});}
 }
 const expected_dates=JSON.parse(await readFile(dates_file,'utf8')),checkpoint=assembleTaiwanSecurityHistory({universe,days,expected_dates,formed_at:new Date().toISOString()});
 const stamp=checkpoint.formed_at.replaceAll(':','').replaceAll('.','-'),directory=resolve(output_dir,'checkpoint-'+stamp);await mkdir(directory);
 const stocks=checkpoint.stocks;for(const stock of stocks)await writeOnce(resolve(directory,stock.security_id.replace(':','-')+'.json'),JSON.stringify(stock,null,2)+'\n');
 const manifest={...checkpoint,stocks:stocks.map(s=>({security_id:s.security_id,history_hash:s.history_hash,unique_sessions:s.unique_sessions,
  price_history_complete:s.price_history_complete,file:resolve(directory,s.security_id.replace(':','-')+'.json')})),normalization_failures:failures};
 // The original checkpoint_hash binds the full per-security documents; the
 // manifest separately binds their index and exact file hashes by reference.
 const document={...manifest,manifest_hash:marketSnapshotHash(manifest)};
 const path=resolve(directory,'manifest.json');await writeOnce(path,JSON.stringify(document,null,2)+'\n');
 return {manifest:path,counts:checkpoint.counts,state:checkpoint.state,failures,checkpoint_hash:checkpoint.checkpoint_hash,manifest_hash:document.manifest_hash};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const flags=new Map(),args=process.argv.slice(2);for(let i=0;i<args.length;i+=2){if(!['--receipts-dir','--universe','--output','--dates'].includes(args[i])||!args[i+1]||flags.has(args[i]))fail('ARGUMENTS');flags.set(args[i],args[i+1]);}
 if(flags.size!==4)fail('ARGUMENTS');
 const result=await normalizeTaiwanHistoryDirectory({receipts_dir:flags.get('--receipts-dir'),universe_file:flags.get('--universe'),output_dir:flags.get('--output'),dates_file:flags.get('--dates')});
 console.log(JSON.stringify(result));if(result.failures.length)process.exitCode=2;
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}}
