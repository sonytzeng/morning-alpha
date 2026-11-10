/** Rebind a finite-lived, explicitly supplied method to a new daily packet.
 * This is not a source downloader, forecast writer or approval authority.
 * Unchanged parameters remain anchored to their original calculation. */
import {compareTime,hashValid,snapshotHash,validObservationTime,type Horizon} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisEvidence,type AnalysisPacket} from './daily-ai-analysis.ts';
import {calculateDailyAiPricePlan,PRICE_CALCULATION_METHODS,isSupportedPriceMethod,LONG_EPS_DIVIDEND_METHOD,PriceCalculationError,type DailyAiPriceCalculationInput} from './daily-ai-price-calculation.ts';
import {isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

export type DailyAiPriceProfile={schema:'DAILY_AI_PRICE_PROFILE_V1';policy:'REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY';
 symbol:string;horizon:Horizon;method_id:string;created_at:string;valid_until:string;revision_note:string;
 template_input:DailyAiPriceCalculationInput};
type Edition={id:string;evidence_cutoff:string;prepared_at:string;expires_at:string;data_through:string};
type Missing={code:string;field:string};
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=(code:string):never=>{throw Error('PRICE_PROFILE_'+code);};
const boundedText=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const validTime=(value:unknown):value is string=>typeof value==='string'&&validObservationTime(value);
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
function content(e:AnalysisEvidence):Record<string,unknown>|null{
 try{const value=JSON.parse(e.content);return object(value)?value:null;}catch{return null;}
}
const financialKind=(e:AnalysisEvidence)=>{
 if(e.kind!=='FINANCIAL')return null;const v=content(e);return v&&boundedText(v.kind,100)?v.kind as string:null;
};
const sorted=(evidence:AnalysisEvidence[])=>evidence.slice().sort((a,b)=>a.id.localeCompare(b.id));
function references(template:DailyAiPriceCalculationInput):string[]{
 const p=template.parameters;
 const dailyCoverage=template.horizon==='SHORT'&&'corporate_actions_evidence_id'in p?p.corporate_actions_evidence_id:null;
 // Company-action coverage is a daily observation like the quote/bar slots.
 // Its original citation can also appear in assumption_basis, but updating
 // that observation must not rewrite any other fixed method dependency.
 return [...new Set([...template.assumption_basis.evidence_ids,...('dilution_basis'in p?p.dilution_basis.evidence_ids:[]),
  ...('stop_evidence_ids'in p?p.stop_evidence_ids:[])])].filter(id=>id!==dailyCoverage);
}
const coverageDate=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)
 &&validObservationTime(value+'T13:30:00+08:00');
const coverageObservationTime=(source:AnalysisEvidence)=>source.as_of??source.published_at??source.first_seen_at??source.available_at;
const completedCoverage=(source:AnalysisEvidence,through:string)=>compareTime(source.available_at,through+'T13:30:00+08:00')>=0
 &&compareTime(coverageObservationTime(source),through+'T13:30:00+08:00')>=0;
type CorporateActionBinding={original_evidence_id:string;original_evidence_hash:string;current_evidence_id:string;current_evidence_hash:string;
 original_observation_at:string;current_observation_at:string;coverage_from:string;coverage_through:string;
 source_available_at:string;assumption_reference_rebound:boolean};

