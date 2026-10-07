import { internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { handleRecommendationSmoke } from '../_shared/recommendation-smoke.ts';
import { SMOKE_TOKEN_ENV } from './auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

// Default Supabase gateway JWT validation stays enabled. No browser access,
// startup dispatch or scheduled trigger. V2_SHADOW_LOCK alone permits the
// explicitly authorized, immutable Owner research RPCs; never business writes.
const shadowDb=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{
 auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(5000)})},
});
Deno.serve(request=>handleRecommendationSmoke(request,{
 url:Deno.env.get('SUPABASE_URL')||'',
 credentials:internalCredentialsFromEnv(),
 workerToken:Deno.env.get(SMOKE_TOKEN_ENV)||'',
 streaming:true,
 gatewayAnonJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')||'',
 gatewayKeyClass:!Deno.env.get('SUPABASE_ANON_KEY')?'MISSING':/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(Deno.env.get('SUPABASE_ANON_KEY')||'')?'LEGACY_JWT':'NON_JWT',
 fetcher:fetch,
 now:()=>new Date().toISOString(),
 shadowTransport:{
  storeRun:(text,result)=>shadowDb.rpc('store_recommendation_shadow_v2',{p_evidence_text:text,p_result:result}),
  pending:()=>shadowDb.rpc('pending_recommendation_shadow_v2'),
  storeOutcome:(result,text)=>shadowDb.rpc('store_recommendation_shadow_v2_outcome',{p_result:result,p_evidence_text:text}),
 },
}));
