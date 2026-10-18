/** Unbound diagnostic candidate. Importing this module performs no I/O.
 * Only trusted backend code may inject fetch/getCredential; there is no CLI,
 * environment lookup, storage, evaluator, public route, or binding approval.
 * Offline endpoint evidence: docs/operations/v1-source-capability-20261017.md.
 */
const MAX_BYTES = 65_536, MAX_ROWS = 64, MAX_CHUNKS = 1024;
const TOTAL_MS = 15_000, CALL_MS = 2000;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const FINNHUB_QUARTERLY_PROBE_MANIFEST = freeze({
  classification: 'UNBOUND_DIAGNOSTIC_CANDIDATE_ONLY',
  symbol_mapping: 'HYPOTHESIS_UNVERIFIED',
  hypotheses: [{local_symbol: '2330', provider_symbol: '2330.TW'}, {local_symbol: '6488', provider_symbol: '6488.TWO'}],
  max_calls: 6, sequential: true, retries: 0, deadline_ms: TOTAL_MS, per_call_ms: CALL_MS,
  external_abort_supported: true, remaining_budget_ms_max: TOTAL_MS,
  deadline_scope: 'FIRST_RUN_INVOCATION_HONORING_SHARED_OUTER_AUTH_STORAGE_SIGNAL',
  max_response_bytes: MAX_BYTES, max_json_rows: MAX_ROWS, max_stream_chunks: MAX_CHUNKS,
  response_limit_scope: 'ACCEPTED_BYTES_ONLY_OVERSIZED_DELIVERY_CHUNK_DISCARDED_AND_CANCELLED',
  average_provenance: 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY',
  tw72_coverage: 'UNKNOWN', current_entitlement: 'UNPROVEN', historical_vintage: 'UNPROVEN',
  commercial_member_reuse_rights: 'UNPROVEN', pure_broker_consensus: false,
  formal_admission: false, member_publication: false,
  backend_binding_approved: false,
  future_binding_requires: ['SEPARATE_OWNER_APPROVAL', 'REAL_OWNER_ONLY_BACKEND_AUTH', 'DURABLE_CROSS_ISOLATE_CLAIM'],
  once_only_scope: 'THIS_INSTANCE_ONLY_NOT_GLOBAL_RATE_CONTROL',
});
const REQUESTS = freeze([
  {symbol: '2330', hypothesis: '2330.TW', kind: 'search', url: 'https://finnhub.io/api/v1/search?q=2330'},
  {symbol: '2330', hypothesis: '2330.TW', kind: 'eps', url: 'https://finnhub.io/api/v1/stock/eps-estimate?symbol=2330.TW&freq=quarterly'},
  {symbol: '2330', hypothesis: '2330.TW', kind: 'revenue', url: 'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=2330.TW&freq=quarterly'},
  {symbol: '6488', hypothesis: '6488.TWO', kind: 'search', url: 'https://finnhub.io/api/v1/search?q=6488'},
  {symbol: '6488', hypothesis: '6488.TWO', kind: 'eps', url: 'https://finnhub.io/api/v1/stock/eps-estimate?symbol=6488.TWO&freq=quarterly'},
  {symbol: '6488', hypothesis: '6488.TWO', kind: 'revenue', url: 'https://finnhub.io/api/v1/stock/revenue-estimate?symbol=6488.TWO&freq=quarterly'},
]);
const own = (value, key) => Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const present = (rows, key) => rows.filter(row => own(row, key) && row[key] !== null).length;
const discard = (response, reader) => {
  try {
    const pending = reader ? reader.cancel() : response?.body?.cancel();
    Promise.resolve(pending).catch(() => {});
  } catch { /* Cancellation is attempted, never awaited beyond the deadline. */ }
};

