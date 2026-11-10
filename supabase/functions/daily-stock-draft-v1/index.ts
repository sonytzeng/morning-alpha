import {createClient} from '../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
import {handleZeroPaidStockDraft} from '../daily-stock-analysis-v1/zero-paid-draft.ts';
const internalSecret=Deno.env.get('CRON_SECRET')??'';
const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{
 auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u:Parameters<typeof fetch>[0],i?:RequestInit)=>{
  const timeout=AbortSignal.timeout(8000);return fetch(u,{...i,signal:i?.signal?AbortSignal.any([i.signal,timeout]):timeout});
 }}});
const rpc=async(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>{
 const query=db.rpc(name,args),result=await(signal?query.abortSignal(signal):query);
 if(result.error)throw Error('AI_BATCH_DATABASE_REJECTED');return result.data;
};
Deno.serve(request=>handleZeroPaidStockDraft(request,{internalSecret,rpc,clock:()=>new Date().toISOString()}));
