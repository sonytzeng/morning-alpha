/** Isolated evidence wiring, NOT another strategy or a deployed entrypoint.
 * Reuses V2's retained-bar validator, VNext's normalized source receipts, and
 * the unchanged V1 evaluator. No fetch, DB, publication, thresholds or clocks.
 * A review receipt is a trusted offline review assertion, not authorization. */
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import type { DecisionIdentity, EvidenceData, Row } from '../supabase/functions/_shared/decision-v1-data.ts';
import { v2Bars, v2Hash, type V2Input, type Bar } from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import { V2_INDEX_URL, type BenchmarkClose } from '../supabase/functions/_shared/recommendation-shadow-v2-sources.ts';
import { isMarketTradingDate, previousMarketTradingDate } from '../supabase/functions/_shared/market-session-contract.mjs';
import { historyUrl, tpexDailyUrl } from './entry-official-history.ts';
import { snapshotHash } from '../src/features/vnext/contracts.ts';
import type { SourceReceipt } from '../src/features/vnext/dailyAdapter.ts';

export const EVENT_ALIGNMENT_CONTRACT = 'RECOMMENDATION_EVENT_ALIGNMENT_CANDIDATE_V1';
export type CausalReview = {
  mapping_id: string; event_id: string; reviewed_at: string;
  /** v2Hash({mapping,catalyst,event}); binds the exact existing canonical rows. */
  evidence_sha256: string;
};
export type CanonicalSectorObservation = {
  source: 'public.sector_stock_map'; observed_at: string;
  rows: { symbol: string; sector: string; is_active: boolean; created_at: string; updated_at: string }[];
};
type Series = { symbol: string; bars: Bar[]; provider: string };
type Classification = { symbol: string; industry_code: string; available_at: string; source_ref: string };
const obj = (v: unknown): Row => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const stamp = (v: unknown) => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) ? Date.parse(v) : NaN;
const known = (v: unknown, cutoff: number) => Number.isFinite(stamp(v)) && stamp(v) <= cutoff;
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const closeAt = (date: string) => date + 'T13:30:00+08:00';
const references = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(references) : [];
const indexSource = (date: string) => V2_INDEX_URL + '?date=' + date.slice(0, 7).replace('-', '') + '01&response=json#' + date;

/** Preserve a caller's minimal read-only observation verbatim. created/updated
 * timestamps do NOT prove when this observer learned the taxonomy. Receipt
 * availability controls the join, including sub-millisecond timestamps. */
export async function withObservedCanonicalSectors(data: EvidenceData, identity: DecisionIdentity, observation: CanonicalSectorObservation, expectedHash: string) {
  const copy = structuredClone(data), hash = await v2Hash(observation), observed = stamp(observation.observed_at);
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(observation.observed_at)?.[1] ?? '';
  const available = observed + (/[1-9]/.test(fraction.slice(3)) ? 1 : 0);
  const fail = (reason: string) => ({ data: { ...copy, failures: [...copy.failures, reason] }, status: 'UNKNOWN' as const,
    observation_sha256: hash, available_at_conservative_ms: Number.isFinite(available) ? new Date(available).toISOString() : null });
  if (!sha(expectedHash) || hash !== expectedHash || observation.source !== 'public.sector_stock_map' || !Number.isFinite(observed)
    || observation.rows.length > 72 || new Set(observation.rows.map(r => r.symbol)).size !== observation.rows.length
    || observation.rows.some(r => Object.keys(r).some(k => !['symbol', 'sector', 'is_active', 'created_at', 'updated_at'].includes(k))
      || !/^\d{4,6}$/.test(r.symbol) || !text(r.sector) || typeof r.is_active !== 'boolean'
      || !known(r.created_at, observed) || !known(r.updated_at, observed) || stamp(r.created_at) > stamp(r.updated_at))) return fail('CANONICAL_SECTOR_OBSERVATION_INVALID');
  if (!Number.isFinite(stamp(identity.generated_at)) || available > stamp(identity.generated_at)) return fail('CANONICAL_SECTOR_OBSERVATION_NOT_AVAILABLE_AT_CUTOFF');
  const additions: Row[] = [];
  for (const row of observation.rows) {
    const old = copy.universe.filter(r => r.symbol === row.symbol);
    if (old.length > 1 || old.some(r => ['symbol', 'sector', 'is_active', 'created_at', 'updated_at'].some(k => r[k] !== row[k as keyof typeof row]))) return fail('CANONICAL_SECTOR_OBSERVATION_CONFLICT');
    if (!old.length) additions.push(structuredClone(row));
  }
  copy.universe.push(...additions);
  return { data: copy, status: 'CURRENT_OBSERVATION_JOINED' as const, observation_sha256: hash, available_at_conservative_ms: new Date(available).toISOString() };
}

