/** Strict TPEx effective-action lists. Coverage is bounded to five explicit
 * classes, the response's echoed date range and its real receipt time.
 * No adjustment factors, point-in-time history, source rights or trade fills.
 */
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { marketSnapshotHash } from './taiwan-market-universe.mjs';
import { compareTime, validObservationTime } from '../src/features/vnext/contracts.ts';
import { officialDate } from './entry-official-history.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Error('TAIWAN_ACTION_' + code); };
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
const contexts = new WeakMap();
export const TAIWAN_ACTION_KINDS = Object.freeze(['CASH_DIVIDEND', 'STOCK_DIVIDEND', 'SPLIT', 'RIGHTS', 'CAPITAL_REDUCTION']);
export const TPEX_ACTION_SOURCES = freeze({
  tpex_ex_right: { family: 'ACTION_EX_RIGHT', base: 'https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ',
    coverage_kinds: ['CASH_DIVIDEND', 'STOCK_DIVIDEND', 'RIGHTS'],
    fields: ['除權息日期', '代號', '名稱', '除權息前收盤價', '除權息參考價', '權值', '息值', '權值+息值', '權/息',
      '漲停價', '跌停價', '開始交易基準價', '減除股利參考價', '現金股利', '每仟股無償配股', '現金增資股數', '現金增資認購價',
      '公開承銷股數', '員工認購股數', '原股東認購股數', '按持股比例仟股認購'] },
  tpex_capital_reduction: { family: 'ACTION_CAPITAL_REDUCTION', base: 'https://www.tpex.org.tw/www/zh-tw/bulletin/revivt',
    coverage_kinds: ['CAPITAL_REDUCTION'],
    fields: ['恢復買賣日期', '股票代號', '名稱', '最後交易日之收盤價格', '減資恢復買賣開始日參考價格', '漲停價格', '跌停價格',
      '開始交易基準價', '除權參考價', '減資原因', '詳細資料'] },
  tpex_par_value_change: { family: 'ACTION_PAR_VALUE_CHANGE', base: 'https://www.tpex.org.tw/www/zh-tw/bulletin/pvChgRslt',
    coverage_kinds: ['SPLIT'],
    fields: ['恢復買賣日期', '證券代號', '證券名稱', '最後交易日之收盤價格', '恢復買賣開始參考價', '漲停價格', '跌停價格', '開始交易基準價', '詳細資料'] },
});
function day(value) { return typeof value === 'string' && /^20\d\d-\d\d-\d\d$/.test(value) && officialDate(value) === value; }
function range(from, through) {
  if (!day(from) || !day(through) || from > through || (Date.parse(through) - Date.parse(from)) / 86_400_000 > 550) fail('RANGE');
}
export function taiwanActionUrl(source_id, from, through) {
  range(from, through); const spec = TPEX_ACTION_SOURCES[source_id]; if (!spec) fail('UNSUPPORTED_SOURCE');
  return spec.base + '?startDate=' + from.replaceAll('-', '/') + '&endDate=' + through.replaceAll('-', '/') + '&response=json';
}
/** Exact HTTP entity bytes are exposed separately for a private raw-capture
 * admission. The gzip wire bytes and original receipt remain independently bound. */
