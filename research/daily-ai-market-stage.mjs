/** Bounded V2 persistence adapter. It never fetches a provider, reviews a method
 * or publishes an edition. Every mutation uses a fixed RPC and checks receipt
 * identity. An unknown acknowledgement stops this attempt; it is not retried. */
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { marketSnapshotHash, verifyTaiwanMarketCompletion } from './taiwan-market-universe.mjs';

export const DAILY_AI_MARKET_STAGE_LIMITS = Object.freeze({ capture_bytes: 16_000_000, shard_bytes: 16_000_000,
  encoded_capture_bytes: 8_000_000, matrix_capture_bytes: 8_000_000, packet_bytes: 1_500_000, analysis_bytes: 200_000, securities_per_shard: 64, evidence_per_security: 100 });
const hash = value => createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = code => { throw Error('DAILY_AI_MARKET_STAGE_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function marketStageCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(marketStageCanonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + marketStageCanonical(value[k])).join(',') + '}';
  fail('NON_JSON_VALUE');
}
function own(value) { return JSON.parse(marketStageCanonical(value)); }
function boundedText(value, limit) {
  const text = marketStageCanonical(value); if (Buffer.byteLength(text) > limit) fail('SIZE_LIMIT'); return text;
}
export function prepareDailyAiMarketCapture({ receipt, bytes }) {
  const r = own(receipt);
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > DAILY_AI_MARKET_STAGE_LIMITS.capture_bytes
    || r.schema !== 'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1' || r.state !== 'CAPTURED' || r.status !== 200
    || r.bytes !== bytes.length || r.sha256 !== hash(bytes) || !['json', 'csv'].includes(r.format)) fail('CAPTURE');
  const receipt_text = boundedText(r, 20_000), receipt_hash = hash(receipt_text);
  const capture_id = marketSnapshotHash({ source_id: r.source_id, url: r.url, source_sha256: r.sha256, received_at: r.received_at });
  if (r.encoding === 'CP950') {
    if (r.format !== 'csv' || bytes.length > DAILY_AI_MARKET_STAGE_LIMITS.encoded_capture_bytes
      || r.row_layout !== 'HEADER_AND_DATA_ARRAYS_V1' || !isHash(r.decoded_text_sha256)) fail('ENCODED_CAPTURE');
    return Object.freeze({ capture_id, receipt_hash, rpc: 'stage_daily_ai_market_encoded_capture_v2',
      args: Object.freeze({ p_receipt_text: receipt_text, p_receipt_hash: receipt_hash, p_source_bytes_base64: bytes.toString('base64') }) });
  }
  const body = bytes.toString('utf8'); if (!bytes.equals(Buffer.from(body, 'utf8'))) fail('CAPTURE_ENCODING');
  if (r.encoding === 'UTF8' && r.row_layout === 'HEADER_AND_DATA_ARRAYS_V1') {
    if (r.format !== 'csv' || bytes.length > DAILY_AI_MARKET_STAGE_LIMITS.matrix_capture_bytes
      || !/^MOPS_REVENUE_TWSE_20\d{2}(?:0[1-9]|1[0-2])_CSV$/.test(r.source_id) || r.decoded_text_sha256 !== r.sha256) fail('REVENUE_CAPTURE');
    return Object.freeze({ capture_id, receipt_hash, rpc: 'stage_daily_ai_market_revenue_capture_v2',
      args: Object.freeze({ p_receipt_text: receipt_text, p_receipt_hash: receipt_hash, p_body_text: body }) });
  }
  if (r.format === 'json' && (['tpex_ex_right', 'tpex_capital_reduction', 'tpex_par_value_change'].includes(r.source_id)
    || /^TWSE_VALUATION_\d{8}$/.test(r.source_id))) {
    return Object.freeze({ capture_id, receipt_hash, rpc: 'stage_daily_ai_market_public_capture_v2',
      args: Object.freeze({ p_receipt_text: receipt_text, p_receipt_hash: receipt_hash, p_body_text: body }) });
  }
  return Object.freeze({ capture_id, receipt_hash, rpc: 'stage_daily_ai_market_capture_v2',
    args: Object.freeze({ p_receipt_text: receipt_text, p_receipt_hash: receipt_hash, p_body_text: body }) });
}
export function prepareDailyAiMarketWorkPlan({ universe, plan }) {
  const u = own(universe), p = own(plan);
  const { universe_hash, ...ub } = u, { plan_hash, ...pb } = p;
  if (!isHash(universe_hash) || marketSnapshotHash(ub) !== universe_hash || !isHash(plan_hash) || marketSnapshotHash(pb) !== plan_hash
    || p.universe_hash !== universe_hash || p.shard_size !== 64 || p.member_published !== false || p.methodology_approved !== false) fail('PLAN');
  verifyTaiwanMarketCompletion(p, []);
  return Object.freeze({ universe_hash, plan_hash, shards: p.shards.length, rpc: 'stage_daily_ai_market_work_plan_v2',
    args: Object.freeze({ p_universe_text: boundedText(u, 12_000_000), p_plan_text: boundedText(p, 2_000_000) }) });
}
export function prepareDailyAiMarketShard({ planHash, shard, leaseId, results }) {
  const s = own(shard), inputs = own(results);
  if (!isHash(planHash) || !isHash(s.shard_id) || !/^[a-f0-9-]{36}$/i.test(String(leaseId))
    || !Array.isArray(s.security_ids) || s.security_ids.length < 1 || s.security_ids.length > 64
    || !Array.isArray(inputs) || inputs.length !== s.security_ids.length) fail('SHARD');
  const { shard_id, expected_cards, ...sb } = s;
  if (marketSnapshotHash(sb) !== shard_id || expected_cards !== inputs.length * 3) fail('SHARD_HASH');
  const expected = new Set(s.security_ids);
  const items = inputs.map(({ security_id, packet, analysis }) => {
    if (!expected.delete(security_id) || !object(packet) || !object(analysis)
      || security_id.split(':')[1] !== packet.symbol || analysis.symbol !== packet.symbol || packet.cutoff !== s.cutoff || analysis.cutoff !== s.cutoff
      || !Array.isArray(packet.evidence) || packet.evidence.length < 1 || packet.evidence.length > 100
      || analysis.schema !== 'DAILY_AI_STOCK_ANALYSIS_V2' || analysis.analysis_origin !== 'DETERMINISTIC_SCREENING'
      || analysis.method_version !== 'TAIWAN_MARKET_RESEARCH_V1' || analysis.model_generated !== false || analysis.member_published !== false
      || analysis.input_hash !== marketSnapshotHash(packet) || !Array.isArray(analysis.horizons) || analysis.horizons.length !== 3
      || new Set(analysis.horizons.map(h => h.horizon).filter(h => ['SHORT', 'MEDIUM', 'LONG'].includes(h))).size !== 3) fail('ANALYSIS');
    const packet_text = boundedText(packet, DAILY_AI_MARKET_STAGE_LIMITS.packet_bytes);
    const analysis_text = boundedText(analysis, DAILY_AI_MARKET_STAGE_LIMITS.analysis_bytes);
    return { security_id, packet_text, packet_hash: hash(packet_text), analysis_text, analysis_hash: hash(analysis_text) };
  });
  if (expected.size) fail('SHARD_CARDINALITY');
  const body = { schema: 'DAILY_AI_MARKET_SHARD_RESULT_V2', plan_hash: planHash, shard_id,
    items, member_published: false, methodology_approved: false };
  const result_text = boundedText(body, DAILY_AI_MARKET_STAGE_LIMITS.shard_bytes), result_hash = hash(result_text);
  return Object.freeze({ plan_hash: planHash, shard_id, result_hash, cards: inputs.length * 3, rpc: 'stage_daily_ai_market_shard_v2',
    args: Object.freeze({ p_plan_hash: planHash, p_shard_id: shard_id, p_lease_id: leaseId, p_result_text: result_text, p_result_hash: result_hash }) });
}
async function invoke(rpc, name, args) {
  try {
    const result = await rpc(name, args);
    if (!object(result)) return { state: 'OUTCOME_UNKNOWN', code: 'INVALID_RPC_ENVELOPE' };
    if (result.error) {
      const reason = /^(?:MARKET|AI_MARKET_PAGE_V2)_[A-Z0-9_]{1,100}$/.test(String(result.error.message)) ? String(result.error.message) : null;
      return { state: /^(?:P0001|42501|22\w{3}|23\w{3}|PGRST202|42883)$/.test(String(result.error.code)) ? 'REJECTED' : 'OUTCOME_UNKNOWN',
        code: String(result.error.code || 'RPC_ERROR'), ...(reason ? { reason } : {}) };
    }
    return { state: 'CONFIRMED', data: result.data };
  } catch { return { state: 'OUTCOME_UNKNOWN', code: 'TRANSPORT_ACKNOWLEDGEMENT_UNKNOWN' }; }
}
export async function stageDailyAiMarketCapture({ rpc, receipt, bytes }) {
  const prepared = prepareDailyAiMarketCapture({ receipt, bytes });
  const result = await invoke(rpc, prepared.rpc, prepared.args), r = result.data;
  if (result.state !== 'CONFIRMED') return { ...result, capture_id: prepared.capture_id };
  if (!object(r) || r.schema !== 'DAILY_AI_MARKET_CAPTURE_STAGED_V2' || r.capture_id !== prepared.capture_id
    || r.receipt_hash !== prepared.receipt_hash || typeof r.replayed !== 'boolean') return { state: 'OUTCOME_UNKNOWN', code: 'CAPTURE_RECEIPT', capture_id: prepared.capture_id };
  return { state: 'STAGED', capture_id: prepared.capture_id, replayed: r.replayed };
}
export async function stageDailyAiMarketWorkPlan({ rpc, universe, plan }) {
  const prepared = prepareDailyAiMarketWorkPlan({ universe, plan });
  const result = await invoke(rpc, prepared.rpc, prepared.args), r = result.data;
  if (result.state !== 'CONFIRMED') return { ...result, plan_hash: prepared.plan_hash };
  if (!object(r) || r.schema !== 'DAILY_AI_MARKET_WORK_PLAN_STAGED_V2' || r.plan_hash !== prepared.plan_hash
    || r.universe_hash !== prepared.universe_hash || r.shards !== prepared.shards || r.member_published !== false || typeof r.replayed !== 'boolean') {
    return { state: 'OUTCOME_UNKNOWN', code: 'PLAN_RECEIPT', plan_hash: prepared.plan_hash };
  }
  return { state: 'STAGED', plan_hash: prepared.plan_hash, replayed: r.replayed, shards: r.shards };
}
/** One bounded lease per invocation; the caller schedules the next invocation.
 * Persist requestKey in the job caller to read back a lost claim acknowledgement.
 * This function does not automatically retry any mutation. */
