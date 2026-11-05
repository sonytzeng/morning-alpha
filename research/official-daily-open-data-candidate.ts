/** Offline, bounded, exact-resource facts only. No fetch, clocks, files, source
 * registry, SourceTask receipts, strategy, admission or publication authority.
 * Retrieval hashes identify bytes, NEVER an exchange's original version. */
import { createHash } from 'node:crypto';
import { csvRows } from '../src/features/vnext/dailyParsers.mjs';
import { officialDate, officialNumber } from './entry-official-history.ts';
import { compareTime, validObservationTime } from '../src/features/vnext/contracts.ts';
import { isMarketTradingDate } from '../supabase/functions/_shared/market-session-contract.mjs';
import { RECOMMENDATION_UNIVERSE } from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import { emptyEvidenceData, type Row } from '../supabase/functions/_shared/decision-v1-data.ts';

export const OFFICIAL_DAILY_OPEN_CONTRACT = 'OFFICIAL_DAILY_OPEN_DATA_CANDIDATE_V1';
export const OFFICIAL_DAILY_OPEN_LIMITS = Object.freeze({ resources: 4, bytes_per_resource: 2_000_000, records_per_resource: 15000 });
export const OFFICIAL_DAILY_OPEN_PROFILES = Object.freeze({
  TWSE_11549: Object.freeze({
    url: 'https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data',
    headers: Object.freeze(['日期','證券代號','證券名稱','成交股數','成交金額','開盤價','最高價','最低價','收盤價','漲跌價差','成交筆數']),
    provider: 'twse_official_stock_day_all_open_data', session_scope: 'NOT_YET_REVIEWED',
  }),
  TPEX_11371: Object.freeze({
    url: 'https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&se=EW&o=data',
    headers: Object.freeze(['資料日期','代號','名稱','收盤','漲跌','開盤','最高','最低','成交股數','成交金額','成交筆數','最後買價','最後賣價','發行股數','次日漲停價','次日跌停價']),
    provider: 'tpex_official_no1430_open_data', session_scope: 'EXCLUDES_1430_FIXED_PRICE',
  }),
  TPEX_11370: Object.freeze({
    url: 'https://www.tpex.org.tw/web/stock/aftertrading/DAILY_CLOSE_quotes/stk_quote_result.php?l=zh-tw&o=data',
    headers: Object.freeze(['資料日期','代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額','成交筆數','最後買價','最後賣價','發行股數','次日參考價','次日漲停價','次日跌停價']),
    provider: 'tpex_official_daily_close_open_data', session_scope: 'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES',
  }),
  TAIEX_11555: Object.freeze({
    url: 'https://www.twse.com.tw/exchangeReport/MI_INDEX?response=open_data',
    headers: Object.freeze(['日期','指數/報酬指數','收盤指數','漲跌(+/-)','漲跌點數','漲跌百分比(%)','特殊處理註記']),
    provider: 'twse_official_mi_index_open_data', session_scope: 'NOT_YET_REVIEWED',
  }),
});
export type OfficialDailyOpenResourceId = keyof typeof OFFICIAL_DAILY_OPEN_PROFILES;
/** This is the retained exact-resource receipt, NOT a VNext SourceReceipt. The
 * caller must supply its actual timestamps; neither timestamp has a default. */
export type OfficialDailyOpenReceipt = {
  schema: 'EXACT_REGISTERED_OPEN_RESOURCE_RAW_RECEIPT_V1'; id: OfficialDailyOpenResourceId;
  url: string; http: number; bytes: number; raw_sha256: string;
  first_seen_at: string; available_at: string; fields: readonly string[]; row_count: number;
  native_dates: readonly string[]; original_published_at: null; original_version: null;
  source_session_scope: 'NOT_YET_REVIEWED';
  source_admission: false; canonical_admission: false; publication_approval: false;
};
export type OfficialDailyOpenInput = {
  trading_date: string; cutoff: string;
  resources: { receipt: OfficialDailyOpenReceipt; response_body: Uint8Array }[];
};
const held = () => ({ quality_status: 'source_scope_unreviewed' as const,
  source_admission: false as const, canonical_admission: false as const, publication_approval: false as const,
  source_approved: false as const, canonical_approved: false as const, publication_approved: false as const });
const reviewGaps = ['SOURCE_SCOPE_REVIEW_REQUIRED','CANONICAL_ADMISSION_REQUIRED','PUBLICATION_APPROVAL_REQUIRED',
  'ORIGINAL_PUBLICATION_TIME_UNKNOWN','ORIGINAL_VERSION_UNKNOWN','VOLUME_AMOUNT_HISTORY_COMPARABILITY_UNREVIEWED'] as const;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const referenceAt = (date: string) => date + 'T13:30:00+08:00';
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

