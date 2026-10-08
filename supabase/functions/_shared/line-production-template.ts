/** Pure renderer after the EXISTING publication gate. No transport or persistence. */
import { composeLineDecision, decisionCardFlex, LINE_DECISION_TEMPLATE_VERSION } from './line-decision-card-v659.ts';
import { buildCanonicalMarketState, canonicalMarketDocument } from './canonical-market-state.ts';
import type { evaluatePublishedMarketDelivery } from './market-publication-contract.ts';
import type { evaluateMarketReportGate } from './market-report-gate.ts';

export const PRODUCTION_LINE_TEMPLATE = LINE_DECISION_TEMPLATE_VERSION;
export const LINE_TEMPLATE_ROLLBACK = '8be2d3a575b9a3813eb1919b77a7e1f9a0755e53:line-daily-push@68';
const row=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function buildPublishedLineDecision(
 delivery:ReturnType<typeof evaluatePublishedMarketDelivery>,
 report:Record<string,unknown>, snapshot:Record<string,unknown>,
 gate:ReturnType<typeof evaluateMarketReportGate>, siteUrl:string,
) {
 const p=delivery.projection,ai=row(report.ai_strategy_json),generated=row(snapshot.generated_text),id=p.identity;
 if(!delivery.eligible||!p.analysisAvailable||p.historical||!id.revisionId||!id.generatedAt
  ||report.report_date!==id.reportDate||snapshot.report_date!==id.reportDate||snapshot.report_id!==report.id
  ||snapshot.id!==id.revisionId||ai.revision_id!==id.revisionId||snapshot.status!=='READY')
  throw Error('LINE_TEMPLATE_PUBLICATION_IDENTITY_INVALID');
 const canonical=Object.hasOwn(generated,'canonical_market_state')?generated.canonical_market_state
  :buildCanonicalMarketState(canonicalMarketDocument(ai));
 const rawAction=String(snapshot.action||'');
 // Existing canonical/Subscriber aliases; presentation only, no strategy rewrite.
 const action=rawAction==='ACT'?'ENTER':rawAction==='STOP'?'AVOID':rawAction;
 if(p.marketDecision.action!==(action==='ENTER'?'ACT':action==='AVOID'?'STOP':action))
  throw Error('LINE_TEMPLATE_ACTION_PARITY_INVALID');
 const card=composeLineDecision({identity:{reportDate:id.reportDate,revisionId:id.revisionId,generatedAt:id.generatedAt},
  canonicalMarketState:canonical,action,bias:p.marketDecision.bias||'',
  recommendationGate:gate.recommendation_gate,recommendation:p.recommendation,
  operationalMarket:delivery.operational_market,reportLevel:p.reportLevel});
 const uri=new URL(siteUrl);
 if(uri.protocol!=='https:'||uri.username||uri.password||uri.search||uri.hash)throw Error('LINE_TEMPLATE_CTA_INVALID');
 card.cta.url=uri.origin+'/report/today';
 return decisionCardFlex(card);
}
