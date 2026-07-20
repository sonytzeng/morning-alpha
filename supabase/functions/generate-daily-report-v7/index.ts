Warning: truncated output (original token count: 83356)
Total output lines: 1607

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import {
  assembleResearchMasterV2,
  buildBlockedResearchMasterV2,
  validateResearchMasterV2,
  type ResearchMasterV2AssemblerInput,
} from './research-master-v2.ts';

const VERSION='V9.0_THREE_TIER_BENEFICIARY';
const REPORT_MODE_NORMAL='normal_overnight',REPORT_MODE_WEEKEND='weekend_digest',REPORT_MODE_NON_TRADING='non_trading_day';
const CORS_HEADERS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey, x-client-info, x-cron-secret'};

const TAIWAN_HOLIDAYS_2026:Record<string,string>={
  '2026-01-01':'元旦','2026-02-16':'春節休市','2026-02-17':'春節休市','2026-02-18':'春節休市','2026-02-19':'春節休市','2026-02-20':'春節休市','2026-02-27':'和平紀念日補假','2026-04-03':'兒童節補假','2026-04-06':'清明節補假','2026-06-19':'端午節','2026-09-25':'中秋節','2026-10-09':'國慶日補假',
};

type TradingDayInfo={is_trading_day:boolean;market_closed:boolean;holiday_name:string|null;reason:string;session_type?:string;market_message?:string;next_trading_day?:string};

function getTaiwanTradingDayInfo(dateString:string):TradingDayInfo{
  try{
    const market=resolveMarketStatus(dateString);
    return{
      is_trading_day:market.market_status==='OPEN',
      market_closed:market.market_status!=='OPEN',
      holiday_name:market.closed_reason,
      reason:market.market_status,
      session_type:market.session_type,
      market_message:market.market_message,
      next_trading_day:market.next_trading_day,
    };
  }catch{return{is_trading_day:false,market_closed:true,holiday_name:'交易日判斷異常',reason:'EMERGENCY_CLOSE',session_type:'CLOSED',market_message:'交易日判斷異常，Morning Alpha 已切換保守模式。'};}
}


function formatTaiwanDateFromUtc(d:Date):string{
  return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
}

function getPreviousTaiwanTradingDay(todayDate:string):string{
  const parts=todayDate.split('-').map(Number);
  if(parts.length!==3||parts.some(isNaN))throw new Error('INVALID_TODAY_DATE_FOR_PREVIOUS_TRADING_DAY');
  const d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  for(let i=0;i<30;i++){
    d.setUTCDate(d.getUTCDate()-1);
    const candidate=formatTaiwanDateFromUtc(d);
    if(getTaiwanTradingDayInfo(candidate).is_trading_day)return candidate;
  }
  throw new Error('PREVIOUS_TAIWAN_TRADING_DAY_NOT_FOUND');
}

function buildMarketClosedReport(todayDate:string,tdInfo:TradingDayInfo):Record<string,unknown>{
  const holidayLabel=tdInfo.holiday_name||'休市日';
  return{
    version:VERSION,source:'Morning Alpha',generated_at:new Date().toISOString(),target_date:todayDate,report_date:todayDate,
    is_trading_day:tdInfo.is_trading_day,market_closed:tdInfo.market_closed,holiday_name:tdInfo.holiday_name,trading_day_reason:tdInfo.reason,market_status:tdInfo.is_trading_day?'OPEN':tdInfo.reason,session_type:tdInfo.session_type||'CLOSED',market_message:tdInfo.market_message||(tdInfo.is_trading_day?'今天正常交易。':'今日沒有台股交易，Morning Alpha 已切換休市模式。'),next_trading_day:tdInfo.next_trading_day||todayDate,
    market_bias:'休市',confidence_score:null,sentiment_score:50,quality_score:75,member_value_score:70,
    today_quote:'今日台股休市，不產生盤前交易判斷。',
    member_research_note:'今日台股'+holidayLabel+'，Morning Alpha 不產生盤前研究筆記。請於下一個台股交易日再查看完整盤前研究內容。',
    member_research_note_v2:{overnight_chain:[],taiwan_impact_map:[],beneficiary_candidates:[],intraday_validation:[],invalidation_rules:[],closing_feedback_plan:{what_to_compare:'今日台股休市，無收盤驗證。',success_criteria:'休市日不評分。',miss_reason_tracking:'下一個交易日恢復追蹤。'},subscriber_value_sentence:'今日台股'+holidayLabel+'休市，完整會員研究筆記不生成。',data_status:'insufficient'},
    v8_beneficiary_chain:{status:'insufficient',source_signals:[],beneficiaries:[]},
    v8_overnight_causal_chain:{status:'insufficient',chains:[]},
    v8_daily_sentence:{status:'insufficient',sentence:'',logic_source:[],tone:'clear, sharp, human-readable'},
    today_beneficiary_stocks:[],beneficiary_stocks:[],
    core_beneficiary_stocks:[],extended_watchlist:[],scenario_watchlist:[],
    data_status:'insufficient',data_basis_note:'今日台股'+holidayLabel+'休市，不進行受惠股分析。',
    watch_sectors_detailed:[],overnight_impact_chain:[],causal_overnight_impact_chains:[],
    opening_radar:[],intraday_radar:[],intraday_tracking_plan:[],reasoning_chain:[],
    free_summary:{today_status:'休市',one_sentence:'今日台股'+holidayLabel+'休市，無盤前交易判斷。',market_bias:'休市',confidence_score:null,do_not_do:'今日休市，不產生交易建議。',mindset:'休市日不進行盤前分析。',cta_hint:'查看下一個交易日盤前報告',},
    content_publish_gate:{overall_status:'休市日',blocking_issues:[]},
    content_quality_flags:{real_data:false,deterministic:true,no_ai_hallucination:true,dynamic_beneficiary:false,sector_driven:false},
    source_breakdown:{market_data_count:0,news_count:0,tw_core_symbols:0,us_global_symbols:0,sector_rotation_rows:0},
    renewal_value_block:{why_member_should_read_today:'今日台股'+holidayLabel+'休市，無盤前交易判斷。',what_free_news_does_not_provide:'休市日不提供盤前分析。',tomorrow_followup_hook:'下一個交易日將恢復正常盤前報告。',},
    line_push_copy:{title:'Morning Alpha｜'+todayDate+' 休市',market_bias:'休市',confidence:'0',one_sentence:'今日台股'+holidayLabel+'休市',do_not_do:'今日休市',watch_point:'下一個交易日',cta:'無',},
    openai_used:false,build_method:'market_closed_holiday',tw_stock_filter_applied:true,no_fake_fallback:true,fake_fallback_used:false,data_date_aligned:true,publish_ready:true,
  };
}

function corsResponse(body:Record<string,unknown>,status:number):Response{try{return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...CORS_HEADERS}})}catch(e){return new Response(JSON.stringify({success:false,error:'RESPONSE_SERIALIZATION_FAILED',version:VERSION}),{status:500,headers:{'Content-Type':'application/json',...CORS_HEADERS}})}}
function safeUnwrap<T>(result:unknown,log:(m:string)=>void,label:string):{data:T|null;error:string|null}{if(!result||typeof result!=='object'){log('safeUnwrap['+label+']: null');return{data:null,error:'RESULT_UNDEFINED'}}const r=result as{data?:T;error?:{message?:string}|null};return{data:r.data??null,error:r.error?.message||null}}
function attachResearchMasterV2Shadow(target:Record<string,unknown>,input:ResearchMasterV2AssemblerInput,log:(message:string)=>void):void{
  try{
    const master=assembleResearchMasterV2(input);
    const validation=validateResearchMasterV2(master);
    target.research_master_v2={...master,quality:validation.quality};
    log('RESEARCH_MASTER_V2_SHADOW status='+validation.quality.publish_status+' coverage='+validation.quality.evidence_coverage+' unsupported='+validation.quality.unsupported_claims.length+' missing='+validation.quality.missing_sections.length+' contradictions='+validation.quality.contradictions.length);
  }catch(error){
    const safeMessage=(error instanceof Error?error.message:String(error)).replace(/\s+/g,' ').slice(0,240);
    target.research_master_v2=buildBlockedResearchMasterV2(input,'assembler_failed');
    log('RESEARCH_MASTER_V2_SHADOW_ERROR code=assembler_failed message='+safeMessage);
  }
}
const HOURS_24=86400000;

type StepTimer={mark:(label:string,extra?:string)=>void;total:()=>number};
function createStepTimer(log:(m:string)=>void):StepTimer{
  const started=Date.now();let last=started;
  return{mark:function(label:string,extra:string=''){const now=Date.now();log('TIMING '+label+' step_ms='+(now-last)+' total_ms='+(now-started)+(extra?' '+extra:''));last=now;},total:function(){return Date.now()-started;}};
}
async function withTimeout<T>(work:Promise<T>,timeoutMs:number,label:string,log:(m:string)=>void,fallback:T):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<T>(function(resolve){timer=setTimeout(function(){log('TIMEOUT '+label+' timeout_ms='+timeoutMs);resolve(fallback);},timeoutMs);})]);}
  catch(e){log('FAILED '+label+': '+(e instanceof Error?e.message:String(e)));return fallback;}
  finally{if(timer!==undefined)clearTimeout(timer);}
}
async function fetchWithTimeout(url:string,options:RequestInit={},timeoutMs:number=5000,label:string='fetch',log:(m:string)=>void=console.log):Promise<Response|null>{
  const controller=new AbortController();const timer=setTimeout(function(){controller.abort();},timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(e){log('FETCH_TIMEOUT_OR_FAIL '+label+' timeout_ms='+timeoutMs+' error='+(e instanceof Error?e.message:String(e)));return null;}
  finally{clearTimeout(timer);}
}

type MarketIndicator={symbol:string;name:string;market:string;value:number;change:number;changePercent:number;updatedAt:string;status:string;taiwanImpact:string};
type MarketNewsItem={id:string;title:string;source:string;url:string;published_at:string|null;created_at:string;related_sectors:string[]|null;taiwan_impact_summary:string|null;raw_payload:Record<string,unknown>|null};
type FetchNewsResult={newsData:MarketNewsItem[];latestNewsTime:Date|null;isStale:boolean;newsCount:number};
type MarketDataScore={baseScore:number;reasons:string[];riskReasons:string[];details:Record<string,number>};
type ReportConfidenceScore={score:number;breakdown:Record<string,unknown>};
type TWCoreStatus={taiexPresent:boolean;txfPresent:boolean;ts2330Present:boolean;missingCount:number;dataInsufficient:boolean};
type MVPStatus={nvdaPresent:boolean;tsmPresent:boolean;spxPresent:boolean;mvpCount:number;mvpInsufficient:boolean};

type SectorRotationRow={sector:string;sub_sector:string;rotation_score:number;direction:string;signal_label:string;leading_symbols:string[];lagging_symbols:string[];summary?:string};
type MemberResearchNoteV2={overnight_chain:Record<string,unknown>[];taiwan_impact_map:Record<string,unknown>[];beneficiary_candidates:Record<string,unknown>[];intraday_validation:Record<string,unknown>[];invalidation_rules:Record<string,unknown>[];closing_feedback_plan:Record<string,unknown>;subscriber_value_sentence:string;data_status:'complete'|'partial'|'insufficient';today_core_thesis?:string;market_mispricing?:string;institutional_behavior?:string;fund_flow_scenario?:string;beneficiary_reasoning?:Record<string,unknown>[];close_backtest_plan?:Record<string,unknown>;tomorrow_extension_watch?:string[];opening_thesis?:Record<string,unknown>;core_reasoning?:string[];first_beneficiary_stock?:Record<string,unknown>|null;risk_scenarios?:Record<string,unknown>[];capital_rotation_scenarios?:Record<string,unknown>[];tomorrow_follow_up?:Record<string,unknown>;closing_feedback_placeholder?:Record<string,unknown>;intraday_time_windows?:Record<string,unknown>[]};
type V8Contract={v8_beneficiary_chain:Record<string,unknown>;v8_overnight_causal_chain:Record<string,unknown>;v8_daily_sentence:Record<string,unknown>};
type V10EvidencePack=Record<string,unknown>;
type V10EvidenceItem={evidence_id:string;evidence_type:string;source:string;title:string;summary:string;importance:number;freshness:string;raw_reference:string};
type V10EvidenceReference={evidence_id:string;weight:number;purpose:string};
type V10AlternativeHypothesis={driver:string;why_rejected:string;supporting_evidence:V10EvidenceReference[]};
type V10MarketThesisConfidenceInputs={available_sources:string[];missing_sources:string[];evidence_count:number;freshness:Record<string,unknown>;validation_coverage:Record<string,unknown>};
type V10CandidateCard={symbol:string;name:string;sector:string;industry:string;industry_code:string;market_cap_bucket:string;liquidity_score:number;trigger_tags:string[];related_evidence:V10EvidenceReference[];historical_repeat_days:number;repeat_penalty:number;eligibility:boolean;excluded_reason:string};
type V10EvaluationLevel='LOW'|'MEDIUM'|'HIGH';
type V10RiskPenaltyLevel='NONE'|'LOW'|'MEDIUM'|'HIGH';
type V10EvaluationDimension={level:V10EvaluationLevel;reason:string;supporting_evidence:V10EvidenceReference[]};
type V10RiskPenaltyDimension={level:V10RiskPenaltyLevel;reason:string;supporting_evidence:V10EvidenceReference[]};
type V10CandidateEvaluation={catalyst_strength:V10EvaluationDimension;transmission_strength:V10EvaluationDimension;evidence_quality:V10EvaluationDimension;validation_readiness:V10EvaluationDimension;risk_penalty:V10RiskPenaltyDimension};
type V10CandidateEvaluationRecord={symbol:string;name:string;evaluation:V10CandidateEvaluation};
type V10CandidateScoreBreakdown={symbol:string;name:string;catalyst_strength_score:number;transmission_strength_score:number;evidence_quality_score:number;validation_readiness_score:number;risk_penalty_score:number;repeat_penalty:number;final_score:number;rank:number;score_basis:string[]};
type V10CandidateScoreRecord=V10CandidateScoreBreakdown;
type V10DecisionSummary={summary_version:'V10';primary_driver:string;taiwan_transmission:string;primary_validation_axis:string;top_candidates:Record<string,unknown>[];key_risks:string[];rejected_hypotheses:Record<string,unknown>[];evidence_summary:Record<string,unknown>[];capital_flow_summary?:Record<string,unknown>;narrative_guardrails:string[]};
type V10CapitalFlowStage={stage:'IMMEDIATE'|'EARLY'|'EXPANSION'|'LATE';impact_horizon:'TODAY'|'1_3_DAYS'|'3_10_DAYS'|'LONGER';target_sector:string;representative_candidates:Record<string,unknown>[];reasoning:string;supporting_evidence:V10EvidenceReference[]};
type V10CapitalFlowChain={global_event:string;market_thesis:string;stages:V10CapitalFlowStage[]};
type V10FeatureFlags={ENABLE_V10_THESIS:boolean;ENABLE_V10_CANDIDATE:boolean;ENABLE_V10_SCORE:boolean;ENABLE_V10_NARRATIVE:boolean};
const V10_FEATURE_FLAGS:V10FeatureFlags={ENABLE_V10_THESIS:true,ENABLE_V10_CANDIDATE:false,ENABLE_V10_SCORE:false,ENABLE_V10_NARRATIVE:false};
type V10AgentContract={agent_name:string;mission:string;input:string[];output:string[];forbidden:string[];success_criteria:string[];failure_criteria:string[]};
type V10QAContract={checks:string[];required_consistency:string[];failure_modes:string[];debug_action:string};
type V10MarketThesisContract={primary_driver:string;secondary_driver:string;market_story:string;taiwan_transmission:string;primary_validation_axis:string;data_basis:string[];confidence:number;confidence_inputs:V10MarketThesisConfidenceInputs;supporting_evidence:V10EvidenceReference[];counter_evidence:V10EvidenceReference[];alternative_hypotheses:V10AlternativeHypothesis[];evidence_breakdown:Record<string,number>;bull_case:string;bear_case:string;confidence_reason:string};
type V10BeneficiaryCandidateContract={symbol:string;name:string;sector:string;trigger_event:string;transmission_logic:string;evidence_inputs:string[];score:number;confidence:number;intraday_validation:string;invalidation_condition:string;supporting_evidence:V10EvidenceReference[];counter_evidence:V10EvidenceReference[]};
type V10RiskContract={bull_case:string;bear_case:string;key_risks:string[];failure_condition:string;supporting_evidence:V10EvidenceReference[]};
type V10ValidationItemContract={target:string;condition:string;importance:number;related_evidence:V10EvidenceReference[]};
type V10ValidationContract={intraday:V10ValidationItemContract[];closing:V10ValidationItemContract[]};
type V10ReasoningSummaryContract={why_today:string;why_taiwan:string;why_top_candidate:string};
type V10DecisionMetadataContract={analysis_version:'V10';evidence_version:'V10';generated_at:string;missing_sources:string[];warning_flags:string[]};
type V10DecisionContract={contract_version:'V10';market_thesis:V10MarketThesisContract;beneficiary_candidates:V10BeneficiaryCandidateContract[];risk_analysis:V10RiskContract;validation_plan:V10ValidationContract;reasoning_summary:V10ReasoningSummaryContract;metadata:V10DecisionMetadataContract};
type V10ContractValidationResult={is_valid:boolean;errors:string[];warnings:string[]};

type BiasGuardrailResult={adjustedScore:number;riskSignals:string[];staleSignals:string[];unavailableSignals:string[];negativeCoreCount:number;maxBias:string;shouldDowngrade:boolean};
function findIndicator(md:MarketIndicator[],syms:string[]):MarketIndicator|null{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null;}
function fmtSignedPct(v:number):string{return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'}
function marketDataAgeHours(m:MarketIndicator):number|null{const raw=m.updatedAt||'';const t=Date.parse(raw);if(!Number.isFinite(t))return null;return (Date.now()-t)/3600000;}
function isCoreMarketDataStale(m:MarketIndicator):boolean{const age=marketDataAgeHours(m);return age===null||age>36;}
function isTXFSymbol(symbol:string):boolean{return ['TXF','TX','MTX','TXF1'].includes(symbol.toUpperCase());}
function detectStaleCoreMarketData(md:MarketIndicator[]):string[]{const core=['SPX','IXIC','NASDAQ','SOX','PHLX','NVDA','TSM','TSMC','VIX','VIXINDEX','TAIEX','2330'];const out:string[]=[];for(const m of md){if(core.includes(m.symbol.toUpperCase())&&isCoreMarketDataStale(m))out.push(m.symbol+':'+(m.updatedAt||'unknown_time'));}return Array.from(new Set(out));}
function detectUnavailableMarketData(md:MarketIndicator[]):string[]{const txf=findIndicator(md,['TXF','TX','MTX','TXF1']);return txf&&isCoreMarketDataStale(txf)?['TXF:no_authorized_source_or_contract_mapping'] : [];}


function normalizeV10EventType(text:string):string{const t=text.toLowerCase();if(/ai server|ai伺服器|nvidia|nvda|blackwell|gb200|gb300/.test(t))return 'ai_server';if(/semiconductor|chip|半導體|tsmc|台積電|sox/.test(t))return 'semiconductor';if(/fed|rate|yield|利率|殖利率|fomc/.test(t))return 'macro_rate';if(/dxy|dollar|usd|匯率|美元/.test(t))return 'fx';if(/oil|crude|wti|brent|原油/.test(t))return 'oil';if(/war|geopolitic|地緣|軍事|conflict/.test(t))return 'geopolitics';if(/earnings|revenue|guidance|財報|法說|指引/.test(t))return 'earnings';if(/tariff|關稅|trade war|export control/.test(t))return 'tariff';if(/policy|政策|regulation|補助/.test(t))return 'policy';return 'other';}
function v10FreshnessLabel(iso?:string|null):string{if(!iso)return 'unknown';const age=(Date.now()-new Date(iso).getTime())/36e5;if(!Number.isFinite(age))return 'unknown';if(age<=18)return 'fresh';if(age<=48)return 'recent';return 'stale';}
function v10Direction(changePercent:unknown):string|null{const n=typeof changePercent==='number'?changePercent:Number(changePercent);if(!Number.isFinite(n))return null;if(n>0.25)return 'up';if(n<-0.25)return 'down';return 'flat';}
function v10Indicator(md:MarketIndicator[],syms:string[]):Record<string,unknown>|null{const m=findIndicator(md,syms);if(!m)return null;return {symbol:m.symbol,name:m.name??m.symbol,value:m.value??null,change_percent:m.change_percent??null,direction:v10Direction(m.change_percent),captured_at:m.captured_at??null,updated_at:(m as Record<string,unknown>).updated_at??m.updatedAt??null,source:(m as Record<string,unknown>).source??null,provider:(m as Record<string,unknown>).provider??null,freshness_status:(m as Record<string,unknown>).freshness_status??v10FreshnessLabel(m.captured_at??m.updatedAt??null)};}
function v10WhyTaiwanMatters(symbol:string):string|null{const s=symbol.toUpperCase();if(['SOX','IXIC','NASDAQ','NVDA','TSM','AAPL','MSFT','META','AMZN'].includes(s))return '影響台股電子、AI與半導體權值股風險偏好';if(['SPX','DJIA','VIX','DXY','US10Y','CL','CRUDE','OIL'].includes(s))return '影響全球風險偏好、資金成本與外資風險部位';if(['TAIEX','TXF','2330'].includes(s))return '直接反映台股現貨、期貨與權值股盤前/盤中方向';return null;}
function buildV10OvernightMoves(md:MarketIndicator[]):Record<string,unknown>[]{const symbols=[['SPX'],['IXIC','NASDAQ'],['SOX'],['DJIA'],['NVDA'],['TSM'],['AAPL'],['MSFT'],['META'],['AMZN'],['VIX'],['DXY'],['US10Y'],['CL','CRUDE_OIL','WTI'],['TAIEX'],['TXF'],['2330']];return symbols.map((syms)=>findIndicator(md,syms)).filter(Boolean).map((m)=>({symbol:m!.symbol,name:m!.name??m!.symbol,change_percent:m!.change_percent??null,direction:v10Direction(m!.change_percent),importance:['SOX','IXIC','NASDAQ','NVDA','TSM','VIX','TXF','TAIEX','2330'].includes(String(m!.symbol).toUpperCase())?'core':'context',why_it_matters_for_taiwan:v10WhyTaiwanMatters(String(m!.symbol))}));}
function buildV10NewsClusters(newsData:MarketNewsItem[]):Record<string,unknown>[]{const clusters=new Map<string,{topic:string;event_type:string;items:MarketNewsItem[];symbols:Set<string>;sectors:Set<string>}>();for(const item of newsData){const raw=[item.title,item.taiwan_impact_summary,...(item.related_sectors??[])].filter(Boolean).join(' ');const eventType=normalizeV10EventType(raw);const topic=item.related_sectors?.[0]??eventType;const key=`${eventType}:${topic}`;if(!clusters.has(key))clusters.set(key,{topic,event_type:eventType,items:[],symbols:new Set(),sectors:new Set()});const c=clusters.get(key)!;c.items.push(item);for(const sector of item.related_sectors??[])c.sectors.add(sector);const upper=raw.toUpperCase();for(const sym of ['NVDA','TSM','AAPL','MSFT','META','AMZN','SOX','TSMC','2330'])if(upper.includes(sym))c.symbols.add(sym==='TSMC'?'TSM':sym);}return Array.from(clusters.values()).slice(0,12).map((c)=>({topic:c.topic,headline_count:c.items.length,representative_headlines:c.items.slice(0,3).map((i)=>i.title),related_symbols:Array.from(c.symbols),related_sectors:Array.from(c.sectors),event_type:c.event_type,freshness:v10FreshnessLabel(c.items[0]?.published_at??c.items[0]?.created_at??null)}));}
function buildV10SectorContext(sectorData:SectorRotationRow[]):Record<string,unknown>[]{return (sectorData??[]).map((row)=>({sector:row.sector,score:row.rotation_score??null,direction:row.direction??null,reason:row.signal_label??row.explanation??null,related_symbols:[...(row.leading_symbols??[]),...(row.lagging_symbols??[])]}));}
function readV10Stocks(value:unknown,limit=5):Record<string,unknown>[]{if(!Array.isArray(value))return [];return value.slice(0,limit).filter((item)=>item&&typeof item==='object').map((item)=>{const r=item as Record<string,unknown>;return {ticker:r.ticker??r.symbol??null,name:r.name??r.stock_name??null,category:r.category??r.sector??null,confidence:r.confidence??null};});}
function buildV10PreviousValidation(previousReport:Record<string,unknown>|null):Record<string,unknown>|null{if(!previousReport)return null;const json=(previousReport.ai_strategy_json&&typeof previousReport.ai_strategy_json==='object'?previousReport.ai_strategy_json:{} ) as Record<string,unknown>;const closing=(json.closing_verification_v2??json.closing_verification??null) as Record<string,unknown>|null;return {previous_report_date:previousReport.report_date??null,previous_market_bias:previousReport.market_bias??json.market_bias??null,previous_top_beneficiaries:readV10Stocks(json.today_beneficiary_stocks??json.beneficiary_stocks,5),previous_closing_verification:closing,what_was_right:closing?.what_was_right??closing?.correct_assumptions??null,what_was_wrong:closing?.what_was_wrong??closing?.failed_assumptions??null};}
function buildV10EvidencePack(args:{todayDate:string;dates:{twCoreDate:string;usGlobalDate:string};tradingDayInfo:TradingDayInfo;marketData:MarketIndicator[];newsData:MarketNewsItem[];sectorData:SectorRotationRow[];previousReport:Record<string,unknown>|null;dataQuality:string;missingSources:string[];staleCoreSources:string[];unavailableSources:string[];confidenceResult:ReportConfidenceScore}):V10EvidencePack{const missing=new Set<string>(args.missingSources??[]);const stale=new Set<string>(args.staleCoreSources??[]);const available=new Set<string>();const get=(key:string,syms:string[])=>{const value=v10Indicator(args.marketData,syms);if(!value){missing.add(`market_snapshot.${key}`);return null;}available.add(`market_snapshot.${key}`);if(String(value.freshness_status).toLowerCase()==='stale')stale.add(`market_snapshot.${key}`);return value;};const marketSnapshot={report_date:args.todayDate,data_freshness:{tw_core_date:args.dates.twCoreDate,us_global_date:args.dates.usGlobalDate},taiwan_market_status:{is_trading_day:args.tradingDayInfo.is_trading_day,market_closed:args.tradingDayInfo.market_closed,holiday_name:args.tradingDayInfo.holiday_name??null},taiex:get('taiex',['TAIEX','TWII','^TWII']),txf:get('txf',['TXF','TX','MTX','TXF1']),'2330':get('2330',['2330','2330.TW']),tsm_adr:get('tsm_adr',['TSM']),spx:get('spx',['SPX','^GSPC']),nasdaq:get('nasdaq',['IXIC','NASDAQ','^IXIC']),sox:get('sox',['SOX','^SOX']),djia:get('djia',['DJIA','^DJI']),nvda:get('nvda',['NVDA']),aapl:get('aapl',['AAPL']),msft:get('msft',['MSFT']),meta:get('meta',['META']),amzn:get('amzn',['AMZN']),vix:get('vix',['VIX','^VIX']),dxy:get('dxy',['DXY','DX-Y.NYB']),us10y:get('us10y',['US10Y','TNX','^TNX']),crude_oil:get('crude_oil',['CL','WTI','CRUDE_OIL'])};if(args.marketData.length)available.add('market_data');else missing.add('market_data');if(args.newsData.length)available.add('market_news');else missing.add('market_news');if(args.sectorData.length)available.add('sector_rotation_scores');else missing.add('sector_rotation_scores');const previousValidation=buildV10PreviousValidation(args.previousReport);if(previousValidation)available.add('previous_report');else missing.add('previous_validation');for(const u of args.unavailableSources??[])missing.add(u);const warningFlags=[...(args.dataQuality==='degraded'?['data_quality_degraded']:[]),...(args.unavailableSources??[]).map((source)=>`unavailable:${source}`),...(stale.size?['stale_core_sources_present']:[])];return {market_snapshot:marketSnapshot,overnight_moves:buildV10OvernightMoves(args.marketData),news_clusters:buildV10NewsClusters(args.newsData),sector_context:buildV10SectorContext(args.sectorData),previous_validation:previousValidation,data_quality:{available_sources:Array.from(available),missing_sources:Array.from(missing),stale_sources:Array.from(stale),confidence_base:args.confidenceResult.score,warning_flags:warningFlags}};}

function v10UpperDirection(value:unknown):string|null{const d=String(value??'').toLowerCase();if(d==='up')return 'UP';if(d==='down')return 'DOWN';if(d==='flat')return 'FLAT';return null;}
function normalizeV10MarketSnapshot(evidencePack:V10EvidencePack):Record<string,unknown>[]{const snapshot=(evidencePack.market_snapshot&&typeof evidencePack.market_snapshot==='object'?evidencePack.market_snapshot:{} ) as Record<string,unknown>;const defs=[['spx','SPX','index','US',82,60,'美股大盤風險偏好'],['nasdaq','NASDAQ','index','US',90,85,'科技股風險偏好'],['djia','DJIA','index','US',60,35,'美股傳統大型股風向'],['sox','SOX','index','US',98,96,'半導體族群對台股電子權值影響'],['tsm_adr','TSM','equity','US',96,98,'台積電 ADR 對 2330 與台股電子開盤情緒影響'],['nvda','NVDA','equity','US',94,92,'AI server 與半導體供應鏈風向'],['aapl','AAPL','equity','US',65,45,'大型科技與消費電子供應鏈情緒'],['msft','MSFT','equity','US',70,50,'AI 與雲端資本支出風向'],['meta','META','equity','US',60,45,'AI capex 與大型科技風險偏好'],['amzn','AMZN','equity','US',58,38,'雲端與大型科技風險偏好'],['vix','VIX','volatility','US',88,70,'市場風險溫度'],['dxy','DXY','fx','US',75,62,'美元強弱與外資資金壓力'],['us10y','US10Y','rate','US',78,68,'美債殖利率與估值壓力'],['crude_oil','CRUDE OIL','commodity','GLOBAL',55,35,'能源成本與通膨預期'],['taiex','TAIEX','index','TW',100,100,'台股現貨大盤方向'],['txf','TXF','futures','TW',95,95,'台指期與盤前/盤中風險方向'],['2330','2330','equity','TW',100,100,'台股最大權值與半導體核心驗證股']];return defs.map((def)=>{const [key,symbol,assetType,market,importance,taiwanRelevance,description]=def;const raw=snapshot[String(key)];if(!raw||typeof raw!=='object')return null;const r=raw as Record<string,unknown>;return {symbol,asset_type:assetType,market,direction:v10UpperDirection(r.direction),change_percent:r.change_percent??null,importance,taiwan_relevance:taiwanRelevance,description,raw_source:'market_data'};}).filter(Boolean) as Record<string,unknown>[];}
function normalizeV10NewsEventType(value:unknown):string{const t=String(value??'other').toLowerCase();if(t==='ai_server')return 'AI_SERVER';if(t==='semiconductor')return 'SEMICONDUCTOR';if(t==='earnings')return 'EARNINGS';if(t==='macro_rate')return 'RATE';if(t==='fx')return 'FX';if(t==='oil')return 'OIL';if(t==='tariff')return 'TARIFF';if(t==='policy')return 'POLICY';if(t==='geopolitics')return 'GEOPOLITICS';return 'OTHER';}
function v10NewsSentiment(text:string):'positive'|'negative'|'neutral'{const t=text.toLowerCase();if(/surge|beat|strong|record|rally|上修|優於|成長|強勁|利多/.test(t))return 'positive';if(/drop|fall|miss|weak|risk|tariff|war|cut|下修|低於|衰退|利空|風險/.test(t))return 'negative';return 'neutral';}
function normalizeV10NewsClusters(evidencePack:V10EvidencePack):Record<string,unknown>[]{const clusters=Array.isArray(evidencePack.news_clusters)?evidencePack.news_clusters:[];return clusters.map((item)=>{const c=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;const headlines=Array.isArray(c.representative_headlines)?c.representative_headlines.map(String):[];const text=[c.topic,...headlines].filter(Boolean).join(' ');const eventType=normalizeV10NewsEventType(c.event_type);const count=Number(c.headline_count??headlines.length)||0;const base={AI_SERVER:92,SEMICONDUCTOR:90,EARNINGS:78,RATE:82,FX:72,OIL:60,TARIFF:76,POLICY:68,GEOPOLITICS:70,OTHER:45}[eventType]??45;return {topic:c.topic??eventType,event_type:eventType,importance:Math.min(100,base+Math.min(8,count)),sentiment:v10NewsSentiment(text),related_markets:Array.isArray(c.related_symbols)?c.related_symbols:[],related_sectors:Array.isArray(c.related_sectors)?c.related_sectors:[],representative_summary:headlines[0]??String(c.topic??''),headline_count:count,freshness:c.freshness??'unknown'};});}
function buildV10MarketContext(normalizedMarket:Record<string,unknown>[],normalizedNews:Record<string,unknown>[]):Record<string,unknown>{const all=[...normalizedMarket.map((m)=>({...m,context_type:'market'})),...normalizedNews.map((n)=>({...n,context_type:'news'}))].sort((a,b)=>Number(b.importance??0)-Number(a.importance??0));const primaryEvent=all[0]??null;const secondaryEvents=all.slice(1,6);const ignoredEvents=all.slice(6).map((e)=>({context_type:e.context_type,symbol:e.symbol??null,topic:e.topic??null,importance:e.importance??null}));const focus=normalizedMarket.sort((a,b)=>Number(b.importance??0)-Number(a.importance??0)).slice(0,5).map((m)=>String(m.symbol));const macroItems=normalizedMarket.filter((m)=>['VIX','DXY','US10Y','CRUDE OIL','SPX','NASDAQ'].includes(String(m.symbol)));const macroSummary=macroItems.map((m)=>`${m.symbol}:${m.direction??'UNKNOWN'}${m.change_percent!==null&&m.change_percent!==undefined?` ${m.change_percent}%`:''}`).join(' | ');return {primary_event:primaryEvent,secondary_events:secondaryEvents,ignored_events:ignoredEvents,macro_summary:macroSummary||'no_macro_evidence',market_focus:focus};}
function buildV10NormalizedEvidence(evidencePack:V10EvidencePack):Record<string,unknown>{const normalizedMarket=normalizeV10MarketSnapshot(evidencePack);const normalizedNews=normalizeV10NewsClusters(evidencePack);return {normalized_market_snapshot:normalizedMarket,normalized_news:normalizedNews,market_context:buildV10MarketContext(normalizedMarket,normalizedNews),sector_context:evidencePack.sector_context??[],previous_validation:evidencePack.previous_validation??null,data_quality:evidencePack.data_quality??{}};}


function buildEmptyV10DecisionContract(evidencePack?:V10EvidencePack):V10DecisionContract{const dq=(evidencePack?.data_quality&&typeof evidencePack.data_quality==='object'?evidencePack.data_quality:{} ) as Record<string,unknown>;return {contract_version:'V10',market_thesis:{primary_driver:'',secondary_driver:'',market_story:'',taiwan_transmission:'',primary_validation_axis:'',data_basis:[],confidence:0,confidence_inputs:{available_sources:[],missing_sources:[],evidence_count:0,freshness:{},validation_coverage:{}},supporting_evidence:[],counter_evidence:[],alternative_hypotheses:[],evidence_breakdown:{},bull_case:'',bear_case:'',confidence_reason:''},beneficiary_candidates:[],risk_analysis:{bull_case:'',bear_case:'',key_risks:[],failure_condition:'',supporting_evidence:[]},validation_plan:{intraday:[],closing:[]},reasoning_summary:{why_today:'',why_taiwan:'',why_top_candidate:''},metadata:{analysis_version:'V10',evidence_version:'V10',generated_at:new Date().toISOString(),missing_sources:Array.isArray(dq.missing_sources)?dq.missing_sources.map(String):[],warning_flags:Array.isArray(dq.warning_flags)?dq.warning_flags.map(String):[]}};}
function validateV10Range(value:unknown,path:string,errors:string[]):void{const n=typeof value==='number'?value:Number(value);if(!Number.isFinite(n)||n<0||n>100)errors.push(`${path} must be a number between 0 and 100`);}
function validateV10Text(value:unknown,path:string,errors:string[]):void{if(typeof value!=='string'||value.trim().length===0)errors.push(`${path} must be a non-empty string`);}
function validateV10StringArray(value:unknown,path:string,errors:string[]):void{if(!Array.isArray(value)){errors.push(`${path} must be an array`);return;}for(let i=0;i<value.length;i++){if(typeof value[i]!=='string'||String(value[i]).trim().length===0)errors.push(`${path}[${i}] must be a non-empty string`);}}
function validateV10ValidationItems(value:unknown,path:string,errors:string[],warnings:string[]):void{if(!Array.isArray(value)){errors.push(`${path} must be an array`);return;}if(value.length===0)warnings.push(`${path} is empty`);for(let i=0;i<value.length;i++){const item=(value[i]&&typeof value[i]==='object'?value[i]:null) as Record<string,unknown>|null;if(!item){errors.push(`${path}[${i}] must be an object`);continue;}validateV10Text(item.target,`${path}[${i}].target`,errors);validateV10Text(item.condition,`${path}[${i}].condition`,errors);validateV10Range(item.importance,`${path}[${i}].importance`,errors);if(!Array.isArray(item.related_evidence))errors.push(`${path}[${i}].related_evidence must be an array`);}}
function validateV10DecisionContract(contract:unknown):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];if(!contract||typeof contract!=='object')return {is_valid:false,errors:['contract must be an object'],warnings};const c=contract as Record<string,unknown>;if(c.contract_version!=='V10')errors.push('contract_version must be V10');const thesis=(c.market_thesis&&typeof c.market_thesis==='object'?c.market_thesis:null) as Record<string,unknown>|null;if(!thesis)errors.push('market_thesis is required');else{for(const key of ['primary_driver','secondary_driver','market_story','taiwan_transmission','primary_validation_axis','bull_case','bear_case','confidence_reason'])validateV10Text(thesis[key],`market_thesis.${key}`,errors);validateV10StringArray(thesis.data_basis,'market_thesis.data_basis',errors);validateV10Range(thesis.confidence,'market_thesis.confidence',errors);if(!thesis.confidence_inputs||typeof thesis.confidence_inputs!=='object')errors.push('market_thesis.confidence_inputs must be an object');if(!Array.isArray(thesis.supporting_evidence))errors.push('market_thesis.supporting_evidence must be an array');if(!Array.isArray(thesis.counter_evidence))errors.push('market_thesis.counter_evidence must be an array');if(!Array.isArray(thesis.alternative_hypotheses)||thesis.alternative_hypotheses.length<2)errors.push('market_thesis.alternative_hypotheses must contain at least 2 items');if(!thesis.evidence_breakdown||typeof thesis.evidence_breakdown!=='object')errors.push('market_thesis.evidence_breakdown must be an object');}const candidates=c.beneficiary_candidates;if(!Array.isArray(candidates))errors.push('beneficiary_candidates must be an array');else{if(candidates.length===0)warnings.push('beneficiary_candidates is empty');for(let i=0;i<candidates.length;i++){const item=(candidates[i]&&typeof candidates[i]==='object'?candidates[i]:null) as Record<string,unknown>|null;if(!item){errors.push(`beneficiary_candidates[${i}] must be an object`);continue;}for(const key of ['symbol','name','sector','trigger_event','transmission_logic','intraday_validation','invalidation_condition'])validateV10Text(item[key],`beneficiary_candidates[${i}].${key}`,errors);validateV10StringArray(item.evidence_inputs,`beneficiary_candidates[${i}].evidence_inputs`,errors);validateV10Range(item.score,`beneficiary_candidates[${i}].score`,errors);validateV10Range(item.confidence,`beneficiary_candidates[${i}].confidence`,errors);if(!Array.isArray(item.supporting_evidence))errors.push(`beneficiary_candidates[${i}].supporting_evidence must be an array`);if(!Array.isArray(item.counter_evidence))errors.push(`beneficiary_candidates[${i}].counter_evidence must be an array`);const symbol=String(item.symbol??'').trim();if(symbol&&!TW_STOCK_WHITELIST.has(symbol))errors.push(`beneficiary_candidates[${i}].symbol is not in TW_STOCK_WHITELIST`);}}const risk=(c.risk_analysis&&typeof c.risk_analysis==='object'?c.risk_analysis:null) as Record<string,unknown>|null;if(!risk)errors.push('risk_analysis is required');else{for(const key of ['bull_case','bear_case','failure_condition'])validateV10Text(risk[key],`risk_analysis.${key}`,errors);validateV10StringArray(risk.key_risks,'risk_analysis.key_risks',errors);if(!Array.isArray(risk.supporting_evidence))errors.push('risk_analysis.supporting_evidence must be an array');}const validation=(c.validation_plan&&typeof c.validation_plan==='object'?c.validation_plan:null) as Record<string,unknown>|null;if(!validation)errors.push('validation_plan is required');else{validateV10ValidationItems(validation.intraday,'validation_plan.intraday',errors,warnings);validateV10ValidationItems(validation.closing,'validation_plan.closing',errors,warnings);}const reasoning=(c.reasoning_summary&&typeof c.reasoning_summary==='object'?c.reasoning_summary:null) as Record<string,unknown>|null;if(!reasoning)errors.push('reasoning_summary is required');else{for(const key of ['why_today','why_taiwan','why_top_candidate'])validateV10Text(reasoning[key],`reasoning_summary.${key}`,errors);}const metadata=(c.metadata&&typeof c.metadata==='object'?c.metadata:null) as Record<string,unknown>|null;if(!metadata)errors.push('metadata is required');else{if(metadata.analysis_version!=='V10')errors.push('metadata.analysis_version must be V10');if(metadata.evidence_version!=='V10')errors.push('metadata.evidence_version must be V10');validateV10Text(metadata.generated_at,'metadata.generated_at',errors);validateV10StringArray(metadata.missing_sources,'metadata.missing_sources',errors);validateV10StringArray(metadata.warning_flags,'metadata.warning_flags',errors);}return {is_valid:errors.length===0,errors,warnings};}


