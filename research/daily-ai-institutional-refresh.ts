/** Bounded official share-count acquisition for a NEW research cutoff.
 * No model, database writer, currency conversion or publication approval. */
import {canonical} from './entry-opportunity.ts';
import {compareTime,hashValid,sourceSafe,validObservationTime} from '../src/features/vnext/contracts.ts';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';

type Exchange='TWSE'|'TPEX';
type Task={exchange:Exchange;date:string;symbols:string[]};
type Row=unknown[];
type FailureDiagnostic={schema:'INSTITUTIONAL_FAILURE_DIAGNOSTIC_V1';exchange:Exchange;date:string;stage:string;code:string;http_status:number|null;bytes_read:number;source_sha256:string|null};
class CaptureFailure extends Error{
 readonly diagnostic:FailureDiagnostic;
 constructor(diagnostic:FailureDiagnostic){super('AI_INSTITUTIONAL_CAPTURE_FAILED');this.diagnostic=diagnostic;}
}
const failureCodes=new Set(['HTTP_OR_SIZE','BODY','SIZE','CLOCK','TIMEOUT','ABORTED','SCHEMA','SHARES','ACCOUNTING','RESPONSE','SYMBOLS','TWSE_SCHEMA','TWSE_COLUMNS','TPEX_SCHEMA','TPEX_COLUMNS','ROWS','DUPLICATE_SYMBOL','FOREIGN_ACCOUNTING','DEALER_ACCOUNTING','TOTAL_ACCOUNTING']);
export type InstitutionalResponse={exchange:Exchange;date:string;source:string;state:'CAPTURED'|'UNAVAILABLE';received_at:string|null;
 source_sha256:string|null;source_bytes:number|null;response_text:string|null;error:string|null};
export type InstitutionalAddition={symbol:string;fact_id:string;body_text:string;row_text:string};
export type OfficialInstitutionalFact=ResearchFact&{symbol:string;kind:'INSTITUTIONAL';basis:'SHARES'};
export type InstitutionalRefreshProof={schema:'DAILY_AI_INSTITUTIONAL_REFRESH_V1';through:string;observed_at:string;
 responses:InstitutionalResponse[];additions:InstitutionalAddition[];source_admitted:false;member_publication_approved:false};
export type InstitutionalRefreshResult={inputs:FunnelInput[];through:string;cutoff:string;gapsBySymbol:Record<string,string[]>;
 proof:InstitutionalRefreshProof;complete_symbols:number};
const responseLimit=2_000_000,proofLimit=7_000_000;
const taipeiDay=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
const day=(value:string)=>/^\d{4}-\d\d-\d\d$/.test(value)&&validObservationTime(value+'T00:00:00Z');
function fail(code:string):never{throw Error('AI_INSTITUTIONAL_'+code);}
const stopped=(signal:AbortSignal)=>{if(signal.aborted)fail('ABORTED');};
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail('SCHEMA');return v as Record<string,unknown>;};
const integer=(value:unknown)=>{
 if(typeof value!=='string'&&typeof value!=='number')fail('SHARES');
 const raw=String(value).trim();if(!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw))fail('SHARES');const s=raw.replaceAll(',','');
 const n=Number(s);if(!Number.isSafeInteger(n))fail('SHARES');return n;
};
const group=(buy:unknown,sell:unknown,net:unknown)=>{
 const b=integer(buy),s=integer(sell),n=integer(net);if(b<0||s<0||b-s!==n)fail('ACCOUNTING');return {buy:b,sell:s,net:n};
};
const values=(f:ResearchFact)=>canonical(f.values);
function exchange(input:FunnelInput):Exchange|null{
 const bar=input.bars.slice().sort((a,b)=>b.date.localeCompare(a.date))[0];if(!bar)return null;
 try{const h=new URL(bar.source).hostname;return ['www.twse.com.tw','openapi.twse.com.tw'].includes(h)?'TWSE':h==='www.tpex.org.tw'?'TPEX':null;}catch{return null;}
}
export function institutionalDailyUrl(market:Exchange,date:string){
 if(!['TWSE','TPEX'].includes(market)||!day(date))fail('REQUEST_SCOPE');
 if(market==='TWSE')return `https://www.twse.com.tw/rwd/zh/fund/T86?date=${date.replaceAll('-','')}&selectType=ALLBUT0999&response=json`;
 return `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&d=${Number(date.slice(0,4))-1911}/${date.slice(5).replace('-','/')}&o=json`;
}
function sessions(through:string,count:number){
 const out:string[]=[];let date:string|null=through;
 for(let i=0;i<count;i++){if(!date||!coveredCalendarDate('TW',date)||!isMarketTradingDate('TW',date))fail('CALENDAR');out.unshift(date);date=previousMarketTradingDate('TW',date);}return out;
}
export function institutionalTargetDate(businessDate:string,at:string){
 if(!validObservationTime(at)||!day(businessDate)||taipeiDay(at)!==businessDate||!coveredCalendarDate('TW',businessDate))fail('CLOCK');
 // Both feeds include block trades. An afternoon populated response is not
 // evidence that today's all-trades session has finished.
 const through=isMarketTradingDate('TW',businessDate)&&compareTime(at,businessDate+'T17:05:00+08:00')>=0?businessDate:previousMarketTradingDate('TW',businessDate);
 if(!through)fail('CALENDAR');return through;
}

