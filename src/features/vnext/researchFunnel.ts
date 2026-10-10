/** Independent research/rights diagnostics. V2 is an UNPROMOTED hypothesis,
 * never Recommendation V2, a Production writer, or a forward prediction. */
import {HORIZONS,hashValid,sourceSafe,snapshotHash,type Horizon} from './contracts.ts';
import {validProjectionTime} from './projection.ts';
import {sourceRights} from './publicationReadiness.ts';

export const RESEARCH_FUNNEL_VERSION='VNEXT_OBSERVATION_HYPOTHESIS_2.0.0';
export const RESEARCH_RULES=Object.freeze({short_amount_ratio:1.5,short_close_location:.7,short_max_range:.10,
 medium_months:3,medium_institutional_sessions:10,long_quarters:4});
export type Trace={id:string;source:string;evidence_hash:string;published_at:string|null;first_seen_at:string|null;
 available_at:string|null;as_of:string|null};
export type DailyBar=Trace&{date:string;open:number;high:number;low:number;close:number;volume:number;amount:number;session_scope:string};
export type ResearchFact=Trace&{kind:string;period:string|null;values:Record<string,number|string|null>;basis:string|null};
export type FunnelInput={symbol:string;company:string;bars:DailyBar[];expected_sessions:string[];facts:ResearchFact[];
 cutoff:string;through:string;next_session:string;v1_missing:Record<Horizon,string[]>};
export type ResearchState='QUALIFIED'|'REJECTED'|'INSUFFICIENT';
export type ResearchEvaluation={symbol:string;company:string;horizon:Horizon;version:string;state:ResearchState;
 evaluated:boolean;reasons:string[];warnings:string[];used:Trace[];cutoff:string;through:string;next_review_at:string;
 reason:string;confirmation:string;invalidation:string;risk:string;metrics:Record<string,number>;
 mode:'RETAINED_SNAPSHOT_REVIEW_NOT_FORWARD';v1:{state:'CONTRACT_READY_NOT_EVALUATED'|'INSUFFICIENT';missing:string[]}};
const unique=(v:string[])=>[...new Set(v)];
const time=(v:string|null):v is string=>v!==null&&validProjectionTime(v);
const day=(v:string)=>/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().startsWith(v);
/** A known receipt supports an observation *after* receipt, not publication-time
 * knowledge. Missing publication time stays null, and is reported separately. */
