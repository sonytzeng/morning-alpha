/** Owner boundary for the approved V659 pure renderer. Never used as server identity. */
import type { ServerReportPayloadResponse } from '../../types/subscription.ts';
import { v2DailySnapshot } from '../research/recommendation-v2-forward.ts';
import { composeLineDecision, type DecisionCard } from '../../../supabase/functions/_shared/line-decision-card-v659.ts';
export { linePlainText, decisionCardFlex } from '../../../supabase/functions/_shared/line-decision-card-v659.ts';
export type { DecisionCard, CardLine, CardSection, FlexBox, FlexText } from '../../../supabase/functions/_shared/line-decision-card-v659.ts';
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const texts = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && Boolean(x.trim())) : [];

export function composeDecisionCard(response: ServerReportPayloadResponse): DecisionCard {
 const p=response.payload||{},projection=response.subscriber_projection,id=projection?.identity;
 const raw=row(row(p.admin_source_report).ai_strategy_json),decision=row(p.canonical_decision);
 if(response.tier!=='admin'||response.authenticated!==true||!projection?.analysisAvailable
  ||projection.evidence.status!=='SUFFICIENT'||!id?.revisionId||!id.generatedAt
  ||response.report_date!==id.reportDate||response.revision_id!==id.revisionId
  ||p.revision_id!==id.revisionId||decision.id!==id.revisionId||raw.revision_id!==id.revisionId)
  throw Error('LINE_PREVIEW_SOURCE_UNVERIFIED');
 return composeLineDecision({identity:{reportDate:id.reportDate,revisionId:id.revisionId,generatedAt:id.generatedAt},
  canonicalMarketState:raw.canonical_market_state,action:text(decision.action),bias:projection.marketDecision.bias||'',
  recommendationGate:p.recommendation_gate,recommendation:projection.recommendation,
  operationalMarket:raw.operational_market,reportLevel:projection.reportLevel});
}
/** A separate type/output channel. It is never accepted by the member card composer. */
export function ownerV2Copy(data: unknown, date: string) {
  const root = row(data), latest = row(root.latest);
  if (root.shadow_only !== true || root.promotion_allowed !== false || latest.business_date !== date) return null;
  const snapshot = v2DailySnapshot(latest);
  const gateNames: Record<string, string> = { liquidity: '流動性', market: '市場環境', sector: '產業配合', relative_strength: '相對大盤表現',
    momentum: '價格趨勢', volume_price: '量價確認', institutional: '法人方向', fundamental: '實際財務趨勢', catalyst: '公司事件', risk: '風險', entry: '進場條件' };
  const forwardDates = texts(root.forward_dates);
  const forwardSample = Array.isArray(root.forward_dates) && forwardDates.length === root.forward_dates.length
    && forwardDates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Set(forwardDates).size : null;
  return { banner: 'V2研究觀察｜尚未對會員發布', date, counts: snapshot.counts, forwardSample,
    candidates: rows(latest.candidates).filter(c => ['READY', 'WATCH'].includes(text(c.status))).slice(0, 3)
      .map(c => ({ symbol: text(c.symbol), state: c.status === 'WATCH' ? '待確認，不是正式推薦' : '研究條件齊全，不是正式推薦' })),
    nearMiss: snapshot.counts.READY === 0 && snapshot.counts.WATCH === 0 ? snapshot.near_miss.slice(0, 3).map(c => ({
      symbol: String(c.symbol), passed: c.passed.map(g => gateNames[g]), missing: c.missing.map(g => gateNames[g]),
    })) : [], deliveryEnabled: false as const };
}