function buildEvidenceIndex(normalizedEvidence:Record<string,unknown>):V10EvidenceItem[]{const out:V10EvidenceItem[]=[];const push=(prefix:string,index:number,type:string,source:string,title:string,summary:string,importance:unknown,freshness:unknown,rawReference:string)=>{out.push({evidence_id:`${prefix}${String(index+1).padStart(3,'0')}`,evidence_type:type,source,title,summary,importance:Number.isFinite(Number(importance))?Number(importance):0,freshness:String(freshness??'unknown'),raw_reference:rawReference});};const market=Array.isArray(normalizedEvidence.normalized_market_snapshot)?normalizedEvidence.normalized_market_snapshot:[];market.forEach((item,idx)=>{const m=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;push('MD',idx,'market_data',String(m.raw_source??'market_data'),String(m.symbol??''),`${String(m.symbol??'')} ${String(m.direction??'')} ${String(m.change_percent??'')}% ${String(m.description??'')}`,m.importance,m.freshness??'unknown',String(m.symbol??''));});const news=Array.isArray(normalizedEvidence.normalized_news)?normalizedEvidence.normalized_news:[];news.forEach((item,idx)=>{const n=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;push('NEWS',idx,'market_news','market_news',String(n.topic??n.event_type??''),String(n.representative_summary??''),n.importance,n.freshness??'unknown',String(n.topic??''));});const sectors=Array.isArray(normalizedEvidence.sector_context)?normalizedEvidence.sector_context:[];sectors.forEach((item,idx)=>{const sec=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;push('SEC',idx,'sector_rotation','sector_rotation_scores',String(sec.sector??''),String(sec.reason??sec.direction??''),sec.score??50,'previous_trading_day',String(sec.sector??''));});const prev=normalizedEvidence.previous_validation;if(prev&&typeof prev==='object'){const p=prev as Record<string,unknown>;push('VAL',0,'previous_validation','reports',String(p.previous_report_date??'previous_report'),String(p.previous_market_bias??''),70,'previous_report',String(p.previous_report_date??''));}return out;}
function validateV10EvidenceReferenceArray(value:unknown,path:string,evidenceIds:Set<string>,errors:string[],warnings:string[]):void{if(!Array.isArray(value)){errors.push(`${path} must be an array`);return;}const missingSeen=new Set<string>();for(let i=0;i<value.length;i++){const ref=(value[i]&&typeof value[i]==='object'?value[i]:null) as Record<string,unknown>|null;if(!ref){errors.push(`${path}[${i}] must be an object`);continue;}const id=String(ref.evidence_id??'').trim();if(!id){errors.push(`${path}[${i}].evidence_id must be a non-empty string`);}else if(!evidenceIds.has(id)){errors.push(`${path}[${i}].evidence_id does not exist in evidence_index`);if(missingSeen.has(id))warnings.push(`${path}[${i}].evidence_id repeats a missing evidence reference`);missingSeen.add(id);}validateV10Range(ref.weight,`${path}[${i}].weight`,errors);validateV10Text(ref.purpose,`${path}[${i}].purpose`,errors);}}
function validateEvidenceReferences(contract:unknown,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const ids=new Set(evidenceIndex.map((item)=>item.evidence_id));if(!contract||typeof contract!=='object')return {is_valid:false,errors:['contract must be an object'],warnings};const c=contract as Record<string,unknown>;const thesis=(c.market_thesis&&typeof c.market_thesis==='object'?c.market_thesis:{} ) as Record<string,unknown>;validateV10EvidenceReferenceArray(thesis.supporting_evidence,'market_thesis.supporting_evidence',ids,errors,warnings);validateV10EvidenceReferenceArray(thesis.counter_evidence,'market_thesis.counter_evidence',ids,errors,warnings);const alternatives=Array.isArray(thesis.alternative_hypotheses)?thesis.alternative_hypotheses:[];if(alternatives.length<2)errors.push('market_thesis.alternative_hypotheses must contain at least 2 items');alternatives.forEach((item,idx)=>{const alt=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;validateV10EvidenceReferenceArray(alt.supporting_evidence,`market_thesis.alternative_hypotheses[${idx}].supporting_evidence`,ids,errors,warnings);});const candidates=Array.isArray(c.beneficiary_candidates)?c.beneficiary_candidates:[];candidates.forEach((item,idx)=>{const cand=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;validateV10EvidenceReferenceArray(cand.supporting_evidence,`beneficiary_candidates[${idx}].supporting_evidence`,ids,errors,warnings);validateV10EvidenceReferenceArray(cand.counter_evidence,`beneficiary_candidates[${idx}].counter_evidence`,ids,errors,warnings);});const risk=(c.risk_analysis&&typeof c.risk_analysis==='object'?c.risk_analysis:{} ) as Record<string,unknown>;validateV10EvidenceReferenceArray(risk.supporting_evidence,'risk_analysis.supporting_evidence',ids,errors,warnings);const validation=(c.validation_plan&&typeof c.validation_plan==='object'?c.validation_plan:{} ) as Record<string,unknown>;for(const group of ['intraday','closing']){const items=Array.isArray(validation[group])?validation[group]:[];items.forEach((item,idx)=>{const v=(item&&typeof item==='object'?item:{} ) as Record<string,unknown>;validateV10EvidenceReferenceArray(v.related_evidence,`validation_plan.${group}[${idx}].related_evidence`,ids,errors,warnings);});}return {is_valid:errors.length===0,errors,warnings};}


type V10CandidateMetadata={name:string;sector:string;industry:string;industry_code:string;market_cap_bucket:string;liquidity_score:number;tags:string[]};
function v10Candidate(name:string,sector:string,industry:string,industryCode:string,marketCapBucket:string,liquidityScore:number,tags:string[]):V10CandidateMetadata{return {name,sector,industry,industry_code:industryCode,market_cap_bucket:marketCapBucket,liquidity_score:liquidityScore,tags:Array.from(new Set([...tags,industryCode]))};}

