import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { runAnalysisJob } from '../_shared/analysis-intelligence-job.mjs';
import { observeInvalidations } from '../_shared/analysis-intelligence-v1.mjs';

// Candidate only. No Cron, pipeline hooks, LINE transport, provider network or AI calls.
Deno.serve(async (request: Request) => {
  const reply = (status: number, data: Record<string, unknown>) => Response.json(data, { status });
  if (request.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
  const auth = await authorizeInternalRequest(request.headers, internalCredentialsFromEnv());
  if (!auth.ok) return reply(401, { error: 'INTERNAL_AUTH_REQUIRED' });
  if (Number(request.headers.get('content-length') || 0) > 1024) return reply(413, { error: 'REQUEST_TOO_LARGE' });
  try {
    const body = await request.text();
    if (body.length > 1024) return reply(413, { error: 'REQUEST_TOO_LARGE' });
    const input = JSON.parse(body) as Record<string, unknown>;
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } });
    if (input.operation === 'OBSERVE_INVALIDATION') {
      const { data, error } = await client.rpc('research_invalidation_input_v1', { p_analysis_id: input.analysis_id,
        p_checkpoint: input.checkpoint, p_cutoff: input.observed_at });
      if (error || !data) throw new Error('INVALIDATION_UNAVAILABLE');
      const result = observeInvalidations(data.analysis, data.observation);
      const stored = await client.rpc('store_research_invalidation_v1', { p_input: data, p_result: result });
      if (stored.error) throw new Error('INVALIDATION_STORE_FAILED');
      return reply(200, { status: stored.data, mode: 'SHADOW_ONLY', production_writes: 0 });
    }
    if (input.operation === 'LINK_OUTCOME') {
      const linked = await client.rpc('link_research_outcome_v1', { p_analysis_id: input.analysis_id, p_outcome_id: input.outcome_id });
      if (linked.error) throw new Error('OUTCOME_UNAVAILABLE');
      return reply(200, { status: linked.data, mode: 'SHADOW_ONLY', production_writes: 0 });
    }
    if (input.operation !== 'ANALYZE' || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.business_date))
      || !['FORWARD', 'HISTORICAL_REPLAY'].includes(String(input.observation_kind))
      || typeof input.analysis_cutoff_at !== 'string') return reply(400, { error: 'INPUT_INVALID' });
    const result = await runAnalysisJob({ date: input.business_date, cutoff: input.analysis_cutoff_at, kind: input.observation_kind,
      findExisting: async (date: string) => {
        const { data, error } = await client.from('research_daily_analysis').select('id,prediction_hash,observation_kind')
          .eq('business_date', date).eq('methodology_id', 'ANALYSIS_INTELLIGENCE_V1').maybeSingle();
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
