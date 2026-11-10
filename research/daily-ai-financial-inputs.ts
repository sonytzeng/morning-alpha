/** Read actual financial observations from an immutable daily packet. This
 * module does not forecast earnings, choose multiples, normalize cash or grant
 * a source/review approval. Derived values never become new packet evidence. */
import {compareTime,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {validateAnalysisPacket,type AnalysisEvidence,type AnalysisPacket} from './daily-ai-analysis.ts';
import type {MediumCalculationInput,LongEpsDividendCalculationInput,ScenarioName} from './daily-ai-price-calculation.ts';
import {parseSecQuarterFinancials,type SecQuarterDocument} from './sec-quarter-financials.ts';

export type FinancialInputMissing={code:string;field:string;detail:string};
type QuarterRow={period:string;value:number;reported_decimal:string;evidence_id:string};
export type ReportedDilutedEpsSum={basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM';value:number;reported_sum_decimal:string;
 currency:'TWD';unit:'TWD_PER_COMMON_SHARE';period:{start:string;end:string};quarters:QuarterRow[];evidence_ids:string[];
 issuer_reported_ttm:false;weighted_denominator_recomputed:false;forecast:false};
export type MediumActualPricePolicy={schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1';version:string;symbol:string;horizon:'MEDIUM';
 formed_at:string;description:string;evidence_ids:string[];earnings_period:{start:string;end:string};
 pe_scenarios:{name:ScenarioName;pe:number}[];entry_scenarios:[ScenarioName,ScenarioName];margin_of_safety:number;invalidation:string};
export type LongActualPricePolicy=Omit<MediumActualPricePolicy,'horizon'|'pe_scenarios'>&{horizon:'LONG';
 method_id:'LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1';
 scenarios:{name:ScenarioName;eps_growth_rates:number[];payout_ratios:number[];required_return:number;terminal_pe:number}[]};
export type ActualPricePolicy=MediumActualPricePolicy|LongActualPricePolicy;
export class FinancialInputError extends Error{
 readonly code:string;readonly field:string;
 constructor(code:string,field:string){super(`${code}: ${field}`);this.name='FinancialInputError';this.code=code;this.field=field;}
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const invalid=(field:string):never=>{throw new FinancialInputError('ACTUAL_FINANCIAL_INPUT_INVALID',field);};
const missing=(code:string,field:string,detail:string):FinancialInputMissing=>({code,field,detail});
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.freeze(v);for(const child of Object.values(v))freeze(child);}return v;};
function content(e:AnalysisEvidence):Record<string,unknown>|null{
 try{const c=JSON.parse(e.content);return object(c)?c:null;}catch{return null;}
}
function quarter(period:unknown){
 if(typeof period!=='string')return null;const m=/^(20\d\d)-Q([1-4])$/.exec(period);if(!m)return null;
 const year=Number(m[1]),q=Number(m[2]),start=`${year}-${String((q-1)*3+1).padStart(2,'0')}-01`,end=new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10);
 return {period,rank:year*4+q,start,end};
}
function exactDecimal(value:unknown,reported:unknown){
 if(typeof value!=='number'||!Number.isFinite(value))return null;
 const text=reported===undefined?String(value):reported;
 if(typeof text!=='string'||! /^-?\d{1,12}(?:\.\d{1,8})?$/.test(text)||Number(text)!==value)return null;
 const [integer,tail='']=text.split('.');return {value,text,n:BigInt(integer+tail),scale:tail.length};
}
function sumDecimals(values:NonNullable<ReturnType<typeof exactDecimal>>[]){
 const scale=Math.max(...values.map(v=>v.scale)),total=values.reduce((sum,v)=>sum+v.n*10n**BigInt(scale-v.scale),0n);
 const absolute=(total<0n?-total:total).toString().padStart(scale+1,'0');
 const decimal=(total<0n?'-':'')+(scale?absolute.slice(0,-scale)+'.'+absolute.slice(-scale):absolute);
 const value=Number(decimal);if(!Number.isFinite(value))invalid('sum');return {value,decimal};
}
function rowsFor(evidence:AnalysisEvidence[],symbol:string,kind:string){
 return evidence.filter(e=>e.kind==='FINANCIAL'&&e.symbol===symbol).map(source=>({source,body:content(source)}))
  .filter(row=>row.body?.kind===kind);
}
/** The last four observed EPS quarters must all qualify. An unsupported new
 * quarter is never skipped in favor of an older favorable four-quarter window.
 * The caller validates packet/source chronology before invoking this reader. */