// V10 candidate universe seed data. This is only a candidate pool: stocks enter the
// universe only when evidence/event tags match, then evaluation/ranking handles the rest.
const V10_CANDIDATE_METADATA:Record<string,V10CandidateMetadata>={
  '2330':v10Candidate('台積電','電子權值','晶圓代工','ELECTRONIC_BLUE_CHIP','mega',100,['SEMICONDUCTOR','AI_SERVER','TSM_ADR','TAIEX','SOX']),
  '2454':v10Candidate('聯發科','電子權值','IC設計','ELECTRONIC_BLUE_CHIP','large',90,['SEMICONDUCTOR','IC_DESIGN','SMARTPHONE','SOX']),
  '2317':v10Candidate('鴻海','電子權值','EMS/電動車','ELECTRONIC_BLUE_CHIP','large',88,['AI_SERVER','EV','EARNINGS','TARIFF']),
  '2308':v10Candidate('台達電','電子權值','電源/電動車/重電','ELECTRONIC_BLUE_CHIP','large',92,['AI_SERVER','EV','GREEN_ENERGY','POWER_GRID','POLICY']),
  '2412':v10Candidate('中華電','電子權值','電信','ELECTRONIC_BLUE_CHIP','large',80,['DEFENSIVE','RATE','TELECOM']),

  '6669':v10Candidate('緯穎','AI Server','AI伺服器','AI_SERVER','large',76,['AI_SERVER','NVDA','CLOUD_CAPEX','EARNINGS']),
  '2382':v10Candidate('廣達','AI Server','AI伺服器 ODM','AI_SERVER','large',88,['AI_SERVER','NVDA','CLOUD_CAPEX','EARNINGS']),
  '3231':v10Candidate('緯創','AI Server','AI伺服器 ODM','AI_SERVER','large',86,['AI_SERVER','NVDA','CLOUD_CAPEX','EARNINGS']),
  '2356':v10Candidate('英業達','AI Server','AI伺服器 ODM','AI_SERVER','mid',72,['AI_SERVER','NVDA','CLOUD_CAPEX']),
  '2376':v10Candidate('技嘉','AI Server','主機板/伺服器','AI_SERVER','mid',70,['AI_SERVER','NVDA','PC','EARNINGS']),

  '2368':v10Candidate('金像電','PCB / CCL','PCB','PCB_CCL','mid',67,['AI_SERVER','PCB','CCL','SEMICONDUCTOR']),
  '3037':v10Candidate('欣興','PCB / CCL','ABF/PCB','PCB_CCL','mid',73,['AI_SERVER','PCB','CCL','SEMICONDUCTOR']),
  '3044':v10Candidate('健鼎','PCB / CCL','PCB','PCB_CCL','mid',64,['PCB','CCL','AUTO_EV','EARNINGS']),
  '5469':v10Candidate('瀚宇博','PCB / CCL','PCB','PCB_CCL','small',56,['PCB','CCL','PC']),
  '2383':v10Candidate('台光電','PCB / CCL','CCL','PCB_CCL','mid',70,['AI_SERVER','PCB','CCL','SEMICONDUCTOR']),
  '6274':v10Candidate('台燿','PCB / CCL','CCL','PCB_CCL','mid',67,['AI_SERVER','PCB','CCL','SEMICONDUCTOR']),
  '6213':v10Candidate('聯茂','PCB / CCL','CCL','PCB_CCL','small',58,['PCB','CCL','AI_SERVER']),

  '3017':v10Candidate('奇鋐','散熱','散熱模組','COOLING','mid',78,['AI_SERVER','COOLING','NVDA']),
  '3324':v10Candidate('雙鴻','散熱','散熱模組','COOLING','mid',70,['AI_SERVER','COOLING','NVDA']),
  '3653':v10Candidate('健策','散熱','散熱/均熱片','COOLING','mid',66,['AI_SERVER','COOLING','SEMICONDUCTOR']),

  '3081':v10Candidate('聯亞','高速傳輸 / 光通訊','光通訊','HIGH_SPEED_OPTICAL','small',56,['AI_SERVER','CPO','OPTICAL','DATA_CENTER']),
  '4979':v10Candidate('華星光','高速傳輸 / 光通訊','光通訊','HIGH_SPEED_OPTICAL','small',54,['AI_SERVER','CPO','OPTICAL','DATA_CENTER']),
  '4908':v10Candidate('前鼎','高速傳輸 / 光通訊','光通訊','HIGH_SPEED_OPTICAL','small',50,['AI_SERVER','CPO','OPTICAL']),
  '3363':v10Candidate('上詮','高速傳輸 / 光通訊','光通訊','HIGH_SPEED_OPTICAL','small',50,['AI_SERVER','CPO','OPTICAL']),
  '3450':v10Candidate('聯鈞','高速傳輸 / 光通訊','光通訊','HIGH_SPEED_OPTICAL','small',60,['AI_SERVER','CPO','OPTICAL']),

  '2408':v10Candidate('南亞科','記憶體','DRAM','MEMORY','mid',72,['MEMORY','SEMICONDUCTOR','EARNINGS']),
  '2344':v10Candidate('華邦電','記憶體','DRAM/NOR Flash','MEMORY','mid',68,['MEMORY','SEMICONDUCTOR','EARNINGS']),
  '8299':v10Candidate('群聯','記憶體','NAND控制晶片','MEMORY','mid',66,['MEMORY','SEMICONDUCTOR','AI_SERVER']),
  '3260':v10Candidate('威剛','記憶體','記憶體模組','MEMORY','small',56,['MEMORY','PC','SEMICONDUCTOR']),

  '3034':v10Candidate('聯詠','IC 設計','驅動IC','IC_DESIGN','mid',70,['IC_DESIGN','SEMICONDUCTOR','SMARTPHONE','EARNINGS']),
  '3529':v10Candidate('力旺','IC 設計','矽智財','IC_DESIGN','mid',62,['IC_DESIGN','SEMICONDUCTOR','AI_SERVER']),
  '3443':v10Candidate('創意','IC 設計','ASIC設計服務','IC_DESIGN','mid',72,['IC_DESIGN','SEMICONDUCTOR','AI_SERVER']),
  '3661':v10Candidate('世芯-KY','IC 設計','ASIC設計服務','IC_DESIGN','mid',72,['IC_DESIGN','SEMICONDUCTOR','AI_SERVER']),
  '5274':v10Candidate('信驊','IC 設計','伺服器管理晶片','IC_DESIGN','mid',63,['IC_DESIGN','AI_SERVER','SEMICONDUCTOR']),

  '3131':v10Candidate('弘塑','半導體設備 / 材料','濕製程設備','SEMI_EQUIPMENT_MATERIALS','small',55,['SEMICONDUCTOR','SEMI_EQUIPMENT','CAPEX','POLICY']),
  '3167':v10Candidate('大量','半導體設備 / 材料','設備/PCB設備','SEMI_EQUIPMENT_MATERIALS','small',50,['SEMICONDUCTOR','SEMI_EQUIPMENT','PCB']),
  '3583':v10Candidate('辛耘','半導體設備 / 材料','設備代理/再生晶圓','SEMI_EQUIPMENT_MATERIALS','small',54,['SEMICONDUCTOR','SEMI_EQUIPMENT','CAPEX']),
  '6187':v10Candidate('萬潤','半導體設備 / 材料','設備','SEMI_EQUIPMENT_MATERIALS','small',52,['SEMICONDUCTOR','SEMI_EQUIPMENT','ADVANCED_PACKAGING']),
  '4763':v10Candidate('材料-KY','半導體設備 / 材料','電子材料','SEMI_EQUIPMENT_MATERIALS','mid',60,['SEMICONDUCTOR','MATERIALS','FX']),
  '1560':v10Candidate('中砂','半導體設備 / 材料','耗材/鑽石碟','SEMI_EQUIPMENT_MATERIALS','mid',58,['SEMICONDUCTOR','MATERIALS','CAPEX']),

  '2881':v10Candidate('富邦金','金融','金控','FINANCIAL','large',86,['FINANCIAL','FX','RATE','DXY','US10Y','DEFENSIVE']),
  '2882':v10Candidate('國泰金','金融','金控','FINANCIAL','large',86,['FINANCIAL','FX','RATE','DXY','US10Y','DEFENSIVE']),
  '2886':v10Candidate('兆豐金','金融','金控/銀行','FINANCIAL','large',78,['FINANCIAL','FX','RATE','DEFENSIVE']),
  '2891':v10Candidate('中信金','金融','金控','FINANCIAL','large',82,['FINANCIAL','FX','RATE','DXY','US10Y','DEFENSIVE']),
  '5880':v10Candidate('合庫金','金融','金控/銀行','FINANCIAL','large',74,['FINANCIAL','RATE','DEFENSIVE']),
  '2884':v10Candidate('玉山金','金融','金控/銀行','FINANCIAL','large',76,['FINANCIAL','RATE','DEFENSIVE']),

  '2542':v10Candidate('興富發','營建 / 資產','營建','CONSTRUCTION_ASSET','mid',60,['CONSTRUCTION','RATE','POLICY','ASSET']),
  '2548':v10Candidate('華固','營建 / 資產','營建','CONSTRUCTION_ASSET','mid',58,['CONSTRUCTION','RATE','POLICY','ASSET']),
  '2539':v10Candidate('櫻花建','營建 / 資產','營建','CONSTRUCTION_ASSET','small',50,['CONSTRUCTION','RATE','POLICY','ASSET']),
  '2511':v10Candidate('太子','營建 / 資產','營建','CONSTRUCTION_ASSET','small',50,['CONSTRUCTION','RATE','POLICY','ASSET']),
  '2504':v10Candidate('國產','營建 / 資產','建材','CONSTRUCTION_ASSET','small',52,['CONSTRUCTION','CEMENT','POLICY']),
  '2207':v10Candidate('和泰車','營建 / 資產','汽車通路/資產','CONSTRUCTION_ASSET','large',70,['AUTO_EV','CONSUMER','FX','ASSET']),

  '2603':v10Candidate('長榮','航運','貨櫃航運','SHIPPING','large',79,['SHIPPING','OIL','GEOPOLITICS','TARIFF']),
  '2609':v10Candidate('陽明','航運','貨櫃航運','SHIPPING','mid',70,['SHIPPING','OIL','GEOPOLITICS','TARIFF']),
  '2615':v10Candidate('萬海','航運','貨櫃航運','SHIPPING','mid',68,['SHIPPING','OIL','GEOPOLITICS','TARIFF']),
  '2606':v10Candidate('裕民','航運','散裝航運','SHIPPING','small',55,['SHIPPING','OIL','COMMODITY','GEOPOLITICS']),
  '2617':v10Candidate('台航','航運','散裝航運','SHIPPING','small',50,['SHIPPING','OIL','COMMODITY']),

  '2618':v10Candidate('長榮航','航空 / 觀光','航空','AIRLINE_TOURISM','mid',72,['AIRLINE','TOURISM','OIL','FX','CONSUMER']),
  '2610':v10Candidate('華航','航空 / 觀光','航空','AIRLINE_TOURISM','mid',74,['AIRLINE','TOURISM','OIL','FX','CONSUMER']),
  '2727':v10Candidate('王品','航空 / 觀光','餐飲','AIRLINE_TOURISM','small',52,['TOURISM','CONSUMER','RETAIL']),
  '2731':v10Candidate('雄獅','航空 / 觀光','旅遊','AIRLINE_TOURISM','small',50,['TOURISM','CONSUMER','FX']),
  '2707':v10Candidate('晶華','航空 / 觀光','飯店','AIRLINE_TOURISM','small',50,['TOURISM','CONSUMER']),
  '2748':v10Candidate('雲品','航空 / 觀光','飯店','AIRLINE_TOURISM','small',50,['TOURISM','CONSUMER']),

  '2912':v10Candidate('統一超','百貨 / 零售 / 消費','超商','RETAIL_CONSUMER','large',72,['RETAIL','CONSUMER','DEFENSIVE','FX']),
  '5904':v10Candidate('寶雅','百貨 / 零售 / 消費','零售','RETAIL_CONSUMER','mid',58,['RETAIL','CONSUMER','DEFENSIVE']),
  '2903':v10Candidate('遠百','百貨 / 零售 / 消費','百貨','RETAIL_CONSUMER','small',50,['RETAIL','CONSUMER','ASSET']),
  '2915':v10Candidate('潤泰全','百貨 / 零售 / 消費','零售/資產','RETAIL_CONSUMER','mid',56,['RETAIL','CONSUMER','ASSET']),
  '1216':v10Candidate('統一','百貨 / 零售 / 消費','食品/通路','RETAIL_CONSUMER','large',76,['RETAIL','CONSUMER','FOOD','DEFENSIVE']),

  '2201':v10Candidate('裕隆','汽車 / 電動車','汽車','AUTO_EV','small',54,['AUTO_EV','CONSUMER','POLICY']),
  '2204':v10Candidate('中華','汽車 / 電動車','汽車','AUTO_EV','small',52,['AUTO_EV','CONSUMER','POLICY']),
  '1536':v10Candidate('和大','汽車 / 電動車','汽車零件','AUTO_EV','small',50,['AUTO_EV','EV','FX']),
  '3665':v10Candidate('貿聯-KY','汽車 / 電動車','線束/電動車','AUTO_EV','mid',60,['AUTO_EV','EV','AI_SERVER','FX']),

  '1513':v10Candidate('中興電','綠能 / 重電 / 電線電纜','重電','GREEN_POWER_GRID','mid',68,['GREEN_ENERGY','POWER_GRID','POLICY','INFRASTRUCTURE']),
  '1504':v10Candidate('東元','綠能 / 重電 / 電線電纜','馬達/重電','GREEN_POWER_GRID','mid',66,['GREEN_ENERGY','POWER_GRID','POLICY','AI_SERVER']),
  '1605':v10Candidate('華新','綠能 / 重電 / 電線電纜','電線電纜','GREEN_POWER_GRID','mid',64,['GREEN_ENERGY','POWER_GRID','COPPER','POLICY']),
  '1609':v10Candidate('大亞','綠能 / 重電 / 電線電纜','電線電纜','GREEN_POWER_GRID','small',54,['GREEN_ENERGY','POWER_GRID','COPPER','POLICY']),
  '1611':v10Candidate('中電','綠能 / 重電 / 電線電纜','電線電纜/照明','GREEN_POWER_GRID','small',50,['GREEN_ENERGY','POWER_GRID','POLICY']),
  '1519':v10Candidate('華城','綠能 / 重電 / 電線電纜','重電','GREEN_POWER_GRID','mid',70,['GREEN_ENERGY','POWER_GRID','POLICY','INFRASTRUCTURE']),
  '6443':v10Candidate('元晶','綠能 / 重電 / 電線電纜','太陽能','GREEN_POWER_GRID','small',50,['GREEN_ENERGY','SOLAR','POLICY']),

  '2002':v10Candidate('中鋼','鋼鐵','一貫鋼廠','STEEL','large',72,['STEEL','COMMODITY','CONSTRUCTION','TARIFF']),
  '2014':v10Candidate('中鴻','鋼鐵','鋼鐵','STEEL','small',52,['STEEL','COMMODITY','CONSTRUCTION','TARIFF']),
  '2027':v10Candidate('大成鋼','鋼鐵','不鏽鋼/鋁材','STEEL','mid',58,['STEEL','COMMODITY','TARIFF','FX']),
  '2031':v10Candidate('新光鋼','鋼鐵','鋼材通路','STEEL','small',50,['STEEL','COMMODITY','CONSTRUCTION']),

  '1301':v10Candidate('台塑','塑化','石化','PETROCHEMICAL','large',78,['PETROCHEMICAL','OIL','COMMODITY']),
  '1303':v10Candidate('南亞','塑化','塑化/電子材料','PETROCHEMICAL','large',75,['PETROCHEMICAL','OIL','SEMICONDUCTOR','MATERIALS']),
  '1326':v10Candidate('台化','塑化','石化/紡纖','PETROCHEMICAL','large',72,['PETROCHEMICAL','OIL','COMMODITY']),
  '6505':v10Candidate('台塑化','塑化','油品','PETROCHEMICAL','large',72,['PETROCHEMICAL','OIL']),

  '1101':v10Candidate('台泥','水泥','水泥','CEMENT','large',70,['CEMENT','CONSTRUCTION','POLICY','CARBON']),
  '1102':v10Candidate('亞泥','水泥','水泥','CEMENT','large',66,['CEMENT','CONSTRUCTION','POLICY']),

  '1227':v10Candidate('佳格','食品','食品','FOOD','small',52,['FOOD','CONSUMER','DEFENSIVE','COMMODITY']),
  '1231':v10Candidate('聯華食','食品','食品','FOOD','small',50,['FOOD','CONSUMER','DEFENSIVE']),
  '1210':v10Candidate('大成','食品','食品/飼料','FOOD','small',54,['FOOD','COMMODITY','CONSUMER']),

  '4743':v10Candidate('合一','生技醫療','新藥','BIOTECH_HEALTHCARE','small',50,['BIOTECH','HEALTHCARE','POLICY']),
  '1795':v10Candidate('美時','生技醫療','製藥','BIOTECH_HEALTHCARE','mid',60,['BIOTECH','HEALTHCARE','EARNINGS']),
  '6446':v10Candidate('藥華藥','生技醫療','新藥','BIOTECH_HEALTHCARE','mid',62,['BIOTECH','HEALTHCARE','EARNINGS']),
  '6547':v10Candidate('高端疫苗','生技醫療','疫苗','BIOTECH_HEALTHCARE','small',50,['BIOTECH','HEALTHCARE','POLICY']),
  '4105':v10Candidate('東洋','生技醫療','製藥','BIOTECH_HEALTHCARE','small',54,['BIOTECH','HEALTHCARE','DEFENSIVE']),
  '4123':v10Candidate('晟德','生技醫療','生技控股','BIOTECH_HEALTHCARE','small',50,['BIOTECH','HEALTHCARE']),

  '2634':v10Candidate('漢翔','軍工 / 無人機','航太/軍工','DEFENSE_DRONE','mid',62,['DEFENSE','DRONE','GEOPOLITICS','POLICY']),
  '8033':v10Candidate('雷虎','軍工 / 無人機','無人機','DEFENSE_DRONE','small',50,['DEFENSE','DRONE','GEOPOLITICS','POLICY']),
  '4571':v10Candidate('鈞興-KY','軍工 / 無人機','精密傳動','DEFENSE_DRONE','small',50,['DEFENSE','DRONE','INDUSTRIAL']),
  '8222':v10Candidate('寶一','軍工 / 無人機','航太零件','DEFENSE_DRONE','small',50,['DEFENSE','DRONE','GEOPOLITICS']),

  '3029':v10Candidate('零壹','資安 / 軟體','資安通路','CYBERSECURITY_SOFTWARE','small',54,['CYBER_SECURITY','SOFTWARE','POLICY']),
  '6214':v10Candidate('精誠','資安 / 軟體','系統整合','CYBERSECURITY_SOFTWARE','mid',58,['CYBER_SECURITY','SOFTWARE','AI_SERVER']),
  '2480':v10Candidate('敦陽科','資安 / 軟體','系統整合','CYBERSECURITY_SOFTWARE','small',52,['CYBER_SECURITY','SOFTWARE']),
  '6690':v10Candidate('安碁資訊','資安 / 軟體','資安服務','CYBERSECURITY_SOFTWARE','small',50,['CYBER_SECURITY','SOFTWARE','POLICY']),

  '3293':v10Candidate('鈊象','遊戲 / 文化內容','遊戲','GAMING_CONTENT','mid',62,['GAMING','CONTENT','CONSUMER']),
  '5478':v10Candidate('智冠','遊戲 / 文化內容','遊戲通路','GAMING_CONTENT','small',50,['GAMING','CONTENT','CONSUMER']),
  '6180':v10Candidate('橘子','遊戲 / 文化內容','遊戲','GAMING_CONTENT','small',50,['GAMING','CONTENT','CONSUMER']),
  '3083':v10Candidate('網龍','遊戲 / 文化內容','遊戲','GAMING_CONTENT','small',50,['GAMING','CONTENT','CONSUMER'])
};
function addV10TagsFromText(tags:Set<string>,text:string):void{const t=text.toUpperCase();const zh=text;const has=(patterns:(string|RegExp)[])=>patterns.some((p)=>typeof p==='string'?t.includes(p.toUpperCase()):p.test(zh));if(has(['AI_SERVER','AI SERVER','NVDA','NVIDIA','GB200','GB300','BLACKWELL','AI伺服器','資料中心','雲端資本支出']))tags.add('AI_SERVER');if(has(['SEMICONDUCTOR','SOX','TSM','TSMC','半導體','晶片','先進製程']))tags.add('SEMICONDUCTOR');if(has(['PCB','CCL','ABF','載板','銅箔基板']))tags.add('PCB_CCL');if(has(['COOLING','散熱','水冷','均熱片']))tags.add('COOLING');if(has(['CPO','OPTICAL','光通訊','高速傳輸','矽光子','800G','1.6T']))tags.add('HIGH_SPEED_OPTICAL');if(has(['MEMORY','DRAM','NAND','記憶體','HBM']))tags.add('MEMORY');if(has(['IC_DESIGN','ASIC','IC設計','矽智財','IP']))tags.add('IC_DESIGN');if(has(['SEMI_EQUIPMENT','CAPEX','設備','材料','先進封裝']))tags.add('SEMI_EQUIPMENT_MATERIALS');if(has(['FINANCIAL','金融','金控','銀行','壽險']))tags.add('FINANCIAL');if(has(['CONSTRUCTION','REAL ESTATE','營建','資產','房市','建材']))tags.add('CONSTRUCTION_ASSET');if(has(['SHIPPING','航運','貨櫃','散裝','運價','紅海']))tags.add('SHIPPING');if(has(['AIRLINE','TOURISM','航空','觀光','旅遊','飯店','餐飲']))tags.add('AIRLINE_TOURISM');if(has(['RETAIL','CONSUMER','百貨','零售','消費','內需','通路']))tags.add('RETAIL_CONSUMER');if(has(['AUTO','EV','汽車','電動車','車用']))tags.add('AUTO_EV');if(has(['GREEN','POWER_GRID','SOLAR','重電','綠能','電網','電線電纜','太陽能','儲能']))tags.add('GREEN_POWER_GRID');if(has(['STEEL','鋼鐵','鋼價']))tags.add('STEEL');if(has(['PETROCHEMICAL','石化','塑化','油價','原油']))tags.add('PETROCHEMICAL');if(has(['CEMENT','水泥']))tags.add('CEMENT');if(has(['FOOD','食品','飼料','民生']))tags.add('FOOD');if(has(['BIOTECH','HEALTHCARE','生技','醫療','製藥','新藥']))tags.add('BIOTECH_HEALTHCARE');if(has(['DEFENSE','DRONE','軍工','無人機','航太','地緣政治']))tags.add('DEFENSE_DRONE');if(has(['CYBER','SECURITY','SOFTWARE','資安','軟體','系統整合']))tags.add('CYBERSECURITY_SOFTWARE');if(has(['GAMING','CONTENT','遊戲','文化內容','IP']))tags.add('GAMING_CONTENT');if(has(['OIL','CRUDE','WTI','原油']))tags.add('OIL');if(has(['FX','DXY','USD','匯率','美元','台幣']))tags.add('FX');if(has(['RATE','US10Y','YIELD','殖利率','利率','FED']))tags.add('RATE');if(has(['TARIFF','關稅','貿易戰']))tags.add('TARIFF');if(has(['POLICY','政策','補助','法規']))tags.add('POLICY');if(has(['GEOPOLITICS','地緣','戰爭','衝突']))tags.add('GEOPOLITICS');if(has(['EARNINGS','財報','法說','指引','營收']))tags.add('EARNINGS');}
function v10PrimaryEventTags(marketContext:Record<string,unknown>,normalizedNews:Record<string,unknown>[]):string[]{const tags=new Set<string>();const primary=(marketContext.primary_event&&typeof marketContext.primary_event==='object'?marketContext.primary_event:{} ) as Record<string,unknown>;const sym=String(primary.symbol??'').toUpperCase();const event=String(primary.event_type??'').toUpperCase();if(event&&event!=='OTHER')tags.add(event);if(sym){if(['SOX','TSM','NVDA','2330'].includes(sym))tags.add('SEMICONDUCTOR');if(['NVDA','MSFT','META','AMZN'].includes(sym))tags.add('AI_SERVER');if(['VIX'].includes(sym))tags.add('RISK');if(['DXY'].includes(sym))tags.add('FX');if(['US10Y'].includes(sym))tags.add('RATE');if(['CRUDE OIL'].includes(sym))tags.add('OIL');if(['TAIEX','TXF','SPX','NASDAQ','DJIA'].includes(sym))tags.add('ELECTRONIC_BLUE_CHIP');tags.add(sym);}addV10TagsFromText(tags,JSON.stringify(primary));for(const n of normalizedNews.slice(0,6)){const et=String(n.event_type??'').toUpperCase();if(et&&et!=='OTHER')tags.add(et);addV10TagsFromText(tags,[n.topic,n.representative_summary,...(Array.isArray(n.related_sectors)?n.related_sectors:[]),...(Array.isArray(n.related_markets)?n.related_markets:[])].filter(Boolean).join(' '));}return Array.from(tags);}
function extractV10HistoricalSymbols(report:Record<string,unknown>):string[]{const json=(report.ai_strategy_json&&typeof report.ai_strategy_json==='object'?report.ai_strategy_json:{} ) as Record<string,unknown>;const buckets=[json.today_beneficiary_stocks,json.beneficiary_stocks,json.core_beneficiary_stocks];const out:string[]=[];for(const bucket of buckets){if(!Array.isArray(bucket))continue;for(const item of bucket){if(!item||typeof item!=='object')continue;const r=item as Record<string,unknown>;const symbol=String(r.ticker??r.symbol??'').trim();if(symbol)out.push(symbol);}}return Array.from(new Set(out));}
function calculateRepeatPenalty(symbol:string,recentReports:Record<string,unknown>[]):{historical_repeat_days:number;repeat_penalty:number}{let repeat=0;for(const report of recentReports.slice(0,14)){if(extractV10HistoricalSymbols(report).includes(symbol))repeat++;}const last3=recentReports.slice(0,3).filter((r)=>extractV10HistoricalSymbols(r).includes(symbol)).length;const penalty=Math.min(100,repeat*8+last3*12);return {historical_repeat_days:repeat,repeat_penalty:penalty};}
function buildV10EvidenceRefsForTags(tags:string[],evidenceIndex:V10EvidenceItem[]):V10EvidenceReference[]{const refs:V10EvidenceReference[]=[];for(const item of evidenceIndex){const text=[item.title,item.summary,item.evidence_type].join(' ').toUpperCase();if(tags.some((tag)=>text.includes(tag))){refs.push({evidence_id:item.evidence_id,weight:Math.min(100,Math.max(10,item.importance)),purpose:'primary_support'});}if(refs.length>=4)break;}return refs;}
function buildCandidateUniverse(args:{normalizedEvidence:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];recentReports:Record<string,unknown>[]}):{enabled:false;candidate_count:number;primary_event:string;candidates:V10CandidateCard[];validation:V10ContractValidationResult}{const normalizedNews=Array.isArray(args.normalizedEvidence.normalized_news)?args.normalizedEvidence.normalized_news as Record<string,unknown>[]:[];const marketContext=(args.normalizedEvidence.market_context&&typeof args.normalizedEvidence.market_context==='object'?args.normalizedEvidence.market_context:{} ) as Record<string,unknown>;const primary=(marketContext.primary_event&&typeof marketContext.primary_event==='object'?marketContext.primary_event:{} ) as Record<string,unknown>;const tags=v10PrimaryEventTags(marketContext,normalizedNews);const candidates:V10CandidateCard[]=[];for(const [symbol,meta] of Object.entries(V10_CANDIDATE_METADATA)){if(!meta.tags.some((tag)=>tags.includes(tag)))continue;const repeats=calculateRepeatPenalty(symbol,args.recentReports);const whitelistOk=TW_STOCK_WHITELIST.has(symbol);const liquidityOk=meta.liquidity_score>=50;const eligibility=whitelistOk&&liquidityOk;const excluded_reason=whitelistOk?(liquidityOk?'':'Low Liquidity'):'Not In Whitelist';candidates.push({symbol,name:meta.name,sector:meta.sector,industry:meta.industry,industry_code:meta.industry_code,market_cap_bucket:meta.market_cap_bucket,liquidity_score:meta.liquidity_score,trigger_tags:meta.tags.filter((tag)=>tags.includes(tag)),related_evidence:buildV10EvidenceRefsForTags(meta.tags,args.evidenceIndex),historical_repeat_days:repeats.historical_repeat_days,repeat_penalty:repeats.repeat_penalty,eligibility,excluded_reason});}const unique=Array.from(new Map(candidates.map((c)=>[c.symbol,c])).values());const universe={enabled:false,candidate_count:unique.length,primary_event:String(primary.event_type??primary.symbol??tags[0]??'UNKNOWN'),candidates:unique,validation:{is_valid:true,errors:[],warnings:[]}};universe.validation=validateCandidateUniverse(universe,args.evidenceIndex);return universe;}
function validateCandidateUniverse(universe:unknown,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const ids=new Set(evidenceIndex.map((item)=>item.evidence_id));const seen=new Set<string>();const u=(universe&&typeof universe==='object'?universe:{} ) as Record<string,unknown>;const candidates=Array.isArray(u.candidates)?u.candidates:[];if(!Array.isArray(u.candidates))errors.push('candidate_universe.candidates must be an array');for(let i=0;i<candidates.length;i++){const c=(candidates[i]&&typeof candidates[i]==='object'?candidates[i]:null) as Record<string,unknown>|null;if(!c){errors.push(`candidates[${i}] must be an object`);continue;}const symbol=String(c.symbol??'').trim();if(!symbol)errors.push(`candidates[${i}].symbol is required`);if(seen.has(symbol))errors.push(`candidates[${i}].symbol duplicates another candidate`);seen.add(symbol);const whitelistOk=TW_STOCK_WHITELIST.has(symbol);if(!whitelistOk&&c.eligibility!==false)errors.push(`candidates[${i}].symbol outside whitelist must be ineligible`);if(!Array.isArray(c.trigger_tags))errors.push(`candidates[${i}].trigger_tags must be an array`);validateV10Range(c.liquidity_score,`candidates[${i}].liquidity_score`,errors);validateV10Range(c.repeat_penalty,`candidates[${i}].repeat_penalty`,errors);if(typeof c.eligibility!=='boolean')errors.push(`candidates[${i}].eligibility must be boolean`);if(c.eligibility===false&&String(c.excluded_reason??'').trim().length===0)warnings.push(`candidates[${i}].excluded_reason should explain ineligibility`);validateV10EvidenceReferenceArray(c.related_evidence,`candidates[${i}].related_evidence`,ids,errors,warnings);}return {is_valid:errors.length===0,errors,warnings};}


