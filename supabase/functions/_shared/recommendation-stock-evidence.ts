/** Isolated recommendation acquisition. Never writes Core market tables.
 * Fugle daily volume = shares, quote total.tradeVolume = lots, amount = TWD.
 * Newly fetched historical candles become available NOW, never retroactively. */
import type { Row, EvidenceData, DecisionIdentity } from './decision-v1-data.ts';
import { buildEvidenceDecision, sealEvidenceDecision } from './decision-v1-evidence.ts';
import { isMarketTradingDate, previousMarketTradingDate } from './market-session-contract.mjs';
import { evaluationPhase } from './recommendation-phase.ts';
import { officialActualCoverage, type OfficialCapture } from './recommendation-official-actuals.ts';

export const RECOMMENDATION_UNIVERSE = Object.freeze('1504 1513 1514 1519 1590 1605 1760 2049 2208 2303 2308 2317 2330 2337 2344 2356 2357 2368 2376 2377 2379 2382 2383 2408 2421 2454 2520 2539 2542 2548 2603 2609 2610 2615 2618 2634 2881 2882 2884 2885 2886 2891 2892 3006 3017 3034 3037 3081 3189 3231 3324 3363 3443 3450 3529 3653 3661 3711 4566 4743 4908 4979 6213 6230 6274 6446 6488 6547 6669 8033 8046 8299'.split(' '));
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const num=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const day=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
const hash=async(v:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),b=>b.toString(16).padStart(2,'0')).join('');
export function assertRecommendationUniverse(rows:Row[]) {
 const symbols=rows.filter(r=>r.is_active===true).map(r=>String(r.symbol)).sort();
 if(JSON.stringify(symbols)!==JSON.stringify([...RECOMMENDATION_UNIVERSE].sort()))throw Error('RECOMMENDATION_UNIVERSE_DRIFT');
}
export type Capture = {symbol:string; endpoint:'historical/candles'|'intraday/quote'; received_at:string; status:string; rows:Row[]; payload_hash:string|null; http_status?:number|null; attempts?:number; failure_stage?:string|null};
export function stockAcquisitionCoverage(captures:Capture[],symbols:readonly string[]) {
 const completed=(symbol:string)=>captures.find(c=>c.symbol===symbol&&c.endpoint==='historical/candles'&&c.status==='PASS')?.rows??[];
 const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
 const enough=(rows:Row[],fields:string[])=>rows.length>=20&&rows.slice(-20).every(r=>fields.every(f=>finite(obj(r.raw_payload)[f])));
 const count=(fields:string[])=>symbols.filter(s=>enough(completed(s),fields)).length;
 const success=symbols.filter(s=>captures.some(c=>c.symbol===s)&&captures.filter(c=>c.symbol===s).every(c=>c.status==='PASS')).length;
 const partial=symbols.filter(s=>captures.some(c=>c.symbol===s&&c.status==='PASS')&&captures.some(c=>c.symbol===s&&c.status!=='PASS')).length;
 return {requested:symbols.length,success,partial,failed:symbols.length-success-partial,
  latest_price:symbols.filter(s=>{const cs=captures.filter(c=>c.symbol===s),latest=cs.find(c=>c.endpoint==='intraday/quote')??cs.find(c=>c.endpoint==='historical/candles');return latest?.status==='PASS'&&latest.rows.length>0;}).length,
  ohlc_20d:count(['open','high','low','close']),volume_20d:count(['volume_shares']),amount_20d:count(['amount_twd']),
  failures:captures.filter(c=>c.status!=='PASS').map(c=>({symbol:c.symbol,endpoint:c.endpoint,http_status:c.http_status??null,stage:c.failure_stage??'UNKNOWN',reason:c.status,attempts:c.attempts??1}))};
}
export async function normalizeDailyCandles(symbol:string,payload:unknown,receivedAt:string,businessDate:string):Promise<Row[]> {
 const p=obj(payload), last=previousMarketTradingDate('TW',businessDate);
 if(p.symbol!==symbol||p.timeframe!=='D'||!Array.isArray(p.data)||!last)throw Error('STOCK_CANDLE_CONTRACT_INVALID');
 if(p.data.length>90)throw Error('STOCK_CANDLE_LIMIT');
 const seen=new Set<string>(),rows:Row[]=[];
 for(const v of p.data){
  const c=obj(v),date=String(c.date);
  if(date>last)continue; // unfinished current-day candle is never a completed bar
  if(!isMarketTradingDate('TW',date)||seen.has(date))throw Error('STOCK_CANDLE_SESSION_INVALID');
  seen.add(date);
  const o=num(c.open),h=num(c.high),l=num(c.low),close=num(c.close),volume=num(c.volume),amount=num(c.turnover),change=num(c.change);
  if(o===null||h===null||l===null||close===null||volume===null||amount===null||change===null||Math.min(o,h,l,close)<=0||volume<0||amount<0||h<Math.max(o,l,close)||l>Math.min(o,h,close)||close-change<=0)throw Error('STOCK_OHLCV_AMOUNT_INVALID');
  const at=`${date}T13:30:00+08:00`;
  if(Date.parse(at)>Date.parse(receivedAt))throw Error('STOCK_FUTURE_EVIDENCE');
  const normalized={symbol,date,open:o,high:h,low:l,close,volume,amount,change};
  const digest=await hash(normalized);
  rows.push({id:`stock-evidence:${digest}`,provider:'fugle',source:'fugle',symbol,observed_at:receivedAt,source_timestamp:at,business_date:date,session:'REGULAR_COMPLETED',available_at:receivedAt,asset_type:'equity',market:'TW',trading_date:date,phase:'close',value:close,change_percent:change/(close-change)*100,captured_at:at,ingested_at:receivedAt,quality_status:'verified',freshness_status:'provider_returned',raw_payload:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',endpoint:'historical/candles',source_hash:digest,evidence_session_date:date,open:o,high:h,low:l,close,volume_shares:volume,volume_unit:'SHARES',amount_twd:amount,amount_unit:'TWD'}});
 }
 if(!seen.has(last)||rows.length<20)throw Error('STOCK_COMPLETED_SESSIONS_INCOMPLETE');
 let expected:string|null=last;
 for(let i=0;i<20;i++){
  if(!expected||!seen.has(expected))throw Error('STOCK_COMPLETED_SESSIONS_INCOMPLETE');
  expected=previousMarketTradingDate('TW',expected);
 }
 return rows.sort((a,b)=>String(a.captured_at).localeCompare(String(b.captured_at)));
}
export async function normalizeIntradayQuote(symbol:string,payload:unknown,receivedAt:string,businessDate:string):Promise<Row[]> {
 const p=obj(payload),total=obj(p.total),last=obj(p.lastTrade);
 const micros=num(last.time),price=num(last.price),change=num(p.changePercent),lots=num(total.tradeVolume),amount=num(total.tradeValue);
 if(p.symbol!==symbol||p.date!==businessDate||micros===null||price===null||price<=0||change===null||lots===null||lots<0||amount===null||amount<0||p.isTrial===true)throw Error('STOCK_INTRADAY_CONTRACT_INVALID');
 const at=new Date(Math.floor(micros/1000)).toISOString(),minute=new Date(Date.parse(at)+8*3600000);
 if(day(at)!==businessDate||minute.getUTCHours()<9||Date.parse(at)>Date.parse(receivedAt))throw Error('STOCK_INTRADAY_SESSION_INVALID');
 const normalized={symbol,businessDate,at,price,change,lots,amount},digest=await hash(normalized);
 return [{id:`stock-evidence:${digest}`,provider:'fugle',source:'fugle',symbol,observed_at:receivedAt,source_timestamp:at,business_date:businessDate,session:p.isClose===true?'REGULAR_COMPLETED':'REGULAR_INTRADAY',available_at:receivedAt,asset_type:'equity',market:'TW',trading_date:businessDate,phase:p.isClose===true?'close':'intraday',value:price,change_percent:change,captured_at:at,ingested_at:receivedAt,quality_status:'verified',freshness_status:'provider_returned',raw_payload:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',endpoint:'intraday/quote',source_hash:digest,evidence_session_date:businessDate,volume_shares:lots*1000,volume_unit:'SHARES',source_volume_unit:'LOTS',amount_twd:amount,amount_unit:'TWD'}}];
}
export async function acquireStockEvidence(options:{businessDate:string;universe:Row[];apiKey:string;fetcher:typeof fetch;now:()=>string;signal:AbortSignal;scope?:'UNIVERSE_72'|'SMOKE_2330';sleep?:(ms:number,signal:AbortSignal)=>Promise<void>}) {
 assertRecommendationUniverse(options.universe);
 const start=options.now();
 if(day(start)!==options.businessDate||!isMarketTradingDate('TW',options.businessDate))throw Error('LIVE_ACQUISITION_DATE_INVALID');
 if(!options.apiKey)throw Error('EXISTING_FUGLE_CREDENTIAL_UNAVAILABLE');
 const phase=evaluationPhase(start),from=new Date(Date.parse(start)-65*86400000).toISOString().slice(0,10),to=previousMarketTradingDate('TW',options.businessDate);
 if(options.scope!==undefined&&!['UNIVERSE_72','SMOKE_2330'].includes(options.scope))throw Error('ACQUISITION_SCOPE_INVALID');
 const symbols=options.scope==='SMOKE_2330'?['2330']:RECOMMENDATION_UNIVERSE;
 const tasks=symbols.flatMap(symbol=>[{symbol,endpoint:'historical/candles' as const},...(phase==='INTRADAY'?[{symbol,endpoint:'intraday/quote' as const}]:[])]);
 const sleep=options.sleep??((ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal.aborted){reject(Error('ACQUISITION_DEADLINE'));return;}
  const abort=()=>{clearTimeout(timer);reject(Error('ACQUISITION_DEADLINE'));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
  signal.addEventListener('abort',abort,{once:true});
 }));
 let rateLimitedUntil=0;
 let cursor=0;const captures:Capture[]=[];
 await Promise.all(Array.from({length:6},async()=>{
  while(cursor<tasks.length){
   const task=tasks[cursor++],capture:Capture={...task,received_at:options.now(),status:'NOT_ATTEMPTED',rows:[],payload_hash:null,http_status:null,attempts:0,failure_stage:null};
   captures.push(capture);
   if(options.signal.aborted){capture.status='ACQUISITION_DEADLINE';continue;}
   const url=new URL(`https://api.fugle.tw/marketdata/v1.0/stock/${task.endpoint}/${task.symbol}`);
   if(task.endpoint==='historical/candles')for(const[k,v]of Object.entries({from,to:String(to),timeframe:'D',fields:'open,high,low,close,volume,turnover,change',sort:'asc'}))url.searchParams.set(k,v);
   for(let attempt=0;attempt<3;attempt++)try{
    const pause=rateLimitedUntil-Date.parse(options.now());
    if(pause>0)await sleep(pause,options.signal);
    if(options.signal.aborted){capture.status='ACQUISITION_DEADLINE';capture.failure_stage='DEADLINE';break;}
    capture.attempts=attempt+1;
    const response=await options.fetcher(url,{headers:{'X-API-KEY':options.apiKey},redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(4000)])});
    capture.http_status=response.status;
    capture.received_at=options.now();
    if(!response.ok){
     capture.status=response.status===401?'PROVIDER_AUTH_INVALID':response.status===403?'ENTITLEMENT_NON_RETRYABLE':response.status===404?'PROVIDER_SYMBOL_OR_ENDPOINT_NOT_FOUND':response.status===400?'PROVIDER_REQUEST_INVALID':response.status===429?'RATE_LIMIT_RETRYABLE':`PROVIDER_HTTP_${response.status}`;
     capture.failure_stage=response.status===401?'AUTH':response.status===403?'ENTITLEMENT':response.status===429?'RATE_LIMIT':'PROVIDER_HTTP';
     if(response.status!==429&&response.status<500)break;
     if(response.status===429){
      const retry=response.headers.get('Retry-After'),seconds=retry===null?NaN:Number(retry),at=retry===null?NaN:Date.parse(retry);
      const delay=Number.isFinite(seconds)&&seconds>=0?seconds*1000:Number.isFinite(at)?Math.max(0,at-Date.parse(options.now())):60000;
      rateLimitedUntil=Math.max(rateLimitedUntil,Date.parse(options.now())+delay);
     }
     if(attempt<2)await sleep(response.status===429?Math.max(0,rateLimitedUntil-Date.parse(options.now())):250*2**attempt,options.signal);
     continue;
    }
    const text=await response.text();capture.received_at=options.now();if(text.length>250000)throw Error('RESPONSE_LIMIT');
    const body:unknown=JSON.parse(text);
    capture.rows=await(task.endpoint==='historical/candles'?normalizeDailyCandles:normalizeIntradayQuote)(task.symbol,body,capture.received_at,options.businessDate);
    capture.payload_hash=await hash(capture.rows.map(r=>obj(r.raw_payload).source_hash));capture.status='PASS';capture.failure_stage=null;break;
   }catch(error){
    // Never retain provider error bodies, request headers, token, or thrown URL.
    const code=error instanceof Error?error.message:'';
    const contractCodes=['STOCK_CANDLE_CONTRACT_INVALID','STOCK_CANDLE_LIMIT','STOCK_CANDLE_SESSION_INVALID','STOCK_OHLCV_AMOUNT_INVALID','STOCK_FUTURE_EVIDENCE','STOCK_COMPLETED_SESSIONS_INCOMPLETE','STOCK_INTRADAY_CONTRACT_INVALID','STOCK_INTRADAY_SESSION_INVALID','RESPONSE_LIMIT'];
    if(options.signal.aborted){capture.status='ACQUISITION_DEADLINE';capture.failure_stage='DEADLINE';break;}
    if(contractCodes.includes(code)){capture.status=code;capture.failure_stage=code.includes('SESSION')||code.includes('FUTURE')?'SESSION':'RESPONSE_CONTRACT';break;}
    if(error instanceof SyntaxError){capture.status='PROVIDER_JSON_INVALID';capture.failure_stage='PARSER';break;}
    capture.status=error instanceof Error&&error.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_TRANSPORT_FAILURE';capture.failure_stage='TRANSPORT';
    if(attempt<2)try{await sleep(250*2**attempt,options.signal);}catch{capture.status='ACQUISITION_DEADLINE';capture.failure_stage='DEADLINE';break;}
   }
  }
 }));
 return captures.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.endpoint.localeCompare(b.endpoint));
}
export async function buildRecommendationProof(data:EvidenceData,identity:DecisionIdentity,captures:Capture[]=[],officialActuals:OfficialCapture[]=[]) {
 const cutoff=Date.parse(identity.generated_at);
 const availableActuals=officialActuals.map(c=>{
  const available=Date.parse(c.received_at);
  return Number.isFinite(available)&&available<=cutoff&&c.rows.every(r=>{
   const stamp=Date.parse(String(r.available_at));return Number.isFinite(stamp)&&stamp<=cutoff;
  })?c:{...c,status:'OFFICIAL_NOT_AVAILABLE_AT_CUTOFF',rows:[]};
 });
 const merged:EvidenceData={...data,quotes:[...data.quotes,...captures.flatMap(c=>c.rows)],failures:[...data.failures]};
 try{assertRecommendationUniverse(data.universe);}catch{merged.failures.push('RECOMMENDATION_UNIVERSE_DRIFT');}
 for(const c of captures)if(c.status!=='PASS')merged.failures.push(`stock:${c.symbol}:${c.endpoint}:${c.status}`);
 merged.failures.sort();
 const decision=await sealEvidenceDecision(buildEvidenceDecision(merged,identity));
 return {decision,acquisition:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:identity.report_date,cutoff:identity.generated_at,universe_count:RECOMMENDATION_UNIVERSE.length,captures,
  official_actuals:{captures:availableActuals,coverage:officialActualCoverage(availableActuals,RECOMMENDATION_UNIVERSE)}},business_writes:[]};
}
/** Reuse only the persisted producer capture available at this read cutoff.
 * No acquisition from the Owner browser, and never refresh its receipt time. */