/** Exact source columns and integer accounting; names are not redistributed.
 * TPEx total foreign includes its foreign-dealer subcolumn, unlike TWSE's
 * explicitly excluded foreign-dealer measure. Never add markets together. */
export async function parseInstitutionalDaily(payload:unknown,task:Task,receipt:InstitutionalResponse){
 const p=record(payload);
 if(receipt.state!=='CAPTURED'||receipt.exchange!==task.exchange||receipt.date!==task.date||receipt.source!==institutionalDailyUrl(task.exchange,task.date)
  ||!receipt.received_at||!validObservationTime(receipt.received_at)||compareTime(receipt.received_at,task.date+'T17:00:00+08:00')<=0
  ||typeof receipt.response_text!=='string'||receipt.source_bytes!==new TextEncoder().encode(receipt.response_text).byteLength
  ||receipt.source_bytes>responseLimit||receipt.source_sha256!==await hash(receipt.response_text)||receipt.error!==null
  ||canonical(JSON.parse(receipt.response_text))!==canonical(payload)||String(p.stat).toLowerCase()!=='ok'||p.date!==task.date.replaceAll('-',''))fail('RESPONSE');
 if(!task.symbols.length||new Set(task.symbols).size!==task.symbols.length||task.symbols.some(s=>!/^\d{4,6}$/.test(s)))fail('SYMBOLS');
 let fields:unknown[],data:Row[];
 if(task.exchange==='TWSE'){
  if(p.hints!=='單位：股'||!Array.isArray(p.fields)||!Array.isArray(p.data))fail('TWSE_SCHEMA');
  fields=p.fields;data=p.data as Row[];
  const required=['證券代號','證券名稱','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)','外陸資買賣超股數(不含外資自營商)',
   '投信買進股數','投信賣出股數','投信買賣超股數','自營商買賣超股數','自營商買進股數(自行買賣)','自營商賣出股數(自行買賣)',
   '自營商買賣超股數(自行買賣)','自營商買進股數(避險)','自營商賣出股數(避險)','自營商買賣超股數(避險)','三大法人買賣超股數'];
  if(new Set(fields).size!==fields.length||required.some(f=>!fields.includes(f)))fail('TWSE_COLUMNS');
 }else{
  if(p.template!=='/template/insti/dailyTrade'||!Array.isArray(p.tables)||p.tables.length!==2)fail('TPEX_SCHEMA');
  const table=record(p.tables[0]),unused=record(p.tables[1]);
  const expected=['代號','名稱',...Array.from({length:7},()=>['買進股數','賣出股數','買賣超股數']).flat(),'三大法人買賣超股數合計'];
  const roc=`${Number(task.date.slice(0,4))-1911}/${task.date.slice(5).replace('-','/')}`;
  if(table.title!=='三大法人買賣明細資訊'||table.date!==roc||canonical(table.fields)!==canonical(expected)||!Array.isArray(table.data)||Object.keys(unused).length!==0)fail('TPEX_COLUMNS');
  fields=expected;data=table.data as Row[];
 }
 if(!data.length||data.length>10000||data.some(row=>!Array.isArray(row)||row.length!==fields.length))fail('ROWS');
 const facts:OfficialInstitutionalFact[]=[],additions:InstitutionalAddition[]=[];
 for(const symbol of task.symbols){
  const matches=data.filter(row=>String(row[0]).trim()===symbol);if(matches.length>1)fail('DUPLICATE_SYMBOL');if(!matches.length)continue;
  const row=matches[0];let foreign,trust,dealer,total;
  if(task.exchange==='TWSE'){
   const get=(name:string)=>row[fields.indexOf(name)];
   foreign=group(get('外陸資買進股數(不含外資自營商)'),get('外陸資賣出股數(不含外資自營商)'),get('外陸資買賣超股數(不含外資自營商)'));
   trust=group(get('投信買進股數'),get('投信賣出股數'),get('投信買賣超股數'));
   const own=group(get('自營商買進股數(自行買賣)'),get('自營商賣出股數(自行買賣)'),get('自營商買賣超股數(自行買賣)')),
    hedge=group(get('自營商買進股數(避險)'),get('自營商賣出股數(避險)'),get('自營商買賣超股數(避險)'));
   dealer=group(own.buy+hedge.buy,own.sell+hedge.sell,get('自營商買賣超股數'));total=integer(get('三大法人買賣超股數'));
  }else{
   const excluded=group(row[2],row[3],row[4]),foreignDealer=group(row[5],row[6],row[7]);foreign=group(row[8],row[9],row[10]);
   if(excluded.buy+foreignDealer.buy!==foreign.buy||excluded.sell+foreignDealer.sell!==foreign.sell||excluded.net+foreignDealer.net!==foreign.net)fail('FOREIGN_ACCOUNTING');
   trust=group(row[11],row[12],row[13]);const own=group(row[14],row[15],row[16]),hedge=group(row[17],row[18],row[19]);dealer=group(row[20],row[21],row[22]);
   if(own.buy+hedge.buy!==dealer.buy||own.sell+hedge.sell!==dealer.sell||own.net+hedge.net!==dealer.net)fail('DEALER_ACCOUNTING');total=integer(row[23]);
  }
  if(foreign.net+trust.net+dealer.net!==total)fail('TOTAL_ACCOUNTING');
  const row_text=canonical(row),rowHash=await hash(row_text),id=`official-institutional:${task.exchange}:${task.date}:${symbol}:${rowHash}`;
  const body={symbol,kind:'INSTITUTIONAL' as const,period:task.date,basis:'SHARES' as const,values:{net_shares:total,foreign_net_shares:foreign.net,trust_net_shares:trust.net,dealer_net_shares:dealer.net},
   source:receipt.source,published_at:null,first_seen_at:receipt.received_at,available_at:receipt.received_at,as_of:task.date+'T17:00:00+08:00',
   source_sha256:receipt.source_sha256,source_bytes:receipt.source_bytes,source_received_at:receipt.received_at,unit:'SHARES',not_currency:true,
   source_locator:{exchange:task.exchange,trading_date:task.date,company_code:symbol,row_sha256:rowHash,foreign_scope:task.exchange==='TWSE'?'FOREIGN_DEALERS_EXCLUDED':'FOREIGN_DEALERS_INCLUDED'},
   source_admitted:false,member_publication_approved:false};
  const fact={...body,id,evidence_hash:await hash(canonical(body))};facts.push(fact);
  additions.push({symbol,fact_id:id,body_text:canonical(body),row_text});
 }
 return {facts,additions};
}