export function decodeTaiwanActionCapture({ receipt, bytes }) {
  const r = receipt, spec = TPEX_ACTION_SOURCES[r?.source_id]; if (!spec) fail('UNSUPPORTED_SOURCE');
  range(r.from, r.through);
  if (r.schema !== 'TAIWAN_HISTORY_SOURCE_RECEIPT_V1' || r.market !== 'TPEX' || r.family !== spec.family
    || r.state !== 'CAPTURED' || r.status !== 200 || r.url !== taiwanActionUrl(r.source_id, r.from, r.through)
    || !validObservationTime(r.started_at) || !validObservationTime(r.received_at) || compareTime(r.started_at, r.received_at) > 0
    || r.raw_bytes_complete !== true || r.historical_knowledge !== false
    || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16_000_000 || bytes.length !== r.bytes || sha(bytes) !== r.sha256
    || r.task_id !== sha(r.url)) fail('SOURCE_RECEIPT');
  const encoding = r.content_encoding ?? ''; if (!['', 'identity', 'gzip'].includes(encoding)) fail('CONTENT_ENCODING');
  let entity_bytes, payload;
  try {
    entity_bytes = encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: 16_000_000 }) : bytes;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(entity_bytes).replace(/^\uFEFF/, '');
    payload = JSON.parse(text);
  } catch { fail('ENTITY_DECODE'); }
  if (!object(payload)) fail('PAYLOAD');
  const public_receipt = { schema: 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1', source_id: r.source_id, url: r.url,
    format: 'json', state: 'CAPTURED', status: 200, started_at: r.started_at, received_at: r.received_at,
    bytes: entity_bytes.length, sha256: sha(entity_bytes), row_count: null, historical_knowledge: false,
    entity_encoding: 'UTF8_JSON_WITHOUT_RESERIALIZATION',
    wire_capture: { source_id: r.source_id, source_sha256: r.sha256, source_bytes: r.bytes,
      content_encoding: encoding || 'identity', receipt_hash: marketSnapshotHash(r) } };
  return { payload, entity_bytes, public_receipt };
}
function decimal(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text.replaceAll(',', '')); return Number.isFinite(n) && n >= 0 ? n : null;
}
function htmlCells(value, labels) {
  if (typeof value !== 'string' || value.length > 8_000 || !value.startsWith('<table>') || !value.endsWith('</table>')) return null;
  const body = value.slice(7, -8), cells = [...body.matchAll(/<tr><th>([^<>]*)<\/th><td>([^<>]*)<\/td><\/tr>/g)];
  if (cells.map(match => match[0]).join('') !== body || cells.length !== labels.length || cells.some((match, i) => match[1] !== labels[i])) return null;
  return cells.map(match => match[2].replaceAll(/&nbsp;?/g, ' ').replaceAll('&amp;', '&').trim());
}
function detailNumber(value, suffix = '') {
  if (value === 'NA') return null;
  if (typeof value !== 'string' || suffix && !value.endsWith(suffix)) return null;
  return decimal(suffix ? value.slice(0, -suffix.length).trim() : value);
}
function classifyExRight(row) {
  const values = row.slice(13, 21).map(decimal), issues = [], kinds = [];
  if (values.some(value => value === null)) issues.push('EX_RIGHT_EXPLICIT_NONNEGATIVE_FIELDS_REQUIRED');
  const [cash, stock, newShares, subscriptionPrice, publicShares, employeeShares, originalShares, originalPer1000] = values;
  if (cash > 0) kinds.push('CASH_DIVIDEND'); if (stock > 0) kinds.push('STOCK_DIVIDEND');
  if (originalShares > 0 || originalPer1000 > 0) kinds.push('RIGHTS');
  const rights = kinds.includes('STOCK_DIVIDEND') || kinds.includes('RIGHTS');
  const expectedLabel = cash > 0 && rights ? '除權息' : cash > 0 ? '除息' : rights ? '除權' : null;
  if (!expectedLabel || row[8] !== expectedLabel) issues.push('EX_RIGHT_CLASSIFICATION_OR_LABEL_UNRESOLVED');
  return { kinds: kinds.length ? kinds : ['UNCLASSIFIED_EX_RIGHT'], issues, subtype: 'EX_RIGHT_OR_DIVIDEND', suspension_from: null,
    reported: { label: row[8], cash_dividend: cash, bonus_shares_per_1000: stock, capital_raise_shares: newShares,
      subscription_price: subscriptionPrice, public_underwriting_shares: publicShares, employee_shares: employeeShares,
      original_shareholder_subscription_shares: originalShares, original_shareholder_subscription_per_1000: originalPer1000,
      quantities_are_as_reported_not_an_entitlement_ledger: true } };
}
function classifyResumption(source_id, row, symbol, effectiveDate) {
  const capital = source_id === 'tpex_capital_reduction';
  const labels = capital ? ['股票代號/股票名稱:', '停止買賣日期:', '恢復買賣日期:', '每壹仟股換發新股票:', '每股退還股款:',
    '現金增資總股數:', '現金增資認購價:', '現金增資配股率:']
    : ['證券代號/證券名稱:', '停止買賣日期:', '恢復買賣日期:', '變更股票面額換股率:', '變更前股票面額:', '變更後股票面額:'];
  const details = htmlCells(row[capital ? 10 : 8], labels), issues = [];
  if (!details) issues.push('RESUMPTION_DETAIL_SCHEMA_REQUIRED');
  const suspension = details ? officialDate(details[1]) : null;
  if (details && (details[0].split('/')[0].trim() !== symbol || officialDate(details[2]) !== effectiveDate
    || !suspension || suspension > effectiveDate)) issues.push('RESUMPTION_DETAIL_IDENTITY_OR_DATE');
  let reported;
  if (capital) {
    const exchanged = details ? detailNumber(details[3], '股') : null, cash = details ? detailNumber(details[4], '元/股') : null;
    if (exchanged === null || cash === null) issues.push('CAPITAL_REDUCTION_EXPLICIT_DETAIL_REQUIRED');
    reported = { reason: row[9], replacement_shares_per_1000: exchanged, cash_return_as_reported: cash,
      capital_raise_shares_text: details?.[5] ?? null, subscription_price_text: details?.[6] ?? null,
      capital_raise_ratio_text: details?.[7] ?? null, quantities_are_as_reported_not_an_entitlement_ledger: true };
  } else {
    const ratio = details ? decimal(details[3]) : null, before = details ? decimal(details[4]) : null, after = details ? decimal(details[5]) : null;
    if (!(ratio > 0 && before > 0 && after > 0) || Math.abs(ratio * after - before) > Math.max(1, before) * 1e-8) issues.push('PAR_VALUE_DETAIL_RATIO_UNRESOLVED');
    reported = { exchange_ratio_as_reported: ratio, par_value_before_as_reported: before, par_value_after_as_reported: after,
      replay_kind_mapping: 'SPLIT_IS_EVENT_EXCLUSION_CLASS_NOT_AN_APPLIED_ADJUSTMENT', quantities_are_as_reported_not_an_entitlement_ledger: true };
  }
  return { kinds: [capital ? 'CAPITAL_REDUCTION' : 'SPLIT'], subtype: capital ? 'CAPITAL_REDUCTION' : 'PAR_VALUE_CHANGE',
    suspension_from: suspension, reported, issues };
}