function expectedSessions(date: string): string[] {
  const dates: string[] = []; let d: string | null = date;
  for (let i = 0; i < 20; i++) { d = previousMarketTradingDate('TW', d); if (!d) break; dates.unshift(d); }
  return dates;
}
/** A fixed 20-session denominator, including missing observations. Never use
 * the intersection itself as the denominator or count duplicate providers twice. */
function sameDateInventory(data: EvidenceData, symbol: string, dates: string[], cutoff: number) {
  const usable = (s: string, date: string) => {
    const rows = data.quotes.filter(q => q.symbol === s && q.trading_date === date && q.phase === 'close'
      && q.quality_status === 'verified' && ['fresh', 'provider_returned'].includes(String(q.freshness_status))
      && known(q.captured_at, cutoff) && known(q.ingested_at, cutoff) && stamp(q.captured_at) >= stamp(date + 'T13:25:00+08:00')
      && stamp(q.captured_at) <= stamp(closeAt(date)) && typeof q.value === 'number' && Number.isFinite(q.value) && q.value > 0
      && typeof q.change_percent === 'number' && Number.isFinite(q.change_percent));
    return rows.length && new Set(rows.map(q => q.value)).size === 1 ? rows : [];
  };
  const stock = dates.filter(d => usable(symbol, d).length), index = dates.filter(d => usable('TAIEX', d).length);
  const volume = dates.filter(d => usable(symbol, d).some(q => {
    const p = obj(q.raw_payload);
    return p.contract === 'RECOMMENDATION_STOCK_EVIDENCE_V1' && p.volume_unit === 'SHARES' && p.amount_unit === 'TWD'
      && [p.open, p.high, p.low, p.close, p.volume_shares, p.amount_twd].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
      && p.close === q.value && Number.isSafeInteger(p.volume_shares) && Number.isSafeInteger(p.amount_twd)
      && Number(p.high) >= Math.max(Number(p.open), Number(p.low), Number(p.close)) && Number(p.low) <= Math.min(Number(p.open), Number(p.close));
  }));
  const matched = dates.filter(d => stock.includes(d) && index.includes(d));
  return { denominator: 20, calendar_sessions_covered: dates.length, expected_session_dates: dates,
    stock_close: stock.length, stock_ohlcv_amount: volume.length, taiex_close: index.length,
    stock_and_taiex: matched.length, stock_ohlcv_and_taiex: matched.filter(d => volume.includes(d)).length,
    matched_session_dates: matched, missing_stock_dates: dates.filter(d => !stock.includes(d)), missing_taiex_dates: dates.filter(d => !index.includes(d)) };
}

function validBars(bars: Bar[], cutoff: number): boolean {
  return bars.length <= 1000 && new Set(bars.map(b => b.date)).size === bars.length && bars.every(b =>
    isMarketTradingDate('TW', b.date) && known(b.available_at, cutoff) && stamp(b.available_at) >= stamp(closeAt(b.date))
    && text(b.source_ref) && [b.open, b.high, b.low, b.close, b.volume, b.amount].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
    && Number.isSafeInteger(b.volume) && Number.isSafeInteger(b.amount)
    && b.high >= Math.max(b.open, b.low, b.close) && b.low <= Math.min(b.open, b.close));
}

/** Changes are derived only from adjacent legal sessions, never zero-filled.
 * First observations without a previous close remain diagnostic raw bars only.
 * Official prices are NOT relabelled Fugle; all original refs/receipts survive. */
