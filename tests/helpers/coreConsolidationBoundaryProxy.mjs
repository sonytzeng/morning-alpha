// Test-only userWorker proxy: no filesystem access and no business/Date override.
const scope = Deno.env.get('MA_LOCAL_SCOPE') || '';
if (!/^ma-consolidation-v1-\d{14}$/.test(scope) || Deno.env.get('MA_CONSOLIDATION_REPLAY') !== 'LOCAL_ONLY'
  || Deno.env.get('SUPABASE_URL') !== 'http://kong:8000') throw new Error('Dedicated local scope required');
Deno.serve(async req => {
  if (req.method !== 'POST' || req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('{}', { status: 401 });
  const body = await req.json();
  if (body.scope !== scope) return new Response('{}', { status: 403 });
  const response = await fetch('http://local-core-boundary:8081', { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-cron-secret': Deno.env.get('CRON_SECRET') }, body: JSON.stringify(body) });
  if (body.operation !== 'clock' || response.status !== 200) return response;
  const result = await response.json();
  return Response.json({ ...result, receiver_observed_at: result.observed_at,
    observed_at: new Date().toISOString(), clock_override: false, business_edge_clock_observed: true });
});