export function normalizeTaiwanActionCapture({ receipt, bytes }) {
  const { payload, public_receipt } = decodeTaiwanActionCapture({ receipt, bytes }), spec = TPEX_ACTION_SOURCES[receipt.source_id];
  if (Object.keys(payload).sort().join('|') !== ['date', 'stat', 'tables'].sort().join('|') || payload.stat !== 'ok'
    || payload.date !== receipt.from.replaceAll('-', '') + '~' + receipt.through.replaceAll('-', '')
    || !Array.isArray(payload.tables) || payload.tables.length !== 1) fail('RESPONSE_SCOPE');
  const table = payload.tables[0], allowed = ['title', 'totalCount', 'fields', 'data', 'summary', 'notes', 'subtitle'];
  if (!object(table) || Object.keys(table).some(key => !allowed.includes(key))
    || typeof table.title !== 'string' || Object.hasOwn(table, 'subtitle') && typeof table.subtitle !== 'string'
    || !Array.isArray(table.fields) || marketSnapshotHash(table.fields) !== marketSnapshotHash(spec.fields)
    || !Array.isArray(table.data) || table.data.length > 20_000 || !Number.isSafeInteger(table.totalCount)
    || table.totalCount !== table.data.length || !Array.isArray(table.summary) || table.summary.length
    || Object.hasOwn(table, 'notes') && (!Array.isArray(table.notes) || table.notes.length)) fail('TABLE_COMPLETENESS');
  const capture_id = marketSnapshotHash({ source_id: receipt.source_id, url: receipt.url,
    source_sha256: public_receipt.sha256, received_at: receipt.received_at });
  const capture = { capture_id, source_id: receipt.source_id, source_url: receipt.url, source_sha256: public_receipt.sha256,
    source_bytes: public_receipt.bytes, received_at: receipt.received_at };
  const events = [], rows = [], seen = new Set();
  for (const [index, original] of table.data.entries()) {
    if (!Array.isArray(original) || original.length !== spec.fields.length || original.some(value => typeof value !== 'string' || value.length > 8_000)) fail('ROW_SHAPE');
    const raw_row = copy(original), rowHash = marketSnapshotHash(raw_row);
    if (seen.has(rowHash)) fail('DUPLICATE_RAW_ROW'); seen.add(rowHash);
    const symbol = raw_row[1].trim(), effective_date = officialDate(raw_row[0]);
    if (!/^[0-9A-Z]{4,8}$/.test(symbol) || !effective_date || effective_date < receipt.from || effective_date > receipt.through) fail('ROW_IDENTITY_OR_RANGE');
    const source_capture = { ...capture, row_index: index, row_path: ['tables', 0, 'data', index], symbol_field: '1', source_row_hash: rowHash };
    const classification = receipt.source_id === 'tpex_ex_right' ? classifyExRight(raw_row)
      : classifyResumption(receipt.source_id, raw_row, symbol, effective_date);
    rows.push({ symbol, effective_date, row_index: index, source_row_hash: rowHash, issues: classification.issues });
    for (const kind of classification.kinds) {
      const event = { symbol, effective_date, kind, subtype: classification.subtype, source_ref: receipt.url,
        available_at: receipt.received_at, source_capture, raw_row, suspension_from: classification.suspension_from,
        reported: classification.reported, classification: classification.issues.length ? 'UNCLASSIFIED' : 'CLASSIFIED' };
      events.push({ event_id: marketSnapshotHash(event), ...event });
    }
  }
  const source_through_observed = compareTime(receipt.received_at, receipt.through + 'T13:30:00+08:00') >= 0;
  const body = { schema: 'TAIWAN_MARKET_ACTION_CAPTURE_V1', market: 'TPEX', source_id: receipt.source_id, family: spec.family,
    from: receipt.from, through: receipt.through, source_through_observed, capture, public_receipt,
    table_path: ['tables', 0], table_hash: marketSnapshotHash(table), fields_hash: marketSnapshotHash(table.fields),
    row_count: table.totalCount, coverage_kinds: [...spec.coverage_kinds], rows, events,
    raw_entity_not_reserialized: true, availability_basis: 'ACTUAL_RECEIPT_NOT_BACKDATED',
    coverage_scope: 'TPEX_FIVE_EFFECTIVE_ACTION_CLASSES_AS_OF_SOURCE_RECEIPT',
    methodology_approved: false, member_published: false };
  return freeze({ ...body, action_capture_hash: marketSnapshotHash(body) });
}
function verifyUniverse(universe) {
  const { universe_hash, ...body } = universe ?? {};
  if (universe?.schema !== 'TAIWAN_MARKET_UNIVERSE_V1' || universe_hash !== marketSnapshotHash(body)
    || !Array.isArray(universe.companies) || universe.companies.length !== universe.total
    || new Set(universe.companies.map(company => company.security_id)).size !== universe.total) fail('UNIVERSE');
  for (const company of universe.companies) if (!['TWSE', 'TPEX', 'EMERGING'].includes(company.market)
    || !/^\d{4,6}$/.test(company.symbol) || company.security_id !== company.market + ':' + company.symbol) fail('UNIVERSE_COMPANY');
}
function coverageRow(context, from, through) {
  const { company, universe_hash, cutoff, documents } = context, issues = [], source_bindings = [], events = [];
  const supported = company.market === 'TPEX';
  if (!supported) issues.push('MARKET_NOT_SUPPORTED_BY_TPEX_ACTION_SOURCES');
  if (supported) for (const [source_id, spec] of Object.entries(TPEX_ACTION_SOURCES)) {
    const document = documents.find(item => item.source_id === source_id);
    if (!document) { issues.push('MISSING_' + source_id.toUpperCase()); continue; }
    if (document.from > from || document.through < through) issues.push('INCOMPLETE_RANGE_' + source_id.toUpperCase());
    if (!document.source_through_observed) issues.push('UNOBSERVED_RANGE_END_' + source_id.toUpperCase());
    const matched = document.rows.filter(row => row.symbol === company.symbol && row.effective_date >= from && row.effective_date <= through);
    source_bindings.push({ ...document.capture, source_from: document.from, source_through: document.through,
      table_path: [...document.table_path], table_hash: document.table_hash, fields_hash: document.fields_hash,
      row_count: document.row_count, matched_row_indices: matched.map(row => row.row_index), coverage_kinds: [...spec.coverage_kinds] });
    for (const row of matched) for (const reason of row.issues) issues.push(source_id + ':' + row.row_index + ':' + reason);
    events.push(...document.events.filter(event => event.symbol === company.symbol && event.effective_date >= from && event.effective_date <= through));
  }
  events.sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.kind.localeCompare(b.kind) || a.event_id.localeCompare(b.event_id));
  const available_at = source_bindings.map(source => source.received_at).sort(compareTime).at(-1) ?? null;
  const complete = supported && issues.length === 0 && source_bindings.length === Object.keys(TPEX_ACTION_SOURCES).length;
  const body = { schema: 'TAIWAN_MARKET_ACTION_COVERAGE_V1', kind: complete ? 'CORPORATE_ACTION_COVERAGE' : 'CORPORATE_ACTION_INVENTORY',
    security_id: company.security_id, market: company.market, symbol: company.symbol, universe_hash, cutoff,
    price_basis: 'RAW_UNADJUSTED', from, through, status: complete ? events.length ? 'EVENTS' : 'NO_ACTIONS' : 'INCOMPLETE',
    complete, coverage_kinds: [...TAIWAN_ACTION_KINDS], source_bindings, events: copy(events), issues: [...new Set(issues)], available_at,
    coverage_scope: 'TPEX_FIVE_EFFECTIVE_ACTION_CLASSES_AS_OF_SOURCE_RECEIPT',
    historical_membership_established: false, adjustment_applied: false, cash_entitlement_inferred: false, source_use_approval: null };
  const row = freeze({ ...body, coverage_hash: marketSnapshotHash(body) }); contexts.set(row, context); return row;
}

