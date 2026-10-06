import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeShadowWorker, permittedShadowReplay, SHADOW_TOKEN_ENV } from '../_shared/shadow-worker-auth.mjs';
import { runAnalysisJob } from '../_shared/analysis-intelligence-job.mjs';

// Candidate only. No Cron, pipeline hooks, LINE transport, provider network or AI calls.
Deno.serve(async (request: Request) => {
  const reply = (status: number, data: Record<string, unknown>) => Response.json(data, { status });
  if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  const auth = await authorizeShadowWorker(request.headers, Deno.env.get(SHADOW_TOKEN_ENV));
  if (!auth.ok) {
    // Strict allowlisted metadata only, no request/identity/token/error objects.
    console.warn(JSON.stringify({event:'SHADOW_AUTH_REJECTED',reason:auth.reason,stage:auth.stage}));
    return reply(401, { error: auth.reason });
  }
  if (Number(request.headers.get('content-length') || 0) > 1024) return reply(413, { error: 'REQUEST_TOO_LARGE' });
  try {
    const body = await request.text();
    if (body.length > 1024) return reply(413, { error: 'REQUEST_TOO_LARGE' });
    const input = JSON.parse(body) as Record<string, unknown>;
    if (!permittedShadowReplay(input)) return reply(403, {error:'SHADOW_OPERATION_DENIED'});
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    if (input.operation !== 'ANALYZE' || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.business_date))
      || !['FORWARD', 'HISTORICAL_REPLAY'].includes(String(input.observation_kind))
      || typeof input.analysis_cutoff_at !== 'string') return reply(400, { error: 'INPUT_INVALID' });
    const result = await runAnalysisJob({ date: input.business_date, cutoff: input.analysis_cutoff_at, kind: input.observation_kind,
      findExisting: async (date: string, cutoff: string, kind: string) => {
        const { data, error } = await client.from('research_daily_analysis').select('id,prediction_hash,observation_kind,analysis_cutoff_at')
          .eq('business_date', date).eq('analysis_cutoff_at', cutoff).eq('observation_kind', kind)
          .eq('methodology_id', 'ANALYSIS_INTELLIGENCE_V1').eq('methodology_version', 1).maybeSingle();
        if (error) throw new Error('RESEARCH_READ_FAILED');
        return data;
      },
      readInput: async (date: string, cutoff: string, kind: string) => {
        const { data, error } = await client.rpc('research_analysis_input_v1', { p_date: date, p_cutoff: cutoff, p_kind: kind });
        if (error) throw new Error('RESEARCH_READ_FAILED');
        return data;
      },
      storeAnalysis: async (source: unknown, previous: unknown, analysis: string, computeMs: number) => {
        const { data, error } = await client.rpc('store_research_analysis_v1', {
          p_input: source, p_previous: previous, p_analysis_text: analysis, p_compute_ms: computeMs,
        });
        if (error) throw new Error('RESEARCH_STORE_FAILED');
        return data;
      },
    });
    return reply(200, result);
  } catch {
    // Never log input, DB error detail, identity or secrets. Retry is outside business lifecycle.
    return reply(422, { error: 'SHADOW_ANALYSIS_UNAVAILABLE', production_affected: false });
  }
});