// Counts only: never return values, descriptions, provider errors or metadata text.
function summarize(spec, payload) {
  if (!record(payload) || own(payload, 'error')) return {shape: 'AMBIGUOUS', stop: true};
  const rows = payload[spec.kind === 'search' ? 'result' : 'data'];
  if (!Array.isArray(rows)) return {shape: 'AMBIGUOUS', stop: true};
  if (rows.length > MAX_ROWS) return {shape: 'ROW_LIMIT', stop: true};
  if (rows.some(row => !record(row))) return {shape: 'AMBIGUOUS', stop: true};
  const base = {row_count: rows.length, quarter_count: 0};
  if (spec.kind === 'search') {
    if (!Number.isInteger(payload.count) || payload.count !== rows.length) return {...base, shape: 'AMBIGUOUS', stop: true};
    const matches = rows.filter(row => row.symbol === spec.hypothesis).length;
    return {...base, shape: rows.length ? 'SEARCH_ROWS' : 'EMPTY', exact_hypothesis_matches: matches,
      metadata_present_rows: Object.fromEntries(['symbol', 'displaySymbol', 'description', 'type'].map(key => [key, present(rows, key)])),
      stop: matches !== 1}; // A unique lookup hit still does NOT verify the mapping.
  }
  if (payload.symbol !== spec.hypothesis || payload.freq !== 'quarterly') return {...base, shape: 'AMBIGUOUS', stop: true};
  const quarters = new Set(), avg = spec.kind + 'Avg', low = spec.kind + 'Low', high = spec.kind + 'High';
  for (const row of rows) {
    if (!Number.isInteger(row.year) || row.year < 1900 || row.year > 2200
      || !Number.isInteger(row.quarter) || row.quarter < 1 || row.quarter > 4
      || typeof row.period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.period)
      || !Number.isFinite(Date.parse(row.period + 'T00:00:00Z'))
      || new Date(row.period + 'T00:00:00Z').toISOString().slice(0, 10) !== row.period
      || !finite(row[avg]) || own(row, 'epsActual') || own(row, 'revenueActual')
      || (own(row, low) && (!finite(row[low]) || row[low] > row[avg]))
      || (own(row, high) && (!finite(row[high]) || row[high] < row[avg]))) return {...base, shape: 'AMBIGUOUS', stop: true};
    const quarter = row.year * 4 + row.quarter;
    if (quarters.has(quarter)) return {...base, shape: 'AMBIGUOUS', stop: true};
    quarters.add(quarter);
  }
  return {...base, shape: rows.length ? 'QUARTERLY_ESTIMATE_ROWS' : 'EMPTY', quarter_count: quarters.size,
    metadata_present_rows: Object.fromEntries(['year', 'quarter', 'period', avg, low, high, 'numberAnalysts',
      'currency', 'unit', 'scale', 'asOf', 'as_of', 'firstSeenAt', 'first_seen_at', 'revision'].map(key => [key, present(rows, key)])), stop: false};
}

function configuration(dependencies) {
  if (!record(dependencies)) return null;
  try {
    const fields = Object.getOwnPropertyDescriptors(dependencies);
    if (Reflect.ownKeys(fields).some(key => !['fetch', 'getCredential', 'clock'].includes(key)
      || !own(fields[key], 'value'))) return null;
    if (typeof fields.fetch?.value !== 'function' || typeof fields.getCredential?.value !== 'function'
      || (fields.clock && typeof fields.clock.value !== 'function')) return null;
    return {fetch: fields.fetch.value, getCredential: fields.getCredential.value,
      clock: fields.clock?.value ?? (() => performance.now())};
  } catch { return null; }
}

function runControls(args) {
  if (!args.length) return {remainingMs: TOTAL_MS};
  if (args.length !== 1 || !record(args[0])) return null;
  try {
    const fields = Object.getOwnPropertyDescriptors(args[0]);
    if (Reflect.ownKeys(fields).some(key => !['signal', 'remainingMs'].includes(key) || !own(fields[key], 'value'))) return null;
    const signal = fields.signal?.value, remainingMs = fields.remainingMs ? fields.remainingMs.value : TOTAL_MS;
    if ((signal !== undefined && !(signal instanceof AbortSignal))
      || !finite(remainingMs) || remainingMs < 0 || remainingMs > TOTAL_MS) return null;
    return {signal, remainingMs};
  } catch { return null; }
}

