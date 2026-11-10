import {compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';
import {hashDailyAiPricePlanBody} from './dailyAiPricePlan.ts';
import type {DailyAiOwnerPriceRow} from './dailyAiOwnerPricePlans.ts';

type JsonObject=Record<string,unknown>;
export type OwnerCalculationSource=Readonly<{id:string;kind:string;source:string;available_at:string;published_at:string|null;
 first_seen_at:string|null;as_of:string|null;evidence_hash:string;content:string}>;
export type OwnerCalculationScenario=Readonly<{name:string;value:number;eps:number|null;pe:number|null;discount_rate:number|null;
 explicit_period_pv:number|null;cashflows:readonly Readonly<{year:number;fcfe:number;present_value:number}>[];
 terminal:null|Readonly<{next_fcfe:number;growth:number;undiscounted_value:number;present_value:number;fraction:number}>;
 dividend:null|Readonly<{base_eps:number;required_return:number;terminal_pe:number;dividend_present_value:number;
  years:readonly Readonly<{year:number;growth_rate:number;payout_ratio:number;eps:number;dividend:number;present_value:number}>[];
  terminal:Readonly<{year:number;eps:number;pe:number;value:number;present_value:number;fraction:number}>}>}>;
export type OwnerCalculationDetails=Readonly<{input_hash:string;calculation_hash:string;
 entry_range:readonly [number,number];wait_above:number;invalidation:string;
 recorded_at:string;symbol:string;horizon:Horizon;method_id:string;cutoff:string;data_through:string;as_of:string;expires_at:string;
 assumptions_at:string;assumptions_after_cutoff:boolean;quote:number;derivation:string;assumptions:readonly string[];limitations:readonly string[];
 assumption_description:string;dilution_description:string|null;forecast_period:Readonly<{start:string;end:string}>|null;earnings_basis:string|null;
 reported_eps:null|Readonly<{value:number;reported_sum_decimal:string;period:Readonly<{start:string;end:string}>;
  quarters:readonly Readonly<{period:string;value:number;reported_decimal:string;evidence_id:string}>[]}>;
 scenarios:readonly OwnerCalculationScenario[];selection:null|Readonly<{entry_scenarios:readonly string[];margin_of_safety:number}>;
 short:null|Readonly<{bar_window:readonly string[];true_ranges:readonly number[];atr_period:number;breakout_lookback:number;atr:number;
  prior_window_high:number;entry_atr_width:number;stop_atr_multiple:number;tick_size:number;corporate_actions_evidence_id:string}>;
 sources:readonly OwnerCalculationSource[];raw:Readonly<{input_text:string;calculation_text:string}>}>;
export type OwnerPriceCalculationAudit=OwnerCalculationDetails&Readonly<{batch_id:string;method_note_hash:string;review_request_hash:string;
 raw:OwnerCalculationDetails['raw']&Readonly<{method_note_text:string;review_request_text:string}>}>;
export type DailyAiOwnerPriceCalculation=Readonly<{schema:'DAILY_AI_OWNER_PRICE_CALCULATION_V1';edition_id:string;plan_hash:string;
 subject_user_id:string;research_only:true;preview_only:true;audit:OwnerPriceCalculationAudit|null}>;

function fail(code:string):never{throw Error('OWNER_PRICE_CALCULATION_'+code);}
const object=(v:unknown):JsonObject=>{if(v===null||typeof v!=='object'||Array.isArray(v))return fail('OBJECT');return v as JsonObject;};
const exact=(v:JsonObject,keys:readonly string[])=>{if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail('FIELDS');};
const text=(v:unknown,max=1500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)return fail('TEXT');return v;};
const hash=(v:unknown)=>{const h=text(v,64);if(!hashValid(h))fail('HASH');return h;};
const time=(v:unknown)=>{const t=text(v,40);if(!validObservationTime(t))fail('TIME');return t;};
const date=(v:unknown)=>{const d=text(v,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)fail('DATE');return d;};
const number=(v:unknown,positive=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||positive&&v<=0)return fail('NUMBER');return v;};
const strings=(v:unknown,max=100)=>{if(!Array.isArray(v)||!v.length||v.length>max)return fail('ARRAY');return v.map(x=>text(x,10000));};
const same=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))fail('BINDING');};
const frozen=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const methods:Record<Horizon,string>={SHORT:'SHORT_ATR_CONDITIONAL_V1',MEDIUM:'MEDIUM_EPS_PE_SCENARIOS_V1',LONG:'LONG_FCFE_DISCOUNT_SCENARIOS_V1'};
const dividendMethod='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1';
async function readDocument(raw:unknown,expectedHash:unknown,maxBytes:number):Promise<{text:string;hash:string;value:JsonObject}>{
 const document=text(raw,maxBytes),digest=hash(expectedHash),bytes=new TextEncoder().encode(document);
 if(bytes.byteLength>maxBytes)fail('SIZE');
 const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==digest)fail('HASH_MISMATCH');
 let parsed:unknown;try{parsed=JSON.parse(document);}catch{return fail('JSON');}
 const value=object(parsed);
 // The input producer saves canonical text. A valid raw digest alone must not
 // turn a different object representation into a matching input commitment.
 if(await snapshotHash(value)!==digest)fail('CANONICAL_HASH');
 return {text:document,hash:digest,value};
}

