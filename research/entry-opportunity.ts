/** Owner-only research. No network, credentials, trading, or Production mutation.
 * Thresholds are frozen hypotheses, NOT calibrated investment probabilities. */
import { isMarketTradingDate, previousMarketTradingDate } from '../supabase/functions/_shared/market-session-contract.mjs';

export const ENTRY_VERSION = 'ENTRY_OPPORTUNITY_1.0.0';
export const STRATEGIES = ['OVERSOLD_REVERSAL', 'PULLBACK_ENTRY', 'BREAKOUT_CONTINUATION'] as const;
export type Strategy = typeof STRATEGIES[number];
export type EntryState = 'ENTRY_READY' | 'WAIT_CONFIRMATION' | 'AVOID_ENTRY' | 'INSUFFICIENT_EVIDENCE';
export const HORIZONS = [1, 3, 5, 10, 20] as const;
export const ENTRY_POLICY = Object.freeze({ minAmount: 50_000_000, minRewardRisk: 2, maxRisk: .08,
  oversoldATR: 2, supportATR: 1, extensionATR: 2, breakoutVolume: 1.5, rangeATR: .25,
  costModel: 'CONSERVATIVE_ILLUSTRATIVE_TW_CASH_1', buyFee: .001425, sellFee: .001425,
  sellTax: .003, slippageEachSide: .001, minimumFeeUnmodelled: true });
export type Bar = { date: string; open: number; high: number; low: number; close: number;
  volume: number; amount: number; source_ref: string; available_at: string };
export type Observation<T> = { value: T; source_ref: string; observed_at: string; available_at: string };
export type StockInput = { symbol: string; name: string | null; bars: Bar[];
  fundamental: Observation<{ revenue_yoy: number; revenue_mom: number; eps_actual: number | null }> | null;
  relative_strength: Observation<number> | null; sector_return: Observation<number> | null;
  events_reviewed: Observation<boolean> | null; v2_status: string | null };
export type EntryInput = { business_date: string; evaluation_time: string; source_revision: string;
  source_evidence_hash: string; market: Observation<{ direction: string; regime: string; change_percent?: number }> | null;
  stocks: StockInput[]; provenance: 'REAL_RETAINED' | 'SYNTHETIC_TEST'; mode: 'HISTORICAL_REPLAY' | 'FORWARD' };
