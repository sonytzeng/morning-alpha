import { HORIZONS, hashValid, snapshotHash, sourceSafe } from './contracts.ts';
import type { Horizon, EvidenceKind } from './contracts.ts';
import { validProjectionTime } from './projection.ts';

export const REAL_RESEARCH_VERSION = 'VNEXT_RELEASE_B_RETAINED_1';
export type RealFact = {
  id: string; symbol: string; kind: EvidenceKind; source: string; evidence_hash: string;
  published_at: string | null; first_seen_at: string | null; available_at: string | null;
  as_of: string | null; period: string | null; summary: string;
  values: Record<string, number | string | null>; limitations: string[];
};
export type RealStock = {
  symbol: string; company: string; sector: string; facts: RealFact[];
  coverage: Record<string, { complete: boolean; valid: number; reason: string | null }>;
};
export type ResearchCard = {
  symbol: string; company: string; horizon: Horizon; status: 'WAIT_CONFIRMATION' | 'INSUFFICIENT_EVIDENCE';
  reason: string; known: string[]; confirmation: string; invalidation: string; next_review: string;
  gaps: string[]; technical_gaps: string[]; evidence: RealFact[];
};
export type RealResearchInput = {
  business_date: string; cutoff: string; source_lock_at: string; input_hash: string;
  stocks: RealStock[]; events: { id: string; symbol: string; source: string; published_at: string; available_at: string; evidence_hash: string; title: string | null }[];
};
export type RealResearchReport = {
  schema: 'VNEXT_REAL_OWNER_RESEARCH_V1'; version: string; mode: 'HISTORICAL_REPLAY'; owner_only: true;
  business_date: string; cutoff: string; source_lock_at: string; input_hash: string; snapshot_hash: string;
  universe: number; cards: ResearchCard[]; counts: Record<Horizon, { qualified: number; insufficient: number }>;
  coverage: Record<string, number>; events: RealResearchInput['events']; supply_chain: 'UNKNOWN';
  forward_sample: 0; outcome_sample: 0; analysis_value: 'INSUFFICIENT_SAMPLE';
};
export const FAMILY_LABELS: Record<EvidenceKind, string> = {
  PRICE_VOLUME:'量價', INSTITUTIONAL:'法人方向', NEWS:'完整且相關的公司消息', TECHNICAL_STRUCTURE:'價格結構',
  REVENUE:'營收', ORDERS:'訂單', GUIDANCE:'公司展望', INDUSTRY_EVENT:'產業事件與影響', DEMAND:'持續需求',
  MOAT:'競爭優勢', SUPPLY_CHAIN:'可查證的供應鏈', EPS:'獲利', MARGIN:'毛利率', CAPEX:'資本支出', VALUATION:'估值',
};

/** Missing timestamps stay null. A receipt is not a publication timestamp. */
export function factIssues(f: RealFact, cutoff: string): string[] {
  const issues: string[] = [];
  if (!f.id || !/^\d{4,6}$/.test(f.symbol) || !sourceSafe(f.source) || !hashValid(f.evidence_hash)) issues.push('LINEAGE_INVALID');
  if (!validProjectionTime(cutoff)) issues.push('CUTOFF_INVALID');
  for (const key of ['published_at','first_seen_at','available_at','as_of'] as const) {
    if (f[key] === null) issues.push('MISSING_'+key.toUpperCase());
    else if (!validProjectionTime(f[key])) issues.push('INVALID_'+key.toUpperCase());
    else if (Date.parse(f[key]) > Date.parse(cutoff)) issues.push('FUTURE_'+key.toUpperCase());
  }
  if (f.available_at && [f.first_seen_at,f.published_at,f.as_of].some(t => t && Date.parse(t) > Date.parse(f.available_at!))) issues.push('TIME_ORDER_INVALID');
  return [...new Set([...issues,...f.limitations])];
}
const n = (f: RealFact | undefined, key: string) => typeof f?.values[key] === 'number' && Number.isFinite(f.values[key]) ? f.values[key] as number : null;
const pct = (x: number) => (x * 100).toLocaleString('zh-TW',{maximumFractionDigits:2})+'%';
const money = (x: number) => x.toLocaleString('zh-TW',{maximumFractionDigits:2});