function batchClock(clock, controls) {
  const controller = new AbortController();
  let previous = -1, start, stopStatus = 'BATCH_DEADLINE', timer;
  const stop = status => { if (!controller.signal.aborted) { stopStatus = status; controller.abort(); } };
  const externalAbort = () => stop('EXTERNAL_ABORT');
  if (controls.signal?.aborted) externalAbort();
  else controls.signal?.addEventListener('abort', externalAbort, {once: true});
  const read = () => {
    let value;
    try { value = clock(); } catch { value = NaN; }
    if (!finite(value) || value < previous || value < 0 || value > Number.MAX_SAFE_INTEGER - TOTAL_MS) {
      stop('CLOCK_INVALID'); return null;
    }
    previous = value;
    return value;
  };
  start = controller.signal.aborted ? null : read();
  const remaining = () => {
    if (controller.signal.aborted) return 0;
    const value = read();
    if (value === null || start === null || controller.signal.aborted) return 0;
    const ms = controls.remainingMs - (value - start);
    if (ms <= 0) stop('BATCH_DEADLINE');
    return Math.max(0, ms);
  };
  if (controls.remainingMs === 0) stop('BATCH_DEADLINE');
  if (start !== null && !controller.signal.aborted) timer = setTimeout(() => stop('BATCH_DEADLINE'), controls.remainingMs);
  return {signal: controller.signal, remaining, status: () => stopStatus,
    close: () => { clearTimeout(timer); controls.signal?.removeEventListener('abort', externalAbort); controller.abort(); }};
}

function credentialWithinBatch(getCredential, batch) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; batch.signal.removeEventListener('abort', aborted); resolve(value); };
    const aborted = () => finish({status: batch.status()});
    batch.signal.addEventListener('abort', aborted, {once: true});
    if (!batch.remaining()) { aborted(); return; }
    Promise.resolve().then(() => {
      if (!settled) return getCredential();
    }).then(value => {
      if (settled) return;
      if (!batch.remaining()) { aborted(); return; }
      // Local bounded header-injection guard, NOT proof of provider validity.
      finish(typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value)
        ? {credential: value} : {status: 'BLOCKED_CREDENTIAL'});
    }).catch(() => finish({status: 'BLOCKED_CREDENTIAL'}));
  });
}