export const canonical = (v: unknown): string => JSON.stringify(sort(v));
function sort(v: unknown): unknown { return Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)])) : v; }
export async function entryHash(v: unknown) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(v))))].map(x => x.toString(16).padStart(2, '0')).join(''); }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const time = (s: string) => Date.parse(s);
export function nextEntrySession(date: string) {
  for (let i = 1; i <= 30; i++) { const d = new Date(time(date + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10); if (isMarketTradingDate('TW', d)) return d; }
  throw Error('ENTRY_CALENDAR_UNAVAILABLE');
}
function known<T>(v: Observation<T> | null, cutoff: number): v is Observation<T> { return !!v && !!v.source_ref &&
  Number.isFinite(time(v.observed_at)) && Number.isFinite(time(v.available_at)) && time(v.observed_at) <= time(v.available_at) && time(v.available_at) <= cutoff; }
export function validEntryBars(bars: Bar[], date: string, cutoff: number) {
  if (bars.length !== 20 || new Set(bars.map(b => b.date)).size !== 20) return false;
  let expected = previousMarketTradingDate('TW', date);
  for (const b of [...bars].sort((a, b) => b.date.localeCompare(a.date))) {
    if (b.date !== expected || !b.source_ref || ![b.open,b.high,b.low,b.close,b.volume,b.amount].every(finite) ||
      Math.min(b.open,b.high,b.low,b.close,b.volume,b.amount) <= 0 || b.high < Math.max(b.open,b.close) || b.low > Math.min(b.open,b.close) ||
      !Number.isFinite(time(b.available_at)) || time(b.available_at) > cutoff || time(b.available_at) < time(b.date + 'T13:30:00+08:00')) return false;
    expected = previousMarketTradingDate('TW', b.date);
  } return true;
}
export type EntryResult = { symbol: string; name: string | null; strategy: Strategy; strategy_version: string;
  status: EntryState; market_direction: string | null; market_regime: string | null; entry_environment: string;
  opportunity_quality: 'CONFIRMED_RESEARCH_SETUP' | 'CONDITIONAL' | 'UNFAVORABLE' | 'UNKNOWN';
  evidence_confidence: { completeness: number; probability: null; calibration: 'INSUFFICIENT_SAMPLE' };
  reasons: string[]; entry_trigger: string | null; invalidation: string | null;
  plan: null | { not_before: string; expires_on: string; reference_range: [number, number]; trigger: number; stop: number;
    target: number; target_basis: string; risk_distance: number; reward_space: number; reward_risk: number; max_risk: number };
  metrics: Record<string, number>; evidence_refs: string[]; v2_status: string | null; horizons: readonly number[] };
function evaluateStock(input: EntryInput, stock: StockInput, strategy: Strategy): EntryResult {
  const cutoff = time(input.evaluation_time), bars = [...stock.bars].sort((a,b) => a.date.localeCompare(b.date));
  const market = known(input.market, cutoff) && finite(input.market.value.change_percent) &&
    typeof input.market.value.direction==='string' && input.market.value.direction.trim() &&
    typeof input.market.value.regime==='string' && input.market.value.regime.trim() ? input.market.value : null;
  const f = known(stock.fundamental, cutoff) && finite(stock.fundamental.value.revenue_yoy) && finite(stock.fundamental.value.revenue_mom) &&
    (stock.fundamental.value.eps_actual === null || finite(stock.fundamental.value.eps_actual)) ? stock.fundamental : null;
  const relative = known(stock.relative_strength, cutoff) && finite(stock.relative_strength.value) ? stock.relative_strength : null;
  const sector = known(stock.sector_return, cutoff) && finite(stock.sector_return.value) ? stock.sector_return : null;
  const events = known(stock.events_reviewed, cutoff) ? stock.events_reviewed : null;
  const barsOK = validEntryBars(bars, input.business_date, cutoff);
  const checks = [!!market, barsOK, !!f, !!relative, !!sector, !!events];
  const r: EntryResult = { symbol: stock.symbol, name: stock.name, strategy, strategy_version: strategy + '_1.0.0',
    status: 'INSUFFICIENT_EVIDENCE', market_direction: market?.direction ?? null, market_regime: market?.regime ?? null,
    entry_environment: 'UNASSESSED', opportunity_quality: 'UNKNOWN',
    evidence_confidence: { completeness: checks.filter(Boolean).length / checks.length, probability: null, calibration: 'INSUFFICIENT_SAMPLE' },
    reasons: [], entry_trigger: null, invalidation: null, plan: null, metrics: {}, evidence_refs: [], v2_status: stock.v2_status, horizons: HORIZONS };
  if (!barsOK) r.reasons.push('缺少當時可用且連續的二十個完整交易日量價');
  if (!market) r.reasons.push('當時正式市場背景不可驗證');
  if (!f) r.reasons.push('當時可用的實際營收趨勢不足，不能排除基本面惡化');
  if (!relative || !sector) r.reasons.push('同期大盤或產業比較資料不足');
  if (!events) r.reasons.push('官方公司事件來源尚不完整');
  if (!checks.every(Boolean)) return r;
  r.evidence_refs = [...new Set([...bars.map(b=>b.source_ref), input.market!.source_ref, f!.source_ref, relative!.source_ref, sector!.source_ref, events!.source_ref])].sort();
  const last=bars[19], prev=bars[18], prior=bars.slice(0,19), recent=bars.slice(-5);
  const atr=mean(bars.slice(1).map((b,i)=>Math.max(b.high-b.low,Math.abs(b.high-bars[i].close),Math.abs(b.low-bars[i].close))));
  if (!finite(atr) || atr<=0) { r.reasons.push('波動範圍不足，無法推導合理價位'); return r; }
  const sma5=mean(recent.map(b=>b.close)),sma10=mean(bars.slice(-10).map(b=>b.close)),sma20=mean(bars.map(b=>b.close));
  const support=Math.min(...recent.map(b=>b.low)),resistance=Math.max(...prior.map(b=>b.high));
  const volumeRatio=last.volume/mean(prior.map(b=>b.volume)), extension=(last.close-sma5)/atr;
  const drawdownATR=(Math.max(...bars.map(b=>b.high))-last.close)/atr;
  const sellVolume=(xs: Bar[])=>xs.filter(b=>b.close<b.open).reduce((sum,b)=>sum+b.volume,0);
  const pressureEasing=sellVolume(bars.slice(-3))<sellVolume(bars.slice(-6,-3));
  const deteriorating=f!.value.revenue_yoy<0||f!.value.revenue_mom<0||(f!.value.eps_actual!==null&&f!.value.eps_actual<0);
  const trigger=strategy==='BREAKOUT_CONTINUATION'?last.close:last.high;
  const upper=trigger+atr*ENTRY_POLICY.rangeATR,stop=strategy==='BREAKOUT_CONTINUATION'?resistance-atr:support;
  const target=strategy==='BREAKOUT_CONTINUATION'?resistance+(resistance-Math.min(...prior.map(b=>b.low))):resistance;
  const cost=(ENTRY_POLICY.buyFee+ENTRY_POLICY.sellFee+ENTRY_POLICY.sellTax+2*ENTRY_POLICY.slippageEachSide)*upper;
  const risk=upper-stop+cost,reward=target-upper-cost,rr=reward/risk;
  r.metrics={atr,sma10,sma20,support,resistance,volumeRatio,extension,drawdownATR,relativeStrength:relative!.value,sectorReturn:sector!.value};
  r.entry_environment=extension>ENTRY_POLICY.extensionATR?'EXTENDED':drawdownATR>=ENTRY_POLICY.oversoldATR?'PULLBACK_OR_OVERSOLD':'BALANCED';
  if (stop>0 && stop<trigger && target>upper && risk>0) {
    const next=nextEntrySession(input.business_date);
    r.plan={not_before:next,expires_on:next,reference_range:[trigger,upper],trigger,stop,target,
      target_basis:strategy==='BREAKOUT_CONTINUATION'?'PRIOR_RANGE_MEASURED_SCENARIO_NOT_FORECAST':'PRIOR_OBSERVED_RESISTANCE',
      risk_distance:risk,reward_space:reward,reward_risk:rr,max_risk:ENTRY_POLICY.maxRisk};
    r.entry_trigger=`僅在 ${next} 價格突破 ${trigger.toFixed(2)}、且不超過 ${upper.toFixed(2)} 時研究；開盤跳空超出區間不追。`;
    r.invalidation=`跌至 ${stop.toFixed(2)} 或超出進場區間即取消；當日未觸發就到期。`;
  }
  const bad:string[]=[],wait:string[]=[];
  if(deteriorating)bad.push('已揭露的實際營收或盈餘出現惡化');
  if(mean(bars.map(b=>b.amount))<ENTRY_POLICY.minAmount)bad.push('成交金額不足以支持此研究的流動性假設');
  if(extension>ENTRY_POLICY.extensionATR)bad.push('價格離短期均價過遠，追價風險偏高');
  if(!r.plan||rr<ENTRY_POLICY.minRewardRisk||risk/upper>ENTRY_POLICY.maxRisk)bad.push('扣除示意成本後，風險報酬或停損距離不合理');
  if(!events!.value)wait.push('有官方事件尚未判讀，不把公告自動當成利多');
  if(strategy==='OVERSOLD_REVERSAL') {
    if(drawdownATR<ENTRY_POLICY.oversoldATR||last.close-support>atr)wait.push('尚未同時接近支撐並形成足夠的超跌幅度');
    if(!pressureEasing)wait.push('下跌成交量尚未顯示賣壓減弱');
    if(!(last.close>prev.high&&last.close>last.open))wait.push('尚未收復前一日高點確認反轉');
    r.reasons=['獨立檢查超跌與支撐，不因大盤下跌直接排除反轉'];
  } else if(strategy==='PULLBACK_ENTRY') {
    if(!(sma10>sma20))bad.push('十日均價尚未高於二十日均價，回檔趨勢假設不成立');
    if(last.close-support>atr||last.close<sma20)wait.push('尚未回到可觀察的支撐區');
    if(!(last.volume<mean(prior.slice(-5).map(b=>b.volume))&&last.close>prev.close))wait.push('仍等待量縮止跌與收盤回升');
    if(relative!.value<0)wait.push('同期表現仍弱於大盤');
    r.reasons=['先確認二十日內趨勢仍在，再看量縮回檔；不是長期趨勢保證'];
  } else {
    if(!(last.close>resistance))wait.push('尚未以完整日收盤突破前十九日高點');
    if(volumeRatio<ENTRY_POLICY.breakoutVolume)wait.push('突破成交量尚未達研究確認條件');
    if(sector!.value<0||relative!.value<0)wait.push('產業或相對大盤強度尚未支持突破');
    if(last.high>resistance&&last.close<=resistance)bad.push('曾突破但收回壓力下方，存在假突破風險');
    r.reasons=['突破要有成交量與相對強度支持；大盤上漲不是追價許可'];
  }
  r.status=bad.length?'AVOID_ENTRY':wait.length?'WAIT_CONFIRMATION':'ENTRY_READY';
  r.opportunity_quality=bad.length?'UNFAVORABLE':wait.length?'CONDITIONAL':'CONFIRMED_RESEARCH_SETUP';
  r.reasons=[...bad,...wait,...r.reasons]; return r;
}
export async function evaluateEntry(input: EntryInput) {
  if(!['HISTORICAL_REPLAY','FORWARD'].includes(input.mode)||!['REAL_RETAINED','SYNTHETIC_TEST'].includes(input.provenance)||
    !Number.isFinite(time(input.evaluation_time))||!isMarketTradingDate('TW',input.business_date)||
    new Date(time(input.evaluation_time)+8*3600000).toISOString().slice(0,10)!==input.business_date||
    !/^[a-f0-9]{64}$/.test(input.source_evidence_hash)||!input.source_revision||input.stocks.length<1||input.stocks.length>72||
    new Set(input.stocks.map(s=>s.symbol)).size!==input.stocks.length||input.stocks.some(s=>!/^\d{4,6}$/.test(s.symbol)))throw Error('ENTRY_INPUT_IDENTITY_INVALID');
  const candidates=[...input.stocks].sort((a,b)=>a.symbol.localeCompare(b.symbol)).flatMap(s=>STRATEGIES.map(strategy=>evaluateStock(input,s,strategy)));
  return {version:ENTRY_VERSION,source_revision:input.source_revision,source_evidence_hash:input.source_evidence_hash,
    evidence_hash:await entryHash(input),business_date:input.business_date,evaluation_time:input.evaluation_time,mode:input.mode,
    provenance:input.provenance,policy:ENTRY_POLICY,owner_only:true,shadow_only:true,production_eligible:false,
    market_direction_independent:true,universe:input.stocks.length,scanned:input.stocks.length,candidates,
    counts:Object.fromEntries(['ENTRY_READY','WAIT_CONFIRMATION','AVOID_ENTRY','INSUFFICIENT_EVIDENCE'].map(s=>[s,candidates.filter(c=>c.status===s).length])),
    forward_sample:0,outcome_sample:0,analysis_value:'INSUFFICIENT_SAMPLE'};
}
export type EntryEvaluation = Awaited<ReturnType<typeof evaluateEntry>>;
