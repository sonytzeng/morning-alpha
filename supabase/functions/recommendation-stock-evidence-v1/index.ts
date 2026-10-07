import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { loadDecisionEvidence } from '../_shared/decision-v1-data.ts';
import { acquireStockEvidence, buildRecommendationProof, stockAcquisitionCoverage, RECOMMENDATION_UNIVERSE } from '../_shared/recommendation-stock-evidence.ts';
import { isMarketTradingDate } from '../_shared/market-session-contract.mjs';
import { acquireOfficialActuals } from '../_shared/recommendation-official-actuals.ts';
import { acquireCompanyEvents } from '../_shared/recommendation-company-events.ts';
import { recommendationJsonStream } from '../_shared/recommendation-stream.ts';
import { startV2SourceAcquisition, selectV2InstitutionalSources } from '../_shared/recommendation-shadow-v2-sources.ts';
import { buildV2Capsule } from '../_shared/recommendation-shadow-v2-runtime.ts';
import { sharedV2Acquisition } from '../_shared/recommendation-v2-acquisition-cache.ts';

// Server-only acquisition with a short research cache/lease; no formal business writes.
// Existing internal identity validator remains unchanged.
// No Cron, RLS changes, Core writes, LINE, strategy promotion or historical backfill.
Deno.serve(async (request:Request)=>{
 const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 const auth=await authorizeInternalRequest(request.headers,internalCredentialsFromEnv());
 if(!auth.ok)return reply(401,{error:auth.error_code});
 try{
  const text=await request.text();if(text.length>1024)return reply(413,{error:'INPUT_LIMIT'});
  const input=JSON.parse(text) as Record<string,unknown>;
  // An explicit one-stock probe can never be confused with a full-universe
  // decision proof. Do not accept arbitrary symbols or arbitrary provider URLs.
  if(Object.keys(input).some(k=>!['business_date','correlation_id','scope'].includes(k))||
   (input.scope!==undefined&&!['SMOKE_2330','UNIVERSE_72'].includes(String(input.scope))))return reply(422,{error:'ACQUISITION_SCOPE_INVALID'});
  const scope=input.scope==='SMOKE_2330'?'SMOKE_2330':'UNIVERSE_72';
  const now=()=>new Date().toISOString(),started=now(),date=new Date(Date.parse(started)+8*3600000).toISOString().slice(0,10);
  if(input.business_date!==date||!isMarketTradingDate('TW',date)||typeof input.correlation_id!=='string'||!/^[-a-zA-Z0-9_:]{1,128}$/.test(input.correlation_id))return reply(422,{error:'LIVE_ACQUISITION_IDENTITY_INVALID'});
  const identity={report_date:date,today_date:date,revision_id:input.correlation_id,generated_at:started,data_as_of:started,is_trading_day:true};
  const execute=async()=>{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const data=await loadDecisionEvidence(async q=>{
   let query=db.from(q.table).select(q.columns).order(q.order,{ascending:false}).limit(q.limit);
   for(const f of q.filters)query=f.operator==='lte'?query.lte(f.column,f.value):query.gte(f.column,f.value);
   return await query;
  },identity);
  const signal=AbortSignal.timeout(scope==='SMOKE_2330'?22000:240000);
  const acquireBundle=async()=>{
   // One bounded source stream for concurrent formal and Shadow consumers.
   // <=50/min + Shadow sources <=8/min; no duplicate full-universe fan-out.
   const shadowWork=scope==='SMOKE_2330'?null:startV2SourceAcquisition({businessDate:date,symbols:RECOMMENDATION_UNIVERSE,
    apiKey:Deno.env.get('FUGLE_API_KEY')||'',fetcher:fetch,now,signal});
   let cutoff=started;
   const [captures,officialActuals,companyEvents]=await Promise.all([
    acquireStockEvidence({businessDate:date,universe:data.universe,apiKey:Deno.env.get('FUGLE_API_KEY')||'',fetcher:fetch,now,signal,scope}),
    scope==='SMOKE_2330'?Promise.resolve([]):acquireOfficialActuals({symbols:RECOMMENDATION_UNIVERSE,fetcher:fetch,now,signal}),
    scope==='SMOKE_2330'?Promise.resolve([]):acquireCompanyEvents({symbols:RECOMMENDATION_UNIVERSE,fetcher:fetch,now,signal}),
   ]).finally(async()=>{shadowWork?.stop();cutoff=now();await shadowWork?.complete;});
   return {business_date:date,acquisition_cutoff:cutoff,captures,officialActuals,companyEvents,acquired:await shadowWork?.complete??null};
  };
  const bundle=scope==='SMOKE_2330'?await acquireBundle():await sharedV2Acquisition({
   claim:()=>db.rpc('claim_recommendation_v2_acquisition',{p_date:date}),
   finish:(lease,payload)=>db.rpc('finish_recommendation_v2_acquisition',{p_lease:lease,p_payload:payload}),
   acquire:acquireBundle,signal,shadowOnly:request.headers.get('x-internal-call-source')==='recommendation-v2-forward-worker-v1',
  });
  const {captures,officialActuals,companyEvents}=bundle;
  // Evaluation time is new; evidence captured/available/session timestamps are
  // never rewritten. Both unchanged evaluators still enforce freshness.
  identity.generated_at=now();identity.data_as_of=bundle.acquisition_cutoff;
  const coverage=stockAcquisitionCoverage(captures,scope==='SMOKE_2330'?['2330']:RECOMMENDATION_UNIVERSE);
  if(scope==='SMOKE_2330')return reply(200,{scope,coverage,acquisition:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:date,cutoff:identity.generated_at,universe_count:72,requested_count:1,captures},complete_universe_evaluation:false,business_writes:[]});
  // Factual events are a separate sourced-evidence layer, NOT fabricated V1
  // bullish catalyst mappings or consensus. The unchanged evaluator stays closed.
  const proof=await buildRecommendationProof(data,identity,captures,officialActuals);
  const acquired=bundle.acquired!;
  const shadowSources=selectV2InstitutionalSources(acquired.fugle,acquired.publicSources,identity.generated_at);
  // Calculation only. Forward persistence is deliberately absent here: the
  // same producer is used by read-only runtime smoke and real report callers.
  const shadow=await buildV2Capsule({data,identity,captures,sources:shadowSources,benchmark_history:acquired.benchmark_history,events:companyEvents.flatMap(c=>c.events),events_complete:companyEvents.length===2&&companyEvents.every(c=>c.status==='PASS'),quarterly_actuals:officialActuals.filter(c=>c.kind==='quarterly_eps'&&c.status==='PASS').flatMap(c=>c.rows),v1:proof.decision}).catch(()=>null);
  return reply(200,{...proof,company_events:companyEvents,scope,coverage,shadow_v2:shadow});
  };
  return scope==='SMOKE_2330'?await execute():recommendationJsonStream(execute,request.signal,{deadlineMs:260000});
 }catch{
  return reply(422,{error:'RECOMMENDATION_EVIDENCE_UNAVAILABLE',business_writes:[]});
 }
});
