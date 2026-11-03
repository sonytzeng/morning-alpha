import {timingSafeEqual} from 'node:crypto';

const bytes=(value:string)=>new TextEncoder().encode(value);
function matches(presented:string,expected:string){
 const a=bytes(presented),b=bytes(expected);
 return a.byteLength===b.byteLength&&timingSafeEqual(a,b);
}
export type DailyStockAuthPorts={
 internalSecret:string;
 // The caller fixes the server-side token name. Member input cannot select it.
 findDeliveryTokenHash:(signal:AbortSignal)=>Promise<{token_hash:string;is_active:boolean}|null>;
};
/** Bridge the existing dispatcher token to the internal worker credential.
 * Lookup, hash and timeout errors fail closed without exposing either secret. */
export async function authorizeDailyStockAnalysisRequest(request:Request,ports:DailyStockAuthPorts,lookupMs=5000):Promise<Request>{
 if(request.method!=='POST'||request.headers.has('origin')||bytes(ports.internalSecret).byteLength<24)return request;
 if(matches(request.headers.get('x-vnext-internal')??'',ports.internalSecret))return request;
 const token=request.headers.get('x-daily-delivery-token')??'',size=bytes(token).byteLength;
 if(size<24||size>512||!Number.isInteger(lookupMs)||lookupMs<1||lookupMs>5000)return request;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const stored=await Promise.race([Promise.resolve().then(()=>ports.findDeliveryTokenHash(controller.signal)),new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(Error('STOCK_AI_AUTH_UNAVAILABLE'));},lookupMs);
  })]);
  if(!stored||stored.is_active!==true||!/^[a-f0-9]{64}$/.test(stored.token_hash))return request;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(token))),value=>value.toString(16).padStart(2,'0')).join('');
  if(!matches(digest,stored.token_hash))return request;
  const headers=new Headers(request.headers);headers.set('x-vnext-internal',ports.internalSecret);
  return new Request(request,{headers});
 }catch{return request;}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