/** Verifies a retained calculation without requiring or inventing a price plan.
 * Both Owner readers share this evidence/trace projection; neither reader runs
 * the pricing model, issues approval, or changes member-visible prices. */
export async function parseDailyAiOwnerCalculationDocuments(record:{input_hash:unknown;input_text:unknown;calculation_hash:unknown;calculation_text:unknown;recorded_at:unknown},
 expected:{symbol:string;horizon:Horizon},now=Date.now()):Promise<{input:JsonObject;calculation:JsonObject;details:OwnerCalculationDetails}>{
 const a=structuredClone(record),scope=structuredClone(expected),recorded=time(a.recorded_at),current=new Date(now).toISOString();
 const input=await readDocument(a.input_text,a.input_hash,1500000),calculation=await readDocument(a.calculation_text,a.calculation_hash,200000);
 const i=input.value,c=calculation.value;
 if(i.schema!=='DAILY_AI_PRICE_CALCULATION_INPUT_V1'||c.schema!=='DAILY_AI_PRICE_CALCULATION_V1'
  ||c.status!=='CALCULATED_REVIEW_REQUIRED'||c.input_hash!==input.hash||c.research_only!==true||c.production_eligible!==false
  ||c.buy_ready!==false||c.review!==null||c.analysis_mode!=='AS_OF_RESEARCH'||c.forecast!==false||c.performance_available!==false)fail('CALCULATION_STATE');
 if(c.symbol!==scope.symbol||c.horizon!==scope.horizon||c.currency!=='TWD')fail('CALCULATION_SCOPE');
 const methodId=text(c.method_id,200);if(methodId!==methods[scope.horizon]&&!(scope.horizon==='LONG'&&methodId===dividendMethod)||c.method!==methodId||i.method_id!==methodId)fail('METHOD');
 for(const key of ['symbol','horizon','currency','cutoff','data_through','as_of','expires_at'] as const)same(i[key],c[key]);
 const cutoff=time(c.cutoff),asOf=time(c.as_of),expiry=time(c.expires_at),through=date(c.data_through),assumption=object(i.assumption_basis),parameters=object(i.parameters);
 const assumptionAt=time(assumption.available_at),assumptionHash=hash(c.assumption_hash);
 if(compareTime(cutoff,asOf)>0||compareTime(asOf,recorded)>0||compareTime(recorded,current)>0||compareTime(asOf,expiry)>=0||compareTime(assumptionAt,asOf)>0)fail('CHRONOLOGY');
 if(await snapshotHash({method_id:methodId,assumption_basis:assumption,parameters})!==assumptionHash)fail('ASSUMPTION_BINDING');
 if(!Array.isArray(c.entry_range)||c.entry_range.length!==2)fail('PRICES');
 const entryRange:[number,number]=[number(c.entry_range[0],true),number(c.entry_range[1],true)],waitAbove=number(c.wait_above,true);
 if(entryRange[0]>entryRange[1]||waitAbove!==entryRange[1]||scope.horizon!=='SHORT'&&(c.stop_kind!=='EVENT'||c.stop!==null))fail('PRICES');
 const evidenceIds=strings(c.evidence_ids,2000);if(new Set(evidenceIds).size!==evidenceIds.length)fail('EVIDENCE_DUPLICATE');
 const originalNote=object(c.method_note);exact(originalNote,['name','derivation','assumptions','limitations','source_use_scope']);
 if(originalNote.name!==methodId||originalNote.source_use_scope!=='PRIVATE_RESEARCH_ONLY')fail('METHOD_NOTE');
 const derivation=text(originalNote.derivation,16000),assumptions=strings(originalNote.assumptions),limitations=strings(originalNote.limitations);
 const evidence=i.evidence;if(!Array.isArray(evidence)||!evidence.length||evidence.length>2000)fail('EVIDENCE');
 const sourcesById=new Map<string,JsonObject>();for(const raw of evidence){const source=object(raw),id=text(source.id,200);if(sourcesById.has(id))fail('EVIDENCE_DUPLICATE');sourcesById.set(id,source);}
 const bindings=c.evidence_bindings;if(!Array.isArray(bindings)||bindings.length!==evidenceIds.length)fail('EVIDENCE_BINDINGS');
 const sourceRows:OwnerCalculationSource[]=[],seen=new Set<string>();
 for(const raw of bindings){
  const b=object(raw);exact(b,['id','evidence_hash']);const id=text(b.id,200),source=sourcesById.get(id),sourceHash=hash(b.evidence_hash);
  if(!source||seen.has(id)||!evidenceIds.includes(id)||source.symbol!==scope.symbol||await snapshotHash(source)!==sourceHash)fail('EVIDENCE_BINDING');seen.add(id);
  const url=text(source.source,4000),kind=text(source.kind,30),available=time(source.available_at);
  if(!sourceSafe(url)||!['PRICE','FINANCIAL','MARKET','NEWS'].includes(kind)||compareTime(available,cutoff)>0)fail('EVIDENCE_SOURCE');
  const optionalTime=(key:string)=>source[key]===undefined||source[key]===null?null:time(source[key]);
  const published=optionalTime('published_at'),firstSeen=optionalTime('first_seen_at'),observed=optionalTime('as_of');
  if([published,firstSeen,observed].some(t=>t!==null&&compareTime(t,available)>0))fail('EVIDENCE_TIME');
  sourceRows.push({id,kind,source:url,available_at:available,published_at:published,first_seen_at:firstSeen,as_of:observed,evidence_hash:sourceHash,content:text(source.content,1500000)});
 }
 const trace=object(c.trace),temporal=object(trace.temporal_scope),after=compareTime(assumptionAt,cutoff)>0;
 const quoteId=text(i.quote_evidence_id,200),quoteSource=sourcesById.get(quoteId);
 if(!quoteSource||!seen.has(quoteId)||quoteSource.kind!=='PRICE')fail('QUOTE_BINDING');
 let rawQuote:unknown;try{rawQuote=JSON.parse(text(quoteSource.content,1500000));}catch{return fail('QUOTE_BINDING');}
 const quote=object(rawQuote);
 if(quote.date!==through||quote.close!==trace.quote||quote.currency!==undefined&&quote.currency!=='TWD'
  ||quote.price_basis!==undefined&&quote.price_basis!=='RAW_UNADJUSTED')fail('QUOTE_BINDING');
 if(temporal.source_cutoff!==cutoff||temporal.assumptions_available_at!==assumptionAt||temporal.calculation_as_of!==asOf
  ||temporal.assumption_timing!==(after?'ASSUMPTIONS_FORMED_AFTER_SOURCE_CUTOFF':'ASSUMPTIONS_AVAILABLE_BY_SOURCE_CUTOFF'))fail('TEMPORAL_SCOPE');
 let short:OwnerCalculationDetails['short']=null,selection:OwnerCalculationDetails['selection']=null,forecast:OwnerCalculationDetails['forecast_period']=null;
 let dilution:string|null=null,earnings:string|null=null,reported:OwnerCalculationDetails['reported_eps']=null;const scenarios:OwnerCalculationScenario[]=[];
 if(scope.horizon==='SHORT'){
  const days=strings(trace.bar_window,250).map(date),ranges=trace.true_ranges;if(!Array.isArray(ranges)||!ranges.length||ranges.length>250)fail('SHORT_TRACE');
  same(days,parameters.expected_sessions);same(trace.corporate_actions_evidence_id,parameters.corporate_actions_evidence_id);
  same(trace.trigger,entryRange[0]);same(trace.upper,entryRange[1]);same(trace.stop,c.stop);
  short={bar_window:days,true_ranges:ranges.map(v=>number(v)),atr_period:number(parameters.atr_period,true),breakout_lookback:number(parameters.breakout_lookback,true),
   atr:number(trace.atr,true),prior_window_high:number(trace.prior_window_high,true),entry_atr_width:number(parameters.entry_atr_width),
   stop_atr_multiple:number(parameters.stop_atr_multiple,true),tick_size:number(parameters.tick_size,true),corporate_actions_evidence_id:text(trace.corporate_actions_evidence_id,200)};
 }else{
  const d=object(trace.dilution_basis);same(trace.dilution_basis,parameters.dilution_basis);dilution=text(d.description);
  const s=object(trace.selection);same(s.entry_scenarios,parameters.entry_scenarios);same(s.margin_of_safety,parameters.margin_of_safety);
  const names=strings(s.entry_scenarios,2),margin=number(s.margin_of_safety);if(names.length!==2||margin<0||margin>=1)fail('SELECTION');
  selection={entry_scenarios:names,margin_of_safety:margin};
  if(!Array.isArray(trace.scenarios)||trace.scenarios.length!==3||!Array.isArray(parameters.scenarios)||parameters.scenarios.length!==3)fail('SCENARIOS');
  if(scope.horizon==='MEDIUM'){const p=object(trace.forecast_period);same(trace.forecast_period,parameters.forecast_period);same(trace.earnings_basis,parameters.earnings_basis);
   forecast={start:date(p.start),end:date(p.end)};earnings=text(trace.earnings_basis,100);}
  else if(methodId===dividendMethod){same(trace.earnings_period,parameters.earnings_period);same(trace.earnings_basis,parameters.earnings_basis);earnings=text(trace.earnings_basis,100);}
  if(earnings==='REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM'){
   const sum=object(trace.reported_eps_sum),period=object(sum.period);
   if(sum.basis!==earnings||sum.currency!=='TWD'||sum.unit!=='TWD_PER_COMMON_SHARE'||sum.issuer_reported_ttm!==false
    ||sum.weighted_denominator_recomputed!==false||sum.forecast!==false||!Array.isArray(sum.quarters)||sum.quarters.length!==4)fail('REPORTED_EPS');
   same(trace.earnings_period,sum.period);if(scope.horizon==='MEDIUM'&&(trace.period_field_semantics!=='HISTORICAL_EARNINGS_PERIOD_NOT_FORECAST'||JSON.stringify(trace.forecast_period)!==JSON.stringify(sum.period)))fail('REPORTED_EPS_PERIOD');
   const quarters=sum.quarters.map(raw=>{const q=object(raw),id=text(q.evidence_id,200),source=sourcesById.get(id);
    if(!source||!seen.has(id)||source.kind!=='FINANCIAL')fail('REPORTED_EPS_SOURCE');
    let rawContent:unknown;try{rawContent=JSON.parse(text(source.content,1500000));}catch{return fail('REPORTED_EPS_SOURCE');}
    const content=object(rawContent),values=object(content.values),period=text(q.period,7),reportedDecimal=text(q.reported_decimal,100),value=number(q.value);
    if(!/^\d{4}-Q[1-4]$/.test(period)||content.kind!=='EPS'||content.basis!=='SINGLE_QUARTER'||content.period!==period
     ||values.measurement_basis!=='DILUTED'||values.unit!=='TWD_PER_COMMON_SHARE'||values.value!==value||(values.reported_decimal??String(values.value))!==reportedDecimal)fail('REPORTED_EPS_SOURCE');
    return {period,value,reported_decimal:reportedDecimal,evidence_id:id};});
   same(sum.evidence_ids,quarters.map(q=>q.evidence_id));if(new Set(quarters.map(q=>q.evidence_id)).size!==4)fail('REPORTED_EPS_SOURCE');
   reported={value:number(sum.value,true),reported_sum_decimal:text(sum.reported_sum_decimal,100),period:{start:date(period.start),end:date(period.end)},quarters};
  }else if(methodId===dividendMethod)fail('REPORTED_EPS');
  for(let index=0;index<3;index++){
   const scenario=object(trace.scenarios[index]),parameter=object(parameters.scenarios[index]),name=text(scenario.name,20),value=number(scenario.value,true);
   if(name!==['conservative','base','upside'][index]||name!==parameter.name)fail('SCENARIO_IDENTITY');
   if(scope.horizon==='MEDIUM'){same(scenario.eps,parameter.eps);same(scenario.pe,parameter.pe);
    scenarios.push({name,value,eps:number(scenario.eps,true),pe:number(scenario.pe,true),discount_rate:null,explicit_period_pv:null,cashflows:[],terminal:null,dividend:null});
   }else if(methodId===dividendMethod){
    if(!reported||scenario.base_reported_eps!==reported.value)fail('DIVIDEND_BASE');
    same(scenario.eps_growth_rates,parameter.eps_growth_rates);same(scenario.payout_ratios,parameter.payout_ratios);same(scenario.required_return,parameter.required_return);same(scenario.terminal_pe,parameter.terminal_pe);
    const years=scenario.years,growth=parameter.eps_growth_rates,payout=parameter.payout_ratios;
    if(!Array.isArray(years)||!years.length||years.length>10||!Array.isArray(growth)||!Array.isArray(payout)||years.length!==growth.length||years.length!==payout.length)fail('DIVIDEND_YEARS');
    const yearly=years.map((raw,index)=>{const y=object(raw);if(y.year!==index+1||y.growth_rate!==growth[index]||y.payout_ratio!==payout[index])fail('DIVIDEND_YEAR_BINDING');
     return {year:index+1,growth_rate:number(y.growth_rate),payout_ratio:number(y.payout_ratio),eps:number(y.eps,true),dividend:number(y.dividend),present_value:number(y.dividend_present_value)};});
    const terminal=object(scenario.terminal);if(terminal.year!==years.length||terminal.pe!==parameter.terminal_pe)fail('DIVIDEND_TERMINAL');
    scenarios.push({name,value,eps:null,pe:null,discount_rate:null,explicit_period_pv:null,cashflows:[],terminal:null,
     dividend:{base_eps:reported.value,required_return:number(scenario.required_return,true),terminal_pe:number(scenario.terminal_pe,true),dividend_present_value:number(scenario.dividend_present_value),years:yearly,
      terminal:{year:years.length,eps:number(terminal.eps,true),pe:number(terminal.pe,true),value:number(terminal.value,true),present_value:number(terminal.present_value,true),fraction:number(scenario.terminal_fraction)}}});
   }else{
    same(scenario.discount_rate,parameter.discount_rate);const flows=scenario.discounted_cashflows,values=parameter.cashflows;
    if(!Array.isArray(flows)||!flows.length||flows.length>50||!Array.isArray(values)||values.length!==flows.length)fail('CASHFLOWS');
    const cashflows=flows.map((raw,index)=>{const f=object(raw);if(f.year!==index+1||f.fcfe!==values[index])fail('CASHFLOW_BINDING');
     return {year:index+1,fcfe:number(f.fcfe),present_value:number(f.present_value)};});
    let terminal:OwnerCalculationScenario['terminal']=null;
    if(scenario.terminal!==null){const t=object(scenario.terminal),supplied=object(parameter.terminal);same(t.next_fcfe,supplied.next_fcfe);same(t.growth,supplied.growth);
     terminal={next_fcfe:number(t.next_fcfe,true),growth:number(t.growth),undiscounted_value:number(t.undiscounted_value,true),present_value:number(t.present_value,true),fraction:number(scenario.terminal_fraction)};
    }else if(parameter.terminal!==null)fail('TERMINAL_BINDING');
    scenarios.push({name,value,eps:null,pe:null,discount_rate:number(scenario.discount_rate,true),explicit_period_pv:number(scenario.explicit_period_pv),cashflows,terminal,dividend:null});
   }
  }
 }
 return frozen({input:i,calculation:c,details:{input_hash:input.hash,calculation_hash:calculation.hash,
  entry_range:entryRange,wait_above:waitAbove,invalidation:text(c.invalidation),recorded_at:recorded,symbol:scope.symbol,horizon:scope.horizon,
  method_id:methodId,cutoff,data_through:through,as_of:asOf,expires_at:expiry,
  assumptions_at:assumptionAt,assumptions_after_cutoff:after,quote:number(trace.quote,true),derivation,assumptions,limitations,
  assumption_description:text(assumption.description),dilution_description:dilution,forecast_period:forecast,earnings_basis:earnings,reported_eps:reported,
  scenarios,selection,short,sources:sourceRows,raw:{input_text:input.text,calculation_text:calculation.text}}});
}