async function candleQuotes(series: Series, cutoff: number): Promise<Row[]> {
  if (!validBars(series.bars, cutoff)) throw Error('EVENT_ALIGNMENT_BARS_INVALID');
  const sorted = [...series.bars].sort((a, b) => a.date.localeCompare(b.date)), rows: Row[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i], p = sorted[i - 1];
    if (previousMarketTradingDate('TW', b.date) !== p.date) continue;
    const hash = await v2Hash([EVENT_ALIGNMENT_CONTRACT, series.symbol, b, p]);
    const available = stamp(b.available_at) >= stamp(p.available_at) ? b.available_at : p.available_at;
    rows.push({ id: 'event-candle:' + hash, provider: series.provider, symbol: series.symbol, asset_type: 'equity', market: 'TW',
      trading_date: b.date, phase: 'close', session: 'REGULAR_COMPLETED', value: b.close,
      change_percent: (b.close / p.close - 1) * 100, captured_at: closeAt(b.date), ingested_at: available,
      available_at: available, quality_status: 'verified', freshness_status: 'provider_returned',
      raw_payload: { contract: 'RECOMMENDATION_STOCK_EVIDENCE_V1', endpoint: 'historical/candles',
        adapter_contract: EVENT_ALIGNMENT_CONTRACT, evidence_session_date: b.date, source_ref: b.source_ref,
        previous_source_ref: p.source_ref, source_hash: hash, open: b.open, high: b.high, low: b.low, close: b.close,
        volume_shares: b.volume, volume_unit: 'SHARES', amount_twd: b.amount, amount_unit: 'TWD',
        price_basis: 'RAW_UNADJUSTED_NOT_TOTAL_RETURN', original_available_at: b.available_at,
        previous_available_at: p.available_at } });
  }
  return rows;
}

async function indexQuotes(history: BenchmarkClose[], cutoff: number): Promise<Row[]> {
  if (history.length > 1000 || new Set(history.map(b => b.date)).size !== history.length || history.some(b =>
    !isMarketTradingDate('TW', b.date) || b.source !== indexSource(b.date) || !known(b.available_at, cutoff)
    || stamp(b.available_at) < stamp(closeAt(b.date)) || typeof b.close !== 'number' || !Number.isFinite(b.close) || b.close <= 0)) {
    throw Error('EVENT_ALIGNMENT_BENCHMARK_INVALID');
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date)), rows: Row[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i], p = sorted[i - 1];
    if (previousMarketTradingDate('TW', b.date) !== p.date) continue;
    const hash = await v2Hash([b, p]);
    const available = stamp(b.available_at) >= stamp(p.available_at) ? b.available_at : p.available_at;
    rows.push({ id: 'event-index:' + hash, provider: 'twse_official_index', symbol: 'TAIEX', asset_type: 'index', market: 'TW',
      trading_date: b.date, phase: 'close', value: b.close, change_percent: (b.close / p.close - 1) * 100,
      captured_at: closeAt(b.date), ingested_at: available, quality_status: 'verified', freshness_status: 'provider_returned',
      raw_payload: { adapter_contract: EVENT_ALIGNMENT_CONTRACT, evidence_session_date: b.date, source_ref: b.source,
        previous_source_ref: p.source, original_available_at: b.available_at, previous_available_at: p.available_at,
        price_basis: 'PRICE_INDEX_NOT_TOTAL_RETURN' } });
  }
  return rows;
}

async function reviewedMappings(data: EvidenceData, reviews: CausalReview[], cutoff: number): Promise<Row[]> {
  if (reviews.length > 500 || new Set(reviews.map(r => r.mapping_id)).size !== reviews.length) throw Error('EVENT_ALIGNMENT_REVIEW_INVALID');
  const mappings: Row[] = [];
  for (const review of reviews) {
    const ms = data.mappings.filter(m => m.id === review.mapping_id), es = data.news.filter(e => e.id === review.event_id);
    const mapping = ms[0], event = es[0], cs = data.catalysts.filter(c => c.id === mapping?.catalyst_id), catalyst = cs[0];
    if (ms.length !== 1 || es.length !== 1 || cs.length !== 1 || !known(review.reviewed_at, cutoff) || !sha(review.evidence_sha256)
      || !known(mapping.created_at, stamp(review.reviewed_at)) || !known(catalyst.created_at, stamp(review.reviewed_at))
      || !known(catalyst.event_at, stamp(review.reviewed_at)) || !known(event.published_at, stamp(review.reviewed_at))
      || !known(event.created_at, stamp(review.reviewed_at)) || !references(catalyst.source_refs).some(r => r === event.id || r === event.source_url)
      || ![mapping.transmission_path, mapping.taiwan_supply_chain_relation, mapping.invalidation_condition].every(text)
      || await v2Hash({ mapping, catalyst, event }) !== review.evidence_sha256) throw Error('EVENT_ALIGNMENT_REVIEW_INVALID');
    mappings.push(mapping);
  }
  return mappings;
}