export function traceIssues(x:Trace,cutoff:string,exactPublication=false){
 const issues:string[]=[];
 if(!x.id||!sourceSafe(x.source)||!hashValid(x.evidence_hash))issues.push('LINEAGE_INVALID');
 if(!time(cutoff)||!time(x.first_seen_at)||!time(x.available_at)||!time(x.as_of))issues.push('TIME_METADATA_MISSING');
 if(x.published_at===null){if(exactPublication)issues.push('PUBLICATION_TIME_UNVERIFIED');}
 else if(!time(x.published_at))issues.push('PUBLICATION_TIME_INVALID');
 if([x.first_seen_at,x.available_at,x.as_of,x.published_at].some(t=>time(t)&&time(cutoff)&&Date.parse(t)>Date.parse(cutoff)))issues.push('FUTURE_EVIDENCE');
 if(time(x.available_at)&&[x.first_seen_at,x.as_of,x.published_at].some(t=>time(t)&&Date.parse(t)>Date.parse(x.available_at!)))issues.push('TIME_ORDER_INVALID');
 return unique(issues);
}
function consecutiveMonths(rows:ResearchFact[]){
 const months=rows.map(r=>/^(\d{4})-(\d\d)$/.exec(r.period??''));
 return months.every((m,i)=>m&&Number(m[2])>=1&&Number(m[2])<=12&&(!i||Number(m[1])*12+Number(m[2])===Number(months[i-1]![1])*12+Number(months[i-1]![2])+1));
}
function periodEnd(period:string|null,quarter=false){
 const match=(quarter?/^(\d{4})-Q([1-4])$/:/^(\d{4})-(\d\d)$/).exec(period??'');
 if(!match)return null;const month=Number(match[2])*(quarter?3:1);
 if(month<1||month>12)return null;return new Date(Date.UTC(Number(match[1]),month,0)).toISOString().slice(0,10);
}
export function evaluateResearch(input:FunnelInput,horizon:Horizon):ResearchEvaluation{
 if(!Object.hasOwn(HORIZONS,horizon)||!/^\d{4,6}$/.test(input.symbol)||!input.company||!time(input.cutoff)||!day(input.through)||!day(input.next_session)||input.next_session<=input.through)throw Error('FUNNEL_INPUT_INVALID');
 const gaps:string[]=[],reject:string[]=[],used:Trace[]=[],warnings:string[]=[],metrics:Record<string,number>={};
 let reason='',confirmation='',invalidation='',risk='';
 const take=(facts:ResearchFact[],kind:string,count:number)=>{
  const rows=facts.filter(f=>f.kind===kind).sort((a,b)=>(a.period??'').localeCompare(b.period??''));
  if(rows.length<count)gaps.push('MISSING_'+kind+'_'+count);
  const selected=rows.slice(-count);used.push(...selected);
  for(const f of selected)gaps.push(...traceIssues(f,input.cutoff).map(r=>kind+':'+r));
  if(new Set(selected.map(f=>f.period)).size!==selected.length)gaps.push(kind+':DUPLICATE_PERIOD');
  return selected;
 };
 if(horizon==='SHORT'){
  // Deliberately NOT a multi-day price trend/return model. Compare cash
  // participation and same-session OHLC only, without an unverified adjustment.
  const dates=input.expected_sessions.slice(-20),bars=dates.flatMap(d=>input.bars.filter(b=>b.date===d));
  if(dates.length!==20||new Set(dates).size!==20||dates.at(-1)!==input.through||dates.some((d,i)=>!day(d)||i>0&&d<=dates[i-1])||bars.length!==20||dates.some(d=>bars.filter(b=>b.date===d).length!==1))gaps.push('SHORT_20_SESSION_COVERAGE');
  used.push(...bars);
  if(new Set(bars.map(b=>b.session_scope)).size!==1)gaps.push('MIXED_SESSION_SCOPE');
  for(const b of bars){gaps.push(...traceIssues(b,input.cutoff));
   if(![b.open,b.high,b.low,b.close,b.volume,b.amount].every(n=>Number.isFinite(n)&&n>0)||!Number.isSafeInteger(b.volume)||!Number.isSafeInteger(b.amount)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||!b.session_scope)gaps.push('PRICE_VOLUME_INVALID');
   if(time(b.as_of)&&b.as_of.slice(0,10)!==b.date)gaps.push('SESSION_AS_OF_MISMATCH');
  }
  if(!gaps.length){const last=bars.at(-1)!,average=bars.slice(0,-1).reduce((s,b)=>s+b.amount,0)/19;
   metrics.amount_ratio=last.amount/average;metrics.close_location=last.high===last.low?0:(last.close-last.low)/(last.high-last.low);metrics.intraday_range=(last.high-last.low)/last.open;
   if(metrics.amount_ratio<RESEARCH_RULES.short_amount_ratio)reject.push('PARTICIPATION_NOT_ELEVATED');
   if(last.close<=last.open||metrics.close_location<RESEARCH_RULES.short_close_location)reject.push('CLOSE_NOT_SUPPORTED');
   if(metrics.intraday_range>RESEARCH_RULES.short_max_range)reject.push('INTRADAY_RANGE_TOO_WIDE');
  }
  reason='成交金額增加，且同一交易日收盤靠近區間上緣，值得追蹤後續市場參與是否持續。';
  confirmation='下一個完整交易日再確認成交金額與收盤表現持續；先核對公司事件，不代表現在可以買進。';
  invalidation='若後續成交參與消退、收盤不再偏強，或公司事件改變條件，就取消這個短期觀察假設。';
  risk='只分析原始成交參與與當日價格形狀；未驗證公司消息與調整權益，不判定突破、支撐、報酬或合理買價。';
  warnings.push('RAW_ACTIVITY_ONLY_NOT_ADJUSTED_TREND','COMPANY_EVENTS_NOT_ASSESSED','PARAMETERS_EXPLORATORY_NOT_VALIDATED');
 }else if(horizon==='MEDIUM'){
  // Revenue/institutional thesis. Orders, guidance and supply-chain are NOT
  // required unless used as a claim. No claim of an industry/order catalyst.
  const revenues=take(input.facts,'REVENUE',3),institutions=take(input.facts,'INSTITUTIONAL',10);
  if(revenues.length===3&&!consecutiveMonths(revenues))gaps.push('REVENUE_PERIOD_GAPS');
  if(revenues.some(f=>f.basis!=='MONTHLY'||typeof f.values.yoy_percent!=='number'||!Number.isFinite(f.values.yoy_percent)))gaps.push('REVENUE_BASIS_INVALID');
  if(revenues.some(f=>!periodEnd(f.period)||!time(f.as_of)||periodEnd(f.period)!>f.as_of.slice(0,10)))gaps.push('FINANCIAL_PERIOD_NOT_AVAILABLE');
  const dates=input.expected_sessions.slice(-10);
  if(dates.length!==10||dates.at(-1)!==input.through||institutions.length===10&&institutions.some((f,i)=>f.period!==dates[i]||f.basis!=='SHARES'||typeof f.values.net_shares!=='number'||!Number.isFinite(f.values.net_shares)))gaps.push('INSTITUTIONAL_CONTINUITY_INVALID');
  if(!gaps.length){metrics.positive_revenue_months=revenues.filter(f=>Number(f.values.yoy_percent)>0).length;metrics.net_shares=institutions.reduce((s,f)=>s+Number(f.values.net_shares),0);
   if(metrics.positive_revenue_months!==3)reject.push('REVENUE_TREND_NOT_SUPPORTED');if(metrics.net_shares<=0)reject.push('INSTITUTIONAL_DIRECTION_NOT_SUPPORTED');}
  reason='連續營收與法人股數方向支持後續數週追蹤，但還不是訂單或產業受惠的證明。';
  confirmation='下一次營收仍支持成長，且法人方向未反轉，再重新檢查研究假設。';
  invalidation='若後續營收轉弱或法人累計方向反轉，停止沿用原來的中期觀察。';
  risk='不以單月資料認定趨勢；沒有訂單、展望或供應鏈證據就不寫相關理由。';
 }else{
  const eps=take(input.facts,'EPS',4),margin=take(input.facts,'MARGIN',4),capex=take(input.facts,'CAPEX',4);
  const demand=take(input.facts,'DEMAND',1),moat=take(input.facts,'MOAT',1),valuation=take(input.facts,'VALUATION',1);
  for(const rows of [eps,margin,capex]){const quarters=rows.map(f=>/^(\d{4})-Q([1-4])$/.exec(f.period??''));
   if(rows.length===4&&quarters.some((m,i)=>!m||i>0&&Number(m[1])*4+Number(m[2])!==Number(quarters[i-1]?.[1])*4+Number(quarters[i-1]?.[2])+1))gaps.push('FINANCIAL_QUARTER_GAPS');
   if(rows.some(f=>f.basis!=='SINGLE_QUARTER'||typeof f.values.value!=='number'||!Number.isFinite(f.values.value)))gaps.push('FINANCIAL_BASIS_INVALID');
   if(rows.some(f=>!periodEnd(f.period,true)||!time(f.as_of)||periodEnd(f.period,true)!>f.as_of.slice(0,10)))gaps.push('FINANCIAL_PERIOD_NOT_AVAILABLE');}
  if(eps.length===4&&[margin,capex].some(rows=>rows.some((f,i)=>f.period!==eps[i]?.period)))gaps.push('FINANCIAL_PERIOD_MISMATCH');
  for(const f of [...demand,...moat,...valuation])if(!['SUPPORTED','NOT_SUPPORTED'].includes(String(f.values.verdict))||f.basis!=='DOCUMENTED_REVIEW')gaps.push(f.kind+':REVIEW_MISSING');
  if(!gaps.length){if(eps.some(f=>Number(f.values.value)<=0))reject.push('EARNINGS_NOT_SUPPORTED');
   if(Number(margin.at(-1)!.values.value)<Number(margin[0].values.value))reject.push('MARGIN_NOT_SUPPORTED');
   for(const f of [...demand,...moat,...valuation])if(f.values.verdict!=='SUPPORTED')reject.push(f.kind+':NOT_SUPPORTED');}
  reason='完整財務趨勢、需求、競爭優勢與估值需要共同支持長期觀察，不能用短線漲幅代替。';
  confirmation='下一季財報及需求資料持續支持既有假設，再檢查估值與資本支出風險。';
  invalidation='若需求、競爭優勢、獲利品質或估值基礎被否定，停止沿用長期判斷。';
  risk='缺少必要財務與公司證據時暫時無法可靠判斷；同產業不能冒充客戶或供應商。';
 }
 if(new Set(used.map(f=>f.id)).size!==used.length)gaps.push('EVIDENCE_ID_DUPLICATE');
 if(used.some(f=>f.published_at===null))warnings.push('EXACT_PUBLICATION_TIME_UNKNOWN_OBSERVED_AFTER_RECEIPT_ONLY');
 const state:ResearchState=gaps.length?'INSUFFICIENT':reject.length?'REJECTED':'QUALIFIED';
 return {symbol:input.symbol,company:input.company,horizon,version:RESEARCH_FUNNEL_VERSION,state,evaluated:!gaps.length,
  reasons:unique(gaps.length?gaps:reject).sort(),warnings:unique(warnings),used,metrics,cutoff:input.cutoff,through:input.through,
  next_review_at:input.next_session+'T13:30:00+08:00',reason:state==='QUALIFIED'?reason:state==='INSUFFICIENT'?'必要資料不足，暫時無法可靠判斷。':'資料足以評估，但未符合這個觀察模型；不代表股票沒有其他機會。',
  confirmation,invalidation,risk,mode:'RETAINED_SNAPSHOT_REVIEW_NOT_FORWARD',v1:{state:input.v1_missing[horizon].length?'INSUFFICIENT':'CONTRACT_READY_NOT_EVALUATED',missing:input.v1_missing[horizon]}};
}

