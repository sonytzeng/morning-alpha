/** Deterministic conditional-price arithmetic. No provider, database, review,
 * publication or default forecast. Every parameter is supplied and hashed.
 * The result is a calculation for review, never evidence of investment merit. */
import {compareTime,hashValid,snapshotHash,validObservationTime,type Horizon} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisEvidence} from './daily-ai-analysis.ts';
import {readReportedDilutedQuarterSeries} from './daily-ai-financial-inputs.ts';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

export const PRICE_CALCULATION_METHODS=Object.freeze({
 SHORT:'SHORT_ATR_CONDITIONAL_V1',MEDIUM:'MEDIUM_EPS_PE_SCENARIOS_V1',LONG:'LONG_FCFE_DISCOUNT_SCENARIOS_V1',
} as const);
export const LONG_EPS_DIVIDEND_METHOD='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1' as const;
export function isSupportedPriceMethod(horizon:unknown,method_id:unknown):boolean{
 return typeof horizon==='string'&&Object.hasOwn(PRICE_CALCULATION_METHODS,horizon)
  &&(method_id===PRICE_CALCULATION_METHODS[horizon as Horizon]||horizon==='LONG'&&method_id===LONG_EPS_DIVIDEND_METHOD);
}
export type ScenarioName='conservative'|'base'|'upside';
type DilutionBasis={description:string;evidence_ids:string[]};
type CommonInput={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1';symbol:string;horizon:Horizon;
 cutoff:string;data_through:string;as_of:string;expires_at:string;currency:'TWD';quote_evidence_id:string;
 evidence:AnalysisEvidence[];assumption_basis:{available_at:string;description:string;evidence_ids:string[]};invalidation:string};
type Selection={entry_scenarios:[ScenarioName,ScenarioName];margin_of_safety:number;stop_evidence_ids:string[]};
export type ShortCalculationInput=CommonInput&{horizon:'SHORT';method_id:typeof PRICE_CALCULATION_METHODS.SHORT;
 parameters:{bar_evidence_ids:string[];expected_sessions:string[];atr_period:number;breakout_lookback:number;
 trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK';entry_atr_width:number;stop_atr_multiple:number;tick_size:number;
 corporate_actions_evidence_id:string}};
export type MediumCalculationInput=CommonInput&{horizon:'MEDIUM';method_id:typeof PRICE_CALCULATION_METHODS.MEDIUM;
 parameters:Selection&{earnings_basis:'FORWARD_12_MONTH_DILUTED_EPS'|'NORMALIZED_12_MONTH_DILUTED_EPS'|'FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION'|'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM';
 forecast_period:{start:string;end:string};dilution_basis:DilutionBasis;
 scenarios:{name:ScenarioName;eps:number;pe:number}[]}};
export type LongFcfeCalculationInput=CommonInput&{horizon:'LONG';method_id:typeof PRICE_CALCULATION_METHODS.LONG;
 parameters:Selection&{cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI';
 timing:'END_OF_YEAR';dilution_basis:DilutionBasis;
 scenarios:{name:ScenarioName;cashflows:number[];discount_rate:number;terminal:null|{next_fcfe:number;growth:number}}[]}};
export type LongEpsDividendCalculationInput=CommonInput&{horizon:'LONG';method_id:typeof LONG_EPS_DIVIDEND_METHOD;
 parameters:Selection&{earnings_basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM';earnings_period:{start:string;end:string};dilution_basis:DilutionBasis;
 scenarios:{name:ScenarioName;eps_growth_rates:number[];payout_ratios:number[];required_return:number;terminal_pe:number}[]}};
export type LongCalculationInput=LongFcfeCalculationInput|LongEpsDividendCalculationInput;
export type DailyAiPriceCalculationInput=ShortCalculationInput|MediumCalculationInput|LongCalculationInput;

export class PriceCalculationError extends Error{
 readonly code:string;readonly field:string;
 constructor(code:string,field:string,detail:string){super(`${code}: ${field}: ${detail}`);this.name='PriceCalculationError';this.code=code;this.field=field;}
}
const fail=(code:string,field:string,detail:string):never=>{throw new PriceCalculationError(code,field,detail);};
const missing=(field:string):never=>fail('PRICE_CALCULATION_MISSING_INPUT',field,'Supply this input explicitly; no value or method default is inferred.');
const invalid=(field:string,detail:string):never=>fail('PRICE_CALCULATION_INVALID_INPUT',field,detail);
function record(value:unknown,field:string):Record<string,unknown>{
 if(value===undefined||value===null)return missing(field);
 if(typeof value!=='object'||Array.isArray(value))return invalid(field,'Expected an object.');return value as Record<string,unknown>;
}
function exact(value:Record<string,unknown>,keys:readonly string[],field:string){
 for(const key of keys)if(!Object.hasOwn(value,key)||value[key]===undefined)missing(`${field}.${key}`);
 if(Object.keys(value).some(key=>!keys.includes(key)))invalid(field,'Unknown fields are not ignored.');
}
function text(value:unknown,field:string,max=1500):string{
 if(value===undefined||value===null||value==='')return missing(field);
 if(typeof value!=='string'||!value.trim()||value.length>max)return invalid(field,'Expected nonempty bounded text.');return value;
}
function number(value:unknown,field:string,min=-Infinity,max=Infinity):number{
 if(value===undefined||value===null)return missing(field);
 if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)return invalid(field,'Expected a finite number within the stated method domain.');return value;
}
function positive(value:unknown,field:string):number{const n=number(value,field);if(n<=0)invalid(field,'A strictly positive number is required.');return n;}
function integer(value:unknown,field:string,min:number,max:number):number{const n=number(value,field,min,max);if(!Number.isInteger(n))invalid(field,'An integer is required.');return n;}
function date(value:unknown,field:string):string{
 const s=text(value,field,10);if(!/^\d{4}-\d\d-\d\d$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))
  ||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)invalid(field,'Use a real YYYY-MM-DD date.');return s;
}
function time(value:unknown,field:string):string{const s=text(value,field,40);if(!validObservationTime(s))invalid(field,'A timezone-qualified observation timestamp is required.');return s;}
function ids(value:unknown,field:string):string[]{
 if(value===undefined||value===null)return missing(field);
 if(!Array.isArray(value)||!value.length||value.length>100)return invalid(field,'Supply one to 100 unique source IDs.');
 const result=value.map((v,i)=>text(v,`${field}[${i}]`,200));if(new Set(result).size!==result.length)invalid(field,'Duplicate source IDs.');return result;
}
/** Decimal inputs are exact rational numbers until the method's price
 * quantization. This prevents binary floating-point noise from adding a tick
 * or removing a cent. Intermediate display values remain ordinary numbers. */