type RecordLine = { cells: string[]; raw_record: string; record_number: number; line_start: number; line_end: number };
/** Only locates original record spans and rejects malformed quote placement.
 * Cell decoding, escaping and its size limits remain owned by existing csvRows. */
function retainedRecords(text: string): RecordLine[] {
  const records: RecordLine[] = []; let start = 0, line = 1, lineStart = 1, physicalRecords = 0;
  let state: 'START' | 'PLAIN' | 'QUOTED' | 'CLOSED' = 'START';
  const finish = (end: number) => {
    if (++physicalRecords > OFFICIAL_DAILY_OPEN_LIMITS.records_per_resource) throw Error('OPEN_DATA_RECORD_LIMIT');
    const raw_record = text.slice(start, end), parsed: string[][] = csvRows(raw_record);
    if (parsed.length > 1) throw Error('OPEN_DATA_RECORD_SHAPE');
    if (parsed.length) records.push({ cells: parsed[0], raw_record, record_number: physicalRecords, line_start: lineStart, line_end: line });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === 'QUOTED') {
      if (c === '"') { if (text[i + 1] === '"') i++; else state = 'CLOSED'; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; line++; }
      continue;
    }
    if (c === '\n' || c === '\r') {
      finish(i); if (c === '\r' && text[i + 1] === '\n') i++;
      line++; start = i + 1; lineStart = line; state = 'START';
    } else if (c === ',') state = 'START';
    else if (c === '"' && state === 'START') state = 'QUOTED';
    else if (c === '"' || state === 'CLOSED') throw Error('OPEN_DATA_CSV_QUOTING');
    else state = 'PLAIN';
  }
  if (state === 'QUOTED') throw Error('OPEN_DATA_CSV_UNCLOSED');
  if (start < text.length) finish(text.length);
  return records;
}

/** Commas must actually be thousands separators. A native leading '+' is a
 * sign, not missing data; retain it in raw_record before using officialNumber. */