async function capture(task:Task,request:{fetcher:typeof fetch;clock:()=>string;signal:AbortSignal},began:string){
 const source=institutionalDailyUrl(task.exchange,task.date),controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const diagnostic:FailureDiagnostic={schema:'INSTITUTIONAL_FAILURE_DIAGNOSTIC_V1',exchange:task.exchange,date:task.date,stage:'FETCH',code:'UNKNOWN',http_status:null,bytes_read:0,source_sha256:null};
 const work=(async()=>{
  const response=await request.fetcher(source,{method:'GET',redirect:'error',credentials:'omit',headers:{Accept:'application/json'},signal});
  diagnostic.http_status=response.status;diagnostic.stage='HEADERS';
  if(!response.ok||Number(response.headers.get('content-length'))>responseLimit)fail('HTTP_OR_SIZE');
  const reader=response.body?.getReader();if(!reader)fail('BODY');const chunks:Uint8Array[]=[];let count=0;
  diagnostic.stage='BODY';
  try{for(;;){stopped(signal);const part=await reader.read();if(part.done)break;count+=part.value.byteLength;diagnostic.bytes_read=count;if(count>responseLimit)fail('SIZE');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  diagnostic.stage='DECODE';
  const response_text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),received_at=request.clock();
  if(!validObservationTime(received_at)||compareTime(received_at,began)<0||taipeiDay(received_at)!==taipeiDay(began))fail('CLOCK');
  const receipt:InstitutionalResponse={exchange:task.exchange,date:task.date,source,state:'CAPTURED',received_at,source_sha256:await hash(response_text),source_bytes:bytes.length,response_text,error:null};
  diagnostic.source_sha256=receipt.source_sha256;diagnostic.stage='JSON';
  const payload=JSON.parse(response_text);diagnostic.stage='VALIDATION';
  return {receipt,parsed:await parseInstitutionalDaily(payload,task,receipt)};
 })();
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('AI_INSTITUTIONAL_TIMEOUT'));},6000);})]);}
 catch(error){
  if(error instanceof Error&&error.message==='AI_INSTITUTIONAL_CLOCK')throw error;
  const code=error instanceof Error?error.message.replace(/^AI_INSTITUTIONAL_/,''):'';
  diagnostic.code=failureCodes.has(code)?code:diagnostic.stage==='JSON'?'INVALID_JSON':diagnostic.stage==='DECODE'?'INVALID_UTF8':'UNCLASSIFIED';
  throw new CaptureFailure({...diagnostic});
 }
 finally{if(timer)clearTimeout(timer);controller.abort();}
}