export function researchCard(stock: RealStock, horizon: Horizon, cutoff: string): ResearchCard {
  // No latest-row fallback: facts arriving after the original cutoff are unusable.
  const visible = stock.facts.filter(f => f.symbol===stock.symbol && sourceSafe(f.source) && hashValid(f.evidence_hash)
    && f.available_at && validProjectionTime(f.available_at) && Date.parse(f.available_at)<=Date.parse(cutoff)
    && [f.published_at,f.first_seen_at,f.as_of].every(t=>t===null||validProjectionTime(t)&&Date.parse(t)<=Date.parse(cutoff)));
  const required = [...HORIZONS[horizon].required] as EvidenceKind[];
  const selected = visible.filter(f => required.includes(f.kind));
  const missing = required.filter(kind => !selected.some(f=>f.kind===kind && factIssues(f,cutoff).length===0));
  const technical = selected.flatMap(f=>factIssues(f,cutoff).map(x=>f.kind+':'+x));
  const price=visible.find(f=>f.kind==='PRICE_VOLUME'),revenue=visible.find(f=>f.kind==='REVENUE');
  const institutional=visible.find(f=>f.kind==='INSTITUTIONAL'),eps=visible.find(f=>f.kind==='EPS');
  const close=n(price,'close'),average=n(price,'mean20'),low=n(price,'low20'),ratio=n(price,'volume_ratio20');
  const yoy=n(revenue,'revenue_yoy'),mom=n(revenue,'revenue_mom'),net=n(institutional,'net_shares'),earnings=n(eps,'eps');
  const known: string[]=[];
  let reason='',confirmation='',invalidation='',next_review='';
  if(horizon==='SHORT') {
    if(close!==null && average!==null)known.push(`當時收盤 ${money(close)} 元，${close>=average?'高於':'低於'}近20日平均 ${money(average)} 元；這只是價格位置，不是買進訊號。`);
    if(ratio!==null)known.push(`當日成交量約為前19日平均的 ${money(ratio)} 倍；不能單靠成交量判定將上漲。`);
    if(net!==null)known.push(`已保存當日三大法人合計${net>=0?'買超':'賣超'} ${money(Math.abs(net))} 股；這是股數，不是金額。`);
    reason='先看量價是否有變化，再等消息與價格結構一起確認；不因大盤漲跌直接決定進場。';
    confirmation='先補齊下方缺失資料，再觀察下一個完整交易時段的價格與成交量；目前不能認定進場條件成立。';
    invalidation=low!==null?`近20日最低價為 ${money(low)} 元。若後續跌破，應重新檢查短期假設；除權息未核對前不能直接當停損價。`:'尚無可靠支撐位置，暫時不能設定價格失效條件。';
    next_review='下一個合法交易日收盤資料完整後；本輪沒有啟用自動重新評估。';
  } else if(horizon==='MEDIUM') {
    if(yoy!==null && mom!==null)known.push(`${revenue?.period??'已保存月份'}營收年變動 ${pct(yoy)}、月變動 ${pct(mom)}；單月資料不能證明趨勢已啟動。`);
    if(net!==null)known.push('法人僅有已保存交易日的方向，不能冒充連續幾週布局。');
    if(earnings!==null)known.push(`${eps?.period??'已保存報表'}每股盈餘實績為 ${money(earnings)} 元；單季或累計口徑尚待核對，不是市場預估。`);
    reason='營收、訂單、公司展望與產業事件要能互相印證，才判斷未來幾週是否值得觀察。';
    confirmation='等待可追溯訂單與公司展望，並由後續月營收及連續法人方向驗證；不能只用短線漲幅判斷啟動、回檔或過熱。';
    invalidation='若訂單取消、公司下修展望，或後續營收不再支持原假設，停止沿用原本中期判斷。';
    next_review='下一次公司營收、法說或重大事件公布並取得後。';
  } else {
    if(earnings!==null)known.push(`${eps?.period??'已保存報表'}每股盈餘實績為 ${money(earnings)} 元；單季或累計口徑尚待核對，不能證明競爭優勢或估值合理。`);
    if(yoy!==null)known.push(`已保存單月營收年變動 ${pct(yoy)}；無法單憑一個月證明需求具有持續性。`);
    reason='長期要看需求、競爭優勢、供應鏈、毛利、資本支出與估值；不能用同一個技術分數代替。';
    confirmation='取得可查證的需求與競爭優勢證據、完整財報及估值基礎後，再評估長期假設。';
    invalidation='若需求持續性、競爭優勢或供應鏈關係被新證據否定，或獲利與資本支出不再支持原假設，就需要撤回重估。';
    next_review='下一次完整季報、年度資本支出指引或關鍵需求變化可查證時。';
  }
  const gaps=missing.map(k=>`尚缺可完整核對來源與時間的${FAMILY_LABELS[k]}`);
  if(selected.some(f=>f.published_at===null))gaps.push('部分來源沒有保存原始發布時間，不能用接收時間代替。');
  // Descriptive context must be traceable too, without silently expanding or
  // replacing the horizon's qualification requirements.
  const contextKinds: EvidenceKind[]=horizon==='MEDIUM'?['EPS']:horizon==='LONG'?['REVENUE']:[];
  const evidence=visible.filter(f=>required.includes(f.kind)||contextKinds.includes(f.kind));
  return {symbol:stock.symbol,company:stock.company,horizon,status:missing.length?'INSUFFICIENT_EVIDENCE':'WAIT_CONFIRMATION',reason,known:known.slice(0,3),confirmation,invalidation,next_review,gaps,technical_gaps:[...new Set(technical)],evidence};
}