function number(value: string): number | null {
  const s = value.trim();
  return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s) ? officialNumber(s.replace(/^\+/, '')) : null;
}
function stockValues(id: OfficialDailyOpenResourceId, cells: string[]) {
  const positions = id === 'TWSE_11549' ? [5,6,7,8,3,4,9,10]
    : id === 'TPEX_11370' ? [5,6,7,3,9,10,4,11] : [5,6,7,3,8,9,4,10];
  const values = positions.map(i => number(cells[i]));
  // OHLCVA facts do not require a final bid/ask, issued-share count or next-day
  // limits. Retain every auxiliary source cell, but never make these unrelated
  // fields a hard gate or a feature in the original evaluator.
  if (values.slice(0,6).some(v => v === null)) return { values: null, reason: 'REQUIRED_NUMERIC_VALUE_MISSING_OR_INVALID' };
  const [open,high,low,close,volume_shares,amount_twd] = values.slice(0,6) as number[];
  if ([open,high,low,close].some(v => v <= 0 || v > Number.MAX_SAFE_INTEGER)
    || high < Math.max(open,low,close) || low > Math.min(open,close)) return { values: null, reason: 'OHLC_INVALID' };
  // Check lexical integrality BEFORE trusting Number.isSafeInteger: a decimal
  // just below MAX_SAFE_INTEGER can round into an apparently safe integer.
  const integerPositions = [4,5].map(i => positions[i]);
  const integral = integerPositions.every(i => /^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(cells[i].trim())
    && Number.isSafeInteger(number(cells[i])));
  if (!integral || ![volume_shares,amount_twd].every(v => Number.isSafeInteger(v) && v > 0)) return { values: null, reason: 'UNSAFE_OR_NONPOSITIVE_SHARES_OR_TWD' };
  const change=values[6],previous=change===null?null:close-change;
  const derived=change!==null&&previous!==null&&previous>0?change/previous*100:null;
  const change_percent=derived!==null&&Number.isFinite(derived)?derived:null;
  const rawTrades=values[7],trade_count=rawTrades!==null&&/^\+?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.0+)?$/.test(cells[positions[7]].trim())
    &&Number.isSafeInteger(rawTrades)&&rawTrades>0?rawTrades:null;
  const metric_gaps=[...(change_percent===null?['NATIVE_CHANGE_OR_REFERENCE_UNPROVEN']:[]),
    ...(trade_count===null?['NATIVE_TRADE_COUNT_UNPROVEN']:[])];
  return { values: { open,high,low,close,volume_shares,amount_twd,change,change_percent,trade_count }, metric_gaps, reason: null };
}
function benchmarkValues(cells: string[]) {
  const close = number(cells[2]), points = number(cells[4]), percent = number(cells[5]), sign = cells[3].trim();
  if (close === null || close <= 0 || points === null || percent === null) return { values: null, reason: 'BENCHMARK_NUMERIC_VALUE_INVALID' };
  if (!['+','-',''].includes(sign) || sign !== '-' && (points < 0 || percent < 0)
    || sign === '' && (points !== 0 || percent !== 0)) return { values: null, reason: 'BENCHMARK_DIRECTION_INVALID' };
  const direction = sign === '-' ? -1 : 1;
  if (close - direction * Math.abs(points) <= 0) return { values: null, reason: 'BENCHMARK_PREVIOUS_CLOSE_INVALID' };
  // A special-treatment note is retained, never silently interpreted as normal.
  if (cells[6].trim() !== '') return { values: null, reason: 'BENCHMARK_SPECIAL_TREATMENT_REVIEW_REQUIRED' };
  return { values: { close,change_points: direction * Math.abs(points),change_percent: direction * Math.abs(percent) }, reason: null };
}
type Trace = ReturnType<typeof trace>;
function trace(receipt: OfficialDailyOpenReceipt, record: RecordLine, date: string) {
  const profile = OFFICIAL_DAILY_OPEN_PROFILES[receipt.id];
  return { ...held(), resource_id: receipt.id, provider: profile.provider, source_url: receipt.url,
    raw_sha256: receipt.raw_sha256, raw_hash_basis: 'RETRIEVED_BYTES_NOT_ORIGINAL_VERSION' as const,
    native_date: record.cells[0], trading_date: date, raw_record: record.raw_record, native_cells: [...record.cells],
    record_number: record.record_number, line_start: record.line_start, line_end: record.line_end,
    first_seen_at: receipt.first_seen_at, available_at: receipt.available_at,
    published_at: null, original_published_at: null, original_version: null, source_version: null,
    session_scope: profile.session_scope, session_scope_review_status: 'NOT_YET_REVIEWED' as const,
    receipt_source_session_scope: receipt.source_session_scope, canonical_session_scope: null,
    volume_amount_comparable_to_history: false as const,
    session_reference_at: referenceAt(date),
    session_reference_basis: 'DERIVED_SESSION_REFERENCE_NOT_PUBLICATION_TIME' as const };
}
type StockFact = Trace & { symbol: string; stock_name: string; volume_unit: 'SHARES'; amount_unit: 'TWD';
  values: NonNullable<ReturnType<typeof stockValues>['values']>; metric_gaps: string[]; change_percent_basis: string };
type BenchmarkFact = Trace & { symbol: 'TAIEX'; index_name: '發行量加權股價指數';
  values: NonNullable<ReturnType<typeof benchmarkValues>['values']>; price_basis: 'PRICE_INDEX_NOT_TOTAL_RETURN' };

function candidateQuote(fact: StockFact | BenchmarkFact): Row {
  const stock = 'stock_name' in fact;
  return { ...held(), id: `official-open-candidate:${fact.resource_id}:${fact.raw_sha256}:${fact.record_number}`,
    provider: fact.provider, source: fact.provider, source_url: fact.source_url,
    symbol: fact.symbol, asset_type: stock ? 'equity' : 'index', market: 'TW', trading_date: fact.trading_date,
    phase: 'close', session: null, session_scope: fact.session_scope, canonical_session_scope: null,
    value: fact.values.close, change_percent: fact.values.change_percent,
    captured_at: fact.session_reference_at, captured_at_basis: fact.session_reference_basis,
    source_timestamp: null, published_at: null, original_published_at: null, original_version: null,
    first_seen_at: fact.first_seen_at, ingested_at: fact.available_at, available_at: fact.available_at,
    freshness_status: 'provider_returned',
    // Deliberately NOT RECOMMENDATION_STOCK_EVIDENCE_V1 / historical/candles.
    raw_payload: { ...structuredClone(fact), contract: OFFICIAL_DAILY_OPEN_CONTRACT,
      ...fact.values, evidence_session_date: fact.trading_date } };
}

/** One explicit trading date; a missing resource is a gap for the fixed 72,
 * not permission to shrink the denominator. Structural failures are atomic;
 * selected-row value failures retain per-symbol gaps, never fabricated values.
 * Caller-owned receipt/bytes are captured synchronously; inputs are not mutated.
 * OGL/free access is not quality, scope, canonical or member approval. */