export type RightsUse='RAW_DATA'|'OFFICIAL_FACT'|'OWN_ANALYSIS';
export type RightsGrant={source:string;document_url:string;reviewed_at:string;expires_at:string|null;storage:boolean;commercial:boolean;
 raw_redistribution:boolean;fact_publication:boolean;derived_publication:boolean;attribution:string};
export function usageRights(source:string,use:RightsUse,at:string,grants:RightsGrant[]=[]){
 if(!time(at)||!['RAW_DATA','OFFICIAL_FACT','OWN_ANALYSIS'].includes(use))return {allowed:false,reason:'RIGHTS_POLICY_INVALID',attribution:null};
 const open=sourceRights(source);
 if(open.status==='OPEN_DATA_WITH_ATTRIBUTION')return {allowed:true,reason:'OPEN_DATA_ATTRIBUTION_REQUIRED',attribution:open.grant.attribution};
 const matches=grants.filter(g=>g.source===source),g=matches.length===1?matches[0]:undefined;
 if(!g||!time(at)||!time(g.reviewed_at)||Date.parse(g.reviewed_at)>Date.parse(at)||!sourceSafe(source)||!sourceSafe(g.document_url)||!g.attribution||!g.storage||!g.commercial||g.expires_at!==null&&(!time(g.expires_at)||Date.parse(g.expires_at)<=Date.parse(at)))return {allowed:false,reason:'LICENSING_UNVERIFIED',attribution:null};
 const allowed=use==='RAW_DATA'?g.raw_redistribution:use==='OFFICIAL_FACT'?g.fact_publication:g.derived_publication;
 return {allowed,reason:allowed?'EXPLICIT_USE_GRANT':'USE_NOT_LICENSED',attribution:allowed?g.attribution:null};
}
export type PublicationPolicy={now:string;audience:'free'|'premium'|'owner'|'anonymous';server_entitlement_verified:boolean;
 input_hash:string;approved_hash:string|null;approved_at:string|null;methodology_approved:boolean;quality_reviewed:boolean;
 use:RightsUse;grants:RightsGrant[]};
