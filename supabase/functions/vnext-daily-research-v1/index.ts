import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {handleVnextDaily} from './handler.ts';
import {continueVnextRun} from '../_shared/vnext-daily-hook.ts';
const url=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,i)=>fetch(u,{...i,signal:AbortSignal.timeout(8000)})}});
Deno.serve(req=>handleVnextDaily(req,{
 cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch,clock:()=>new Date().toISOString(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),
 rpc:async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('DATABASE_RPC_REJECTED');return r.data;},
 background:p=>{const rt=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;if(!rt)throw Error('BACKGROUND_REQUIRED');rt.waitUntil(p);},
 continueRun:run_id=>continueVnextRun(run_id,{url,gatewayJwt:Deno.env.get('SUPABASE_ANON_KEY')??'',cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch}),
}));
