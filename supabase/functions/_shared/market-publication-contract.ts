import type { evaluateMarketReportGate } from './market-report-gate.ts';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from './canonical-market-state.ts';
import { evaluateMarketContentIntelligence } from './content-intelligence.ts';
import { createSubscriberState, getSubscriberReportProjection } from '../../../shared/subscriber-state-contract.ts';
type PublicationClient = { from(relation: string): unknown };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const pointer = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

/** Thin read transport compatibility for the two existing SDK versions. No
 * client version is replaced and no SDK private fields are asserted to exist.
 * Methods keep their original receiver; malformed transports fail closed. */
function publicationQueryMethod(receiver: unknown, name: string, args: unknown[]): unknown {
  const method = record(receiver)[name];
  if (typeof method !== 'function') throw new Error(`PUBLICATION_QUERY_METHOD_MISSING:${name}`);
  const value: unknown = method.apply(receiver, args);
  return value;
}

function selectPublicationRows(client: PublicationClient, relation: string, columns: string) {
  let query = publicationQueryMethod(client.from(relation), 'select', [columns]);
  const chain = {
    eq(column: string, value: unknown) { query = publicationQueryMethod(query, 'eq', [column, value]); return chain; },
    like(column: string, pattern: string) { query = publicationQueryMethod(query, 'like', [column, pattern]); return chain; },
    order(column: string, options: { ascending?: boolean; referencedTable?: string }) {
      query = publicationQueryMethod(query, 'order', [column, options]); return chain;
    },
    limit(count: number, options?: { referencedTable?: string }) {
      query = publicationQueryMethod(query, 'limit', options === undefined ? [count] : [count, options]); return chain;
    },
    async maybeSingle(): Promise<{ data: unknown; error: Record<string, unknown> & { message: string } | null }> {
      const response = record(await publicationQueryMethod(query, 'maybeSingle', []));
      if (!Object.hasOwn(response, 'data') || !Object.hasOwn(response, 'error')) throw new Error('PUBLICATION_QUERY_RESULT_INVALID');
      if (response.error === null) return { data: response.data, error: null };
      const error = record(response.error);
      if (typeof error.message !== 'string') throw new Error('PUBLICATION_QUERY_ERROR_INVALID');
      return { data: response.data, error: { ...error, message: error.message } };
    },
  };
  return chain;
}

/** No pointer means unpublished, not permission to select current private QA. */
export async function readPublishedMarketDecision(supabase: PublicationClient, report: Record<string, unknown>) {
  const revision = pointer(record(report.ai_strategy_json).revision_id);
  if (!revision) return { data: null, error: null };
  return await selectPublicationRows(supabase, 'decision_snapshots', '*')
    .eq('report_date', String(report.report_date)).eq('report_id', String(report.id)).eq('id', revision)
    .order('version', { ascending: false }).limit(1).maybeSingle();
}

/** Member proof is pinned independently; its absence cannot change the market pointer. */
export async function readPublishedMemberRevision(supabase: PublicationClient, report: Record<string, unknown>) {
  const ai = record(report.ai_strategy_json);
  const revision = pointer(ai.revision_id), memberRevision = pointer(ai.canonical_member_revision_id);
  if (!revision || !memberRevision) return { data: null, error: null };
  const result = await selectPublicationRows(supabase, 'member_content_revisions',
    '*,semantic_coherence_reviews(status,reason_codes,checked_at,canonical_snapshot_id,canonical_snapshot_version)')
    .eq('id', memberRevision).eq('decision_snapshot_id', revision)
    .eq('report_date', String(report.report_date)).eq('report_id', String(report.id))
    .order('checked_at', { referencedTable: 'semantic_coherence_reviews', ascending: false })
    .limit(1, { referencedTable: 'semantic_coherence_reviews' }).maybeSingle();
  if (result.error || !result.data) return result;
  const member = record(result.data);
  const semantic = record(Array.isArray(member.semantic_coherence_reviews) ? member.semantic_coherence_reviews[0] : null);
  const aligned = semantic.canonical_snapshot_id === revision
    && semantic.canonical_snapshot_version === member.decision_snapshot_version;
  return { data: { ...member, semantic_status: aligned ? semantic.status : null,
    semantic_reason_codes: aligned ? semantic.reason_codes : null }, error: null };
}

