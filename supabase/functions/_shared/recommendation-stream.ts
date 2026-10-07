/** Authorized, bounded JSON transport. Whitespace keeps the gateway response
 * active without inventing partial evidence. The final result is one JSON
 * object; HTTP200 is transport-only, transport_result_status is authoritative.
 * Call ONLY after request authentication and input validation. */
export function recommendationJsonStream(work:()=>Promise<Response>,signal:AbortSignal,options:{heartbeatMs?:number;deadlineMs?:number}={}){
 const encoder=new TextEncoder();let finish=()=>{};
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   let done=false;
   const stop=()=>{if(done)return;done=true;clearInterval(heartbeat);clearTimeout(deadline);signal.removeEventListener('abort',abort);};
   const complete=(body:Record<string,unknown>,status:number)=>{if(done)return;stop();controller.enqueue(encoder.encode(JSON.stringify({...body,transport_result_status:status})));controller.close();};
   const abort=()=>{if(done)return;stop();controller.error(new Error('RECOMMENDATION_REQUEST_ABORTED'));};
   const heartbeat=setInterval(()=>{if(!done)controller.enqueue(encoder.encode('\n'));},options.heartbeatMs??15000);
   const deadline=setTimeout(()=>complete({error:'RECOMMENDATION_TRANSPORT_DEADLINE',business_writes:[]},504),options.deadlineMs??285000);
   finish=stop;signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){abort();return;}
   controller.enqueue(encoder.encode('\n'));
   void (async()=>{try{
    const response=await work();const body:unknown=await response.json();
    if(!body||typeof body!=='object'||Array.isArray(body))throw Error('INVALID_RESULT');
    complete(body as Record<string,unknown>,response.status);
   }catch{complete({error:'RECOMMENDATION_TRANSPORT_FAILED',business_writes:[]},502);}})();
  },cancel(){finish();},
 });
 return new Response(stream,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
