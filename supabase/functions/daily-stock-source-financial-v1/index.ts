import {handleFinancialStage} from '../daily-stock-analysis-v1/financial-stage.ts';
import {createFinancialRefresh} from '../daily-stock-analysis-v1/financial-refresh.ts';
import {createClient} from '../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false,autoRefreshToken:false}});
const reads=new Set(['load_daily_stock_ai_sec_replay_v1','load_daily_stock_ai_issuer_ir_replay_v1','load_daily_stock_ai_umc_ir_replay_v1','load_daily_stock_ai_institutional_replay_v1','load_daily_stock_ai_issuer16_replay_v1','load_daily_stock_ai_portal_margin_replay_v1']);
const refresh=createFinancialRefresh(async(name,args,signal)=>{if(!reads.has(name))throw Error('READ_SCOPE_INVALID');const timeout=AbortSignal.timeout(8000);const r=await db.rpc(name,args).abortSignal(signal?AbortSignal.any([signal,timeout]):timeout);if(r.error)throw Error('AI_BATCH_DATABASE_REJECTED');return r.data;});
Deno.serve(request=>handleFinancialStage(request,{internalSecret:Deno.env.get('CRON_SECRET')??'',refresh,fetcher:fetch,clock:()=>new Date().toISOString()}));