type V10EvidenceDirection='positive'|'negative'|'neutral';
type V10BeneficiaryPhase1Record={symbol:string;name:string;industry_code:string;industry_name:string;rank:number;event_score:number;directional_event_score:number;sector_score:number;evidence_score:number;market_score:number;repeat_penalty:number;total_score:number;confidence_level:string;positive_evidence_count:number;negative_evidence_count:number;net_evidence_direction:V10EvidenceDirection;risk_flags:string[];benefit_chain:string[];scoring_reasons:string[];data_quality_status:string};
type V11ObservationRecord={symbol:string;name:string;industry_code:string;industry_name:string;rank:number;observation_score:number;event_relevance:number;confirmation_pending:number;market_attention:number;industry_representative:number;repeat_penalty:number;net_evidence_direction:V10EvidenceDirection;positive_evidence_count:number;negative_evidence_count:number;confidence_level:string;risk_flags:string[];observation_reason:string;confirmation_pending_reason:string;stop_observing_condition:string;observation_chain:string[];scoring_reasons:string[];data_quality_status:string};
type V10BeneficiaryPhase1Output={enabled:false;candidate_count:number;data_quality_status:'sufficient'|'partial'|'insufficient'|'insufficient_positive_evidence';warning:string|null;top_10_candidates:V10BeneficiaryPhase1Record[];today_beneficiary_stocks_v10:Record<string,unknown>[];observation_watchlist:Record<string,unknown>[];risk_watchlist:Record<string,unknown>[];validation:V10ContractValidationResult};
function v10ClampScore(value:number):number{return Math.max(0,Math.min(100,Math.round(value)));}
function v10AverageEvidenceWeight(refs:V10EvidenceReference[]):number{if(!Array.isArray(refs)||refs.length===0)return 0;return v10ClampScore(refs.reduce((sum,ref)=>sum+(Number.isFinite(Number(ref.weight))?Number(ref.weight):0),0)/refs.length);}
function v10EvidenceTypesForRefs(refs:V10EvidenceReference[],evidenceIndex:V10EvidenceItem[]):Set<string>{const byId=new Map(evidenceIndex.map((item)=>[item.evidence_id,item]));const out=new Set<string>();for(const ref of refs){const item=byId.get(ref.evidence_id);if(item?.evidence_type)out.add(item.evidence_type);}return out;}
function v10ConfidenceLevelFromSignals(eventScore:number,sectorScore:number,evidenceScore:number,marketScore:number,hasEvidence:boolean,netDirection:V10EvidenceDirection):string{if(!hasEvidence)return 'insufficient';if(netDirection==='negative')return 'low';const passed=[eventScore>=50,sectorScore>=55,evidenceScore>=40,marketScore>=50].filter(Boolean).length;if(passed>=3&&netDirection==='positive')return 'high';if(passed>=2)return 'medium';return 'low';}
function v10EvidenceItemById(evidenceIndex:V10EvidenceItem[]):Map<string,V10EvidenceItem>{return new Map(evidenceIndex.map((item)=>[item.evidence_id,item]));}
function v10ParseEvidenceMarketDirection(item:V10EvidenceItem):V10EvidenceDirection{const text=`${item.title} ${item.summary}`.toUpperCase();if(/\bDOWN\b|跌|下跌|重挫|承壓|利空/.test(text))return 'negative';if(/\bUP\b|漲|上漲|走強|利多/.test(text))return 'positive';const match=text.match(/(-?\d+(?:\.\d+)?)%/);if(match){const n=Number(match[1]);if(Number.isFinite(n)){if(n>0.25)return 'positive';if(n<-0.25)return 'negative';}}return 'neutral';}
function v10IndustryRelevantTags(industryCode:string):Set<string>{const map:Record<string,string[]>={FINANCIAL:['FX','RATE','DXY','US10Y','FINANCIAL'],ELECTRONIC_BLUE_CHIP:['2330','TSM','TSM_ADR','SOX','NVDA','NASDAQ','IXIC','SEMICONDUCTOR','ELECTRONIC_BLUE_CHIP','AI_SERVER'],AI_SERVER:['NVDA','AI_SERVER','SOX','MSFT','META','AMZN'],SHIPPING:['OIL','FREIGHT','SHIPPING','GEOPOLITICS','TARIFF'],PETROCHEMICAL:['OIL','PETROCHEMICAL','COMMODITY'],PCB_CCL:['PCB','CCL','AI_SERVER','SEMICONDUCTOR'],COOLING:['COOLING','AI_SERVER','NVDA'],IC_DESIGN:['IC_DESIGN','SEMICONDUCTOR','SOX'],MEMORY:['MEMORY','SEMICONDUCTOR'],SEMI_EQUIPMENT_MATERIALS:['SEMI_EQUIPMENT','SEMICONDUCTOR','CAPEX','MATERIALS'],AIRLINE_TOURISM:['AIRLINE','TOURISM','OIL','FX','CONSUMER'],AUTO_EV:['AUTO_EV','EV','CONSUMER','POLICY'],GREEN_POWER_GRID:['GREEN_ENERGY','POWER_GRID','POLICY','INFRASTRUCTURE'],STEEL:['STEEL','COMMODITY','CONSTRUCTION','TARIFF'],CONSTRUCTION_ASSET:['CONSTRUCTION','RATE','POLICY','ASSET'],RETAIL_CONSUMER:['RETAIL','CONSUMER','DEFENSIVE','FX'],FOOD:['FOOD','CONSUMER','DEFENSIVE'],BIOTECH_HEALTHCARE:['BIOTECH','HEALTHCARE','POLICY','EARNINGS'],DEFENSE_DRONE:['DEFENSE','DRONE','GEOPOLITICS','POLICY'],CYBERSECURITY_SOFTWARE:['CYBER_SECURITY','SOFTWARE','POLICY'],GAMING_CONTENT:['GAMING','CONTENT','CONSUMER'],CEMENT:['CEMENT','CONSTRUCTION','POLICY']};return new Set(map[industryCode]??[industryCode]);}
function v10EvidenceDirectionForCandidate(candidate:V10CandidateCard,item:V10EvidenceItem):V10EvidenceDirection{const base=v10ParseEvidenceMarketDirection(item);const title=item.title.toUpperCase();const industry=candidate.industry_code;const negativeForElectronics=['ELECTRONIC_BLUE_CHIP','AI_SERVER','PCB_CCL','COOLING','HIGH_SPEED_OPTICAL','MEMORY','IC_DESIGN','SEMI_EQUIPMENT_MATERIALS'];if(negativeForElectronics.includes(industry)&&['SOX','NVDA','TSM','NASDAQ','IXIC','2330'].some((key)=>title.includes(key)))return base;if(industry==='FINANCIAL'&&['DXY','US10Y'].some((key)=>title.includes(key))){if(base==='positive')return 'positive';if(base==='negative')return 'negative';return 'neutral';}if(industry==='SHIPPING'&&/(OIL|CRUDE|CL)/.test(title)){if(base==='negative')return 'positive';if(base==='positive')return 'negative';return 'neutral';}if(industry==='PETROCHEMICAL'&&/(OIL|CRUDE|CL)/.test(title))return base;if(item.evidence_type==='market_news'){const text=`${item.title} ${item.summary}`.toLowerCase();if(/risk|風險|tariff|關稅|war|跌|下修|miss|weak|利空/.test(text))return 'negative';if(/beat|strong|成長|上修|利多|policy|補助/.test(text))return 'positive';}return base==='negative'?'negative':base==='positive'?'positive':'neutral';}
function v10NetEvidenceDirection(directions:V10EvidenceDirection[]):V10EvidenceDirection{const positive=directions.filter((d)=>d==='positive').length;const negative=directions.filter((d)=>d==='negative').length;if(negative>positive)return 'negative';if(positive>negative)return 'positive';return 'neutral';}
function v10CandidateEventLabel(candidate:V10CandidateCard,refs:V10EvidenceReference[],evidenceIndex:V10EvidenceItem[]):string{const byId=v10EvidenceItemById(evidenceIndex);const allowed=v10IndustryRelevantTags(candidate.industry_code);const matched:V10EvidenceItem[]=[];for(const ref of refs){const item=byId.get(ref.evidence_id);if(!item)continue;const text=`${item.title} ${item.summary}`.toUpperCase();if(candidate.trigger_tags.some((tag)=>text.includes(tag))||Array.from(allowed).some((tag)=>text.includes(tag)))matched.push(item);}return matched[0]?.title||candidate.trigger_tags.find((tag)=>allowed.has(tag))||candidate.industry_code;}
function calculateV10BeneficiaryPhase1Record(candidate:V10CandidateCard,evidenceIndex:V10EvidenceItem[],primaryEvent:string):V10BeneficiaryPhase1Record{const refs=Array.isArray(candidate.related_evidence)?candidate.related_evidence:[];const byId=v10EvidenceItemById(evidenceIndex);const evidenceTypes=v10EvidenceTypesForRefs(refs,evidenceIndex);const directions=refs.map((ref)=>byId.get(ref.evidence_id)).filter(Boolean).map((item)=>v10EvidenceDirectionForCandidate(candidate,item as V10EvidenceItem));const positive_evidence_count=directions.filter((d)=>d==='positive').length;const negative_evidence_count=directions.filter((d)=>d==='negative').length;const net_evidence_direction=v10NetEvidenceDirection(directions);const rawEventScore=v10ClampScore(refs.length>0?v10AverageEvidenceWeight(refs):0);const directional_event_score=v10ClampScore(net_evidence_direction==='positive'?rawEventScore:net_evidence_direction==='negative'?rawEventScore*0.25:rawEventScore*0.6);const sector_score=v10ClampScore((candidate.trigger_tags.length>0?55:0)+(evidenceTypes.has('sector_rotation')?30:0)+(candidate.industry_code&&primaryEvent.includes(candidate.industry_code)?15:0));const evidence_score=v10ClampScore(Math.min(100,refs.length*22+evidenceTypes.size*10));const market_score=v10ClampScore(candidate.liquidity_score);const repeat_penalty=v10ClampScore(candidate.repeat_penalty);const directionPenalty=net_evidence_direction==='negative'?22:0;const total_score=v10ClampScore(directional_event_score*0.30+sector_score*0.25+evidence_score*0.20+market_score*0.15-repeat_penalty-directionPenalty);const confidence_level=v10ConfidenceLevelFromSignals(directional_event_score,sector_score,evidence_score,market_score,refs.length>0,net_evidence_direction);const eventLabel=v10CandidateEventLabel(candidate,refs,evidenceIndex);const benefit_chain=[eventLabel&&eventLabel!=='UNKNOWN'?`事件：${eventLabel}`:'事件：尚未明確',candidate.trigger_tags.length?`觸發標籤：${candidate.trigger_tags.filter((tag)=>v10IndustryRelevantTags(candidate.industry_code).has(tag)||refs.some((ref)=>String(byId.get(ref.evidence_id)?.title??'').toUpperCase().includes(tag))).join(', ')||candidate.trigger_tags.join(', ')}`:'觸發標籤：不足',`產業：${candidate.industry_code}`,`${candidate.symbol} ${candidate.name}`];const signalCount=[directional_event_score>=50,sector_score>=55,evidence_score>=40,market_score>=50].filter(Boolean).length;const risk_flags=[...(net_evidence_direction==='negative'?['negative_evidence_blocks_high_beneficiary','exclude_from_top3_strong_beneficiary']:[]),...(negative_evidence_count>0?[`negative_evidence_count=${negative_evidence_count}`]:[])];const scoring_reasons=[`event_score=${rawEventScore}`,`directional_event_score=${directional_event_score}`,`sector_score=${sector_score}`,`evidence_score=${evidence_score}`,`market_score=${market_score}`,`repeat_penalty=${repeat_penalty}`,`positive_evidence_count=${positive_evidence_count}`,`negative_evidence_count=${negative_evidence_count}`,`net_evidence_direction=${net_evidence_direction}`,`confidence_signals_passed=${signalCount}`,refs.length>0?`evidence_refs=${refs.map((ref)=>ref.evidence_id).join(',')}`:'evidence_refs=none',...(risk_flags.length?[`risk_flags=${risk_flags.join(',')}`]:[])];return {symbol:candidate.symbol,name:candidate.name,industry_code:candidate.industry_code,industry_name:candidate.sector,rank:0,event_score:rawEventScore,directional_event_score,sector_score,evidence_score,market_score,repeat_penalty,total_score,confidence_level,positive_evidence_count,negative_evidence_count,net_evidence_direction,risk_flags,benefit_chain,scoring_reasons,data_quality_status:refs.length>0?'sufficient':'insufficient'};}
function buildV10DiverseTopCandidates(records:V10BeneficiaryPhase1Record[],limit=5):V10BeneficiaryPhase1Record[]{const selected:V10BeneficiaryPhase1Record[]=[];const counts:Record<string,number>={};const firstIndustry=records[0]?.industry_code??'';const firstIndustryTop10Count=records.slice(0,10).filter((record)=>record.industry_code===firstIndustry&&record.data_quality_status==='sufficient').length;const concentratedIndustry=firstIndustry&&firstIndustryTop10Count>=4?firstIndustry:'';for(const record of records){if(selected.length>=limit)break;const current=counts[record.industry_code]??0;const maxForIndustry=record.industry_code===concentratedIndustry?3:2;if(current>=maxForIndustry)continue;const next={...record,scoring_reasons:[...record.scoring_reasons]};if(record.industry_code===concentratedIndustry&&maxForIndustry===3)next.scoring_reasons.push(`sector_diversity_guard=primary_industry_concentration_allow_3:${record.industry_code}`);else next.scoring_reasons.push('sector_diversity_guard=max_2_per_industry');selected.push(next);counts[record.industry_code]=current+1;}return selected;}
function v11ObservationIndustryTheme(industryCode:string):string{const map:Record<string,string>={FINANCIAL:'金融接棒',ELECTRONIC_BLUE_CHIP:'電子權值止跌',AI_SERVER:'AI 伺服器止跌',PETROCHEMICAL:'油價與塑化利差',SHIPPING:'油價與航運成本',CONSTRUCTION_ASSET:'資產與利率敏感',RETAIL_CONSUMER:'內需消費',GREEN_POWER_GRID:'政策與電網題材',PCB_CCL:'AI 供應鏈材料',COOLING:'AI 散熱鏈',HIGH_SPEED_OPTICAL:'高速傳輸需求',MEMORY:'記憶體報價',IC_DESIGN:'IC 設計族群',SEMI_EQUIPMENT_MATERIALS:'半導體設備材料',AUTO_EV:'車用與電動車',STEEL:'鋼價與關稅',CEMENT:'營建需求',FOOD:'民生防禦',BIOTECH_HEALTHCARE:'醫療題材',DEFENSE_DRONE:'軍工無人機',CYBERSECURITY_SOFTWARE:'資安軟體',GAMING_CONTENT:'遊戲內容'};return map[industryCode]??industryCode;}
function v11ConfirmationReason(candidate:V10CandidateCard,netDirection:V10EvidenceDirection,positive:number,negative:number):string{const theme=v11ObservationIndustryTheme(candidate.industry_code);if(netDirection==='positive'&&positive<=negative+1)return `${theme}已有初步訊號，但還需要 09:30 / 10:30 盤中資金確認。`;if(netDirection==='neutral')return `${theme}與今日主線有關，但尚缺 09:30、10:30 或 13:00 的資金確認。`;return `${theme}目前訊號偏弱，不列入觀察名單。`;}
function v11ObservationReason(candidate:V10CandidateCard,netDirection:V10EvidenceDirection,positive:number,negative:number):string{const theme=v11ObservationIndustryTheme(candidate.industry_code);if(candidate.industry_code==='FINANCIAL')return '金融可能接棒防守資金，但尚未看到盤中明確突破。';if(candidate.industry_code==='PETROCHEMICAL')return '油價變動可能影響塑化利差，等待市場資金確認。';if(candidate.industry_code==='ELECTRONIC_BLUE_CHIP'||candidate.industry_code==='AI_SERVER')return netDirection==='positive'?'AI/電子已有初步修復訊號，仍需盤中確認是否止跌。':'AI/電子偏弱後只適合追蹤止跌，不視為強受惠。';if(candidate.industry_code==='SHIPPING')return '航運受油價與運價預期牽動，等待族群量價同步。';return `${theme}與今日事件有連結，但尚未形成強受惠證據。`;}
function v11StopObservingCondition(candidate:V10CandidateCard):string{if(candidate.industry_code==='FINANCIAL')return '金融跌破昨日低點或無法相對大盤抗跌。';if(candidate.industry_code==='PETROCHEMICAL')return '油價訊號反轉，或塑化族群 09:30 後沒有資金流入。';if(candidate.industry_code==='ELECTRONIC_BLUE_CHIP'||candidate.industry_code==='AI_SERVER')return '09:30 後 2330 / AI 供應鏈沒有止跌或成交量不足。';if(candidate.industry_code==='SHIPPING')return '航運族群沒有量價同步，或油價/運價訊號不再支持。';return '盤中沒有資金流入，或同族群代表股無法維持相對強勢。';}
function v11ObservationChain(candidate:V10CandidateCard,refs:V10EvidenceReference[],evidenceIndex:V10EvidenceItem[]):string[]{const event=v10CandidateEventLabel(candidate,refs,evidenceIndex);return [event&&event!=='UNKNOWN'?`今天：${event}`:'今天：事件尚待確認',v11ObservationIndustryTheme(candidate.industry_code),`${candidate.symbol} ${candidate.name}`];}
function calculateV11ObservationRecord(candidate:V10CandidateCard,beneficiaryRecord:V10BeneficiaryPhase1Record,evidenceIndex:V10EvidenceItem[]):V11ObservationRecord{const refs=Array.isArray(candidate.related_evidence)?candidate.related_evidence:[];const event_relevance=v10ClampScore(refs.length>0?v10AverageEvidenceWeight(refs):0);const confirmation_pending=v10ClampScore(beneficiaryRecord.net_evidence_direction==='neutral'?82:beneficiaryRecord.net_evidence_direction==='positive'?62:0);const market_attention=v10ClampScore(candidate.liquidity_score*0.7+Math.min(30,refs.length*8));const industry_representative=v10ClampScore(candidate.liquidity_score>=85?92:candidate.liquidity_score>=70?78:candidate.liquidity_score>=55?62:45);const repeat_penalty=v10ClampScore(candidate.repeat_penalty);const observation_score=v10ClampScore(event_relevance*0.40+confirmation_pending*0.25+market_attention*0.15+industry_representative*0.10-repeat_penalty*0.10);const scoring_reasons=[`observation_score=${observation_score}`,`event_relevance=${event_relevance}`,`confirmation_pending=${confirmation_pending}`,`market_attention=${market_attention}`,`industry_representative=${industry_representative}`,`repeat_penalty=${repeat_penalty}`,`positive_evidence_count=${beneficiaryRecord.positive_evidence_count}`,`negative_evidence_count=${beneficiaryRecord.negative_evidence_count}`,`net_evidence_direction=${beneficiaryRecord.net_evidence_direction}`,refs.length>0?`evidence_refs=${refs.map((ref)=>ref.evidence_id).join(',')}`:'evidence_refs=none'];return {symbol:candidate.symbol,name:candidate.name,industry_code:candidate.industry_code,industry_name:candidate.sector,rank:0,observation_score,event_relevance,confirmation_pending,market_attention,industry_representative,repeat_penalty,net_evidence_direction:beneficiaryRecord.net_evidence_direction,positive_evidence_count:beneficiaryRecord.positive_evidence_count,negative_evidence_count:beneficiaryRecord.negative_evidence_count,confidence_level:beneficiaryRecord.confidence_level,risk_flags:beneficiaryRecord.risk_flags,observation_reason:v11ObservationReason(candidate,beneficiaryRecord.net_evidence_direction,beneficiaryRecord.positive_evidence_count,beneficiaryRecord.negative_evidence_count),confirmation_pending_reason:v11ConfirmationReason(candidate,beneficiaryRecord.net_evidence_direction,beneficiaryRecord.positive_evidence_count,beneficiaryRecord.negative_evidence_count),stop_observing_condition:v11StopObservingCondition(candidate),observation_chain:v11ObservationChain(candidate,refs,evidenceIndex),scoring_reasons,data_quality_status:refs.length>0?'sufficient':'insufficient'};}
function buildV11ObservationWatchlist(candidates:V10CandidateCard[],beneficiaryScored:V10BeneficiaryPhase1Record[],riskRecords:V10BeneficiaryPhase1Record[],strongRecords:V10BeneficiaryPhase1Record[],evidenceIndex:V10EvidenceItem[],limit=10):V11ObservationRecord[]{const bySymbol=new Map(candidates.map((candidate)=>[candidate.symbol,candidate]));const riskSymbols=new Set(riskRecords.map((record)=>record.symbol));const strongSymbols=new Set(strongRecords.map((record)=>record.symbol));const observationCandidates=beneficiaryScored.filter((record)=>record.data_quality_status==='sufficient'&&!riskSymbols.has(record.symbol)&&!strongSymbols.has(record.symbol)&&record.net_evidence_direction!=='negative').map((record)=>{const candidate=bySymbol.get(record.symbol);return candidate?calculateV11ObservationRecord(candidate,record,evidenceIndex):null;}).filter(Boolean) as V11ObservationRecord[];const ranked=observationCandidates.sort((a,b)=>b.observation_score-a.observation_score||b.event_relevance-a.event_relevance||a.repeat_penalty-b.repeat_penalty);const selected:V11ObservationRecord[]=[];const industryCounts:Record<string,number>={};for(const record of ranked){if(selected.length>=limit)break;const count=industryCounts[record.industry_code]??0;if(count>=2)continue;selected.push({...record,rank:selected.length+1,scoring_reasons:[...record.scoring_reasons,'observation_diversity_guard=max_2_per_industry']});industryCounts[record.industry_code]=count+1;}return selected;}
function outputV11ObservationRecord(record:V11ObservationRecord):Record<string,unknown>{return {symbol:record.symbol,name:record.name,industry_code:record.industry_code,industry_name:record.industry_name,rank:record.rank,total_score:record.observation_score,observation_score:record.observation_score,event_relevance:record.event_relevance,confirmation_pending:record.confirmation_pending,market_attention:record.market_attention,industry_representative:record.industry_representative,repeat_penalty:record.repeat_penalty,confidence_level:record.confidence_level,net_evidence_direction:record.net_evidence_direction,positive_evidence_count:record.positive_evidence_count,negative_evidence_count:record.negative_evidence_count,risk_flags:record.risk_flags,observation_reason:record.observation_reason,confirmation_pending_reason:record.confirmation_pending_reason,stop_observing_condition:record.stop_observing_condition,observation_chain:record.observation_chain,benefit_chain:record.observation_chain,scoring_reasons:[`今天為什麼觀察？${record.observation_reason}`,`還缺什麼？${record.confirmation_pending_reason}`,`不用再觀察的條件：${record.stop_observing_condition}`],data_quality_status:record.data_quality_status};}