export async function runDailyAiMarketShard({ rpc, planHash, workerRef, analyseShard, requestKey = randomUUID() }) {
  if (!isHash(planHash) || typeof workerRef !== 'string' || !workerRef.trim() || workerRef.length > 200
    || typeof analyseShard !== 'function') fail('WORKER_SCOPE');
  const claimed = await invoke(rpc, 'claim_daily_ai_market_shard_v2', { p_plan_hash: planHash, p_worker_ref: workerRef, p_request_key: requestKey });
  const base = { plan_hash: planHash, request_key: requestKey, member_published: false, review_required: true };
  if (claimed.state !== 'CONFIRMED') return { ...base, ...claimed };
  const work = claimed.data;
  if (!object(work) || work.schema !== 'DAILY_AI_MARKET_SHARD_CLAIM_V2' || work.plan_hash !== planHash) return { ...base, state: 'OUTCOME_UNKNOWN', code: 'CLAIM_RECEIPT' };
  if (work.state === 'NO_WORK' && Number.isSafeInteger(work.remaining) && Number.isSafeInteger(work.exhausted)) return { ...base, state: 'NO_WORK', remaining: work.remaining, exhausted: work.exhausted };
  if (!object(work.shard) || work.request_key !== requestKey || !isHash(work.shard.shard_id)) return { ...base, state: 'OUTCOME_UNKNOWN', code: 'CLAIM_SCOPE' };
  if (work.state === 'COMPLETED' && isHash(work.result_hash)) return { ...base, state: 'STAGED', replayed: true, shard_id: work.shard.shard_id, result_hash: work.result_hash, cards: work.shard.expected_cards };
  if (work.state === 'LEASE_EXPIRED') return { ...base, state: 'LEASE_EXPIRED', shard_id: work.shard.shard_id };
  if (work.state !== 'CLAIMED') return { ...base, state: 'OUTCOME_UNKNOWN', code: 'CLAIM_STATE' };
  const results = await analyseShard(own(work));
  const prepared = prepareDailyAiMarketShard({ planHash, shard: work.shard, leaseId: work.lease_id, results });
  const staged = await invoke(rpc, prepared.rpc, prepared.args), r = staged.data;
  if (staged.state !== 'CONFIRMED') return { ...base, ...staged, shard_id: prepared.shard_id, result_hash: prepared.result_hash };
  if (!object(r) || r.schema !== 'DAILY_AI_MARKET_SHARD_STAGED_V2' || r.plan_hash !== planHash || r.shard_id !== prepared.shard_id
    || r.result_hash !== prepared.result_hash || r.cards !== prepared.cards || r.member_published !== false || r.review_required !== true || typeof r.replayed !== 'boolean') {
    return { ...base, state: 'OUTCOME_UNKNOWN', code: 'SHARD_RECEIPT', shard_id: prepared.shard_id, result_hash: prepared.result_hash };
  }
  return { ...base, state: 'STAGED', shard_id: r.shard_id, result_hash: r.result_hash, cards: r.cards, replayed: r.replayed };
}
export async function finishDailyAiMarketEdition({ rpc, planHash, expiresAt }) {
  if (!isHash(planHash) || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) fail('FINISH_SCOPE');
  const result = await invoke(rpc, 'finish_daily_ai_market_edition_v2', { p_plan_hash: planHash, p_expires_at: expiresAt }), r = result.data;
  if (result.state !== 'CONFIRMED') return { ...result, plan_hash: planHash };
  if (!object(r) || r.schema !== 'DAILY_AI_MARKET_EDITION_STAGED_V2' || !isHash(r.edition_id) || r.plan_hash !== planHash
    || r.member_published !== false || r.review_required !== true || typeof r.replayed !== 'boolean') return { state: 'OUTCOME_UNKNOWN', code: 'EDITION_RECEIPT', plan_hash: planHash };
  return { state: 'STAGED_REVIEW_REQUIRED', edition_id: r.edition_id, plan_hash: planHash, replayed: r.replayed, review_required: true, member_published: false };
}
