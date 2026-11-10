/** Daily long-horizon review preparation. Source observations and arithmetic
 * are reproducible; a judgment about demand, moat or valuation is still a
 * separately reviewed judgment. This module never emits a DOCUMENTED_REVIEW
 * verdict or changes an existing packet, edition, rights grant or review. */
import {compareTime,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisEvidence,type AnalysisPacket} from './daily-ai-analysis.ts';
import {deriveDailyAiFinancialActuals} from './daily-ai-financial-inputs.ts';
import {calculateDailyAiPricePlan,PriceCalculationError,type LongCalculationInput} from './daily-ai-price-calculation.ts';
import {parseSecQuarterFinancials,type SecQuarterDocument} from './sec-quarter-financials.ts';
import type {ResearchFact} from '../src/features/vnext/researchFunnel.ts';

export const LONG_OBSERVATION_NORMALIZER='SEC_LONG_OBSERVATIONS_V1';
export type LongAnnualDocument={period:string;kind:'annual';url:string;bytes:number;sha256:string;received_at:string;body:string};
type SourceBinding=Omit<SecQuarterDocument,'body'>|Omit<LongAnnualDocument,'body'>;
type OperatingObservation={period:string;revenue_twd_billion:number;revenue_yoy_percent:number;leading_edge_wafer_revenue_percent:number};
type CapabilityObservation={period:string;research_development_twd_million:number;amount_precision:string;
 wafer_capacity_12inch_equivalent_lower_bound:number;capacity_comparison:'GREATER_THAN';competition_and_risk_sections_present:true};
export type LongObservationFact=ResearchFact&{symbol:'2330';source_sha256:string;source_bytes:number;normalizer_version:typeof LONG_OBSERVATION_NORMALIZER;
 source_admitted:false;member_publication_approved:false;source_locator:{section:string;source_bindings:SourceBinding[]}};
export type LongSourceSupplement={schema:'DAILY_AI_LONG_SOURCE_SUPPLEMENT_V1';symbol:'2330';source_cutoff:string;derived_at:string;
 observations:{operating:OperatingObservation[];capability:CapabilityObservation};facts:LongObservationFact[];source_bindings:SourceBinding[];
 source_admitted:false;member_publication_approved:false;admission_status:'PENDING_SOURCE_INTAKE';supplement_hash:string};
type Missing={code:string;field:string;detail:string};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function fail(field:string):never{throw Error('LONG_RATIONALE_INVALID: '+field);}
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;};
const distinct=(v:string[])=>[...new Set(v)];
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const bodyOf=(e:AnalysisEvidence):Record<string,unknown>=>{let v:unknown;try{v=JSON.parse(e.content);}catch{fail('evidence.content');}if(!object(v))fail('evidence.content');return v;};
const decimal=(v:string)=>{const n=Number(v.replaceAll(',',''));if(!Number.isFinite(n))fail('source.number');return n;};
const one=(s:string,re:RegExp)=>{const found=[...s.matchAll(re)];if(found.length!==1)fail('source.ambiguous_locator');return found[0];};
function text(html:string){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<!--[^]*?-->/g,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
 .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,dec)=>{const n=parseInt(hex??dec,hex?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';})
 .replace(/\s+/g,' ').trim();}
function quarter(period:unknown){const m=typeof period==='string'?/^(20\d\d)-Q([1-4])$/.exec(period):null;if(!m)return null;
 const year=Number(m[1]),q=Number(m[2]);return {rank:year*4+q,end:new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10)};}