export function publicationEligibility(r:ResearchEvaluation,p:PublicationPolicy){
 if(r.state!=='QUALIFIED')return {checked:false,eligible:false,categories:[] as string[],reasons:[] as string[]};
 const issues:{category:string;reason:string}[]=[],add=(category:string,reason:string)=>issues.push({category,reason});
 if(!time(p.now)||Date.parse(p.now)<Date.parse(r.cutoff))add('TIME','PUBLICATION_TIME_INVALID');
 if(time(p.now)&&Date.parse(p.now)>=Date.parse(r.next_review_at))add('EXPIRED','REVIEW_OVERDUE');
 for(const f of r.used){for(const reason of traceIssues(f,r.cutoff,true))add('TIME',reason);
  const right=usageRights(f.source,p.use,p.now,p.grants);if(!right.allowed)add('LICENSING',right.reason);}
 if(!p.quality_reviewed||!p.methodology_approved)add('QUALITY','RESEARCH_METHOD_REVIEW_REQUIRED');
 if(!hashValid(p.input_hash)||p.approved_hash!==p.input_hash||!p.approved_at||!time(p.approved_at)||Date.parse(p.approved_at)<Date.parse(r.cutoff)||Date.parse(p.approved_at)>Date.parse(p.now))add('APPROVAL','IMMUTABLE_PUBLICATION_REVIEW_REQUIRED');
 if(!p.server_entitlement_verified||!['free','premium','owner'].includes(p.audience))add('PERMISSION','SERVER_ENTITLEMENT_REQUIRED');
 if(!r.reason||!r.confirmation||!r.invalidation||!r.risk||!time(r.next_review_at))add('QUALITY','CONTENT_INCOMPLETE');
 return {checked:true,eligible:issues.length===0,categories:unique(issues.map(i=>i.category)).sort(),reasons:unique(issues.map(i=>i.reason)).sort()};
}
export type FunnelRow={research:ResearchEvaluation;publication:ReturnType<typeof publicationEligibility>;input_hash:string};
export function summarizeFunnel(rows:FunnelRow[]){
 const counts=(values:string[][])=>Object.fromEntries(unique(values.flat()).sort().map(reason=>[reason,values.filter(v=>v.includes(reason)).length]));
 return {scanned:rows.length,evaluated:rows.filter(r=>r.research.evaluated).length,qualified:rows.filter(r=>r.research.state==='QUALIFIED').length,
  rejected:rows.filter(r=>r.research.state==='REJECTED').length,insufficient:rows.filter(r=>r.research.state==='INSUFFICIENT').length,
  publication_checked:rows.filter(r=>r.publication.checked).length,publication_eligible:rows.filter(r=>r.publication.eligible).length,
  research_reasons:counts(rows.map(r=>r.research.reasons)),publication_reasons:counts(rows.filter(r=>r.publication.checked).map(r=>r.publication.reasons)),
  publication_categories:counts(rows.filter(r=>r.publication.checked).map(r=>r.publication.categories)),
  v1_contract_ready:rows.filter(r=>r.research.v1.state==='CONTRACT_READY_NOT_EVALUATED').length,v1_insufficient:rows.filter(r=>r.research.v1.state==='INSUFFICIENT').length,
  v1_missing:counts(rows.map(r=>r.research.v1.missing))};
}
/** Isolated candidate adapter. The caller MUST supply verified server policy,
 * not a browser tier. Existing Production/SQL V1 admission is not replaced. */
