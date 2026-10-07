/** Candidate only. No DB client, storage, publication, scheduler or user auth.
 * Credentials are supplied by Edge Runtime, never by request body or output.
 * Dedicated identity at ingress; existing internal identity at downstream. */
import { buildInternalFunctionHeaders } from './internal-function-auth.mjs';
import { authorizeSmokeWorker } from '../recommendation-stock-evidence-smoke-v1/auth.ts';
import { isMarketTradingDate, previousMarketTradingDate } from './market-session-contract.mjs';
import { evaluationPhase, recommendationQuoteCurrent } from './recommendation-phase.ts';
import { RECOMMENDATION_UNIVERSE, stockAcquisitionCoverage, type Capture } from './recommendation-stock-evidence.ts';
import type { Row } from './decision-v1-data.ts';
import { runtimeEvaluationSummary } from './recommendation-runtime-summary.ts';
import { requestRecommendationProof } from './recommendation-producer.ts';

type Runtime = {
 url:string; credentials:{currentToken:string;previousToken:string;previousExpiresAt:string;version:string;serviceRoleKey:string};
 workerToken:string; gatewayKeyClass?:string; gatewayAnonJwt?:string; fetcher:typeof fetch; now:()=>string;
};
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const stamp=(v:unknown)=>Date.parse(String(v));
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const day=(at:string)=>new Date(stamp(at)+8*3600000).toISOString().slice(0,10);
const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function boundedJson(body:ReadableStream<Uint8Array>|null,limit:number):Promise<unknown>{
 if(!body)throw Error('EMPTY_BODY');
 const reader=body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('BODY_LIMIT');chunks.push(value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
/** Coverage is recomputed from captures; a producer's claimed count is not proof.
 * Reuse the Production session/freshness predicate, including completed-close
 * semantics. Never classify an empty/missing provider result as an observed zero. */
export function verifySmokeCapture(body:unknown,scope:'SMOKE_2330'|'UNIVERSE_72',date:string,revision:string,start:string,end:string){
 const root=object(body),a=object(root.acquisition),decision=object(root.decision);
 const symbols=scope==='SMOKE_2330'?['2330']:RECOMMENDATION_UNIVERSE;
 const cutoff=String(a.cutoff),phase=evaluationPhase(start);
 if(root.scope!==scope||a.contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'||a.business_date!==date||a.universe_count!==72||
  !Number.isFinite(stamp(cutoff))||stamp(cutoff)<stamp(start)||stamp(cutoff)>stamp(end)||day(cutoff)!==date||evaluationPhase(cutoff)!==phase||
  !Array.isArray(root.business_writes)||root.business_writes.length||!Array.isArray(a.captures))throw Error('PRODUCER_CONTRACT');
 if(scope==='SMOKE_2330'&&(a.requested_count!==1||root.complete_universe_evaluation!==false))throw Error('SMOKE_SCOPE');
 if(scope==='UNIVERSE_72'&&(decision.report_date!==date||decision.revision_id!==revision||decision.generated_at!==cutoff))throw Error('PRODUCER_IDENTITY');
 const endpoints=phase==='PREMARKET'?['historical/candles']:['historical/candles','intraday/quote'];
 const captures=a.captures as Capture[],seen=new Set<string>(),bad:string[]=[],freshnessFailures:Row[]=[];
 if(captures.length!==symbols.length*endpoints.length)throw Error('CAPTURE_SET');
 for(const c of captures){
  const key=`${c.symbol}:${c.endpoint}`;
  if(!symbols.includes(c.symbol)||!endpoints.includes(c.endpoint)||seen.has(key)||!Array.isArray(c.rows)||c.rows.length>90)throw Error('CAPTURE_SET');
  seen.add(key);
  if(!Number.isFinite(stamp(c.received_at))||stamp(c.received_at)<stamp(start)||stamp(c.received_at)>stamp(cutoff))throw Error('CAPTURE_TIME');
  if(c.status!=='PASS'){bad.push(key);continue;}
  if(c.http_status!==200||!c.payload_hash||!c.rows.length)throw Error('CAPTURE_SUCCESS_PROOF');
  for(const row of c.rows){
   const raw=object(row.raw_payload),at=stamp(row.captured_at),ingested=stamp(row.ingested_at);
   if(row.symbol!==c.symbol||row.provider!=='fugle'||!finite(row.value)||row.value<=0||!Number.isFinite(at)||at>stamp(c.received_at)||
    ingested!==stamp(c.received_at)||stamp(row.available_at)!==ingested||stamp(row.source_timestamp)!==at||
    raw.contract!=='RECOMMENDATION_STOCK_EVIDENCE_V1'||raw.endpoint!==c.endpoint||!raw.source_hash||
    raw.volume_unit!=='SHARES'||raw.amount_unit!=='TWD'||!finite(raw.volume_shares)||raw.volume_shares<0||!finite(raw.amount_twd)||raw.amount_twd<0||
    row.business_date!==row.trading_date||raw.evidence_session_date!==row.trading_date||day(String(row.captured_at))!==row.trading_date)throw Error('CAPTURE_ROW');
  }
  if(c.endpoint==='historical/candles'){
   const dates=new Set(c.rows.map(r=>String(r.trading_date)));let expected=previousMarketTradingDate('TW',date);
   if(dates.size!==c.rows.length||c.rows.some(r=>!isMarketTradingDate('TW',String(r.trading_date))||String(r.trading_date)>String(expected)))throw Error('DAILY_SESSIONS');
   for(let n=0;n<20;n++){if(!expected||!dates.has(expected))throw Error('DAILY_SESSIONS');expected=previousMarketTradingDate('TW',expected);}
   for(const r of c.rows){const p=object(r.raw_payload);
    if(![p.open,p.high,p.low,p.close].every(v=>finite(v)&&v>0)||Number(p.high)<Math.max(Number(p.open),Number(p.low),Number(p.close))||Number(p.low)>Math.min(Number(p.open),Number(p.high),Number(p.close))||p.close!==r.value)throw Error('DAILY_OHLC');
   }
  }
  if(c.endpoint==='intraday/quote'||phase==='PREMARKET'){
   const latest=[...c.rows].sort((x,y)=>stamp(y.captured_at)-stamp(x.captured_at))[0];
   const identity={report_date:date,today_date:date,revision_id:revision,generated_at:cutoff,data_as_of:cutoff,is_trading_day:true};
   if(!recommendationQuoteCurrent(latest,identity)){
    bad.push(key);freshnessFailures.push({symbol:c.symbol,endpoint:c.endpoint,stage:'FRESHNESS',reason:'LATEST_FRESHNESS',source_timestamp:latest.captured_at,session_date:latest.trading_date,phase:latest.phase,observed_at:c.received_at});
   }
  }
 }
 const staleKeys=new Set(freshnessFailures.map(f=>`${f.symbol}:${f.endpoint}`));
 const coverage=stockAcquisitionCoverage(captures.map(c=>staleKeys.has(`${c.symbol}:${c.endpoint}`)?{...c,status:'LATEST_FRESHNESS'}:c),symbols);
 // Only bounded non-sensitive metadata. Do not return arbitrary provider errors,
 // captured rows, decision text, response headers or credentials.
 return {pass:bad.length===0&&[coverage.latest_price,coverage.ohlc_20d,coverage.volume_20d,coverage.amount_20d].every(n=>n===symbols.length),
  requested:symbols.length,success:coverage.success,partial:coverage.partial,failed:coverage.failed,
  latest_price:coverage.latest_price,ohlc_20d:coverage.ohlc_20d,volume_20d:coverage.volume_20d,amount_20d:coverage.amount_20d,
  freshness_failures:freshnessFailures,
  failures:captures.filter(c=>c.status!=='PASS').map(c=>({symbol:c.symbol,endpoint:c.endpoint,http_status:Number.isInteger(c.http_status)&&Number(c.http_status)>=100&&Number(c.http_status)<=599?c.http_status:null,
   stage:['AUTH','ENTITLEMENT','RATE_LIMIT','PROVIDER_HTTP','SESSION','RESPONSE_CONTRACT','PARSER','TRANSPORT','DEADLINE'].includes(String(c.failure_stage))?c.failure_stage:'UNKNOWN',
   reason:['PROVIDER_AUTH_INVALID','ENTITLEMENT_NON_RETRYABLE','PROVIDER_SYMBOL_OR_ENDPOINT_NOT_FOUND','PROVIDER_REQUEST_INVALID','RATE_LIMIT_RETRYABLE','PROVIDER_JSON_INVALID','STOCK_CANDLE_CONTRACT_INVALID','STOCK_CANDLE_LIMIT','STOCK_CANDLE_SESSION_INVALID','STOCK_OHLCV_AMOUNT_INVALID','STOCK_FUTURE_EVIDENCE','STOCK_COMPLETED_SESSIONS_INCOMPLETE','STOCK_INTRADAY_CONTRACT_INVALID','STOCK_INTRADAY_SESSION_INVALID','PROVIDER_TIMEOUT','PROVIDER_TRANSPORT_FAILURE','ACQUISITION_DEADLINE','RESPONSE_LIMIT'].includes(c.status)?c.status:'PROVIDER_FAILURE'})),
  session:bad.length?'INCOMPLETE':'PASS',freshness:bad.length?'INCOMPLETE':'PASS'};
}

export async function handleRecommendationSmoke(request:Request,runtime:Runtime):Promise<Response>{
 if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 if(request.headers.has('origin'))return reply(403,{error:'SERVER_ONLY'});
 const auth=await authorizeSmokeWorker(request.headers,runtime.workerToken,Date.parse(runtime.now()));
 if(!auth.ok)return reply(401,{error:auth.error_code});
 let input:Row,start:string,date:string;
 try{
  input=object(await boundedJson(request.body,1024));start=runtime.now();date=day(start);
  if(Object.keys(input).some(k=>!['mode','business_date','correlation_id'].includes(k))||
   !['SMOKE_2330','BOUNDED_72_ACQUISITION_VERIFY','NATURAL_CALLER_READONLY'].includes(String(input.mode))||input.business_date!==date||!isMarketTradingDate('TW',date)||
   typeof input.correlation_id!=='string'||!/^[-a-zA-Z0-9_:]{1,110}$/.test(input.correlation_id))throw Error('INPUT');
 }catch{return reply(422,{error:'SMOKE_INPUT_INVALID'});}
 // No alternative credential guesses. Match the existing target's JWT gateway
 // plus internal-token path exactly. No credential ever leaves this project.
 const gatewayAuthorization=request.headers.get('authorization')||'';
 if(runtime.url!=='https://cttfzgvhiewfckydcrci.supabase.co'||!runtime.credentials.currentToken||!runtime.credentials.serviceRoleKey||!/^Bearer [^.\s]+\.[^.\s]+\.[^.\s]+$/.test(gatewayAuthorization))return reply(503,{error:'RUNTIME_IDENTITY_UNAVAILABLE',
  project_url_matches:runtime.url==='https://cttfzgvhiewfckydcrci.supabase.co',internal_identity_configured:!!runtime.credentials.currentToken,
  downstream_identity_class:!runtime.credentials.serviceRoleKey?'MISSING':/^\S+\.\S+\.\S+$/.test(runtime.credentials.serviceRoleKey)?'LEGACY_JWT':'NON_JWT'});
 const deadline=AbortSignal.any([request.signal,AbortSignal.timeout(285000)]);
 // Gateway already verified this JWT; it grants no internal-worker access by
 // itself. Keep Runtime API key in apikey and the distinct internal token in
 // x-cron-secret. Never put opaque service keys in a Bearer JWT slot.
 const headers={...buildInternalFunctionHeaders({cronSecret:runtime.credentials.currentToken,serviceRoleKey:runtime.credentials.serviceRoleKey,version:runtime.credentials.version,source:'recommendation-stock-evidence-smoke-v1'}),Authorization:gatewayAuthorization};
 const run=async(scope:'SMOKE_2330'|'UNIVERSE_72')=>{
  const began=runtime.now(),revision=`${input.correlation_id}:${scope}`;
  const response=await runtime.fetcher(`${runtime.url}/functions/v1/recommendation-stock-evidence-v1`,{method:'POST',headers,redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(scope==='SMOKE_2330'?26000:255000)]),body:JSON.stringify({business_date:date,correlation_id:revision,scope})});
  if(!response.ok){await response.body?.cancel();return {http:response.status,verification:null};}
  const data=await boundedJson(response.body,8_000_000);
  return {http:response.status,verification:verifySmokeCapture(data,scope,date,revision,began,runtime.now()),
   ...(scope==='UNIVERSE_72'?{evaluation:runtimeEvaluationSummary(data)}:{})};
 };
 try{
  const smoke=await run('SMOKE_2330');
  if(!smoke.verification?.pass)return reply(422,{smoke_2330:smoke,universe_72:'NOT_RUN',business_writes:[]});
  if(input.mode==='SMOKE_2330')return reply(200,{smoke_2330:smoke,universe_72:'NOT_RUN',runtime_gateway_class:runtime.gatewayKeyClass??'UNINSPECTED',business_writes:[]});
  if(input.mode==='NATURAL_CALLER_READONLY'){
   // Execute the identical deployed report caller in Runtime, without invoking
   // the report handler or its publication/persistence/LINE paths.
   const began=runtime.now(),revision=`${input.correlation_id}:NATURAL`;
   let observed:Row|null=null;
   await requestRecommendationProof({identity:{report_date:date,today_date:date,revision_id:revision,generated_at:began,data_as_of:began,is_trading_day:true},
    url:runtime.url,cronSecret:runtime.credentials.currentToken,serviceRoleKey:runtime.credentials.serviceRoleKey,gatewayAnonJwt:runtime.gatewayAnonJwt,fetcher:runtime.fetcher,
    onVerifiedProof:body=>{observed=body;}});
   if(!observed)return reply(422,{natural_caller_runtime:'FAIL',business_writes:[]});
   const verification=verifySmokeCapture(observed,'UNIVERSE_72',date,revision,began,runtime.now());
   return reply(verification.pass?200:422,{natural_caller_runtime:'PASS',coverage:verification,evaluation:runtimeEvaluationSummary(observed),
    report_handler_invoked:false,business_writes:[]});
  }
  // Every72 request gets its own successful2330 first; no caller-controlled
  // prior-pass flag, cache, cross-date token or parallel race can skip it.
  const all=await run('UNIVERSE_72');
  return reply(all.verification?.pass?200:422,{smoke_2330:smoke,universe_72:all,business_writes:[]});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const known=['PRODUCER_CONTRACT','SMOKE_SCOPE','PRODUCER_IDENTITY','CAPTURE_SET','CAPTURE_TIME','CAPTURE_SUCCESS_PROOF','CAPTURE_ROW','DAILY_SESSIONS','DAILY_OHLC','LATEST_FRESHNESS','BODY_LIMIT','EMPTY_BODY','EVALUATION_CONTRACT'];
  return reply(422,{error:known.includes(code)?code:error instanceof SyntaxError?'PRODUCER_JSON_INVALID':'SMOKE_TRANSPORT_OR_CONTRACT_REJECTED',business_writes:[]});
 }
}
