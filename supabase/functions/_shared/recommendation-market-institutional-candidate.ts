/** Candidate adapter, not wired to any deployed Function. BFI82U is market-wide
 * TWD, never individual-stock SHARES. No DB writes or publication authorization.
 * A newly downloaded historical date is available NOW, not at that day's close. */
import type { DecisionIdentity, EvidenceData, Row } from './decision-v1-data.ts';
import { previousMarketTradingDate, isMarketTradingDate } from './market-session-contract.mjs';
import { evaluationPhase } from './recommendation-phase.ts';

export const MARKET_FLOW_CONTRACT = 'TWSE_BFI82U_MARKET_TWD_CANDIDATE_V1';
const ENDPOINT = 'https://www.twse.com.tw/rwd/zh/fund/BFI82U';
const LIMIT = 64_000;
const SHA = /^[a-f0-9]{64}$/;
const timestamp = (value: unknown) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const object = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('');
const labels = ['自營商(自行買賣)', '自營商(避險)', '投信', '外資及陸資(不含外資自營商)', '外資自營商', '合計'];
type Amounts = { buy: number; sell: number; net: number };
export type MarketFlowCapture = {
  contract: typeof MARKET_FLOW_CONTRACT; source: string; trading_date: string;
  first_seen_at: string; available_at: string; published_at: null;
  publication_time_status: 'UNKNOWN'; source_revision: string | null;
  status: 'PASS' | 'SOURCE_UNAVAILABLE' | 'SOURCE_INVALID' | 'DEADLINE';
  http_status: number | null; rows: Row[];
};
export function marketFlowSource(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isMarketTradingDate('TW', date)) throw Error('MARKET_FLOW_DATE_INVALID');
  const url = new URL(ENDPOINT);
  url.searchParams.set('response', 'json'); url.searchParams.set('dayDate', date.replaceAll('-', '')); url.searchParams.set('type', 'day');
  return url.href;
}
function amount(value: unknown): number {
  if (typeof value !== 'string' || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) throw Error('MARKET_FLOW_AMOUNT_INVALID');
  const n = Number(value.replaceAll(',', ''));
  if (!Number.isSafeInteger(n)) throw Error('MARKET_FLOW_AMOUNT_INVALID');
  return n;
}
const sum = (values: Amounts[]): Amounts => values.reduce((a, b) => ({ buy: a.buy + b.buy, sell: a.sell + b.sell, net: a.net + b.net }), { buy: 0, sell: 0, net: 0 });

export async function normalizeMarketInstitutionalTwd(payload: unknown, date: string, receivedAt: string): Promise<MarketFlowCapture> {
  const source = marketFlowSource(date), at = timestamp(receivedAt), p = object(payload);
  if (!Number.isFinite(at) || date > new Date(at + 8 * 3600000).toISOString().slice(0, 10)) throw Error('MARKET_FLOW_TIME_INVALID');
  // Do not infer the unit from field names, a magnitude, or a supplied currency.
  if (p.stat !== 'OK' || p.date !== date.replaceAll('-', '') || p.hints !== '單位：元'
    || !Array.isArray(p.fields) || p.fields.length !== 4 || new Set(p.fields).size !== 4
    || !['單位名稱', '買進金額', '賣出金額', '買賣差額'].every(f => p.fields instanceof Array && p.fields.includes(f))
    || !Array.isArray(p.data) || p.data.length !== labels.length) throw Error('MARKET_FLOW_CONTRACT_INVALID');
  const fields = p.fields as string[], values = new Map<string, Amounts>();
  for (const row of p.data) {
    if (!Array.isArray(row) || row.length !== 4) throw Error('MARKET_FLOW_ROW_INVALID');
    const label = row[fields.indexOf('單位名稱')];
    if (typeof label !== 'string' || !labels.includes(label) || values.has(label)) throw Error('MARKET_FLOW_ROW_INVALID');
    const a = { buy: amount(row[fields.indexOf('買進金額')]), sell: amount(row[fields.indexOf('賣出金額')]), net: amount(row[fields.indexOf('買賣差額')]) };
    if (a.buy < 0 || a.sell < 0 || a.buy - a.sell !== a.net) throw Error('MARKET_FLOW_RECONCILIATION_FAILED');
    values.set(label, a);
  }
  const dealer = sum([values.get(labels[0])!, values.get(labels[1])!]);
  const normalized = [
    { type: 'foreign', amounts: values.get(labels[3])! },
    { type: 'investment_trust', amounts: values.get(labels[2])! },
    { type: 'dealer', amounts: dealer },
  ];
  // Foreign proprietary desks are ALREADY INCLUDED in dealers, not added twice.
  const total = sum(normalized.map(r => r.amounts));
  if (JSON.stringify(total) !== JSON.stringify(values.get('合計')) || total.buy + total.sell <= 0
    || !Object.values(total).every(Number.isSafeInteger)) throw Error('MARKET_FLOW_RECONCILIATION_FAILED');
  const revision = await digest([MARKET_FLOW_CONTRACT, source, date, normalized]);
  const rows = normalized.map(({ type, amounts: a }) => ({
    id: `bfi82u:${revision}:${type}`, provider: 'twse_bfi82u', market: 'TW', symbol: 'TAIEX',
    trading_date: date, institution_type: type, buy_amount: a.buy, sell_amount: a.sell, net_amount: a.net, currency: 'TWD',
    captured_at: receivedAt, created_at: receivedAt, source_ref: source,
    raw_payload: { contract: MARKET_FLOW_CONTRACT, source_revision: revision, amount_unit: 'TWD', scope: 'MARKET_ONLY',
      published_at: null, first_seen_at: receivedAt, available_at: receivedAt, publication_time_status: 'UNKNOWN' },
  }));
  return { contract: MARKET_FLOW_CONTRACT, source, trading_date: date, first_seen_at: receivedAt, available_at: receivedAt,
    published_at: null, publication_time_status: 'UNKNOWN', source_revision: revision, status: 'PASS', http_status: 200, rows };
}