export async function bindDailyAiPriceProfile(value:{profile:DailyAiPriceProfile;packet:AnalysisPacket;edition:Edition;now:number}){
 const owned=structuredClone(value);
 if(!object(owned)||Object.keys(owned).length!==4||!['profile','packet','edition','now'].every(k=>Object.hasOwn(owned,k)))fail('ARGUMENTS');
 const {profile,packet,edition,now}=owned;
 const keys=['schema','policy','symbol','horizon','method_id','created_at','valid_until','revision_note','template_input'];
 if(!object(profile)||Object.keys(profile).length!==keys.length||!keys.every(k=>Object.hasOwn(profile,k))
  ||profile.schema!=='DAILY_AI_PRICE_PROFILE_V1'||profile.policy!=='REPRICE_FIXED_ASSUMPTIONS_UNTIL_EXPIRY'
  ||!boundedText(profile.symbol,6)||!/^\d{4,6}$/.test(profile.symbol)||!Object.hasOwn(PRICE_CALCULATION_METHODS,profile.horizon)
  ||!isSupportedPriceMethod(profile.horizon,profile.method_id)||!boundedText(profile.revision_note,1500)
  ||!validTime(profile.created_at)||!validTime(profile.valid_until)||compareTime(profile.created_at,profile.valid_until)>=0)fail('SCHEMA');
 if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))fail('NOW');
 const current=new Date(now).toISOString(),template=profile.template_input;
 if(!object(template)||template.symbol!==profile.symbol||template.horizon!==profile.horizon||template.method_id!==profile.method_id
  ||template.schema!=='DAILY_AI_PRICE_CALCULATION_INPUT_V1'||!validTime(template.as_of)||!validTime(template.expires_at)
  ||!validTime(template.cutoff)||compareTime(template.as_of,profile.created_at)>0
  ||compareTime(profile.created_at,template.expires_at)>=0)fail('TEMPLATE_IDENTITY_OR_EXPIRED_AT_CREATION');
 if(!object(edition)||!hashValid(edition.id)||!validTime(edition.evidence_cutoff)||!validTime(edition.prepared_at)||!validTime(edition.expires_at)
  ||compareTime(edition.evidence_cutoff,edition.prepared_at)>0||!boundedText(edition.data_through,10))fail('EDITION');
 validateAnalysisPacket(packet);
 if(packet.symbol!==profile.symbol||packet.data_through!==edition.data_through||compareTime(packet.cutoff,edition.evidence_cutoff)!==0
  ||compareTime(template.cutoff,packet.cutoff)>0)fail('PACKET_IDENTITY');
 for(const e of packet.evidence)if(compareTime(e.available_at,packet.cutoff)>0||e.published_at!==null&&compareTime(e.published_at,e.available_at)>0
  ||e.first_seen_at!==undefined&&compareTime(e.first_seen_at,e.available_at)>0||e.as_of!==undefined&&compareTime(e.as_of,e.available_at)>0)fail('SOURCE_TIME');
 const profile_hash=await snapshotHash(profile),base={schema:'DAILY_AI_PRICE_PROFILE_BINDING_V1' as const,profile_hash,
  symbol:profile.symbol,horizon:profile.horizon,review_required:true as const,methodology_approved:false as const,member_published:false as const};
 const missing=(items:Missing[])=>freeze({...base,status:'METHOD_UPDATE_REQUIRED' as const,calculation_input:null,missing:items});
 if(compareTime(profile.created_at,current)>0)return missing([{code:'PROFILE_NOT_YET_CREATED',field:'profile.created_at'}]);
 if(compareTime(current,profile.valid_until)>=0)return missing([{code:'PROFILE_EXPIRED',field:'profile.valid_until'}]);
 if(compareTime(edition.prepared_at,current)>0||compareTime(current,edition.expires_at)>=0)
  return missing([{code:'EDITION_NOT_ACTIVE',field:'edition.prepared_at/expires_at'}]);
 // A supported template must have been numerically valid at its actual original
 // as_of. Its present expiry may be past: the explicit finite profile, created
 // while it was alive, authorizes repricing work only, never extended review.
 try{await calculateDailyAiPricePlan(template,Date.parse(template.as_of));}
 catch(error){return missing([{code:error instanceof PriceCalculationError?error.code:'PROFILE_TEMPLATE_INVALID',field:error instanceof PriceCalculationError?error.field:'profile.template_input'}]);}
 const original=new Map(template.evidence.map(e=>[e.id,e])),currentSources=new Map(packet.evidence.map(e=>[e.id,e]));
 const dependencies=references(template),problems:Missing[]=[],kinds=new Set<string>();
 for(const id of dependencies){
  const before=original.get(id),after=currentSources.get(id);
  if(!before){problems.push({code:'PROFILE_DEPENDENCY_MISSING_IN_TEMPLATE',field:id});continue;}
  // Repointing a parameter's own price citation would silently change the
  // rationale of that fixed parameter. Only structural quote/bar/coverage slots rebind.
  if(before.kind==='PRICE'){problems.push({code:'PROFILE_PARAMETER_PRICE_DEPENDENCY_REQUIRES_UPDATE',field:id});continue;}
  if(!after){problems.push({code:'PROFILE_DEPENDENCY_MISSING',field:id});continue;}
  if(await snapshotHash(before)!==await snapshotHash(after))problems.push({code:'PROFILE_DEPENDENCY_VERSION_CHANGED',field:id});
  const kind=financialKind(before);if(kind!==null)kinds.add(kind);
 }
 // New quarters or revised rows in a financial series actually used by the
 // method require a new profile. Unreferenced market/news/institutional series
 // may update daily without invalidating an unrelated fixed earnings model.
 for(const kind of kinds){
  const before=sorted(template.evidence.filter(e=>e.symbol===profile.symbol&&financialKind(e)===kind));
  const after=sorted(packet.evidence.filter(e=>e.symbol===profile.symbol&&financialKind(e)===kind));
  if(await snapshotHash(before)!==await snapshotHash(after))problems.push({code:'PROFILE_FINANCIAL_SERIES_CHANGED',field:`FINANCIAL.${kind}`});
 }
 if(problems.length)return missing(problems);
 const prices=packet.evidence.filter(e=>e.kind==='PRICE'&&e.symbol===profile.symbol);
 const currentQuotes=prices.filter(e=>content(e)?.date===packet.data_through);
 if(currentQuotes.length!==1)return missing([{code:currentQuotes.length?'PROFILE_CURRENT_QUOTE_AMBIGUOUS':'PROFILE_CURRENT_QUOTE_MISSING',field:'packet.evidence.PRICE'}]);
 const parameters=structuredClone(template.parameters),assumptions=structuredClone(template.assumption_basis);
 let corporateActionBinding:CorporateActionBinding|null=null;
 if(template.horizon==='SHORT'){
  if(!('atr_period'in parameters)||!('corporate_actions_evidence_id'in parameters))return fail('TEMPLATE_HORIZON');
  const expected:string[]=[];let session:string|null=packet.data_through??null;
  for(let i=0;i<=parameters.atr_period;i++){
   if(!session||!isMarketTradingDate('TW',session))return missing([{code:'PROFILE_CALENDAR_UNAVAILABLE',field:'parameters.expected_sessions'}]);
   expected.unshift(session);session=previousMarketTradingDate('TW',session);
  }
  const ids:string[]=[];
  for(const day of expected){const rows=prices.filter(e=>content(e)?.date===day);
   if(rows.length!==1)return missing([{code:rows.length?'PROFILE_BAR_AMBIGUOUS':'PROFILE_BAR_MISSING',field:day}]);ids.push(rows[0].id);}
  const originalCoverageId=parameters.corporate_actions_evidence_id,originalCoverage=original.get(originalCoverageId)!;
  const originalCoverageBody=content(originalCoverage);
  // A newer receipt cannot turn an older observation into knowledge of a
  // completed no-action interval. Retain the original observation semantics
  // for both the template and the selected new daily observation.
  if(!originalCoverageBody||!coverageDate(originalCoverageBody.through)
   ||!completedCoverage(originalCoverage,originalCoverageBody.through))
   return missing([{code:'PROFILE_TEMPLATE_CORPORATE_ACTION_TIME_INVALID',field:originalCoverageId}]);
  const coverageRows=packet.evidence.filter(e=>e.kind!=='PRICE'&&e.symbol===profile.symbol)
   .map(source=>({source,body:content(source)})).filter(row=>row.body?.kind==='CORPORATE_ACTION_COVERAGE');
  if(!coverageRows.length)return missing([{code:'PROFILE_CORPORATE_ACTION_COVERAGE_MISSING',field:'packet.evidence.CORPORATE_ACTION_COVERAGE'}]);
  const candidates:{source:AnalysisEvidence;from:string;through:string}[]=[];
  for(const row of coverageRows){
   const {source,body}=row;
   if(!body||body.symbol!==profile.symbol)return missing([{code:'PROFILE_CORPORATE_ACTION_IDENTITY_INVALID',field:source.id}]);
   if(!coverageDate(body.from)||!coverageDate(body.through)||body.from>body.through)
    return missing([{code:'PROFILE_CORPORATE_ACTION_COVERAGE_INVALID',field:source.id}]);
   if(body.from>packet.data_through!||body.through<expected[0])continue;
   if(body.status==='HAS_ACTIONS')return missing([{code:'PROFILE_CORPORATE_ACTIONS_PRESENT',field:source.id}]);
   if(body.status!=='NO_ACTIONS')return missing([{code:'PROFILE_CORPORATE_ACTION_STATUS_UNSUPPORTED',field:source.id}]);
   if(body.price_basis!=='RAW_UNADJUSTED')return missing([{code:'PROFILE_CORPORATE_ACTION_PRICE_BASIS_INVALID',field:source.id}]);
   if(!completedCoverage(source,body.through))
    return missing([{code:'PROFILE_CORPORATE_ACTION_COVERAGE_TIME_INVALID',field:source.id}]);
   if(body.from<=expected[0]&&body.through>=packet.data_through!)candidates.push({source,from:body.from,through:body.through});
  }
  if(candidates.length!==1)return missing([{code:candidates.length?'PROFILE_CORPORATE_ACTION_COVERAGE_AMBIGUOUS':'PROFILE_CORPORATE_ACTION_COVERAGE_INCOMPLETE',
   field:'packet.evidence.CORPORATE_ACTION_COVERAGE'}]);
  const selected=candidates[0],rebound=assumptions.evidence_ids.includes(originalCoverageId);
  assumptions.evidence_ids=[...new Set(assumptions.evidence_ids.map(id=>id===originalCoverageId?selected.source.id:id))];
  corporateActionBinding={original_evidence_id:originalCoverageId,original_evidence_hash:await snapshotHash(originalCoverage),
   current_evidence_id:selected.source.id,current_evidence_hash:await snapshotHash(selected.source),
   original_observation_at:coverageObservationTime(originalCoverage),current_observation_at:coverageObservationTime(selected.source),
   coverage_from:selected.from,coverage_through:selected.through,source_available_at:selected.source.available_at,assumption_reference_rebound:rebound};
  parameters.bar_evidence_ids=ids;parameters.expected_sessions=expected;parameters.corporate_actions_evidence_id=selected.source.id;
 }else if(template.horizon==='MEDIUM'){
  if(!('forecast_period'in parameters)||!('earnings_basis'in parameters))return fail('TEMPLATE_HORIZON');
  if(parameters.earnings_basis==='FORWARD_12_MONTH_DILUTED_EPS'&&parameters.forecast_period.start<=packet.data_through!)
   return missing([{code:'PROFILE_FORECAST_WINDOW_NO_LONGER_FORWARD',field:'parameters.forecast_period'}]);
  if(parameters.earnings_basis==='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION'&&parameters.forecast_period.end<packet.data_through!)
   return missing([{code:'PROFILE_FIXED_EARNINGS_PERIOD_EXPIRED',field:'parameters.forecast_period'}]);
  if(parameters.earnings_basis==='REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM'&&parameters.forecast_period.end>packet.data_through!)
   return missing([{code:'PROFILE_REPORTED_EARNINGS_PERIOD_AFTER_QUOTE',field:'parameters.forecast_period'}]);
 }else if(template.method_id===LONG_EPS_DIVIDEND_METHOD){
  if(!('earnings_period'in parameters))return fail('TEMPLATE_HORIZON');
  if(parameters.earnings_period.end>packet.data_through!)
   return missing([{code:'PROFILE_REPORTED_EARNINGS_PERIOD_AFTER_QUOTE',field:'parameters.earnings_period'}]);
 }
 const expiry=compareTime(profile.valid_until,edition.expires_at)<=0?profile.valid_until:edition.expires_at;
 const anchor=`\n固定方法來源：profile ${profile_hash}；原始來源截止 ${template.cutoff}；原始計算 ${template.as_of}；本次只重綁當版價格與來源，EPS／FCFE／PE／r／g及預測期間均保留，未滾動或外推；需重新審查。`;
 const coverageNote=corporateActionBinding?`\n公司行動覆蓋為本次資料檢核：${corporateActionBinding.original_evidence_id} → ${corporateActionBinding.current_evidence_id}；本次觀察 ${corporateActionBinding.current_observation_at}，可用 ${corporateActionBinding.source_available_at}；原數值假設形成時間不變。`:'';
 const description=template.assumption_basis.description+anchor+coverageNote;
 if(description.length>1500)return missing([{code:'PROFILE_ASSUMPTION_DESCRIPTION_CAPACITY',field:'template_input.assumption_basis.description'}]);
 const calculation_input={...structuredClone(template),cutoff:packet.cutoff,data_through:packet.data_through!,as_of:current,expires_at:expiry,
  quote_evidence_id:currentQuotes[0].id,evidence:structuredClone(packet.evidence),parameters,
  assumption_basis:{...assumptions,description}} as DailyAiPriceCalculationInput;
 // Validate the complete rebound contract now; the producer independently
 // recalculates it before staging, so this result cannot bypass its checks.
 try{await calculateDailyAiPricePlan(calculation_input,now);}
 catch(error){return missing([{code:error instanceof PriceCalculationError?error.code:'PROFILE_REBOUND_INPUT_INVALID',field:error instanceof PriceCalculationError?error.field:'calculation_input'}]);}
 return freeze({...base,status:'BOUND_REVIEW_REQUIRED' as const,calculation_input,missing:[] as Missing[],
  binding:{original_cutoff:template.cutoff,original_as_of:template.as_of,original_assumptions_available_at:template.assumption_basis.available_at,
   profile_valid_until:profile.valid_until,price_session:packet.data_through!,bound_at:current,
   non_price_dependency_ids:dependencies.filter(id=>original.get(id)?.kind!=='PRICE').sort(),financial_series:[...kinds].sort(),
   corporate_action_source:corporateActionBinding,
   forecast_parameters_rolled:false as const,profile_expiry_extended:false as const,review_copied:false as const}});
}
