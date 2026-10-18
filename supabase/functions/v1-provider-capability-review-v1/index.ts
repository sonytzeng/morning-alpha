// CANDIDATE ONLY. Requires separately approved private/empty bucket provision,
// explicit gateway verify_jwt=true and deployment. No --no-verify-jwt workflow.
// SDK getUser + the existing strict Owner RPC remain mandatory behind gateway.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import {createFinnhubQuarterlyProbe} from '../../../scripts/capability/finnhub-quarterly-probe.mjs';
import {createCapabilityReviewHandler, CAPABILITY_REVIEW_BUCKET, CAPABILITY_REVIEW_MARKER,
  type ReviewContext} from './handler.ts';

const authOptions = {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false} as const;
const providerRequests = new Set([
  'https://finnhub.io/api/v1/search?q=2330',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=2330.TW&freq=quarterly',
  'https://finnhub.io/api/v1/search?q=6488',
  'https://finnhub.io/api/v1/stock/eps-estimate?symbol=6488.TWO&freq=quarterly',
  'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=6488.TWO&freq=quarterly',
]);
const discard = (response: Response) => {try {void response.body?.cancel().catch(() => {});} catch { /* no raw error */ }};
function configuration(key: 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = Deno.env.get('SUPABASE_URL');
  if (!value) throw Error('REVIEW_CONFIGURATION');
  const url = new URL(value);
  if (url.origin !== 'https://cttfzgvhiewfckydcrci.supabase.co'
    || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw Error('REVIEW_CONFIGURATION');
  const credential = Deno.env.get(key);
  if (!credential) throw Error('REVIEW_CONFIGURATION');
  return {url: url.origin, credential};
}
// Each SDK operation may reach transport once only, even if an SDK retries.
// No business table/other RPC/bucket/route is reachable through this transport.
function sdkFetch(base: string, paths: Set<string>, context: ReviewContext): typeof fetch {
  const used = new Set<string>();
  return async (input, init) => {
    context.assertActive();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const operation = method + ' ' + url.pathname;
    if (url.origin !== base || url.search || url.hash || url.username || url.password
      || !paths.has(operation) || used.has(operation)) throw Error('REVIEW_TRANSPORT_DENIED');
    used.add(operation);
    const signal = init?.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal;
    if (signal.aborted) throw Error('REVIEW_STOPPED');
    const response = await fetch(input, {...init, signal, redirect: 'error', cache: 'no-store'});
    try {context.assertActive();} catch {discard(response); throw Error('REVIEW_STOPPED');}
    return response;
  };
}

const handler = createCapabilityReviewHandler({
  createUserClient(authorization, context) {
    context.assertActive();
    const {url, credential} = configuration('SUPABASE_ANON_KEY');
    const client = createClient(url, credential, {auth: authOptions, global: {
      headers: {Authorization: authorization}, fetch: sdkFetch(url, new Set([
        'GET /auth/v1/user', 'POST /rest/v1/rpc/is_research_owner_v1',
      ]), context),
    }});
    return {auth: {getUser: jwt => client.auth.getUser(jwt)},
      rpc: name => ({abortSignal: signal => client.rpc(name).abortSignal(signal)})};
  },
  createClaimStore(context) {
    // This factory is called only AFTER same-request Auth + strict Owner true.
    context.assertActive();
    const {url, credential} = configuration('SUPABASE_SERVICE_ROLE_KEY');
    const client = createClient(url, credential, {auth: authOptions, global: {
      fetch: sdkFetch(url, new Set([
        'GET /storage/v1/bucket/' + CAPABILITY_REVIEW_BUCKET,
        'POST /storage/v1/object/list/' + CAPABILITY_REVIEW_BUCKET,
        'POST /storage/v1/object/' + CAPABILITY_REVIEW_BUCKET + '/' + CAPABILITY_REVIEW_MARKER,
      ]), context),
    }});
    return {
      getBucket: bucket => client.storage.getBucket(bucket),
      list: (bucket, prefix, options) => client.storage.from(bucket).list(prefix, options),
      upload: (bucket, path, bytes, options) => client.storage.from(bucket).upload(path, bytes, options),
    };
  },
  createProbe(context) {
    // No credential lookup before successful authorization AND durable claim.
    context.assertActive();
    const used = new Set<string>();
    return createFinnhubQuarterlyProbe({
      clock: () => performance.now(),
      getCredential: () => {context.assertActive(); return Deno.env.get('FINNHUB_API_KEY') ?? '';},
      fetch: async (input: string, init: RequestInit) => {
        context.assertActive();
        if (!providerRequests.has(input) || init.method !== 'GET' || used.has(input))
          throw Error('REVIEW_TRANSPORT_DENIED');
        used.add(input);
        const signal = init.signal ? AbortSignal.any([context.signal, init.signal]) : context.signal;
        if (signal.aborted) throw Error('REVIEW_STOPPED');
        const response = await fetch(input, {...init, signal, redirect: 'error'});
        try {context.assertActive();} catch {discard(response); throw Error('REVIEW_STOPPED');}
        return response;
      },
    });
  },
});
Deno.serve(handler);