type V11ObservationRole='MAIN_THESIS'|'CONFIRMATION'|'RISK'|'CAPITAL_NEXT'|'EXTERNAL';
type V11ObservationNarrativeRoleRecord={role:V11ObservationRole;role_title:string;role_question:string;decision_step:number;next_role:V11ObservationRole|null;narrative:string;representative_symbols:string[];representative_names:string[];validation_point:string;stop_condition:string;confirmation_checklist:string[];risk_checklist:string[];capital_rotation_path:string[];external_priority:{title:string;importance:number}[];decision_confidence:number;industry_code?:string;industry_name?:string;observation_reason:string;confirmation_reason:string;confirmation_pending_reason:string;stop_observing_condition:string;observation_chain:string[];benefit_chain:string[];scoring_reasons:string[];data_quality_status:string;symbol:string;name:string;rank:number;total_score:number|null;confidence_level:string;net_evidence_direction:string;positive_evidence_count:number;negative_evidence_count:number;risk_flags:string[]};
function v11RoleText(value:unknown,fallback=''):string{const text=String(value??'').trim();return text||fallback;}
function v11RoleList(value:unknown):string[]{if(Array.isArray(value))return value.map((item)=>v11RoleText(item)).filter(Boolean);if(typeof value==='string'&&value.trim())return [value.trim()];return [];}
function v11RoleSymbols(record:Record<string,unknown>|undefined):string[]{if(!record)return [];const explicit=v11RoleList(record.representative_symbols);if(explicit.length>0)return explicit;const symbol=v11RoleText(record.symbol||record.stock_id||record.stock_code);return symbol?[symbol]:[];}
function v11RoleNames(record:Record<string,unknown>|undefined):string[]{if(!record)return [];const explicit=v11RoleList(record.representative_names);if(explicit.length>0)return explicit;const name=v11RoleText(record.name||record.stock_name||record.company_name);return name?[name]:[];}
function v11RoleIndustry(record:Record<string,unknown>|undefined):{code:string;name:string}{return {code:v11RoleText(record?.industry_code),name:v11RoleText(record?.industry_name||record?.industry||record?.sector||record?.industry_code,'主線族群')};}
function v11RoleScore(record:Record<string,unknown>|undefined):number|null{const n=Number(record?.total_score??record?.observation_score);return Number.isFinite(n)?n:null;}
function v11RoleDirection(record:Record<string,unknown>|undefined):string{return v11RoleText(record?.net_evidence_direction,'neutral');}
function v11RoleEvidenceTitle(evidenceIndex:V10EvidenceItem[],matcher?:(item:V10EvidenceItem)=>boolean):string{const item=evidenceIndex.find((entry)=>matcher?matcher(entry):true);return item?.title||item?.summary||'外部市場變數';}
function v11RolePickDifferent(records:Record<string,unknown>[],baseIndustry:string):Record<string,unknown>|undefined{return records.find((record)=>v11RoleText(record.industry_code)!==baseIndustry)||records[1]||records[0];}
function v11RoleNext(role:V11ObservationRole):V11ObservationRole|null{const next:Record<V11ObservationRole,V11ObservationRole|null>={MAIN_THESIS:'CONFIRMATION',CONFIRMATION:'RISK',RISK:'CAPITAL_NEXT',CAPITAL_NEXT:'EXTERNAL',EXTERNAL:null};return next[role];}
function v11RoleDecisionConfidence(source:Record<string,unknown>|undefined,evidenceIndex:V10EvidenceItem[],role:V11ObservationRole):number{const data=String(source?.data_quality_status??'');const direction=String(source?.net_evidence_direction??'neutral');const positive=Number(source?.positive_evidence_count??0)||0;const negative=Number(source?.negative_evidence_count??0)||0;const score=Number(source?.total_score??source?.observation_score??50);const dataScore=data==='sufficient'?26:data==='partial'?18:10;const marketScore=direction==='positive'?24:direction==='neutral'?16:direction==='negative'?10:14;const evidenceScore=Math.min(24,Math.max(8,evidenceIndex.length*3+positive*5-negative*4));const roleScore=role==='CONFIRMATION'||role==='RISK'?16:role==='MAIN_THESIS'?18:14;return v10ClampScore(dataScore+marketScore+evidenceScore+roleScore+(Number.isFinite(score)?score*0.12:0));}
function v11RoleExternalPriority(evidenceIndex:V10EvidenceItem[]):{title:string;importance:number}[]{return evidenceIndex.slice(0,8).map((item)=>({title:item.title||item.summary||item.evidence_id,importance:Math.max(1,Math.min(5,Math.round((Number(item.importance??50)||50)/20)))})).filter((item)=>item.title).slice(0,3);}
function v11RoleBaseRecord(role:V11ObservationRole,rank:number,source:Record<string,unknown>|undefined,overrides:Partial<V11ObservationNarrativeRoleRecord>):V11ObservationNarrativeRoleRecord{const industry=v11RoleIndustry(source);const symbols=v11RoleSymbols(source);const names=v11RoleNames(source);const titleMap:Record<V11ObservationRole,string>={MAIN_THESIS:'今日主線',CONFIRMATION:'確認條件',RISK:'最大風險',CAPITAL_NEXT:'資金下一站',EXTERNAL:'外部變數'};const questionMap:Record<V11ObservationRole,string>={MAIN_THESIS:'今天市場真正交易的是什麼？',CONFIRMATION:'什麼條件代表今天劇本成立？',RISK:'什麼情況代表今天看錯？',CAPITAL_NEXT:'如果劇本成立，資金可能去哪？',EXTERNAL:'今天哪個全球因素最值得盯？'};const narrative=overrides.narrative||v11RoleText(source?.observation_reason,'資料仍不足，今天只保留觀察條件，不硬判方向。');const validation=overrides.validation_point||v11RoleText(source?.confirmation_pending_reason,'等待 09:30 / 10:30 盤中資金確認。');const stop=overrides.stop_condition||v11RoleText(source?.stop_observing_condition,'若代表股不同步或量能不足，今天停止追蹤。');const chain=v11RoleList(source?.observation_chain||source?.benefit_chain);return {role,role_title:overrides.role_title||titleMap[role],role_question:overrides.role_question||questionMap[role],decision_step:rank,next_role:v11RoleNext(role),narrative,representative_symbols:overrides.representative_symbols||symbols,representative_names:overrides.representative_names||names,validation_point:validation,stop_condition:stop,confirmation_checklist:overrides.confirmation_checklist||[],risk_checklist:overrides.risk_checklist||[],capital_rotation_path:overrides.capital_rotation_path||[],external_priority:overrides.external_priority||[],decision_confidence:overrides.decision_confidence??v11RoleDecisionConfidence(source,[],role),industry_code:overrides.industry_code||industry.code,industry_name:overrides.industry_name||industry.name,observation_reason:narrative,confirmation_reason:validation,confirmation_pending_reason:validation,stop_observing_condition:stop,observation_chain:overrides.observation_chain||chain,benefit_chain:overrides.benefit_chain||chain,scoring_reasons:[`role=${role}`,`decision_step=${rank}`,`next_role=${v11RoleNext(role)??'END'}`,`role_title=${overrides.role_title||titleMap[role]}`,`role_question=${overrides.role_question||questionMap[role]}`],data_quality_status:v11RoleText(source?.data_quality_status,'sufficient'),symbol:symbols[0]||'',name:names[0]||'',rank,total_score:v11RoleScore(source),confidence_level:v11RoleText(source?.confidence_level,'low'),net_evidence_direction:v11RoleDirection(source),positive_evidence_count:Number(source?.positive_evidence_count??0)||0,negative_evidence_count:Number(source?.negative_evidence_count??0)||0,risk_flags:v11RoleList(source?.risk_flags),...overrides};}
function validateV11ObservationNarrativeRoles(records:Record<string,unknown>[]):{is_valid:boolean;errors:string[];warnings:string[]}{const errors:string[]=[],warnings:string[]=[];const roles=new Set<string>();const titles=new Set<string>();const questions=new Set<string>();const narratives=new Set<string>();for(let i=0;i<records.length;i++){const r=records[i];const role=v11RoleText(r.role);const title=v11RoleText(r.role_title);const question=v11RoleText(r.role_question);const narrative=v11RoleText(r.narrative);if(!role)errors.push(`roles[${i}].role is required`);if(roles.has(role))errors.push(`roles[${i}].role duplicates ${role}`);roles.add(role);if(!title)errors.push(`roles[${i}].role_title is required`);if(titles.has(title))errors.push(`roles[${i}].role_title duplicates ${title}`);titles.add(title);if(!question)errors.push(`roles[${i}].role_question is required`);if(questions.has(question))errors.push(`roles[${i}].role_question duplicates ${question}`);questions.add(question);if(!narrative)errors.push(`roles[${i}].narrative is required`);if(narratives.has(narrative))errors.push(`roles[${i}].narrative duplicates another role`);narratives.add(narrative);if(!v11RoleText(r.validation_point))errors.push(`roles[${i}].validation_point is required`);if(!v11RoleText(r.stop_condition))errors.push(`roles[${i}].stop_condition is required`);const step=Number(r.decision_step);if(!Number.isInteger(step)||step<1||step>5)errors.push(`roles[${i}].decision_step must be 1-5`);const conf=Number(r.decision_confidence);if(!Number.isFinite(conf)||conf<0||conf>100)errors.push(`roles[${i}].decision_confidence must be 0-100`);}const required:V11ObservationRole[]=['MAIN_THESIS','CONFIRMATION','RISK','CAPITAL_NEXT','EXTERNAL'];for(const role of required){if(!roles.has(role))errors.push(`missing role ${role}`);}if(records.length!==5)errors.push(`expected 5 roles, got ${records.length}`);const symbolKeys=records.map((r)=>v11RoleList(r.representative_symbols).join(',')).filter(Boolean);if(symbolKeys.length>1&&new Set(symbolKeys).size===1)warnings.push('representative_symbols are identical across all roles');return {is_valid:errors.length===0,errors,warnings};}
function buildV11ObservationNarrativeRoles(input:{legacyObservation:Record<string,unknown>[];riskWatchlist:Record<string,unknown>[];strongWatchlist:Record<string,unknown>[];topCandidates:V10BeneficiaryPhase1Record[];candidateUniverse:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];dataQualityStatus:string;warning:string|null;log?:(msg:string)=>void}):Record<string,unknown>[]|null{try{const legacy=Array.isArray(input.legacyObservation)?input.legacyObservation:[];const risks=Array.isArray(input.riskWatchlist)?input.riskWatchlist:[];const strong=Array.isArray(input.strongWatchlist)?input.strongWatchlist:[];const top=(Array.isArray(input.topCandidates)?input.topCandidates:[]).map((r)=>({...r,total_score:r.total_score})) as unknown as Record<string,unknown>[];const main=strong[0]||legacy[0]||top[0];const mainIndustry=v11RoleIndustry(ma…33356 tokens truncated…_chain)?note.overnight_chain as Record<string,unknown>[]:[];
  const candidateRows=Array.isArray(note.beneficiary_candidates)?note.beneficiary_candidates as Record<string,unknown>[]:[];
  const impactMaps=Array.isArray(note.taiwan_impact_map)?note.taiwan_impact_map as Record<string,unknown>[]:[];
  const intradayRows=Array.isArray(note.intraday_validation)?note.intraday_validation as Record<string,unknown>[]:[];
  const sourceSignals=buildV8SourceSignals(marketData,sectorData,[]);
  const fallbackBySymbol=new Map<string,Record<string,unknown>>();
  for(const s of fallbackStocks){const sym=String(s.symbol||s.stock_id||s.stock_code||'').trim();if(sym)fallbackBySymbol.set(sym,s);}
  const candidateSectors=candidateRows.map(function(c){return String(c.sector||c.group||'').trim();}).filter(Boolean);
  const affectedSectors=Array.from(new Set([...impactMaps.map(function(m){return String(m.sector||'').trim();}),...candidateSectors,...sectorData.slice(0,3).map(function(s){return s.sector;})].filter(Boolean))).slice(0,6);
  const representativeStocks=candidateRows.map(function(c){const symbol=String(c.stock_code||c.symbol||c.stock_id||'').trim();const name=String(c.stock_name||c.name||STOCK_NAMES[symbol]||'').trim();return symbol&&name?symbol+' '+name:'';}).filter(Boolean).slice(0,5);
  const watchPoints=intradayRows.map(function(r){return String(r.what_to_watch||r.bullish_confirm||r.neutral_condition||'').trim();}).filter(Boolean).slice(0,4);
  if(watchPoints.length===0)watchPoints.push('開盤族群是否同步','代表個股是否放量','台指期與現貨是否同向');

  const chains=overnightRows.map(function(row,idx){const event=String(row.event||row.title||'').trim();if(!event)return null;const impactLogic=String(row.impact_logic||row.logic||'').trim();const mapping=String(row.taiwan_mapping||'').trim();const sourceMarket=String(row.source_market||'海外市場').trim();const sectors=affectedSectors.length>0?affectedSectors:['相關台股族群'];const stocks=representativeStocks.length>0?representativeStocks:['代表個股待盤中驗證'];const steps=[event,impactLogic||sourceMarket+'訊號先影響資金與估值偏好',mapping||'映射到 '+sectors.slice(0,2).join('、'),sectors.slice(0,2).join('、')+' 供應鏈接受盤中驗證',stocks.slice(0,3).join('、')+' 作為代表個股觀察'];return{theme:sectors[0]||('前夜鏈 '+(idx+1)),event,causal_steps:steps.filter(Boolean).slice(0,5),taiwan_impact:inferTaiwanImpact(mapping+' '+impactLogic),affected_sectors:sectors,watch_points:watchPoints,invalidation_condition:'若對應族群開盤不同步、代表個股未放量，或台指期與現貨方向背離，此前夜傳導鏈降級。'};}).filter(Boolean) as Record<string,unknown>[];

  const beneficiaries:Record<string,unknown>[]=[];const seen=new Set<string>();
  for(const row of candidateRows){
    const symbol=String(row.stock_code||row.symbol||row.stock_id||'').trim();const fallback=fallbackBySymbol.get(symbol)||{};const name=String(row.stock_name||row.name||fallback.name||STOCK_NAMES[symbol]||'').trim();
    if(!isValidTaiwanStock(symbol,name)||seen.has(symbol))continue;
    const sector=String(row.sector||fallback.sector||fallback.group||catalystTypeForStock(symbol)).trim();
    const reason=String(row.reason||fallback.reason||'').trim();const risk=String(row.risk||row.risk_note||fallback.risk_note||fallback.risk||'').trim();
    const evidence=Array.isArray(row.evidence)?row.evidence.map(String).filter(Boolean):[];
    const confidence=safeInteger(row.confidence??row.confidence_score??fallback.confidence_score??confidenceNumberFromStock(fallback),55);
    const chain=[evidence[0]||'既有會員研究筆記列為受惠候選',reason||'依既有受惠股候選推導公司受惠邏輯',sector+' 供應鏈需要盤中同步驗證',name+' 作為主受惠股觀察'].filter(Boolean).slice(0,5);
    beneficiaries.push({symbol,name,sector,reason_chain:chain,confidence_score:confidence,risk_level:v8RiskLevelFromConfidence(confidence),invalidation_condition:risk||('若 '+sector+' 族群開盤不同步或 '+name+' 未放量，受惠推論降級。')});
    seen.add(symbol);if(beneficiaries.length>=10)break;
  }

  const overnight={status:chains.length>0?'ready':'insufficient',chains};
  const beneficiary={status:beneficiaries.length>0?'ready':'insufficient',source_signals:sourceSignals,beneficiaries};
  const firstChain=chains[0];const firstBeneficiary=beneficiaries[0];
  const daily=chains.length>0||beneficiaries.length>0?{status:'ready',sentence:'今天要驗證的是 '+String(firstChain?.theme||firstBeneficiary?.sector||'盤前主線')+' 能否從前夜事件傳導到台股代表個股。',logic_source:['member_research_note_v2.overnight_chain','member_research_note_v2.beneficiary_candidates'],tone:'clear, sharp, human-readable'}:{status:'insufficient',sentence:'',logic_source:[],tone:'clear, sharp, human-readable'};
  return{v8_beneficiary_chain:beneficiary,v8_overnight_causal_chain:overnight,v8_daily_sentence:daily};
}
function findMarketIndicator(md:MarketIndicator[],syms:string[]):MarketIndicator|null{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null;}
function fmtV8Pct(v:number):string{return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%';}
function buildV8SourceSignals(md:MarketIndicator[],sectorData:SectorRotationRow[],newsData:MarketNewsItem[]):Record<string,unknown>[]{
  const signals:Record<string,unknown>[]=[];
  for(const syms of [['NVDA'],['SOX','PHLX'],['TSM','TSMC'],['SPX','SP500','GSPC'],['VIX','VIXINDEX'],['DXY','USDINDEX'],['US10Y','TNX'],['WTI','OIL','CL']]){
    const m=findMarketIndicator(md,syms);if(m&&!Number.isNaN(m.changePercent))signals.push({source:'market_data.'+m.symbol+'.change_percent',symbol:m.symbol,name:m.name,change_percent:m.changePercent});
  }
  for(const s of sectorData.slice(0,5))signals.push({source:'sector_rotation_scores.'+s.sector,sector:s.sector,rotation_score:s.rotation_score,signal_label:s.signal_label});
  for(const n of newsData.slice(0,3))signals.push({source:'market_news',title:n.title,sectors:n.related_sectors||[]});
  return signals;
}
function v8RiskLevel(evidenceCount:number,dScore:MarketDataScore):'low'|'medium'|'high'{if(dScore.riskReasons.length>0&&dScore.riskReasons[0]!=='暫無明顯風險訊號')return evidenceCount>=3?'medium':'high';if(evidenceCount>=4)return'low';if(evidenceCount>=2)return'medium';return'high';}
function v8ReasonChain(stock:Record<string,unknown>,evidence:string[],sectorData:SectorRotationRow[],md:MarketIndicator[]):string[]{
  const symbol=String(stock.symbol||stock.stock_id||stock.stock_code||'');const sector=String(stock.sector||stock.group||'');const chain:string[]=[];
  const nv=findMarketIndicator(md,['NVDA']);const sox=findMarketIndicator(md,['SOX','PHLX']);const tsm=findMarketIndicator(md,['TSM','TSMC']);
  if(nv&&!Number.isNaN(nv.changePercent))chain.push('NVDA '+fmtV8Pct(nv.changePercent)+'，反映 AI 供應鏈風險偏好變化');
  if(sox&&!Number.isNaN(sox.changePercent))chain.push('費半 '+fmtV8Pct(sox.changePercent)+'，影響台股半導體開盤情緒');
  if(tsm&&!Number.isNaN(tsm.changePercent)&&symbol==='2330')chain.push('TSM ADR '+fmtV8Pct(tsm.changePercent)+'，提供 2330 開盤參考');
  const sec=sectorData.find(function(s){return s.leading_symbols.includes(symbol)||s.sector===sector||s.sub_sector===sector});
  if(sec)chain.push(sec.sector+'輪動分數 '+sec.rotation_score+'（'+sec.signal_label+'），支撐族群映射');
  const reason=String(stock.reason||stock.member_thesis||'').trim();if(reason)chain.push(reason);
  for(const ev of evidence){if(chain.length>=5)break;if(!chain.includes(ev))chain.push(ev);}
  return chain.filter(Boolean).slice(0,5);
}
function buildV8Invalidation(symbol:string,sector:string):string{
  if(symbol==='2330')return'若費半轉弱、TSM ADR 明顯回落，且 2330 開盤無法站穩平盤，受惠推論失效';
  if(sector.includes('AI'))return'若 NVDA 盤後轉弱，且 AI 伺服器族群開盤不同步放量，受惠推論失效';
  if(sector.includes('半導體'))return'若 SOX 轉弱且半導體權值股開盤不同步，受惠推論失效';
  if(sector.includes('金融'))return'若 VIX 回落但金融股未見防禦買盤，且外資轉賣超金融權值，受惠推論失效';
  if(sector.includes('航運')||sector.includes('塑化'))return'若油價或運價相關訊號反向，且族群開盤無量能跟進，受惠推論失效';
  return'若對應族群領先股開盤不同步，且台指期與現貨方向背離，受惠推論失效';
}
function buildV8BeneficiaryChain(md:MarketIndicator[],newsData:MarketNewsItem[],sectorData:SectorRotationRow[],dScore:MarketDataScore,stocks:Record<string,unknown>[],causalChains:Record<string,unknown>[]):Record<string,unknown>{
  const sourceSignals=buildV8SourceSignals(md,sectorData,newsData);const beneficiaries:Record<string,unknown>[]=[];const seen=new Set<string>();
  for(const stock of stocks){
    const symbol=String(stock.symbol||stock.stock_id||stock.stock_code||'').trim();const name=String(stock.name||stock.stock_name||STOCK_NAMES[symbol]||'').trim();if(!isValidTaiwanStock(symbol,name)||seen.has(symbol))continue;
    const sector=String(stock.sector||stock.group||catalystTypeForStock(symbol));const evidence=buildCandidateEvidence(stock,sectorData,newsData,causalChains);
    const marketEvidence=md.some(function(m){return m.symbol===symbol||m.symbol==='2330'||['NVDA','SOX','PHLX','TSM','TSMC'].includes(m.symbol.toUpperCase())})?'market_data: '+symbol+' 相關跨市場訊號可用':'';
    const evidenceSources=[...evidence,marketEvidence].filter(Boolean);if(evidenceSources.length<2)continue;
    const reasonChain=v8ReasonChain(stock,evidenceSources,sectorData,md);if(reasonChain.length<3)continue;
    const confidence=Math.max(0,Math.min(100,Math.round((confidenceNumberFromStock(stock)+Math.min(evidenceSources.length,4)*5+dScore.baseScore)/2)));
    beneficiaries.push({symbol,name,sector,reason_chain:reasonChain,confidence_score:confidence,risk_level:v8RiskLevel(evidenceSources.length,dScore),invalidation_condition:buildV8Invalidation(symbol,sector)});
    seen.add(symbol);if(beneficiaries.length>=10)break;
  }
  return{status:beneficiaries.length>=5?'ready':'insufficient',source_signals:sourceSignals,beneficiaries};
}
function buildV8OvernightCausalChain(md:MarketIndicator[],newsData:MarketNewsItem[],sectorData:SectorRotationRow[],causalChains:Record<string,unknown>[]):Record<string,unknown>{
  const nv=findMarketIndicator(md,['NVDA']);const sox=findMarketIndicator(md,['SOX','PHLX']);const tsm=findMarketIndicator(md,['TSM','TSMC']);const spx=findMarketIndicator(md,['SPX','SP500','GSPC']);const vix=findMarketIndicator(md,['VIX','VIXINDEX']);
  const hasOverseas=!!(nv||sox||tsm||spx||vix);if(!hasOverseas&&newsData.length===0)return{status:'insufficient',chains:[]};
  const chains:Record<string,unknown>[]=[];
  const techSector=sectorData.find(function(s){return s.sector.includes('半導體')||s.sector.includes('AI')});
  if(nv||sox||tsm||techSector){chains.push({theme:'AI 半導體',event:'NVDA / SOX / TSM 形成隔夜科技股訊號',causal_steps:[nv?'NVDA '+fmtV8Pct(nv.changePercent)+'，改變 AI 供應鏈風險偏好':'美股 AI 供應鏈提供隔夜參考',sox?'費半 '+fmtV8Pct(sox.changePercent)+'，影響半導體估值情緒':'半導體指標需等待盤中確認',tsm?'TSM ADR '+fmtV8Pct(tsm.changePercent)+'，提供 2330 開盤參考':'台積電 ADR 訊號不足，改看 2330 開盤',techSector?'台股 '+techSector.sector+' 族群輪動分數 '+techSector.rotation_score:'台股半導體權值股開盤情緒需驗證'],taiwan_impact:nv&&nv.changePercent>0||sox&&sox.changePercent>0?'偏多':nv&&nv.changePercent<0||sox&&sox.changePercent<0?'偏空':'觀察',affected_sectors:techSector?[techSector.sector]:['半導體','AI伺服器'],watch_points:['台積電開盤是否站穩平盤','電子權值股是否同步','台指期是否跟現貨一致','AI 伺服器族群是否放量'],invalidation_condition:'若 SOX 或 NVDA 盤後轉弱，且 2330 開盤無法站穩平盤，AI 半導體傳導鏈失效'});}
  if(spx||vix){chains.push({theme:'風險偏好',event:'SPX / VIX 反映隔夜市場風險偏好',causal_steps:[spx?'SPX '+fmtV8Pct(spx.changePercent)+'，代表美股整體風險偏好':'美股大盤訊號不足',vix?'VIX '+fmtV8Pct(vix.changePercent)+'，影響外資風險胃納':'波動率資料不足','外資風險偏好影響台指期與權值股開盤','台股金融與防禦股同步性提供盤中確認'],taiwan_impact:vix&&vix.changePercent>3?'偏空':spx&&spx.changePercent>0?'偏多':'觀察',affected_sectors:['金融','電子權值','電信防禦'],watch_points:['台指期是否跟現貨一致','新台幣是否轉強','金融權值股是否相對抗跌','VIX 是否持續升高'],invalidation_condition:'若 VIX 持續升高且台指期開盤轉弱，風險偏好改善假設失效'});}
  for(const c of causalChains.slice(0,2)){const event=String(c.overseas_trigger||c.catalyst||'');if(!event)continue;chains.push({theme:'既有隔夜鏈',event,causal_steps:[event,String(c.first_order_impact||'海外資產價格先反應'),String(c.taiwan_market_bridge||'傳導至台股相關族群'),String(c.stock_selection_logic||'盤中以族群與權值股同步性驗證')].filter(Boolean).slice(0,4),taiwan_impact:'觀察',affected_sectors:Array.isArray(c.sector_transmission)?c.sector_transmission:[],watch_points:['對應族群開盤是否同步','領先股是否放量','台指期是否跟現貨一致','尾盤是否維持方向'],invalidation_condition:String(c.invalidation_condition||'若對應族群開盤不同步且領先股轉弱，此隔夜鏈失效')});}
  const valid=chains.filter(function(c){return Array.isArray(c.causal_steps)&&(c.causal_steps as unknown[]).length>=4;}).slice(0,5);
  return{status:valid.length>0?'ready':'insufficient',chains:valid};
}
function buildV8DailySentence(beneficiary:Record<string,unknown>,overnight:Record<string,unknown>):Record<string,unknown>{
  const signals=Array.isArray(beneficiary.source_signals)?beneficiary.source_signals as Record<string,unknown>[]:[];const chains=Array.isArray(overnight.chains)?overnight.chains as Record<string,unknown>[]:[];
  if(String(overnight.status)!=='ready'||signals.length===0||chains.length===0)return{status:'insufficient',sentence:'',logic_source:[],tone:'clear, sharp, human-readable'};
  const first=chains[0];const theme=String(first.theme||'盤前主線');const watch=Array.isArray(first.watch_points)?String(first.watch_points[0]||'開盤同步性'): '開盤同步性';
  const sentence='今天真正要看的不是題材多熱，而是 '+theme+' 能不能在開盤後用「'+watch+'」把隔夜訊號傳到台股盤面。';
  return{status:'ready',sentence,logic_source:signals.slice(0,5).map(function(s){return String(s.source||'market_signal')}),tone:'clear, sharp, human-readable'};
}
function buildDeterministicV8Signals(md:MarketIndicator[],newsData:MarketNewsItem[],sectorData:SectorRotationRow[],dScore:MarketDataScore,stocks:Record<string,unknown>[],causalChains:Record<string,unknown>[],log:(m:string)=>void):V8Contract{
  try{const beneficiary=buildV8BeneficiaryChain(md,newsData,sectorData,dScore,stocks,causalChains);const overnight=buildV8OvernightCausalChain(md,newsData,sectorData,causalChains);const daily=buildV8DailySentence(beneficiary,overnight);log('[buildDeterministicV8Signals] beneficiary='+beneficiary.status+' count='+((beneficiary.beneficiaries as unknown[])||[]).length+' overnight='+overnight.status+' daily='+daily.status);return{v8_beneficiary_chain:beneficiary,v8_overnight_causal_chain:overnight,v8_daily_sentence:daily};}catch(e){log('[buildDeterministicV8Signals] failed: '+(e instanceof Error?e.message:String(e)));return buildV8InsufficientContract();}
}
function hasValidV8BeneficiaryChain(value:unknown):boolean{if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;if(!['ready','insufficient'].includes(String(v.status)))return false;return Array.isArray(v.source_signals)&&Array.isArray(v.beneficiaries);}
function hasValidV8OvernightChain(value:unknown):boolean{if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;if(!['ready','insufficient'].includes(String(v.status)))return false;return Array.isArray(v.chains);}
function hasValidV8DailySentence(value:unknown):boolean{if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;if(!['ready','insufficient'].includes(String(v.status)))return false;return typeof v.sentence==='string'&&Array.isArray(v.logic_source);}
function sanitizeV8BeneficiaryChain(value:unknown,fallback:Record<string,unknown>):Record<string,unknown>{
  if(!hasValidV8BeneficiaryChain(value))return fallback;
  const v=value as Record<string,unknown>;const fallbackItems=Array.isArray(fallback.beneficiaries)?fallback.beneficiaries as Record<string,unknown>[]:[];const allowed=new Set(fallbackItems.map(function(b){return String(b.symbol||'')}));const raw=Array.isArray(v.beneficiaries)?v.beneficiaries as Record<string,unknown>[]:[];
  const beneficiaries=raw.map(function(b){const symbol=String(b.symbol||'').trim();const name=String(b.name||STOCK_NAMES[symbol]||'').trim();const reasonChain=Array.isArray(b.reason_chain)?b.reason_chain.map(String).filter(Boolean):[];return{symbol,name,sector:String(b.sector||''),reason_chain:reasonChain,confidence_score:safeInteger(b.confidence_score,50),risk_level:['low','medium','high'].includes(String(b.risk_level))?String(b.risk_level):'medium',invalidation_condition:String(b.invalidation_condition||'').trim()};}).filter(function(b){return allowed.has(b.symbol)&&isValidTaiwanStock(b.symbol,b.name)&&b.reason_chain.length>=3&&b.invalidation_condition.length>=12;}).slice(0,10);
  if(beneficiaries.length===0&&fallbackItems.length>0)return fallback;
  return{status:beneficiaries.length>=5?'ready':'insufficient',source_signals:Array.isArray(v.source_signals)?v.source_signals:fallback.source_signals||[],beneficiaries};
}
function sanitizeV8OvernightChain(value:unknown,fallback:Record<string,unknown>):Record<string,unknown>{
  if(!hasValidV8OvernightChain(value))return fallback;
  const v=value as Record<string,unknown>;const raw=Array.isArray(v.chains)?v.chains as Record<string,unknown>[]:[];
  const chains=raw.map(function(c){return{theme:String(c.theme||''),event:String(c.event||''),causal_steps:Array.isArray(c.causal_steps)?c.causal_steps.map(String).filter(Boolean):[],taiwan_impact:['偏多','偏空','中性','觀察'].includes(String(c.taiwan_impact))?String(c.taiwan_impact):'觀察',affected_sectors:Array.isArray(c.affected_sectors)?c.affected_sectors.map(String).filter(Boolean):[],watch_points:Array.isArray(c.watch_points)?c.watch_points.map(String).filter(Boolean):[],invalidation_condition:String(c.invalidation_condition||'').trim()};}).filter(function(c){return c.event.length>0&&c.causal_steps.length>=4&&c.watch_points.length>0&&c.invalidation_condition.length>0;}).slice(0,5);
  if(chains.length===0)return fallback;
  return{status:'ready',chains};
}
function sanitizeV8DailySentence(value:unknown,fallback:Record<string,unknown>):Record<string,unknown>{
  if(!hasValidV8DailySentence(value))return fallback;
  const v=value as Record<string,unknown>;const sentence=String(v.sentence||'').trim();const banned=['市場仍有不確定性','投資人應謹慎','關注後續變化','後續仍需觀察','買進','賣出','加碼','減碼','保證獲利'];
  if(String(v.status)==='ready'&&(sentence.length<8||banned.some(function(p){return sentence.includes(p)})))return fallback;
  return{status:String(v.status),sentence,logic_source:Array.isArray(v.logic_source)?v.logic_source.map(String).filter(Boolean):[],tone:'clear, sharp, human-readable'};
}
function hasConditionalPremarketPrefix(text:string,idx:number):boolean{const before=text.slice(Math.max(0,idx-8),idx);return before.includes('若')||before.includes('如果')||before.includes('盤中若')||before.includes('收盤若');}
function replacePremarketTemporalPattern(text:string,pattern:RegExp,replacement:string):string{return text.replace(pattern,function(match:string,...args:unknown[]){const offset=Number(args[args.length-2]);return hasConditionalPremarketPrefix(text,offset)?match:match.replace(pattern,replacement);});}
function sanitizePremarketTemporalLanguage(text:string):string{
  if(!text)return text;let out=String(text);
  out=replacePremarketTemporalPattern(out,/(?:今日|今天|本日)[\s　]*(?:\d{4}-\d{2}-\d{2}[\s　]*)?(?:開盤後|盤中)需觀察/g,'下一個交易時段開盤後需觀察');
  out=replacePremarketTemporalPattern(out,/今(?:日|天)[\s　]*(?:\d{4}-\d{2}-\d{2}[\s　]*)?開盤後需觀察/g,'下一個交易時段開盤後需觀察');
  out=replacePremarketTemporalPattern(out,/今日\s*\d{4}-\d{2}-\d{2}\s*開盤後需觀察/g,'下一個交易時段開盤後需觀察');
  out=replacePremarketTemporalPattern(out,/今日開盤後需觀察/g,'下一個交易時段開盤後需觀察');
  out=replacePremarketTemporalPattern(out,/今天開盤後需觀察/g,'下一個交易時段開盤後需觀察');
  out=replacePremarketTemporalPattern(out,/([^\s，。；、]{0,12})今日股價上漲[0-9.]+%?/g,'$1前一交易日或相關 ADR 表現偏強，今日需觀察是否延續到現貨');
  out=replacePremarketTemporalPattern(out,/([^\s，。；、]{0,12})今日股價/g,'$1今日開盤後股價');
  out=replacePremarketTemporalPattern(out,/今天已上漲/g,'若今日開盤後上漲');
  out=replacePremarketTemporalPattern(out,/今天上漲/g,'若今日開盤後上漲');
  out=replacePremarketTemporalPattern(out,/今日表現強勁/g,'今日需觀察是否延續強勢');
  out=replacePremarketTemporalPattern(out,/今日收盤價高於([0-9,]+(?:\.[0-9]+)?元?)/g,'若收盤價站上$1，才代表盤中劇本被驗證');
  out=replacePremarketTemporalPattern(out,/今日收盤/g,'若今日收盤');
  out=replacePremarketTemporalPattern(out,/收盤價高於([0-9,]+(?:\.[0-9]+)?元?)/g,'若收盤價站上$1');
  out=replacePremarketTemporalPattern(out,/今日成交量已/g,'盤中需觀察成交量是否');
  out=replacePremarketTemporalPattern(out,/成交量突破([0-9,萬億千百十]+股?)/g,'盤中需觀察成交量是否放大至$1');
  out=replacePremarketTemporalPattern(out,/已突破/g,'若盤中突破');
  out=replacePremarketTemporalPattern(out,/已站上/g,'若盤中站上');
  out=replacePremarketTemporalPattern(out,/已放量/g,'若盤中放量');
  out=replacePremarketTemporalPattern(out,/股價跌破/g,'若股價跌破');
  return out;
}
function sanitizePremarketStringArray(value:unknown):string[]{return Array.isArray(value)?value.map(function(v){return sanitizePremarketTemporalLanguage(String(v));}).filter(Boolean):[];}
function sanitizePremarketTemporalFields(ai:Record<string,unknown>):Record<string,unknown>{
  if(!ai||typeof ai!=='object'||Array.isArray(ai))return ai as Record<string,unknown>;
  if(typeof ai.member_research_note==='string')ai.member_research_note=sanitizePremarketTemporalLanguage(ai.member_research_note);
  const note=ai.member_research_note_v2 as Record<string,unknown>|undefined;
  if(note&&typeof note==='object'&&!Array.isArray(note)){
    if(typeof note.subscriber_value_sentence==='string')note.subscriber_value_sentence=sanitizePremarketTemporalLanguage(note.subscriber_value_sentence);
    if(Array.isArray(note.intraday_validation))note.intraday_validation=note.intraday_validation.map(function(item){if(!item||typeof item!=='object'||Array.isArray(item))return item;const r={...(item as Record<string,unknown>)};if(typeof r.bullish_confirm==='string')r.bullish_confirm=sanitizePremarketTemporalLanguage(r.bullish_confirm);if(typeof r.bearish_fail==='string')r.bearish_fail=sanitizePremarketTemporalLanguage(r.bearish_fail);return r;});
    const closing=note.closing_feedback_plan as Record<string,unknown>|undefined;if(closing&&typeof closing==='object'&&!Array.isArray(closing)&&typeof closing.success_criteria==='string')closing.success_criteria=sanitizePremarketTemporalLanguage(closing.success_criteria);
  }
  for(const key of ['today_beneficiary_stocks','beneficiary_stocks']){if(Array.isArray(ai[key]))ai[key]=(ai[key] as Record<string,unknown>[]).map(function(item){if(!item||typeof item!=='object'||Array.isArray(item))return item;const r={...item};if(typeof r.reason==='string')r.reason=sanitizePremarketTemporalLanguage(r.reason);if(typeof r.watch_point==='string')r.watch_point=sanitizePremarketTemporalLanguage(r.watch_point);return r;});}
  const daily=ai.v8_daily_sentence as Record<string,unknown>|undefined;if(daily&&typeof daily==='object'&&!Array.isArray(daily)&&typeof daily.sentence==='string')daily.sentence=sanitizePremarketTemporalLanguage(daily.sentence);
  const overnight=ai.v8_overnight_causal_chain as Record<string,unknown>|undefined;if(overnight&&typeof overnight==='object'&&!Array.isArray(overnight)&&Array.isArray(overnight.chains))overnight.chains=overnight.chains.map(function(item){if(!item||typeof item!=='object'||Array.isArray(item))return item;const r={...(item as Record<string,unknown>)};r.causal_steps=sanitizePremarketStringArray(r.causal_steps);r.watch_points=sanitizePremarketStringArray(r.watch_points);return r;});
  const beneficiary=ai.v8_beneficiary_chain as Record<string,unknown>|undefined;if(beneficiary&&typeof beneficiary==='object'&&!Array.isArray(beneficiary)&&Array.isArray(beneficiary.beneficiaries))beneficiary.beneficiaries=beneficiary.beneficiaries.map(function(item){if(!item||typeof item!=='object'||Array.isArray(item))return item;const r={...(item as Record<string,unknown>)};r.reason_chain=sanitizePremarketStringArray(r.reason_chain);return r;});
  return ai;
}
function limitBeneficiaryStockCounts(ai:Record<string,unknown>):Record<string,unknown>{
  if(!ai||typeof ai!=='object'||Array.isArray(ai))return ai as Record<string,unknown>;
  if(Array.isArray(ai.beneficiary_stocks))ai.beneficiary_stocks=ai.beneficiary_stocks.slice(0,10);
  if(Array.isArray(ai.today_beneficiary_stocks))ai.today_beneficiary_stocks=ai.today_beneficiary_stocks.slice(0,8);
  return ai;
}
function sanitizeV8Contract(ai:Record<string,unknown>,fallback:V8Contract,log:(m:string)=>void):V8Contract{
  const b=sanitizeV8BeneficiaryChain(ai.v8_beneficiary_chain,fallback.v8_beneficiary_chain);
  const o=sanitizeV8OvernightChain(ai.v8_overnight_causal_chain,fallback.v8_overnight_causal_chain);
  const d=sanitizeV8DailySentence(ai.v8_daily_sentence,fallback.v8_daily_sentence);
  if(b===fallback.v8_beneficiary_chain||o===fallback.v8_overnight_causal_chain||d===fallback.v8_daily_sentence)log('[v8] invalid or missing field, using insufficient fallback for unsafe V8 parts');
  return{v8_beneficiary_chain:b,v8_overnight_causal_chain:o,v8_daily_sentence:d};
}
function hasCompleteV8Contract(ai:Record<string,unknown>):boolean{return hasValidV8BeneficiaryChain(ai.v8_beneficiary_chain)&&hasValidV8OvernightChain(ai.v8_overnight_causal_chain)&&hasValidV8DailySentence(ai.v8_daily_sentence);}
function sanitizeV8ContractSafe(ai:Record<string,unknown>,log:(m:string)=>void):V8Contract{
  try{
    if(!hasCompleteV8Contract(ai)){log('V8_MISSING_OR_INVALID_FIELDS');return buildV8InsufficientContract();}
    const insufficient=buildV8InsufficientContract();
    const sanitized=sanitizeV8Contract(ai,insufficient,log);
    if(sanitized.v8_beneficiary_chain===insufficient.v8_beneficiary_chain||sanitized.v8_overnight_causal_chain===insufficient.v8_overnight_causal_chain||sanitized.v8_daily_sentence===insufficient.v8_daily_sentence){log('V8_SANITIZE_INCOMPLETE');return buildV8InsufficientContract();}
    const rawB=ai.v8_beneficiary_chain as Record<string,unknown>;const rawO=ai.v8_overnight_causal_chain as Record<string,unknown>;const rawD=ai.v8_daily_sentence as Record<string,unknown>;
    const cleanB=sanitized.v8_beneficiary_chain as Record<string,unknown>;const cleanO=sanitized.v8_overnight_causal_chain as Record<string,unknown>;const cleanD=sanitized.v8_daily_sentence as Record<string,unknown>;
    if((rawB.status==='ready'&&cleanB.status!=='ready')||(rawO.status==='ready'&&cleanO.status!=='ready')||(rawD.status==='ready'&&cleanD.status!=='ready')){log('V8_READY_DROPPED_BY_SANITIZE');return buildV8InsufficientContract();}
    return sanitized;
  }catch(error){console.error('V8_SANITIZE_FAILED',error);log('V8_SANITIZE_FAILED: '+(error instanceof Error?error.message:String(error)));return buildV8InsufficientContract();}
}

function mergeBeneficiaryStocks(openai:Record<string,unknown>[]|undefined,deterministic:Record<string,unknown>[],_minCount:number):Record<string,unknown>[]{
  const r:Record<string,unknown>[]=[];const s=new Set<string>();
  if(Array.isArray(openai)){for(const i of openai){const sym=String(i.symbol||i.stock_id||i.code||'');if(sym&&!s.has(sym)){r.push({...i,not_buy_signal:true});s.add(sym)}}}
  for(const i of deterministic){const sym=String(i.symbol||i.stock_id||'');if(sym&&!s.has(sym)){r.push(i);s.add(sym)}}
  return r;
}
function mergeChains(openai:Record<string,unknown>[]|undefined,deterministic:Record<string,unknown>[],_minCount:number):Record<string,unknown>[]{
  const r:Record<string,unknown>[]=[];const s=new Set<string>();
  if(Array.isArray(openai)){for(const c of openai){const cat=String(c.catalyst||c.chain_title||c.overseas_trigger||'');if(cat&&!s.has(cat)){r.push(c);s.add(cat)}}}
  for(const c of deterministic){const cat=String(c.catalyst||c.chain_title||c.overseas_trigger||'');if(cat&&!s.has(cat)){r.push(c);s.add(cat)}}
  return r;
}
function preFilterOpenaiTWStocks(stocks:Record<string,unknown>[]|undefined,log:(m:string)=>void):Record<string,unknown>[]{
  if(!Array.isArray(stocks))return [];const filtered:Record<string,unknown>[]=[];const seen=new Set<string>();
  for(const s of stocks){const sym=String(s.symbol||s.stock_id||'');if(isValidTaiwanStock(s.symbol||s.stock_id,s.name||s.stock_name)&&!seen.has(sym)){filtered.push({...s,not_buy_signal:true});seen.add(sym)}else if(sym)log('[preFilterOpenaiTWStocks] STRIPPED: '+sym)}
  log('[preFilterOpenaiTWStocks] TW: '+filtered.length+' (raw: '+stocks.length+')');return filtered;
}

function checkMVPStatus(md:MarketIndicator[],_log:(m:string)=>void):MVPStatus{const s=md.map(function(m){return m.symbol.toUpperCase()});const n=s.includes('NVDA'),t=s.includes('TSM'),p=s.includes('SPX');const c=[n,t,p].filter(Boolean).length;return{nvdaPresent:n,tsmPresent:t,spxPresent:p,mvpCount:c,mvpInsufficient:c<2}}
function checkTWCoreStatus(md:MarketIndicator[],_log:(m:string)=>void):TWCoreStatus{const s=md.map(function(m){return m.symbol.toUpperCase()});const taiex=s.some(function(x){return x==='TAIEX'||x==='TWII'||x==='^TWII'});const txf=s.some(function(x){return x==='TXF'||x==='TX'||x==='MTX'});const ts=s.some(function(x){return x==='2330'||x==='2330.TW'});const mm=[taiex,txf,ts].filter(function(v){return !v}).length;return{taiexPresent:taiex,txfPresent:txf,ts2330Present:ts,missingCount:mm,dataInsufficient:mm>=2}}

function calculateMarketDataScore(md:MarketIndicator[]):MarketDataScore{
  let s=50;const rs:string[]=[],rr:string[]=[],dt:Record<string,number>={};
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const t=f(['TAIEX','TWII']),ts=f(['2330','2330.TW']),ix=f(['IXIC','NASDAQ']),sx=f(['SOX','PHLX']),tm=f(['TSM','TSMC']),vi=f(['VIX','VIXINDEX']),dx=f(['DXY','USDINDEX']),uy=f(['US10Y','TNX','T10Y']),nv=f(['NVDA']),am=f(['AMD']),sp=f(['SPX','SP500','GSPC']);
  if(t){const c=t.changePercent;if(c>=1.5){s+=25;rs.push('台股強漲');dt.taiex=25}else if(c>=0.8){s+=20;rs.push('台股上漲');dt.taiex=20}else if(c>=0.3){s+=10;dt.taiex=10}else if(c<=-1.5){s-=25;rr.push('台股重挫');dt.taiex=-25}else if(c<=-0.8){s-=20;rr.push('台股下跌');dt.taiex=-20}else if(c<=-0.3){s-=10;dt.taiex=-10}}
  if(ts&&ts.changePercent>=2){s+=20;rs.push('台積電領漲');dt.tsmc2330=20}else if(ts&&ts.changePercent>=1){s+=15;dt.tsmc2330=15}else if(ts&&ts.changePercent>=0.3){s+=8;dt.tsmc2330=8}else if(ts&&ts.changePercent<=-2){s-=20;rr.push('台積電重挫');dt.tsmc2330=-20}else if(ts&&ts.changePercent<=-1){s-=15;dt.tsmc2330=-15}else if(ts&&ts.changePercent<=-0.3){s-=8;dt.tsmc2330=-8}
  if(ix){s+=ix.changePercent>0?10:-10;dt.ixic=ix.changePercent>0?10:-10}
  if(sx){s+=sx.changePercent>0?12:-12;dt.sox=sx.changePercent>0?12:-12}
  if(tm){s+=tm.changePercent>0?10:-10;dt.tsm=tm.changePercent>0?10:-10}
  if(vi){s+=vi.changePercent<0?10:-10;dt.vix=vi.changePercent<0?10:-10}
  if(dx){s+=dx.changePercent<0?5:-5;dt.dxy=dx.changePercent<0?5:-5}
  if(uy){s+=uy.changePercent<0?10:-10;dt.us10y=uy.changePercent<0?10:-10}
  if(nv){s+=nv.changePercent>0?8:-8;dt.nvda=nv.changePercent>0?8:-8}
  if(am){s+=am.changePercent>0?5:-5;dt.amd=am.changePercent>0?5:-5}
  if(sp){s+=sp.changePercent>0?6:-6;dt.spx=sp.changePercent>0?6:-6}
  return{baseScore:Math.max(0,Math.min(100,s)),reasons:rs.length?rs:['市場訊號中性'],riskReasons:rr.length?rr:['暫無明顯風險訊號'],details:dt};
}

function hasAnySymbol(md:MarketIndicator[],syms:string[]):boolean{return md.some(function(m){return syms.includes(m.symbol.toUpperCase())});}
function calculateReportConfidenceScore(params:{marketData:MarketIndicator[];newsData:MarketNewsItem[];sectorData:SectorRotationRow[];dates:{twCoreDate:string;usGlobalDate:string};dataQuality:string;missingSources:string[];openAIUsed:boolean}):ReportConfidenceScore{
  const md=Array.isArray(params.marketData)?params.marketData:[];const news=Array.isArray(params.newsData)?params.newsData:[];const sectors=Array.isArray(params.sectorData)?params.sectorData:[];const missing=Array.isArray(params.missingSources)?params.missingSources:[];
  const marketDataPoints=md.length>0?25:0;
  const twCoreCount=[hasAnySymbol(md,['TAIEX','TWII','^TWII']),hasAnySymbol(md,['2330','2330.TW']),hasAnySymbol(md,['TXF','TX','MTX'])].filter(Boolean).length;
  const twCorePoints=Math.round((twCoreCount/3)*20);
  const usCoreCount=[hasAnySymbol(md,['SPX','SP500','GSPC']),hasAnySymbol(md,['IXIC','NASDAQ']),hasAnySymbol(md,['SOX','PHLX']),hasAnySymbol(md,['NVDA']),hasAnySymbol(md,['TSM','TSMC'])].filter(Boolean).length;
  const usCorePoints=Math.round((Math.min(usCoreCount,5)/5)*20);
  const newsPoints=news.length>0?10:0;
  const sectorPoints=sectors.length>0?10:0;
  const openAIPoints=params.openAIUsed?10:0;
  const datePoints=params.dates.twCoreDate&&params.dates.usGlobalDate?5:0;
  const degradedPenalty=params.dataQuality==='degraded'?Math.min(10,Math.max(5,missing.length*3)):0;
  const raw=marketDataPoints+twCorePoints+usCorePoints+newsPoints+sectorPoints+openAIPoints+datePoints-degradedPenalty;
  const score=Math.max(0,Math.min(100,Math.round(raw)));
  return{score,breakdown:{market_data_points:marketDataPoints,market_data_count:md.length,tw_core_points:twCorePoints,tw_core_count:twCoreCount,us_core_points:usCorePoints,us_core_count:usCoreCount,news_points:newsPoints,news_count:news.length,sector_rotation_points:sectorPoints,sector_rotation_rows:sectors.length,openai_points:openAIPoints,openai_used:params.openAIUsed,date_points:datePoints,data_quality:params.dataQuality,missing_sources:missing,degraded_penalty:degradedPenalty,raw_score:raw,score_semantics:'confidence_score=data completeness + signal consistency + report usability; market_bias_score=directional bias score'}};
}

function extractMarketNumericPayload(md:MarketIndicator[]):Record<string,unknown>{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};const p:Record<string,unknown>={};
  const vix=f(['VIX','VIXINDEX']);if(vix&&!Number.isNaN(vix.value))p.vix=vix.value;
  const sp=f(['SPX','SP500','GSPC']);if(sp&&!Number.isNaN(sp.changePercent))p.sp500_change=sp.changePercent;
  const sox=f(['SOX','PHLX']);if(sox&&!Number.isNaN(sox.changePercent))p.sox_change=sox.changePercent;
  const ndq=f(['IXIC','NASDAQ']);if(ndq&&!Number.isNaN(ndq.changePercent))p.nasdaq_change=ndq.changePercent;
  const dji=f(['DJI','DOW','DJIA']);if(dji&&!Number.isNaN(dji.changePercent))p.dow_change=dji.changePercent;
  const dx=f(['DXY','USDINDEX']);if(dx&&!Number.isNaN(dx.value))p.dxy=dx.value;
  const uy=f(['US10Y','TNX','T10Y']);if(uy&&!Number.isNaN(uy.value))p.us10y_yield=uy.value;
  const tm=f(['TSM','TSMC']);if(tm&&!Number.isNaN(tm.changePercent))p.tsm_adr_change=tm.changePercent;
  const txf=f(['TXF','TX','MTX']);if(txf&&!Number.isNaN(txf.changePercent))p.taiwan_futures_change=txf.changePercent;
  return p;
}

async function fetchMarketData(supabase:ReturnType<typeof createClient>,log:(msg:string)=>void){try{const r=await supabase.from('market_data').select('*').order('captured_at',{ascending:false}).limit(30);const{data,error}=safeUnwrap<Record<string,unknown>[]>(r,log,'market_data');if(error||!data?.length){log('fmData:empty');return{marketData:[],latestDataTime:null,isStale:true,dataCount:0}}let latest:Date|null=null;for(const d of data){const t=d.captured_at||d.created_at||d.updated_at;if(t){const dt=new Date(t as string);if(!latest||dt>latest)latest=dt}}return{marketData:data.map(function(r:Record<string,unknown>){const v=Number(r.value)||0;const cp=Number(r.change_percent)||0;let ch=Number(r.change)||0;if(!ch&&v&&cp)ch=v*cp/100;return{symbol:String(r.symbol||''),name:String(r.name||''),market:String(r.market||''),value:v,change:ch,changePercent:cp,updatedAt:String(r.captured_at||r.created_at||r.updated_at||''),status:String(r.status||'flat'),taiwanImpact:String(r.taiwan_impact||'')}}),latestDataTime:latest,isStale:!latest||Date.now()-latest.getTime()>HOURS_24,dataCount:data.length}}catch(e){log('fmData exc:'+(e instanceof Error?e.message:String(e)));return{marketData:[],latestDataTime:null as Date|null,isStale:true,dataCount:0}}}

async function fetchMarketNews(supabase:ReturnType<typeof createClient>,log:(msg:string)=>void):Promise<FetchNewsResult>{try{const r=await supabase.from('market_news').select('id,title,source,url,published_at,created_at,related_sectors,taiwan_impact_summary,raw_payload').order('created_at',{ascending:false}).limit(30);const{data,error}=safeUnwrap<Record<string,unknown>[]>(r,log,'market_news');if(error||!data?.length){log('fmNews:empty');return{newsData:[],latestNewsTime:null,isStale:true,newsCount:0}}let latest:Date|null=null;for(const d of data){const t=d.published_at||d.created_at;if(t){const dt=new Date(t as string);if(!latest||dt>latest)latest=dt}}return{newsData:data.map(function(r:Record<string,unknown>){return{id:String(r.id||''),title:String(r.title||''),source:String(r.source||''),url:String(r.url||''),published_at:r.published_at?String(r.published_at):null,created_at:String(r.created_at||''),related_sectors:Array.isArray(r.related_sectors)?r.related_sectors:null,taiwan_impact_summary:r.taiwan_impact_summary?String(r.taiwan_impact_summary):null,raw_payload:r.raw_payload&&typeof r.raw_payload==='object'?r.raw_payload as Record<string,unknown>:null}}),latestNewsTime:latest,isStale:!latest||Date.now()-latest.getTime()>HOURS_24,newsCount:data.length}}catch(e){log('fmNews exc:'+(e instanceof Error?e.message:String(e)));return{newsData:[],latestNewsTime:null,isStale:true,newsCount:0}}}

async function fetchPreviousReportForDate(supabase:ReturnType<typeof createClient>,reportDate:string,log:(msg:string)=>void):Promise<Record<string,unknown>|null>{try{const result=await supabase.from('reports').select('report_date,market_bias,confidence_score,ai_strategy_json,created_at,updated_at').eq('report_date',reportDate).order('created_at',{ascending:false}).limit(1).maybeSingle();const {data,error}=safeUnwrap<Record<string,unknown>>(result,log,'previous_report');if(error||!data){log(`previous_report:empty ${reportDate}`);return null;}return data;}catch(e){log(`previous_report_exception:${e instanceof Error?e.message:String(e)}`);return null;}}

async function fetchRecentReportsForV10Universe(supabase:ReturnType<typeof createClient>,beforeDate:string,log:(msg:string)=>void):Promise<Record<string,unknown>[]> {try{const result=await supabase.from('reports').select('report_date,ai_strategy_json').lt('report_date',beforeDate).order('report_date',{ascending:false}).limit(14);const {data,error}=safeUnwrap<Record<string,unknown>[]>(result,log,'v10_recent_reports');if(error||!data?.length){log(`v10_recent_reports:empty before ${beforeDate}`);return [];}return data;}catch(e){log(`v10_recent_reports_exception:${e instanceof Error?e.message:String(e)}`);return [];}}

function computeDatesFromMarketData(rawData:Record<string,unknown>[]):{twCoreDate:string;usGlobalDate:string;dataTimeBasis:string}{
  const twSyms=['TAIEX','TWII','^TWII','2330','2330.TW','TXF','TX','MTX'];const usSyms=['NVDA','TSM','TSMC','SPX','SP500','GSPC','SOX','PHLX','IXIC','NASDAQ','VIX','VIXINDEX','DXY','USDINDEX','US10Y','TNX','T10Y'];
  let twAt='',usAt='';for(const r of rawData){const sym=String(r.symbol||'').toUpperCase();const cat=String(r.captured_at||'');if(!cat)continue;if(twSyms.includes(sym)&&(!twAt||cat>twAt))twAt=cat;if(usSyms.includes(sym)&&(!usAt||cat>usAt))usAt=cat;}
  return{twCoreDate:twAt?formatCapturedAtTaipeiDate(twAt):getTaipeiDateString(),usGlobalDate:usAt?formatCapturedAtTaipeiDate(usAt):getTaipeiDateString(),dataTimeBasis:'captured_at'};
}

function getTaipeiDateString():string{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return (p.find(function(x){return x.type==='year'})?.value||'')+'-'+(p.find(function(x){return x.type==='month'})?.value||'')+'-'+(p.find(function(x){return x.type==='day'})?.value||'')}
function getTaipeiDayOfWeek():number{try{const d=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short'}).formatToParts(new Date()).find(function(p){return p.type==='weekday'})?.value||'';const m:Record<string,number>={'Sun':0,'Mon':1,'Tue':2,'Wed':3,'Thu':4,'Fri':5,'Sat':6};return m[d]??-1}catch{return-1}}
function formatCapturedAtTaipeiDate(isoStr:string):string{try{const d=new Date(isoStr);if(Number.isNaN(d.getTime()))return'';const tw=new Date(d.toLocaleString('en-US',{timeZone:'Asia/Taipei'}));return tw.getFullYear()+'-'+String(tw.getMonth()+1).padStart(2,'0')+'-'+String(tw.getDate()).padStart(2,'0')}catch{return''}}
function determineReportMode(dow:number,hasMarketData:boolean,dataCount:number):string{if(dow===0||dow===6)return REPORT_MODE_NON_TRADING;if(!hasMarketData||dataCount===0)return REPORT_MODE_NON_TRADING;return REPORT_MODE_NORMAL}
function classifyMarketBias(cs:number):string{if(cs>=75)return'偏多觀察';if(cs>=55)return'中性偏多';if(cs>=45)return'震盪觀察';if(cs>=25)return'偏弱觀察';return'偏弱觀察'}

// V9.0: Vivid today_quote
function buildVividTodayQuote(md:MarketIndicator[],dScore:MarketDataScore,marketBias:string):string{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const nv=f(['NVDA']),sox=f(['SOX','PHLX']),spx=f(['SPX','SP500']),vix=f(['VIX','VIXINDEX']),taiex=f(['TAIEX','TWII']),tsm=f(['TSM','TSMC']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const nvStrong=nv&&!Number.isNaN(nv.changePercent)&&Math.abs(nv.changePercent)>1.5;
  const vixHigh=vix&&vix.value>=22;
  const soxDir=sox&&!Number.isNaN(sox.changePercent)?(sox.changePercent>0?'同步走強':'走弱'):'';

  if(!nv&&!sox&&!spx){
    if(dScore.baseScore>=60)return '今日市場數據偏向正面，台股盤前方向偏多，但海外指標不足，開盤後需以實際走勢為準，勿憑感覺追價。';
    if(dScore.baseScore<=40)return '市場數據偏弱，今天不是適合主動出擊的日子。先觀察開盤，不要急著進場。';
    return '海外資料尚在更新中，盤前訊號不夠明確。今天先以觀察為主，等開盤確認方向後再做判斷。';
  }
  if(marketBias==='偏多觀察'){
    if(nvStrong&&nv&&nv.changePercent>0){
      if(vixHigh)return 'NVDA '+fmtPct(nv.changePercent)+' 大漲推高 AI 期待，但 VIX 還掛在 '+(vix.value?.toFixed(1)||'高')+' 沒下來。今天不是全面進攻盤，資金在測試 AI 主線還燒不燒；開盤 30 分鐘若量能跟不上，就要小心熱度變成短線拉高。';
      return '昨夜 NVDA '+fmtPct(nv.changePercent)+' 領軍，SOX '+soxDir+'，盤前方向偏多。但關鍵在開盤：如果 AI 族群同步放量，今天就是主線延續；如果只有 2330 獨強，其他不跟，那就是假突破。';
    }
    return '美股表現不差，台股開盤偏多機率高。但今天真正要觀察的不是漲不漲，而是錢有沒有從權值股擴散到中小型。如果只有大人在玩，散戶沒跟，續航力就會打折。';
  }
  if(marketBias==='中性偏多'){
    if(vixHigh)return '今天盤面有點矛盾：數據偏多但 VIX 不低，代表市場半信半疑。這種盤最怕開高走低，追價的人會被修理。先等 09:30 確認量價結構，不急。';
    if(sox&&sox.changePercent<0)return '美股整體偏強，但 SOX '+fmtPct(sox.changePercent)+' 拖了後腿。今天台股半導體可能開得猶豫，關鍵看 2330 表態。如果連 2330 都站不穩，多方就沒戲。';
    return '盤前數據偏向正面，但沒有強到可以放心進場。今天適合「看多做少」：方向偏多，但出手要等確認，不要開盤第一根 K 線就衝進去。';
  }
  if(marketBias==='震盪觀察'){
    if(nv&&sox&&nv.changePercent>0&&sox.changePercent<0)return 'NVDA '+fmtPct(nv.changePercent)+' 漲但 SOX '+fmtPct(sox.changePercent)+' 跌，AI 內部在打架。這種盤最難做，方向不一致的時候硬要選邊站就是賭。今天先看，讓市場自己先打完再說。';
    return '盤前訊號分歧，多空都沒有壓倒性優勢。今天與其猜方向，不如觀察資金在哪些族群集結。震盪盤做對族群比做對大盤重要。';
  }
  if(marketBias==='偏弱觀察'){
    if(vixHigh&&nv&&nv.changePercent<-1)return 'NVDA '+fmtPct(nv.changePercent)+' 重挫加上 VIX 高掛，今天開盤壓力不小。不是恐慌的時候，但也不是撿便宜的時候。讓市場先消化賣壓，盤中確認有沒有止跌訊號再說。';
    if(spx&&spx.changePercent<-0.5)return 'SPX '+fmtPct(spx.changePercent)+' 走弱，外資今天可能站在賣方。不要跟外資對做，他們賣的時候散戶硬接通常是最貴的學費。等賣壓宣洩完再觀察。';
    return '盤前數據偏弱，今天不適合追任何方向。與其勉強進場，不如保留現金等更好的機會。市場永遠有明天，但子彈用完就沒了。';
  }
  return '今日盤前市場方向：'+marketBias+'，方向分數 '+dScore.baseScore+'/100。開盤後以實際走勢為最終判斷，勿憑盤前預期操作。';
}

function buildDeterministicAIStrategyJson(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string;dataTimeBasis:string},dScore:MarketDataScore,twStatus:TWCoreStatus,mvpStatus:MVPStatus,reportMode:string,sectorData:SectorRotationRow[],log:(m:string)=>void,confidenceResult?:ReportConfidenceScore):Record<string,unknown>{
  const marketBias=classifyMarketBias(dScore.baseScore);const confidenceScore=confidenceResult?.score??dScore.baseScore;
  const todayQuote=buildVividTodayQuote(md,dScore,marketBias);const oneSentence=todayQuote;
  const doNotDoList:string[]=[];
  if(marketBias==='偏弱觀察')doNotDoList.push('避免追空殺低，等待止跌訊號。');
  if(marketBias==='偏多觀察')doNotDoList.push('避免追高，等待量縮拉回再觀察。');
  if(marketBias==='震盪觀察')doNotDoList.push('避免在無明顯方向時重倉進場。');

  const threeTier=buildThreeTierBeneficiaryStocks(md,sectorData,dScore,log);
  const causalChains=buildCausalOvernightImpactChain(md,dScore);

  const openingRadar=buildDeterministicOpeningRadar(md);
  const intradayRadar=buildDeterministicIntradayRadar();
  const intradayTrackingPlan=buildDeterministicIntradayTrackingPlan();
  const watchSectorsDetailed=buildDeterministicWatchSectorsDetailed(md,dScore);
  const memberNoteText=buildMemberResearchNoteText(md,todayDate,dates,dScore,marketBias,confidenceScore,threeTier.todayStocks,reportMode,log);
  const memberNoteV2=buildMemberResearchNoteV2(md,newsData,todayDate,dates,dScore,marketBias,confidenceScore,sectorData,causalChains,threeTier.fullStocks,log);
  const memberNoteV8=buildV8ContractFromMemberNoteV2(memberNoteV2,threeTier.fullStocks,md,sectorData);
  const v8Contract=v8ContractHasUsableData(memberNoteV8)?memberNoteV8:buildV8InsufficientContract();
  const intradayValidationPlan={open_0900_0930:'觀察開盤是否反映 '+marketBias+' 方向',mid_session_1000_1130:'觀察量能與族群擴散是否跟上',afternoon_1300_1330:'觀察尾盤資金流向',fail_signals:['開盤反向跳空超過 1%','量能大幅萎縮','主要權值股開盤即轉弱']};
  const renewalValueBlock={why_member_should_read_today:'今日 '+todayDate+' 盤前報告基於真實市場數據，方向：'+marketBias+'，信心：'+confidenceScore+'/100',what_free_news_does_not_provide:'量化市場數據、跨市場連動分析、盤前綜合判斷',tomorrow_followup_hook:'明日將持續追蹤市場方向是否驗證'};

  return{
    version:VERSION,source:'deterministic_real_market_data',generated_at:new Date().toISOString(),
    target_date:todayDate,tw_core_date:dates.twCoreDate,us_global_date:dates.usGlobalDate,data_time_basis:dates.dataTimeBasis,
    report_mode:reportMode,quality_score:75,member_value_score:70,
    no_fake_fallback:true,fake_fallback_used:false,data_date_aligned:true,publish_ready:true,
    confidence_score:confidenceScore,market_bias_score:dScore.baseScore,market_bias:marketBias,today_quote:todayQuote,
    confidence_breakdown:confidenceResult?.breakdown||{score_semantics:'legacy confidence_score used market_bias_score before P15 split'},
    tw_core_present:!twStatus.dataInsufficient,us_global_present:!mvpStatus.mvpInsufficient,
    beneficiary_engine_version:'V9.0_THREE_TIER_BENEFICIARY',
    tw_stock_filter_applied:true,research_card_format:true,fields_complete_guaranteed:true,write_time_guarantee:true,member_note_format:'plain_text_and_v2',
    free_summary:{today_status:reportMode===REPORT_MODE_NON_TRADING?'非交易日':'交易日盤前',one_sentence:oneSentence,market_bias:marketBias,confidence_score:confidenceScore,do_not_do:doNotDoList.join(' '),mindset:'盤前判斷僅供參考，實際操作以開盤後市場走勢為準。',cta_hint:'查看完整盤前報告'},
    member_research_note:memberNoteText,
    member_research_note_v2:memberNoteV2,
    v8_beneficiary_chain:v8Contract.v8_beneficiary_chain,
    v8_overnight_causal_chain:v8Contract.v8_overnight_causal_chain,
    v8_daily_sentence:v8Contract.v8_daily_sentence,
    core_beneficiary_stocks:threeTier.core_beneficiary_stocks,extended_watchlist:threeTier.extended_watchlist,scenario_watchlist:threeTier.scenario_watchlist,
    data_status:threeTier.data_status,data_basis_note:threeTier.data_basis_note,
    today_beneficiary_stocks:threeTier.todayStocks,beneficiary_stocks:threeTier.fullStocks,
    watch_sectors_detailed:watchSectorsDetailed,
    overnight_impact_chain:causalChains,causal_overnight_impact_chains:causalChains,
    opening_radar:openingRadar,intraday_radar:intradayRadar,intraday_tracking_plan:intradayTrackingPlan,
    reasoning_chain:[{step:'1. 資料基準確認',evidence:'captured_at 台北日期：TW='+dates.twCoreDate+', US='+dates.usGlobalDate,inference:'資料為最近完整交易日收盤',confidence:90},{step:'2. 市場數據評分',evidence:dScore.reasons.join('；')+' | '+dScore.riskReasons.join('；'),inference:'綜合評分 '+dScore.baseScore+'/100',confidence:80},],
    intraday_validation_plan:intradayValidationPlan,
    invalidation_conditions:[{condition:'台股開盤與盤前方向相反超過 1%',meaning:'盤前判斷失效',required_adjustment:'以盤中即時資料重新評估'},{condition:'量能大幅萎縮',meaning:'市場參與度不足',required_adjustment:'降低部位，觀望為主'}],
    closing_feedback_plan:{what_to_check_after_close:'是否收在盤前判斷的方向',how_to_score_today:'比對 '+marketBias+' 與實際收盤方向',what_to_adjust_tomorrow:'根據今日驗證結果調整明日信心權重'},
    renewal_value_block:renewalValueBlock,
    content_quality_flags:{real_data:true,deterministic:true,no_ai_hallucination:true,dynamic_beneficiary:true,sector_driven:sectorData.length>0},
    content_publish_gate:{overall_status:'可公開',blocking_issues:[]},
    source_breakdown:{market_data_count:md.length,news_count:newsData.length,sector_rotation_rows:sectorData.length},
    line_push_copy:buildGuardedLinePushCopy(todayDate,marketBias,confidenceScore,md,applyBiasGuardrails(md,dScore.baseScore))
  };
}

async function callOpenAI(systemPrompt:string,userPrompt:string,apiKey:string,log:(m:string)=>void):Promise<Record<string,unknown>|null>{
  try{log('OPENAI_START');const start=Date.now();const res=await fetchWithTimeout('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],temperature:0.4,max_tokens:4000,response_format:{type:'json_object'}})},30000,'openai_chat_completions',log);const elapsed=Date.now()-start;log('OPENAI_DONE elapsed_ms='+elapsed+' has_response='+(!!res));if(!res){log('OPENAI_TIMEOUT_DEGRADED');return null}if(!res.ok){log('OPENAI_FAILED:HTTP_'+res.status);return null}const j:Record<string,unknown>=await res.json();const content=j.choices?.[0]?.message?.content;if(typeof content==='string'){try{return JSON.parse(content)}catch{log('OPENAI_PARSE_FAIL');return null}}log('OPENAI_NO_CONTENT');return null}catch(e){log('OPENAI_EXCEPTION:'+(e instanceof Error?e.message:String(e)));return null}
}
function buildOpenAISystemPrompt():string{return'你是 Morning Alpha 的盤前研究員，不是新聞摘要機器。根據提供的真實市場數據產出完整 JSON。只輸出 JSON，不輸出 markdown，不輸出 JSON 外的自然語言，不新增 root 欄位，不改既有欄位名稱，不移除既有必要欄位。受惠股欄位只能解釋 allowed_beneficiary_candidates 中已由 scoring engine 排序的候選股，不得新增候選池以外股票，不得改變候選排序，不得自行推薦股票。所有段落都必須回答「所以呢？」與「投資人接下來看什麼？」。禁止使用「可能」「或許」「留意」「關注」等空泛文字，改用具體變數、價位方向、族群同步性、成交量、匯率、期貨、ADR、原物料或新聞催化。必須同時輸出 member_research_note 舊純文字相容欄位，以及 member_research_note_v2 結構化會員研究筆記。member_research_note 目標 600-900 字，提高內容密度，不要用背景介紹灌字數；第一段禁止背景介紹，第一段直接回答：今天如果只能看一件事，投資人最應該看什麼；第二段回答為什麼；第三段說市場如何驗證；第四段說什麼情況代表判斷錯誤；第五段說明天需要追蹤什麼。member_research_note 不可拿 summary、free_summary、today_summary 改寫充數。member_research_note_v2 必須包含 overnight_chain、taiwan_impact_map、beneficiary_candidates、intraday_validation、invalidation_rules、closing_feedback_plan、subscriber_value_sentence、data_status，保留既有 schema 不刪欄位。beneficiary_stocks 與 today_beneficiary_stocks 每檔必須包含 symbol、name、sector、reason、trigger_event、watch_point、risk_note、confidence_level、data_basis；today_beneficiary_stocks 必須輸出 5 到 8 檔，beneficiary_stocks 最多輸出 10 檔；不要為了湊數加入低信心或資料不足的股票，若真實資料不足，寧可少於上限，也不可補假資料。confidence_level 只可用 High、Medium、Low。每檔必須寫出催化來源、傳導路徑、公司受惠原因與反向風險：催化來源例如 NVIDIA 上漲、美國能源政策、原油大漲、美元走弱；傳導路徑必須是事件 → 產業 → 供應鏈 → 公司；公司受惠原因必須連到公司產品、公司客戶或公司營收來源，不可只寫因需求增加。每檔受惠股的 reason、trigger_reason、causal_chain 說明需控制在 1 到 2 句，必須具體，但不要寫成長篇文章。禁止把「AI受惠」「半導體受惠」「科技股受惠」當成完整答案，不可只寫「AI概念股受惠」或只列產業。不可自由生成未提供、未在 allowed_beneficiary_candidates、或未由資料支撐的股票；資料不足時不可硬湊，應降低 data_status 為 partial 或 insufficient。member_research_note_v2 語氣要像研究員晨會筆記：overnight_chain 必須寫出海外事件 → 資金流向 → 美股族群 → 供應鏈 → 台股族群 → 代表個股，至少 5 層，每一層都要回答為什麼；taiwan_impact_map.why_it_matters 必須說明傳導機制，不可只列產業；beneficiary_candidates 每檔 evidence 必須引用 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks；invalidation_rules 必須具體可觀察；subscriber_value_sentence 要像今天的研究員結論，不是產品行銷文。War Room 相關內容不要重複首頁摘要，只能寫入既有欄位 intraday_validation、intraday_validation_plan、invalidation_rules、closing_feedback_plan，要提供開盤觀察重點、盤中驗證指標、失敗訊號、應變方案；禁止新增任何 root 欄位，例如 war_room、war_room_plan、trading_plan、market_plan、execution_plan，也禁止新增任何前端尚未支援的新 root 欄位。today_quote 必須指出今天真正看的變數，不可空泛，不可保證獲利，不可使用買進、賣出、加碼、減碼等命令，語氣清楚、有人味，但不要像誇張社群標題。另必須輸出 V8 三欄位：v8_beneficiary_chain、v8_overnight_causal_chain、v8_daily_sentence；資料不足也要輸出 status="insufficient" 的安全結構。v8_beneficiary_chain 的 beneficiaries 只能使用提供資料或既有受惠股中的台股 symbol，不可自由生成股票；每檔必須有 symbol、name、sector、reason_chain、confidence_score、risk_level、invalidation_condition；reason_chain 至少 3 層，且必須包含催化來源 → 供應鏈傳導 → 公司產品/客戶/營收連結。v8_overnight_causal_chain 每條 causal_steps 至少 5 層，從海外事件傳導到資金流向、美股族群、供應鏈、台股族群與代表個股，watch_points 必須可盤中驗證。v8_daily_sentence 不可空泛，不可使用「市場仍有不確定性」「投資人應謹慎」「關注後續變化」「後續仍需觀察」，不可出現買進、賣出、加碼、減碼等命令，不可保證獲利。推理鏈必須是：隔夜事件 → 台股族群 → 個股 → 盤中驗證 → 失效條件。beneficiary_candidates 只能解釋 allowed_beneficiary_candidates 中的候選股，目標最多 8 到 15 檔但禁止硬湊；每檔必須有 reason、evidence、risk、confidence，evidence 只能來自提供的 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks。today_beneficiary_stocks 只可輸出台股個股。方向只可用：偏多觀察、中性偏多、震盪觀察、偏弱觀察、高風險日。';}
function safeOpenAIMarketDataLine(m:MarketIndicator):string{
  const sym=m.symbol.toUpperCase();const pct=(m.changePercent>=0?'+':'')+m.changePercent.toFixed(2)+'%';const meta=[m.name,m.market,m.status,(m as unknown as Record<string,unknown>).source,(m as unknown as Record<string,unknown>).raw_source].map(function(v){return String(v||'').toLowerCase();}).join(' ');
  const isProxy=meta.includes('proxy')||meta.includes('代理')||meta.includes('vxx');
  if(sym==='DXY'||sym==='USDINDEX')return m.symbol+' | 美元指數代理指標 | 變動='+pct+' | 注意：proxy，不是美元指數實際 level';
  if(sym==='US10Y'||sym==='TNX'||sym==='T10Y')return m.symbol+' | 美國10年期債券代理指標 | 變動='+pct+' | 注意：proxy，不是實際殖利率';
  if((sym==='VIX'||sym==='VIXINDEX')&&isProxy)return m.symbol+' | 恐慌指數代理指標 | 變動='+pct+' | 注意：proxy，不是真實 VIX level';
  return m.symbol+' | '+m.name+' | 值='+m.value+' | 變動='+pct+(isProxy?' | 注意：proxy，value 不代表真實指數 level':'');
}
function buildOpenAIUserPrompt(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string},sectorContextSummary:string,allowedCandidateRows:Record<string,unknown>[]=[]):string{
  const mdLines=md.map(safeOpenAIMarketDataLine).join('\n');
  const newsLines=newsData.slice(0,12).map(function(n){return n.title+' | '+(n.taiwan_impact_summary||'')}).join('\n');
  const allowedCandidateLines=allowedCandidateRows.map(function(row,idx){const r=row as Record<string,unknown>;return String(idx+1)+'. '+String(r.symbol??r.stock_id??'')+' '+String(r.name??r.stock_name??'')+' | '+String(r.sector??r.category??'')+' | level='+String(r.beneficiary_level??'')+' | reason='+String(r.reason??'')+' | data_basis='+String(r.data_basis??'');}).join('\n');
  return'今日日期：'+todayDate+'\n台股基準：'+dates.twCoreDate+'\n海外基準：'+dates.usGlobalDate+'\n\n產業輪動（sector_rotation_scores）：'+(sectorContextSummary||'無')+'\n\nallowed_beneficiary_candidates（已由 scoring engine 排序，OpenAI 只能解釋，不可新增或改排序）：\n'+(allowedCandidateLines||'無候選；資料不足時受惠股欄位應保持空陣列或 partial/insufficient')+'\n\n市場資料說明：若市場資料標示為 proxy / 代理指標，只能使用變動百分比，不得把 value 寫成實際指數、實際殖利率或實際價格。\n\n市場數據（market_data）：\n'+mdLines+'\n\n市場新聞（market_news）：\n'+(newsLines||'無')+'\n\n請產生今日盤前報告 JSON。只輸出 JSON，不輸出 markdown，不輸出 JSON 外的自然語言，不新增 root 欄位，不改既有欄位名稱，不移除既有必要欄位。所有輸出都要具體回答「所以呢？」與「投資人接下來看什麼？」禁止使用「可能」「或許」「留意」「關注」等空泛詞。member_research_note 是 600-900 字純文字相容欄位；提高內容密度，不要用背景介紹灌字數；第一段不可背景介紹，直接回答今天如果只能看一件事，投資人最應該看什麼；第二段回答為什麼；第三段說市場如何驗證；第四段說什麼情況代表判斷錯誤；第五段說明天需要追蹤什麼。member_research_note_v2 是結構化物件，schema: {overnight_chain:[{event,source_market,impact_logic,taiwan_mapping,confidence}], taiwan_impact_map:[{sector,why_it_matters,affected_stocks,sensitivity,invalidation}], beneficiary_candidates:[{stock_code,stock_name,sector,reason,evidence,risk,confidence}], intraday_validation:[{time_window,what_to_watch,bullish_confirm,bearish_fail,neutral_condition}], invalidation_rules:[{condition,meaning,action_note}], closing_feedback_plan:{what_to_compare,success_criteria,miss_reason_tracking}, subscriber_value_sentence, data_status}. beneficiary_stocks 與 today_beneficiary_stocks 只能從 allowed_beneficiary_candidates 依原排序選取與解釋，不得新增候選池以外股票，不得改變排序；每檔欄位必須包含 symbol、name、sector、reason、trigger_event、watch_point、risk_note、confidence_level、data_basis；today_beneficiary_stocks 最多輸出 5 到 8 檔，beneficiary_stocks 最多輸出 10 檔；不要為了湊數加入低信心或資料不足的股票，若 allowed_beneficiary_candidates 為空或真實資料不足，寧可少於上限或空陣列，也不可補假資料。confidence_level 只可用 High、Medium、Low。trigger_event 是催化來源，例如 NVIDIA 上漲、能源政策、原油價格、美元或美債變化；reason 必須包含事件 → 產業 → 供應鏈 → 公司，且說明公司產品、公司客戶或公司營收來源如何連到該事件；reason、trigger_reason、causal_chain 說明需控制在 1 到 2 句，必須具體，但不要寫成長篇文章；禁止「AI受惠」「半導體受惠」「科技股受惠」這類泛化答案。watch_point 要是盤中可驗證指標；risk_note 要說明什麼情況讓判斷失效；data_basis 要列出使用的資料來源名稱，例如 market_data.NVDA.change_percent、sector_rotation_scores.半導體、market_news.title 或 existing_beneficiary_stock。member_research_note_v2 要像研究員晨會筆記，不要像新聞摘要：overnight_chain 至少 5 層，格式為海外事件 → 資金流向 → 美股族群 → 供應鏈 → 台股族群 → 代表個股，每一層都要說明為什麼；taiwan_impact_map.why_it_matters 要說明為何影響台股；beneficiary_candidates.evidence 必須引用 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks；invalidation_rules 必須具體可觀察；subscriber_value_sentence 是今天的研究員結論，不是產品行銷文。War Room 相關內容不要重複首頁，只能寫入既有欄位 intraday_validation、intraday_validation_plan、invalidation_rules、closing_feedback_plan，要提供開盤觀察重點、盤中驗證指標、失敗訊號、應變方案；禁止新增任何 root 欄位，例如 war_room、war_room_plan、trading_plan、market_plan、execution_plan，也禁止新增任何前端尚未支援的新 root 欄位。today_quote 必須指出今天真正看的變數，不可使用空泛句，不可保證獲利，不可使用買進、賣出、加碼、減碼等命令。V8 schema 必填：v8_beneficiary_chain={status,source_signals,beneficiaries:[{symbol,name,sector,reason_chain,confidence_score,risk_level,invalidation_condition}]}; v8_overnight_causal_chain={status,chains:[{theme,event,causal_steps,taiwan_impact,affected_sectors,watch_points,invalidation_condition}]}; v8_daily_sentence={status,sentence,logic_source,tone:"clear, sharp, human-readable"}。v8_overnight_causal_chain.causal_steps 至少 5 層，必須從海外事件一路傳導到代表個股。不可把 summary/free_summary 當會員筆記，不可編造未在資料或既有受惠股中有支撐的股票；資料不足時保留空陣列並將 data_status 或 status 設為 partial/insufficient，不可硬湊。';
}

async function writeReport(supabase:ReturnType<typeof createClient>,todayDate:string,aiStrategyJson:Record<string,unknown>,marketBias:string,rawConfidenceScore:number|null,reportMode:string,md:MarketIndicator[],log:(m:string)=>void,tdInfo?:TradingDayInfo):Promise<{reportId:string}|null>{
  try{
    const tradingDayInfo=tdInfo||getTaiwanTradingDayInfo(todayDate);
    aiStrategyJson={...aiStrategyJson,is_trading_day:tradingDayInfo.is_trading_day,market_closed:tradingDayInfo.market_closed,holiday_name:tradingDayInfo.holiday_name,trading_day_reason:tradingDayInfo.reason,market_status:tradingDayInfo.is_trading_day?'OPEN':tradingDayInfo.reason,session_type:tradingDayInfo.session_type||'FULL_DAY',market_message:tradingDayInfo.market_message||(tradingDayInfo.is_trading_day?'今天正常交易。':'今日沒有台股交易，Morning Alpha 已切換休市模式。'),next_trading_day:tradingDayInfo.next_trading_day||todayDate};
    log('[writeReport] trading day flags merged: is_trading_day='+tradingDayInfo.is_trading_day+' market_closed='+tradingDayInfo.market_closed+' holiday_name='+tradingDayInfo.holiday_name+' reason='+tradingDayInfo.reason);

    const fs=aiStrategyJson.free_summary as Record<string,unknown>||{};
    const mrnRaw=aiStrategyJson.member_research_note;const mrnIsString=typeof mrnRaw==='string';
    const mrn=mrnIsString?{}:(mrnRaw as Record<string,unknown>||{});
    const eb=mrnIsString?{}:((mrn as Record<string,unknown>)?.executive_brief as Record<string,unknown>||{});
    const confScore=rawConfidenceScore===null?null:safeInteger(rawConfidenceScore,50);
    const sentimentScore=safeInteger(aiStrategyJson.sentiment_score??confScore,50);
    const qualityScore=safeInteger(aiStrategyJson.quality_score??75,75);
    const memberValueScore=safeInteger(aiStrategyJson.member_value_score??70,70);
    const fearGreedRaw=aiStrategyJson.fear_greed??dScoreFromAI(aiStrategyJson);
    const fearGreed=safeInteger(fearGreedRaw,50);
    const marketNumerics=extractMarketNumericPayload(md);
    const avoidTodayRaw=String(fs.do_not_do||'');const avoidToday=avoidTodayRaw.split('。').filter(function(s){return s.trim()});

    const todayBS=Array.isArray(aiStrategyJson.today_beneficiary_stocks)?aiStrategyJson.today_beneficiary_stocks as Record<string,unknown>[]:[];
    const fullBS=Array.isArray(aiStrategyJson.beneficiary_stocks)?aiStrategyJson.beneficiary_stocks as Record<string,unknown>[]:[];
    const emptyFallback:Record<string,unknown>[]=[];
    aiStrategyJson.today_beneficiary_stocks=finalSanitizeTWStocks(todayBS,emptyFallback,'WRITE_GATE_TODAY',log);
    aiStrategyJson.beneficiary_stocks=finalSanitizeTWStocks(fullBS,emptyFallback,'WRITE_GATE_FULL',log);

    const todayQuote=mrnIsString?(confScore===null?marketBias+'，基準日期 '+todayDate:marketBias+'，信心 '+confScore+'/100，基準日期 '+todayDate):String(eb?.one_line||'');
    const riskReason=mrnIsString?String(fs.one_sentence||''):String(mrn?.risk_notes||'');
    const sentimentReason=mrnIsString?(confScore===null?marketBias+'方向，休市不評分。':marketBias+'方向，信心分數 '+confScore+'/100。'):String(mrn?.executive_view||'');
    const aiConfidenceReason=mrnIsString?'根據 '+todayDate+' 市場數據，盤前方向為 '+marketBias+'。':String(mrn?.main_thesis||'');

    const insertPayload:Record<string,unknown>={
      report_date:todayDate,market_bias:marketBias,confidence_score:confScore,
      confidence_label:confScore===null?'休市不評分':confScore>=75?'高':confScore>=55?'中':'低',
      sentiment_score:sentimentScore,sentiment_label:sentimentScore>=75?'高':sentimentScore>=55?'中':'低',
      fear_greed:fearGreed,ai_strategy_json:aiStrategyJson,raw_ai_json:aiStrategyJson,
      summary:String(fs.one_sentence||''),today_summary:String(fs.one_sentence||''),
      today_quote:todayQuote,report_mode:reportMode,data_time_basis:'captured_at',
      risk_reason:riskReason,sentiment_reason:sentimentReason,ai_confidence_reason:aiConfidenceReason,
      ai_retail_reminder:'盤前判斷僅供參考，實際操作以開盤後市場走勢為準。',
      avoid_today:avoidToday,...marketNumerics,
    };
    const r=await supabase.from('reports').upsert(insertPayload,{onConflict:'report_date'}).select('id').single();
    const{data,error}=safeUnwrap<{id:string}>(r,log,'writeReport');
    if(error||!data?.id){log('writeReport FAIL: '+(error||'no id'));return null}
    log('writeReport OK: '+data.id);return{reportId:data.id};
  }catch(e){log('writeReport exc: '+(e instanceof Error?e.message:String(e)));return null}
}

function dScoreFromAI(aiJson:Record<string,unknown>):number{const fg=aiJson.fear_greed;if(fg!==null&&fg!==undefined)return Number(fg);const bs=aiJson.baseScore??aiJson.base_score??aiJson.confidence_score;if(bs!==null&&bs!==undefined){const n=Number(bs);if(!Number.isNaN(n))return n>50?25:n;}return 50;}
async function verifyReportExists(supabase:ReturnType<typeof createClient>,todayDate:string,log:(m:string)=>void):Promise<{reportId:string;aiJson:Record<string,unknown>|null}|null>{
  try{const r=await supabase.from('reports').select('id,report_date,ai_strategy_json').eq('report_date',todayDate).maybeSingle();const{data,error}=safeUnwrap<Record<string,unknown>>(r,log,'verify');if(error||!data)return null;return{reportId:String(data.id||''),aiJson:data.ai_strategy_json as Record<string,unknown>|null}}catch(e){log('verify exc: '+(e instanceof Error?e.message:String(e)));return null}
}

function buildSectorRotationStatus(todayDate:string,scoreDate:string,sectorData:SectorRotationRow[],marketData:MarketIndicator[]):Record<string,unknown>{
  if(sectorData.length>0){return{score_date:scoreDate,status:'ready',source:'sector_rotation_scores',row_count:sectorData.length,is_today:scoreDate===todayDate,warning:scoreDate===todayDate?'今日類股輪動資料已產生':'目前使用上一交易日類股輪動作為盤前參考，今日類股輪動資料尚未產生。'};}
  if(marketData.length>0){return{score_date:todayDate,status:'partial',source:'fallback_from_market_data',row_count:0,is_today:false,warning:'今日類股輪動資料尚未產生；僅能以既有 market_data 做保守觀察，不產生正式類股分數。'};}
  return{score_date:todayDate,status:'missing',source:'missing',row_count:0,is_today:false,warning:'今日類股輪動資料尚未產生，且缺少可用 market_data。'};
}

function getTaipeiMinutesNow():number{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour12:false,hour:'2-digit',minute:'2-digit'}).formatToParts(new Date());const h=Number(parts.find((p)=>p.type==='hour')?.value||0);const m=Number(parts.find((p)=>p.type==='minute')?.value||0);return h*60+m;}
function buildIntradaySyncStatus(todayDate:string):Record<string,unknown>{
  const minutes=getTaipeiMinutesNow();
  const windowStatus=(target:number)=>minutes<target?'pending':'missing';
  return{report_date:todayDate,last_checked_at:new Date().toISOString(),windows:{'0930':windowStatus(570),'1030':windowStatus(630),'1300':windowStatus(780)},warning:minutes<570?'等待 09:30 第一段盤中資料':minutes<630?'09:30 盤中資料尚未同步':minutes<780?'10:30 資料尚未同步；13:00 尚未到時間窗':'13:00 盤中資料尚未同步，等待收盤資料或盤中同步補齊。'};
}

Deno.serve(async (req:Request)=>{
  const reqStart=Date.now();const logs:string[]=[];const log=function(m:string){const ts=new Date().toISOString().slice(11,19);logs.push('['+ts+'] '+m);console.log('[V9.0:'+ts+'] '+m)};
  const timer=createStepTimer(log);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS_HEADERS});
  if(req.method!=='POST')return corsResponse({success:false,error:'Only POST allowed',version:VERSION},405);

  try{
    const cronSecret=req.headers.get('x-cron-secret');const expectedSecret=Deno.env.get('CRON_SECRET');
    if(!expectedSecret){log('NO_CRON_SECRET');return corsResponse({success:false,error:'CRON_SECRET not set',version:VERSION},500)}
    if(cronSecret!==expectedSecret){log('INVALID_CRON_SECRET');return corsResponse({success:false,error:'Unauthorized',version:VERSION},401)}

    let body:Record<string,unknown>={};try{body=await req.json()}catch{log('BODY_PARSE_FAILED')}
    const skipOpenAI=body?.skip_openai===true||body?.fast_mode===true;
    const runV10DebugAgents=body?.run_v10_debug_agents===true||body?.debug_agents===true;
    log('START V9.0 skip_openai='+skipOpenAI+' run_v10_debug_agents='+runV10DebugAgents);
    timer.mark('START');

    const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!supabaseUrl||!serviceRoleKey){log('NO_SUPABASE_CREDS');return corsResponse({success:false,error:'Supabase credentials missing',version:VERSION},500)}
    const supabase=createClient(supabaseUrl,serviceRoleKey,{auth:{autoRefreshToken:false,persistSession:false}});
    timer.mark('SUPABASE_CLIENT_READY');

    const todayDate=getTaipeiDateString();const dow=getTaipeiDayOfWeek();log('TODAY='+todayDate+' DOW='+dow);
    const tradingDayInfo=getTaiwanTradingDayInfo(todayDate);
    log('TRADING_DAY_CHECK: is_trading_day='+tradingDayInfo.is_trading_day+' market_closed='+tradingDayInfo.market_closed+' holiday_name='+tradingDayInfo.holiday_name+' reason='+tradingDayInfo.reason);
    timer.mark('TRADING_DAY_CHECK');

    if(!tradingDayInfo.is_trading_day){
      log('NON_TRADING_DAY: '+(tradingDayInfo.holiday_name||'休市'));
      const marketClosedReport=buildMarketClosedReport(todayDate,tradingDayInfo);
      attachResearchMasterV2Shadow(marketClosedReport,{reportDate:todayDate,todayDate,dataAsOf:null,engineVersion:VERSION,promptVersion:null,generatedAt:String(marketClosedReport.generated_at||''),reportMode:REPORT_MODE_NON_TRADING,marketStatus:'CLOSED',isTradingDay:false,legacy:marketClosedReport,evidencePack:{},normalizedEvidence:{},evidenceIndex:[],candidateUniverse:{},marketThesis:null},log);
      timer.mark('MARKET_CLOSED_REPORT_BUILT');
      const writeResult=await writeReport(supabase,todayDate,marketClosedReport,'休市',null,REPORT_MODE_NON_TRADING,[],log,tradingDayInfo);
      timer.mark('MARKET_CLOSED_REPORT_WRITTEN');
      if(!writeResult?.reportId){log('WRITE_FAILED_MARKET_CLOSED');return corsResponse({success:false,error:'Failed to write market closed report',report_date:todayDate,version:VERSION,logs},500);}
      const verified=await verifyReportExists(supabase,todayDate,log);
      timer.mark('MARKET_CLOSED_REPORT_VERIFIED');
      const durationMs=Date.now()-reqStart;log('DONE_MARKET_CLOSED report_id='+writeResult.reportId+' duration='+durationMs+'ms');
      return corsResponse({success:true,message:'Market closed',report_date:todayDate,report_id:writeResult.reportId,is_trading_day:false,market_closed:true,holiday_name:tradingDayInfo.holiday_name,market_bias:'休市',confidence_score:null,report_mode:REPORT_MODE_NON_TRADING,duration_ms:durationMs,version:VERSION,logs},200);
    }

    log('TRADING_DAY');
    const sectorRotationReferenceDate=getPreviousTaiwanTradingDay(todayDate);log('SECTOR_ROTATION reference_date='+sectorRotationReferenceDate+' basis=previous_trading_day');
    const rawDatesFetch=(async function(){try{const rr=await supabase.from('market_data').select('symbol,captured_at').order('captured_at',{ascending:false}).limit(30);const{data}=safeUnwrap<Record<string,unknown>[]>(rr,log,'rawForDates');return data||[];}catch{log('rawForDates fetch failed');return [] as Record<string,unknown>[];}})();
    const [marketSettled,newsSettled,sectorSettled,rawDatesSettled,previousReportSettled,recentReportsSettled]=await Promise.allSettled([
      withTimeout(fetchMarketData(supabase,log),5000,'market_data_query',log,{marketData:[],latestDataTime:null as Date|null,isStale:true,dataCount:0}),
      withTimeout(fetchMarketNews(supabase,log),3000,'market_news_query',log,{newsData:[],latestNewsTime:null,isStale:true,newsCount:0}),
      withTimeout(fetchSectorRotationForDate(supabase,sectorRotationReferenceDate,log),3000,'sector_rotation_query',log,[] as SectorRotationRow[]),
      withTimeout(rawDatesFetch,3000,'market_data_dates_query',log,[] as Record<string,unknown>[]),
      withTimeout(fetchPreviousReportForDate(supabase,sectorRotationReferenceDate,log),2500,'previous_report_query',log,null as Record<string,unknown>|null),
      withTimeout(fetchRecentReportsForV10Universe(supabase,todayDate,log),2500,'recent_reports_universe_query',log,[] as Record<string,unknown>[]),
    ]);
    const marketFetch=marketSettled.status==='fulfilled'?marketSettled.value:{marketData:[],latestDataTime:null as Date|null,isStale:true,dataCount:0};
    const newsFetch=newsSettled.status==='fulfilled'?newsSettled.value:{newsData:[],latestNewsTime:null,isStale:true,newsCount:0};
    const sectorData=sectorSettled.status==='fulfilled'?sectorSettled.value:[];
    const rawDataForDates=rawDatesSettled.status==='fulfilled'?rawDatesSettled.value:[];const previousReport=previousReportSettled.status==='fulfilled'?previousReportSettled.value:null;const recentReportsForUniverse=recentReportsSettled.status==='fulfilled'?recentReportsSettled.value:[];
    const marketData=marketFetch.marketData;const dataCount=marketFetch.dataCount;const newsData=newsFetch.newsData;
    const staleCoreSources=detectStaleCoreMarketData(marketData);const unavailableSources=detectUnavailableMarketData(marketData);
    const missingSources:string[]=[];if(dataCount===0)missingSources.push('market_data');if(newsData.length===0)missingSources.push('market_news');if(sectorData.length===0)missingSources.push('sector_rotation_scores:'+sectorRotationReferenceDate);if(rawDataForDates.length===0)missingSources.push('market_data_dates');for(const stale of staleCoreSources)missingSources.push('stale_market_data:'+stale);for(const unavailable of unavailableSources)missingSources.push('unavailable_market_data:'+unavailable);
    const dataQuality=missingSources.length===0?'complete':'degraded';
    log('MARKET_DATA count='+dataCount);log('NEWS count='+newsData.length);log('SECTOR_ROTATION rows='+sectorData.length);log('DATA_QUALITY '+dataQuality+' missing_sources='+(missingSources.join(',')||'none'));
    timer.mark('PARALLEL_DATA_FETCH_DONE','data_quality='+dataQuality);
    const hasMarketData=dataCount>0;const reportMode=determineReportMode(dow,hasMarketData,dataCount);
    if(sectorData.length===0)log('SECTOR_ROTATION_MISSING reference_date='+sectorRotationReferenceDate+'; continuing without fallback to today');

    const dates=computeDatesFromMarketData(rawDataForDates);log('DATES tw_core='+dates.twCoreDate+' us_global='+dates.usGlobalDate);

    let dScore=calculateMarketDataScore(marketData);const guardrailPreview=applyBiasGuardrails(marketData,dScore.baseScore);if(guardrailPreview.shouldDowngrade){log('BIAS_GUARDRAIL adjusted_score='+guardrailPreview.adjustedScore+' risk='+(guardrailPreview.riskSignals.join('|')||'none')+' stale='+(guardrailPreview.staleSignals.join('|')||'none'));dScore={...dScore,baseScore:guardrailPreview.adjustedScore,riskReasons:Array.from(new Set([...dScore.riskReasons,...guardrailPreview.riskSignals,...guardrailPreview.staleSignals])),details:{...dScore.details,bias_guardrail_original_score:dScore.baseScore,bias_guardrail_adjusted_score:guardrailPreview.adjustedScore}};}const twStatus=checkTWCoreStatus(marketData,log);const mvpStatus=checkMVPStatus(marketData,log);
    log('SCORE='+dScore.baseScore+' BIAS='+classifyMarketBias(dScore.baseScore));
    timer.mark('MARKET_SCORING_DONE');
    let confidenceResult=calculateReportConfidenceScore({marketData,newsData,sectorData,dates,dataQuality,missingSources,openAIUsed:false});
    log('CONFIDENCE_SCORE='+confidenceResult.score+' MARKET_BIAS_SCORE='+dScore.baseScore);

    const deterministicJson=buildDeterministicAIStrategyJson(marketData,newsData,todayDate,dates,dScore,twStatus,mvpStatus,reportMode,sectorData,log,confidenceResult);
    timer.mark('DETERMINISTIC_REPORT_BUILT');
    const marketBiasDet=classifyMarketBias(dScore.baseScore);const confScoreDet=confidenceResult.score;
    const detMemberNoteText=typeof deterministicJson.member_research_note==='string'?String(deterministicJson.member_research_note):buildMemberResearchNoteText(marketData,todayDate,dates,dScore,marketBiasDet,confScoreDet,Array.isArray(deterministicJson.today_beneficiary_stocks)?deterministicJson.today_beneficiary_stocks as Record<string,unknown>[]:[],reportMode,log);
    const detMemberNoteV2=deterministicJson.member_research_note_v2 as MemberResearchNoteV2;
    const safeV8Fallback=buildV8InsufficientContract();

    let aiStrategyJson:Record<string,unknown>;
    if(skipOpenAI){
      log('FAST_MODE');aiStrategyJson=deterministicJson;aiStrategyJson.openai_used=false;aiStrategyJson.build_method='deterministic_three_tier';
    }else{
      const openAiKey=Deno.env.get('OPENAI_API_KEY')||'';
      if(openAiKey){
        log('OPENAI_MODE');
        const strongSectors=sectorData.filter(isStrongSectorRotation).slice(0,3);
        const sectorContextSummary=strongSectors.length>0?strongSectors.map(function(s){return s.sector+'(輪動分數='+s.rotation_score+')'}).join('；'):'上一交易日類股輪動資料缺失或無強勢族群';
        const allowedCandidateRows=[...((Array.isArray(deterministicJson.today_beneficiary_stocks)?deterministicJson.today_beneficiary_stocks:[]) as Record<string,unknown>[]),...((Array.isArray(deterministicJson.beneficiary_stocks)?deterministicJson.beneficiary_stocks:[]) as Record<string,unknown>[])];
        const sysPrompt=buildOpenAISystemPrompt();const userPrompt=buildOpenAIUserPrompt(marketData,newsData,todayDate,dates,sectorContextSummary,allowedCandidateRows);
        const openAiResult=await callOpenAI(sysPrompt,userPrompt,openAiKey,log);
        timer.mark('OPENAI_STEP_DONE');
        if(openAiResult){
          log('OPENAI_RESULT_RECEIVED');
          confidenceResult=calculateReportConfidenceScore({marketData,newsData,sectorData,dates,dataQuality,missingSources,openAIUsed:true});
          openAiResult.confidence_score=confidenceResult.score;
          openAiResult.confidence_breakdown=confidenceResult.breakdown;
          openAiResult.market_bias_score=dScore.baseScore;
          const oaiTodayRaw=Array.isArray(openAiResult.today_beneficiary_stocks)?openAiResult.today_beneficiary_stocks as Record<string,unknown>[]:[];
          const oaiFullRaw=Array.isArray(openAiResult.beneficiary_stocks)?openAiResult.beneficiary_stocks as Record<string,unknown>[]:[];
          const oaiTodayTW=preFilterOpenaiTWStocks(oaiTodayRaw,log);const oaiFullTW=preFilterOpenaiTWStocks(oaiFullRaw,log);
          const sectorResult=buildThreeTierBeneficiaryStocks(marketData,sectorData,dScore,log);
          const dynMap=new Map<string,Record<string,unknown>>();
          for(const d of[...sectorResult.todayStocks,...sectorResult.fullStocks])dynMap.set(String(d.symbol||d.stock_id||''),d);
          const enrich=function(stocks:Record<string,unknown>[]):Record<string,unknown>[]{
            const enriched=stocks.map(function(s){const sym=String(s.symbol||s.stock_id||'');const dyn=dynMap.get(sym);const merged={...s};if(dyn){for(const f of['transmission_chain','validation_points','failure_conditions','conviction_level','score_reason','member_thesis','catalyst_type']){if((!merged[f]||(Array.isArray(merged[f])&&(merged[f] as unknown[]).length===0)||(typeof merged[f]==='string'&&String(merged[f]).trim().length<10))&&dyn[f]!==undefined)merged[f]=dyn[f];}if(!merged.sector_rotation_score&&dyn.sector_rotation_score)merged.sector_rotation_score=dyn.sector_rotation_score;if(!merged.source_type)merged.source_type='sector_rotation_driven';}return merged;});
            return enriched;
          };
          openAiResult.today_beneficiary_stocks=finalSanitizeTWStocks(mergeBeneficiaryStocks(enrich(oaiTodayTW),sectorResult.todayStocks,5),[],'openai-merge-today',log);
          openAiResult.beneficiary_stocks=finalSanitizeTWStocks(mergeBeneficiaryStocks(enrich(oaiFullTW),sectorResult.fullStocks,8),[],'openai-merge-full',log);
          const oaiMRN=openAiResult.member_research_note;
          if(typeof oaiMRN!=='string'||String(oaiMRN).trim().length<300){log('Overwriting OpenAI member_research_note');openAiResult.member_research_note=detMemberNoteText;}
          openAiResult.member_research_note_v2=sanitizeMemberResearchNoteV2(openAiResult.member_research_note_v2,detMemberNoteV2,log);
          let sanitizedV8=sanitizeV8ContractSafe(openAiResult,log);
          if(!v8ContractHasUsableData(sanitizedV8)){
            const bridgeV8=buildV8ContractFromMemberNoteV2(openAiResult.member_research_note_v2,openAiResult.beneficiary_stocks as Record<string,unknown>[],marketData,sectorData);
            if(v8ContractHasUsableData(bridgeV8)){log('V8_BRIDGE_FROM_MEMBER_NOTE_V2_OPENAI');sanitizedV8=bridgeV8;}
          }
          openAiResult.v8_beneficiary_chain=sanitizedV8.v8_beneficiary_chain;
          openAiResult.v8_overnight_causal_chain=sanitizedV8.v8_overnight_causal_chain;
          openAiResult.v8_daily_sentence=sanitizedV8.v8_daily_sentence;
          aiStrategyJson=openAiResult;aiStrategyJson.openai_used=true;aiStrategyJson.build_method='openai_with_three_tier';
        }else{log('OPENAI_FAILED');aiStrategyJson=deterministicJson;aiStrategyJson.openai_used=false;aiStrategyJson.build_method='deterministic_fallback_three_tier';}
      }else{log('NO_OPENAI_KEY');aiStrategyJson=deterministicJson;aiStrategyJson.openai_used=false;aiStrategyJson.build_method='deterministic_no_key_three_tier';}
    }
    timer.mark('AI_STRATEGY_SELECTED');

    if(!hasValidMemberResearchNoteV2Object(aiStrategyJson.member_research_note_v2)){
      log('[member_note_v2] final guard applied deterministic fallback');
      aiStrategyJson.member_research_note_v2=detMemberNoteV2;
    }
    aiStrategyJson=applyMemberResearchNoteV2Aliases(aiStrategyJson);
    let finalV8=hasCompleteV8Contract(aiStrategyJson)?sanitizeV8ContractSafe(aiStrategyJson,log):safeV8Fallback;
    if(!v8ContractHasUsableData(finalV8)){
      const bridgeV8=buildV8ContractFromMemberNoteV2(aiStrategyJson.member_research_note_v2,aiStrategyJson.beneficiary_stocks as Record<string,unknown>[],marketData,sectorData);
      if(v8ContractHasUsableData(bridgeV8)){log('V8_BRIDGE_FROM_MEMBER_NOTE_V2_FINAL_GUARD');finalV8=bridgeV8;}
    }
    aiStrategyJson.v8_beneficiary_chain=finalV8.v8_beneficiary_chain;
    aiStrategyJson.v8_overnight_causal_chain=finalV8.v8_overnight_causal_chain;
    aiStrategyJson.v8_daily_sentence=finalV8.v8_daily_sentence;
    aiStrategyJson=sanitizePremarketTemporalFields(aiStrategyJson);
    aiStrategyJson=applyMemberResearchNoteV2Aliases(aiStrategyJson);
    aiStrategyJson=limitBeneficiaryStockCounts(aiStrategyJson);
    aiStrategyJson=applyFinalBiasGuardrails(aiStrategyJson,todayDate,marketData,dScore,confidenceResult);
    aiStrategyJson.version=VERSION;aiStrategyJson.generated_at=new Date().toISOString();
    aiStrategyJson.tw_stock_filter_applied=true;aiStrategyJson.research_card_format=true;
    aiStrategyJson.fields_complete_guaranteed=true;aiStrategyJson.write_time_guarantee=true;aiStrategyJson.member_note_format='plain_text_and_v2';
    aiStrategyJson.sector_rotation_reference_date=sectorRotationReferenceDate;
    aiStrategyJson.sector_rotation_basis='previous_trading_day';
    aiStrategyJson.sector_rotation_rows=sectorData.length;
    aiStrategyJson.sector_rotation_data_status=sectorData.length>0?'available':'missing_previous_trading_day';
    aiStrategyJson.sector_rotation_status=buildSectorRotationStatus(todayDate,sectorRotationReferenceDate,sectorData,marketData);
    aiStrategyJson.intraday_sync_status=buildIntradaySyncStatus(todayDate);
    if(aiStrategyJson.market_bias_score===undefined)aiStrategyJson.market_bias_score=dScore.baseScore;
    if(aiStrategyJson.confidence_score===undefined)aiStrategyJson.confidence_score=confidenceResult.score;
    aiStrategyJson.confidence_breakdown=confidenceResult.breakdown;
    aiStrategyJson.data_quality=dataQuality;
    aiStrategyJson.missing_sources=missingSources;
    aiStrategyJson.performance_timing={total_before_write_ms:timer.total(),data_quality:dataQuality,missing_sources:missingSources};const v10EvidencePack=buildV10EvidencePack({todayDate,dates,tradingDayInfo,marketData,newsData,sectorData,previousReport,dataQuality,missingSources,staleCoreSources,unavailableSources,confidenceResult});const v10NormalizedEvidence=buildV10NormalizedEvidence(v10EvidencePack);const v10EvidenceIndex=buildEvidenceIndex(v10NormalizedEvidence);const v10CandidateUniverse=buildCandidateUniverse({normalizedEvidence:v10NormalizedEvidence,evidenceIndex:v10EvidenceIndex,recentReports:recentReportsForUniverse});const v10BeneficiaryPhase1=buildV10BeneficiaryPhase1(v10CandidateUniverse,v10EvidenceIndex);aiStrategyJson.today_beneficiary_stocks_v10=v10BeneficiaryPhase1.today_beneficiary_stocks_v10;aiStrategyJson.v10_observation_watchlist=v10BeneficiaryPhase1.observation_watchlist;aiStrategyJson.v10_risk_watchlist=v10BeneficiaryPhase1.risk_watchlist;aiStrategyJson.v10_beneficiary_enabled=true;aiStrategyJson.v10_candidate_count=v10BeneficiaryPhase1.candidate_count;aiStrategyJson.v10_data_quality_status=v10BeneficiaryPhase1.data_quality_status;if(v10BeneficiaryPhase1.warning)aiStrategyJson.v10_warning=v10BeneficiaryPhase1.warning;const v10EvaluationFramework=buildV10EvaluationFramework(v10EvidenceIndex);const v10EmptyDecisionContract=buildEmptyV10DecisionContract(v10EvidencePack);let v10MarketThesisDebug:{enabled:false;used_openai:boolean;market_thesis:V10MarketThesisContract|null;raw_response:Record<string,unknown>|null;error:string|null}={enabled:false,used_openai:false,market_thesis:null,raw_response:null,error:runV10DebugAgents?(skipOpenAI?'skip_openai_or_fast_mode':'not_run'):'debug_agents_skipped_for_cron'};if(runV10DebugAgents&&!skipOpenAI){v10MarketThesisDebug=await withTimeout(runV10MarketThesisAgentDebug({evidencePack:v10EvidencePack,normalizedEvidence:v10NormalizedEvidence,evidenceIndex:v10EvidenceIndex,marketContext:(v10NormalizedEvidence.market_context&&typeof v10NormalizedEvidence.market_context==='object'?v10NormalizedEvidence.market_context:{} ) as Record<string,unknown>,apiKey:Deno.env.get('OPENAI_API_KEY')||'',log}),10000,'v10_market_thesis_agent',log,v10MarketThesisDebug);}const v10MarketThesisValidation=buildV10MarketThesisValidation(v10MarketThesisDebug,v10EmptyDecisionContract,v10EvidenceIndex);let v10CandidateEvaluationDebug:{enabled:false;used_openai:boolean;candidate_count:number;evaluations:V10CandidateEvaluationRecord[];raw_response:Record<string,unknown>|null;error:string|null}={enabled:false,used_openai:false,candidate_count:Array.isArray(v10CandidateUniverse.candidates)?v10CandidateUniverse.candidates.length:0,evaluations:[],raw_response:null,error:runV10DebugAgents?(skipOpenAI?'skip_openai_or_fast_mode':'not_run'):'debug_agents_skipped_for_cron'};if(runV10DebugAgents&&!skipOpenAI){v10CandidateEvaluationDebug=await withTimeout(runV10CandidateEvaluationAgentDebug({marketThesis:v10MarketThesisDebug.market_thesis,candidateUniverse:v10CandidateUniverse,evidenceIndex:v10EvidenceIndex,evaluationFramework:v10EvaluationFramework,apiKey:Deno.env.get('OPENAI_API_KEY')||'',log}),10000,'v10_candidate_evaluation_agent',log,v10CandidateEvaluationDebug);}const v10CandidateEvaluationValidation=validateV10CandidateEvaluationRecords(v10CandidateEvaluationDebug.evaluations,v10CandidateUniverse,v10EvidenceIndex);const v10ScoreEngine=buildV10ScoreEngine(v10CandidateEvaluationDebug.evaluations,v10CandidateUniverse,v10EvaluationFramework);const v10CapitalFlowEngine=buildV10CapitalFlowEngineDebug({marketThesis:v10MarketThesisDebug.market_thesis,candidateUniverse:v10CandidateUniverse,scores:(Array.isArray(v10ScoreEngine.scores)?v10ScoreEngine.scores:[]) as V10CandidateScoreRecord[],evidenceIndex:v10EvidenceIndex});const v10ThesisCutoverValidation=validateV10MarketThesisCutover(v10MarketThesisDebug.market_thesis,v10EvidenceIndex);const v10ThesisSwitchLog=applyV10ThesisCutover(aiStrategyJson,v10MarketThesisDebug.market_thesis,v10ThesisCutoverValidation,V10_FEATURE_FLAGS);log('V10_SWITCH '+JSON.stringify(v10ThesisSwitchLog));aiStrategyJson.v10_analysis_debug={version:'V10_EVIDENCE_PACK_DEBUG',enabled:false,feature_flags:V10_FEATURE_FLAGS,debug_agents_blocking_cron:false,debug_agents_requested:runV10DebugAgents,switch_log:[v10ThesisSwitchLog],thesis_cutover_validation:v10ThesisCutoverValidation,evidence_pack:v10EvidencePack,normalized_evidence:v10NormalizedEvidence,evidence_index:v10EvidenceIndex,candidate_universe:v10CandidateUniverse,beneficiary_phase1:v10BeneficiaryPhase1,evaluation_framework:v10EvaluationFramework,candidate_evaluation:{enabled:false,used_openai:v10CandidateEvaluationDebug.used_openai,candidate_count:v10CandidateEvaluationDebug.candidate_count,evaluations:v10CandidateEvaluationDebug.evaluations,error:v10CandidateEvaluationDebug.error},candidate_evaluation_validation:{enabled:false,validation:v10CandidateEvaluationValidation},score_engine:v10ScoreEngine,capital_flow_engine:v10CapitalFlowEngine,decision_summary:buildV10DecisionSummaryDebug(v10MarketThesisDebug.market_thesis,(Array.isArray(v10ScoreEngine.scores)?v10ScoreEngine.scores:[]) as V10CandidateScoreRecord[],v10CandidateEvaluationDebug.evaluations,v10EvidenceIndex,(v10CapitalFlowEngine.chain&&typeof v10CapitalFlowEngine.chain==='object'?v10CapitalFlowEngine.chain:undefined) as V10CapitalFlowChain|undefined),agent_specification:buildV10AgentSpecification(),market_thesis:{enabled:false,used_openai:v10MarketThesisDebug.used_openai,market_thesis:v10MarketThesisDebug.market_thesis,error:v10MarketThesisDebug.error},market_thesis_validation:{enabled:false,validation:v10MarketThesisValidation},market_thesis_refinement:{enabled:false,input_sources:['evidence_pack','normalized_evidence','evidence_index','market_context'],confidence_inputs:v10MarketThesisDebug.market_thesis?.confidence_inputs??buildMarketThesisConfidenceInputs(v10EvidencePack,v10NormalizedEvidence,v10EvidenceIndex),alternative_hypotheses:v10MarketThesisDebug.market_thesis?.alternative_hypotheses??[],evidence_breakdown:v10MarketThesisDebug.market_thesis?.evidence_breakdown??buildV10EvidenceBreakdown(v10EvidenceIndex)},decision_contract_schema:{enabled:false,schema_version:'V10',contract:v10EmptyDecisionContract,validation:validateV10DecisionContract(v10EmptyDecisionContract)},evidence_reference_schema:{enabled:false,reference_shape:{evidence_id:'MD001',weight:0,purpose:'primary_support'},validation:validateEvidenceReferences(v10EmptyDecisionContract,v10EvidenceIndex)}};
    attachResearchMasterV2Shadow(aiStrategyJson,{reportDate:todayDate,todayDate,dataAsOf:marketFetch.latestDataTime?.toISOString()??newsFetch.latestNewsTime?.toISOString()??null,engineVersion:VERSION,promptVersion:null,generatedAt:String(aiStrategyJson.generated_at||''),reportMode,marketStatus:'OPEN',isTradingDay:true,legacy:aiStrategyJson,evidencePack:v10EvidencePack,normalizedEvidence:v10NormalizedEvidence,evidenceIndex:v10EvidenceIndex,candidateUniverse:v10CandidateUniverse,marketThesis:v10MarketThesisDebug.market_thesis},log);
    aiStrategyJson=limitBeneficiaryStockCounts(aiStrategyJson);
    timer.mark('FINAL_GUARDS_DONE');

    const marketBias=String(aiStrategyJson.market_bias||classifyMarketBias(dScore.baseScore));
    const confidenceRaw=Number(aiStrategyJson.confidence_score);
    const rawConfidenceScore=Number.isNaN(confidenceRaw)?confidenceResult.score:confidenceRaw;
    const writeResult=await writeReport(supabase,todayDate,aiStrategyJson,marketBias,rawConfidenceScore,reportMode,marketData,log,tradingDayInfo);
    timer.mark('REPORT_WRITTEN');
    if(!writeResult?.reportId){log('WRITE_FAILED');return corsResponse({success:false,error:'Failed to write report',report_date:todayDate,version:VERSION,logs},500);}

    const verified=await verifyReportExists(supabase,todayDate,log);
    timer.mark('REPORT_VERIFIED');
    if(!verified?.reportId){log('VERIFY_FAILED');return corsResponse({success:false,error:'Report written but verification failed',report_date:todayDate,report_id:writeResult.reportId,version:VERSION,logs},500);}

    const durationMs=Date.now()-reqStart;log('DONE report_id='+verified.reportId+' duration='+durationMs+'ms');
    return corsResponse({success:true,message:'Report generated (V9.0)',report_date:todayDate,report_id:verified.reportId,is_trading_day:tradingDayInfo.is_trading_day,market_closed:tradingDayInfo.market_closed,holiday_name:tradingDayInfo.holiday_name,tw_core_date:dates.twCoreDate,us_global_date:dates.usGlobalDate,source:String(aiStrategyJson.build_method||'deterministic'),market_bias:marketBias,confidence_score:safeInteger(rawConfidenceScore,50),report_mode:reportMode,duration_ms:durationMs,version:VERSION,logs},200);
  }catch(err){const msg=err instanceof Error?err.message:String(err);log('FATAL: '+msg);return corsResponse({success:false,error:msg,version:VERSION,logs},500)}
});
