import { internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { handleRecommendationSmoke } from '../_shared/recommendation-smoke.ts';
import { SMOKE_TOKEN_ENV } from './auth.ts';

// Default Supabase gateway JWT validation stays enabled. No browser access,
// startup dispatch, scheduled trigger, DB writes or new credential is added.
Deno.serve(request=>handleRecommendationSmoke(request,{
 url:Deno.env.get('SUPABASE_URL')||'',
 credentials:internalCredentialsFromEnv(),
 workerToken:Deno.env.get(SMOKE_TOKEN_ENV)||'',
 gatewayAnonJwt:Deno.env.get('RECOMMENDATION_GATEWAY_ANON_JWT')||'',
 gatewayKeyClass:!Deno.env.get('SUPABASE_ANON_KEY')?'MISSING':/^[^.\s]+\.[^.\s]+\.[^.\s]+$/.test(Deno.env.get('SUPABASE_ANON_KEY')||'')?'LEGACY_JWT':'NON_JWT',
 fetcher:fetch,
 now:()=>new Date().toISOString(),
}));