export async function refreshDailyAiInstitutional(request:{inputs:FunnelInput[];businessDate:string;fetcher:typeof fetch;clock:()=>string;signal:AbortSignal}):Promise<InstitutionalRefreshResult>{
 stopped(request.signal);const began=request.clock(),through=institutionalTargetDate(request.businessDate,began),expected=sessions(through,10),recent=expected.slice(-5);
 const inputs=structuredClone(request.inputs);
 if(inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72||inputs.some(i=>!/^\d{4,6}$/.test(i.symbol)||!Array.isArray(i.facts)||!Array.isArray(i.bars)))fail('SCOPE');
 const markets=new Map(inputs.map(i=>[i.symbol,exchange(i)])),gapsBySymbol=Object.fromEntries(inputs.map(i=>[i.symbol,markets.get(i.symbol)?[]:['INSTITUTIONAL_EXCHANGE_UNCONFIRMED']])) as Record<string,string[]>;
 for(const i of inputs)if(expected.some(date=>i.facts.filter(f=>f.kind==='INSTITUTIONAL'&&f.period===date).length>1))fail('DUPLICATE_RETAINED_PERIOD');
 const tasks=recent.flatMap(date=>(['TWSE','TPEX'] as Exchange[]).flatMap(market=>{
  const selected=inputs.filter(i=>markets.get(i.symbol)===market);
  return selected.some(i=>!i.facts.some(f=>f.kind==='INSTITUTIONAL'&&f.period===date))?[{exchange:market,date,symbols:selected.map(i=>i.symbol)}]:[];
 }));
 const responses:InstitutionalResponse[]=new Array(tasks.length),additions:InstitutionalAddition[]=[];let cursor=0;
 const worker=async()=>{for(;;){const index=cursor++;if(index>=tasks.length)return;stopped(request.signal);const task=tasks[index];
  try{
   const {receipt,parsed}=await capture(task,request,began);stopped(request.signal);responses[index]=receipt;
   for(const symbol of task.symbols){const input=inputs.find(i=>i.symbol===symbol)!,fresh=parsed.facts.find(f=>f.symbol===symbol);
    if(!fresh){gapsBySymbol[symbol].push('INSTITUTIONAL_OFFICIAL_SYMBOL_UNAVAILABLE');continue;}
    const old=input.facts.find(f=>f.kind==='INSTITUTIONAL'&&f.period===task.date);
    if(old){if(old.basis!==fresh.basis||values(old)!==values(fresh))gapsBySymbol[symbol].push('INSTITUTIONAL_RETAINED_REVISION_REQUIRES_REVIEW');continue;}
    input.facts.push(fresh);additions.push(parsed.additions.find(a=>a.fact_id===fresh.id)!);
   }
  }catch(error){
   stopped(request.signal);if(error instanceof Error&&error.message==='AI_INSTITUTIONAL_CLOCK')throw error;
   if(error instanceof CaptureFailure)console.warn('INSTITUTIONAL_FAILURE_DIAGNOSTIC_V1',JSON.stringify(error.diagnostic));
   responses[index]={exchange:task.exchange,date:task.date,source:institutionalDailyUrl(task.exchange,task.date),state:'UNAVAILABLE',received_at:null,source_sha256:null,source_bytes:null,response_text:null,error:'INSTITUTIONAL_PUBLIC_SOURCE_UNAVAILABLE'};
   for(const symbol of task.symbols)gapsBySymbol[symbol].push('INSTITUTIONAL_PUBLIC_SOURCE_REFRESH_UNAVAILABLE');
  }
 }};
 await Promise.all([worker(),worker()]);stopped(request.signal);const cutoff=request.clock();
 if(!validObservationTime(cutoff)||compareTime(cutoff,began)<0||taipeiDay(cutoff)!==request.businessDate||responses.some(r=>r.received_at&&compareTime(r.received_at,cutoff)>0))fail('CLOCK');
 let complete_symbols=0;
 for(const input of inputs){
  input.cutoff=cutoff;
  const selected=expected.flatMap(date=>input.facts.filter(f=>f.kind==='INSTITUTIONAL'&&f.period===date));
  if(selected.length!==10||selected.some(f=>f.basis!=='SHARES'||!sourceSafe(f.source)||!hashValid(f.evidence_hash)
   ||Object.keys(f.values).sort().join('|')!==['net_shares','foreign_net_shares','trust_net_shares','dealer_net_shares'].sort().join('|')
   ||Object.values(f.values).some(v=>!Number.isSafeInteger(v))
   ||Number(f.values.net_shares)!==Number(f.values.foreign_net_shares)+Number(f.values.trust_net_shares)+Number(f.values.dealer_net_shares)
   ||[f.first_seen_at,f.available_at,f.as_of].some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||f.available_at!==null&&f.first_seen_at!==null&&compareTime(f.first_seen_at,f.available_at)>0
   ||f.available_at!==null&&f.as_of!==null&&compareTime(f.as_of,f.available_at)>0))gapsBySymbol[input.symbol].push('INSTITUTIONAL_TEN_SESSION_COVERAGE_MISSING');
  gapsBySymbol[input.symbol]=[...new Set(gapsBySymbol[input.symbol])];if(!gapsBySymbol[input.symbol].length)complete_symbols++;
 }
 const proof:InstitutionalRefreshProof={schema:'DAILY_AI_INSTITUTIONAL_REFRESH_V1',through,observed_at:cutoff,responses,additions:additions.sort((a,b)=>a.fact_id.localeCompare(b.fact_id)),source_admitted:false,member_publication_approved:false};
 if(new TextEncoder().encode(JSON.stringify(proof)).byteLength>proofLimit)fail('PROOF_LIMIT');
 return {inputs,through,cutoff,gapsBySymbol,proof,complete_symbols};
}

