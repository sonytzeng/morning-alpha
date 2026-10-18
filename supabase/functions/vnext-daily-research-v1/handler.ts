import {timingSafeEqual} from 'node:crypto';
import {workDailyRun,type RuntimePorts} from '../../../src/features/vnext/dailyRuntime.ts';
export type WorkerEnvironment=RuntimePorts&{cronSecret:string;background:(p:Promise<unknown>)=>void;continueRun:(id:string)=>Promise<void>};
/** Gateway validates the existing anon JWT; this additional server credential
 * is mandatory. Browser/Owner/member JWTs alone never authorize this worker. */
export async function handleVnextDaily(req:Request,env:WorkerEnvironment){
 const reply=(s:number,b:unknown)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 if(req.headers.has('origin'))return reply(403,{error:'SERVER_ONLY'});
 const presented=req.headers.get('x-vnext-internal')??'',a=new TextEncoder().encode(presented),b=new TextEncoder().encode(env.cronSecret);
 if(b.length<24||a.length!==b.length||!timingSafeEqual(a,b))return reply(401,{error:'INTERNAL_AUTH_REQUIRED'});
 try{
  const text=await req.text();if(text.length>512)return reply(413,{error:'INPUT_LIMIT'});const input=JSON.parse(text);
  if(!input||Array.isArray(input)||typeof input!=='object')return reply(422,{error:'SCOPE_INVALID'});
  let id:string;
  if(Object.keys(input).length===1&&/^[a-f0-9-]{36}$/.test(input.run_id))id=input.run_id;
  else{
   if(Object.keys(input).sort().join(',')!=='business_date,phase,source_batch_id'||!/^\d{4}-\d\d-\d\d$/.test(input.business_date)||!/^[a-f0-9-]{36}$/.test(input.source_batch_id))return reply(422,{error:'SCOPE_INVALID'});
   const receipt=await env.rpc('enqueue_vnext_daily_research_v1',{p_date:input.business_date,p_phase:input.phase,p_batch:input.source_batch_id}) as {run_id?:string;status:string};
   if(!receipt.run_id)return reply(200,{status:receipt.status});id=receipt.run_id;
  }
  const backgroundDeadline=Date.now()+120000;
  env.background(workDailyRun(id,env).then(async r=>{
   if(!r.continue)return;
   if(r.status==='LEASE_RECOVERY_PENDING'){
    if(!('lease_until' in r)||!('not_before' in r)||typeof r.lease_until!=='string'||typeof r.not_before!=='string')return;
    const leaseUntil=Date.parse(r.lease_until),notBefore=Date.parse(r.not_before);
    if(!Number.isFinite(leaseUntil)||!Number.isFinite(notBefore)||notBefore<leaseUntil+1000)return;
    const wait=Math.max(0,notBefore-Date.now());
    if(Date.now()+wait+5000>backgroundDeadline)return;
    await env.sleep(wait);
    if(Date.now()<notBefore||Date.now()+5000>backgroundDeadline)return;
    // One fenced reclaim attempt after expiry. SQL owns the actual state,
    // attempt budget and cutoff; this is not proof of a completed FINISH.
    await env.continueRun(id);return;
   }
   // A Canonical wait is a bounded 30s continuation, not a provider backoff.
   // Keep it inside the background budget and hand off once, without blocking
   // Core. Longer provider delays remain durable for the existing lifecycle.
   const delay='retry_after_seconds' in r?Number(r.retry_after_seconds):3;
   const canonicalWait='reason' in r&&r.reason==='CANONICAL_PUBLICATION_PENDING'&&delay===30;
   if(!Number.isFinite(delay)||delay<0||(!canonicalWait&&delay>20)||Date.now()+Math.max(3,delay)*1000+5000>backgroundDeadline)return;
   await env.sleep(Math.max(3,delay)*1000);
   if(Date.now()+5000>backgroundDeadline)return;
   await env.continueRun(id);
  }).catch(e=>{
   const message=e instanceof Error?e.message:'';
   console.warn('VNEXT_BACKGROUND_NOT_COMPLETED',/^[A-Z0-9_]{1,100}$/.test(message)?message:'INTEGRATION_FAILED');
  }));
  return reply(202,{status:'DURABLY_QUEUED',run_id:id,member_published:0});
 }catch{return reply(409,{error:'RUNTIME_ADMISSION_REJECTED'});}
}