export function readReportedDilutedQuarterSeries(input:{symbol:string;data_through:string;evidence:AnalysisEvidence[]}):
 {value:ReportedDilutedEpsSum|null;missing:FinancialInputMissing[]}{
 const rows=rowsFor(input.evidence,input.symbol,'EPS'),issues:FinancialInputMissing[]=[];
 const dated=rows.map(row=>({...row,quarter:quarter(row.body?.period)}));
 for(const row of dated)if(!row.quarter)issues.push(missing('ACTUAL_EPS_PERIOD_INVALID',row.source.id,'An explicit fiscal YYYY-Qn period is required.'));
 if(issues.length)return {value:null,missing:issues};
 const ordered=dated.sort((a,b)=>a.quarter!.rank-b.quarter!.rank||a.source.id.localeCompare(b.source.id));
 const periods=[...new Set(ordered.map(row=>row.quarter!.period))].slice(-4),selected=ordered.filter(row=>periods.includes(row.quarter!.period));
 if(periods.length!==4)return {value:null,missing:[missing('ACTUAL_FOUR_QUARTER_EPS_MISSING','FINANCIAL.EPS','Four consecutive directly reported diluted common-share EPS quarters are required; no basic/YTD conversion or annualization is performed.')]};
 if(selected.length!==4)return {value:null,missing:[missing('ACTUAL_EPS_PERIOD_AMBIGUOUS','FINANCIAL.EPS','The selected quarter has more than one observation; choose a verified revision before calculation.')]};
 if(selected.some((row,i)=>i>0&&row.quarter!.rank!==selected[i-1].quarter!.rank+1))
  issues.push(missing('ACTUAL_EPS_QUARTERS_NOT_CONSECUTIVE','FINANCIAL.EPS','Missing fiscal quarters cannot be interpolated.'));
 const decimals:NonNullable<ReturnType<typeof exactDecimal>>[]=[],quarters:QuarterRow[]=[];
 for(const row of selected){
  const body=row.body!,values=object(body.values)?body.values:null;
  if(row.quarter!.end>input.data_through)issues.push(missing('ACTUAL_EPS_PERIOD_AFTER_QUOTE',row.source.id,'An actual earnings period must end on or before the quote date.'));
  if(body.basis!=='SINGLE_QUARTER'||values?.unit!=='TWD_PER_COMMON_SHARE'||values.measurement_basis!=='DILUTED'
   ||values.consolidation!==undefined&&values.consolidation!=='CONSOLIDATED')
   issues.push(missing('ACTUAL_EPS_DILUTED_COMMON_SHARE_BASIS_REQUIRED',row.source.id,'Use directly reported single-quarter diluted TWD common-share EPS; basic, cumulative, ADR or mixed consolidation bases are not substituted.'));
  const decimal=exactDecimal(values?.value,values?.reported_decimal);
  if(!decimal)issues.push(missing('ACTUAL_EPS_REPORTED_DECIMAL_INVALID',row.source.id,'The explicit reported decimal must match the finite numeric EPS.'));
  else{decimals.push(decimal);quarters.push({period:row.quarter!.period,value:decimal.value,reported_decimal:decimal.text,evidence_id:row.source.id});}
 }
 if(issues.length)return {value:null,missing:issues};
 const sum=sumDecimals(decimals);
 return {value:{basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM',value:sum.value,reported_sum_decimal:sum.decimal,
  currency:'TWD',unit:'TWD_PER_COMMON_SHARE',period:{start:selected[0].quarter!.start,end:selected[3].quarter!.end},
  quarters,evidence_ids:selected.map(row=>row.source.id),issuer_reported_ttm:false,weighted_denominator_recomputed:false,forecast:false},missing:[]};
}
function reportedCashflowSeries(packet:AnalysisPacket){
 const rows=rowsFor(packet.evidence,packet.symbol,'CAPEX'),dated=rows.map(row=>({...row,quarter:quarter(row.body?.period)}));
 const issues:FinancialInputMissing[]=[];
 if(dated.some(row=>!row.quarter))return {value:null,missing:[missing('ACTUAL_CASHFLOW_PERIOD_INVALID','FINANCIAL.CAPEX','Fiscal cashflow quarters must be explicit.')]};
 dated.sort((a,b)=>a.quarter!.rank-b.quarter!.rank||a.source.id.localeCompare(b.source.id));
 const periods=[...new Set(dated.map(row=>row.quarter!.period))].slice(-4),selected=dated.filter(row=>periods.includes(row.quarter!.period));
 if(periods.length!==4||selected.length!==4||selected.some((row,i)=>i>0&&row.quarter!.rank!==selected[i-1].quarter!.rank+1))
  return {value:null,missing:[missing('ACTUAL_FOUR_QUARTER_CASHFLOW_MISSING','FINANCIAL.CAPEX','Four unique consecutive quarter CFO and capital-expenditure observations in the same currency are required.')]};
 const amounts:{period:string;cfo_twd:number;capex_twd:number;issuer_fcf_twd:number;residual_twd:number;evidence_id:string;amount_resolution_twd:number|null}[]=[];
 for(const row of selected){const body=row.body!,v=object(body.values)?body.values:{};
  if(body.basis!=='SINGLE_QUARTER'||v.unit!=='TWD'||v.measurement_basis!=='DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES'
   ||row.quarter!.end>packet.data_through!)issues.push(missing('ACTUAL_CASHFLOW_BASIS_REQUIRED',row.source.id,'Require actual same-period TWD CFO/capital expenditures; budgets, USD amounts and PPE balances are not converted.'));
  if(![v.value,v.operating_cashflow_twd,v.free_cashflow_twd].every(n=>typeof n==='number'&&Number.isSafeInteger(n))||Number(v.value)<0)
   issues.push(missing('ACTUAL_CASHFLOW_AMOUNTS_MISSING',row.source.id,'Require explicit finite TWD cash amounts with their original disclosed precision.'));
  else amounts.push({period:row.quarter!.period,cfo_twd:v.operating_cashflow_twd as number,capex_twd:v.value as number,
   issuer_fcf_twd:v.free_cashflow_twd as number,residual_twd:(v.free_cashflow_twd as number)-((v.operating_cashflow_twd as number)-(v.value as number)),
   evidence_id:row.source.id,amount_resolution_twd:typeof v.amount_resolution_twd==='number'?v.amount_resolution_twd:null});
 }
 if(issues.length)return {value:null,missing:issues};
 const sum=(key:'cfo_twd'|'capex_twd'|'issuer_fcf_twd'|'residual_twd')=>{const n=amounts.reduce((total,row)=>total+row[key],0);if(!Number.isSafeInteger(n))invalid('cashflow.total');return n;};
 return {value:{basis:'SUM_OF_ISSUER_REPORTED_CFO_AND_CAPEX_NOT_COMMON_SHARE_FCFE' as const,currency:'TWD' as const,
  period:{start:selected[0].quarter!.start,end:selected[3].quarter!.end},quarters:amounts,operating_cashflow_twd:sum('cfo_twd'),
  capital_expenditures_twd:sum('capex_twd'),issuer_free_cashflow_twd:sum('issuer_fcf_twd'),reported_rounding_residual_twd:sum('residual_twd'),
  evidence_ids:amounts.map(row=>row.evidence_id),fcfe:null,normalized:false,forecast:false},missing:[]};
}
function validatePacket(packet:AnalysisPacket){
 validateAnalysisPacket(packet);if(!packet.data_through)invalid('packet.data_through');
 for(const e of packet.evidence)if(compareTime(e.available_at,packet.cutoff)>0||e.published_at!==null&&compareTime(e.published_at,e.available_at)>0
  ||e.first_seen_at!==undefined&&compareTime(e.first_seen_at,e.available_at)>0||e.as_of!==undefined&&compareTime(e.as_of,e.available_at)>0)
  invalid('packet.evidence.'+e.id+'.time');
}
export async function deriveDailyAiFinancialActuals({packet:original}:{packet:AnalysisPacket}){
 const packet=structuredClone(original);validatePacket(packet);
 const eps=readReportedDilutedQuarterSeries({symbol:packet.symbol,data_through:packet.data_through!,evidence:packet.evidence}),cash=reportedCashflowSeries(packet);
 // A consolidated operating cash total and a bonds-only financing line never
 // prove complete common-equity FCFE. Missing adjustments stay explicit.
 const longMissing=[...cash.missing,
  missing('ACTUAL_FCFE_COMPLETE_NET_BORROWING_REQUIRED','LONG.net_borrowing_cash','Require all borrowing proceeds and principal repayments in cash, with lease treatment explicitly reconciled; a bond line or liability balance change is insufficient.'),
  missing('ACTUAL_FCFE_PARENT_COMMON_CASH_ATTRIBUTION_REQUIRED','LONG.ownership_cash_adjustments','Reconcile non-controlling interests, preferred claims and the consolidated cash attributable to parent common equity; do not assume zero.'),
  missing('ACTUAL_FCFE_REINVESTMENT_SCOPE_REQUIRED','LONG.reinvestment_cash','Reconcile the selected PPE, intangible, disposal and acquisition cash scope; no EPS or issuer FCF proxy is accepted.'),
  missing('ACTUAL_FCFE_DILUTION_BASIS_REQUIRED','LONG.diluted_common_shares','Supply a source-bound common-share denominator consistent with the cash period and any debt-to-equity conversion treatment.')];
 const packet_hash=await snapshotHash(packet),evidence_bindings=await Promise.all(packet.evidence.map(async e=>({id:e.id,evidence_hash:await snapshotHash(e)})));
 const body={schema:'DAILY_AI_FINANCIAL_ACTUALS_V1' as const,symbol:packet.symbol,source_cutoff:packet.cutoff,data_through:packet.data_through!,packet_hash,
  reported_four_quarter_diluted_eps_sum:eps.value,cashflow_actuals:cash.value,common_share_fcfe:null,
  missing:{MEDIUM:eps.missing,LONG:longMissing},evidence_bindings,
  scope:'AS_OF_HISTORICAL_OBSERVATION_DERIVATION' as const,source_admitted:false as const,methodology_approved:false as const,review:null,forecast:false as const};
 return freeze({...body,actuals_hash:await snapshotHash(body)});
}

