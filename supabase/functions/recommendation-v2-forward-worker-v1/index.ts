import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeInternalRequest, internalCredentialsFromEnv, buildInternalFunctionHeaders } from '../_shared/internal-function-auth.mjs';
import { requestRecommendationProof } from '../_shared/recommendation-producer.ts';
import { persistV2Sidecar } from '../_shared/recommendation-shadow-v2-runtime.ts';
import { v2DailySnapshot, v2WatchTransitions } from '../../../src/features/research/recommendation-v2-forward.ts';
import { acquireForwardOutcomeBars, persistForwardOutcomes } from '../_shared/recommendation-v2-forward-outcomes.ts';
import { v2Canonical } from '../_shared/recommendation-shadow-v2-engine.ts';
import type { Capture } from '../_shared/recommendation-stock-evidence.ts';

const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

// Existing internal identity AND Supabase Gateway JWT. No Owner write path,
// new secret, public invocation, member grants, Cron or business writes.
export async function handleV2Forward(request:Request){
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 if(request.headers.has('origin'))return reply(403,{error:'SERVER_ONLY'});
 const auth=await authorizeInternalRequest(request.headers,internalCredentialsFromEnv());
 if(!auth.ok)return reply(401,{error:auth.error_code});
 const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;
 if(!runtime)return reply(503,{error:'BOUNDED_BACKGROUND_RUNTIME_REQUIRED'});
 try{
  const text=await request.text();if(text.length>1024)return reply(413,{error:'INPUT_LIMIT'});
  const input=object(JSON.parse(text));
  const outcomeOnly=input.operation==='OUTCOMES';
  const allowed=outcomeOnly?['operation','job_id','lease_id']:['business_date','evaluation_phase','source_batch_id'];
  if(Object.keys(input).some(k=>!allowed.includes(k)))return reply(422,{error:'SCOPE_INVALID'});
  const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,init)=>fetch(u,{...init,signal:AbortSignal.timeout(5000)})}});
  if(outcomeOnly){
   const claim=await db.rpc('claim_recommendation_v2_outcome_work',{p_job:input.job_id,p_lease:input.lease_id});
   if(claim.error)return reply(409,{error:'OUTCOME_JOB_REJECTED'});
   const work=object(claim.data);if(work.status!=='ACQUIRED')return reply(200,{status:work.status,business_writes:[]});
   const sweep=async()=>{
    let complete=false;const sweepStarted=Date.now();
    try{
     const pending=await db.rpc('pending_recommendation_shadow_v2');if(pending.error||!Array.isArray(pending.data))throw Error('OUTCOME_QUEUE');
     const experiments=await db.rpc('pending_owner_v2_experiments');if(experiments.error||!Array.isArray(experiments.data))throw Error('OWNER_EXPERIMENT_QUEUE');
     const papers=experiments.data.map(object),predictions=pending.data.map(object);if(!predictions.length&&!papers.length){complete=true;return;}
     const now=()=>new Date().toISOString();let evidence=object(work.evidence);
     if(!evidence.captures){
      const captures=await acquireForwardOutcomeBars({symbols:[...predictions,...papers].map(p=>String(p.symbol)),businessDate:String(work.business_date),apiKey:Deno.env.get('FUGLE_API_KEY')||'',fetcher:fetch,now,signal:AbortSignal.timeout(180000)});
      evidence={source_revision:work.source_revision,observed_at:now(),captures};
      const stored=await db.rpc('store_recommendation_v2_outcome_source',{p_text:v2Canonical(evidence)});if(stored.error)throw Error('OUTCOME_SOURCE_STORE');
     }
     const result=await persistForwardOutcomes({predictions,captures:evidence.captures as Capture[],sourceRevision:String(work.source_revision),now,
      store:(result,proof)=>db.rpc('store_recommendation_shadow_v2_outcome',{p_result:result,p_evidence_text:proof})});
     complete=result.status==='COMPLETE';
     const paperJobs=papers.flatMap(p=>Object.entries(object(p.targets)).filter(([h,d])=>
      !(Array.isArray(p.completed_horizons)&&p.completed_horizons.includes(h))&&Date.parse(String(d)+'T13:30:00+08:00')<=Date.now()).map(([h])=>({id:p.id,h})));
     // A finite batch; unfinished items remain durable for the next checkpoint.
     if(paperJobs.length>200)complete=false;
     for(let i=0;i<Math.min(200,paperJobs.length);i+=4){
      if(Date.now()-sweepStarted>220000){complete=false;break;}
      const stored=await Promise.all(paperJobs.slice(i,Math.min(i+4,200)).map(p=>db.rpc('store_owner_v2_experiment_outcome',{p_trade:p.id,p_horizon:p.h,p_source:work.source_revision})));
      if(stored.some(r=>r.error))complete=false;
     }
    }catch{/* No exception payload or credential leaves the controlled runtime. */}
    finally{await db.rpc('finish_recommendation_v2_outcome_work',{p_job:input.job_id,p_lease:input.lease_id,p_complete:complete});}
   };
   runtime.waitUntil(sweep().catch(()=>{}));return reply(202,{status:'OUTCOME_WORK_ACCEPTED',business_writes:[]});
  }
  const dispatchOutcomes=async(receipt:Record<string,unknown>)=>{
   try{
    const response=await fetch(url+'/functions/v1/recommendation-v2-forward-worker-v1',{method:'POST',redirect:'error',signal:AbortSignal.timeout(6000),
     headers:{...buildInternalFunctionHeaders({cronSecret:Deno.env.get('CRON_SECRET')||'',serviceRoleKey:key,source:'recommendation-v2-forward-worker-v1'}),Authorization:'Bearer '+(Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')||'')},
     body:JSON.stringify({operation:'OUTCOMES',job_id:receipt.job_id,lease_id:receipt.lease_id})});
    await response.body?.cancel();
   }catch{/* next natural checkpoint resumes the durable pending queue */}
  };
  const claim=await db.rpc('claim_recommendation_v2_forward',{p_date:input.business_date,p_phase:input.evaluation_phase,p_batch:input.source_batch_id});
  if(claim.error)return reply(409,{error:'FORWARD_TRIGGER_CONTRACT_REJECTED'});
  const receipt=object(claim.data);
  if(receipt.status!=='ACQUIRED'){
   if(['COMPLETE','SKIPPED_NO_WATCH'].includes(String(receipt.status)))runtime.waitUntil(dispatchOutcomes(receipt));
   return reply(200,{status:receipt.status,business_writes:[]});
  }
  const work=async()=>{
   let complete=false;
   try{
    const previous=await db.from('recommendation_shadow_v2_runs').select('result').eq('business_date',input.business_date).eq('evaluation_phase','PREMARKET').order('locked_at',{ascending:false}).limit(1);
    if(previous.error)throw Error('FORWARD_PREMARKET_LINEAGE_UNAVAILABLE');
    const premarket=object(previous.data?.[0]?.result),counts=object(premarket.counts);
    if(input.evaluation_phase!=='PREMARKET'&&counts.WATCH===0&&counts.BLOCKED===0){
     const skipped=await db.rpc('finish_recommendation_v2_forward',{p_job:receipt.job_id,p_lease:receipt.lease_id,p_status:'SKIPPED_NO_WATCH'});
     if(!skipped.error)await dispatchOutcomes(receipt);return;
    }
    const at=new Date().toISOString();let capsule:unknown;
    await requestRecommendationProof({identity:{report_date:String(input.business_date),today_date:String(input.business_date),revision_id:String(receipt.source_revision),generated_at:at,data_as_of:at,is_trading_day:true},
     url,cronSecret:Deno.env.get('CRON_SECRET')||'',serviceRoleKey:key,gatewayAnonJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')||'',fetcher:fetch,caller:'recommendation-v2-forward-worker-v1',
     onVerifiedProof:body=>{capsule=body.shadow_v2;}});
    await persistV2Sidecar(capsule,{
     storeRun:async(evidence,result)=>{
      const snapshot={...v2DailySnapshot(result),watch_transitions:input.evaluation_phase!=='PREMARKET'&&premarket.business_date?v2WatchTransitions(premarket,result):[]};
      const response=await db.rpc('store_recommendation_shadow_v2',{p_evidence_text:evidence,p_result:result,p_phase:input.evaluation_phase,p_snapshot:snapshot});
      complete=!response.error;return response;
     },
     pending:()=>db.rpc('pending_recommendation_shadow_v2'),
     storeOutcome:(result,evidence)=>db.rpc('store_recommendation_shadow_v2_outcome',{p_result:result,p_evidence_text:evidence}),
    },()=>new Date().toISOString(),false);
    // An outcome backlog does not erase a durable evaluation. The next natural
    // checkpoint retries pending outcomes; finish RPC proves the immutable run.
   }catch{/* fixed failure classification only: no payloads/headers logged */}
   const finished=await Promise.resolve(db.rpc('finish_recommendation_v2_forward',{p_job:receipt.job_id,p_lease:receipt.lease_id,p_status:complete?'COMPLETE':'FAILED'})).catch(()=>({error:true}));
   if(complete&&!finished.error)await dispatchOutcomes(receipt);
  };
  runtime.waitUntil(work());
  return reply(202,{status:'RESEARCH_ACCEPTED',business_writes:[],shadow_only:true});
 }catch{return reply(422,{error:'FORWARD_RESEARCH_UNAVAILABLE',business_writes:[]});}
}
Deno.serve(handleV2Forward);
