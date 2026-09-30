import { evaluateResearchQualityGate } from './research-quality-gate.ts';
import { buildCanonicalMarketState } from './canonical-market-state.ts';
import { evaluateClosingContract, evaluateLearningContract, validateOpeningPublication } from './closing-learning-contract.ts';

type Row = Record<string, unknown>;
type ReplayKind = 'RESEARCH' | 'PUBLICATION' | 'OPENING' | 'CLOSING' | 'LEARNING';
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export const CRITICAL_CONTRACT_VERSION = 'CRITICAL_CONTRACT_REPLAY_V1';

// Contract-only capsule, never a report body/member record/HTTP request dump.
// Every key below is consumed by one of the named pure validators. Free prose,
// URLs, names, headers, subscriber identifiers and credentials are excluded.
const keys = new Set(`report today_date report_date timezone data_as_of provenance generated_at quality publish_status evidence_coverage unsupported_claims duplicate_claims contradictions missing_sections coverage_audit contract_version denominator numerator claims scope supported evidence_ids reason_codes sources evidence_id source source_date freshness sections representative_stocks
opening closing closingSnapshot expectedSnapshotId now snapshot publicationRun id ai_strategy_json revision_id market_publication_contract schema_version status opening_publication_revision_id publication_run_id snapshot_version report_id session_type version decision_mode source_refs generated_text canonical_market_state document market_bias market_regime recommendations symbol stock_symbol code valid_from completed_at trading_date idempotency_key provider_status result success decision_snapshot_id
recommended_symbols predicted_at opening_decision_snapshot_id opening_decision_snapshot_version verified_at data_status actual_taiex_close actual_2330_close actual_txf_close value change_percent captured_at phase actual_direction hit_or_miss beneficiary_list_validation items close_change_percent predicted_beneficiary_stocks evidence_fingerprint source_freshness coverage_score data_source table no_fake_data closing_verification_v2 opening_publication_revision_id closing_snapshot_id market_close stock_evaluation predictions outcomes prediction_scope record_status data_quality_status prediction_id horizon target_date return_percent direction_correct evaluated_at source_timestamp source_at raw returned_date market_reason_codes stock_reason_codes evidence_ready market_evaluation direction research_master_v2`.split(/\s+/));
const enumValue = /^[A-Za-z][A-Za-z0-9_:./-]{0,160}$/;
const isoValue = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const counters = new Set(['unsupported_claims','duplicate_claims','contradictions','missing_sections']);
export function projectCriticalContract(value: unknown, depth = 0, key = ''): unknown {
  if (depth > 18) throw Error('CRITICAL_CAPSULE_DEPTH_EXCEEDED');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (counters.has(key)) return value.trim() ? 'NONEMPTY_CLAIM' : '';
    if (value === '') return '';
    // Preserve syntax, identity, dates and enums; reject rather than silently
    // rewrite an unknown value that could change a contract decision.
    if ((enumValue.test(value) || isoValue.test(value) || uuid.test(value) || /^[0-9a-f]{64}$/i.test(value) || /^-?\d{1,6}(?:\.\d{1,12})?$/.test(value)) &&
      !/bearer|@|https?:|cookie|password|secret|token/i.test(value)) return value;
    if (key === 'market_bias' || key === 'market_regime') return value.trim() ? 'MARKET_DIRECTION_PRESENT' : '';
    // This is an intentionally invalid sentinel, never synthesized evidence.
    // The original/projected decision comparison below must still be exact.
    return 'INVALID_REDACTED_VALUE';
  }
  if (Array.isArray(value)) {
    if (value.length > 1000) throw Error('CRITICAL_CAPSULE_ROWS_EXCEEDED');
    return value.map(item => projectCriticalContract(item,depth+1,key));
  }
  return Object.fromEntries(Object.entries(object(value)).filter(([k]) => keys.has(k))
    .map(([k,v]) => [k,projectCriticalContract(v,depth+1,k)]));
}
export function replayCriticalContract(kind: ReplayKind, value: unknown): unknown {
  const input = object(value);
  switch (kind) {
    case 'RESEARCH': return evaluateResearchQualityGate(input);
    case 'PUBLICATION': {
      const { document: _document, ...result } = buildCanonicalMarketState(input);
      return result;
    }
    case 'OPENING': return validateOpeningPublication(input as Parameters<typeof validateOpeningPublication>[0]);
    case 'CLOSING': {
      const {market_close:_quote,...decision} = evaluateClosingContract(input as Parameters<typeof evaluateClosingContract>[0]);
      return decision;
    }
    case 'LEARNING': return evaluateLearningContract(input as Parameters<typeof evaluateLearningContract>[0]);
  }
}
type RecorderClient = { rpc: (name: string, args: Row) => PromiseLike<unknown> };
export function recordPublicationContract(client:RecorderClient,args:Row):void {
  let snapshot:Row;try{snapshot=structuredClone(args);}catch{return;}
  let timer:ReturnType<typeof setTimeout>|undefined;
  const task=Promise.resolve().then(()=>Promise.race([
    Promise.resolve(client.rpc('record_publication_contract_evidence_v1',snapshot)),
    new Promise(resolve=>{timer=setTimeout(resolve,1500);}),
  ])).catch(()=>undefined).finally(()=>{if(timer)clearTimeout(timer);});
  try{const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil:(task:Promise<unknown>)=>void}}).EdgeRuntime;
    if(runtime)runtime.waitUntil(task);}catch{/* Sidecar failure never changes publication. */}
}
export function buildCriticalContractCapsule(kind: ReplayKind, input: unknown) {
  const frozenInput = ['OPENING','CLOSING','LEARNING'].includes(kind) ? {...object(input), now:object(input).now ?? Date.now()} : input;
  const projected = projectCriticalContract(frozenInput);
  const original = replayCriticalContract(kind,frozenInput), replayed = replayCriticalContract(kind,projected);
  if (JSON.stringify(original) !== JSON.stringify(replayed)) throw Error('CRITICAL_CAPSULE_PROJECTION_DRIFT');
  return { contract_version:CRITICAL_CONTRACT_VERSION, input:projected, expected:replayed };
}
export function recordCriticalContract(client: RecorderClient, kind: ReplayKind, date: string, input: unknown): void {
  // Detached and bounded. Recorder errors cannot alter or delay business gates.
  let snapshot: unknown;
  try { snapshot = structuredClone(['OPENING','CLOSING','LEARNING'].includes(kind)
    ? {...object(input),now:object(input).now ?? Date.now()} : input); } catch { return; }
  const task = Promise.resolve().then(async () => {
    const capsule = buildCriticalContractCapsule(kind,snapshot);
    if (JSON.stringify(capsule).length > 262144) throw Error('CRITICAL_CAPSULE_SIZE_EXCEEDED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const write = Promise.resolve(client.rpc('record_critical_contract_evidence_v1', {
        p_business_date:date,p_stage:kind,p_capsule:capsule,
      })).then(() => client.rpc('cleanup_expired_critical_contract_evidence_v1',{p_limit:1000}));
      await Promise.race([write, new Promise(resolve => { timer=setTimeout(resolve,1500); })]);
    } finally { if(timer) clearTimeout(timer); }
  }).catch(() => console.warn('CRITICAL_CONTRACT_RECORDER_FAILED_NON_BLOCKING'));
  try {
    const runtime = (globalThis as unknown as {EdgeRuntime?:{waitUntil:(task:Promise<unknown>)=>void}}).EdgeRuntime;
    if (runtime) runtime.waitUntil(task); else void task;
  } catch { /* Business result is independent of scheduler availability. */ }
}