export async function projectQualifiedResearch(rows:FunnelRow[],policyFor:(row:FunnelRow)=>PublicationPolicy){
 const admitted=[];
 for(const row of rows){
  if(row.input_hash!==await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research:row.research}))throw Error('RESEARCH_LOCK_MISMATCH');
  const p=policyFor(row);
  if(p.input_hash!==row.input_hash||!publicationEligibility(row.research,p).eligible)continue;
  admitted.push({row,p});
 }
 if(new Set(admitted.map(x=>x.p.audience)).size>1)throw Error('MIXED_SERVER_ENTITLEMENT');
 const ordered=admitted.sort((a,b)=>a.row.research.symbol.localeCompare(b.row.research.symbol)||a.row.research.horizon.localeCompare(b.row.research.horizon));
 const freeSymbols=new Set([...new Set(ordered.map(x=>x.row.research.symbol))].slice(0,3));
 return ordered.filter(x=>x.p.audience!=='free'||freeSymbols.has(x.row.research.symbol)).map(({row,p})=>{
  const r=row.research,summary={symbol:r.symbol,company:r.company,horizon:r.horizon,reason:r.reason,risk:r.risk,classification:'RESEARCH_NOT_RECOMMENDATION'};
  return p.audience==='free'?summary:{...summary,confirmation:r.confirmation,invalidation:r.invalidation,next_review_at:r.next_review_at,
   evidence:r.used.map(e=>({source:e.source,published_at:e.published_at,first_seen_at:e.first_seen_at,available_at:e.available_at,as_of:e.as_of,
    attribution:usageRights(e.source,p.use,p.now,p.grants).attribution})),outcomes:[]};
 });
}
export type ResearchFunnel={schema:'VNEXT_RESEARCH_PUBLICATION_FUNNEL_V2';version:string;through:string;cutoff:string;history_hash:string;sources_hash:string;
 rows:FunnelRow[];counts:Record<Horizon,ReturnType<typeof summarizeFunnel>>;member_publication:false;forward_sample:0;outcome_sample:0;promotion:false;snapshot_hash:string};
export async function verifyFunnel(f:ResearchFunnel){
 const {snapshot_hash,...payload}=f;
 return f.schema==='VNEXT_RESEARCH_PUBLICATION_FUNNEL_V2'&&f.version===RESEARCH_FUNNEL_VERSION&&f.rows.length===216&&new Set(f.rows.map(r=>r.research.symbol+':'+r.research.horizon)).size===216
  &&f.member_publication===false&&f.promotion===false&&f.forward_sample===0&&f.outcome_sample===0&&hashValid(f.history_hash)&&hashValid(f.sources_hash)
  &&snapshot_hash===await snapshotHash(payload)&&(Object.keys(HORIZONS) as Horizon[]).every(h=>JSON.stringify(summarizeFunnel(f.rows.filter(r=>r.research.horizon===h)))===JSON.stringify(f.counts[h]));
}
