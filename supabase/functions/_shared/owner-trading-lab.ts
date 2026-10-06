/** Owner research adapter. Reuses the sealed evaluator; never publishes a decision. */
import { buildEvidenceDecision } from './decision-v1-evidence.ts';
import type { EvidenceData, DecisionIdentity, Row } from './decision-v1-data.ts';

export const LAB_VERSION = 'OWNER_TRADING_LAB_V1';
export const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
export const records = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : [];
export const requestIdentity = (v: unknown): string => JSON.stringify(v === null || typeof v !== 'object' ? v :
  Array.isArray(v) ? v.map(x=>JSON.parse(requestIdentity(x))) : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(requestIdentity(object(v)[k]))])));
/** A research quote may be useful overnight, but cannot be a fill at today's time. */
export function paperQuote(quotes: Row[], symbol: string, now: string) {
  const at=Date.parse(now),day=taipeiDate(now);
  const rows=quotes.filter(q=>q.symbol===symbol&&q.trading_date===day&&q.phase==='intraday'
    &&q.quality_status==='verified'&&['fresh','provider_returned'].includes(String(q.freshness_status))
    &&Number(q.value)>0&&Number.isFinite(Number(q.value))&&Date.parse(String(q.captured_at))<=at
    &&Date.parse(String(q.captured_at))>=at-300000&&Date.parse(String(q.ingested_at))<=at)
    .sort((a,b)=>String(b.captured_at).localeCompare(String(a.captured_at))||String(a.id).localeCompare(String(b.id)));
  if(!rows.length || rows.some(q=>q.captured_at===rows[0].captured_at&&Number(q.value)!==Number(rows[0].value)))return null;
  return rows[0];
}
const number = (v: unknown): number | null => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
export const taipeiDate = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(at));
export const sampleLabel = (n: number) => n < 5 ? '樣本不足' : n < 20 ? '早期觀察' : n < 60 ? '初步有效性' : '較有意義樣本';
const STAGES = [
  ['LIQUIDITY', '流動性', ['FRESH_QUOTE_MISSING','CONFLICTING_QUOTES','20_DAILY_VOLUMES_MISSING']],
  ['MARKET_FIT', '市場配合', ['MARKET_UNAVAILABLE','MARKET_AVOID']],
  ['SECTOR_FIT', '產業配合', ['SECTOR_REACTION_MISSING']],
  ['RELATIVE_MOMENTUM', '相對強弱／動能', ['20_DAILY_CLOSES_MISSING','EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING']],
  ['EVIDENCE', '公司證據完整', ['THREE_INSTITUTIONS_MISSING','FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING','SOURCED_COMPANY_CATALYST_MAPPING_MISSING']],
  ['RISK', '風險通過', ['RISK_REJECTED']],
  ['ENTRY', '進場確認', ['ENTRY_NOT_CONFIRMED']],
] as const;
export const rejectionLabel = (v: string) => ({
  FRESH_QUOTE_MISSING:'缺少當時有效報價',CONFLICTING_QUOTES:'來源報價互相衝突',
  '20_DAILY_VOLUMES_MISSING':'缺少二十個收盤交易日的成交量','20_DAILY_CLOSES_MISSING':'缺少二十個收盤交易日的價格',
  MARKET_UNAVAILABLE:'缺少當日正式市場判斷',MARKET_AVOID:'正式市場判斷要求避開風險',SECTOR_REACTION_MISSING:'缺少同產業價格確認',
  EVENT_ALIGNED_PRICE_VOLUME_REACTION_MISSING:'缺少事件前後的量價與大盤對照',THREE_INSTITUTIONS_MISSING:'缺少三大法人證據',
  FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING:'缺少連續四季財報與預期',SOURCED_COMPANY_CATALYST_MAPPING_MISSING:'缺少有來源的公司催化關聯',
  RISK_REJECTED:'風險或追價條件不合格',ENTRY_NOT_CONFIRMED:'尚未確認正式進場條件',
} as Record<string,string>)[v] || '證據不足，請查看詳細原因';