async function readBounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw Error('MARKET_FLOW_BODY_INVALID');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > LIMIT) throw Error('MARKET_FLOW_BODY_LIMIT');
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function acquireMarketInstitutionalTwd(options: { date: string; fetcher: typeof fetch; now: () => string; signal: AbortSignal }): Promise<MarketFlowCapture> {
  const source = marketFlowSource(options.date), at = options.now();
  const failed = (status: MarketFlowCapture['status'], http: number | null): MarketFlowCapture => ({
    contract: MARKET_FLOW_CONTRACT, source, trading_date: options.date, first_seen_at: options.now(), available_at: options.now(),
    published_at: null, publication_time_status: 'UNKNOWN', source_revision: null, status, http_status: http, rows: [],
  });
  if (!Number.isFinite(timestamp(at))) throw Error('MARKET_FLOW_TIME_INVALID');
  let response: Response | undefined;
  try {
    options.signal.throwIfAborted();
    response = await options.fetcher(source, { redirect: 'error', signal: AbortSignal.any([options.signal, AbortSignal.timeout(4000)]) });
    if (!response.ok) return failed('SOURCE_UNAVAILABLE', response.status);
    const payload = await readBounded(response);
    return await normalizeMarketInstitutionalTwd(payload, options.date, options.now());
  } catch {
    // Fixed diagnostics only; no provider body/error/header/credential reflection.
    return failed(options.signal.aborted ? 'DEADLINE' : response?.ok ? 'SOURCE_INVALID' : 'SOURCE_UNAVAILABLE', response?.status ?? null);
  } finally { if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}

/** Isolated premarket proof input. Never mutate saved evidence or change a V1
 * threshold. Any conflict fails closed; same bytes are idempotent. This adapter
 * intentionally cannot supply individual-stock TWD, earnings, or catalysts. */
export async function withMarketInstitutionalEvidence(data: EvidenceData, identity: DecisionIdentity, capture: MarketFlowCapture): Promise<EvidenceData> {
  const fail = (reason: string): EvidenceData => ({ ...data, failures: [...data.failures, reason] });
  if (!capture || typeof capture !== 'object' || !Array.isArray(capture.rows) || capture.rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return fail('MARKET_FLOW_INVALID');
  const cutoff = timestamp(identity.generated_at), available = timestamp(capture.available_at);
  const expected = previousMarketTradingDate('TW', identity.report_date);
  if (evaluationPhase(identity.generated_at) !== 'PREMARKET' || !identity.is_trading_day || !Number.isFinite(cutoff)
    || capture.status !== 'PASS' || capture.contract !== MARKET_FLOW_CONTRACT || capture.trading_date !== expected
    || !Number.isFinite(available) || available > cutoff || capture.first_seen_at !== capture.available_at
    || capture.source !== marketFlowSource(capture.trading_date) || !SHA.test(capture.source_revision ?? '') || capture.rows.length !== 3) return fail('MARKET_FLOW_NOT_ADMISSIBLE');
  const types = ['foreign', 'investment_trust', 'dealer'];
  if (!types.every(type => capture.rows.filter(r => r.institution_type === type).length === 1)) return fail('MARKET_FLOW_INVALID');
  const normalized = types.map(type => { const r = capture.rows.find(r => r.institution_type === type)!; return { type, amounts: { buy: r.buy_amount, sell: r.sell_amount, net: r.net_amount } }; });
  if (await digest([MARKET_FLOW_CONTRACT, capture.source, capture.trading_date, normalized]) !== capture.source_revision) return fail('MARKET_FLOW_REVISION_MISMATCH');
  const conflict = capture.rows.some(r => r.symbol !== 'TAIEX' || r.market !== 'TW' || r.provider !== 'twse_bfi82u' || r.currency !== 'TWD'
    || r.trading_date !== capture.trading_date || r.captured_at !== capture.available_at || r.created_at !== capture.available_at
    || r.source_ref !== capture.source || ![r.buy_amount, r.sell_amount, r.net_amount].every(v => typeof v === 'number' && Number.isSafeInteger(v))
    || Number(r.buy_amount) < 0 || Number(r.sell_amount) < 0 || Number(r.buy_amount) - Number(r.sell_amount) !== Number(r.net_amount)
    || r.id !== `bfi82u:${capture.source_revision}:${r.institution_type}`
    || data.flows.some(old => old.symbol === 'TAIEX' && old.trading_date === r.trading_date && old.institution_type === r.institution_type
      && JSON.stringify(old) !== JSON.stringify(r)));
  if (conflict) return fail('MARKET_FLOW_CONFLICT');
  return { ...data, flows: [...data.flows, ...capture.rows.filter(r => !data.flows.some(old => old.id === r.id))] };
}
