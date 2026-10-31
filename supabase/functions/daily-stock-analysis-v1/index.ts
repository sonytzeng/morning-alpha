import {createClient} from '../_shared/_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs';
import {handleDailyStockAnalysis,stockAnalysisRequestRejection,readStockAnalysisRequestText,type StoredStockAnalysisBatch} from './handler.ts';
import {runStoredStockAiBatch,runStoredStockAiCitationRepair,parseStockAiProgress,stockAiModelRevision} from '../_shared/daily-stock-ai-runner.ts';
import {authorizeDailyStockAnalysisRequest} from '../_shared/daily-stock-ai-auth.ts';
import {stageCompletedStockAiBatch} from './checkpoint.ts';
import {loadOrIntakeDailyStockAiBatch} from './intake.ts';
import {handleDailyStockSource} from './source-handler.ts';
import {prepareDailyStockAiSource} from './source.ts';
import {collectDailyAiOfficialNews} from '../../../research/daily-ai-official-news.ts';
import {collectDailyAiGlobalMarket} from '../../../research/daily-ai-global-market.ts';
import {refreshDailyAiFinancials} from '../../../research/daily-ai-financial-refresh.ts';
import {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';
import {withDocumentedReviewV2Financials,withDocumentedReviewV2SourceRpc} from '../../../research/documented-review-replay-v2.candidate.ts';
import {handleDailyStockCitationRepair} from './repair-handler.ts';
import {handleDailyStockRateLimitRecovery} from './rate-limit-recovery-handler.ts';
import {runStoredStockAiRateLimitRecovery,stockAiRateLimitRecoveryRevision} from './rate-limit-recovery-runner.ts';

const url=Deno.env.get('SUPABASE_URL')??'',service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const internalSecret=Deno.env.get('CRON_SECRET')??'',model='gpt-6-astra';
// Actual V5 two-pilot quality and time review passed before bounded continuation.
const autoContinue=true;
const modelRevision=stockAiModelRevision(model);
export function dailyStockAiRpcTimeoutMs(u:Parameters<typeof fetch>[0],i?:RequestInit){
 try{
  const target=u instanceof Request?u.url:String(u);
  if(new URL(target).pathname!=='/rest/v1/rpc/daily_stock_ai_intake_v1'||i?.method!=='POST'||typeof i.body!=='string')return 8000;
  const body:unknown=JSON.parse(i.body);
  return body&&typeof body==='object'&&!Array.isArray(body)&&Object.hasOwn(body,'p_op')
   &&(body as {p_op:unknown}).p_op==='SOURCE'?16000:8000;
 }catch{return 8000;}
}
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false},global:{
 fetch:(u:Parameters<typeof fetch>[0],i?:RequestInit)=>{
  // SOURCE verifies raw observations and returns the immutable 72-stock view.
  // Its larger response has a bounded allowance; other RPC deadlines stay put.
  const timeout=AbortSignal.timeout(dailyStockAiRpcTimeoutMs(u,i));
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
 if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(input,'recovery_symbol')){
  return handleDailyStockRateLimitRecovery(req,{
   internalSecret,clock:()=>new Date().toISOString(),
   loadBatch:(batchId,signal)=>loadOrIntakeDailyStockAiBatch({batch_id:batchId},rpc,signal),
   loadFence:(selector,signal)=>rpc('load_daily_stock_ai_rate_limit_recovery_v1',{p_batch_id:selector.batch_id,p_symbol:selector.recovery_symbol,p_review_document_hash:selector.review_document_hash},signal),
   runRecovery:(packets,selector,signal)=>runStoredStockAiRateLimitRecovery(packets,selector,{
    rpc:(name,args)=>rpc(name,args,args.p_op==='COMPLETE'?undefined:signal),
    apiKey:Deno.env.get('OPENAI_API_KEY')??'',fetcher:fetch,signal,
    onCandidate:async(candidate,receipt,inputHash,packet)=>{
     const retained=await rpc('retain_daily_ai_model_candidate_v1',{p_input_hash:inputHash,p_model_revision:stockAiRateLimitRecoveryRevision,
      p_symbol:packet.symbol,p_cutoff:packet.cutoff,p_candidate:candidate,p_receipt:receipt},signal);
     if(!retained||retained.state!=='RETAINED'||retained.member_published!==false)throw Error('STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED');
    },
   }),
  });
 }
 if(input&&typeof input==='object'&&!Array.isArray(input)&&(Object.hasOwn(input,'repair_symbol')||Object.hasOwn(input,'review_document_hash'))){
  return handleDailyStockCitationRepair(req,{
   internalSecret,clock:()=>new Date().toISOString(),
   loadBatch:(batchId,signal)=>loadOrIntakeDailyStockAiBatch({batch_id:batchId},rpc,signal),
   loadFence:(selector,signal)=>rpc('load_daily_stock_ai_citation_repair_v1',{p_batch_id:selector.batch_id,p_symbol:selector.repair_symbol,p_review_document_hash:selector.review_document_hash},signal),
   runRepair:(packets,symbol,signal,revision)=>runStoredStockAiCitationRepair(packets,symbol,{
    rpc:(name,args)=>rpc(name,args,args.p_op==='COMPLETE'?undefined:signal),
    apiKey:Deno.env.get('OPENAI_API_KEY')??'',fetcher:fetch,signal,
    onCandidate:async(candidate,receipt,inputHash,packet)=>{
     const retained=await rpc('retain_daily_ai_model_candidate_v1',{p_input_hash:inputHash,p_model_revision:revision,
      p_symbol:packet.symbol,p_cutoff:packet.cutoff,p_candidate:candidate,p_receipt:receipt},signal);
     if(!retained||retained.state!=='RETAINED'||retained.member_published!==false)throw Error('STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED');
    },
   },revision),
  });
 }
 if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(input,'intake_id')){
  return handleDailyStockSource(req,{internalSecret,runSource:(intakeId,signal)=>prepareDailyStockAiSource(intakeId,{
   rpc:withDocumentedReviewV2SourceRpc(rpc,()=>new Date().toISOString()),fetcher:fetch,clock:()=>new Date().toISOString(),
   collectNews:({inputs,businessDate,signal:newsSignal})=>collectDailyAiOfficialNews({inputs,businessDate,fetcher:fetch,clock:()=>new Date().toISOString(),signal:newsSignal}),
   collectMarket:({businessDate,signal:marketSignal})=>collectDailyAiGlobalMarket({businessDate,signal:marketSignal,fetcher:fetch,clock:()=>new Date().toISOString()}),
   refreshFinancials:withDocumentedReviewV2Financials(withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal))),
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
   // A human dispatches exactly two semantic pilots. Sorting changes neither
   // packet bytes nor job identities, so completed pilots remain reusable.
   const priority=new Map([['1504',0],['2330',1]]);
   const ordered=packets.map((packet,index)=>({packet,index})).sort((a,b)=>(priority.get(a.packet.symbol)??2)-(priority.get(b.packet.symbol)??2)||a.index-b.index).map(p=>p.packet);
   return runStoredStockAiBatch(ordered,{
    // Once a paid result is valid, allow its bounded COMPLETE write to settle.
    // Interrupting an unknown commit must not unlock a duplicate paid request.
    rpc:(name,args)=>rpc(name,args,args.p_op==='COMPLETE'?undefined:signal),
    apiKey:Deno.env.get('OPENAI_API_KEY')??'',model,fetcher:fetch,signal,completed,
    onCandidate:async(candidate,receipt,inputHash,packet)=>{
     const retained=await rpc('retain_daily_ai_model_candidate_v1',{p_input_hash:inputHash,p_model_revision:modelRevision,
      p_symbol:packet.symbol,p_cutoff:packet.cutoff,p_candidate:candidate,p_receipt:receipt},signal);
     if(!retained||retained.state!=='RETAINED'||retained.member_published!==false)throw Error('STOCK_AI_CANDIDATE_RETAIN_UNCONFIRMED');
    },
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
  if(autoContinue&&summary.requires_next_checkpoint===true&&summary.model_calls===1&&summary.counts?.COMPLETE===1&&typeof summary.batch_id==='string'){
   const task=rpc('dispatch_daily_stock_ai_batch_v1',{p_batch_id:summary.batch_id}).catch(()=>{console.warn('STOCK_AI_CONTINUATION_PENDING');});
   const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(p:Promise<unknown>)=>void}}).EdgeRuntime;
   if(runtime)runtime.waitUntil(task);else await task;
  }
 }
 return response;
});