async function assemble(identity: DecisionIdentity, original: EvidenceData, series: Series[], benchmark: BenchmarkClose[], reviews: CausalReview[], classifications: Classification[], sourceHash: string, initialIssues: string[]) {
  const cutoff = stamp(identity.generated_at);
  if (!Number.isFinite(cutoff) || !sha(sourceHash) || series.length > 72 || new Set(series.map(s => s.symbol)).size !== series.length) throw Error('EVENT_ALIGNMENT_INPUT_INVALID');
  // Copy caller facts: no mutable admission cache, input edits, or escaped reader.
  const data = structuredClone(original), issues = [...initialIssues], added: Row[] = [];
  for (const s of series) {
    try { added.push(...await candleQuotes(s, cutoff)); } catch { issues.push('EVENT_ALIGNMENT_BARS_INVALID:' + s.symbol); }
  }
  try { added.push(...await indexQuotes(benchmark, cutoff)); } catch { issues.push('EVENT_ALIGNMENT_BENCHMARK_INVALID'); }
  const conflicts = new Set<string>();
  for (const row of added) for (const old of data.quotes.filter(q => q.symbol === row.symbol && q.trading_date === row.trading_date && q.phase === 'close'
    && known(q.captured_at, cutoff) && known(q.ingested_at, cutoff))) {
    if (Number(old.value) !== row.value || !Number.isFinite(Number(old.change_percent)) || Math.abs(Number(old.change_percent) - Number(row.change_percent)) > .02) conflicts.add(String(row.symbol));
  }
  for (const symbol of conflicts) issues.push('EVENT_ALIGNMENT_CANONICAL_CONFLICT:' + symbol);
  const joined = added.filter(q => !conflicts.has(String(q.symbol)));
  data.quotes.push(...joined.filter(q => !data.quotes.some(old => old.id === q.id)));
  // Neither an official announcement nor a same-industry match creates a causal
  // mapping, a beneficiary, or a supply-chain relation. No implicit review.
  try { data.mappings = await reviewedMappings(data, structuredClone(reviews), cutoff); }
  catch { data.mappings = []; issues.push('EVENT_ALIGNMENT_REVIEW_INVALID'); }
  data.failures.push(...issues);
  const decision = buildEvidenceDecision(data, identity);
  const active = data.universe.filter(r => r.is_active === true), expected = expectedSessions(identity.report_date);
  const coverage = series.map(s => {
    const rows = joined.filter(q => q.symbol === s.symbol), dates = new Set(rows.map(r => String(r.trading_date)));
    const canonical = active.filter(r => r.symbol === s.symbol && text(r.sector) && known(r.created_at, cutoff) && known(r.updated_at, cutoff));
    const peerSymbols = canonical.length === 1 ? active.filter(r => r.symbol !== s.symbol && r.sector === canonical[0].sector
      && active.filter(p => p.symbol === r.symbol).length === 1 && known(r.created_at, cutoff) && known(r.updated_at, cutoff)).map(r => String(r.symbol)) : [];
    const c = classifications.filter(r => r.symbol === s.symbol), currentPeers = c.length === 1 ? classifications.filter(r => r.symbol !== s.symbol && r.industry_code === c[0].industry_code).map(r => r.symbol) : [];
    return { symbol: s.symbol, retained_bars: s.bars.length, canonical_closes: rows.length,
      benchmark_same_sessions: joined.filter(q => q.symbol === 'TAIEX' && dates.has(String(q.trading_date))).length,
      same_date: sameDateInventory(data, s.symbol, expected, cutoff),
      causal_review: data.mappings.some(m => m.stock_symbol === s.symbol) ? 'EXACT_CANONICAL_ROWS_REVIEWED' : 'REVIEWED_CAUSAL_EVENT_MISSING',
      sector_mapping: canonical.length !== 1 ? 'AS_OF_CANONICAL_SECTOR_MAPPING_MISSING' : peerSymbols.length < 2 ? 'SECTOR_PEERS_INSUFFICIENT' : 'CANONICAL_MAPPING_PRESENT',
      canonical_peer_symbols: [...new Set(peerSymbols)].sort(), current_official_industry_peers: [...new Set(currentPeers)].sort(),
      canonical_peer_same_date: [...new Set(peerSymbols)].sort().map(symbol => ({ symbol, ...sameDateInventory(data, symbol, expected, cutoff) })),
      official_classification_scope: 'CURRENT_CLASSIFICATION_ONLY_NOT_HISTORICAL_CAUSAL_OR_SUPPLY_CHAIN_PROOF' };
  });
  return { contract: EVENT_ALIGNMENT_CONTRACT, candidate_only: true, owner_only: true, production_eligible: false, promotion_allowed: false,
    cutoff: identity.generated_at, source_sha256: sourceHash, data, decision, coverage, issues: [...new Set(issues)].sort(),
    candidate_input_sha256: await v2Hash({ identity, original, series, benchmark, reviews, classifications, sourceHash }),
    same_date_totals: { symbols: coverage.length, denominator: coverage.length * 20,
      stock_close: coverage.reduce((n, c) => n + c.same_date.stock_close, 0),
      stock_ohlcv_amount: coverage.reduce((n, c) => n + c.same_date.stock_ohlcv_amount, 0),
      stock_and_taiex: coverage.reduce((n, c) => n + c.same_date.stock_and_taiex, 0),
      stock_ohlcv_and_taiex: coverage.reduce((n, c) => n + c.same_date.stock_ohlcv_and_taiex, 0) },
    resource_license: 'HOLD_EXACT_RESOURCE_RIGHTS_UNVERIFIED',
    assessment_session: identity.is_trading_day && isMarketTradingDate('TW', identity.report_date) ? 'TRADING_DAY' : 'NOT_A_TRADING_SESSION',
    interpretation: 'RAW_PRICE_VOLUME_CONTEXT_NOT_CAUSALITY_OR_ADJUSTED_RETURN', business_writes: [], forward_sample: 0, outcome_sample: 0 };
}

