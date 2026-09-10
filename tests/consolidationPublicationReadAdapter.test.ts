// Both existing SDK implementations execute the same reader against a fetch
// double. There is no network, database, Auth service, or publication write.
import { createClient as createHostedClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createClient as createSourceClient } from 'npm:@supabase/supabase-js@2.57.4';
import { fetchPublishedDeliveryEvidence, readPublishedMarketDecision } from '../supabase/functions/_shared/market-publication-contract.ts';
import type { RuntimeDatabase } from '../supabase/functions/_shared/runtime-database-contract.ts';

function equal(actual: unknown, expected: unknown, message = 'Values differ') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function rejects(work: () => Promise<unknown>, message: string) {
  try { await work(); } catch (error) {
    check(error instanceof Error && error.message.includes(message), `Unexpected error: ${String(error)}`);
    return;
  }
  throw new Error(`Expected rejection: ${message}`);
}
const report = { id: 'synthetic-report', report_date: '2026-09-09', ai_strategy_json: {
  revision_id: 'synthetic-revision', canonical_member_revision_id: 'synthetic-member',
  market_publication_contract: { publication_run_id: 'synthetic-run' },
} };

for (const sdk of ['hosted', 'source-2.57.4']) Deno.test(`actual ${sdk} SDK retains exact publication SELECT/filter/order semantics`, async () => {
  const reads: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    check(url.hostname === 'query.example.invalid', 'No external fetch allowed');
    check(!init?.method || init.method === 'GET', 'Read adapter cannot write');
    reads.push(url);
    const table = url.pathname.split('/').at(-1);
    const row = table === 'decision_snapshots'
      ? { id: 'synthetic-revision', version: 7 }
      : table === 'member_content_revisions'
      ? { id: 'synthetic-member', decision_snapshot_version: 7, semantic_coherence_reviews: [{ status: 'PASSED', reason_codes: [],
        canonical_snapshot_id: 'synthetic-revision', canonical_snapshot_version: 7 }] }
      : table === 'pipeline_runs' ? { id: 'synthetic-run' } : null;
    check(row !== null, `Unexpected table ${table}`);
    return new Response(JSON.stringify([row]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } };
  const result = sdk === 'hosted'
    ? await fetchPublishedDeliveryEvidence(createHostedClient<RuntimeDatabase>('https://query.example.invalid', 'synthetic-only-not-a-key', options), report)
    : await fetchPublishedDeliveryEvidence(createSourceClient<RuntimeDatabase>('https://query.example.invalid', 'synthetic-only-not-a-key', options), report);
  equal(result.snapshot?.id, 'synthetic-revision'); equal(result.member?.semantic_status, 'PASSED'); equal(result.publicationRun?.id, 'synthetic-run');
  equal(reads.length, 3);
  for (const url of reads) {
    check(!url.searchParams.has('is_current'), 'No newest-QA selector');
    if (url.pathname.endsWith('decision_snapshots')) {
      equal(url.searchParams.get('id'), 'eq.synthetic-revision');
      equal(url.searchParams.get('report_id'), 'eq.synthetic-report');
      equal(url.searchParams.get('report_date'), 'eq.2026-09-09');
      equal(url.searchParams.get('order'), 'version.desc'); equal(url.searchParams.get('limit'), '1');
    } else if (url.pathname.endsWith('member_content_revisions')) {
      equal(url.searchParams.get('id'), 'eq.synthetic-member');
      equal(url.searchParams.get('decision_snapshot_id'), 'eq.synthetic-revision');
      equal(url.searchParams.get('semantic_coherence_reviews.order'), 'checked_at.desc');
      equal(url.searchParams.get('semantic_coherence_reviews.limit'), '1');
    } else {
      equal(url.searchParams.get('status'), 'eq.SUCCEEDED'); equal(url.searchParams.get('trading_date'), 'eq.2026-09-09');
      equal(url.searchParams.get('id'), 'eq.synthetic-run'); equal(url.searchParams.get('idempotency_key'), 'like.research-input:%');
      equal(url.searchParams.get('provider_status->result->>report_id'), 'eq.synthetic-report');
      equal(url.searchParams.get('provider_status->result->>report_date'), 'eq.2026-09-09');
      equal(url.searchParams.get('provider_status->result->>decision_snapshot_id'), 'eq.synthetic-revision');
      equal(url.searchParams.get('provider_status->result->>member_content_revision_id'), 'eq.synthetic-member');
      equal(url.searchParams.get('order'), 'completed_at.asc'); equal(url.searchParams.get('limit'), '1');
    }
  }
});

function transport(response: unknown, omit?: string) {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'like', 'order', 'limit']) {
    if (name !== omit) chain[name] = function (this: unknown) { check(this === chain, `${name} lost receiver`); return chain; };
  }
  if (omit !== 'maybeSingle') chain.maybeSingle = function (this: unknown) { check(this === chain, 'maybeSingle lost receiver'); return Promise.resolve(response); };
  return { from() { return chain; } };
}
for (const name of ['select', 'eq', 'order', 'limit', 'maybeSingle']) Deno.test(`missing SDK method fails closed: ${name}`, async () => {
  await rejects(() => readPublishedMarketDecision(transport({ data: null, error: null }, name), report), `PUBLICATION_QUERY_METHOD_MISSING:${name}`);
});
Deno.test('missing receipt like method fails closed without changing the query', async () => {
  await rejects(() => fetchPublishedDeliveryEvidence(transport({ data: null, error: null }, 'like'), report), 'PUBLICATION_QUERY_METHOD_MISSING:like');
});
for (const response of [null, {}, { data: null }, { error: null }, { data: null, error: {} }]) Deno.test(`malformed SDK response fails closed: ${JSON.stringify(response)}`, async () => {
  await rejects(() => readPublishedMarketDecision(transport(response), report), 'PUBLICATION_QUERY_');
});
Deno.test('SDK errors retain message/code/details/hint and never become successful empty data', async () => {
  const error = { message: 'synthetic query error', code: 'SYNTHETIC', details: 'original detail', hint: 'original hint' };
  const result = await readPublishedMarketDecision(transport({ data: null, error }), report);
  equal(result, { data: null, error });
  await rejects(() => fetchPublishedDeliveryEvidence(transport({ data: null, error }), report), 'SNAPSHOT_STATE_QUERY_FAILED:synthetic query error');
});
Deno.test('unpublished report does not invoke a transport method', async () => {
  equal(await readPublishedMarketDecision({ from() { throw new Error('Unpublished read attempted'); } }, { report_date: '2026-09-09' }), { data: null, error: null });
});
