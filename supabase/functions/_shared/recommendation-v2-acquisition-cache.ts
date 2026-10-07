/** Server-only normalized source reuse. No Decision caching or backdating. */
type RecordValue=Record<string,unknown>;
const object=(v:unknown):RecordValue=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:{};
export async function sharedV2Acquisition<T extends RecordValue>(options:{
 claim:()=>PromiseLike<{data:unknown;error:unknown}>;
 finish:(lease:string,payload:T|null)=>PromiseLike<{error:unknown}>;
 acquire:()=>Promise<T>;
 signal:AbortSignal;
 shadowOnly:boolean;
 sleep?:(ms:number)=>Promise<void>;
}):Promise<T>{
 const sleep=options.sleep??(ms=>new Promise<void>(r=>setTimeout(r,ms)));
 // Finite iterations AND caller deadline. No independent unbounded retry loop.
 for(let i=0;i<120;i++){
  options.signal.throwIfAborted();
  let response:{data:unknown;error:unknown};
  try{response=await options.claim();}catch{response={data:null,error:true};}
  if(response.error){
   // Preserve the formal producer's existing source acquisition when research
   // storage is unavailable. A Shadow caller never starts a competing fallback.
   if(options.shadowOnly)throw Error('SHADOW_ACQUISITION_COORDINATOR_UNAVAILABLE');
   return options.acquire();
  }
  const receipt=object(response.data);
  if(receipt.status==='CACHED')return object(receipt.payload) as T;
  if(receipt.status==='ACQUIRED'&&typeof receipt.lease_id==='string'){
   try{
    const payload=await options.acquire();
    // Cache persistence is fail-open for source acquisition, not business data.
    await Promise.resolve(options.finish(receipt.lease_id,payload)).catch(()=>({error:true}));
    return payload;
   }catch(error){await Promise.resolve(options.finish(receipt.lease_id,null)).catch(()=>({error:true}));throw error;}
  }
  if(receipt.status!=='IN_PROGRESS')throw Error('ACQUISITION_COORDINATOR_CONTRACT');
  await sleep(2000);
 }
 throw Error('ACQUISITION_COORDINATOR_DEADLINE');
}