export function discoverCandidates(data: EvidenceData, identity: DecisionIdentity, canonical: Row | null) {
  const evaluation = buildEvidenceDecision(data, identity);
  const symbols = [...new Set(data.universe.filter(r => r.is_active === true && /^\d{4,6}$/.test(String(r.symbol))
    && Date.parse(String(r.created_at)) <= Date.parse(identity.generated_at) && Date.parse(String(r.updated_at)) <= Date.parse(identity.generated_at)).map(r=>String(r.symbol)))].sort();
  const rejected = new Map((evaluation.screening?.rejected || []).map(r=>[r.symbol,[...r.reasons]]));
  const opportunities = new Map(evaluation.stock_opportunities.map(r=>[r.symbol,r]));
  const canonicalCurrent = canonical?.report_date === identity.report_date && canonical?.status === 'READY';
  const details = symbols.map(symbol => {
    const reasons = [...(rejected.get(symbol) || [])], candidate = opportunities.get(symbol);
    if (!canonicalCurrent) reasons.push('MARKET_UNAVAILABLE');
    else if (['AVOID','STOP'].includes(String(canonical?.action))) reasons.push('MARKET_AVOID');
    if (candidate && ['AVOID','DO_NOT_CHASE'].includes(candidate.action)) reasons.push('RISK_REJECTED');
    if (!candidate || candidate.action !== 'ACTIVE_WATCH') reasons.push('ENTRY_NOT_CONFIRMED');
    return {symbol, reasons:[...new Set(reasons)]};
  });
  let surviving = details;
  const funnel = STAGES.map(([key,label,blocked]) => {
    const before=surviving.length;
    const excluded=surviving.filter(r=>r.reasons.some(x=>(blocked as readonly string[]).includes(x)));
    surviving=surviving.filter(r=>!excluded.includes(r));
    return {key,label,before,passed:surviving.length,excluded:excluded.length,
      reasons:[...new Set(excluded.flatMap(r=>r.reasons.filter(x=>(blocked as readonly string[]).includes(x))))]};
  });
  // Never relax the shared quality evaluator to manufacture Owner watch stocks.
  // Pending entry is legal WATCHLIST, not READY or a formal recommendation.
  const watchlist = canonicalCurrent && !['AVOID','STOP'].includes(String(canonical?.action))
    ? evaluation.stock_opportunities.filter(o=>!['AVOID','DO_NOT_CHASE'].includes(o.action))
      .sort((a,b)=>b.opportunity_score.value-a.opportunity_score.value || a.symbol.localeCompare(b.symbol)).slice(0,5)
      .map(o=>({symbol:o.symbol,name:o.company_name,status:'WATCHLIST',why:o.thesis,score:o.opportunity_score,
        sector:o.transmission.sector,market_fit:String(canonical?.action),relative_strength:o.opportunity_score.inputs.relative_return ?? null,
        momentum:o.priced_in_score?.inputs.post_event_return ?? null,risk:o.risk_score,
        entry_condition:o.action === 'ACTIVE_WATCH' ? '既有量價、相對強弱與法人確認成立；僅研究，不是正式推薦' : '既有評估仍待確認，不自動提升正式推薦',
        invalidation:o.invalidation_conditions,evidence:o.evidence})) : [];
  const gate=object(object(canonical?.generated_text).market_report_gate);
  return {version:LAB_VERSION,scope:'EXPLICIT_ACTIVE_UNIVERSE_NOT_ALL_TW_STOCKS',scanned:symbols.length,
    universe_complete:data.failures.length===0,failures:data.failures,funnel,details,watchlist,
    formal_status:typeof gate.recommendation_status==='string'?gate.recommendation_status:'UNAVAILABLE',
    formal_reason:typeof gate.wait_reason==='string'?gate.wait_reason:'尚無可讀取的正式推薦診斷',
    first_blocked_gate:funnel.find(s=>s.excluded>0)?.label || null,
    availability:{price:data.quotes.length?'PARTIAL':'MISSING',volume:data.quotes.some(q=>number(object(object(q.raw_payload).source_raw).total && object(object(object(q.raw_payload).source_raw).total).tradeVolume)!>0)?'PARTIAL':'MISSING',
      industry:symbols.length?'AVAILABLE':'MISSING',institutional:data.flows.length?'PARTIAL':'MISSING',chips:'MISSING',
      fundamentals:data.earnings.length?'PARTIAL':'MISSING',revenue:data.earnings.some(r=>number(r.revenue_actual)!>0)?'PARTIAL':'MISSING',
      news:data.news.length?'PARTIAL':'MISSING',catalyst:data.mappings.length?'PARTIAL':'MISSING'}};
}

