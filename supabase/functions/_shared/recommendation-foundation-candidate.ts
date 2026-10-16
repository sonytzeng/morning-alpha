/** Isolated orchestration + saved-reader adapter for the new market amount
 * source. No deployed entrypoint imports this candidate. Keep the formal V1
 * evaluator, current Producer/Reader artifacts and publication gates frozen. */
import type { EvidenceData, DecisionIdentity, Row } from './decision-v1-data.ts';
import { buildRecommendationProof, persistedRecommendationReaderInput, type Capture } from './recommendation-stock-evidence.ts';
import type { OfficialCapture } from './recommendation-official-actuals.ts';
import { withMarketInstitutionalEvidence, type MarketFlowCapture } from './recommendation-market-institutional-candidate.ts';

export async function buildRecommendationFoundationCandidate(options: {
  data: EvidenceData; identity: DecisionIdentity; captures: Capture[];
  officialActuals: OfficialCapture[]; marketFlow: MarketFlowCapture;
}) {
  const data = await withMarketInstitutionalEvidence(options.data, options.identity, options.marketFlow);
  const proof = await buildRecommendationProof(data, options.identity, options.captures, options.officialActuals);
  return { ...proof, acquisition: { ...proof.acquisition, foundation_candidate: {
    contract: 'RECOMMENDATION_FOUNDATION_CANDIDATE_V1', market_flow: options.marketFlow,
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
  if (candidate?.contract !== 'RECOMMENDATION_FOUNDATION_CANDIDATE_V1' || !candidate.market_flow || typeof candidate.market_flow !== 'object') {
    return { ...base, data: { ...base.data, failures: [...base.data.failures, 'MARKET_FLOW_SAVED_CAPTURE_MISSING'] } };
  }
  // A later publication/commit receipt is NOT permission to extend the
  // Producer's original evidence window, even by a few milliseconds.
  const producerIdentity = { ...identity, generated_at: String(capture!.cutoff) };
  return { ...base, data: await withMarketInstitutionalEvidence(base.data, producerIdentity, candidate.market_flow as MarketFlowCapture) };
}
