import {createClient} from '../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
import {handleDailyStockAnalysis,stockAnalysisRequestRejection,readStockAnalysisRequestText,type StoredStockAnalysisBatch} from './handler.ts';
import {runStoredStockAiBatch,parseStockAiProgress,stockAiModelRevision} from '../_shared/daily-stock-ai-runner.ts';
import {authorizeDailyStockAnalysisRequest} from '../_shared/daily-stock-ai-auth.ts';
import {stageCompletedStockAiBatch} from './checkpoint.ts';
import {loadOrIntakeDailyStockAiBatch} from './intake.ts';
import {handleDailyStockSource} from './source-handler.ts';
import {prepareDailyStockAiSource} from './source.ts';
import {collectDailyStockAiNews} from '../_shared/daily-stock-ai-news.ts';
import {collectDailyAiGlobalMarket} from '../../../research/daily-ai-global-market.ts';

const url=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const internalSecret=Deno.env.get('CRON_SECRET')??'',model='gpt-4o-mini';
const modelRevision=stockAiModelRevision(model);
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{
 fetch:(u:Parameters<typeof fetch>[0],i?:Parameters<typeof fetch>[1])=>{
  const timeout=AbortSignal.timeout(8000);
  // Preserve caller cancellation instead of replacing it with a fresh timeout.
  return fetch(u,{...i,signal:i?.signal?AbortSignal.any([i.signal,timeout]):timeout});
 },
}});
const rpc=async(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>{
 const query=db.rpc(name,args),r=await(signal?query.abortSignal(signal):query);
 if(r.error)throw Error('AI_BATCH_DATABASE_REJECTED');return r.data;
};
Deno.serve(async request=>{
 const authorized=await authorizeDailyStockAnalysisRequest(request,{
  internalSecret,findDeliveryTokenHash:async signal=>{
   const r=await db.from('runtime_job_tokens').select('token_hash,is_active')
    .eq('name','morning_alpha_daily_delivery').maybeSingle().abortSignal(signal);
   if(r.error)throw Error('STOCK_AI_AUTH_UNAVAILABLE');return r.data;
  },
 });
 const rejected=stockAnalysisRequestRejection(authorized,internalSecret);if(rejected)return rejected;
 let text:string,input:unknown;
 try{text=await readStockAnalysisRequestText(authorized);input=JSON.parse(text);}
 catch(error){const limited=error instanceof Error&&error.message==='INPUT_LIMIT';
  return Response.json({error:limited?'INPUT_LIMIT':'SCOPE_INVALID',model_calls:0,member_published:false},{status:limited?413:422,headers:{'Cache-Control':'no-store'}});
 }
 const req=new Request(authorized,{body:text});
 if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(input,'intake_id')){
  return handleDailyStockSource(req,{internalSecret,runSource:(intakeId,signal)=>prepareDailyStockAiSource(intakeId,{
   rpc,fetcher:fetch,clock:()=>new Date().toISOString(),
   collectNews:newsSignal=>collectDailyStockAiNews({baseUrl:url,internalSecret,fetcher:fetch,signal:newsSignal}),
   collectMarket:({businessDate,signal:marketSignal})=>collectDailyAiGlobalMarket({businessDate,signal:marketSignal,fetcher:fetch,clock:()=>new Date().toISOString()}),
  },signal)});
 }
 let loaded:StoredStockAnalysisBatch|null=null;
 const response=await handleDailyStockAnalysis(req,{
  internalSecret,clock:()=>new Date().toISOString(),
  loadBatch:async(selector,signal)=>{
   loaded=await loadOrIntakeDailyStockAiBatch(selector,rpc,signal);
   return loaded;
  },
  runBatch:async(packets,maxStocks,signal)=>{
   if(!loaded)throw Error('AI_BATCH_SOURCE_REQUIRED');
   const progress=await rpc('load_daily_stock_ai_progress_v1',{p_batch_id:loaded.id,p_model_revision:modelRevision},signal);
   const completed=parseStockAiProgress(progress,loaded.id,modelRevision);
   return runStoredStockAiBatch(packets,{
    // Once a paid result is valid, allow its bounded COMPLETE write to settle.
    // Interrupting an unknown commit must not unlock a duplicate paid request.
    rpc:(name,args)=>rpc(name,args,args.p_op==='COMPLETE'?undefined:signal),
    apiKey:Deno.env.get('OPENAI_API_KEY')??'',model,fetcher:fetch,signal,completed,
   },maxStocks);
  },
 });
 if(response.ok||response.status===207){
  const summary=await response.clone().json();
  if(summary.status==='ANALYSIS_COMPLETE'&&loaded){
   const staged=await stageCompletedStockAiBatch(summary,loaded,modelRevision,rpc);
   return Response.json({...summary,...staged},{status:staged.requires_stage_checkpoint?202:200,headers:{'Cache-Control':'no-store'}});
  }
  // SQL limits total dispatches and each job's attempts. Busy/cache-only calls
  // never form a continuation loop; only an actual bounded model call advances.
  if(summary.requires_next_checkpoint===true&&summary.model_calls===1&&typeof summary.batch_id==='string'){
   const task=rpc('dispatch_daily_stock_ai_batch_v1',{p_batch_id:summary.batch_id}).catch(()=>{console.warn('STOCK_AI_CONTINUATION_PENDING');});
   const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;
   if(runtime)runtime.waitUntil(task);else await task;
  }
 }
 return response;
});
