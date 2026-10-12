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
  env.background(workDailyRun(id,env).then(async r=>{
   if(!r.continue)return;
   // Short retries fit the current background budget. Longer Retry-After is
   // durably recorded and resumed by the next existing lifecycle checkpoint;
   // never burn hundreds of immediate invocations while a provider is gated.
   const delay='retry_after_seconds' in r?Number(r.retry_after_seconds):3;
   if(delay>20)return;
   await env.sleep(Math.max(3,delay)*1000);await env.continueRun(id);
  }).catch(()=>{}));
  return reply(202,{status:'DURABLY_QUEUED',run_id:id,member_published:0});
 }catch{return reply(409,{error:'RUNTIME_ADMISSION_REJECTED'});}
}