/** Owner-only disclosure, bound to the exact already parsed price row. This
 * validates retained bytes and identities; it never creates a review decision
 * or recalculates/rounds an approved member price in the browser. */
export async function parseDailyAiOwnerPriceCalculation(value:unknown,row:DailyAiOwnerPriceRow,subjectUserId:string,now=Date.now()):Promise<DailyAiOwnerPriceCalculation>{
 const v=object(structuredClone(value)),owned=structuredClone(row),body=owned.body;
 exact(v,['schema','edition_id','plan_hash','subject_user_id','research_only','preview_only','audit']);
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(subjectUserId)||!hashValid(owned.plan_hash)
  ||v.schema!=='DAILY_AI_OWNER_PRICE_CALCULATION_V1'||v.edition_id!==body.edition_id||v.plan_hash!==owned.plan_hash
  ||v.subject_user_id!==subjectUserId||v.research_only!==true||v.preview_only!==true)fail('SCOPE');
 if(await hashDailyAiPricePlanBody(body)!==owned.plan_hash)fail('PLAN_HASH');
 const envelope={schema:'DAILY_AI_OWNER_PRICE_CALCULATION_V1' as const,edition_id:body.edition_id,plan_hash:owned.plan_hash,
  subject_user_id:subjectUserId,research_only:true as const,preview_only:true as const};
 if(v.audit===null)return frozen({...envelope,audit:null});
 const a=object(v.audit);exact(a,['batch_id','input_hash','input_text','calculation_hash','calculation_text','method_note_hash','method_note_text','review_request_hash','review_request_text','recorded_at']);
 const batchId=hash(a.batch_id),recorded=time(a.recorded_at);
 const core=await parseDailyAiOwnerCalculationDocuments({input_hash:a.input_hash,input_text:a.input_text,calculation_hash:a.calculation_hash,calculation_text:a.calculation_text,recorded_at:recorded},{symbol:body.symbol,horizon:body.horizon},now);
 const c=core.calculation,details=core.details;
 const method=await readDocument(a.method_note_text,a.method_note_hash,32000),request=await readDocument(a.review_request_text,a.review_request_hash,16000);
 const n=method.value,r=request.value,methodId=details.method_id,asOf=details.as_of,assumptionHash=hash(c.assumption_hash);
 for(const key of ['symbol','horizon','currency','method','entry_range','wait_above','stop_kind','stop','stop_evidence_ids','invalidation','evidence_ids','as_of','expires_at'] as const)same(c[key],body[key]);
 if(body.basis!==c.basis+'\n計算紀錄 SHA-256：'+details.calculation_hash)fail('PLAN_BINDING');
 exact(n,['name','derivation','assumptions','limitations','source_use_scope']);
 const originalNote=object(c.method_note);
 if(n.name!==methodId||n.source_use_scope!=='PRIVATE_RESEARCH_ONLY'||originalNote.name!==methodId||originalNote.source_use_scope!=='PRIVATE_RESEARCH_ONLY')fail('METHOD_NOTE');
 same(n.assumptions,originalNote.assumptions);same(n.limitations,originalNote.limitations);
 const derivation=text(originalNote.derivation,16000);
 if(n.derivation!==derivation+'\n計算紀錄 SHA-256：'+details.calculation_hash+'\n輸入 SHA-256：'+details.input_hash+'\n假設 SHA-256：'+assumptionHash)fail('METHOD_NOTE_BINDING');
 exact(r,['schema','status','edition_id','symbol','horizon','plan_hash','calculation_hash','input_hash','assumption_hash','packet_hash','card_hash','method_document_hash','evidence_ids','prepared_at','expires_at','required_reviews','review','source_use_approved','methodology_approved']);
 if(r.schema!=='DAILY_AI_PRICE_REVIEW_REQUEST_V1'||r.status!=='PENDING'||r.edition_id!==body.edition_id||r.symbol!==body.symbol||r.horizon!==body.horizon
  ||r.plan_hash!==owned.plan_hash||r.calculation_hash!==details.calculation_hash||r.input_hash!==details.input_hash||r.assumption_hash!==assumptionHash
  ||r.method_document_hash!==method.hash||r.expires_at!==body.expires_at||r.review!==null||r.source_use_approved!==false||r.methodology_approved!==false)fail('REVIEW_REQUEST');
 hash(r.packet_hash);hash(r.card_hash);same(r.evidence_ids,body.evidence_ids);same(r.required_reviews,['QUALITY','TIME','SOURCE_USE','METHODOLOGY']);
 if(compareTime(time(r.prepared_at),asOf)<0||compareTime(time(r.prepared_at),recorded)>0)fail('REVIEW_TIME');
 return frozen({...envelope,audit:{...details,batch_id:batchId,method_note_hash:method.hash,review_request_hash:request.hash,
  raw:{...details.raw,method_note_text:method.text,review_request_text:request.text}}});
}
