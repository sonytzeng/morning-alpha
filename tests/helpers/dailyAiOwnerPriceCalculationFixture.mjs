// Explicit synthetic arithmetic/UI fixture. All issuer names, sources and
// parameters below are invented test inputs; no real recommendation or
// reviewer approval is represented. No API or database is used here.
import {produceDailyAiPricePlan} from '../../research/daily-ai-price-producer.mjs';
import {canonical} from '../../research/entry-opportunity.ts';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {isMarketTradingDate,previousMarketTradingDate} from '../../supabase/functions/_shared/market-session-contract.mjs';

export const SYNTHETIC_CALCULATION_OWNER='00000000-0000-4000-8000-000000000101';
export async function createOwnerCalculationFixture({horizon='MEDIUM',now=Date.now(),symbol='1000',reportedEps=false,dividendMethod=false}={}){
 const cutoff=new Date(now-30*60000).toISOString(),asOf=new Date(now-10*60000).toISOString(),expiry=new Date(now+90*60000).toISOString();
 const localDay=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
 const through=isMarketTradingDate('TW',localDay)&&Date.parse(cutoff)>=Date.parse(localDay+'T17:05:00+08:00')?localDay:previousMarketTradingDate('TW',localDay);
 const dates=[previousMarketTradingDate('TW',previousMarketTradingDate('TW',through)),previousMarketTradingDate('TW',through),through];
 const source=(id,kind,content,day=through)=>({id,symbol,kind,source:'https://example.invalid/synthetic-owner-calculation/'+id,
  published_at:day+'T14:00:00+08:00',available_at:day+'T14:05:00+08:00',time_basis:'PUBLISHED',content:JSON.stringify(content)});
 const bars=[[100,102,98,100],[100,104,99,103],[103,106,102,105]].map((values,i)=>source('P'+(i+1),'PRICE',{
  date:dates[i],open:values[0],high:values[1],low:values[2],close:values[3],currency:'TWD',price_basis:'RAW_UNADJUSTED',session_scope:'SYNTHETIC_COMPLETE_DAY'},dates[i]));
 const financial=source('F1','FINANCIAL',{kind:'SYNTHETIC_CONTEXT',note:'合成流程驗證資料，沒有引用真實公司的財報、預測或價格。'});
 const quarters=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].map((period,index)=>source('EPS'+(index+1),'FINANCIAL',{
  kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:2.5,reported_decimal:'2.50',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',consolidation:'CONSOLIDATED'}}));
 const evidence=horizon==='SHORT'?[...bars,financial,source('A1','NEWS',{kind:'CORPORATE_ACTION_COVERAGE',symbol,from:dates[0],through,status:'NO_ACTIONS',price_basis:'RAW_UNADJUSTED'})]:[bars[2],financial,...(reportedEps||dividendMethod?quarters:[])];
 const edition={id:'a'.repeat(64),evidence_cutoff:cutoff,prepared_at:new Date(now-20*60000).toISOString(),expires_at:expiry,data_through:through};
 const card={symbol,company:'合成流程驗證公司（非真實推薦）',horizon,status:'WAIT'};
 const packet={symbol:card.symbol,company:card.company,cutoff,data_through:through,evidence};
 const dilution={description:'合成測試以每稀釋普通股為單位；不是公司實際股數或財報數字。',evidence_ids:reportedEps||dividendMethod?quarters.map(q=>q.id):['F1']};
 const selected={entry_scenarios:['conservative','base'],margin_of_safety:.2,stop_evidence_ids:['F1']};
 const start=new Date(Date.parse(through+'T00:00:00Z')+86400000).toISOString().slice(0,10),anniversary=new Date(start+'T00:00:00Z');anniversary.setUTCFullYear(anniversary.getUTCFullYear()+1);
 const parameters=horizon==='SHORT'?{bar_evidence_ids:['P1','P2','P3'],expected_sessions:dates,atr_period:2,breakout_lookback:2,
  trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:.5,stop_atr_multiple:2,tick_size:.5,corporate_actions_evidence_id:'A1'}:
  horizon==='MEDIUM'?{earnings_basis:reportedEps?'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM':'FORWARD_12_MONTH_DILUTED_EPS',forecast_period:reportedEps?{start:'2025-10-01',end:'2026-09-30'}:{start,end:new Date(anniversary.getTime()-86400000).toISOString().slice(0,10)},dilution_basis:dilution,...selected,
   scenarios:[{name:'conservative',eps:reportedEps?10:8,pe:10},{name:'base',eps:10,pe:12},{name:'upside',eps:reportedEps?10:12,pe:14}]}:
  dividendMethod?{earnings_basis:'REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM',earnings_period:{start:'2025-10-01',end:'2026-09-30'},dilution_basis:dilution,...selected,
   scenarios:['conservative','base','upside'].map((name,index)=>({name,eps_growth_rates:[0,0],payout_ratios:[.5,.5],required_return:.1,terminal_pe:10+2*index}))}:
  {cashflow_basis:'FCFE_PER_DILUTED_COMMON_SHARE_AFTER_REINVESTMENT_DEBT_AND_NCI',timing:'END_OF_YEAR',dilution_basis:dilution,...selected,
   scenarios:['conservative','base','upside'].map((name,i)=>({name,cashflows:Array(5).fill(8+2*i),discount_rate:.1,terminal:{next_fcfe:8+2*i,growth:0}}))};
 const calculation_input={schema:'DAILY_AI_PRICE_CALCULATION_INPUT_V1',symbol:card.symbol,horizon,cutoff,data_through:through,as_of:asOf,expires_at:expiry,currency:'TWD',
  method_id:dividendMethod?'LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1':{SHORT:'SHORT_ATR_CONDITIONAL_V1',MEDIUM:'MEDIUM_EPS_PE_SCENARIOS_V1',LONG:'LONG_FCFE_DISCOUNT_SCENARIOS_V1'}[horizon],quote_evidence_id:'P3',evidence,
  assumption_basis:{available_at:new Date(now-25*60000).toISOString(),description:'合成流程驗證：EPS、本益比、FCFE、折現率與安全折讓都是未核准的測試假設，不能當成真實推薦。',evidence_ids:['F1']},
  invalidation:'合成測試條件改變時停止沿用；這不是正式股票建議。',parameters};
 const result=await produceDailyAiPricePlan({edition,card,packet,calculation_input},{mode:'DRY_RUN',now});
 if(result.status!=='CALCULATED_REVIEW_REQUIRED')throw Error('SYNTHETIC_CALCULATION_FAILED');
 const {calculation_hash,...calculation}=result.calculation;
 const row={plan_hash:result.candidate.plan_hash,body:JSON.parse(result.candidate.body_text),review:null,publication:null,can_approve:false};
 const response={schema:'DAILY_AI_OWNER_PRICE_CALCULATION_V1',edition_id:edition.id,plan_hash:row.plan_hash,subject_user_id:SYNTHETIC_CALCULATION_OWNER,research_only:true,preview_only:true,
  audit:{batch_id:'b'.repeat(64),input_hash:result.calculation.input_hash,input_text:canonical(calculation_input),calculation_hash,calculation_text:canonical(calculation),
   method_note_hash:result.candidate.method_note_hash,method_note_text:canonical(result.candidate.method_note),
   review_request_hash:await snapshotHash(result.review_request),review_request_text:canonical(result.review_request),recorded_at:new Date(now).toISOString()}};
 return {now,row,response,result,input:calculation_input};
}
