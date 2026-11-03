/** Fixed 229-fact portal subset. Keeps native quarters and original 84/4/2
 * limits. All 270 source candidates remain in the private selection archive.
 * No EPS conversion, original-amount assertion, source-use or member grant. */
import {compareTime,hashValid,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import type {FunnelInput,ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import type {DailyAiFinancialRefreshProof,refreshDailyAiFinancials} from './daily-ai-financial-refresh.ts';
import {requireIssuer16QuarantineContext} from './issuer16-daily-financial-replay.ts';
import {PORTAL_MARGIN_SOURCE_SEAL,PORTAL_MARGIN_FACTS_SHA256,PORTAL_MARGIN_REGISTRY_CUTOFF,
 PORTAL_MARGIN_CANDIDATES_SHA256,REQUIRED_NATIVE_MARGINS_SHA256,PORTAL_MARGIN_FACT_COUNT,
 PORTAL_MARGIN_FACT_IDS,PORTAL_MARGIN_SYMBOLS} from './portal-margin-registry.constants.ts';
type Refresh=typeof refreshDailyAiFinancials;
type LoadRegistry=(args:{p_source_seal:string;p_cutoff:string},signal:AbortSignal)=>Promise<unknown>;
export type PortalMarginFact=ResearchFact&{symbol:string;kind:'MARGIN';basis:'SINGLE_QUARTER';
 normalizer_version:'PORTAL_MARGIN_VERIFIED_REPLAY_V1';original_kind:'MARGIN';source_sha256:string;
 source_bytes:number;source_received_at:string;source_candidate_id:string;source_candidate_evidence_hash:string;
 source_candidate_file_sha256:string;source_candidate_available_at:string;source_candidate_derived_at:string;
 source_terms_evidence:{url:string;sha256:string;bytes:number;received_at:string;consolidation_key_home_sha256:string};
 source_locator:{request_metric:string;axis_index:number;period_label:string;point:(number|string)[]};
 as_of_basis:'FINANCIAL_PERIOD_END_NOT_PUBLICATION';derived_at:string;direct_single_quarter:false;
 ttm_established:false;interpretation_only:true;source_admitted:false;member_publication_approved:false};
type Registry={facts:PortalMarginFact[];required_native_margins:ResearchFact[]};
type ReplayProof={schema:'DAILY_AI_PORTAL_MARGIN_REPLAY_V1';source_seal_sha256:string;facts_sha256:string;
 required_native_margins_sha256:string;fact_ids:string[];source_refetched:false;source_admitted:false;member_publication_approved:false};
const ids=new Set<string>(PORTAL_MARGIN_FACT_IDS),symbols=new Set<string>(PORTAL_MARGIN_SYMBOLS);
const own=(f:ResearchFact)=>ids.has(f.id);
const ordered=<T extends ResearchFact>(f:T[])=>f.slice().sort((a,b)=>a.id.localeCompare(b.id));
const fail=():never=>{throw Error('PORTAL_MARGIN_REPLAY_INVALID');};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;};
const stopped=(s:AbortSignal)=>{if(s.aborted)throw Error('PORTAL_MARGIN_REPLAY_ABORTED');};
function end(period:string|null){
 const q=/^(2025|2026)-Q([1-4])$/.exec(period??'');if(!q)return fail();
 return new Date(Date.UTC(Number(q[1]),Number(q[2])*3,0)).toISOString().slice(0,10)+'T23:59:59+08:00';
}
function universe(inputs:FunnelInput[]){
 if(!Array.isArray(inputs)||inputs.length!==72||new Set(inputs.map(i=>i.symbol)).size!==72
  ||inputs.some(i=>!Array.isArray(i.facts)))fail();
 if(inputs.some(i=>i.facts.some(f=>(['PORTAL_MARGIN_COMPARISON','PORTAL_MARGIN_INDIVIDUAL'].includes(f.kind)
  ||f.values?.measurement_basis==='OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN')&&!own(f))))fail();
}

export async function parsePortalMarginDailyRegistry(raw:unknown,cutoff:string):Promise<Registry>{
 let captured:unknown;try{captured=structuredClone(raw);}catch{fail();}
 const r=object(captured);
 if(r.schema!=='DAILY_AI_PORTAL_MARGIN_REGISTRY_V1'||r.source_seal_sha256!==PORTAL_MARGIN_SOURCE_SEAL
  ||r.facts_sha256!==PORTAL_MARGIN_FACTS_SHA256||r.registry_cutoff!==PORTAL_MARGIN_REGISTRY_CUTOFF
  ||r.required_native_margins_sha256!==REQUIRED_NATIVE_MARGINS_SHA256
  ||r.source_admitted!==false||r.member_publication_approved!==false||!validObservationTime(cutoff)
  ||compareTime(cutoff,PORTAL_MARGIN_REGISTRY_CUTOFF)<0||!Array.isArray(r.facts)||r.facts.length!==PORTAL_MARGIN_FACT_COUNT
  ||await snapshotHash(r.facts)!==PORTAL_MARGIN_FACTS_SHA256||!Array.isArray(r.required_native_margins)
  ||r.required_native_margins.length!==23||await snapshotHash(ordered(r.required_native_margins as ResearchFact[]))!==REQUIRED_NATIVE_MARGINS_SHA256)fail();
 const facts=r.facts as PortalMarginFact[],native=r.required_native_margins as ResearchFact[];
 for(const f of facts){
  const {id,evidence_hash,...body}=f,terms=f.source_terms_evidence,locator=f.source_locator;
  if(!ids.has(id)||!symbols.has(f.symbol)||f.kind!=='MARGIN'||f.original_kind!=='MARGIN'||f.basis!=='SINGLE_QUARTER'
   ||f.normalizer_version!=='PORTAL_MARGIN_VERIFIED_REPLAY_V1'||f.as_of_basis!=='FINANCIAL_PERIOD_END_NOT_PUBLICATION'
   ||f.as_of!==end(f.period)||f.source!=='https://mopsfin.twse.com.tw/compare/data'||f.published_at!==null
   ||f.source_admitted!==false||f.member_publication_approved!==false||f.direct_single_quarter!==false
   ||f.ttm_established!==false||f.interpretation_only!==true||f.derived_at!==PORTAL_MARGIN_REGISTRY_CUTOFF
   ||f.available_at!==f.derived_at||f.first_seen_at!==f.source_received_at||!hashValid(f.source_sha256)
   ||!hashValid(f.source_candidate_evidence_hash)||f.source_candidate_file_sha256!==PORTAL_MARGIN_CANDIDATES_SHA256
   ||typeof f.source_candidate_id!=='string'||!f.source_candidate_id.startsWith('official-portal-calculated-margin:')
   ||!Number.isSafeInteger(f.source_bytes)||f.source_bytes<5
   ||[f.available_at,f.first_seen_at,f.as_of,f.source_received_at,f.source_candidate_available_at,f.source_candidate_derived_at]
    .some(t=>typeof t!=='string'||!validObservationTime(t)||compareTime(t,cutoff)>0)
   ||typeof f.available_at!=='string'||typeof f.first_seen_at!=='string'||typeof f.as_of!=='string'
   ||compareTime(f.first_seen_at,f.available_at)>0||compareTime(f.as_of,f.available_at)>0
   ||f.values.measurement_basis!=='OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN'||f.values.unit!=='PERCENT'
   ||f.values.consolidation_as_reported!=='C'||f.values.consolidation!=='CONSOLIDATED'
   ||typeof f.values.value!=='number'||!Number.isFinite(f.values.value)||f.values.value>100
   ||f.values.formula!=='single_quarter_gross_profit / single_quarter_revenue * 100'
   ||f.values.source_rounding!=='SOURCE_PORTAL_TWO_DECIMAL_MAX; UNDERLYING_AMOUNTS_NOT_IN_THIS_RESPONSE'
   ||f.values.single_quarter_amount_basis!==(f.period?.endsWith('Q4')?'OFFICIAL_PORTAL_FY_CUMULATIVE_MINUS_Q3_CUMULATIVE':'ISSUER_REPORTED_SINGLE_QUARTER_AMOUNTS_PER_SOURCE_TERMS')
   ||!terms||terms.url!=='https://mopsfin.twse.com.tw/terms'
   ||terms.sha256!=='fbeffc5d14d8b2b06d6bc0f9639ae94e6aa8378191f26838d7dbb9995dbc93ab'||terms.bytes!==27882
   ||terms.consolidation_key_home_sha256!=='1a0a412818ed83e8e88a8ede40f7f5e7be9e7c3e62a987660f5f4071fb074a1f'
   ||!validObservationTime(terms.received_at)||compareTime(terms.received_at,cutoff)>0
   ||!locator||locator.request_metric!=='GrossMargin'||locator.period_label!==f.period?.replace('-','')
   ||!Number.isSafeInteger(locator.axis_index)||!Array.isArray(locator.point)||locator.point.length!==3
   ||locator.point[0]!==locator.axis_index||locator.point[1]!==f.values.value||locator.point[2]!=='C'
   ||evidence_hash!==await snapshotHash(body))fail();
 }
 if(new Set(facts.map(f=>f.id)).size!==PORTAL_MARGIN_FACT_COUNT
  ||new Set(facts.map(f=>f.symbol+':'+f.period)).size!==PORTAL_MARGIN_FACT_COUNT)fail();
 return {facts:structuredClone(facts),required_native_margins:structuredClone(native)};
}

export async function requirePortalNativeMargins(inputs:FunnelInput[],required:ResearchFact[],complete=true):Promise<void>{
 universe(inputs);const found=inputs.flatMap(i=>i.facts.filter(f=>f.kind==='MARGIN'&&!own(f)).map(f=>({symbol:i.symbol,fact:f})));
 if(found.some(x=>x.symbol!==(x.fact as {symbol?:string}).symbol)||new Set(found.map(x=>x.fact.id)).size!==found.length)fail();
 const expected=new Map(required.map(f=>[f.id,f]));
 for(const x of found)if(!expected.has(x.fact.id)||await snapshotHash(x.fact)!==await snapshotHash(expected.get(x.fact.id)))fail();
 if(complete&&await snapshotHash(ordered(found.map(x=>x.fact)))!==REQUIRED_NATIVE_MARGINS_SHA256)fail();
}

export async function mergePortalMarginDailyFacts(input:FunnelInput[],registry:Registry):Promise<FunnelInput[]>{
 const owned=structuredClone(input);await requirePortalNativeMargins(owned,registry.required_native_margins);
 await requireIssuer16QuarantineContext(owned);
 const expected=new Map(registry.facts.map(f=>[f.id,f]));
 for(const i of owned){
  for(const f of i.facts.filter(own))if((f as PortalMarginFact).symbol!==i.symbol||!expected.has(f.id)
   ||await snapshotHash(f)!==await snapshotHash(expected.get(f.id)))fail();
  for(const f of registry.facts.filter(f=>f.symbol===i.symbol)){
   if([f.first_seen_at,f.available_at,f.as_of].some(t=>typeof t!=='string'||compareTime(t,i.cutoff)>0))fail();
   const previous=i.facts.filter(x=>x.kind==='MARGIN'&&x.period===f.period);
   if(previous.length>1||previous.length===1&&await snapshotHash(previous[0])!==await snapshotHash(f))fail();
   if(!previous.length)i.facts.push(structuredClone(f));
  }
  if(i.facts.filter(f=>f.kind==='MARGIN').length>4)fail();
 }
 return owned;
}

export function withRetainedPortalMarginDailyFinancials(baseRefresh:Refresh,load:LoadRegistry):Refresh{
 return async request=>{
  stopped(request.signal);const owned={...request,inputs:structuredClone(request.inputs)},baseline=owned.inputs;
  universe(baseline);const existing=baseline.flatMap(i=>i.facts.filter(own).map(f=>({symbol:i.symbol,fact:f})));
  if(existing.some(x=>x.symbol!==(x.fact as PortalMarginFact).symbol))fail();
  const previous=existing.map(x=>x.fact);
  // An already-present subset cannot be carried through an outage or partial
  // old context. First acquisition may legitimately add native16 in baseRefresh.
  if(previous.length){await requireIssuer16QuarantineContext(baseline);
   const native=baseline.flatMap(i=>i.facts.filter(f=>f.kind==='MARGIN'&&!own(f)));
   if(await snapshotHash(ordered(native))!==REQUIRED_NATIVE_MARGINS_SHA256)fail();}
  const began=owned.clock();if(!validObservationTime(began))fail();let raw:unknown;
  try{raw=await load({p_source_seal:PORTAL_MARGIN_SOURCE_SEAL,p_cutoff:began},owned.signal);}
  catch{stopped(owned.signal);if(previous.length)throw Error('PORTAL_MARGIN_REGISTRY_UNAVAILABLE_ALREADY_PRESENT');
   const financial=await baseRefresh(owned);stopped(owned.signal);return {...financial,additionalGaps:[...new Set([
    ...financial.additionalGaps,'PORTAL_MARGIN_FIXED_REGISTRY_UNAVAILABLE_NOT_APPLIED'])]};}
  const registry=await parsePortalMarginDailyRegistry(raw,began);stopped(owned.signal);
  await requirePortalNativeMargins(baseline,registry.required_native_margins,previous.length>0);
  if(previous.length&&await snapshotHash(ordered(previous))!==await snapshotHash(ordered(registry.facts)))fail();
  const stripped=baseline.map(i=>({...i,facts:i.facts.filter(f=>!own(f))}));
  const financial=structuredClone(await baseRefresh({...owned,inputs:stripped}));stopped(owned.signal);
  const cutoff=owned.clock();
  if(!validObservationTime(cutoff)||!validObservationTime(financial.cutoff)||compareTime(began,cutoff)>0
   ||compareTime(financial.cutoff,cutoff)>0||financial.proof.removals.some(r=>ids.has(r.id)))fail();
  const inputs=await mergePortalMarginDailyFacts(financial.inputs.map(i=>({...i,cutoff})),registry);
  const portal_margin_replay:ReplayProof={schema:'DAILY_AI_PORTAL_MARGIN_REPLAY_V1',source_seal_sha256:PORTAL_MARGIN_SOURCE_SEAL,
   facts_sha256:PORTAL_MARGIN_FACTS_SHA256,required_native_margins_sha256:REQUIRED_NATIVE_MARGINS_SHA256,
   fact_ids:registry.facts.map(f=>f.id).sort(),source_refetched:false,source_admitted:false,member_publication_approved:false};
  const proof:DailyAiFinancialRefreshProof&{portal_margin_replay:ReplayProof}={...financial.proof,portal_margin_replay};
  const gapsBySymbol={...financial.gapsBySymbol};
  for(const symbol of symbols)gapsBySymbol[symbol]=[...new Set([...(gapsBySymbol[symbol]??[]),
   'PORTAL_MARGIN_OFFICIAL_CALCULATED_NOT_DIRECT_PERCENT_OR_UNDERLYING_AMOUNTS',
   'PORTAL_MARGIN_NARROW_SELECTION_RAW270_RETAINED_NO_EPS_OR_LONG_RECOMMENDATION_APPROVAL',
   'PORTAL_MARGIN_RECEIPT_AND_INTERPRETATION_TIMES_ONLY_COMMERCIAL_USE_REVIEW_REQUIRED'])];
  return {...financial,inputs,cutoff,proof,gapsBySymbol};
 };
}
