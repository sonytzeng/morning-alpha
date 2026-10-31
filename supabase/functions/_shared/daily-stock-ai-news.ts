/** Existing server news collector only. Credentials and returned provider bodies
 * never leave this port. Failure leaves an explicit gap in the new snapshot. */
export async function collectDailyStockAiNews(config:{baseUrl:string;internalSecret:string;fetcher:typeof fetch;signal:AbortSignal},timeoutMs=20000){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000||new TextEncoder().encode(config.internalSecret).byteLength<24)throw Error('AI_INTAKE_NEWS_CONFIGURATION');
 const endpoint=new URL('/functions/v1/fetch-global-market-news',config.baseUrl);
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Error('AI_INTAKE_NEWS_CONFIGURATION');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let rejectAbort:(reason:Error)=>void=()=>{};
 const cancellation=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const abort=()=>{rejectAbort(Error('AI_INTAKE_NEWS_ABORTED'));controller.abort();};
 config.signal.addEventListener('abort',abort,{once:true});if(config.signal.aborted)abort();
 try{
  const result=await Promise.race([Promise.resolve().then(async()=>{
   if(controller.signal.aborted)throw Error('AI_INTAKE_NEWS_ABORTED');
   const response=await config.fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':config.internalSecret},body:'{}',signal:controller.signal});
   if(!response.ok||Number(response.headers.get('content-length'))>200000)throw Error('AI_INTAKE_NEWS_UNAVAILABLE');
   const reader=response.body?.getReader();if(!reader)throw Error('AI_INTAKE_NEWS_UNAVAILABLE');
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>200000)throw Error('AI_INTAKE_NEWS_LIMIT');chunks.push(next.value);}}
   finally{try{await reader.cancel();}catch{/* Aborted transport. */}reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const body:unknown=JSON.parse(new TextDecoder().decode(bytes));
   return {complete:!!body&&typeof body==='object'&&!Array.isArray(body)&&(body as Record<string,unknown>).success===true&&(body as Record<string,unknown>).canonical_complete===true};
  }),cancellation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error('AI_INTAKE_NEWS_TIMEOUT'));controller.abort();},timeoutMs);})]);
  return result;
 }catch{throw Error('AI_INTAKE_NEWS_UNAVAILABLE');}
 finally{if(timer)clearTimeout(timer);config.signal.removeEventListener('abort',abort);controller.abort();}
}
