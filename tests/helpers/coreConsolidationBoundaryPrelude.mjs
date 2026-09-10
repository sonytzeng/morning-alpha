// Prefix only the isolated test bundle. Never prepend to a Production bundle.
// Business Date, Auth, SQL, response status and source code are not replaced.
if (!/^ma-consolidation-v1-\d{14}$/.test(Deno.env.get('MA_LOCAL_SCOPE') || '')
  || Deno.env.get('SUPABASE_URL') !== 'http://kong:8000'
  || Deno.env.get('MA_CONSOLIDATION_REPLAY') !== 'LOCAL_ONLY') throw new Error('Dedicated local vendor boundary required');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (url.origin === 'http://kong:8000') return originalFetch(request);
  if (url.protocol !== 'https:' || !['finnhub.io', 'api.fugle.tw', 'mis.twse.com.tw', 'gnews.io', 'newsapi.org', 'api.openai.com', 'api.line.me'].includes(url.hostname)) {
    throw new Error('External egress blocked by isolated replay');
  }
  for (const name of ['token', 'apikey', 'apiKey', 'api_key', 'key']) url.searchParams.delete(name);
  let body = null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const text = await request.text(); body = text ? JSON.parse(text) : null;
  }
  return originalFetch('http://kong:8000/functions/v1/local-core-consolidation-boundary', {
    method: 'POST', headers: { 'content-type': 'application/json',
      apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      authorization: 'Bearer ' + Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      'x-cron-secret': Deno.env.get('CRON_SECRET') },
    body: JSON.stringify({ operation: 'vendor', scope: Deno.env.get('MA_LOCAL_SCOPE'),
      request: { url: url.href, method: request.method, body } }),
    signal: request.signal,
  });
};
