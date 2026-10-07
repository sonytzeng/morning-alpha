import { internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { handleRecommendationSmoke } from '../_shared/recommendation-smoke.ts';

// Default Supabase gateway JWT validation stays enabled. No browser access,
// startup dispatch, scheduled trigger, DB writes or new credential is added.
Deno.serve(request=>handleRecommendationSmoke(request,{
 url:Deno.env.get('SUPABASE_URL')||'',
 credentials:internalCredentialsFromEnv(),
 fetcher:fetch,
 now:()=>new Date().toISOString(),
}));