/** Canonical publication reader. Consumers must not independently select the
 * latest QA revision or turn recommendation quality into market availability. */
export async function fetchPublishedDeliveryEvidence(
  supabase: PublicationClient,
  report: Record<string, unknown>,
): Promise<{ snapshot: Record<string, unknown> | null; member: Record<string, unknown> | null; publicationRun: Record<string, unknown> | null }> {
  const [snapshotResult, memberResult] = await Promise.all([
    readPublishedMarketDecision(supabase, report), readPublishedMemberRevision(supabase, report),
  ]);
  if (snapshotResult.error) throw new Error(`SNAPSHOT_STATE_QUERY_FAILED:${snapshotResult.error.message}`);
  const snapshot = snapshotResult.data ? record(snapshotResult.data) : null;
  const ai = record(report.ai_strategy_json);
  let publicationRun: Record<string, unknown> | null = null;
  if (Object.hasOwn(ai, 'market_publication_contract') && pointer(ai.revision_id)) {
    let receiptQuery = selectPublicationRows(supabase, 'pipeline_runs', '*')
      .eq('trading_date', String(report.report_date)).eq('status', 'SUCCEEDED').like('idempotency_key', 'research-input:%')
      .eq('provider_status->result->>report_id', String(report.id))
      .eq('provider_status->result->>report_date', String(report.report_date))
      .eq('provider_status->result->>decision_snapshot_id', String(ai.revision_id))
      .eq('provider_status->result->>member_content_revision_id', String(ai.canonical_member_revision_id));
    const runId = pointer(record(ai.market_publication_contract).publication_run_id);
    if (runId) receiptQuery = receiptQuery.eq('id', runId);
    const receipt = await receiptQuery.order('completed_at', { ascending: true }).limit(1).maybeSingle();
    if (receipt.error) throw new Error(`PUBLICATION_RECEIPT_QUERY_FAILED:${receipt.error.message}`);
    publicationRun = receipt.data ? record(receipt.data) : null;
  }
  if (memberResult.error) throw new Error(`MEMBER_REVISION_STATE_QUERY_FAILED:${memberResult.error.message}`);
  if (!memberResult.data) return { snapshot, member: null, publicationRun };
  const member = record(memberResult.data);
  const reviews = Array.isArray(member.semantic_coherence_reviews) ? member.semantic_coherence_reviews : [];
  const semantic = record(reviews[0]);
  const semanticAligned = semantic.canonical_snapshot_id === snapshot?.id
    && semantic.canonical_snapshot_version === snapshot?.version;
  return { snapshot, publicationRun, member: { ...member,
    semantic_status: semanticAligned ? semantic.status : null,
    semantic_reason_codes: semanticAligned ? semantic.reason_codes : null } };
}

/** Validation of an already committed publication, not a second producer gate.
 * The same exact report/snapshot/member/semantic identity is checked for LINE
 * and orchestrator; all business threshold changes belong to the producer. */
