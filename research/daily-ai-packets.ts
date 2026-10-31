import type {AnalysisEvidence,AnalysisPacket} from './daily-ai-analysis.ts';
import {validateAnalysisPacket} from './daily-ai-analysis.ts';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import type {DailyBar,FunnelInput,ResearchFact,Trace} from '../src/features/vnext/researchFunnel.ts';

export type DailyPacketBuild={packets:AnalysisPacket[];cutoff:string;through:string;gaps:Record<string,string[]>};
const finiteValues=(value:unknown):boolean=>typeof value==='number'?Number.isFinite(value):
 Array.isArray(value)?value.every(finiteValues):value!==null&&typeof value==='object'?Object.values(value).every(finiteValues):true;
function retainedEvidence(trace:Trace,symbol:string,kind:'PRICE'|'FINANCIAL',content:unknown):AnalysisEvidence{
 if(!finiteValues(content))throw Error('AI_PACKET_NONFINITE_VALUE');
 if(!trace.first_seen_at||!trace.as_of)throw Error('AI_PACKET_RECEIPT_MISSING');
 return {id:symbol+':'+kind+':'+trace.id,symbol,kind,source:trace.source,
  published_at:trace.published_at,available_at:trace.available_at??'',
  first_seen_at:trace.first_seen_at,as_of:trace.as_of,evidence_hash:trace.evidence_hash,
  time_basis:trace.published_at===null?'OBSERVED_AFTER_RECEIPT':'PUBLISHED',content:JSON.stringify(content)};
}
const factOrder=['REVENUE','INSTITUTIONAL','EPS','MARGIN','CAPEX','DEMAND','MOAT','VALUATION'];
const perKind:Record<string,number>={REVENUE:36,INSTITUTIONAL:10,EPS:4,MARGIN:4,CAPEX:4,DEMAND:1,MOAT:1,VALUATION:1};
function factsFor(input:FunnelInput){
 const groups=new Map<string,ResearchFact[]>();
 for(const fact of input.facts){const group=groups.get(fact.kind)??[];group.push(fact);groups.set(fact.kind,group);}
 const kinds=[...groups.keys()].sort((a,b)=>{
  const ai=factOrder.indexOf(a),bi=factOrder.indexOf(b);
  return (ai<0?factOrder.length:ai)-(bi<0?factOrder.length:bi)||a.localeCompare(b);
 });
 return kinds.flatMap(kind=>groups.get(kind)!.slice().sort((a,b)=>(a.period??'').localeCompare(b.period??'')||a.id.localeCompare(b.id)).slice(-(perKind[kind]??2)));
}
/** Compile retained observations for a new AS_OF review. Original publication
 * nulls, hashes, financial bases and observation times remain unchanged. No
 * HTTP, SQL, model invocation or member publication occurs in this builder. */
export function buildDailyAiPackets(input:{inputs:FunnelInput[];cutoff:string;news:AnalysisEvidence[];market:AnalysisEvidence[]}):DailyPacketBuild{
 if(!validObservationTime(input.cutoff)||input.inputs.length!==72
  ||new Set(input.inputs.map(i=>i.symbol)).size!==72||new Set(input.inputs.map(i=>i.through)).size!==1)throw Error('AI_PACKET_UNIVERSE');
 const through=input.inputs[0].through;
 if(!/^\d{4}-\d\d-\d\d$/.test(through)||!validObservationTime(through+'T13:30:00+08:00')
  ||Date.parse(through+'T13:30:00+08:00')>Date.parse(input.cutoff))throw Error('AI_PACKET_DATA_DATE');
 const universe=new Set(input.inputs.map(i=>i.symbol));
 if(input.news.some(e=>e.kind!=='NEWS'||e.symbol!==null&&!universe.has(e.symbol))
  ||input.market.some(e=>e.kind!=='MARKET'||e.symbol!==null))throw Error('AI_PACKET_SUPPLEMENT_SCOPE');
 const gaps:Record<string,string[]>={};
 const packets=input.inputs.map(stock=>{
  if(!/^\d{4,6}$/.test(stock.symbol)||!stock.company||!stock.company.trim())throw Error('AI_PACKET_COMPANY');
  const stockGaps:string[]=[],dates=stock.expected_sessions.slice(-20);
  if(new Set(dates).size!==dates.length||dates.some((d,i)=>!/^\d{4}-\d\d-\d\d$/.test(d)||i>0&&d<=dates[i-1])
   ||stock.bars.some(b=>stock.bars.filter(other=>other.date===b.date).length>1))throw Error('AI_PACKET_DUPLICATE_SESSION');
  const bars=dates.flatMap(date=>stock.bars.filter(b=>b.date===date));
  if(dates.length!==20||bars.length!==20||dates.at(-1)!==through)stockGaps.push('PRICE_20_SESSION_COVERAGE_MISSING');
  const prices=bars.map((bar:DailyBar)=>{
   if(![bar.open,bar.high,bar.low,bar.close,bar.volume,bar.amount].every(n=>Number.isFinite(n)&&n>0)
    ||bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close))throw Error('AI_PACKET_PRICE');
   return retainedEvidence(bar,stock.symbol,'PRICE',{date:bar.date,open:bar.open,high:bar.high,low:bar.low,close:bar.close,
    volume:bar.volume,amount:bar.amount,session_scope:bar.session_scope,original_id:bar.id});
  });
  const facts=factsFor(stock).map(f=>retainedEvidence(f,stock.symbol,'FINANCIAL',{
   kind:f.kind,period:f.period,basis:f.basis,values:f.values,original_id:f.id}));
  const news=input.news.filter(e=>e.symbol===null||e.symbol===stock.symbol).slice().sort((a,b)=>
   Date.parse(b.published_at??b.available_at)-Date.parse(a.published_at??a.available_at)||a.id.localeCompare(b.id));
  const market=input.market.slice().sort((a,b)=>Date.parse(b.available_at)-Date.parse(a.available_at)||a.id.localeCompare(b.id));
  const retainedNews=news.slice(0,12);
  if(!retainedNews.length)stockGaps.push('NEWS_NOT_CAPTURED_NO_ABSENCE_OF_RISK_CLAIM');
  if(!retainedNews.some(e=>e.symbol===stock.symbol))stockGaps.push('COMPANY_NEWS_NOT_CAPTURED');
  if(!market.length)stockGaps.push('MARKET_CONTEXT_NOT_CAPTURED');
  if(news.length>12||market.length>4)stockGaps.push('SUPPLEMENT_LIMIT_OLDER_ITEMS_NOT_INCLUDED');
  // Up to 84 original observations plus 12 news and 4 market observations.
  // The packet explicitly records omissions; it never claims full news review.
  const company=[...prices,...facts];if(company.length>84)stockGaps.push('COMPANY_EVIDENCE_LIMIT_OLDER_ITEMS_NOT_INCLUDED');
  const evidence=[...company.slice(0,84),...retainedNews,...market.slice(0,4)].map(e=>({...e}));
  if(evidence.some(e=>e.published_at===null))stockGaps.push('ORIGINAL_PUBLICATION_TIME_UNKNOWN_RECEIPT_REVIEW_ONLY');
  const packet={symbol:stock.symbol,company:stock.company,cutoff:input.cutoff,evidence,data_through:through,data_gaps:stockGaps.slice()};
  validateAnalysisPacket(packet);gaps[stock.symbol]=stockGaps;return packet;
 });
 return {packets,cutoff:input.cutoff,through,gaps};
}