export async function buildRealResearch(input: RealResearchInput): Promise<RealResearchReport> {
  if(!validProjectionTime(input.cutoff)||!validProjectionTime(input.source_lock_at)||!hashValid(input.input_hash)
    ||Date.parse(input.source_lock_at)<Date.parse(input.cutoff)||!/^\d{4}-\d\d-\d\d$/.test(input.business_date)
    ||input.stocks.length!==72||new Set(input.stocks.map(s=>s.symbol)).size!==72
    ||input.stocks.some(s=>!/^\d{4,6}$/.test(s.symbol)||s.facts.some(f=>f.symbol!==s.symbol)||new Set(s.facts.map(f=>f.id)).size!==s.facts.length))throw Error('REAL_INPUT_INVALID');
  const cards=input.stocks.flatMap(stock=>(Object.keys(HORIZONS) as Horizon[]).map(h=>researchCard(stock,h,input.cutoff)));
  const payload={schema:'VNEXT_REAL_OWNER_RESEARCH_V1' as const,version:REAL_RESEARCH_VERSION,mode:'HISTORICAL_REPLAY' as const,owner_only:true as const,
    business_date:input.business_date,cutoff:input.cutoff,source_lock_at:input.source_lock_at,input_hash:input.input_hash,universe:input.stocks.length,cards,
    counts:Object.fromEntries((Object.keys(HORIZONS) as Horizon[]).map(h=>[h,{qualified:cards.filter(c=>c.horizon===h&&c.status==='WAIT_CONFIRMATION').length,insufficient:cards.filter(c=>c.horizon===h&&c.status==='INSUFFICIENT_EVIDENCE').length}])) as RealResearchReport['counts'],
    coverage:Object.fromEntries([20,60,120,250].map(d=>[d,input.stocks.filter(s=>s.coverage[d]?.complete).length])),
    events:input.events.filter(e=>validProjectionTime(e.published_at)&&validProjectionTime(e.available_at)&&Date.parse(e.published_at)<=Date.parse(e.available_at)&&Date.parse(e.available_at)<=Date.parse(input.cutoff)&&sourceSafe(e.source)&&hashValid(e.evidence_hash)),
    supply_chain:'UNKNOWN' as const,forward_sample:0 as const,outcome_sample:0 as const,analysis_value:'INSUFFICIENT_SAMPLE' as const};
  return {...payload,snapshot_hash:await snapshotHash(payload)};
}

export async function verifyResearchLock(report: RealResearchReport): Promise<boolean> {
  const {snapshot_hash,...payload}=report;
  return hashValid(snapshot_hash)&&snapshot_hash===await snapshotHash(payload);
}