function publishedReceiptMatches(
  report: Record<string, unknown>,
  snapshot: Record<string, unknown> | null,
  member: Record<string, unknown> | null,
  marketGate: ReturnType<typeof evaluateMarketReportGate>,
  coreReceiptVerified = false,
): boolean {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const empty = (value: unknown) => Array.isArray(value) && value.length === 0;
  const json = (value: unknown): string => Array.isArray(value) ? '[' + value.map(json).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + json(record(value)[key])).join(',') + '}'
      : JSON.stringify(value) ?? 'undefined';
  if ((!coreReceiptVerified && !marketGate.eligible) || !snapshot || !member || snapshot.status !== 'READY'
    || typeof snapshot.content_score !== 'number' || snapshot.content_score < 90 || snapshot.content_score > 100
    || snapshot.report_id !== report.id || snapshot.report_date !== report.report_date
    || member.report_id !== report.id || member.report_date !== report.report_date
    || member.decision_snapshot_id !== snapshot.id || member.decision_snapshot_version !== snapshot.version
    || (!coreReceiptVerified && (member.status !== 'PASSED' || member.semantic_status !== 'PASSED' || !empty(member.semantic_reason_codes)))) return false;
  const ai = record(report.ai_strategy_json);
  if (!pointer(ai.revision_id) || ai.revision_id !== snapshot.id
    || !pointer(ai.canonical_member_revision_id) || ai.canonical_member_revision_id !== member.id) return false;
  if (coreReceiptVerified) return snapshot.coverage_score === 100
    && record(snapshot.source_freshness).status === 'complete'
    && ['recommendations', 'market_only', 'no_trade'].includes(String(snapshot.decision_mode))
    && (snapshot.decision_mode !== 'market_only' || empty(record(snapshot.generated_text).recommendations));
  // A new stock assessment cannot revoke this already committed market proof.
  // Current recommendation availability is applied only to the projection below.
  if (snapshot.decision_mode === 'recommendations') return true;
  if (snapshot.decision_mode !== 'market_only') return snapshot.decision_mode === 'no_trade';
  const generated = record(snapshot.generated_text), content = record(member.member_content);
  const contract = record(member.canonical_contract), gate = record(generated.market_report_gate);
  return typeof ai.revision_id === 'string' && ai.revision_id === snapshot.id
    && typeof ai.canonical_member_revision_id === 'string' && ai.canonical_member_revision_id === member.id
    && snapshot.action === 'WAIT' && snapshot.coverage_score === 100
    && Array.isArray(snapshot.source_refs) && snapshot.source_refs.length > 0
    && marketGate.status === 'READY_MARKET_ONLY' && marketGate.decision_mode === 'market_only'
    && marketGate.recommendation_gate.eligible === false && gate.content_score === snapshot.content_score
    && json(gate) === json(marketGate) && json(gate) === json(ai.market_report_gate)
    && json(gate) === json(contract.market_report_gate) && json(contract) === json(content.canonical_contract)
    && contract.snapshot_id === snapshot.id && contract.snapshot_version === snapshot.version
    && contract.report_date === report.report_date && contract.action === 'WAIT' && contract.decision_mode === 'market_only'
    && empty(contract.primary_symbols) && empty(generated.recommendations)
    && empty(ai.today_beneficiary_stocks) && empty(ai.today_beneficiary_stocks_v10)
    && empty(content.beneficiary_candidates) && empty(content.representative_stocks)
    && (generated.opportunity_score === null || generated.opportunity_score === undefined)
    && (content.opportunity_score === null || content.opportunity_score === undefined);
}

