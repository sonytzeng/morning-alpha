import {buildDailyAiSeed} from '../../../research/daily-ai-seed.ts';
import {refreshDailyAiPrices} from '../../../research/daily-ai-refresh.ts';
import {refreshDailyAiFinancials,dailyAiFinancialRefreshUnavailable,type DailyAiFinancialRefreshResult} from '../../../research/daily-ai-financial-refresh.ts';
import {compareTime,hashValid,validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {FunnelInput} from '../../../src/features/vnext/researchFunnel.ts';
import type {AnalysisEvidence} from '../../../research/daily-ai-analysis.ts';
import {intakeUuid,parseDailyAiSourceSnapshot,parseDailyAiMarketEvidence} from './intake.ts';
import type {DailyStockSourceResult} from './source-handler.ts';

type Rpc=(name:string,args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>;
type Refresh=typeof refreshDailyAiPrices;
type FinancialRefresh=typeof refreshDailyAiFinancials;
export type DailyStockSourcePorts={rpc:Rpc;fetcher:typeof fetch;clock:()=>string;refresh?:Refresh;
 refreshFinancials?:FinancialRefresh;
 collectNews?:(signal:AbortSignal)=>Promise<{complete:boolean}>;
 collectMarket?:(input:{businessDate:string;signal:AbortSignal})=>Promise<{market:AnalysisEvidence[];additionalGaps:string[];receipts:unknown[]}>};
const object=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('AI_INTAKE_RESPONSE');return value as Record<string,unknown>;
};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_INTAKE_ABORTED');};
const code=(value:unknown):value is string=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(value);
function acquired(h:Record<string,unknown>,intakeId:string,now:string){
 if(h.schema!=='DAILY_AI_INTAKE_SOURCE_V1'||h.intake_id!==intakeId||h.member_published!==false||!intakeUuid(h.lease)
  ||h.projection!=='DAILY_AI_RETAINED_INPUT_PROJECTION_V1'||!['VNEXT_ACQUIRED','ASOF_INTAKE'].includes(String(h.source_kind))
  ||!intakeUuid(h.source_id)||typeof h.source_revision!=='string'||!hashValid(h.source_revision)
  ||typeof h.source_cutoff!=='string'||!validObservationTime(h.source_cutoff)||compareTime(h.source_cutoff,now)>0
  ||typeof h.requested_at!=='string'||!validObservationTime(h.requested_at)||compareTime(h.requested_at,now)>0
  ||typeof h.business_date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(h.business_date)
  ||!validObservationTime(h.business_date+'T00:00:00Z')||!Array.isArray(h.inputs)||h.inputs.length!==72
  ||typeof h.source_business_date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(h.source_business_date)
  ||h.source_business_date!==new Date(Date.parse(h.source_cutoff)+8*3600000).toISOString().slice(0,10)
  ||!Array.isArray(h.companies)||h.companies.length!==72||!Array.isArray(h.intake_gaps)||h.intake_gaps.length>64
  ||h.intake_gaps.some(g=>!code(g))||!Array.isArray(h.source_issues)||h.source_issues.length>1600
  ||h.source_issues.some(value=>{const i=object(value);return !code(i.kind)||!code(i.reason)||typeof i.key!=='string'||!/^[A-Za-z0-9_:.-]{1,200}$/.test(i.key);}))throw Error('AI_INTAKE_CLAIM_INVALID');
 if(['RETAINED_INPUT_OLDER_OBSERVATIONS_OMITTED','FINANCIAL_DATA_RETAINED_NOT_REFRESHED','INSTITUTIONAL_FLOW_NOT_REFRESHED','CORPORATE_ACTIONS_NOT_REFRESHED_RAW_PRICES_ONLY']
  .some(g=>!(h.intake_gaps as unknown[]).includes(g)))throw Error('AI_INTAKE_CLAIM_LIMITATIONS');
 const inputs=h.inputs.map(value=>{
  const i=object(value);
  if(typeof i.symbol!=='string'||!/^\d{4,6}$/.test(i.symbol)||typeof i.company!=='string'||!i.company.trim()||i.company.length>100
   ||i.cutoff!==h.source_cutoff||!Array.isArray(i.bars)||i.bars.length>400||!Array.isArray(i.facts)||i.facts.length>1000
   ||!Array.isArray(i.expected_sessions)||i.expected_sessions.length>400)throw Error('AI_INTAKE_CLAIM_INPUTS');
  return i as unknown as FunnelInput;
 });
 if(new Set(inputs.map(i=>i.symbol)).size!==72||new TextEncoder().encode(JSON.stringify(inputs)).byteLength>8000000)throw Error('AI_INTAKE_CLAIM_INPUTS');
 const companies=new Map<string,string>();
 for(const value of h.companies){const c=object(value);
  if(typeof c.symbol!=='string'||companies.has(c.symbol)||!inputs.some(i=>i.symbol===c.symbol&&i.company===c.company)
   ||!['TWSE','TPEX'].includes(String(c.exchange)))throw Error('AI_INTAKE_CLAIM_COMPANIES');companies.set(c.symbol,String(c.exchange));
 }
 return {inputs,businessDate:h.business_date,lease:h.lease};
}
/** One SOURCE checkpoint has no model/provider-analysis dependency. It refreshes
 * public observations, freezes the actual post-fetch snapshot, and prepares one
 * retained batch. Immutable SOURCED retries skip all external acquisition. */
export async function prepareDailyStockAiSource(intakeId:string,ports:DailyStockSourcePorts,signal:AbortSignal):Promise<DailyStockSourceResult>{
 stopped(signal);if(!intakeUuid(intakeId))throw Error('AI_INTAKE_SCOPE');
 const call=(op:string,args:Record<string,unknown>={})=>ports.rpc('daily_stock_ai_intake_v1',{p_op:op,p_intake_id:intakeId,...args},signal);
 let current=object(await call('CLAIM'));stopped(signal);
 if(current.intake_id!==intakeId||current.member_published!==false)throw Error('AI_INTAKE_RESPONSE');
 if(['BUSY','EXHAUSTED','SOURCE_UNAVAILABLE','EXPIRED'].includes(String(current.state)))return {state:current.state as 'BUSY'|'EXHAUSTED'|'SOURCE_UNAVAILABLE'|'EXPIRED',intake_id:intakeId};
 const dispatch=async(batchId:string):Promise<DailyStockSourceResult>=>{
  let confirmed=false;
  try{
   stopped(signal);const d=object(await ports.rpc('dispatch_daily_stock_ai_batch_v1',{p_batch_id:batchId},signal));
   confirmed=d.state==='DISPATCHED'&&d.batch_id===batchId&&d.member_published===false;
  }catch{/* The retained batch remains a recoverable checkpoint. */}
  return {state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:batchId,analysis_dispatched:confirmed};
 };
 if(current.state==='CACHED'){
  if(typeof current.batch_id!=='string'||!hashValid(current.batch_id))throw Error('AI_INTAKE_CACHED_INVALID');
  return dispatch(current.batch_id);
 }
 if(current.state==='ACQUIRED'){
  const now=ports.clock();if(!validObservationTime(now))throw Error('AI_INTAKE_CLOCK');
  const claim=acquired(current,intakeId,now);
  let refreshed:Awaited<ReturnType<Refresh>>,newsComplete=false;
  let globalMarket:{market:AnalysisEvidence[];additionalGaps:string[];receipts:unknown[]};
  let financial:DailyAiFinancialRefreshResult;
  const missingMarket=()=>({market:[],additionalGaps:['MARKET_REFRESH_UNAVAILABLE','US_TREASURY_YIELD_CURVE_UNAVAILABLE','US_EQUITY_CLOSE_NOT_COLLECTED_US_NEWS_CONTEXT_ONLY','TAIWAN_NIGHT_SESSION_UNVERIFIED'],receipts:[]});
  try{
   [refreshed,newsComplete,globalMarket,financial]=await Promise.all([
    (ports.refresh??refreshDailyAiPrices)({inputs:claim.inputs,businessDate:claim.businessDate,fetcher:ports.fetcher,clock:ports.clock,signal}),
    ports.collectNews?ports.collectNews(signal).then(r=>r.complete===true).catch(()=>false):Promise.resolve(false),
    ports.collectMarket?ports.collectMarket({businessDate:claim.businessDate,signal}).catch(missingMarket):Promise.resolve(missingMarket()),
    ports.refreshFinancials?ports.refreshFinancials({inputs:claim.inputs,businessDate:claim.businessDate,fetcher:ports.fetcher,clock:ports.clock,signal}).catch(error=>{
     if(signal.aborted)throw error;return dailyAiFinancialRefreshUnavailable(claim.inputs,ports.clock());
    }):Promise.resolve(dailyAiFinancialRefreshUnavailable(claim.inputs,ports.clock())),
   ]);stopped(signal);
  }catch(error){
   if(!signal.aborted){try{await call('FAIL',{p_lease:claim.lease,p_code:'AI_INTAKE_REFRESH_FAILED'});}catch{/* Preserve the original sanitized failure. */}}
   throw error;
  }
  if(!Array.isArray(globalMarket.market)||globalMarket.market.length>4||!Array.isArray(globalMarket.additionalGaps)
   ||globalMarket.additionalGaps.length>20||globalMarket.additionalGaps.some(g=>!code(g)))throw Error('AI_INTAKE_MARKET_PORT_INVALID');
  const market=await parseDailyAiMarketEvidence(globalMarket.market,ports.clock(),signal);stopped(signal);
  if(!Array.isArray(financial.inputs)||financial.inputs.length!==72||new Set(financial.inputs.map(s=>s.symbol)).size!==72
   ||financial.inputs.some(s=>!Array.isArray(s.facts)||s.facts.length>1000||!claim.inputs.some(base=>base.symbol===s.symbol&&base.company===s.company))
   ||!Array.isArray(financial.additionalGaps)||financial.additionalGaps.some(g=>!code(g))
   ||financial.proof?.schema!=='DAILY_AI_FINANCIAL_REFRESH_V1')throw Error('AI_INTAKE_FINANCIAL_PORT_INVALID');
  const finalLocalCutoff=ports.clock();if(!validObservationTime(finalLocalCutoff)||!validObservationTime(financial.cutoff)
   ||compareTime(financial.cutoff,finalLocalCutoff)>0)throw Error('AI_INTAKE_FINANCIAL_PORT_INVALID');
  // Each acquisition receives the same immutable baseline. Merge only the
  // financial facts; price bars and their receipts come solely from price refresh.
  const financialBySymbol=new Map(financial.inputs.map(s=>[s.symbol,s.facts]));
  const sourceInputs=refreshed.inputs.map(s=>({...s,facts:financialBySymbol.get(s.symbol)!,cutoff:finalLocalCutoff}));
  const symbolGaps=Object.fromEntries(sourceInputs.map(s=>[s.symbol,[...new Set([
   ...(refreshed.gapsBySymbol[s.symbol]??[]),...(financial.gapsBySymbol[s.symbol]??[]),
  ])]]));
  const gaps=[...new Set([...refreshed.additionalGaps,...globalMarket.additionalGaps,...financial.additionalGaps,...(newsComplete?[]:['NEWS_REFRESH_UNAVAILABLE'])])];
  // SOURCE samples its final DB receipt only after all acquisition ports settle.
  // An unknown SOURCE commit is never followed by a competing FAIL transition.
  current=object(await call('SOURCE',{p_lease:claim.lease,p_inputs:sourceInputs,p_gaps:gaps,p_symbol_gaps:symbolGaps,p_market:market,p_financial_refresh:financial.proof}));stopped(signal);
 }
 if(current.state!=='SOURCED'||current.intake_id!==intakeId||!intakeUuid(current.lease)||typeof current.cutoff!=='string')throw Error('AI_INTAKE_SOURCE_UNCONFIRMED');
 const cutoff=current.cutoff,now=ports.clock();
 if(!validObservationTime(now)||!validObservationTime(cutoff)||compareTime(cutoff,now)>0)throw Error('AI_INTAKE_FUTURE_SNAPSHOT');
 const prepared=await parseDailyAiSourceSnapshot(current,cutoff,signal,'INTAKE');stopped(signal);
 const seed=await buildDailyAiSeed({...prepared,cutoff,signal});stopped(signal);
 const saved=object(await ports.rpc('store_daily_stock_ai_batch_v1',{p_text:seed.payload_text,p_hash:seed.metadata.payload_hash},signal));stopped(signal);
 if(saved.state!=='STORED'||saved.batch_id!==seed.metadata.payload_hash||saved.packets!==72||saved.member_published!==false)throw Error('AI_INTAKE_SAVE_UNCONFIRMED');
 const finished=object(await call('COMPLETE',{p_lease:current.lease,p_batch_id:seed.metadata.payload_hash}));stopped(signal);
 if(!['COMPLETE','CACHED'].includes(String(finished.state))||finished.intake_id!==intakeId
  ||finished.batch_id!==seed.metadata.payload_hash||finished.member_published!==false)throw Error('AI_INTAKE_COMPLETE_UNCONFIRMED');
 return dispatch(seed.metadata.payload_hash);
}
