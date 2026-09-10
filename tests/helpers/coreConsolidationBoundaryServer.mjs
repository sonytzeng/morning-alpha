// Local-only Edge test receiver. Durable append-only file receipts, no DB writes.
import { resolveConsolidationVendorResponse } from './coreConsolidationVendorShapes.mjs';
const scope = Deno.env.get('MA_LOCAL_SCOPE') || '';
if (!/^ma-consolidation-v1-\d{14}$/.test(scope) || Deno.env.get('MA_CONSOLIDATION_REPLAY') !== 'LOCAL_ONLY'
  || Deno.env.get('SUPABASE_URL') !== 'http://kong:8000') throw new Error('Fresh isolated stack required');
const root = '/var/run/' + scope, fixtureBytes = Deno.readTextFileSync(root + '/provider-fixture.json');
const fixture = JSON.parse(fixtureBytes), bootId = Deno.readTextFileSync('/proc/sys/kernel/random/boot_id').trim();
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
const fixtureHash = await digest(fixtureBytes);
const sourceHash = await digest(Deno.readTextFileSync(root + '/boundary-source.mjs'));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
Deno.serve(async req => {
  if (req.method !== 'POST' || req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ success: false }, 401);
  const body = await req.json();
  if (body.scope !== scope) return json({ success: false, error: 'LOCAL_SCOPE_MISMATCH' }, 403);
  const observedAt = new Date().toISOString();
  if (body.operation === 'clock') return json({ success: true, scope, boot_id: bootId, observed_at: observedAt,
    clock_override: false, fixture_sha256: fixtureHash, boundary_source_sha256: sourceHash });
  if (body.operation === 'audit') {
    let text = ''; try { text = Deno.readTextFileSync(root + '/vendor-receipts.jsonl'); } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
    return json({ success: true, scope, receipts: text.split('\n').filter(Boolean).map(line => JSON.parse(line)) });
  }
  if (body.operation !== 'vendor') return json({ success: false, error: 'UNKNOWN_LOCAL_OPERATION' }, 400);
  try {
    const response = resolveConsolidationVendorResponse(body.request, fixture, observedAt);
    const receipt = { id: crypto.randomUUID(), scope, observed_at: observedAt, provider: response.provider,
      operation: response.operation, fixture_id: response.fixture_id, phase: response.phase,
      request_sha256: await digest(JSON.stringify(body.request)), response_sha256: await digest(JSON.stringify(response.body)),
      status: response.status, source_kind: response.source_kind, historical_capture: false,
      ...(response.provider === 'line' ? { body: body.request.body } : {}) };
    Deno.writeTextFileSync(root + '/vendor-receipts.jsonl', JSON.stringify(receipt) + '\n', { append: true, create: true });
    return json(response.body, response.status);
  } catch (error) {
    return json({ success: false, error_code: 'UNRECORDED_LOCAL_VENDOR_REQUEST', detail: String(error.message) }, 503);
  }
});