/** Existing canonical real fixture, without manufacturing absent V2 captures.
 * Quotes and their timestamps stay verbatim; missing OHLCV stays missing. */
export async function eventAlignmentFromRetainedEvidence(data: EvidenceData, identity: DecisionIdentity, expectedHash: string, reviews: CausalReview[] = []) {
  if (!sha(expectedHash) || await v2Hash(data) !== expectedHash) throw Error('EVENT_ALIGNMENT_SOURCE_HASH_MISMATCH');
  const symbols = [...new Set(data.universe.filter(r => r.is_active === true).map(r => String(r.symbol)))];
  return await assemble(identity, data, symbols.map(symbol => ({ symbol, bars: [], provider: 'existing_canonical_fixture' })), [], reviews, [], expectedHash, []);
}

/** Existing historical fixture/V2 input, same immutable source hash and cutoff.
 * A minimized projection without mapping times cannot manufacture those times. */
export async function eventAlignmentFromV2(input: V2Input, expectedHash: string, reviews: CausalReview[] = []) {
  if (!sha(expectedHash) || await v2Hash(input) !== expectedHash) throw Error('EVENT_ALIGNMENT_SOURCE_HASH_MISMATCH');
  const symbols = [...new Set(input.data.universe.filter(r => r.is_active === true).map(r => String(r.symbol)))];
  const issues: string[] = [], cutoff = stamp(input.identity.generated_at);
  const series = symbols.map(symbol => {
    const captures = input.captures.filter(c => c.symbol === symbol && c.endpoint === 'historical/candles'), capture = captures[0];
    // V2's original gate is still run. Extra receipt binding prevents an invalid
    // capture time or a mismatched source timestamp being normalized away.
    const bound = captures.length === 1 && known(capture.received_at, cutoff) && capture.rows.every(r => {
      const at = stamp(r.captured_at), local = Number.isFinite(at) ? new Date(at + 8 * 3600000).toISOString() : '';
      return stamp(r.ingested_at) === stamp(capture.received_at) && local.slice(0, 10) === r.trading_date
        && local.slice(11, 16) >= '13:25' && local.slice(11, 16) <= '13:30'
        && (r.value === undefined || r.value === obj(r.raw_payload).close);
    });
    if (!bound) issues.push('EVENT_ALIGNMENT_CAPTURE_NOT_BOUND:' + symbol);
    return { symbol, bars: bound ? v2Bars(input, symbol) : [], provider: 'retained_stock_capture' };
  });
  return await assemble(input.identity, input.data, series, input.benchmark_history ?? [], reviews, [], expectedHash, issues);
}

/** Reuse already normalized VNext receipts, not a second public-data parser.
 * All receipt/payload hashes and availability are checked anew on every call.
 * Official current industry rows are diagnostic only; never rewrite universe. */