function acquire(spec, credential, transport, batch, countCall) {
  // Every exit cancels/aborts active work; a late
  // Response is cancelled without reading. No continuation can start another GET.
  return new Promise(resolve => {
    const controller = new AbortController();
    let finished = false, response, reader, timer, callStartRemaining, acceptedBytes = 0, http = null;
    const finish = (status, summary = {}, cancel = true) => {
      if (finished) return;
      finished = true; clearTimeout(timer); batch.signal.removeEventListener('abort', aborted);
      if (cancel) { controller.abort(); discard(response, reader); }
      resolve({symbol: spec.symbol, endpoint: spec.kind, http_status: http,
        accepted_bytes: acceptedBytes, ...summary, status});
    };
    const aborted = () => finish(batch.status());
    const alive = () => {
      if (finished) return false;
      const remaining = batch.remaining();
      if (!remaining) { aborted(); return false; }
      if (callStartRemaining - remaining >= CALL_MS) { finish('CALL_TIMEOUT'); return false; }
      return true;
    };
    batch.signal.addEventListener('abort', aborted, {once: true});
    callStartRemaining = batch.remaining();
    if (!alive()) return;
    timer = setTimeout(() => finish(batch.remaining() ? 'CALL_TIMEOUT' : batch.status()), Math.min(CALL_MS, callStartRemaining));
    Promise.resolve().then(() => {
      if (!alive()) return null;
      countCall();
      return transport(spec.url, {method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', headers: {'Accept': 'application/json', 'X-Finnhub-Token': credential}, signal: controller.signal});
    }).then(async received => {
      if (finished) { discard(received); return; }
      response = received;
      if (!alive()) return;
      if (!(response instanceof Response)) { finish('AMBIGUOUS_RESPONSE'); return; }
      http = response.status;
      if (response.redirected || (response.url && response.url !== spec.url) || http !== 200) { finish('HTTP_STOP'); return; }
      const type = response.headers.get('content-type') ?? '';
      const length = response.headers.get('content-length');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type)
        || (length !== null && !/^\d+$/.test(length))) { finish('AMBIGUOUS_RESPONSE'); return; }
      if (length !== null && Number(length) > MAX_BYTES) { finish('BODY_LIMIT'); return; }
      if (!response.body || response.bodyUsed) { finish('AMBIGUOUS_RESPONSE'); return; }
      reader = response.body.getReader();
      const chunks = [];
      let reads = 0;
      while (alive()) {
        const part = await reader.read();
        if (!alive()) return;
        if (part.done) break;
        if (!(part.value instanceof Uint8Array) || ++reads > MAX_CHUNKS) { finish('BODY_LIMIT'); return; }
        if (acceptedBytes + part.value.byteLength > MAX_BYTES) { finish('BODY_LIMIT'); return; }
        acceptedBytes += part.value.byteLength;
        chunks.push(part.value.slice());
      }
      if (!alive()) return;
      reader.releaseLock(); reader = undefined;
      const bytes = new Uint8Array(acceptedBytes);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      let payload;
      try { payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
      catch { finish('AMBIGUOUS_RESPONSE'); return; }
      const summary = summarize(spec, payload), {stop, ...safe} = summary;
      if (!alive()) return;
      finish(stop ? (safe.shape === 'ROW_LIMIT' ? 'ROW_LIMIT' : 'AMBIGUOUS_RESPONSE') : 'OBSERVED_ONLY', safe, stop);
    }).catch(() => { if (!finished) finish('NETWORK_OR_AMBIGUOUS'); });
  });
}

export function createFinnhubQuarterlyProbe(dependencies) {
  const configured = configuration(dependencies);
  let shared;
  const execute = async (controls, batch) => {
    const observations = [];
    let calls = 0, status = !controls ? 'BLOCKED_INPUT' : 'BLOCKED_CONFIGURATION', credential = '';
    if (controls && configured && batch) {
      try {
        const acquired = await credentialWithinBatch(configured.getCredential, batch);
        status = acquired.status ?? 'BOUNDED_DIAGNOSTIC_COMPLETE_EXTERNAL_BLOCKED';
        if (acquired.credential) {
          credential = acquired.credential;
          for (const spec of REQUESTS) {
            if (!batch.remaining()) { status = batch.status(); break; }
            const observation = await acquire(spec, credential, configured.fetch, batch, () => { calls++; });
            observations.push(observation);
            if (observation.status !== 'OBSERVED_ONLY') { status = observation.status; break; }
          }
        }
      } catch { status = 'INTERNAL_STOP'; }
      finally { credential = ''; batch.close(); }
    }
    return freeze({status, calls, observations, symbol_mapping: 'HYPOTHESIS_UNVERIFIED',
      tw72_coverage: 'UNKNOWN', current_entitlement: 'UNPROVEN', historical_vintage: 'UNPROVEN',
      commercial_member_reuse_rights: 'UNPROVEN', average_provenance: 'FINNHUB_AVERAGE_INCLUDING_PROPRIETARY',
      pure_broker_consensus: false, formal_admission: false, member_publication: false,
      backend_binding_approved: false, global_cross_isolate_rate_control: 'NOT_IMPLEMENTED'});
  };
  return Object.freeze({run(...args) {
    // Non-async wrapper intentionally returns the identical promise, even after
    // failure. Reserving it before executing callbacks also closes reentrancy.
    if (!shared) {
      let resolve;
      shared = new Promise(done => { resolve = done; });
      let controls = runControls(args), batch;
      try { if (controls && configured) batch = batchClock(configured.clock, controls); }
      catch { controls = null; }
      Promise.resolve().then(() => execute(controls, batch)).then(resolve);
    }
    return shared;
  }});
}