/** Always normalizes original bytes here. A caller-provided complete:true or a
 * hash of an invented absence assertion is not accepted as a source input. */
export function buildTaiwanMarketActionCoverage({ universe, captures, from, through, cutoff }) {
  verifyUniverse(universe); range(from, through);
  if (!validObservationTime(cutoff) || !Array.isArray(captures) || captures.length > 3) fail('COVERAGE_INPUT');
  const documents = captures.map(normalizeTaiwanActionCapture);
  if (new Set(documents.map(document => document.source_id)).size !== documents.length) fail('DUPLICATE_SOURCE');
  if (documents.some(document => compareTime(document.capture.received_at, cutoff) > 0)) fail('FUTURE_CAPTURE');
  const corporate_actions = {};
  for (const company of universe.companies) {
    const context = { company: freeze(copy(company)), universe_hash: universe.universe_hash, cutoff, documents };
    corporate_actions[company.security_id] = coverageRow(context, from, through);
  }
  const rows = Object.values(corporate_actions);
  const body = { schema: 'TAIWAN_MARKET_ACTION_COVERAGE_SET_V1', universe_hash: universe.universe_hash, cutoff, from, through,
    documents, corporate_actions,
    counts: { securities: rows.length, complete_tpex: rows.filter(row => row.market === 'TPEX' && row.complete).length,
      incomplete_tpex: rows.filter(row => row.market === 'TPEX' && !row.complete).length,
      unsupported_markets: rows.filter(row => row.market !== 'TPEX').length,
      classified_events: rows.flatMap(row => row.events).filter(event => event.classification === 'CLASSIFIED').length,
      unclassified_events: rows.flatMap(row => row.events).filter(event => event.classification !== 'CLASSIFIED').length },
    availability_basis: 'ACTUAL_RECEIPT_NOT_BACKDATED', source_use_approval: null,
    methodology_approved: false, member_published: false, forward_performance_samples: 0 };
  return freeze({ ...body, coverage_set_hash: marketSnapshotHash(body) });
}