export async function eventAlignmentFromDailyReceipts(identity: DecisionIdentity, data: EvidenceData, receipts: SourceReceipt[], reviews: CausalReview[] = []) {
  if (receipts.length > 1500) throw Error('EVENT_ALIGNMENT_RECEIPT_LIMIT');
  const cutoff = stamp(identity.generated_at), bySymbol = new Map<string, Series>(), benchmark: BenchmarkClose[] = [], classifications: Classification[] = [], issues: string[] = [];
  const keys = new Set<string>();
  for (const receipt of receipts) {
    const { task } = receipt;
    if (!['PRICE', 'OTC_PRICE', 'BENCHMARK', 'DIRECTORY', 'EVENT'].includes(task.kind)) continue;
    if (['PRICE', 'OTC_PRICE'].includes(task.kind)) for (const symbol of task.symbols) {
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, { symbol, provider: task.kind === 'PRICE' ? 'twse_official_stock_day' : 'tpex_official_daily_quotes', bars: [] });
    }
    if (keys.has(task.key)) { issues.push('EVENT_ALIGNMENT_DUPLICATE_RECEIPT'); continue; } keys.add(task.key);
    if (receipt.status !== 'OK' || !known(receipt.available_at, cutoff) || receipt.first_seen_at !== receipt.available_at
      || !sha(receipt.raw_hash) || receipt.payload_hash !== await snapshotHash(receipt.payload)) { issues.push('EVENT_ALIGNMENT_RECEIPT_NOT_ADMISSIBLE:' + task.key); continue; }
    const rows = receipt.payload.rows;
    if (!Array.isArray(rows)) { issues.push('EVENT_ALIGNMENT_RECEIPT_ROWS_INVALID'); continue; }
    if (task.kind === 'EVENT') continue; // Index metadata is never causal review.
    if (task.kind === 'DIRECTORY') {
      if (!['https://openapi.twse.com.tw/v1/opendata/t187ap03_L', 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'].includes(task.url)) { issues.push('EVENT_ALIGNMENT_DIRECTORY_SOURCE_INVALID'); continue; }
      for (const value of rows) { const r = obj(value); if (typeof r.industry === 'string' && /^\d{1,2}$/.test(r.industry) && task.symbols.includes(String(r.symbol))) classifications.push({ symbol: String(r.symbol), industry_code: r.industry.padStart(2, '0'), available_at: receipt.available_at, source_ref: task.url }); }
      continue;
    }
    if (task.kind === 'BENCHMARK' && task.url !== V2_INDEX_URL + '?date=' + String(task.month).replace('-', '') + '01&response=json') { issues.push('EVENT_ALIGNMENT_BENCHMARK_SOURCE_INVALID'); continue; }
    for (const value of rows) {
      const r = obj(value), date = String(r.date), available = r.available_at;
      if (available !== receipt.available_at || r.first_seen_at !== available) { issues.push('EVENT_ALIGNMENT_ROW_RECEIPT_MISMATCH'); continue; }
      if (task.kind === 'BENCHMARK') { benchmark.push({ date, close: Number(r.close), source: task.url + '#' + date, available_at: String(available) }); continue; }
      const symbol = String(r.symbol), expected = task.kind === 'PRICE' && task.exchange === 'TWSE' && task.month ? historyUrl('TWSE', symbol, task.month) : task.kind === 'OTC_PRICE' && task.date ? tpexDailyUrl(task.date) : '';
      if (!expected || task.url !== expected || !task.symbols.includes(symbol) || r.source !== task.url
        || task.kind === 'PRICE' && !date.startsWith(String(task.month) + '-') || task.kind === 'OTC_PRICE' && date !== task.date
        || r.session_scope === 'ROUNDED_THOUSANDS_EXCLUDES_BLOCK_TRADES') { issues.push('EVENT_ALIGNMENT_STOCK_SOURCE_INVALID:' + symbol); continue; }
      const series = bySymbol.get(symbol) ?? { symbol, provider: task.kind === 'PRICE' ? 'twse_official_stock_day' : 'tpex_official_daily_quotes', bars: [] };
      series.bars.push({ date, open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume), amount: Number(r.amount), source_ref: task.url, available_at: String(available) }); bySymbol.set(symbol, series);
    }
  }
  return await assemble(identity, data, [...bySymbol.values()], benchmark, reviews, classifications, await v2Hash(receipts), issues);
}