export function persistedRecommendationInput(data:EvidenceData,identity:DecisionIdentity,ai:Row):{data:EvidenceData;priorWatch:string[]|null}{
 const capture=obj(ai.recommendation_stock_evidence),decision=obj(ai.decision_v1),phase=obj(decision.phase_evaluation);
 const cutoff=Date.parse(identity.generated_at),saved=Date.parse(String(capture.cutoff));
 if(capture.contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'||capture.business_date!==identity.report_date||!Number.isFinite(saved)||saved>cutoff||decision.report_date!==identity.report_date)return {data,priorWatch:null};
 const quotes:Row[]=[],failures=[...data.failures];
 for(const raw of Array.isArray(capture.captures)?capture.captures:[]){
  const c=obj(raw);
  if(!RECOMMENDATION_UNIVERSE.includes(String(c.symbol))||!Number.isFinite(Date.parse(String(c.received_at)))||Date.parse(String(c.received_at))>saved){failures.push('PERSISTED_CAPTURE_IDENTITY_INVALID');continue;}
  if(c.status!=='PASS'){failures.push(`stock:${c.symbol}:${c.status}`);continue;}
  for(const row of Array.isArray(c.rows)?c.rows:[]){const r=obj(row);
   if(r.symbol!==c.symbol||obj(r.raw_payload).contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'||Date.parse(String(r.ingested_at))!==Date.parse(String(c.received_at))||!Number.isFinite(Date.parse(String(r.captured_at)))||Date.parse(String(r.captured_at))>saved){failures.push('PERSISTED_CAPTURE_ROW_INVALID');continue;}
   quotes.push(r);
  }
 }
 const priorWatch=phase.evaluation_phase==='PREMARKET'&&Array.isArray(phase.candidates)?phase.candidates.map(obj).filter(c=>c.status==='WATCH').map(c=>String(c.symbol)):null;
 return {data:{...data,quotes:[...data.quotes,...quotes],failures},priorWatch};
}