const policyKeys=['schema','version','symbol','horizon','formed_at','description','evidence_ids','earnings_period','entry_scenarios','margin_of_safety','invalidation'];
const nonempty=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
/** The policy supplies multiples/discounts explicitly. Only historical EPS is
 * derived here; the original packet is copied unchanged into the calculation. */
export async function buildDailyAiActualPriceInput(input:{packet:AnalysisPacket;as_of:string;expires_at:string;policy:ActualPricePolicy|null}){
 const owned=structuredClone(input),{packet,as_of,expires_at,policy}=owned;
 if(!validObservationTime(as_of)||!validObservationTime(expires_at)||compareTime(packet.cutoff,as_of)>0||compareTime(as_of,expires_at)>=0)invalid('as_of/expires_at');
 const actuals=await deriveDailyAiFinancialActuals({packet});
 const result=(missing:FinancialInputMissing[],policy_hash:string|null=null,calculation_input:MediumCalculationInput|LongEpsDividendCalculationInput|null=null)=>
  freeze({schema:'DAILY_AI_ACTUAL_PRICE_INPUT_RESULT_V1' as const,status:calculation_input?'INPUT_READY_REVIEW_REQUIRED' as const:'MISSING_INPUT' as const,
   symbol:packet.symbol,packet_hash:actuals.packet_hash,actuals,policy_hash,calculation_input,missing,review:null,methodology_approved:false as const,member_published:false as const});
 if(policy===null)return result([...actuals.missing.MEDIUM,missing('ACTUAL_PRICE_POLICY_REQUIRED','policy','Supply a versioned valuation policy with explicit scenarios, discount, evidence references and formation time; actual EPS alone does not determine a price.')]);
 const keys=[...policyKeys,...(policy.horizon==='LONG'?['method_id','scenarios']:['pe_scenarios'])];
 if(!object(policy)||Object.keys(policy).length!==keys.length||!keys.every(k=>Object.hasOwn(policy,k))
  ||policy.schema!=='DAILY_AI_ACTUAL_PRICE_POLICY_V1'||!['MEDIUM','LONG'].includes(policy.horizon)||policy.symbol!==packet.symbol
  ||!nonempty(policy.version,100)||!nonempty(policy.description,700)||!nonempty(policy.invalidation,1500)
  ||!validObservationTime(policy.formed_at)||compareTime(policy.formed_at,as_of)>0)invalid('policy');
 const byId=new Map(packet.evidence.map(e=>[e.id,e]));
 if(!Array.isArray(policy.evidence_ids)||!policy.evidence_ids.length||policy.evidence_ids.length>100
  ||new Set(policy.evidence_ids).size!==policy.evidence_ids.length||policy.evidence_ids.some(id=>!nonempty(id,200)||!byId.has(id)
   ||byId.get(id)!.symbol!==packet.symbol||byId.get(id)!.kind==='PRICE'))invalid('policy.evidence_ids');
 if(policy.horizon==='MEDIUM'){
  if(!Array.isArray(policy.pe_scenarios)||policy.pe_scenarios.length!==3
   ||policy.pe_scenarios.some((s,i)=>!object(s)||Object.keys(s).sort().join('|')!=='name|pe'||s.name!==['conservative','base','upside'][i]
    ||typeof s.pe!=='number'||!Number.isFinite(s.pe)||s.pe<=0||i>0&&s.pe<policy.pe_scenarios[i-1].pe))invalid('policy.pe_scenarios');
 }else{
  if(policy.method_id!=='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1'||!Array.isArray(policy.scenarios)||policy.scenarios.length!==3)invalid('policy.scenarios');
  for(let i=0;i<policy.scenarios.length;i++){const s=policy.scenarios[i];
   if(!object(s)||Object.keys(s).sort().join('|')!=='eps_growth_rates|name|payout_ratios|required_return|terminal_pe'
    ||s.name!==['conservative','base','upside'][i]||!Array.isArray(s.eps_growth_rates)||s.eps_growth_rates.length<1||s.eps_growth_rates.length>10
    ||!Array.isArray(s.payout_ratios)||s.payout_ratios.length!==s.eps_growth_rates.length
    ||i>0&&s.eps_growth_rates.length!==policy.scenarios[0].eps_growth_rates.length
    ||s.eps_growth_rates.some(g=>typeof g!=='number'||!Number.isFinite(g)||g<=-1)
    ||s.payout_ratios.some(p=>typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)
    ||typeof s.required_return!=='number'||!Number.isFinite(s.required_return)||s.required_return<=0
    ||typeof s.terminal_pe!=='number'||!Number.isFinite(s.terminal_pe)||s.terminal_pe<=0)invalid('policy.scenarios['+i+']');
  }
 }
 if(!Array.isArray(policy.entry_scenarios)||policy.entry_scenarios.length!==2||policy.entry_scenarios.some(s=>!['conservative','base','upside'].includes(s))
  ||['conservative','base','upside'].indexOf(policy.entry_scenarios[0])>['conservative','base','upside'].indexOf(policy.entry_scenarios[1])
  ||typeof policy.margin_of_safety!=='number'||!Number.isFinite(policy.margin_of_safety)||policy.margin_of_safety<0||policy.margin_of_safety>=1)invalid('policy.selection');
 const policy_hash=await snapshotHash(policy),eps=actuals.reported_four_quarter_diluted_eps_sum;
 if(!eps)return result(actuals.missing.MEDIUM,policy_hash);
 if(!object(policy.earnings_period)||Object.keys(policy.earnings_period).sort().join('|')!=='end|start'
  ||policy.earnings_period.start!==eps.period.start||policy.earnings_period.end!==eps.period.end)
  return result([missing('ACTUAL_POLICY_EARNINGS_PERIOD_MISMATCH','policy.earnings_period','The explicit policy must reference the same observed four-quarter window; it is not rolled silently.')],policy_hash);
 if(eps.value<=0)return result([missing('ACTUAL_EPS_SUM_NOT_POSITIVE',policy.horizon+'.reported_eps_sum','A nonpositive reported EPS sum remains an actual observation but cannot serve as the positive historical base required by this valuation method.')],policy_hash);
 const quotes=packet.evidence.filter(e=>e.symbol===packet.symbol&&e.kind==='PRICE'&&content(e)?.date===packet.data_through);
 if(quotes.length!==1)return result([missing('ACTUAL_CURRENT_QUOTE_REQUIRED','packet.evidence.PRICE','Require one current completed-session quote from this exact packet.')],policy_hash);
 const description=`${policy.description}\nPolicy ${policy.version}; policy_hash ${policy_hash}; actuals_hash ${actuals.actuals_hash}; original_packet_hash ${actuals.packet_hash}. Base EPS is a sum of reported diluted quarter values, not reweighted TTM. Multiples, growth, payout and required returns are policy assumptions where applicable.`;
 const references=[...new Set([...eps.evidence_ids,...policy.evidence_ids])];
 const common={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1' as const,symbol:packet.symbol,currency:'TWD' as const,
  cutoff:packet.cutoff,data_through:packet.data_through!,as_of,expires_at,quote_evidence_id:quotes[0].id,evidence:structuredClone(packet.evidence),
  assumption_basis:{available_at:policy.formed_at,description,evidence_ids:references},invalidation:policy.invalidation};
 const dilution_basis={description:'Each source directly labels diluted TWD common-share EPS. The four disclosed EPS values are added; no common or period-weighted denominator is reconstructed.',evidence_ids:eps.evidence_ids};
 const calculation_input:MediumCalculationInput|LongEpsDividendCalculationInput=policy.horizon==='MEDIUM'?{...common,horizon:'MEDIUM',method_id:'MEDIUM_EPS_PE_SCENARIOS_V1',
  parameters:{earnings_basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM',forecast_period:eps.period,
   dilution_basis,
   scenarios:policy.pe_scenarios.map(s=>({name:s.name,eps:eps.value,pe:s.pe})),entry_scenarios:policy.entry_scenarios,
   margin_of_safety:policy.margin_of_safety,stop_evidence_ids:references}}:
  {...common,horizon:'LONG',method_id:policy.method_id,parameters:{earnings_basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM',earnings_period:eps.period,
   dilution_basis,scenarios:structuredClone(policy.scenarios),entry_scenarios:policy.entry_scenarios,margin_of_safety:policy.margin_of_safety,stop_evidence_ids:references}};
 // Late import avoids evaluating a cyclic dependency while the calculator
 // imports the shared actual-EPS reader above. Use the real engine, rather than
 // a second implementation of scenario ordering or finite-value validation.
 const {calculateDailyAiPricePlan,PriceCalculationError}=await import('./daily-ai-price-calculation.ts');
 try{await calculateDailyAiPricePlan(calculation_input,Date.parse(as_of));}
 catch(error){if(error instanceof PriceCalculationError)return result([missing(error.code,error.field,error.message)],policy_hash);throw error;}
 return result([],policy_hash,calculation_input);
}

