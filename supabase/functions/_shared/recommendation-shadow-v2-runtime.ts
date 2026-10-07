/** Only the report handler schedules persistence. The read-only acquisition and
 * smoke callers may calculate a comparison but cannot manufacture Forward rows.
 * A sidecar failure never changes formal V1, Report, Atomic or LINE outcomes. */
import { emptyEvidenceData, type Row } from './decision-v1-data.ts';
import { evaluateV2Shadow, v2Canonical, V2_POLICY, type V2Input, type Bar } from './recommendation-shadow-v2-engine.ts';
import { evaluateV2Outcome, type LockedV2 } from './recommendation-shadow-v2-outcomes.ts';
const obj=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{};
const rows=(x:unknown):Row[]=>Array.isArray(x)?x.map(obj):[];
const select=(r:Row,keys:readonly string[])=>Object.fromEntries(keys.filter(k=>r[k]!==undefined).map(k=>[k,r[k]]));
const quoteKeys=['id','provider','symbol','trading_date','phase','quality_status','freshness_status','value','change_percent','captured_at','ingested_at','observed_at','source_timestamp','business_date','session','available_at','asset_type','market'];
const payloadKeys=['contract','endpoint','source_hash','evidence_session_date','provider_is_close','open','high','low','close','volume_shares','volume_unit','amount_twd','amount_unit'];
export function sanitizeV2Input(input:V2Input):V2Input{
 const quote=(r:Row)=>({...select(r,quoteKeys),raw_payload:select(obj(r.raw_payload),payloadKeys)});
 return {...input,data:{...emptyEvidenceData(),
  quotes:input.data.quotes.filter(r=>r.symbol==='TAIEX').map(quote),
  universe:input.data.universe.map(r=>select(r,['symbol','sector','is_active'])),
  failures:input.data.failures.filter(s=>s.startsWith('quotes:')||s.startsWith('universe:'))},
  captures:input.captures.map(c=>({...c,rows:c.rows.map(quote)})),
  quarterly_actuals:(input.quarterly_actuals||[]).map(r=>select(r,['symbol','period','source','source_date','available_at','eps_actual_as_reported'])),
  v1:select(input.v1,['schema_version','report_date','revision_id','generated_at','phase_evaluation'])};
}
export async function buildV2Capsule(input:V2Input){
 const clean=sanitizeV2Input(input),result=await evaluateV2Shadow(clean);
 return {evidence_text:v2Canonical(clean),result};
}
export type V2Transport={
 storeRun:(text:string,result:Row)=>PromiseLike<{error:unknown}>;
 pending:()=>PromiseLike<{data:unknown;error:unknown}>;
 storeOutcome:(result:Row,text:string)=>PromiseLike<{error:unknown}>;
};
export async function persistV2Sidecar(capsule:unknown,transport:V2Transport,now:()=>string=()=>new Date().toISOString()){
 try{
  const c=obj(capsule);if(typeof c.evidence_text!=='string'||c.evidence_text.length>6_000_000)return {status:'SHADOW_NOT_AVAILABLE'};
  const input=JSON.parse(c.evidence_text) as V2Input;
  // Recompute the locked result; a response blob is not an authority to invent
  // predictions. Canonical equality also prevents silent runtime version drift.
  const result=await evaluateV2Shadow(input);
  if(v2Canonical(result)!==v2Canonical(c.result))return {status:'SHADOW_RESULT_MISMATCH'};
  const saved=await transport.storeRun(c.evidence_text,result);if(saved.error)return {status:'SHADOW_STORE_UNAVAILABLE'};
  const pending=await transport.pending();if(pending.error)return {status:'SHADOW_OUTCOMES_UNAVAILABLE'};
  // 72*25 sessions covers all current horizons, capped by the server query.
  // Overflow is explicit, never silently treated as a complete outcome pass.
  const predictions=rows(pending.data);if(predictions.length>1800)return {status:'SHADOW_OUTCOME_BACKLOG_LIMIT'};
  let observed=0;
  const jobs:{result:Row;text:string}[]=[];
  const started=Date.now();
  let limited=false;
  predictionLoop:for(const p of predictions){
   const captures=input.captures.filter(c=>c.symbol===p.symbol&&c.endpoint==='historical/candles'&&c.status==='PASS');
   if(captures.length!==1)continue;
   const bars:Bar[]=captures[0].rows.map(r=>{const raw=obj(r.raw_payload);return {date:String(r.trading_date),open:Number(raw.open),high:Number(raw.high),low:Number(raw.low),close:Number(raw.close),volume:Number(raw.volume_shares),amount:Number(raw.amount_twd),source_ref:String(r.id),available_at:String(r.ingested_at)};});
   for(const horizon of V2_POLICY.horizons){
    if(Array.isArray(p.completed_horizons)&&p.completed_horizons.includes(horizon))continue;
    const observedAt=now(),outcome=evaluateV2Outcome(p as LockedV2,bars,horizon,observedAt);
    if(outcome.state!=='OBSERVED'&&outcome.state!=='NOT_ENTERED')continue;
    const proof=v2Canonical({source_revision:result.source_revision,prediction:p,bars,horizon,observed_at:observedAt});
    if(jobs.length>=720){limited=true;break predictionLoop;}
    jobs.push({result:{...outcome},text:proof});
   }
  }
  // Four bounded writers, not an unbounded fan-out or a serial 360-RPC chain.
  // Each DB write is independently immutable/idempotent. Oldest locks go first.
  for(let i=0;i<jobs.length;i+=4){
   if(Date.now()-started>45000)return {status:'SHADOW_OUTCOME_CATCHUP_PENDING',outcomes_observed:observed};
   const batch=await Promise.all(jobs.slice(i,i+4).map(j=>transport.storeOutcome(j.result,j.text)));
   observed+=batch.filter(r=>!r.error).length;
   if(batch.some(r=>r.error))return {status:'SHADOW_OUTCOME_STORE_UNAVAILABLE',outcomes_observed:observed};
  }
  if(limited)return {status:'SHADOW_OUTCOME_CATCHUP_PENDING',outcomes_observed:observed};
  return {status:'SHADOW_STORED',outcomes_observed:observed};
 }catch{return {status:'SHADOW_UNAVAILABLE'};}
}
/** Never throws into requestRecommendationProof's formal result path. */
export function scheduleV2Sidecar(capsule:unknown,transport:V2Transport,waitUntil:((work:Promise<unknown>)=>void)|undefined){
 if(!capsule||!waitUntil)return;
 try{waitUntil(persistV2Sidecar(capsule,transport));}catch{/* only research unavailable */}
}