export function normalizeOfficialDailyOpenDataCandidate(input: OfficialDailyOpenInput) {
  const { trading_date: date, cutoff } = input;
  if (officialDate(date) !== date || !isMarketTradingDate('TW', date)) throw Error('OPEN_DATA_TRADING_DATE_INVALID');
  if (!validObservationTime(cutoff) || compareTime(referenceAt(date), cutoff) > 0) throw Error('OPEN_DATA_CUTOFF_BEFORE_COMPLETED_SESSION');
  if (!Array.isArray(input.resources) || input.resources.length > OFFICIAL_DAILY_OPEN_LIMITS.resources) throw Error('OPEN_DATA_RESOURCE_LIMIT');
  const facts = new Map<string, StockFact>(), rejected = new Map<string, { gaps: string[]; observation: Trace }>(), selectedSymbols = new Set<string>();
  const comparisonFacts: StockFact[] = [], comparisonRejected: { symbol: string; gaps: string[]; observation: Trace }[] = [];
  const seenResources = new Set<string>(), sources: Row[] = []; let benchmark: BenchmarkFact | null = null;
  let rejectedBenchmark: Trace | null = null;
  const benchmarkGaps: string[] = [];
  for (const resource of input.resources) {
    const r = resource.receipt, id = r.id;
    if (!Object.hasOwn(OFFICIAL_DAILY_OPEN_PROFILES, id) || seenResources.has(id)) throw Error('OPEN_DATA_RESOURCE_ID_OR_DUPLICATE');
    seenResources.add(id); const profile = OFFICIAL_DAILY_OPEN_PROFILES[id];
    if (r.schema !== 'EXACT_REGISTERED_OPEN_RESOURCE_RAW_RECEIPT_V1' || r.url !== profile.url || r.http !== 200
      || r.original_published_at !== null || r.original_version !== null || r.source_session_scope !== 'NOT_YET_REVIEWED'
      || r.source_admission !== false || r.canonical_admission !== false || r.publication_approval !== false) throw Error('OPEN_DATA_RECEIPT_OR_SOURCE_INVALID');
    if (!validObservationTime(r.first_seen_at) || !validObservationTime(r.available_at)
      || compareTime(r.first_seen_at, r.available_at) > 0 || compareTime(r.available_at, cutoff) > 0
      || compareTime(referenceAt(date), r.first_seen_at) > 0) throw Error('OPEN_DATA_NOT_AVAILABLE_AT_CUTOFF_OR_UNFINISHED');
    if (!(resource.response_body instanceof Uint8Array) || resource.response_body.byteLength < 1
      || resource.response_body.byteLength > OFFICIAL_DAILY_OPEN_LIMITS.bytes_per_resource
      || resource.response_body.byteLength !== r.bytes) throw Error('OPEN_DATA_BYTE_LIMIT_OR_SIZE_MISMATCH');
    const bytes = resource.response_body.slice();
    if (!/^[a-f0-9]{64}$/.test(r.raw_sha256) || digest(bytes) !== r.raw_sha256) throw Error('OPEN_DATA_RAW_HASH_MISMATCH');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw Error('OPEN_DATA_UTF8_INVALID'); }
    const records = retainedRecords(text.replace(/^\uFEFF/, '')), header = records.shift();
    if (!header || !same(header.cells, profile.headers) || !same(r.fields, profile.headers)) throw Error('OPEN_DATA_SCHEMA_OR_UNITS_CHANGED');
    if (!records.length || records.length !== r.row_count) throw Error('OPEN_DATA_ROW_COUNT_INVALID');
    const seen = new Set<string>(), nativeDates = new Set<string>(); let matched = 0;
    for (const record of records) {
      const cells = record.cells;
      if (cells.length !== profile.headers.length) throw Error('OPEN_DATA_ROW_WIDTH_INVALID');
      if (officialDate(cells[0]) !== date) throw Error('OPEN_DATA_SESSION_DATE_MISMATCH');
      nativeDates.add(cells[0]); const key = id === 'TAIEX_11555' ? cells[1] : cells[1].trim();
      if (!key || seen.has(key)) throw Error('OPEN_DATA_DUPLICATE_OR_EMPTY_SYMBOL_OR_INDEX');
      seen.add(key);
      if (id === 'TAIEX_11555') {
        if (key !== '發行量加權股價指數') continue;
        matched++; const parsed = benchmarkValues(cells);
        if (!parsed.values) { benchmarkGaps.push(parsed.reason!); rejectedBenchmark = trace(r, record, date); continue; }
        benchmark = { ...trace(r, record, date), symbol: 'TAIEX', index_name: '發行量加權股價指數',
          values: parsed.values, price_basis: 'PRICE_INDEX_NOT_TOTAL_RETURN' };
      } else {
        if (!RECOMMENDATION_UNIVERSE.includes(key)) continue;
        const comparisonOnly = id === 'TPEX_11371';
        if (!comparisonOnly && selectedSymbols.has(key)) throw Error('OPEN_DATA_CROSS_RESOURCE_DUPLICATE_SYMBOL');
        if (!comparisonOnly) selectedSymbols.add(key);
        matched++;
        const name = cells[2].trim(), parsed = stockValues(id, cells);
        const reasons = [...(!name || name.length > 200 || /[\u0000-\u001f\u007f]/u.test(name) ? ['STOCK_NAME_MISSING_OR_INVALID'] : []),
          ...(!parsed.values ? [parsed.reason!] : [])];
        if (reasons.length) {
          const failure = { gaps: reasons, observation: trace(r, record, date) };
          if (comparisonOnly) comparisonRejected.push({ symbol: key, ...failure }); else rejected.set(key, failure);
          continue;
        }
        const fact: StockFact = { ...trace(r, record, date), symbol: key, stock_name: name, values: parsed.values!, metric_gaps:parsed.metric_gaps!,
          volume_unit: 'SHARES', amount_unit: 'TWD', change_percent_basis: 'DERIVED_NATIVE_CHANGE_OVER_CLOSE_MINUS_NATIVE_CHANGE_NOT_ADJUSTED_RETURN' };
        if (comparisonOnly) comparisonFacts.push(fact); else facts.set(key, fact);
      }
    }
    if (!same([...nativeDates].sort(), [...r.native_dates].sort())) throw Error('OPEN_DATA_RECEIPT_NATIVE_DATES_MISMATCH');
    sources.push({ ...held(), resource_id: id, source_url: r.url, provider: profile.provider,
      raw_sha256: r.raw_sha256, raw_hash_basis: 'RETRIEVED_BYTES_NOT_ORIGINAL_VERSION', bytes: r.bytes,
      source_rows: records.length, matched_rows: matched, native_dates: [...nativeDates],
      first_seen_at: r.first_seen_at, available_at: r.available_at, published_at: null, original_published_at: null, original_version: null,
      session_scope: profile.session_scope, session_scope_review_status: 'NOT_YET_REVIEWED', canonical_session_scope: null,
      volume_amount_comparable_to_history: false });
  }
  const stocks = RECOMMENDATION_UNIVERSE.map(symbol => ({ symbol, ...held(), fact: facts.get(symbol) ?? null,
    rejected_observation: rejected.get(symbol)?.observation ?? null,
    status: facts.has(symbol) ? 'FACTS_AVAILABLE_REVIEW_REQUIRED' : 'UNAVAILABLE',
    gaps: [...(facts.has(symbol) ? facts.get(symbol)!.metric_gaps : rejected.get(symbol)?.gaps ?? ['SYMBOL_NOT_IN_SUPPLIED_EXACT_RESOURCES']), ...reviewGaps] }));
  const data = emptyEvidenceData();
  data.quotes = [...facts.values(), ...(benchmark ? [benchmark] : [])].map(candidateQuote);
  return { contract: OFFICIAL_DAILY_OPEN_CONTRACT, ...held(), candidate_only: true, production_eligible: false,
    promotion_allowed: false, member_publication_approved: false, original_thresholds_changed: false,
    trading_date: date, cutoff, calendar_trading_day: true, sources, stocks,
    primary_stock_resources: ['TWSE_11549','TPEX_11370'],
    comparison_11371: { ...held(), role: 'SCOPE_COMPARISON_ONLY_NOT_PRIMARY_72',
      facts: comparisonFacts, rejected: comparisonRejected, candidate_quotes: 0 },
    benchmark: { ...held(), fact: benchmark, rejected_observation: rejectedBenchmark,
      gaps: [...(benchmark ? [] : benchmarkGaps.length ? benchmarkGaps : ['EXACT_TAIEX_PRICE_INDEX_MISSING']),
      ...reviewGaps.filter(g => g !== 'VOLUME_AMOUNT_HISTORY_COMPARABILITY_UNREVIEWED')] },
    counts: { universe: 72, stocks_with_facts: facts.size, stocks_missing_facts: 72 - facts.size, benchmark_facts: benchmark ? 1 : 0,
      candidate_quotes: data.quotes.length, verified_quotes: 0 },
    data, business_writes: [], original_publication_time: null, original_version: null };
}
