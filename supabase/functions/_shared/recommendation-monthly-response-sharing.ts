/** Same-bundle reuse of two anonymous official monthly responses. Each parser
 * keeps its own reader/deadline, original bytes/hash and refusal contract. */
const MONTHLY_URLS = new Set([
 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O',
]);
const MAX_BYTES=8_000_000, PRESERVED_CHUNKS=4097, UPSTREAM_MS=8000;
type Snapshot={status:number;statusText:string;headers:Headers;chunks:Uint8Array[];missingBody:boolean;limited:boolean;body:Promise<void>};
const safeError=(error:unknown,fallback:string)=>error instanceof Error&&['V2_ACQUISITION_DEADLINE','V2_RESPONSE_LIMIT'].includes(error.message)?Error(error.message):Error(fallback);
function bounded<T>(work:PromiseLike<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(Error('V2_ACQUISITION_DEADLINE'));};
  Promise.resolve(work).then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(value);},error=>{
   signal.removeEventListener('abort',abort);reject(safeError(error,'MONTHLY_SOURCE_TRANSPORT_FAILURE'));
  });
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
 });
}
const discard=(response:Response)=>{void response.body?.cancel().catch(()=>{});};

export function createMonthlyResponseSharing(options:{fetcher:typeof fetch;signal:AbortSignal}){
 const cache=new Map<string,Promise<Snapshot>>(),controllers=new Set<AbortController>(),snapshots=new Set<Snapshot>();let closed=false;
 const acquire=async(url:string):Promise<Snapshot>=>{
  const controller=new AbortController();controllers.add(controller);
  const signal=AbortSignal.any([options.signal,controller.signal,AbortSignal.timeout(UPSTREAM_MS)]),deadline=performance.now()+UPSTREAM_MS;
  try{
   const pending=options.fetcher(url,{method:'GET',credentials:'omit',redirect:'error',signal}).then(response=>{
    if(signal.aborted){discard(response);throw Error('V2_ACQUISITION_DEADLINE');}return response;
   });
   const response=await bounded(pending,signal);
   const result:Snapshot={status:response.status,statusText:response.statusText,headers:new Headers(response.headers),chunks:[],missingBody:response.body===null,limited:false,body:Promise.resolve()};
   snapshots.add(result);
   if(!response.ok||!response.body){discard(response);controllers.delete(controller);return result;}
   // Expose headers now: a later body error must not erase the observed HTTP200.
   result.body=(async()=>{
    const reader=response.body!.getReader();let size=0,count=0,tail:Uint8Array|null=null,tailSize=0;
    try{while(true){
     if(performance.now()>=deadline)throw Error('V2_ACQUISITION_DEADLINE');
     const part=await bounded(reader.read(),signal);if(part.done)break;
     const remaining=MAX_BYTES-size,chunk=part.value.subarray(0,Math.max(0,remaining));
     // First4097 boundaries preserve Official's4096-read refusal. Afterwards
     // coalesce raw bytes; V2 has no chunk-count gate and keeps its8MB contract.
     if(++count<=PRESERVED_CHUNKS)result.chunks.push(chunk.slice());
     else if(chunk.byteLength){tail??=new Uint8Array(remaining);tail.set(chunk,tailSize);tailSize+=chunk.byteLength;}
     size+=chunk.byteLength;
     if(part.value.byteLength>remaining){result.limited=true;break;}
    }
    if(tailSize)result.chunks.push(tail!.subarray(0,tailSize));
    }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Pending late reads remain observed. */}controllers.delete(controller);}
   })();
   void result.body.catch(()=>{});return result;
  }catch(error){controllers.delete(controller);throw safeError(error,'MONTHLY_SOURCE_TRANSPORT_FAILURE');}
 };
 const fetcher:typeof fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:null;
  // Other init fields, credentials, Request objects and financial-profile
  // Accept headers retain their original transport; they never enter this map.
  const plain=Object.keys(init??{}).every(key=>['method','credentials','redirect','signal','headers'].includes(key))&&
   init?.headers===undefined&&(init?.credentials===undefined||init.credentials==='omit')&&
   (init?.method===undefined||init.method==='GET')&&init?.redirect==='error';
  if(!url||!MONTHLY_URLS.has(url)||!plain)return options.fetcher(input,init);
  if(closed||options.signal.aborted||init?.signal?.aborted)throw Error('V2_ACQUISITION_DEADLINE');
  let pending=cache.get(url);if(!pending){pending=acquire(url);cache.set(url,pending);void pending.catch(()=>{});}
  const snapshot=await bounded(pending,init?.signal??options.signal);
  if(closed||init?.signal?.aborted)throw Error('V2_ACQUISITION_DEADLINE');
  let index=0,cancelled=false;
  const body=snapshot.missingBody||snapshot.status===204||snapshot.status===205||snapshot.status===304?null:new ReadableStream<Uint8Array>({
   async pull(controller){
    try{
     await bounded(snapshot.body,init?.signal??options.signal);
     if(cancelled)return;
     if(closed)throw Error('V2_ACQUISITION_DEADLINE');
     if(index<snapshot.chunks.length){controller.enqueue(snapshot.chunks[index++].slice());return;}
     if(snapshot.limited)controller.error(Error('V2_RESPONSE_LIMIT'));else controller.close();
    }catch(error){if(!cancelled)controller.error(safeError(error,'MONTHLY_SOURCE_BODY_UNAVAILABLE'));}
   },cancel(){cancelled=true;},
  });
  return new Response(body,{status:snapshot.status,statusText:snapshot.statusText,headers:snapshot.headers});
 };
 return {fetcher,dispose(){closed=true;for(const controller of controllers)controller.abort();controllers.clear();for(const snapshot of snapshots)snapshot.chunks.length=0;snapshots.clear();cache.clear();}};
}
