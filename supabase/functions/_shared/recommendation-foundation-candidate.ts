/** Candidate orchestration + saved-reader adapter for market amounts. The
 * candidate entrypoints use the existing cache/Report receipt, not new tables.
 * Deployed artifacts, the evaluator and publication gates stay unchanged. */
import type { EvidenceData, DecisionIdentity, Row } from './decision-v1-data.ts';
import { buildRecommendationProof, persistedRecommendationReaderInput, type Capture } from './recommendation-stock-evidence.ts';
import type { OfficialCapture } from './recommendation-official-actuals.ts';
import { withMarketInstitutionalEvidence, type MarketFlowCapture } from './recommendation-market-institutional-candidate.ts';

export async function buildRecommendationFoundationCandidate(options: {
  data: EvidenceData; identity: DecisionIdentity; captures: Capture[];
  officialActuals: OfficialCapture[]; marketFlow: MarketFlowCapture;
  evidenceCutoff?: string;
}) {
  const evidenceCutoff = options.evidenceCutoff ?? options.identity.generated_at;
  const validCutoff = Number.isFinite(Date.parse(evidenceCutoff)) && Date.parse(evidenceCutoff) <= Date.parse(options.identity.generated_at);
  const data = validCutoff
    ? await withMarketInstitutionalEvidence(options.data, { ...options.identity, generated_at: evidenceCutoff }, options.marketFlow)
    : { ...options.data, failures: [...options.data.failures, 'MARKET_FLOW_ACQUISITION_CUTOFF_INVALID'] };
  const proof = await buildRecommendationProof(data, options.identity, options.captures, options.officialActuals);
  return { ...proof, acquisition: { ...proof.acquisition, foundation_candidate: {
    contract: 'RECOMMENDATION_FOUNDATION_CANDIDATE_V1', evidence_cutoff: evidenceCutoff, market_flow: options.marketFlow,
    status: data.failures.some(f => f.startsWith('MARKET_FLOW_')) ? 'BLOCKED' : 'MARKET_INPUT_VERIFIED',
    formal_evaluator_changed: false, member_publication_approved: false,
  } }, candidate_only: true as const };
}

/** Reader binding is still the existing exact saved Report/correlation/cutoff
 * contract. Unbound or newly downloaded flows cannot be attached by a client. */
export async function persistedFoundationCandidateInput(data: EvidenceData, identity: DecisionIdentity, ai: Row) {
  const base = await persistedRecommendationReaderInput(data, identity, ai);
  if (base.data.failures.length > data.failures.length) return base;
  const capture = ai.recommendation_stock_evidence as Row | undefined;
  const candidate = capture?.foundation_candidate as Row | undefined;
  // Old saved Reports/caches keep the exact existing Reader behavior. Never
  // fetch a missing market capture later or mutate a historical Report.
  if (candidate === undefined) return base;
  if (candidate?.contract !== 'RECOMMENDATION_FOUNDATION_CANDIDATE_V1' || !candidate.market_flow || typeof candidate.market_flow !== 'object') {
    return { ...base, data: { ...base.data, failures: [...base.data.failures, 'MARKET_FLOW_SAVED_CAPTURE_MISSING'] } };
  }
  // A later publication/commit receipt is NOT permission to extend the
  // Producer's original evidence window, even by a few milliseconds.
  const savedCutoff = String(candidate.evidence_cutoff);
  if (!Number.isFinite(Date.parse(savedCutoff)) || Date.parse(savedCutoff) > Date.parse(String(capture!.cutoff))) {
    return { ...base, data: { ...base.data, failures: [...base.data.failures, 'MARKET_FLOW_ACQUISITION_CUTOFF_INVALID'] } };
  }
  const producerIdentity = { ...identity, generated_at: savedCutoff };
  return { ...base, data: await withMarketInstitutionalEvidence(base.data, producerIdentity, candidate.market_flow as MarketFlowCapture) };
}
