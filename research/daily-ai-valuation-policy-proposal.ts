/** Concrete analyst proposals for review, not a calibrated recommendation rule.
 * No market quote is used to choose a PE, growth rate or terminal price. New
 * companies need an explicit policy; they do not inherit the 2330 assumptions.
 * This module cannot register inputs, approve a method or publish a price. */
import {deriveDailyAiFinancialActuals,type MediumActualPricePolicy,type LongActualPricePolicy} from './daily-ai-financial-inputs.ts';
import {validateAnalysisPacket,type AnalysisPacket} from './daily-ai-analysis.ts';
import {compareTime,snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';

export const VALUATION_PROPOSAL_VERSION='MA_2330_VALUATION_PROPOSAL_20261110_1';
export async function proposeDailyAiValuationPolicies({packet,formed_at,now=Date.now()}:{packet:AnalysisPacket;formed_at:string;now?:number}){
 validateAnalysisPacket(packet);
 if(!Number.isFinite(now)||!validObservationTime(formed_at)||compareTime(formed_at,new Date(now).toISOString())>0
  ||compareTime(formed_at,packet.cutoff)<0)throw Error('VALUATION_PROPOSAL_TIME');
 if(packet.symbol!=='2330')return {state:'POLICY_NOT_DEFINED' as const,symbol:packet.symbol,policies:[],review:null,member_published:false as const};
 const actuals=await deriveDailyAiFinancialActuals({packet}),eps=actuals.reported_four_quarter_diluted_eps_sum;
 if(!eps||eps.value<=0)return {state:'FINANCIAL_INPUT_REQUIRED' as const,symbol:packet.symbol,policies:[],actuals,review:null,member_published:false as const};
 const common={schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1' as const,version:VALUATION_PROPOSAL_VERSION,symbol:packet.symbol,
  formed_at,evidence_ids:eps.evidence_ids,earnings_period:eps.period,entry_scenarios:['conservative','base'] as ['conservative','base'],
  margin_of_safety:.25,invalidation:'四季稀釋EPS、股本或財報更正時重新計算；成長、配息、折現率或期末估值假設不再成立時撤回價格方案。此政策尚待獨立方法與來源用途審查。'};
 const medium:MediumActualPricePolicy={...common,horizon:'MEDIUM',
  description:'Review proposal: reported four-quarter diluted EPS sum × explicit PE 16/20/24, then 25% entry discount. The PE grid represents earnings yields 6.25%/5%/4.1667%, not dividend yields or expected returns. These are internal valuation stress assumptions, not observed fair multiples or an issuer forecast.',
  pe_scenarios:[{name:'conservative',pe:16},{name:'base',pe:20},{name:'upside',pe:24}]};
 const long:LongActualPricePolicy={...common,horizon:'LONG',method_id:'LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1',
  description:'Review proposal: five annual EPS growth rates 6%/12%/18%, dividend payout 25%, required returns 12%/10%/9%, terminal PE 12/16/20; 25% entry discount. All future values are internal assumptions, not company guidance, FCFE, consensus or probabilities. The base label denotes a parameter set, not a most-likely outcome.',
  scenarios:[{name:'conservative',eps_growth_rates:[.06,.06,.06,.06,.06],payout_ratios:[.25,.25,.25,.25,.25],required_return:.12,terminal_pe:12},
   {name:'base',eps_growth_rates:[.12,.12,.12,.12,.12],payout_ratios:[.25,.25,.25,.25,.25],required_return:.10,terminal_pe:16},
   {name:'upside',eps_growth_rates:[.18,.18,.18,.18,.18],payout_ratios:[.25,.25,.25,.25,.25],required_return:.09,terminal_pe:20}]};
 const body={schema:'DAILY_AI_VALUATION_POLICY_PROPOSAL_V1' as const,state:'PROPOSED_REVIEW_REQUIRED' as const,
  version:VALUATION_PROPOSAL_VERSION,symbol:packet.symbol,formed_at,source_cutoff:packet.cutoff,data_through:packet.data_through,
  packet_hash:actuals.packet_hash,actuals_hash:actuals.actuals_hash,policies:[medium,long],
  rationale:{medium_pe:'A fixed earnings-yield stress grid exposes the price paid for one unit of observed earnings; it is not calibrated to the current share price.',
   long_growth_and_return:'6%/12%/18% growth and 12%/10%/9% required returns retain the previously saved research scenario structure; that history does not approve these parameters.',
   dividend_payout:'25% is an explicitly proposed payout assumption. It is not a derived historical cash payout, and retained earnings are not labelled free cash flow.',
   terminal_pe:'12/16/20 are explicit exit-multiple stresses, below the corresponding medium PE grid. They require independent growth, risk and reinvestment review.',
   entry_discount:'25% is a proposed valuation buffer, not a probability bound, maximum drawdown or calibrated loss protection.'},
  method_references:['https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/discounted-dividend-valuation',
   'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/lectures/pe.html'],
  review_required:['COMPANY_SPECIFIC_MULTIPLE_AND_RETURN_BASIS','DILUTION_AND_EARNINGS_QUALITY','PAYOUT_AND_REINVESTMENT_FEASIBILITY',
   'GROWTH_AND_TERMINAL_SENSITIVITY','SOURCE_USE_AND_CURRENT_PRICE','INDEPENDENT_CURRENT_EDITION_REVIEW'],
  parameter_source:'EXPLICIT_INTERNAL_RESEARCH_PROPOSAL' as const,forecast:false as const,performance_available:false as const,
  methodology_approved:false as const,review:null,member_published:false as const,production_writes:0 as const};
 return {...body,proposal_hash:await snapshotHash(body)};
}
