/** Dedicated server Smoke only. Recompute the same live producer capsule;
 * expose bounded research metadata, never provider payloads or credentials.
 * Persistence is opt-in at the authorized server handler, never a browser. */
import type { Row } from './decision-v1-data.ts';
import { evaluateV2Shadow, v2Canonical, type V2Input } from './recommendation-shadow-v2-engine.ts';
import { sanitizeV2Input, persistV2Sidecar, type V2Transport } from './recommendation-shadow-v2-runtime.ts';
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const array=(v:unknown):Row[]=>Array.isArray(v)?v.map(obj):[];
const codes=(v:unknown):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&/^[A-Z0-9_; .-]{1,160}$/.test(x)):[];
export async function verifyV2Runtime(body:unknown,transport?:V2Transport,now:()=>string=()=>new Date().toISOString()){
 try{
  const root=obj(body),capsule=obj(root.shadow_v2),acquisition=obj(root.acquisition),decision=obj(root.decision);
  if(typeof capsule.evidence_text!=='string'||capsule.evidence_text.length>6_000_000)throw Error('CAPSULE');
  const input=JSON.parse(capsule.evidence_text) as V2Input;
  if(input.identity.revision_id!==decision.revision_id||input.identity.report_date!==decision.report_date||input.identity.generated_at!==decision.generated_at||
   acquisition.cutoff!==input.identity.generated_at||v2Canonical(input.captures)!==v2Canonical(sanitizeV2Input({...input,captures:acquisition.captures as V2Input['captures']}).captures)||
   v2Canonical(input.v1)!==v2Canonical(sanitizeV2Input({...input,v1:decision}).v1))throw Error('LINEAGE');
  const result=await evaluateV2Shadow(input);
  if(v2Canonical(result)!==v2Canonical(capsule.result)||!result.same_universe_cutoff||result.scanned!==72)throw Error('PARITY');
  const stages=['liquidity','market','sector','relative_strength','momentum','volume_price','institutional','fundamental','catalyst','risk','entry'];
  const evidence=Object.fromEntries(stages.map(stage=>[stage,Object.fromEntries(['AVAILABLE','PARTIAL','UNAVAILABLE'].map(status=>[status,result.candidates.filter(c=>obj(c.evidence[stage]).status===status).length]))]));
  const source_status=input.sources.map(c=>({kind:c.kind,source:c.source.split('?')[0],http:c.http,status:/^[A-Z0-9_]+$/.test(c.status)?c.status:'UNAVAILABLE',record_count:c.rows.length}));
  // Report all evaluated gates, not only a survivor count of an earlier gate.
  // Pending evidence is distinct from observed rejection and required-data loss.
  const reasonGroups:Record<string,string[]>={
   liquidity:['OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID','OBSERVED_LIQUIDITY_INSUFFICIENT'],
   market:['MARKET_SOURCE_INVALID','MARKET_DOWNSIDE_RISK'],sector:['SECTOR_COMPARISON_INSUFFICIENT','SECTOR_TREND_NEGATIVE'],
   relative_strength:['BENCHMARK_SESSION_HISTORY_MISSING','UNDERPERFORMING_MARKET'],momentum:['NEGATIVE_MOMENTUM','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
   volume_price:['VOLUME_CONFIRMATION_PENDING','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],institutional:['INSTITUTIONAL_DIRECTION_UNAVAILABLE','INSTITUTIONAL_SELLING_PRESSURE','INSTITUTIONAL_SOURCE_CONFLICT'],
   fundamental:['ACTUAL_GROWTH_UNAVAILABLE','ACTUAL_REVENUE_DETERIORATION','ACTUAL_REPORTED_EPS_NEGATIVE','FUNDAMENTAL_SOURCE_CONFLICT'],
   catalyst:['EVENT_SOURCE_UNAVAILABLE','MATERIAL_EVENT_IMPACT_UNASSESSED'],risk:['STOP_DISTANCE_OUTSIDE_RESEARCH_RISK_BUDGET','OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],entry:['OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID'],
  };
  const funnel=Object.fromEntries(stages.map(stage=>{
   const match=(reasons:string[])=>reasons.some(r=>reasonGroups[stage].includes(r));
   const states=result.candidates.map(c=>match(c.blockers)?'BLOCKED':match(c.rejections)?'REJECTED':match(c.pending)?'PENDING':obj(c.evidence[stage]).status==='UNAVAILABLE'?'UNAVAILABLE':'PASS');
   return [stage,Object.fromEntries(['PASS','PENDING','REJECTED','BLOCKED','UNAVAILABLE'].map(s=>[s,states.filter(v=>v===s).length]))];
  }));
  const persistence=transport?await persistV2Sidecar(capsule,transport,now):{status:'READ_ONLY_NOT_PERSISTED'};
  return {status:transport&&persistence.status!=='SHADOW_STORED'?'PERSISTENCE_FAILED':'PASS',methodology_version:result.methodology_version,
   business_date:result.business_date,source_revision:result.source_revision,cutoff:result.cutoff,input_sha256:result.input_sha256,
   same_universe_cutoff:true,universe:result.universe,scanned:result.scanned,counts:result.counts,evidence,funnel,source_status,persistence,
   candidates:result.candidates.map(c=>({symbol:c.symbol,status:c.status,blockers:codes(c.blockers),rejections:codes(c.rejections),pending:codes(c.pending),v1_status:c.v1_status,v1_reasons:codes(c.v1_reasons)})),
   shadow_only:true,production_eligible:false,promotion_allowed:false};
 }catch{return {status:'SHADOW_RUNTIME_PROOF_REJECTED'};}
}
