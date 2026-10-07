import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { loadDecisionEvidence } from '../_shared/decision-v1-data.ts';
import { acquireStockEvidence, buildRecommendationProof, stockAcquisitionCoverage, RECOMMENDATION_UNIVERSE } from '../_shared/recommendation-stock-evidence.ts';
import { isMarketTradingDate } from '../_shared/market-session-contract.mjs';

// Server-only, read-only source acquisition. Existing internal identity validator.
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
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const data=await loadDecisionEvidence(async q=>{
   let query=db.from(q.table).select(q.columns).order(q.order,{ascending:false}).limit(q.limit);
   for(const f of q.filters)query=f.operator==='lte'?query.lte(f.column,f.value):query.gte(f.column,f.value);
   return await query;
  },identity);
  const captures=await acquireStockEvidence({businessDate:date,universe:data.universe,apiKey:Deno.env.get('FUGLE_API_KEY')||'',fetcher:fetch,now,signal:AbortSignal.timeout(22000),scope});
  identity.generated_at=now();identity.data_as_of=identity.generated_at;
  const coverage=stockAcquisitionCoverage(captures,scope==='SMOKE_2330'?['2330']:RECOMMENDATION_UNIVERSE);
  if(scope==='SMOKE_2330')return reply(200,{scope,coverage,acquisition:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:date,cutoff:identity.generated_at,universe_count:72,requested_count:1,captures},complete_universe_evaluation:false,business_writes:[]});
  return reply(200,{...await buildRecommendationProof(data,identity,captures),scope,coverage});
 }catch{
  return reply(422,{error:'RECOMMENDATION_EVIDENCE_UNAVAILABLE',business_writes:[]});
 }
});