/** Compose with the existing financial/replay chain. Both collectors own the
 * same baseline and run concurrently; only verified new share facts are merged.
 * The database must install the matching proof validator before this is wired.
 */
export function withDailyInstitutionalFinancials(base:typeof refreshDailyAiFinancials,collectInstitutional:typeof refreshDailyAiInstitutional=refreshDailyAiInstitutional):typeof refreshDailyAiFinancials{
 return async request=>{
  const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]),owned={...request,inputs:structuredClone(request.inputs),signal};
  try{
   const financialRequest={...owned,inputs:structuredClone(owned.inputs)},institutionalRequest={...owned,inputs:structuredClone(owned.inputs)};
   const [financial,institutional]=await Promise.all([base(financialRequest),collectInstitutional(institutionalRequest)]);stopped(signal);
   const cutoff=request.clock();if(!validObservationTime(cutoff)||[financial.cutoff,institutional.cutoff].some(at=>compareTime(at,cutoff)>0))fail('CLOCK');
   const newIds=new Set(institutional.proof.additions.map(a=>a.fact_id)),bySymbol=new Map(institutional.inputs.map(i=>[i.symbol,i]));
   const inputs=financial.inputs.map(stock=>{
    const added=bySymbol.get(stock.symbol)?.facts.filter(f=>newIds.has(f.id))??[];
    if(added.some(f=>stock.facts.some(old=>old.id===f.id||old.kind==='INSTITUTIONAL'&&old.period===f.period)))fail('MERGE_CONFLICT');
    return {...stock,cutoff,facts:[...stock.facts,...added]};
   });
   const proof={...financial.proof,institutional_daily:institutional.proof};
   const gapsBySymbol=Object.fromEntries(inputs.map(stock=>[stock.symbol,[...new Set([...(financial.gapsBySymbol[stock.symbol]??[]),...(institutional.gapsBySymbol[stock.symbol]??[])])]]));
   return {...financial,inputs,cutoff,proof,gapsBySymbol,additionalGaps:[...new Set([...financial.additionalGaps,
    'INSTITUTIONAL_SHARES_NOT_CURRENCY_FOREIGN_SCOPE_PER_EXCHANGE',
    ...(institutional.complete_symbols===72?[]:['INSTITUTIONAL_DAILY_HISTORY_INCOMPLETE'])])]};
  }finally{controller.abort();}
 };
}
