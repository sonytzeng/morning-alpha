import {createClient} from "../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs";
import {handleVnextDaily} from './handler.ts';
import {continueVnextRun} from '../_shared/vnext-daily-hook.ts';
const url=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u:Parameters<typeof fetch>[0],i?:Parameters<typeof fetch>[1])=>fetch(u,{...i,signal:AbortSignal.timeout(8000)})}});
// Fixed vocabulary only. Error prose, request arguments and credentials never
// enter this diagnostic; the original refusal and lease behavior is unchanged.
const rpcNames=['enqueue_vnext_daily_research_v1','claim_vnext_daily_research_v1','vnext_daily_runtime_v1'];
const runtimeOps=['PLAN','SOURCE_BEGIN','SOURCE_SAVE','SOURCE_FAIL','CURSOR','ENTRY_SOURCE','SOURCES','CHECKPOINT','CHECKPOINT_STATE','PREDICTIONS','DUE_OUTCOMES','OUTCOME','OUTCOME_CHECKED','FINISH'];
const sqlStates=['08000','08001','08003','08004','08006','08007','08P01','22023','22P02','23503','23505','23514','40001','40P01','42501','42703','42883','42P01','53200','53300','54000','54001','55P03','57014','P0001','P0002','P0003','XX000'];
const postgrestCodes=['PGRST000','PGRST001','PGRST002','PGRST003','PGRST100','PGRST102','PGRST103','PGRST106','PGRST107','PGRST108','PGRST116','PGRST200','PGRST201','PGRST202','PGRST203','PGRST204','PGRST205','PGRST300','PGRST301','PGRST302'];
const timeoutCodes=['23','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'];
Deno.serve(req=>handleVnextDaily(req,{
 cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch,clock:()=>new Date().toISOString(),sleep:ms=>new Promise(r=>setTimeout(r,ms)),
 rpc:async(name,args)=>{const r=await db.rpc(name,args);if(r.error){
  const rpc=rpcNames.includes(name)?name:'UNKNOWN_RPC';
  const op=rpc==='vnext_daily_runtime_v1'?(typeof args.p_op==='string'&&runtimeOps.includes(args.p_op)?args.p_op:'UNKNOWN_OPERATION'):rpc==='UNKNOWN_RPC'?'UNKNOWN_OPERATION':'NOT_APPLICABLE';
  const code=r.error.code;
  const category=r.status===0?(timeoutCodes.includes(code)?'REQUEST_TIMEOUT':'TRANSPORT_FAILURE'):
   sqlStates.includes(code)?'SQLSTATE_'+code:postgrestCodes.includes(code)?code:'UNKNOWN_ERROR';
  try{console.warn('VNEXT_DATABASE_RPC_REJECTED',rpc,op,category);}catch{/* Diagnostics cannot change the original refusal. */}
  throw Error(name==='vnext_daily_runtime_v1'&&args.p_op==='PREDICTIONS'&&r.error.message==='FORWARD_TIME_INVALID'?'FORWARD_TIME_INVALID':'DATABASE_RPC_REJECTED');
 }return r.data;},
 background:p=>{const rt=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;if(!rt)throw Error('BACKGROUND_REQUIRED');rt.waitUntil(p);},
 continueRun:run_id=>continueVnextRun(run_id,{url,gatewayJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')??'',cronSecret:Deno.env.get('CRON_SECRET')??'',fetcher:fetch}),
 stagePublication:async run_id=>{
  const result=await db.rpc('stage_vnext_daily_publication_batch_v1',{p_run:run_id});
  if(result.error)throw Error('PUBLICATION_INTAKE_FAILED');
 },
}));