type Fraction={n:bigint;d:bigint};
const abs=(v:bigint)=>v<0n?-v:v;
function rational(n:bigint,d=1n):Fraction{
 if(d===0n)return invalid('arithmetic','A denominator cannot be zero.');
 if(d<0n){n=-n;d=-d;}let a=abs(n),b=d;while(b){const rest=a%b;a=b;b=rest;}const gcd=a||1n;return {n:n/gcd,d:d/gcd};
}
function fraction(value:number):Fraction{
 const match=/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
 if(!match)return invalid('arithmetic','Only finite decimal inputs can be evaluated.');
 const tail=match[3]??'',exponent=Number(match[4]??0)-tail.length;
 const n=BigInt((match[1]??'')+match[2]+tail);return exponent>=0?rational(n*10n**BigInt(exponent)):rational(n,10n**BigInt(-exponent));
}
const add=(a:Fraction,b:Fraction)=>rational(a.n*b.d+b.n*a.d,a.d*b.d);
const sub=(a:Fraction,b:Fraction)=>rational(a.n*b.d-b.n*a.d,a.d*b.d);
const mul=(a:Fraction,b:Fraction)=>rational(a.n*b.n,a.d*b.d);
const div=(a:Fraction,b:Fraction)=>rational(a.n*b.d,a.d*b.n);
const power=(a:Fraction,n:number)=>rational(a.n**BigInt(n),a.d**BigInt(n));
function decimalValue(value:Fraction):number{
 const numeratorNumber=Number(value.n),denominatorNumber=Number(value.d);
 if(Number.isFinite(numeratorNumber)&&Number.isFinite(denominatorNumber))return numeratorNumber/denominatorNumber;
 const numerator=abs(value.n).toString(),denominator=value.d.toString();
 const n=Number(numerator.slice(0,16))/10**(Math.min(numerator.length,16)-1),d=Number(denominator.slice(0,16))/10**(Math.min(denominator.length,16)-1);
 return (value.n<0n?-1:1)*(n/d)*10**(numerator.length-denominator.length);
}
const floorFraction=(v:Fraction)=>v.n>=0n?v.n/v.d:-((-v.n+v.d-1n)/v.d);
const ceilFraction=(v:Fraction)=>-floorFraction({n:-v.n,d:v.d});
function centsPrice(cents:bigint):number{
 if(cents<=0n||cents>BigInt(Number.MAX_SAFE_INTEGER))return invalid('quantized_price','A positive price with safe integer cents is required.');return Number(cents)/100;
}
const floorCents=(value:Fraction)=>centsPrice(floorFraction(mul(value,rational(100n))));
const deepFreeze=<T>(value:T):T=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;};
function parsedContent(source:AnalysisEvidence):Record<string,unknown>{
 try{return record(JSON.parse(source.content),`evidence.${source.id}.content`);}catch(error){
  if(error instanceof PriceCalculationError)throw error;
  return fail('PRICE_CALCULATION_SOURCE_CONTENT',source.id,'This method requires structured JSON content, not an inferred value from prose.');
 }
}
function latestCompletedTaiwanSession(cutoff:string):string{
 const localDate=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
 if(!coveredCalendarDate('TW',localDate))return fail('PRICE_CALCULATION_CALENDAR',localDate,'The retained exchange calendar does not cover this date.');
 // Match the existing daily refresh: the retained daily endpoints include
 // block-trade volume through 17:00, followed by its existing five-minute buffer.
 const result=isMarketTradingDate('TW',localDate)&&compareTime(cutoff,localDate+'T17:05:00+08:00')>=0
  ?localDate:previousMarketTradingDate('TW',localDate);
 if(!result)return fail('PRICE_CALCULATION_CALENDAR',localDate,'The previous completed exchange session is unavailable.');return result;
}

/** PRICE contents are read from the actual cited evidence. There is no second
 * externally supplied quote/bar number that could diverge from the packet. */