function htmlText(html:string){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,h,d)=>String.fromCodePoint(parseInt(h??d,h?16:10))).replace(/\s+/g,' ').trim();}
/** Extra observations are returned separately for a future source intake. They
 * are never inserted into the packet used by buildDailyAiActualPriceInput. */
export async function parseRetainedSecPriceSupplement(input:{release:SecQuarterDocument;presentation:SecQuarterDocument;cutoff:string;derived_at:string}){
 const owned=structuredClone(input),{release,presentation,cutoff,derived_at}=owned;
 const baseFacts=await parseSecQuarterFinancials(release,presentation,cutoff);
 if(!validObservationTime(derived_at)||compareTime(cutoff,derived_at)>0)invalid('derived_at');
 const q=quarter(presentation.period)!,label=String(Number(presentation.period.slice(-1)))+'Q'+presentation.period.slice(2,4),text=htmlText(presentation.body);
 const one=(pattern:RegExp)=>{const matches=[...text.matchAll(pattern)];if(matches.length!==1)invalid('SEC_SUPPLEMENT_ROW');return matches[0];};
 const shares=one(new RegExp('Diluted weighted average outstanding shares were ([\\d,]+)mn units in '+label,'g'));
 const parts=text.split('Cash Flows * Free cash flow = Cash from operating activities');if(parts.length!==2)invalid('SEC_SUPPLEMENT_CASH_SECTION');
 const flow=parts[1].split('Guidance')[0],bondMatches=[...flow.matchAll(/Bonds payable (\(?[\d,]+\.\d{2}\)?) (\(?[\d,]+\.\d{2}\)?) (\(?[\d,]+\.\d{2}\)?)/g)];
 if(bondMatches.length!==1)invalid('SEC_SUPPLEMENT_BOND_ROW');
 const shareCount=Number(shares[1].replaceAll(',',''))*1000000,bondToken=bondMatches[0][1];
 const bondCash=Number(bondToken.replaceAll(',','').replace(/[()]/g,''))*(bondToken.startsWith('(')?-1:1)*1000000000;
 if(!Number.isSafeInteger(shareCount)||shareCount<=0||!Number.isSafeInteger(bondCash))invalid('SEC_SUPPLEMENT_AMOUNT');
 const source=baseFacts.find(f=>f.kind==='CAPEX')!;
 const fact=async(kind:string,values:Record<string,number|string>)=>{
  const body={symbol:'2330',kind,period:presentation.period,basis:'SINGLE_QUARTER',values,source:presentation.url,
   published_at:null,first_seen_at:presentation.received_at,source_received_at:presentation.received_at,available_at:derived_at,
   as_of:q.end+'T23:59:59+08:00',source_sha256:presentation.sha256,source_bytes:presentation.bytes,
   source_locator:{...source.source_locator,section:kind==='DILUTED_WEIGHTED_AVERAGE_SHARES'?'Quarterly results footnote':'Cash Flows',
    row:kind==='DILUTED_WEIGHTED_AVERAGE_SHARES'?'Diluted weighted average outstanding shares':'Bonds payable'},
   derived_at,normalizer_version:'SEC_PRICE_SUPPLEMENT_V1',source_admitted:false,member_publication_approved:false};
  const evidence_hash=await snapshotHash(body);return {...body,id:`sec-price-supplement:2330:${presentation.period}:${kind}:${evidence_hash}`,evidence_hash};
 };
 const facts=await Promise.all([
  fact('DILUTED_WEIGHTED_AVERAGE_SHARES',{value:shareCount,unit:'SHARES',measurement_basis:'DILUTED_WEIGHTED_AVERAGE_COMMON_SHARES',reported_million:shares[1].replaceAll(',',''),amount_resolution_shares:1000000}),
  fact('BONDS_PAYABLE_CASH',{value:bondCash,unit:'TWD',measurement_basis:'REPORTED_BONDS_PAYABLE_CASH_LINE_ONLY',reported_billion:bondToken,
   amount_resolution_twd:10000000,complete_net_borrowing:'NOT_ESTABLISHED',common_share_fcfe:'NOT_COMPUTED'}),
 ]);
 const body={schema:'DAILY_AI_FINANCIAL_SUPPLEMENT_CANDIDATE_V1' as const,symbol:'2330',source_cutoff:cutoff,derived_at,facts,
  admission_status:'PENDING_SOURCE_INTAKE' as const,packet_mutated:false,source_admitted:false,member_publication_approved:false,review:null};
 return freeze({...body,supplement_hash:await snapshotHash(body)});
}
