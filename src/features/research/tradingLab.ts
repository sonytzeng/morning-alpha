import type { discoverCandidates, performance } from '../../../supabase/functions/_shared/owner-trading-lab';
import type { IntelligenceAnalysis } from './intelligence';
export type LabRow = Record<string, unknown>;
export interface TradingLabData {
 version:'OWNER_TRADING_LAB_V1';public_product_approval:false;forward_enabled:false;
 as_of:string;business_date:string;canonical:LabRow|null;
 shadow:{id:string;analysis:IntelligenceAnalysis;prediction_hash:string}|null;
 discovery:ReturnType<typeof discoverCandidates>;trades:LabRow[];events:LabRow[];
 performance:{system:ReturnType<typeof performance>;sony:ReturnType<typeof performance>;
 market:{sample:number;direction_accuracy:number|null;source:string;coverage:string;forward_shadow_sample:number}};
}
export const labObject=(v:unknown):LabRow=>v&&typeof v==='object'&&!Array.isArray(v)?v as LabRow:{};
export const labText=(v:unknown,fallback='尚無可用資料')=>typeof v==='string'&&v.trim()?v:fallback;
export const labRows=(v:unknown):LabRow[]=>Array.isArray(v)?v.map(labObject):[];
export function readTradingLab(v:unknown):TradingLabData {
 const r=labObject(v),d=labObject(r.discovery);
 const p=labObject(r.performance),market=labObject(p.market);
 const validMetrics=(v:unknown)=>{const m=labObject(v);return Number.isInteger(m.sample)&&Number(m.sample)>=0&&typeof m.sample_label==='string'
  &&['win_rate','average_win','average_loss','expectancy','profit_factor','max_drawdown','mfe','mae'].every(k=>m[k]===null||(typeof m[k]==='number'&&Number.isFinite(m[k])));};
 if(r.version!=='OWNER_TRADING_LAB_V1'||r.public_product_approval!==false||r.forward_enabled!==false
  ||!/^\d{4}-\d{2}-\d{2}$/.test(String(r.business_date))||!Number.isFinite(Date.parse(String(r.as_of)))
  ||!Array.isArray(d.watchlist)||d.watchlist.length>5||!Array.isArray(d.funnel)||!Array.isArray(r.trades)||!Array.isArray(r.events)
  ||!Number.isInteger(d.scanned)||Number(d.scanned)<0||!validMetrics(p.system)||!validMetrics(p.sony)
  ||!Number.isInteger(market.sample)||Number(market.sample)<0||!Number.isInteger(market.forward_shadow_sample)||Number(market.forward_shadow_sample)<0
  ||!(market.direction_accuracy===null||(typeof market.direction_accuracy==='number'&&market.direction_accuracy>=0&&market.direction_accuracy<=100)))throw Error('OWNER_TRADING_LAB_CONTRACT');
 if(r.canonical&&labObject(r.canonical).report_date!==r.business_date)throw Error('LAB_CURRENT_DATE_MISMATCH');
 if(r.shadow&&labObject(labObject(r.shadow).analysis).business_date!==r.business_date)throw Error('LAB_SHADOW_DATE_MISMATCH');
 return r as unknown as TradingLabData;
}
export function currentMarket(data:TradingLabData) {
 const c=labObject(data.canonical?.status==='READY'?data.canonical:null),g=labObject(c.generated_text),state=labObject(g.canonical_market_state);
 const sections=labObject(labObject(state.document).sections),summary=labObject(sections.executive_summary),a=data.shadow?.analysis;
 const signals=(ids:string[])=>a?.signals.filter(s=>ids.includes(s.signal_id)).slice(0,5).map(s=>`${s.label}：${s.direction==='BULLISH'?'偏多':s.direction==='BEARISH'?'偏空':'中性'}`)||[];
 const supporting=signals(a?.supporting_signals||[]),contradicting=signals(a?.contradicting_signals||[]);
 const sourceSupporting=labRows(sections.supporting_evidence).filter(r=>Array.isArray(r.evidence_refs)&&r.evidence_refs.length>0).slice(0,5).map(r=>labText(r.statement||r.summary||r.title));
 const sourceCounter=labRows(sections.counter_evidence).filter(r=>Array.isArray(r.evidence_refs)&&r.evidence_refs.length>0).slice(0,5).map(r=>labText(r.statement||r.summary||r.title));
 const sourceInvalidation=labRows(labObject(sections.failure_scenario).triggers).filter(r=>Array.isArray(r.evidence_required)&&r.evidence_required.length>0).map(r=>labText(r.condition));
 const risk=labText(labObject(sections.decision_guide).risk_level,'unknown');
 return {date:data.business_date,regime:labText(c.market_regime),direction:labText(g.market_bias),action:labText(c.action),
  risk:a?.decision.shadow_risk||({low:'低',normal:'一般',medium:'中',high:'高',elevated:'偏高'} as Record<string,string>)[risk]||null,confidence:a?.decision.shadow_confidence??null,
  conclusion:labText(g.daily_sentence||summary.text,'當日正式結論尚未可用；不以歷史研究冒充今天。'),
  supporting:supporting.length?supporting:sourceSupporting,contradicting:contradicting.length?contradicting:sourceCounter,
  waitReason:labText(labObject(g.market_report_gate).wait_reason,'尚無完成進場確認的證據，維持正式市場操作，不因研究名單改變策略。'),
  invalidation:a?.invalidation_conditions.map(x=>x.description)||sourceInvalidation,
  changes:a?.what_changed.map(x=>x.meaning)||[],hasCurrentShadow:Boolean(a)};
}
