import {createClient} from "../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs";
import {handleVnextDaily} from './handler.ts';
import {continueVnextRun} from '../_shared/vnext-daily-hook.ts';
const url=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u:Parameters<typeof fetch>[0],i?:Parameters<typeof fetch>[1])=>fetch(u,{...i,signal:AbortSignal.timeout(8000)})}});
Deno.serve(req=>handleVnextDaily(req,{
 cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch,clock:()=>new Date().toISOString(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),
 rpc:async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error(name==='vnext_daily_runtime_v1'&&args.p_op==='PREDICTIONS'&&r.error.message==='FORWARD_TIME_INVALID'?'FORWARD_TIME_INVALID':'DATABASE_RPC_REJECTED');return r.data;},
 background:p=>{const rt=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;if(!rt)throw Error('BACKGROUND_REQUIRED');rt.waitUntil(p);},
 continueRun:run_id=>continueVnextRun(run_id,{url,gatewayJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')??'',cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch}),
}));