/** Returns one or more normal AnalysisEvidence objects. Splitting by adjacent
 * calendar intervals preserves every event and the 12k content limit; the
 * existing SHORT gate already unions complete interval proofs without gaps.
 * Only rows produced from verified original bytes in this process are accepted.
 */
export function createTaiwanActionReplayEvidence(coverage, { max_content_chars = 12_000 } = {}) {
  const context = contexts.get(coverage);
  if (!context || !Number.isSafeInteger(max_content_chars) || max_content_chars < 1_000 || max_content_chars > 12_000) fail('VERIFIED_COVERAGE_REQUIRED');
  if (!coverage.available_at || coverage.market !== 'TPEX') return [];
  const result = [];
  const append = row => {
    const content = JSON.stringify(row);
    if (content.length > max_content_chars) {
      if (row.from === row.through || result.length >= 90) fail('EVIDENCE_CONTENT_LIMIT');
      const middle = new Date(Math.floor((Date.parse(row.from + 'T00:00:00Z') + Date.parse(row.through + 'T00:00:00Z')) / 2 / 86_400_000) * 86_400_000).toISOString().slice(0, 10);
      const next = new Date(Date.parse(middle + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
      append(coverageRow(context, row.from, middle)); append(coverageRow(context, next, row.through)); return;
    }
    const source = row.source_bindings.find(item => item.source_id === 'tpex_ex_right') ?? row.source_bindings[0];
    result.push(freeze({ id: 'tpex-actions-' + row.coverage_hash.slice(0, 40), symbol: row.symbol, kind: 'FINANCIAL',
      source: source.source_url, published_at: null, available_at: row.available_at, first_seen_at: row.available_at,
      as_of: row.available_at, time_basis: 'OBSERVED_AFTER_RECEIPT', content, evidence_hash: sha(content) }));
  };
  append(coverage); return Object.freeze(result);
}
