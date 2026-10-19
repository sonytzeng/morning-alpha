/** Dedicated bounded outcome acquisition. Never changes prediction evidence. */
import { normalizeDailyCandles, RECOMMENDATION_UNIVERSE, type Capture } from './recommendation-stock-evidence.ts';
import { previousMarketTradingDate, isMarketTradingDate } from './market-session-contract.mjs';
import { nextV2Session, v2Canonical, type Bar } from './recommendation-shadow-v2-engine.ts';
import { evaluateV2Outcome, type LockedV2 } from './recommendation-shadow-v2-outcomes.ts';
type Row=Record<string,unknown>;
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};

export async function acquireForwardOutcomeBars(options:{symbols:string[];businessDate:string;apiKey:string;fetcher:typeof fetch;now:()=>string;signal:AbortSignal;sleep?:(ms:number)=>Promise<void>}){
 const at=options.now(),local=new Date(Date.parse(at)+8*3600000).toISOString();
 if(local.slice(0,10)!==options.businessDate||!isMarketTradingDate('TW',options.businessDate)||!options.apiKey)throw Error('OUTCOME_SOURCE_DATE');
 const symbols=[...new Set(options.symbols)].sort();
 if(symbols.length>72||symbols.some(s=>!RECOMMENDATION_UNIVERSE.includes(s)))throw Error('OUTCOME_SOURCE_UNIVERSE');
 const to=local.slice(11,16)>='13:30'?options.businessDate:previousMarketTradingDate('TW',options.businessDate);
 if(!to)throw Error('OUTCOME_SOURCE_CALENDAR');
 const normalizationDate=nextV2Session(to),from=new Date(Date.parse(at)-65*86400000).toISOString().slice(0,10);
 const sleep=options.sleep??(ms=>new Promise<void>(r=>setTimeout(r,ms)));
 const captures:Capture[]=[];let permit=Date.parse(options.now());
 for(const symbol of symbols){
  const capture:Capture={symbol,endpoint:'historical/candles',received_at:options.now(),status:'UNAVAILABLE',rows:[],payload_hash:null,http_status:null,attempts:0,failure_stage:null};captures.push(capture);
  for(let attempt=0;attempt<2;attempt++){
   if(options.signal.aborted){capture.status='OUTCOME_SOURCE_DEADLINE';capture.failure_stage='DEADLINE';break;}
   const wait=permit-Date.parse(options.now());if(wait>0)await sleep(Math.min(wait,5000));
   if(permit>Date.parse(options.now())){attempt--;continue;}
   permit=Date.parse(options.now())+1250;
   const url=new URL('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/'+symbol);
   for(const [k,v] of Object.entries({from,to,timeframe:'D',fields:'open,high,low,close,volume,turnover,change',sort:'asc'}))url.searchParams.set(k,v);
   let stage:'FETCH'|'BODY'|'PARSER'|'NORMALIZATION'='FETCH';
   let requestSignal:AbortSignal|null=null;
   try{
    capture.attempts=attempt+1;capture.http_status=null;
    requestSignal=AbortSignal.any([options.signal,AbortSignal.timeout(4000)]);
    const response=await options.fetcher(url,{headers:{'X-API-KEY':options.apiKey},redirect:'error',signal:requestSignal});
    capture.http_status=response.status;capture.received_at=options.now();
    if(!response.ok){
     capture.status=`OUTCOME_PROVIDER_HTTP_${response.status}`;capture.failure_stage=response.status===429?'RATE_LIMIT':'PROVIDER_HTTP';
     if(response.status===429){const seconds=Number(response.headers.get('retry-after'));permit=Math.max(permit,Date.parse(options.now())+(Number.isFinite(seconds)&&seconds>0?seconds*1000:60000));}
     if(response.status!==429&&response.status<500)break;continue;
    }
    stage='BODY';const raw=await response.text();if(raw.length>250000){capture.status='OUTCOME_RESPONSE_LIMIT';capture.failure_stage='RESPONSE_CONTRACT';break;}
    capture.received_at=options.now();
    stage='PARSER';const payload:unknown=JSON.parse(raw);
    stage='NORMALIZATION';capture.rows=await normalizeDailyCandles(symbol,payload,capture.received_at,normalizationDate);
    capture.status='PASS';capture.failure_stage=null;break;
   }catch(error){
    // Persist only fixed classifications, never exception text, URLs, headers
    // or response bodies. Contract failures cannot be repaired by an immediate
    // identical request; leave this immutable capture for the next checkpoint.
    if(options.signal.aborted){capture.status='OUTCOME_SOURCE_DEADLINE';capture.failure_stage='DEADLINE';break;}
    const code=error instanceof Error?error.message:'';
    const contractCodes=['STOCK_CANDLE_CONTRACT_INVALID','STOCK_CANDLE_LIMIT','STOCK_CANDLE_SESSION_INVALID','STOCK_OHLCV_AMOUNT_INVALID','STOCK_FUTURE_EVIDENCE','STOCK_COMPLETED_SESSIONS_INCOMPLETE'];
    if(stage==='NORMALIZATION'){
     const known=contractCodes.includes(code);capture.status=known?code:'OUTCOME_NORMALIZATION_FAILED';
     capture.failure_stage=known&&(code.includes('SESSION')||code.includes('FUTURE'))?'SESSION':'RESPONSE_CONTRACT';break;
    }
    if(stage==='PARSER'){capture.status='OUTCOME_PROVIDER_JSON_INVALID';capture.failure_stage='PARSER';break;}
    capture.status=requestSignal?.aborted||error instanceof Error&&error.name==='TimeoutError'?'OUTCOME_PROVIDER_TIMEOUT':stage==='BODY'?'OUTCOME_RESPONSE_BODY_UNAVAILABLE':'OUTCOME_PROVIDER_TRANSPORT_FAILURE';
    capture.failure_stage=stage==='BODY'?'RESPONSE_BODY':'TRANSPORT';
   }
  }
 }
 return captures;
}
export async function persistForwardOutcomes(options:{predictions:Row[];captures:Capture[];sourceRevision:string;now:()=>string;store:(result:Row,evidence:string)=>PromiseLike<{error:unknown}>}){
 const start=Date.now();let observed=0,pending=0,unavailable=0;const jobs:{result:Row;evidence:string}[]=[];
 for(const p of options.predictions.slice(0,1800)){
  const source=options.captures.filter(c=>c.symbol===p.symbol&&c.status==='PASS');
  if(source.length!==1){unavailable++;continue;}
  const bars:Bar[]=source[0].rows.map(r=>{const b=object(r.raw_payload);return {date:String(r.trading_date),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume_shares),amount:Number(b.amount_twd),source_ref:String(r.id),available_at:String(r.ingested_at)};});
  for(const horizon of [1,3,5,10,20] as const){
   if(Array.isArray(p.completed_horizons)&&p.completed_horizons.includes(horizon))continue;
   const at=options.now(),result=evaluateV2Outcome(p as LockedV2,bars,horizon,at);
   if(result.state==='PENDING'){pending++;continue;}if(result.state==='UNAVAILABLE'){unavailable++;continue;}
   if(jobs.length>=720)break;
   const stop=Number(object(p.entry).invalidation_price);
   const invalidated=result.state==='OBSERVED'?bars.some(b=>b.date>=String(result.entry_at)&&b.date<=String(result.exit_at)&&b.low<=stop):null;
   jobs.push({result:{...result,invalidation_hit:invalidated,target_hit:null,target_reason:'NO_LOCKED_PRICE_TARGET',
    observation_labels:horizon===1?['CLOSE','1D']:[`${horizon}D`],close_basis:'ENTRY_SESSION_CLOSE_EQUALS_FROZEN_V2_1D'},
    evidence:v2Canonical({source_revision:options.sourceRevision,prediction:p,bars,horizon,observed_at:at})});
  }
 }
 for(let i=0;i<jobs.length;i+=4){
  if(Date.now()-start>45000)return {status:'CATCHUP_PENDING',observed,pending,unavailable};
  const results=await Promise.all(jobs.slice(i,i+4).map(j=>options.store(j.result,j.evidence)));
  observed+=results.filter(r=>!r.error).length;unavailable+=results.filter(r=>r.error).length;
 }
 return {status:unavailable?'SOURCE_OR_STORE_UNAVAILABLE':jobs.length>=720?'CATCHUP_PENDING':'COMPLETE',observed,pending,unavailable};
}
