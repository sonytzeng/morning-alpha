import { evaluateResearchQualityGate } from './research-quality-gate.ts';
import { operationalDocumentResult } from './operational-market-contract.mjs';
type Row = Record<string, unknown>;
const record = (value:unknown):Row => value && typeof value==='object' && !Array.isArray(value) ? value as Row : {};

/** A present invalid V1 operational proof fails closed, never legacy fallback.
 * The result is recomputed, not a model-authored readiness flag. */
export function readOperationalMarket(documentValue:unknown) {
  return operationalDocumentResult(documentValue);
}

/** Only the separately proven market document gets completeness semantics.
 * Stock research always continues using evaluateResearchQualityGate directly. */
export function evaluateMarketResearchQuality(documentValue:unknown) {
  const base=evaluateResearchQualityGate(documentValue), document=record(documentValue);
  if(!Object.hasOwn(document,'operational_market'))return base;
  const operational=readOperationalMarket(document);
  if(!operational || operational.market_decision!=='READY')return {...base,eligible:false,
    reason_codes:[...base.reason_codes,'operational_core_not_ready']};
  const reasons=base.reason_codes.filter(reason=>!(reason==='research_publish_status_not_ready' && base.publish_status==='degraded'));
  return {...base,eligible:reasons.length===0,reason_codes:reasons};
}