function time(value:unknown,field:string):string{if(typeof value!=='string'||!validObservationTime(value))fail(field);return value as string;}
function exactKeys(v:Record<string,unknown>,keys:string[],field:string){if(Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail(field);}
function sourceBinding(d:SecQuarterDocument|LongAnnualDocument):SourceBinding{const {body,...binding}=d;void body;return binding;}

/** Only the retained, issuer-identified SEC documents are parsed. New
 * derivations are available at derived_at, never backdated to source receipt.
 * Four quarters are grouped into one observation so the packet builder's
 * bounded per-kind history cannot silently truncate the series to two. */
export async function parseRetained2330LongObservations(args:{quarters:{release:SecQuarterDocument;presentation:SecQuarterDocument}[];
 annual:LongAnnualDocument;source_cutoff:string;derived_at:string}):Promise<LongSourceSupplement>{
 const a=structuredClone(args),cutoff=time(a.source_cutoff,'source_cutoff'),derived=time(a.derived_at,'derived_at');
 if(compareTime(derived,cutoff)<0||a.quarters.length!==4)fail('source.scope');
 const ordered=a.quarters.slice().sort((x,y)=>x.release.period.localeCompare(y.release.period));
 if(ordered.some((x,i)=>!quarter(x.release.period)||i>0&&quarter(x.release.period)!.rank!==quarter(ordered[i-1].release.period)!.rank+1))fail('source.quarters');
 const operating:OperatingObservation[]=[],bindings:SourceBinding[]=[];
 for(const pair of ordered){
  for(const d of [pair.release,pair.presentation])if(compareTime(time(d.received_at,'source.received_at'),cutoff)>0)fail('source.received_after_cutoff');
  await parseSecQuarterFinancials(pair.release,pair.presentation,cutoff);
  const raw=text(pair.release.body),revenue=decimal(one(raw,/announced consolidated revenue of NT\$([\d,]+\.\d{2}) billion/g)[1]);
  const yoy=one(raw,/Year-over-year, (?:first|second|third|fourth) quarter revenue (increased|decreased) (\d+\.\d)%/g);
  const leading=decimal(one(raw,/Advanced technologies, defined as 7-nanometer and more advanced technologies, accounted for (\d+)% of total wafer revenue/g)[1]);
  if(revenue<=0||leading<0||leading>100)fail('source.operating_metrics');
  operating.push({period:pair.release.period,revenue_twd_billion:revenue,revenue_yoy_percent:decimal(yoy[2])*(yoy[1]==='decreased'?-1:1),leading_edge_wafer_revenue_percent:leading});
  bindings.push(sourceBinding(pair.release),sourceBinding(pair.presentation));
 }
 const annual=a.annual,match=/^(20\d\d)-FY$/.exec(annual.period);if(!match)fail('annual.period');const year=Number(match![1]);
 let url:URL;try{url=new URL(annual.url);}catch{fail('annual.url');}
 if(annual.kind!=='annual'||url!.protocol!=='https:'||url!.hostname!=='www.sec.gov'||url!.username||url!.password||url!.port||url!.search||url!.hash
  ||!new RegExp('^/Archives/edgar/data/1046179/\\d{18}/tsm-'+year+'1231\\.htm$').test(url!.pathname)
  ||!Number.isSafeInteger(annual.bytes)||annual.bytes<1||annual.bytes>16*1024*1024||typeof annual.body!=='string'
  ||new TextEncoder().encode(annual.body).length!==annual.bytes||await digest(annual.body)!==annual.sha256
  ||compareTime(time(annual.received_at,'annual.received_at'),cutoff)>0||compareTime(annual.received_at,year+'-12-31T23:59:59+08:00')<=0)fail('annual.source');
 const raw=text(annual.body);
 const rd=one(raw,new RegExp('In '+(year-2)+' , '+(year-1)+' , and '+year+' , we spent NT\\$ ([\\d,]+) million, NT\\$ ([\\d,]+) million, and NT\\$ ([\\d,]+) million \\(US\\$ [\\d,]+ million\\), respectively, on research and development','g'));
 const capacity=[...raw.matchAll(new RegExp('In '+year+' , our annual capacity \\(in 12-inch equivalent wafers\\) exceeded (\\d+(?:\\.\\d+)?) million wafers','g'))];
 const capacities=distinct(capacity.map(m=>m[1]));
 if(capacities.length!==1||!raw.includes('Competition')||!raw.includes('Risks')||decimal(rd[3])<=0||decimal(capacities[0])<=0)fail('annual.locators');
 const capability:CapabilityObservation={period:annual.period,research_development_twd_million:decimal(rd[3]),
  amount_precision:'ROUNDED_ANNUAL_NARRATIVE_MILLIONS_NOT_EXACT_STATEMENT_YUAN',wafer_capacity_12inch_equivalent_lower_bound:decimal(capacities[0])*1e6,
  capacity_comparison:'GREATER_THAN',competition_and_risk_sections_present:true};
 bindings.push(sourceBinding(annual));
 const facts:LongObservationFact[]=[];
 const add=async(kind:string,period:string,basis:string,values:ResearchFact['values'],primary:SecQuarterDocument|LongAnnualDocument,used:SourceBinding[],section:string,as_of:string)=>{
  const firstSeen=used.map(d=>d.received_at).sort(compareTime).at(-1)!;
  const body={symbol:'2330' as const,kind,period,basis,values:{...values,normalizer_version:LONG_OBSERVATION_NORMALIZER,
    source_bindings_json:JSON.stringify(used),classification:'DIRECT_SOURCE_OBSERVATIONS_NOT_DEMAND_OR_MOAT_VERDICT'},
   source:primary.url,published_at:null,first_seen_at:firstSeen,available_at:derived,as_of,source_sha256:primary.sha256,source_bytes:primary.bytes,
   normalizer_version:LONG_OBSERVATION_NORMALIZER as typeof LONG_OBSERVATION_NORMALIZER,source_locator:{section,source_bindings:used},source_admitted:false as const,member_publication_approved:false as const};
  const hash=await snapshotHash(body);facts.push({...body,id:`long-observation:2330:${kind}:${hash}`,evidence_hash:hash});
 };
 const latest=ordered.at(-1)!.release;
 await add('LONG_DEMAND_OBSERVATIONS',latest.period,'FOUR_SINGLE_QUARTER_OBSERVATIONS',{
  observations_json:JSON.stringify(operating),revenue_currency:'TWD',revenue_unit:'BILLION',technology_mix_unit:'PERCENT_OF_WAFER_REVENUE',
  technology_definition:'7_NANOMETER_AND_MORE_ADVANCED_NOT_ALL_COMPANY_REVENUE',future_orders_verified:'FALSE'},latest,bindings.filter(d=>d.kind==='release'),
  'Quarterly revenue, year-over-year change, and advanced-technology wafer revenue mix',quarter(latest.period)!.end+'T23:59:59+08:00');
 await add('LONG_CAPABILITY_OBSERVATIONS',annual.period,'ANNUAL_REPORTED_CONTEXT',{
  research_development_twd_million:capability.research_development_twd_million,amount_precision:capability.amount_precision,
  wafer_capacity_12inch_equivalent_lower_bound:capability.wafer_capacity_12inch_equivalent_lower_bound,capacity_comparison:'GREATER_THAN',
  capacity_unit:'12_INCH_EQUIVALENT_WAFERS_PER_YEAR',competition_and_risk_sections_present:'TRUE',permanent_moat_verified:'FALSE'},annual,[sourceBinding(annual)],
  'Research and Development; Production Capacity; Competition; Risk Factors',year+'-12-31T23:59:59+08:00');
 const out={schema:'DAILY_AI_LONG_SOURCE_SUPPLEMENT_V1' as const,symbol:'2330' as const,source_cutoff:cutoff,derived_at:derived,
  observations:{operating,capability},facts,source_bindings:bindings,source_admitted:false as const,member_publication_approved:false as const,admission_status:'PENDING_SOURCE_INTAKE' as const};
 return freeze({...out,supplement_hash:await snapshotHash(out)});
}

/** Exact projection used by the existing packet compiler. This function only
 * prepares bytes for a new source intake; it never appends them to a packet. */
export function longObservationEvidence(fact:LongObservationFact):AnalysisEvidence{
 return {id:fact.symbol+':FINANCIAL:'+fact.id,symbol:fact.symbol,kind:'FINANCIAL',source:fact.source,published_at:fact.published_at,
  available_at:fact.available_at!,first_seen_at:fact.first_seen_at!,as_of:fact.as_of!,evidence_hash:fact.evidence_hash,time_basis:'OBSERVED_AFTER_RECEIPT',
  content:JSON.stringify({kind:fact.kind,period:fact.period,basis:fact.basis,values:fact.values,original_id:fact.id})};
}
async function supplementScope(s:LongSourceSupplement,packet:AnalysisPacket,asOf:string){
 const {supplement_hash,...body}=s;
 if(s.schema!=='DAILY_AI_LONG_SOURCE_SUPPLEMENT_V1'||s.symbol!==packet.symbol||s.source_admitted!==false||s.member_publication_approved!==false
  ||s.admission_status!=='PENDING_SOURCE_INTAKE'||await snapshotHash(body)!==supplement_hash||!Array.isArray(s.facts)||s.facts.length!==2
  ||compareTime(time(s.derived_at,'supplement.derived_at'),asOf)>0||compareTime(time(s.source_cutoff,'supplement.source_cutoff'),s.derived_at)>0)fail('supplement');
 const pending:string[]=[];
 for(const fact of s.facts){const {id,evidence_hash,...preimage}=fact;
  if(await snapshotHash(preimage)!==evidence_hash||id!==`long-observation:2330:${fact.kind}:${evidence_hash}`||fact.symbol!==packet.symbol
   ||fact.available_at!==s.derived_at||fact.source_admitted!==false||fact.member_publication_approved!==false)fail('supplement.fact');
  const expected=longObservationEvidence(fact),found=packet.evidence.find(e=>e.id===expected.id);
  if(found&&await snapshotHash(found)!==await snapshotHash(expected))fail('supplement.packet_binding');
  if(!found)pending.push(expected.id);
 }
 return pending;
}
function readOperating(rows:{e:AnalysisEvidence;body:Record<string,unknown>}[],through:string){
 const latest=rows.filter(r=>r.body.kind==='LONG_DEMAND_OBSERVATIONS').sort((a,b)=>String(a.body.period).localeCompare(String(b.body.period))).at(-1);
 if(!latest)return null;
 if(rows.filter(r=>r.body.kind==='LONG_DEMAND_OBSERVATIONS'&&r.body.period===latest.body.period).length!==1)fail('operating.ambiguous_period');
 const v=latest.body.values;if(!object(v)||latest.body.basis!=='FOUR_SINGLE_QUARTER_OBSERVATIONS'||v.normalizer_version!==LONG_OBSERVATION_NORMALIZER
  ||v.revenue_currency!=='TWD'||v.technology_mix_unit!=='PERCENT_OF_WAFER_REVENUE'||typeof v.observations_json!=='string')fail('operating.basis');
 let array:unknown;try{array=JSON.parse(v.observations_json);}catch{fail('operating.json');}
 if(!Array.isArray(array)||array.length!==4)fail('operating.quarters');
 const out=array as OperatingObservation[];
 for(let i=0;i<out.length;i++){const row=out[i];if(!object(row))fail('operating.row');
  exactKeys(row,['period','revenue_twd_billion','revenue_yoy_percent','leading_edge_wafer_revenue_percent'],'operating.keys');
  const q=quarter(row.period);if(!q||q.end>through||i>0&&q.rank!==quarter(out[i-1].period)!.rank+1||!finite(row.revenue_twd_billion)||row.revenue_twd_billion<=0
   ||!finite(row.revenue_yoy_percent)||row.revenue_yoy_percent< -100||!finite(row.leading_edge_wafer_revenue_percent)||row.leading_edge_wafer_revenue_percent<0||row.leading_edge_wafer_revenue_percent>100)fail('operating.values');
 }
 if(latest.body.period!==out.at(-1)!.period)fail('operating.period');return {observations:out,evidence_ids:[latest.e.id]};
}
function readCapability(rows:{e:AnalysisEvidence;body:Record<string,unknown>}[],through:string){
 const latest=rows.filter(r=>r.body.kind==='LONG_CAPABILITY_OBSERVATIONS').sort((a,b)=>String(a.body.period).localeCompare(String(b.body.period))).at(-1);
 if(!latest)return null;const v=latest.body.values,m=/^(20\d\d)-FY$/.exec(String(latest.body.period));
 if(rows.filter(r=>r.body.kind==='LONG_CAPABILITY_OBSERVATIONS'&&r.body.period===latest.body.period).length!==1)fail('capability.ambiguous_period');
 if(!m||m[1]+'-12-31'>through||latest.body.basis!=='ANNUAL_REPORTED_CONTEXT'||!object(v)||v.normalizer_version!==LONG_OBSERVATION_NORMALIZER
  ||!finite(v.research_development_twd_million)||v.research_development_twd_million<=0||!finite(v.wafer_capacity_12inch_equivalent_lower_bound)
  ||v.wafer_capacity_12inch_equivalent_lower_bound<=0||v.capacity_comparison!=='GREATER_THAN'||v.capacity_unit!=='12_INCH_EQUIVALENT_WAFERS_PER_YEAR')fail('capability.basis');
 return {period:String(latest.body.period),research_development_twd_million:v.research_development_twd_million,
  wafer_capacity_12inch_equivalent_lower_bound:v.wafer_capacity_12inch_equivalent_lower_bound,capacity_comparison:'GREATER_THAN' as const,evidence_ids:[latest.e.id]};
}
function monthlyDemand(rows:{e:AnalysisEvidence;body:Record<string,unknown>}[],through:string){
 const selected=rows.filter(r=>r.body.kind==='REVENUE').sort((a,b)=>String(a.body.period).localeCompare(String(b.body.period))).slice(-3);
 if(selected.length!==3)return null;const values:{period:string;yoy_percent:number;evidence_id:string}[]=[];let prior:number|null=null;
 for(const r of selected){const m=/^(20\d\d)-(0[1-9]|1[0-2])$/.exec(String(r.body.period)),v=r.body.values;
  if(!m||r.body.basis!=='MONTHLY'||!object(v)||!finite(v.yoy_percent))return null;
  const rank=Number(m[1])*12+Number(m[2]),end=new Date(Date.UTC(Number(m[1]),Number(m[2]),0)).toISOString().slice(0,10);
  if(end>through||prior!==null&&rank!==prior+1)return null;prior=rank;values.push({period:String(r.body.period),yoy_percent:v.yoy_percent,evidence_id:r.e.id});
 }
 return {observations:values,evidence_ids:values.map(v=>v.evidence_id)};
}

export async function prepareDailyAiLongRationale(args:{packet:AnalysisPacket;calculation_input?:LongCalculationInput|null;
 source_supplement?:LongSourceSupplement|null;as_of:string;expires_at:string;now?:number}){
 const a=structuredClone(args),p=a.packet,now=a.now??Date.now(),asOf=time(a.as_of,'as_of'),expiry=time(a.expires_at,'expires_at');
 validateAnalysisPacket(p);if(!p.data_through||!Number.isFinite(now)||compareTime(p.cutoff,asOf)>0||compareTime(asOf,new Date(now).toISOString())>0
  ||compareTime(expiry,new Date(now).toISOString())<=0)fail('time');
 for(const e of p.evidence)if(compareTime(e.available_at,p.cutoff)>0||e.published_at!==null&&compareTime(e.published_at,e.available_at)>0
  ||e.first_seen_at!==undefined&&compareTime(e.first_seen_at,e.available_at)>0||e.as_of!==undefined&&compareTime(e.as_of,e.available_at)>0)fail('evidence.time');
 const packetHash=await snapshotHash(p),actuals=await deriveDailyAiFinancialActuals({packet:p});
 const rows=p.evidence.filter(e=>e.kind==='FINANCIAL'&&e.symbol===p.symbol).map(e=>({e,body:bodyOf(e)}));
 const quoteRows=p.evidence.filter(e=>e.kind==='PRICE'&&e.symbol===p.symbol).map(e=>({e,body:bodyOf(e)})).filter(r=>r.body.date===p.data_through);
 if(quoteRows.length>1||quoteRows.length===1&&(!finite(quoteRows[0].body.close)||quoteRows[0].body.close<=0))fail('quote');
 const priceObservation=quoteRows.length===1?{date:p.data_through,close:quoteRows[0].body.close,evidence_id:quoteRows[0].e.id,
  source:quoteRows[0].e.source,available_at:quoteRows[0].e.available_at,scope:'RETAINED_PACKET_AS_OF_CUTOFF_NOT_REALTIME'}:null;
 const officialValuation=rows.filter(r=>r.body.kind==='VALUATION_AS_REPORTED').sort((a,b)=>String(a.body.period).localeCompare(String(b.body.period))).slice(-2)
  .map(r=>({period:r.body.period,values:r.body.values,evidence_id:r.e.id,source:r.e.source,available_at:r.e.available_at,
   scope:'ORIGINAL_REPORTED_RATIOS_NOT_MULTIPLE_ENDORSEMENT_OR_RECONSTRUCTED_EPS'}));
 const operating=readOperating(rows,p.data_through),capability=readCapability(rows,p.data_through),monthly=monthlyDemand(rows,p.data_through);
 const pending=a.source_supplement?await supplementScope(a.source_supplement,p,asOf):[];
 const missing:Missing[]=[],add=(code:string,field:string,detail:string)=>missing.push({code,field,detail});
 if(!actuals.reported_four_quarter_diluted_eps_sum)missing.push(...actuals.missing.MEDIUM);
 if(!actuals.cashflow_actuals)add('LONG_CASHFLOW_OBSERVATIONS_REQUIRED','CAPEX','Require four same-period reported operating cash and capex observations. Issuer FCF is not common-share FCFE.');
 const epsPeriods=actuals.reported_four_quarter_diluted_eps_sum?.quarters.map(q=>q.period)??[];
 if(operating&&epsPeriods.length===4&&operating.observations.some((o,i)=>o.period!==epsPeriods[i]))
  add('LONG_OPERATING_EARNINGS_PERIOD_MISMATCH','LONG_DEMAND_OBSERVATIONS','The operating series must cover the same four quarters as the historical EPS basis; do not silently use an older favorable window.');
 const margins=rows.filter(r=>r.body.kind==='MARGIN'&&epsPeriods.includes(String(r.body.period))).sort((a,b)=>String(a.body.period).localeCompare(String(b.body.period)));
 const completeMargins=margins.length===4&&margins.every((r,i)=>r.body.period===epsPeriods[i]&&r.body.basis==='SINGLE_QUARTER'&&object(r.body.values)
  &&r.body.values.unit==='PERCENT'&&finite(r.body.values.value)&&r.body.values.value>=0&&r.body.values.value<=100);
 if(!completeMargins)add('LONG_FOUR_QUARTER_MARGINS_REQUIRED','MARGIN','Four comparable margins must match the EPS quarter window.');
 if(!operating&&!monthly)add('LONG_DEMAND_OBSERVATIONS_REQUIRED','DEMAND','Supply consecutive reported monthly revenues or parsed quarterly operating observations; do not renew a prior demand verdict.');
 if(!operating)add('LONG_TECHNOLOGY_MIX_OBSERVATIONS_REQUIRED','MOAT','Advanced-technology wafer revenue is a separate source observation, not a claim inferred from profitability.');
 if(!capability)add('LONG_CAPABILITY_OBSERVATIONS_REQUIRED','MOAT','Retain issuer R&D and capacity observations with the annual period; an economic moat still requires a documented judgment.');
 let calculation:Awaited<ReturnType<typeof calculateDailyAiPricePlan>>|null=null;
 if(a.calculation_input){const input=a.calculation_input;
  if(input.horizon!=='LONG'||input.symbol!==p.symbol||input.cutoff!==p.cutoff||input.data_through!==p.data_through
   ||await snapshotHash(input.evidence)!==await snapshotHash(p.evidence)||compareTime(input.as_of,asOf)>0||compareTime(expiry,input.expires_at)>0)fail('calculation.packet_binding');
  try{calculation=await calculateDailyAiPricePlan(input,now);}
  catch(error){if(!(error instanceof PriceCalculationError)||!['PRICE_CALCULATION_MISSING_INPUT','PRICE_CALCULATION_SOURCE_MISSING',
    'PRICE_CALCULATION_STALE_QUOTE','PRICE_CALCULATION_CALENDAR','PRICE_CALCULATION_REPORTED_EPS_BASIS'].includes(error.code))throw error;
   add(error.code,'calculation.'+error.field,error.message);}
 }else add('LONG_CURRENT_PRICE_CALCULATION_REQUIRED','VALUATION','Provide the exact current packet-bound long calculation input. No old price, PE, forecast or review is substituted.');
 const marginValues=completeMargins?margins.map(r=>({period:String(r.body.period),gross_margin_percent:(r.body.values as Record<string,number>).value,evidence_id:r.e.id})):[];
 const comparison=calculation?{quote:calculation.trace.quote,entry_range:calculation.entry_range,wait_above:calculation.wait_above,
  relation:Number(calculation.trace.quote)<calculation.entry_range[0]?'BELOW_SELECTED_RANGE':Number(calculation.trace.quote)>calculation.entry_range[1]?'ABOVE_SELECTED_RANGE':'WITHIN_SELECTED_RANGE',
  is_execution_instruction:false}:null;
 const reviewItems=[
  {kind:'DEMAND',review_status:'REVIEW_REQUIRED',verdict:null,
   observation_status:operating||monthly?'AVAILABLE_IN_PACKET':'SOURCE_REQUIRED',
   evidence_ids:distinct([...(operating?.evidence_ids??[]),...(monthly?.evidence_ids??[])]),
   observations:{quarterly:operating?.observations??null,monthly:monthly?.observations??null},
   rationale_zh:'已實現營收變化與產品組合可供判斷需求是否持續；年增不等於未來訂單或多年需求保證。',
   judgment_required_zh:'核對成長的產品、客戶與景氣原因，決定此期限的需求假設是否得到支持。'},
  {kind:'MOAT',review_status:'REVIEW_REQUIRED',verdict:null,
   observation_status:operating&&capability?'AVAILABLE_IN_PACKET':'SOURCE_REQUIRED',
   evidence_ids:distinct([...(operating?.evidence_ids??[]),...(capability?.evidence_ids??[]),...marginValues.map(m=>m.evidence_id)]),
   observations:{technology_mix:operating?.observations.map(o=>({period:o.period,leading_edge_wafer_revenue_percent:o.leading_edge_wafer_revenue_percent}))??null,
    annual_capability:capability,margins:marginValues},
   rationale_zh:'研發投入、產能和先進製程實際收入是可核對的能力指標；投入規模或高毛利本身不能證明持續超額報酬。',
   judgment_required_zh:'比較競爭、客戶集中、技術替代及資本負擔，形成有反例與有效期的競爭優勢判斷。'},
  {kind:'VALUATION',review_status:'REVIEW_REQUIRED',verdict:null,
   observation_status:calculation?'CALCULATED_FROM_CURRENT_PACKET':'CALCULATION_REQUIRED',
   evidence_ids:calculation?.evidence_ids??[],observations:comparison,
   calculation_hash:calculation?.calculation_hash??null,method_id:calculation?.method_id??a.calculation_input?.method_id??null,
   rationale_zh:'股價與明示情境的折讓區間逐次比較；股利、成長、要求報酬與末期本益比是假設，不能從來源原報本益比自動宣告便宜。',
   judgment_required_zh:'審查當次方法與參數、情境選取及末期價值占比，再對這個 calculation_hash 作出判斷。'},
 ];
 const oldReviews=rows.filter(r=>['DEMAND','MOAT','VALUATION'].includes(String(r.body.kind))).map(r=>r.e.id);
 const body={schema:'DAILY_AI_LONG_REVIEW_PREPARATION_V1' as const,symbol:p.symbol,horizon:'LONG' as const,
  status:missing.length?'DATA_REQUIRED_REVIEW_PREPARATION':'READY_FOR_REVIEW',as_of:asOf,expires_at:expiry,cutoff:p.cutoff,data_through:p.data_through,
  packet_hash:packetHash,actuals_hash:actuals.actuals_hash,price_observation:priceObservation,official_valuation_observations:officialValuation,
  financial_observations:{reported_eps:actuals.reported_four_quarter_diluted_eps_sum,
   reported_cashflow:actuals.cashflow_actuals,margins:marginValues,common_share_fcfe:null},review_items:reviewItems,
  valuation_calculation:calculation?{calculation_hash:calculation.calculation_hash,input_hash:calculation.input_hash,assumption_hash:calculation.assumption_hash,
   method_id:calculation.method_id,trace:calculation.trace,method_note:calculation.method_note}:null,
  missing,pending_source_intake:pending,source_supplement_hash:a.source_supplement?.supplement_hash??null,
  existing_review_context:{evidence_ids:oldReviews,state:'NOT_REUSED_FOR_NEW_JUDGMENT'},
  limitations:['OBSERVATIONS_ARE_NOT_REVIEW_VERDICTS','NO_AUTOMATIC_DEMAND_MOAT_OR_VALUATION_SUPPORTED',
   'ANNUAL_CAPABILITY_PERIOD_IS_NOT_ROLLED_TO_CURRENT_QUARTER','ISSUER_REPORTED_FCF_IS_NOT_COMMON_SHARE_FCFE',
   ...(completeMargins&&marginValues.at(-1)!.gross_margin_percent<marginValues.at(-2)!.gross_margin_percent?['LATEST_MARGIN_BELOW_PREVIOUS_QUARTER']:[]),
   ...actuals.missing.LONG.map(m=>m.code)],
  review:null,selection_qualified:false,methodology_approved:false,source_admitted:false,member_published:false,forecast:false,performance_available:false};
 return freeze({...body,preparation_hash:await snapshotHash(body)});
}