/** One complete exit per position; no independent horizons mixed as independent trades. */
export function performance(returns: {id:string;at:string;value:number}[]) {
  const rows=[...new Map(returns.filter(r=>Number.isFinite(r.value)&&r.value>=-100&&Number.isFinite(Date.parse(r.at))).map(r=>[r.id,r])).values()]
    .sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  const n=rows.length, base={sample:n,sample_label:sampleLabel(n),kind:'EQUAL_WEIGHT_GROSS_TRADE_RETURNS_NOT_ACCOUNT_EQUITY',fees:'NOT_INCLUDED',mfe:null,mae:null};
  if(n<5)return {...base,win_rate:null,average_win:null,average_loss:null,expectancy:null,profit_factor:null,max_drawdown:null};
  const wins=rows.filter(r=>r.value>0),losses=rows.filter(r=>r.value<0),sum=(xs:typeof rows)=>xs.reduce((v,r)=>v+r.value,0);
  let equity=1,peak=1,drawdown=0;
  for(const row of rows){equity*=1+row.value/100;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,(peak-equity)/peak*100);}
  return {...base,win_rate:wins.length/n*100,average_win:wins.length?sum(wins)/wins.length:null,
    average_loss:losses.length?sum(losses)/losses.length:null,expectancy:sum(rows)/n,
    profit_factor:losses.length?sum(wins)/-sum(losses):null,max_drawdown:drawdown};
}

/** Exact calendar target, no next-available-quote fallback; intraday extremes are not known. */
export function outcomeFromCloses(trade:Row, horizon:string, target:string, quotes:Row[], now:string) {
  const entry=number(trade.entry_price),entered=Date.parse(String(trade.entered_at)),cutoff=Date.parse(now);
  if(!entry || !Number.isFinite(entered) || !['CLOSE','1D','3D','5D'].includes(horizon))throw Error('TRADE_CONTRACT');
  const rs=quotes.filter(q=>q.symbol===trade.symbol&&q.trading_date===target&&q.phase==='close'&&q.quality_status==='verified'
    && ['fresh','provider_returned'].includes(String(q.freshness_status))&&number(q.value)!>0
    &&Date.parse(String(q.captured_at))>entered&&Date.parse(String(q.captured_at))<=cutoff&&Date.parse(String(q.ingested_at))<=cutoff);
  if(!rs.length)return {status:'UNAVAILABLE',reason:'EXACT_SESSION_CLOSE_MISSING',target_date:target,horizon};
  const prices=new Set(rs.map(r=>Number(r.value))); if(prices.size!==1)return {status:'UNAVAILABLE',reason:'CONFLICTING_CLOSES',target_date:target,horizon};
  rs.sort((a,b)=>String(a.captured_at).localeCompare(String(b.captured_at))||String(a.id).localeCompare(String(b.id)));
  const q=rs[0];return {status:'OBSERVED',horizon,target_date:target,quote_id:q.id,price:Number(q.value),return_percent:(Number(q.value)/entry-1)*100,
    mfe:null,mae:null,extremes_status:'INTRAPERIOD_EXTREMES_MISSING',source:'market_quotes',observed_at:now};
}
