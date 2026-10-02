import { buildPublicMarketReadModel, type PublicMarketInput } from '../../../shared/public-market-read-model.ts';
import { replayHandoffReferences, type HandoffEvidenceInput } from './public-handoff-evidence.ts';
type Row = Record<string, unknown>;
const object=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const safeString=(v:unknown)=>typeof v==='string' && v.length<=512 && !/https?:|@|bearer\s|eyJ[\w-]+\./i.test(v);
const fields=new Set(`business_date canonical_revision decision_version member_revision member_version member_snapshot_id member_snapshot_version market_regime market_direction action generated_at observed_at publication_verified report_level recommendation_status batches proofs closing_status learning_status closing_at learning_at batch_id checkpoint status correlation_id payload_hash expected_provider_count committed_provider_count committed_at contract canonical_row_count unbatched_row_count committed_batch_count compatibility_row_count distinct_batch_id_count distinct_provider_count mixed_batch_revision_count compatibility_mismatch_count compatibility_provider_count duplicate_authoritative_provider_count production_2026_09_11_evidence_preserved idempotency_key market_session provider_contract_version`.split(' '));
function project(v:unknown,depth=0):unknown {
  if(depth>10)throw Error('PUBLIC_RECORDER_DEPTH');
  if(v===null||typeof v==='boolean'||typeof v==='number')return v;
  if(typeof v==='string'){if(!safeString(v))throw Error('PUBLIC_RECORDER_UNSAFE_VALUE');return v;}
  if(Array.isArray(v)){if(v.length>20)throw Error('PUBLIC_RECORDER_ROWS');return v.map(x=>project(x,depth+1));}
  return Object.fromEntries(Object.entries(object(v)).filter(([key])=>fields.has(key)).map(([key,value])=>[key,project(value,depth+1)]));
}
export function publicProjectionCapsule(input:PublicMarketInput) {
  const projected=project(input) as PublicMarketInput,expected=buildPublicMarketReadModel(input);
  if(JSON.stringify(buildPublicMarketReadModel(projected))!==JSON.stringify(expected))throw Error('PUBLIC_RECORDER_PROJECTION_DIFF');
  return {contract_version:'CRITICAL_CONTRACT_REPLAY_V1',projection_contract:'PUBLIC_MARKET_READ_REPLAY_V1',
    input:projected,expected};
}
type Client={rpc:(name:string,args:Row)=>PromiseLike<unknown>};
/** The existing append-only, 90-day, service-role Recorder is a sidecar. */
export function recordPublicProjection(client:Client,input:PublicMarketInput):void {
  let capsule:ReturnType<typeof publicProjectionCapsule>;try{capsule=publicProjectionCapsule(input);}catch{return;}
  recordCapsule(client,input.business_date,capsule);
}
export function recordPublicHandoff(client:Client,input:HandoffEvidenceInput):void {
  try{recordCapsule(client,input.business_date,publicHandoffCapsule(input));}catch{/* observation fails open */}
}
export function publicHandoffCapsule(input:HandoffEvidenceInput) {
  const allowed=new Set('business_date canonical_revision decision_version member_revision source_revision operational_ready references index evidence_id source source_date freshness identity_complete frozen_match https_metadata_match'.split(' '));
  const clean=(v:unknown):unknown=>{
    if(v===null||typeof v==='boolean'||typeof v==='number')return v;
    if(typeof v==='string'){if(!safeString(v))throw Error('PUBLIC_HANDOFF_RECORDER_UNSAFE');return v;}
    if(Array.isArray(v)){if(v.length>20)throw Error('PUBLIC_HANDOFF_RECORDER_ROWS');return v.map(clean);}
    return Object.fromEntries(Object.entries(object(v)).filter(([key])=>allowed.has(key)).map(([key,value])=>[key,clean(value)]));
  };
  const projected=clean(input) as HandoffEvidenceInput,expected=replayHandoffReferences(input);
  if(JSON.stringify(replayHandoffReferences(projected))!==JSON.stringify(expected))throw Error('PUBLIC_HANDOFF_RECORDER_DIFF');
  return {contract_version:'CRITICAL_CONTRACT_REPLAY_V1',projection_contract:'PUBLIC_HANDOFF_REFERENCE_REPLAY_V1',input:projected,expected};
}
function recordCapsule(client:Client,date:string,capsule:unknown):void {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const work=Promise.race([Promise.resolve().then(()=>client.rpc('record_critical_contract_evidence_v1',{
    p_business_date:date,p_stage:'PUBLICATION',p_capsule:capsule,
  })),new Promise(resolve=>{timer=setTimeout(resolve,1500);})]).catch(()=>undefined).finally(()=>{if(timer)clearTimeout(timer);});
  try{const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;runtime?.waitUntil(work);}catch{/* fail-open */}
}
