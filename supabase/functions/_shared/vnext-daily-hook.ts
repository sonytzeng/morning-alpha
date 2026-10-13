/** Candidate-only nonblocking notification. Existing V2 result is immutable and
 * unaffected even when this independent queue/worker is unavailable. */
export function enqueueVnextAfterCheckpoint(input:Record<string,unknown>,
 options:{url:string;gatewayJwt:string;cronSecret:string;background:(p:Promise<unknown>)=>void;fetcher:typeof fetch}){
 const task=Promise.resolve().then(async()=>{
  const r=await options.fetcher(options.url+'/functions/v1/vnext-daily-research-v1',{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),
   headers:{Authorization:'Bearer '+options.gatewayJwt,'x-vnext-internal':options.cronSecret,'Content-Type':'application/json'},
   body:JSON.stringify({business_date:input.business_date,phase:input.evaluation_phase,source_batch_id:input.source_batch_id})});await r.body?.cancel();
 }).catch(()=>{});
 try{options.background(task);}catch{/* Only next existing checkpoint may retry; never fail Core/V2. */}
}