export async function calculateDailyAiPricePlan(input:DailyAiPriceCalculationInput|unknown,now=Date.now()){
 const owned=structuredClone(input),r=record(owned,'input');
 exact(r,['schema','symbol','horizon','cutoff','data_through','as_of','expires_at','currency','method_id','quote_evidence_id','evidence','assumption_basis','invalidation','parameters'],'input');
 if(r.schema!=='DAILY_AI_PRICE_CALCULATION_INPUT_V1'||r.currency!=='TWD')invalid('input.schema/currency','The method uses version 1 and TWD common-share prices only.');
 const symbol=text(r.symbol,'symbol',6),horizon=text(r.horizon,'horizon',6) as Horizon;
 if(!/^\d{4,6}$/.test(symbol)||!Object.hasOwn(PRICE_CALCULATION_METHODS,horizon))invalid('symbol/horizon','A supported stock and horizon are required.');
 const method_id=text(r.method_id,'method_id',200);
 if(!isSupportedPriceMethod(horizon,method_id))fail('PRICE_CALCULATION_METHOD_MISMATCH','method_id','Use an explicitly supported versioned method for this horizon; legacy policies are not promoted.');
 const cutoff=time(r.cutoff,'cutoff'),as_of=time(r.as_of,'as_of'),expires_at=time(r.expires_at,'expires_at'),data_through=date(r.data_through,'data_through');
 if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))invalid('now','A valid execution timestamp is required.');
 const current=new Date(now).toISOString();
 if(compareTime(cutoff,as_of)>0||compareTime(as_of,current)>0||compareTime(current,expires_at)>=0)
  fail('PRICE_CALCULATION_TIME_SCOPE','as_of/expires_at','Use a new unexpired calculation at or after the evidence cutoff; timestamps are never extended here.');
 if(data_through!==latestCompletedTaiwanSession(cutoff))fail('PRICE_CALCULATION_STALE_QUOTE','data_through','The quote must be from the latest completed Taiwan session at the supplied cutoff.');
 if(!Array.isArray(r.evidence)||!r.evidence.length)return missing('evidence');
 const evidence=r.evidence as AnalysisEvidence[];
 try{validateAnalysisPacket({symbol,company:symbol,cutoff,evidence,data_through});}
 catch{return fail('PRICE_CALCULATION_SOURCE_INVALID','evidence','Source identity, content, receipt and publication chronology must pass the existing analysis-packet contract.');}
 const byId=new Map(evidence.map(e=>[e.id,e]));
 for(const source of evidence){
  if(compareTime(source.available_at,cutoff)>0||source.published_at!==null&&compareTime(source.published_at,source.available_at)>0
   ||source.first_seen_at!==undefined&&compareTime(source.first_seen_at,source.available_at)>0
   ||source.as_of!==undefined&&compareTime(source.as_of,source.available_at)>0)
   fail('PRICE_CALCULATION_SOURCE_TIME',source.id,'Source timestamps cannot be after the cutoff, even by fractional milliseconds.');
  if(source.evidence_hash!==undefined&&!hashValid(source.evidence_hash))fail('PRICE_CALCULATION_SOURCE_HASH',source.id,'Invalid original source digest.');
 }
 const used=new Set<string>();
 const source=(id:string,field:string,kind?:AnalysisEvidence['kind'])=>{
  const e=byId.get(id);if(!e)return fail('PRICE_CALCULATION_SOURCE_MISSING',field,`Evidence ${id} is not present.`);
  if(e.symbol!==symbol||kind!==undefined&&e.kind!==kind)fail('PRICE_CALCULATION_SOURCE_IDENTITY',field,'The source must belong to this stock and the required evidence kind.');
  used.add(id);return e;
 };
 const reference=(value:unknown,field:string,nonPrice=false)=>ids(value,field).map(id=>{
  const e=source(id,field);if(nonPrice&&e.kind==='PRICE')fail('PRICE_CALCULATION_SOURCE_KIND',field,'Cite a financial/company premise, not a price-only source.');return id;
 });
 const assumption=record(r.assumption_basis,'assumption_basis');exact(assumption,['available_at','description','evidence_ids'],'assumption_basis');
 // The source cutoff freezes observed inputs, not the later act of analysis.
 // Keep the actual formation time and never claim a locked forecast at cutoff.
 const assumptionsAt=time(assumption.available_at,'assumption_basis.available_at');
 if(compareTime(assumptionsAt,as_of)>0)
  fail('PRICE_CALCULATION_ASSUMPTION_TIME','assumption_basis.available_at','Assumptions must exist by calculation.as_of; retain their actual formation time instead of backdating it to the source cutoff.');
 const assumptionsAfterCutoff=compareTime(assumptionsAt,cutoff)>0;
 const assumptionDescription=text(assumption.description,'assumption_basis.description',1500);
 reference(assumption.evidence_ids,'assumption_basis.evidence_ids');
 const quoteId=text(r.quote_evidence_id,'quote_evidence_id',200),quoteSource=source(quoteId,'quote_evidence_id','PRICE'),quote=parsedContent(quoteSource);
 if(date(quote.date,'quote.date')!==data_through)fail('PRICE_CALCULATION_SOURCE_IDENTITY',quoteId,'Quote date and data_through must match.');
 if(quote.currency!==undefined&&quote.currency!=='TWD'||quote.price_basis!==undefined&&quote.price_basis!=='RAW_UNADJUSTED')
  fail('PRICE_CALCULATION_SOURCE_BASIS',quoteId,'Currency or adjusted-price basis conflicts with the TWD quoted common share.');
 if(compareTime(quoteSource.available_at,data_through+'T13:30:00+08:00')<0)
  fail('PRICE_CALCULATION_SOURCE_TIME',quoteId,'A completed close cannot be available before the exchange session closes.');
 const lastQuote=positive(quote.close,'quote.close'),parameters=record(r.parameters,'parameters');
 const invalidation=text(r.invalidation,'invalidation');
 let entry_range:[number,number],wait_above:number,stop_kind:'PRICE'|'EVENT',stop:number|null;
 let stop_evidence_ids:string[],basis:string,derivation:string;
 let trace:Record<string,unknown>;
 const limitations=['This arithmetic does not validate a trading strategy, forecast accuracy or source-use permission.',
  'Scenario names are labels, not probabilities or guarantees. Independent method and content review remains required.',
  'A hash binds the supplied content and calculation; it does not prove issuer truth or a qualified reviewer decision.'];
 const dilution=()=>{
  const d=record(parameters.dilution_basis,'parameters.dilution_basis');exact(d,['description','evidence_ids'],'parameters.dilution_basis');
  const description=text(d.description,'parameters.dilution_basis.description',1500);
  const evidence_ids=reference(d.evidence_ids,'parameters.dilution_basis.evidence_ids',true);return {description,evidence_ids};
 };
 const selection=(values:{name:ScenarioName;value:number}[],exactValues:Fraction[])=>{
  if(values.length!==3||values.map(s=>s.name).join('|')!=='conservative|base|upside')invalid('parameters.scenarios','Supply conservative, base and upside scenarios in that order.');
  if(values.some(v=>!Number.isFinite(v.value)||v.value<=0))invalid('parameters.scenarios','Every resulting value must be positive and finite for a price range.');
  if(values[0].value>values[1].value||values[1].value>values[2].value)invalid('parameters.scenarios','Scenario results must retain conservative <= base <= upside; do not silently reorder them.');
  const names=parameters.entry_scenarios;
  if(!Array.isArray(names))return invalid('parameters.entry_scenarios','Explicitly select the two scenario endpoints for the entry interval.');
  if(names.length!==2||names.some(n=>!values.some(v=>v.name===n)))invalid('parameters.entry_scenarios','Explicitly select the two scenario endpoints for the entry interval.');
  const margin=number(parameters.margin_of_safety,'parameters.margin_of_safety',0,1);
  if(margin>=1)invalid('parameters.margin_of_safety','The explicit discount must be smaller than 1.');
  const discount=sub(rational(1n),fraction(margin));
  const lower=floorCents(mul(exactValues[values.findIndex(v=>v.name===names[0])],discount)),upper=floorCents(mul(exactValues[values.findIndex(v=>v.name===names[1])],discount));
  if(lower>upper)invalid('parameters.entry_scenarios','Entry endpoints are reversed.');
  entry_range=[lower,upper];wait_above=upper;stop_kind='EVENT';stop=null;
  stop_evidence_ids=reference(parameters.stop_evidence_ids,'parameters.stop_evidence_ids',true);
  return {entry_scenarios:[...names],margin_of_safety:margin,formula:'floor_to_TWD_0.01(selected_scenario_value * (1 - margin_of_safety))',
   quantization:{unit:'TWD_PER_COMMON_SHARE',quantum:0.01,direction:'DOWN',purpose:'RESEARCH_DISPLAY_PRECISION_NOT_EXCHANGE_TICK'}};
 };
 if(horizon==='SHORT'){
  exact(parameters,['bar_evidence_ids','expected_sessions','atr_period','breakout_lookback','trigger_rule','entry_atr_width','stop_atr_multiple','tick_size','corporate_actions_evidence_id'],'parameters');
  const period=integer(parameters.atr_period,'parameters.atr_period',2,60),lookback=integer(parameters.breakout_lookback,'parameters.breakout_lookback',2,period);
  if(parameters.trigger_rule!=='PRIOR_WINDOW_HIGH_PLUS_TICK')invalid('parameters.trigger_rule','Use the explicitly defined prior-window trigger; no other trigger is inferred.');
  const barIds=ids(parameters.bar_evidence_ids,'parameters.bar_evidence_ids'),sessions=parameters.expected_sessions;
  if(!Array.isArray(sessions))return invalid('parameters.expected_sessions','Supply the explicit ordered exchange-session list.');
  if(sessions.length!==period+1||barIds.length!==period+1)invalid('parameters.expected_sessions','ATR requires exactly atr_period + 1 consecutive completed bars.');
  const dates=sessions.map((d,i)=>date(d,`parameters.expected_sessions[${i}]`));
  if(dates.at(-1)!==data_through||new Set(dates).size!==dates.length)invalid('parameters.expected_sessions','The unique ordered session list must end at data_through.');
  for(let i=dates.length-1;i>=0;i--)if(!isMarketTradingDate('TW',dates[i])||i>0&&previousMarketTradingDate('TW',dates[i])!==dates[i-1])
   fail('PRICE_CALCULATION_SESSION_GAP','parameters.expected_sessions','Supply the exact consecutive retained exchange sessions, including any missing bar.');
  const bars=barIds.map((id,i)=>{
   const s=source(id,`parameters.bar_evidence_ids[${i}]`,'PRICE'),b=parsedContent(s);
   if(date(b.date,`bar.${id}.date`)!==dates[i])fail('PRICE_CALCULATION_SOURCE_IDENTITY',id,'Bar and expected-session order differ.');
   const open=positive(b.open,`bar.${id}.open`),high=positive(b.high,`bar.${id}.high`),low=positive(b.low,`bar.${id}.low`),close=positive(b.close,`bar.${id}.close`);
   if(high<Math.max(open,close)||low>Math.min(open,close)||low>high)invalid(`bar.${id}`,'OHLC ordering is invalid.');
   if(b.currency!==undefined&&b.currency!=='TWD'||b.price_basis!==undefined&&b.price_basis!=='RAW_UNADJUSTED')fail('PRICE_CALCULATION_SOURCE_BASIS',id,'Do not mix currencies or adjusted and raw bars.');
   if(compareTime(s.available_at,dates[i]+'T13:30:00+08:00')<0)fail('PRICE_CALCULATION_SOURCE_TIME',id,'The bar was recorded before its completed session.');
   return {id,date:dates[i],open,high,low,close,session_scope:text(b.session_scope,`bar.${id}.session_scope`,100)};
  });
  if(barIds.at(-1)!==quoteId||bars.at(-1)!.close!==lastQuote||new Set(bars.map(b=>b.session_scope)).size!==1)
   fail('PRICE_CALCULATION_SOURCE_IDENTITY','quote/bar','Quote must be the final bar; all bars must use the same session scope.');
  const coverageId=text(parameters.corporate_actions_evidence_id,'parameters.corporate_actions_evidence_id',200),coverageSource=source(coverageId,'parameters.corporate_actions_evidence_id');
  if(coverageSource.kind==='PRICE')fail('PRICE_CALCULATION_SOURCE_KIND',coverageId,'Company-action coverage must be a separate non-price source.');
  const coverage=parsedContent(coverageSource);
  if(coverage.kind!=='CORPORATE_ACTION_COVERAGE'||coverage.symbol!==symbol||coverage.status!=='NO_ACTIONS'
   ||coverage.price_basis!=='RAW_UNADJUSTED'||date(coverage.from,'corporate_actions.from')>dates[0]
   ||date(coverage.through,'corporate_actions.through')<data_through)
   fail('PRICE_CALCULATION_ACTION_COVERAGE','parameters.corporate_actions_evidence_id','Supply a complete no-action coverage record for this raw-price window; an adjustment policy is otherwise required.');
  const coverageEnd=date(coverage.through,'corporate_actions.through')+'T13:30:00+08:00';
  const coverageObservedAt=coverageSource.as_of??coverageSource.published_at??coverageSource.first_seen_at??coverageSource.available_at;
  if(compareTime(coverageSource.available_at,coverageEnd)<0||compareTime(coverageObservedAt,coverageEnd)<0)
   fail('PRICE_CALCULATION_ACTION_COVERAGE_TIME',coverageId,'A completed no-action coverage assertion must be observed after the last covered session closes; future absence is not inferred.');
  const width=number(parameters.entry_atr_width,'parameters.entry_atr_width',0),stopMultiple=positive(parameters.stop_atr_multiple,'parameters.stop_atr_multiple'),tick=positive(parameters.tick_size,'parameters.tick_size');
  const trueRangeFractions=bars.slice(1).map((bar,i)=>{
   const candidates=[sub(fraction(bar.high),fraction(bar.low)),sub(fraction(bar.high),fraction(bars[i].close)),sub(fraction(bar.low),fraction(bars[i].close))].map(q=>rational(abs(q.n),q.d));
   return candidates.reduce((a,b)=>a.n*b.d>=b.n*a.d?a:b);
  });
  const atrFraction=div(trueRangeFractions.reduce(add,rational(0n)),fraction(period)),trueRanges=trueRangeFractions.map(decimalValue),atr=decimalValue(atrFraction);
  if(!Number.isFinite(atr)||atr<=0)invalid('ATR','A positive finite observed average true range is required.');
  const resistance=Math.max(...bars.slice(-lookback-1,-1).map(b=>b.high));
  const tickCentsFraction=mul(fraction(tick),rational(100n));
  if(tickCentsFraction.d!==1n||tickCentsFraction.n>BigInt(Number.MAX_SAFE_INTEGER))invalid('parameters.tick_size','The explicit research tick must be representable in whole TWD cents.');
  const tickCents=tickCentsFraction.n,triggerCents=ceilFraction(div(mul(add(fraction(resistance),fraction(tick)),rational(100n)),rational(tickCents)))*tickCents;
  const triggerFraction=rational(triggerCents,100n);
  const upperCents=floorFraction(div(mul(add(triggerFraction,mul(atrFraction,fraction(width))),rational(100n)),rational(tickCents)))*tickCents;
  const stopCents=floorFraction(div(mul(sub(triggerFraction,mul(atrFraction,fraction(stopMultiple))),rational(100n)),rational(tickCents)))*tickCents;
  const trigger=centsPrice(triggerCents),upper=centsPrice(upperCents),loss=centsPrice(stopCents);
  if(![trigger,upper,loss].every(Number.isFinite)||loss<=0||loss>=trigger||upper<trigger)invalid('short_calculation','The explicit multipliers and tick produce an invalid entry/stop interval.');
  entry_range=[trigger,upper];wait_above=upper;stop_kind='PRICE';stop=loss;stop_evidence_ids=[...barIds];
  basis='前一完整價格窗口高點加明列 tick，搭配算術平均 True Range；僅條件研究，未校準為正式進場策略。';
  derivation='TR_t=max(high_t-low_t,abs(high_t-close_(t-1)),abs(low_t-close_(t-1))); ATR=sum(TR)/atr_period. trigger=ceil((prior_window_high+tick)/tick)*tick; upper=floor((trigger+ATR*entry_atr_width)/tick)*tick; stop=floor((trigger-ATR*stop_atr_multiple)/tick)*tick. Exact decimal-rational arithmetic and integer TWD cents perform all tick quantization before review. The tick and all multipliers are explicit supplied assumptions.';
  trace={quote:lastQuote,bar_window:dates,true_ranges:trueRanges,atr,prior_window_high:resistance,trigger,upper,stop:loss,corporate_actions_evidence_id:coverageId,
   quantization:{tick_size:tick,storage_unit:'INTEGER_TWD_CENTS',purpose:'EXPLICIT_RESEARCH_TICK_NOT_CERTIFIED_EXCHANGE_SCHEDULE'}};
  limitations.push('ATR uses an arithmetic mean, not Wilder smoothing. No calibrated win rate, return target, fill or slippage is claimed.','The supplied tick must match the intended exchange price band; this module does not invent or certify exchange tick rules.');
 }else if(horizon==='MEDIUM'){
  exact(parameters,['earnings_basis','forecast_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids'],'parameters');
  if(!['FORWARD_12_MONTH_DILUTED_EPS','NORMALIZED_12_MONTH_DILUTED_EPS','FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION','REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM'].includes(String(parameters.earnings_basis)))invalid('parameters.earnings_basis','Use an explicit diluted 12-month assumption or a source-verified four-quarter diluted EPS sum; basic and cumulative observations are not substituted.');
  const period=record(parameters.forecast_period,'parameters.forecast_period');exact(period,['start','end'],'parameters.forecast_period');
  const start=date(period.start,'parameters.forecast_period.start'),end=date(period.end,'parameters.forecast_period.end');
  const anniversary=new Date(start+'T00:00:00Z');anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
  const requiredEnd=new Date(anniversary.getTime()-86400000).toISOString().slice(0,10);
  if(end!==requiredEnd||parameters.earnings_basis==='FORWARD_12_MONTH_DILUTED_EPS'&&start<=data_through)
   invalid('parameters.forecast_period','Supply the exact twelve-month period; a forward period must begin after the quoted data date.');
  if(parameters.earnings_basis==='FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION'&&data_through>end)
   invalid('parameters.forecast_period','The explicitly fixed twelve-month earnings period has ended; it must not be rolled or extended automatically.');
  const dilutionBasis=dilution();
  const reportedBasis=parameters.earnings_basis==='REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM';
  let reportedEps:ReturnType<typeof readReportedDilutedQuarterSeries>['value']=null;
  if(reportedBasis){
   const reported=readReportedDilutedQuarterSeries({symbol,data_through,evidence});reportedEps=reported.value;
   if(!reportedEps)return fail('PRICE_CALCULATION_REPORTED_EPS_BASIS','parameters.earnings_basis',reported.missing.map(m=>m.code+': '+m.field).join('; '));
   if(start!==reportedEps.period.start||end!==reportedEps.period.end||end>data_through)
    invalid('parameters.forecast_period','The compatibility period field must identify the exact four reported quarters ending by the quote date; it is not a forward forecast.');
   for(const id of reportedEps.evidence_ids){source(id,'parameters.dilution_basis.evidence_ids','FINANCIAL');
    if(!dilutionBasis.evidence_ids.includes(id))invalid('parameters.dilution_basis.evidence_ids','Cite all four reported diluted EPS observations.');}
  }
  if(!Array.isArray(parameters.scenarios)||parameters.scenarios.length!==3)return missing('parameters.scenarios');
  const exactValues:Fraction[]=[];
  const scenarios=parameters.scenarios.map((v,i)=>{const s=record(v,`parameters.scenarios[${i}]`);exact(s,['name','eps','pe'],`parameters.scenarios[${i}]`);
   const name=text(s.name,`parameters.scenarios[${i}].name`,20) as ScenarioName,eps=positive(s.eps,`parameters.scenarios[${i}].eps`),pe=positive(s.pe,`parameters.scenarios[${i}].pe`);
   if(reportedEps&&eps!==reportedEps.value)invalid(`parameters.scenarios[${i}].eps`,'The actual-data basis must equal the exact sum derived from the four cited diluted EPS observations; an assumed earnings value cannot be relabelled as reported.');
   const value=mul(fraction(eps),fraction(pe));exactValues.push(value);
   return {name,eps,pe,value:decimalValue(value),classification:reportedBasis?'REPORTED_QUARTER_EPS_SUM_WITH_EXPLICIT_PE_ASSUMPTION':'EXPLICIT_ANALYST_ASSUMPTION_NOT_ISSUER_FORECAST'};});
  const selected=selection(scenarios,exactValues);
  basis='明列十二個月稀釋 EPS × 明列本益比情境，再依明列折讓與情境端點計算研究區間；未把歷史 EPS 自動外推。';
  derivation='scenario_value_TWD_per_diluted_common_share = assumed_12_month_diluted_EPS_TWD * assumed_PE. Entry endpoints = explicitly selected scenario values * (1 - explicit margin_of_safety), rounded DOWN to TWD 0.01 using exact decimal arithmetic before review. TWD 0.01 is research display precision, not a verified exchange order tick. Full scenario values remain in the trace. No issuer consensus, forecast or multiple is inferred.';
  if(reportedBasis){
   basis='四個連續季度直接揭露的稀釋普通股 EPS 加總 × 明列本益比情境，再依明列折讓計算研究區間；不是重新加權的會計 TTM EPS，也不是未來獲利預測。';
   derivation='reported_EPS_sum = sum of exactly four consecutive directly reported SINGLE_QUARTER, DILUTED, TWD_PER_COMMON_SHARE EPS decimals from the unchanged evidence packet. scenario_value = reported_EPS_sum * explicit_PE. Selected endpoints use the explicit discount and exact downward TWD 0.01 display quantization. This adds disclosed quarterly ratios; it does not reconstruct a weighted annual denominator or forecast earnings.';
  }
  trace={quote:lastQuote,earnings_basis:parameters.earnings_basis,forecast_period:{start,end},dilution_basis:dilutionBasis,scenarios,selection:selected,
   ...(reportedBasis?{earnings_period:{start,end},reported_eps_sum:reportedEps,period_field_semantics:'HISTORICAL_EARNINGS_PERIOD_NOT_FORECAST'}:{})};
  limitations.push(reportedBasis?'The historical EPS sum adds four disclosed quarterly diluted ratios; it is not an issuer-reported or reweighted annual EPS. PE multiples and discounts remain explicit policy assumptions and are not validated investment recommendations.':'EPS, normalization, dilution and PE multiples are supplied assumptions; the calculation does not verify their economic appropriateness.');
 }else if(method_id===LONG_EPS_DIVIDEND_METHOD){
  exact(parameters,['earnings_basis','earnings_period','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids'],'parameters');
  if(parameters.earnings_basis!=='REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM')invalid('parameters.earnings_basis','The dividend/terminal-PE model starts only from the source-verified sum of four directly reported diluted quarter EPS values.');
  const period=record(parameters.earnings_period,'parameters.earnings_period');exact(period,['start','end'],'parameters.earnings_period');
  const start=date(period.start,'parameters.earnings_period.start'),end=date(period.end,'parameters.earnings_period.end'),dilutionBasis=dilution();
  const reported=readReportedDilutedQuarterSeries({symbol,data_through,evidence}),reportedEps=reported.value;
  if(!reportedEps)return fail('PRICE_CALCULATION_REPORTED_EPS_BASIS','parameters.earnings_basis',reported.missing.map(m=>m.code+': '+m.field).join('; '));
  if(start!==reportedEps.period.start||end!==reportedEps.period.end||end>data_through)
   invalid('parameters.earnings_period','Identify exactly the four directly reported quarters ending by the quote date.');
  positive(reportedEps.value,'reported_eps_sum');
  for(const id of reportedEps.evidence_ids){source(id,'parameters.dilution_basis.evidence_ids','FINANCIAL');
   if(!dilutionBasis.evidence_ids.includes(id))invalid('parameters.dilution_basis.evidence_ids','Cite all four diluted EPS observations used as the historical starting point.');}
  if(!Array.isArray(parameters.scenarios)||parameters.scenarios.length!==3)return missing('parameters.scenarios');
  let years:number|null=null;const exactValues:Fraction[]=[];
  const scenarios=parameters.scenarios.map((v,i)=>{
   const field=`parameters.scenarios[${i}]`,s=record(v,field);exact(s,['name','eps_growth_rates','payout_ratios','required_return','terminal_pe'],field);
   const name=text(s.name,field+'.name',20) as ScenarioName;
   if(!Array.isArray(s.eps_growth_rates)||s.eps_growth_rates.length<1||s.eps_growth_rates.length>10)return missing(field+'.eps_growth_rates');
   if(!Array.isArray(s.payout_ratios)||s.payout_ratios.length!==s.eps_growth_rates.length)
    return invalid(field+'.payout_ratios','Supply one explicit payout ratio per projected year.');
   if(years!==null&&years!==s.eps_growth_rates.length)invalid('parameters.scenarios','All scenarios must use the same explicit one-to-ten-year horizon.');
   years=s.eps_growth_rates.length;
   const growthRates=s.eps_growth_rates.map((v,y)=>{const n=number(v,`${field}.eps_growth_rates[${y}]`);if(n<=-1)invalid(`${field}.eps_growth_rates[${y}]`,'An explicit EPS growth rate must be greater than -1.');return n;});
   const payoutRatios=s.payout_ratios.map((v,y)=>number(v,`${field}.payout_ratios[${y}]`,0,1));
   const requiredReturn=positive(s.required_return,field+'.required_return'),terminalPe=positive(s.terminal_pe,field+'.terminal_pe');
   let earnings=fraction(reportedEps.value),dividendPv=rational(0n);
   const yearly=growthRates.map((growth,y)=>{
    earnings=mul(earnings,add(rational(1n),fraction(growth)));
    const dividend=mul(earnings,fraction(payoutRatios[y])),discountFactor=power(add(rational(1n),fraction(requiredReturn)),y+1),pv=div(dividend,discountFactor);
    dividendPv=add(dividendPv,pv);
    const row={year:y+1,growth_rate:growth,payout_ratio:payoutRatios[y],eps:decimalValue(earnings),dividend:decimalValue(dividend),
     discount_factor:decimalValue(discountFactor),dividend_present_value:decimalValue(pv)};
    if(!Object.values(row).every(Number.isFinite))invalid(field,'The supplied assumptions produce nonfinite annual values.');return row;
   });
   const terminalValue=mul(earnings,fraction(terminalPe)),terminalPv=div(terminalValue,power(add(rational(1n),fraction(requiredReturn)),years));
   const value=add(dividendPv,terminalPv);exactValues.push(value);
   return {name,base_reported_eps:reportedEps.value,eps_growth_rates:growthRates,payout_ratios:payoutRatios,required_return:requiredReturn,terminal_pe:terminalPe,
    years:yearly,dividend_present_value:decimalValue(dividendPv),terminal:{year:years,eps:decimalValue(earnings),pe:terminalPe,value:decimalValue(terminalValue),present_value:decimalValue(terminalPv)},
    value:decimalValue(value),terminal_fraction:decimalValue(div(terminalPv,value)),classification:'EXPLICIT_FUTURE_EPS_DIVIDEND_AND_TERMINAL_PE_ASSUMPTIONS_NOT_ISSUER_FORECAST'};
  });
  const selected=selection(scenarios,exactValues);
  basis='四季已披露稀釋 EPS 合計作歷史起點；逐年依明列成長與配息假設折現股利，加上最後一年 EPS × 明列期末本益比的折現值；此方法不宣稱計算 FCFE。';
  derivation='EPS_0 = exact sum of four consecutive source-reported diluted quarterly EPS values. For year t: EPS_t=EPS_(t-1)*(1+explicit_growth_t); dividend_t=EPS_t*explicit_payout_t. Value=sum(dividend_t/(1+explicit_required_return)^t)+EPS_N*explicit_terminal_PE/(1+explicit_required_return)^N. Each dividend is paid at year end. The terminal share price is measured after the final modeled dividend payment, so that dividend is counted once. N is explicitly one to ten years. Entry endpoints apply the explicit scenario selection and discount, with exact downward TWD 0.01 quantization before review. No growth, payout, discount rate or terminal multiple is inferred from historical EPS.';
  trace={quote:lastQuote,earnings_basis:parameters.earnings_basis,earnings_period:{start,end},reported_eps_sum:reportedEps,dilution_basis:dilutionBasis,scenarios,selection:selected,
   timing:'END_OF_YEAR_DIVIDENDS_AND_EX_DIVIDEND_TERMINAL_PRICE',observation_horizon_scope:'REASSESSMENT_WINDOW_NOT_MODEL_VALUE_REALIZATION_DEADLINE'};
  limitations.push('All projected EPS growth, payout ratios, required returns and terminal PE values are explicit policy assumptions, not reported company results, consensus forecasts or probabilities.',
   'Terminal PE expresses an assumed future resale valuation after the final modeled dividend; the trace reports its share of total model value. This model does not establish future cash generation, distribution capacity or terminal-price realization.',
   'The product long-observation window of 3 to 18 months is a reassessment period. It does not imply that a five-year model value, or a value from any other explicit model duration, will be realized within that observation window.',
   'This dividend-plus-terminal-PE method is distinct from FCFE. Missing reinvestment, borrowing, minority-interest or cashflow-quality evidence remains unresolved and cannot be used to qualify a stock or create a review PASS.');
 }else{
  exact(parameters,['cashflow_basis','timing','dilution_basis','scenarios','entry_scenarios','margin_of_safety','stop_evidence_ids'],'parameters');
  if(parameters.cashflow_basis!=='FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI'||parameters.timing!=='END_OF_YEAR')
   invalid('parameters.cashflow_basis/timing','Use explicit FCFE per diluted common share after reinvestment, debt and ownership adjustments, paid at each year end; EPS and consolidated CFO proxies are rejected.');
  const dilutionBasis=dilution();
  if(!Array.isArray(parameters.scenarios)||parameters.scenarios.length!==3)return missing('parameters.scenarios');
  const exactValues:Fraction[]=[];
  const scenarios=parameters.scenarios.map((v,i)=>{
   const s=record(v,`parameters.scenarios[${i}]`);exact(s,['name','cashflows','discount_rate','terminal'],`parameters.scenarios[${i}]`);
   const name=text(s.name,`parameters.scenarios[${i}].name`,20) as ScenarioName;
   if(!Array.isArray(s.cashflows)||!s.cashflows.length||s.cashflows.length>50)return missing(`parameters.scenarios[${i}].cashflows`);
   const flows=s.cashflows.map((n,y)=>number(n,`parameters.scenarios[${i}].cashflows[${y}]`)),rate=positive(s.discount_rate,`parameters.scenarios[${i}].discount_rate`);
   const discountBase=add(rational(1n),fraction(rate)),discountedValues=flows.map((fcfe,y)=>div(fraction(fcfe),power(discountBase,y+1)));
   const discounted=flows.map((fcfe,y)=>({year:y+1,fcfe,discount_factor:decimalValue(power(discountBase,y+1)),present_value:decimalValue(discountedValues[y])}));
   let terminalPV=0;let terminal:null|{next_fcfe:number;growth:number;undiscounted_value:number;present_value:number}=null;
   let exactTerminalPV=rational(0n);
   if(s.terminal!==null){const t=record(s.terminal,`parameters.scenarios[${i}].terminal`);exact(t,['next_fcfe','growth'],`parameters.scenarios[${i}].terminal`);
    const next=positive(t.next_fcfe,`parameters.scenarios[${i}].terminal.next_fcfe`),growth=number(t.growth,`parameters.scenarios[${i}].terminal.growth`);
    if(growth<=-1||rate<=growth)invalid(`parameters.scenarios[${i}].terminal`,'Terminal growth must exceed -1 and remain strictly below the discount rate.');
    const exactTerminalValue=div(fraction(next),sub(fraction(rate),fraction(growth)));exactTerminalPV=div(exactTerminalValue,power(discountBase,flows.length));
    const terminalValue=decimalValue(exactTerminalValue);terminalPV=decimalValue(exactTerminalPV);
    terminal={next_fcfe:next,growth,undiscounted_value:terminalValue,present_value:terminalPV};
   }
   const exactExplicitPV=discountedValues.reduce(add,rational(0n)),exactValue=add(exactExplicitPV,exactTerminalPV);
   exactValues.push(exactValue);const explicitPV=decimalValue(exactExplicitPV),value=decimalValue(exactValue);
   if(discounted.some(d=>!Number.isFinite(d.discount_factor)||!Number.isFinite(d.present_value))||!Number.isFinite(terminalPV))invalid(`parameters.scenarios[${i}]`,'The supplied rate or vector causes non-finite arithmetic.');
   return {name,value,discount_rate:rate,discounted_cashflows:discounted,explicit_period_pv:explicitPV,terminal,
    terminal_fraction:value>0?terminalPV/value:null,classification:'EXPLICIT_ANALYST_FCFE_FORECAST_NOT_REPORTED_EARNINGS'};
  });
  if(new Set(scenarios.map(s=>s.discounted_cashflows.length)).size!==1)invalid('parameters.scenarios','All scenarios must use the same explicit forecast horizon.');
  const selected=selection(scenarios,exactValues);
  basis='逐年明列每稀釋普通股 FCFE 折現，加獨立明列下一年 FCFE 的終值；區間依明列折讓與情境端點計算。';
  derivation='PV=sum(FCFE_t/(1+r)^t,t=1..N)+[explicit_FCFE_(N+1)/(r-g)]/(1+r)^N, with r>g. Each supplied annual FCFE already includes that year\'s reinvestment, net debt, NCI and dilution adjustments. Terminal cash is supplied separately; it is never synthesized from EPS or year-N cash. Entry endpoints = selected scenario PV * (1-margin_of_safety), rounded DOWN to TWD 0.01 by exact decimal-rational arithmetic before review. This is research display precision, not a verified exchange order tick; full scenario values remain in the trace.';
  trace={quote:lastQuote,cashflow_basis:parameters.cashflow_basis,timing:parameters.timing,dilution_basis:dilutionBasis,scenarios,selection:selected};
  limitations.push('Cash-flow vectors, dilution, discount rates and terminal growth are supplied forecast assumptions; no automatic normalization or calibration is performed.','Negative explicit-year FCFE is retained. A non-positive total valuation cannot form a positive entry interval.');
 }
 const evidence_ids=[...used].sort(),evidence_bindings=[];
 for(const id of evidence_ids)evidence_bindings.push({id,evidence_hash:await snapshotHash(byId.get(id)!)});
 const input_hash=await snapshotHash(owned),assumption_hash=await snapshotHash({method_id,assumption_basis:assumption,parameters});
 const assumptionTiming=assumptionsAfterCutoff?'ASSUMPTIONS_FORMED_AFTER_SOURCE_CUTOFF':'ASSUMPTIONS_AVAILABLE_BY_SOURCE_CUTOFF';
 trace={...trace!,temporal_scope:{source_cutoff:cutoff,assumptions_available_at:assumptionsAt,calculation_as_of:as_of,assumption_timing:assumptionTiming}};
 limitations.push('This is an AS_OF calculation made at its recorded as_of time, not a prospectively locked signal at the earlier source cutoff; it creates no performance record.');
 if(assumptionsAfterCutoff)limitations.push('ASSUMPTIONS_FORMED_AFTER_SOURCE_CUTOFF: source observations remain frozen at cutoff, while the later assumption-formation time is preserved and must not be backdated.');
 const payload={schema:'DAILY_AI_PRICE_CALCULATION_V1' as const,status:'CALCULATED_REVIEW_REQUIRED' as const,symbol,horizon,cutoff,data_through,as_of,expires_at,
  method_id,method:method_id,currency:'TWD' as const,basis:basis!,entry_range:entry_range!,wait_above:wait_above!,stop_kind:stop_kind!,stop:stop!,stop_evidence_ids:stop_evidence_ids!,invalidation,evidence_ids,
  method_note:{name:method_id,derivation:derivation!,assumptions:[assumptionDescription,'Every model parameter is explicit and recorded in the immutable calculation input.'],limitations,source_use_scope:'PRIVATE_RESEARCH_ONLY' as const},
  input_hash,assumption_hash,evidence_bindings,trace:trace!,analysis_mode:'AS_OF_RESEARCH' as const,forecast:false as const,performance_available:false as const,
  research_only:true as const,production_eligible:false as const,buy_ready:false as const,review:null};
 const calculation_hash=await snapshotHash(payload);
 return deepFreeze({...payload,calculation_hash});
}