export function evaluatePublishedMarketDelivery(
  report: Record<string, unknown>, snapshot: Record<string, unknown> | null,
  member: Record<string, unknown> | null, marketGate: ReturnType<typeof evaluateMarketReportGate>,
  options: { todayDate?: string; now?: string; premiumEligible?: boolean; publicationRun?: unknown; historicalRead?: boolean } = {},
) {
  const ai = record(report.ai_strategy_json), generated = record(snapshot?.generated_text);
  const reportDate = String(report.report_date || ''), revision = pointer(snapshot?.id);
  const now = options.now || new Date().toISOString();
  const corePresent = Object.hasOwn(ai, 'market_publication_contract');
  const core = record(ai.market_publication_contract), run = record(options.publicationRun);
  const receipt = record(record(run.provider_status).result);
  const coreIdentity = core.schema_version === 'CORE_MARKET_PUBLICATION_V1' && core.status === 'PUBLISHED'
    && core.report_date === reportDate && core.revision_id === revision
    && Boolean(pointer(core.opening_publication_revision_id));
  const completedAt = Date.parse(String(run.completed_at || ''));
  const runVerified = Boolean(pointer(run.id)) && run.status === 'SUCCEEDED' && run.trading_date === reportDate
    && String(run.idempotency_key || '').startsWith('research-input:')
    && receipt.success === true && receipt.semantic_status === 'PASSED'
    && receipt.report_id === report.id && receipt.report_date === reportDate
    && receipt.decision_snapshot_id === revision && receipt.member_content_revision_id === member?.id
    && (!Object.hasOwn(core, 'publication_run_id') || core.publication_run_id === run.id)
    && Number.isFinite(completedAt) && completedAt <= Date.parse(now)
    && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(completedAt)) === reportDate;
  const frozenPresent = Object.hasOwn(generated, 'canonical_market_state');
  // Legacy compatibility may read its audited market document, never stock_research
  // or copy aliases. A present malformed frozen CMS cannot fall back.
  const document = canonicalMarketDocument(frozenPresent ? generated : ai);
  const audited = buildCanonicalMarketState(document);
  const tupleKeys = (rows: unknown[]) => rows.map(value => { const row = record(value); return JSON.stringify([
    row.evidence_id, row.source, row.source_date, row.freshness,
  ]); }).sort();
  const expectedSources = frozenPresent ? canonicalMarketSourceRefs(generated) : [];
  const frozenVerified = frozenPresent && record(generated.canonical_market_state).status === 'READY'
    && audited.status === 'READY' && audited.report_date === reportDate && expectedSources.length > 0
    && Array.isArray(snapshot?.source_refs)
    && JSON.stringify(tupleKeys(snapshot.source_refs)) === JSON.stringify(tupleKeys(expectedSources));
  const marketDocumentVerified = audited.status === 'READY' && audited.report_date === reportDate
    && (frozenPresent ? frozenVerified : !corePresent);
  // A durable receipt binds the document and its actual source measurements,
  // not an earlier score computed from mutable copy or private recommendation QA.
  // Missing frozen measurements cannot be repaired from the current report.
  const frozenEditorial = corePresent ? evaluateMarketContentIntelligence({
    canonical_market_state: generated.canonical_market_state,
    content_evidence_quality: generated.content_evidence_quality,
    data_quality: generated.data_quality,
    missing_sources: generated.missing_sources,
  }, 0) : null;
  const frozenEditorialVerified = frozenEditorial?.publishable === true
    && frozenEditorial.score === snapshot?.content_score;
  const generatedAt = pointer(snapshot?.created_at) || pointer(snapshot?.valid_from) || pointer(record(document.provenance).generated_at);
  const generatedTime = Date.parse(generatedAt || '');
  const coreVerified = corePresent && coreIdentity && runVerified && frozenVerified && frozenEditorialVerified
    && Number.isFinite(generatedTime) && generatedTime <= completedAt;
  const receiptEligible = (!corePresent || coreVerified) && (!frozenPresent || frozenVerified)
    && publishedReceiptMatches(report, snapshot, member, marketGate, coreVerified);
  const sections = record(document.sections), guide = record(sections.decision_guide);
  const summary = marketDocumentVerified ? pointer(record(sections.executive_summary).text) || pointer(record(sections.core_thesis).statement) : null;
  const marketBias = pointer(generated.market_bias) || pointer(snapshot?.market_regime);
  const leadingDate = summary?.match(/^(\d{4}-\d{2}-\d{2})(?:未|[，,。；;：:\s])/i)?.[1] || '';
  const summaryDateVerified = !leadingDate || leadingDate === reportDate;
  const committedRecommendations = Array.isArray(generated.recommendations) ? generated.recommendations : [];
  const stockSymbol = (value: unknown) => { const row = record(value); return String(row.symbol || row.stock_code || row.stock_id || '')
    .toUpperCase().replace(/^(TWSE:|TPEX:)/, '').replace(/\.(TW|TWO)$/, ''); };
  const admittedSymbols = new Set((Array.isArray(ai.today_beneficiary_stocks_v10) ? ai.today_beneficiary_stocks_v10 : []).map(stockSymbol));
  const committedSymbolsAdmitted = committedRecommendations.every(row => Boolean(stockSymbol(row)) && admittedSymbols.has(stockSymbol(row)));
  const currentStockGate = marketGate.recommendation_gate;
  const stockGate = currentStockGate.status === 'QUALIFIED' && (options.premiumEligible === false
    || snapshot?.decision_mode !== 'recommendations' || !committedSymbolsAdmitted)
    ? { ...currentStockGate, eligible: false, status: 'BLOCKED' } : currentStockGate;
  const isTradingDay = typeof ai.is_trading_day === 'boolean' ? ai.is_trading_day : null;
  const state = createSubscriberState({
    report_date: reportDate, revision_id: revision, generated_at: generatedAt,
    publicationVerified: receiptEligible, marketEvidenceReady: corePresent ? coreVerified : marketGate.eligible,
    marketPublicationContract: ai.market_publication_contract,
    analysisStatus: snapshot?.status, isTradingDay, confidenceValue: snapshot?.confidence_score,
    recommendationGate: stockGate, closing: ai.closing_verification_v2, now,
  });
  const projection = getSubscriberReportProjection({
    report_date: reportDate, revision_id: revision, generated_at: generatedAt,
    today_date: options.todayDate || reportDate, subscriber_state: state,
    market_publication_contract: ai.market_publication_contract, is_trading_day: isTradingDay,
    canonical_decision: { id: revision, report_date: reportDate, generated_at: generatedAt,
      status: snapshot?.status, action: snapshot?.action, confidence_score: snapshot?.confidence_score,
      market_bias: marketBias, daily_sentence: summary, recommendations: committedRecommendations },
    recommendation_gate: stockGate, closing_verification_v2: ai.closing_verification_v2,
  });
  const reasons = corePresent ? [] : [...marketGate.reason_codes];
  if (corePresent && !coreIdentity) reasons.push('MARKET_PUBLICATION_CONTRACT_INVALID');
  if (corePresent && !runVerified) reasons.push('MARKET_PUBLICATION_DURABLE_RECEIPT_MISSING');
  if ((corePresent || frozenPresent) && !frozenVerified) reasons.push('FROZEN_MARKET_DOCUMENT_UNVERIFIED');
  if (corePresent && frozenEditorial?.publishable !== true) reasons.push('FROZEN_MARKET_EDITORIAL_UNVERIFIED');
  if (corePresent && frozenEditorial?.score !== snapshot?.content_score) reasons.push('FROZEN_MARKET_EDITORIAL_SCORE_MISMATCH');
  if (!receiptEligible) reasons.push('PUBLISHED_MARKET_RECEIPT_NOT_ELIGIBLE');
  if (!marketDocumentVerified || !summary) reasons.push('AUDITED_MARKET_SUMMARY_UNAVAILABLE');
  if (!marketBias) reasons.push('COMMITTED_MARKET_DIRECTION_UNAVAILABLE');
  if (!summaryDateVerified) reasons.push('daily_sentence_date_mismatch');
  if (!projection.analysisAvailable) reasons.push('SUBSCRIBER_MARKET_PROJECTION_UNAVAILABLE');
  // Read-only history may inspect an earlier business date. Delivery callers
  // retain the default same-day restriction; every evidence/content check above
  // and the projection's true todayDate/historical identity remain unchanged.
  const deliveryDateEligible = !projection.historical || options.historicalRead === true
    && Boolean(projection.identity.todayDate && reportDate < projection.identity.todayDate);
  if (!deliveryDateEligible) reasons.push('MARKET_DELIVERY_DATE_MISMATCH');
  const eligible = receiptEligible && marketDocumentVerified && Boolean(summary) && Boolean(marketBias)
    && summaryDateVerified && projection.analysisAvailable && deliveryDateEligible;
  return { eligible, reason_codes: [...new Set(reasons)], projection,
    marketContent: {
      opportunity: marketDocumentVerified ? pointer(guide.first_watch) : null,
      confirmation: marketDocumentVerified ? pointer(guide.next_checkpoint_time) : null,
      avoid: marketDocumentVerified && Array.isArray(guide.avoid_actions) ? guide.avoid_actions.filter(value => typeof value === 'string').join('；') : null,
      risk: marketDocumentVerified ? pointer(record(sections.failure_scenario).narrative) : null,
    } };
}

/** Compatibility delegates to the one committed-publication authority. */
export function isPublishedDeliveryEligible(
  report: Record<string, unknown>, snapshot: Record<string, unknown> | null,
  member: Record<string, unknown> | null, marketGate: ReturnType<typeof evaluateMarketReportGate>,
): boolean {
  return evaluatePublishedMarketDelivery(report, snapshot, member, marketGate).eligible;
}
