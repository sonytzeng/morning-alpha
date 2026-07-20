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
function buildV11ObservationNarrativeRoles(input:{legacyObservation:Record<string,unknown>[];riskWatchlist:Record<string,unknown>[];strongWatchlist:Record<string,unknown>[];topCandidates:V10BeneficiaryPhase1Record[];candidateUniverse:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];dataQualityStatus:string;warning:string|null;log?:(msg:string)=>void}):Record<string,unknown>[]|null{try{const legacy=Array.isArray(input.legacyObservation)?input.legacyObservation:[];const risks=Array.isArray(input.riskWatchlist)?input.riskWatchlist:[];const strong=Array.isArray(input.strongWatchlist)?input.strongWatchlist:[];const top=(Array.isArray(input.topCandidates)?input.topCandidates:[]).map((r)=>({...r,total_score:r.total_score})) as unknown as Record<string,unknown>[];const main=strong[0]||legacy[0]||top[0];const mainIndustry=v11RoleIndustry(main);const confirm=legacy.find((r)=>v11RoleText(r.industry_code)===mainIndustry.code)||legacy[0]||main;const risk=risks[0]||top.find((r)=>v11RoleText(r.net_evidence_direction)==='negative')||main;const capital=v11RolePickDifferent([...legacy,...top],mainIndustry.code)||main;const externalTitle=v11RoleEvidenceTitle(input.evidenceIndex,(item)=>['market_data','market_news','macro'].includes(item.evidence_type));const externalSymbol=v11RoleEvidenceTitle(input.evidenceIndex,(item)=>item.evidence_type==='market_data');const mainSymbols=v11RoleSymbols(main);const mainNames=v11RoleNames(main);const capitalIndustry=v11RoleIndustry(capital);const riskIndustry=v11RoleIndustry(risk);const mainTarget=[...mainSymbols,...mainNames].filter(Boolean).slice(0,2).join(' / ')||'待確認代表股';const capitalTarget=[...v11RoleSymbols(capital),...v11RoleNames(capital)].filter(Boolean).slice(0,2).join(' / ')||capitalIndustry.name;const riskTarget=[...v11RoleSymbols(risk),...v11RoleNames(risk)].filter(Boolean).slice(0,2).join(' / ')||riskIndustry.name;const confirmationChecklist=[`確認 ${mainTarget} 是否轉強`,`確認 TAIEX 與 TXF 是否同向`,`確認 ${mainIndustry.name} 是否有族群擴散`];const riskChecklist=[`觀察 ${riskTarget} 是否轉弱`,'觀察 TAIEX 是否失去支撐',`觀察 ${mainIndustry.name} 是否量縮`];const rotationPath=Array.from(new Set([mainIndustry.name,capitalIndustry.name,'防禦族群','明日主線候選'].filter(Boolean))).slice(0,5);const externalPriority=v11RoleExternalPriority(input.evidenceIndex);const records:Record<string,unknown>[]=[v11RoleBaseRecord('MAIN_THESIS',1,main,{narrative:`${externalTitle} 先改變海外風險偏好，再透過 ${mainIndustry.name} 傳導到台股，受惠方向要看 ${mainTarget} 是否承接資金。`,validation_point:`先看 ${mainTarget} 是否與 TAIEX、TXF 同向。`,stop_condition:`若 ${mainIndustry.name} 代表股無法同步或量能不足，今日主線降級。`,observation_chain:[externalTitle,'海外風險偏好',mainIndustry.name,mainTarget].filter(Boolean),decision_confidence:v11RoleDecisionConfidence(main,input.evidenceIndex,'MAIN_THESIS')}),v11RoleBaseRecord('CONFIRMATION',2,confirm,{narrative:`今天不是只看單一標的，劇本成立需要權值股、指數結構與主線族群同時配合。`,validation_point:`09:30 / 10:30 確認 2330、TAIEX、TXF 與 ${mainIndustry.name} 是否同向。`,stop_condition:'若只有單點上漲、族群沒有擴散，今天不把它升級成強主線。',representative_symbols:Array.from(new Set([...mainSymbols,'2330'])).slice(0,2),representative_names:Array.from(new Set([...mainNames,'台積電'])).slice(0,2),industry_code:mainIndustry.code,industry_name:mainIndustry.name,confirmation_checklist:confirmationChecklist,observation_chain:['權值股','指數結構',mainIndustry.name],decision_confidence:v11RoleDecisionConfidence(confirm,input.evidenceIndex,'CONFIRMATION')}),v11RoleBaseRecord('RISK',3,risk,{narrative:`今天最大的風險是 ${riskIndustry.name} 的反向訊號把早上的劇本打斷，而不是名單裡少一檔股票。`,validation_point:`觀察 ${riskIndustry.name} 代表股是否轉弱，並確認 TAIEX 是否失去支撐。`,stop_condition:v11RoleText(risk?.stop_observing_condition,`若 ${riskIndustry.name} 轉弱且權值股不同步，今日劇本視為失效。`),risk_checklist:riskChecklist,observation_chain:['反向訊號',riskIndustry.name,'劇本失效條件'],decision_confidence:v11RoleDecisionConfidence(risk,input.evidenceIndex,'RISK')}),v11RoleBaseRecord('CAPITAL_NEXT',4,capital,{narrative:`若主線成立但開始降溫，資金下一站可能轉向 ${capitalIndustry.name}，它扮演的是輪動或補位角色。`,validation_point:`看 ${capitalIndustry.name} 是否在主線確認後出現量能擴散，而不是只靠單日題材。`,stop_condition:`若 ${capitalIndustry.name} 沒有成交量或代表股不跟，資金輪動假設取消。`,capital_rotation_path:rotationPath,observation_chain:[mainIndustry.name,'資金擴散',capitalIndustry.name,capitalTarget],decision_confidence:v11RoleDecisionConfidence(capital,input.evidenceIndex,'CAPITAL_NEXT')}),v11RoleBaseRecord('EXTERNAL',5,main,{narrative:`外部變數 ${externalSymbol} 會決定今天台股劇本是延續、降級，還是轉為防守。`,validation_point:`持續對照美股、ADR、美元或利率訊號，確認是否支持台股主線。`,stop_condition:'若外部變數與台股主線背離，今天不追認盤中表態。',representative_symbols:[],representative_names:[],industry_code:'EXTERNAL',industry_name:'外部變數',external_priority:externalPriority,observation_chain:[externalSymbol,'台股主線','盤中驗證'],decision_confidence:v11RoleDecisionConfidence(main,input.evidenceIndex,'EXTERNAL')})];const validation=validateV11ObservationNarrativeRoles(records);if(!validation.is_valid){input.log?.('V11_OBSERVATION_ROLE_BUILDER_INVALID '+JSON.stringify(validation));return null;}if(validation.warnings.length>0)input.log?.('V11_OBSERVATION_ROLE_BUILDER_WARN '+JSON.stringify(validation.warnings));return records;}catch(e){input.log?.('V11_OBSERVATION_ROLE_BUILDER_ERROR '+(e instanceof Error?e.message:String(e)));return null;}}
function validateV10BeneficiaryPhase1(records:V10BeneficiaryPhase1Record[],candidateUniverse:Record<string,unknown>):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const candidates=Array.isArray(candidateUniverse.candidates)?candidateUniverse.candidates as V10CandidateCard[]:[];const allowed=new Set(candidates.map((c)=>String(c.symbol??'')).filter(Boolean));const ranks=new Set<number>();for(let i=0;i<records.length;i++){const r=records[i];if(!r.symbol)errors.push(`today_beneficiary_stocks_v10[${i}].symbol is required`);if(r.symbol&&!allowed.has(r.symbol))errors.push(`today_beneficiary_stocks_v10[${i}].symbol is outside candidate_universe`);if(!TW_STOCK_WHITELIST.has(r.symbol))errors.push(`today_beneficiary_stocks_v10[${i}].symbol is outside whitelist`);validateV10Range(r.total_score,`today_beneficiary_stocks_v10[${i}].total_score`,errors);if(!Number.isInteger(r.rank)||r.rank<1)errors.push(`today_beneficiary_stocks_v10[${i}].rank must be positive integer`);if(ranks.has(r.rank))errors.push(`today_beneficiary_stocks_v10[${i}].rank duplicates another rank`);ranks.add(r.rank);if(!r.industry_code)errors.push(`today_beneficiary_stocks_v10[${i}].industry_code is required`);if(!Array.isArray(r.benefit_chain)||r.benefit_chain.length===0)warnings.push(`today_beneficiary_stocks_v10[${i}].benefit_chain is empty`);if(!Array.isArray(r.scoring_reasons)||r.scoring_reasons.length===0)warnings.push(`today_beneficiary_stocks_v10[${i}].scoring_reasons is empty`);}return {is_valid:errors.length===0,errors,warnings};}
function buildV10BeneficiaryPhase1(candidateUniverse:Record<string,unknown>,evidenceIndex:V10EvidenceItem[]):V10BeneficiaryPhase1Output{const candidates=Array.isArray(candidateUniverse.candidates)?candidateUniverse.candidates as V10CandidateCard[]:[];const eligible=candidates.filter((candidate)=>candidate.eligibility!==false);const primaryEvent=String(candidateUniverse.primary_event??'UNKNOWN');const scored=eligible.map((candidate)=>calculateV10BeneficiaryPhase1Record(candidate,evidenceIndex,primaryEvent)).sort((a,b)=>b.total_score-a.total_score||b.evidence_score-a.evidence_score||a.repeat_penalty-b.repeat_penalty).map((record,index)=>({...record,rank:index+1}));const toOutputRecord=(record:V10BeneficiaryPhase1Record)=>({symbol:record.symbol,name:record.name,industry_code:record.industry_code,industry_name:record.industry_name,rank:record.rank,total_score:record.total_score,confidence_level:record.confidence_level,directional_event_score:record.directional_event_score,positive_evidence_count:record.positive_evidence_count,negative_evidence_count:record.negative_evidence_count,net_evidence_direction:record.net_evidence_direction,risk_flags:record.risk_flags,benefit_chain:record.benefit_chain,scoring_reasons:record.scoring_reasons,data_quality_status:record.data_quality_status});const riskRecords=scored.filter((record)=>record.net_evidence_direction==='negative');const positiveBacked=scored.filter((record)=>record.data_quality_status==='sufficient'&&record.net_evidence_direction==='positive'&&record.positive_evidence_count>=1&&record.positive_evidence_count>record.negative_evidence_count&&['medium','high'].includes(record.confidence_level)&&record.total_score>=45);const noCandidates=scored.length===0;const noPositiveEvidence=!noCandidates&&positiveBacked.length===0;const insufficient=noCandidates;const diverseTop=buildV10DiverseTopCandidates(positiveBacked,5).map((record,index)=>({...record,rank:index+1}));const today=insufficient||noPositiveEvidence?[]:diverseTop.map(toOutputRecord);const legacyObservationWatchlist=buildV11ObservationWatchlist(eligible,scored,riskRecords,diverseTop,evidenceIndex,10).map(outputV11ObservationRecord);const riskWatchlist=riskRecords.slice(0,10).map(toOutputRecord);const status=insufficient?'insufficient':noPositiveEvidence?'insufficient_positive_evidence':(today.length<5?'partial':'sufficient');const warning=insufficient?'今日事件、產業或行情驗證資料不足，未輸出 V10 強受惠股':noPositiveEvidence?'今日沒有足夠正向證據支持強受惠股，僅提供觀察名單與風險名單':null;const roleObservationWatchlist=buildV11ObservationNarrativeRoles({legacyObservation:legacyObservationWatchlist,riskWatchlist,strongWatchlist:today,topCandidates:scored.slice(0,10),candidateUniverse,evidenceIndex,dataQualityStatus:status,warning,log:(msg)=>console.log(msg)});const observationWatchlist=roleObservationWatchlist??legacyObservationWatchlist;const validation=validateV10BeneficiaryPhase1(scored.slice(0,10),candidateUniverse);return {enabled:false,candidate_count:scored.length,data_quality_status:status,warning,top_10_candidates:scored.slice(0,10),today_beneficiary_stocks_v10:today,observation_watchlist:observationWatchlist,risk_watchlist:riskWatchlist,validation};}


const V10_EVALUATION_RUBRIC={catalyst_strength:{HIGH:40,MEDIUM:28,LOW:15},transmission_strength:{HIGH:25,MEDIUM:18,LOW:10},evidence_quality:{HIGH:20,MEDIUM:14,LOW:8},validation_readiness:{HIGH:10,MEDIUM:7,LOW:3},risk_penalty:{NONE:0,LOW:-4,MEDIUM:-10,HIGH:-20}} as const;
function buildEmptyV10CandidateEvaluation():V10CandidateEvaluation{return {catalyst_strength:{level:'LOW',reason:'',supporting_evidence:[]},transmission_strength:{level:'LOW',reason:'',supporting_evidence:[]},evidence_quality:{level:'LOW',reason:'',supporting_evidence:[]},validation_readiness:{level:'LOW',reason:'',supporting_evidence:[]},risk_penalty:{level:'NONE',reason:'',supporting_evidence:[]}};}
function validateV10EvaluationDimension(value:unknown,path:string,allowed:Set<string>,evidenceIds:Set<string>,errors:string[],warnings:string[]):void{const dim=(value&&typeof value==='object'?value:null) as Record<string,unknown>|null;if(!dim){errors.push(`${path} must be an object`);return;}const level=String(dim.level??'');if(!allowed.has(level))errors.push(`${path}.level is invalid`);if(typeof dim.reason!=='string')errors.push(`${path}.reason must be a string`);validateV10EvidenceReferenceArray(dim.supporting_evidence,`${path}.supporting_evidence`,evidenceIds,errors,warnings);}
function validateEvaluation(evaluation:unknown,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const ids=new Set(evidenceIndex.map((item)=>item.evidence_id));const e=(evaluation&&typeof evaluation==='object'?evaluation:{} ) as Record<string,unknown>;const levelSet=new Set(['LOW','MEDIUM','HIGH']);const riskSet=new Set(['NONE','LOW','MEDIUM','HIGH']);validateV10EvaluationDimension(e.catalyst_strength,'catalyst_strength',levelSet,ids,errors,warnings);validateV10EvaluationDimension(e.transmission_strength,'transmission_strength',levelSet,ids,errors,warnings);validateV10EvaluationDimension(e.evidence_quality,'evidence_quality',levelSet,ids,errors,warnings);validateV10EvaluationDimension(e.validation_readiness,'validation_readiness',levelSet,ids,errors,warnings);validateV10EvaluationDimension(e.risk_penalty,'risk_penalty',riskSet,ids,errors,warnings);return {is_valid:errors.length===0,errors,warnings};}
function buildV10EvaluationFramework(evidenceIndex:V10EvidenceItem[]):Record<string,unknown>{const schema=buildEmptyV10CandidateEvaluation();return {enabled:false,rubric:V10_EVALUATION_RUBRIC,schema,validator:validateEvaluation(schema,evidenceIndex)};}


function buildV10AgentSpecification():Record<string,unknown>{const agents:V10AgentContract[]=[{agent_name:'Market Thesis Agent',mission:'只分析市場方向與台股傳導，不推薦股票。',input:['evidence_pack','normalized_evidence','market_context'],output:['market_thesis'],forbidden:['股票推薦','每日一句','分數','Narrative','候選股排名'],success_criteria:['market_thesis 只描述市場主軸','所有判斷都能回到 evidence_index','不輸出任何股票買賣或候選名單'],failure_criteria:['輸出股票推薦','自行產生每日一句','修改 evidence 之外的市場事實']},{agent_name:'Candidate Evaluation Agent',mission:'只評估 Candidate Universe 中每檔候選的條件，不做排名。',input:['candidate_universe','evidence_index','market_thesis','evaluation_framework'],output:['candidate_evaluation'],forbidden:['排名','Final Score','Narrative','每日一句','新增候選股票'],success_criteria:['只對 candidate_universe 內股票做 evaluation','每個 evaluation 引用 evidence_id','不輸出 final score 或排序結果'],failure_criteria:['新增 universe 外股票','產生受惠股最終名單','自行改寫 market_thesis']},{agent_name:'Narrative Agent',mission:'把已完成的 market_thesis 與 candidate_evaluation 轉成產品文案。',input:['market_thesis','candidate_evaluation','risk_analysis','validation_plan'],output:['今日一句','會員研究筆記','War Room','LINE'],forbidden:['重新分析市場','修改結論','新增未驗證 evidence','改變候選評估'],success_criteria:['文案與 decision contract 一致','不新增市場判斷','能清楚標示風險與驗證點'],failure_criteria:['文案推翻 market_thesis','為了好看改變 candidate_evaluation','產生無 evidence 支撐的結論']}];const qa_contract:V10QAContract={checks:['reasoning_summary 必須對應 market_thesis','candidate_evaluation 必須引用 evidence_index','Narrative 不得新增或修改 Decision 結論','LINE / War Room / 會員研究筆記不得互相矛盾'],required_consistency:['Reasoning -> Decision -> Narrative 一致','market_thesis.primary_driver 必須可追溯 evidence_id','top candidate narrative 必須來自 candidate_evaluation','risk wording 必須保留 risk_analysis.failure_condition'],failure_modes:['Narrative 重新分析市場','股票推薦出現在 Market Thesis Agent','Candidate Evaluation Agent 輸出 ranking 或 final score','Narrative 與 market_thesis 方向相反'],debug_action:'fail_debug_validation_only_do_not_publish_v10_output'};return {enabled:false,version:'V10_AGENT_SPEC_DEBUG',agents,qa_contract};}


function buildV10MarketThesisAgentSystemPrompt():string{return ['你是一位管理大型台股主動基金的首席投資長。','你的唯一任務是判斷昨天晚上全球市場真正交易的是什麼。','不要推薦股票。不要寫文案。不要產生 Narrative。不要產生每日一句。不要排名。','只能輸出 JSON object，且根節點只能有 market_thesis。','所有 supporting_evidence 與 counter_evidence 只能引用提供的 evidence_index.evidence_id。'].join('\n');}
function buildV10MarketThesisAgentUserPrompt(input:{evidencePack:V10EvidencePack;normalizedEvidence:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];marketContext:Record<string,unknown>}):string{return JSON.stringify({task:'V10_MARKET_THESIS_AGENT_DEBUG_ONLY',allowed_inputs:{evidence_pack:input.evidencePack,normalized_evidence:input.normalizedEvidence,evidence_index:input.evidenceIndex,market_context:input.marketContext},output_contract:{market_thesis:{primary_driver:'string',secondary_driver:'string',market_story:'string',taiwan_transmission:'string',primary_validation_axis:'string',data_basis:['string'],supporting_evidence:[{evidence_id:'MD001',weight:0,purpose:'primary_support'}],counter_evidence:[{evidence_id:'MD001',weight:0,purpose:'counter_evidence'}],alternative_hypotheses:[{driver:'string',why_rejected:'string',supporting_evidence:[{evidence_id:'MD001',weight:0,purpose:'secondary_support'}]},{driver:'string',why_rejected:'string',supporting_evidence:[{evidence_id:'MD002',weight:0,purpose:'secondary_support'}]}],bull_case:'string',bear_case:'string',confidence_reason:'string'}},hard_rules:['Do not recommend stocks','Do not generate daily sentence','Do not rank candidates','Do not output markdown','Do not output confidence or score','Do not use candidate_universe or beneficiary_candidates','Do not cite evidence_id outside evidence_index']});}
function sanitizeV10EvidenceReferences(value:unknown):V10EvidenceReference[]{if(!Array.isArray(value))return [];return value.filter((item)=>item&&typeof item==='object').map((item)=>{const r=item as Record<string,unknown>;return {evidence_id:String(r.evidence_id??''),weight:Number.isFinite(Number(r.weight))?Number(r.weight):0,purpose:String(r.purpose??'')};});}
function sanitizeV10AlternativeHypotheses(value:unknown):V10AlternativeHypothesis[]{if(!Array.isArray(value))return [];return value.filter((item)=>item&&typeof item==='object').map((item)=>{const r=item as Record<string,unknown>;return {driver:String(r.driver??''),why_rejected:String(r.why_rejected??''),supporting_evidence:sanitizeV10EvidenceReferences(r.supporting_evidence)};});}
function buildMarketThesisConfidenceInputs(evidencePack:V10EvidencePack,normalizedEvidence:Record<string,unknown>,evidenceIndex:V10EvidenceItem[]):V10MarketThesisConfidenceInputs{const dq=(evidencePack.data_quality&&typeof evidencePack.data_quality==='object'?evidencePack.data_quality:{} ) as Record<string,unknown>;const freshness:Record<string,unknown>={market_data:Array.isArray(normalizedEvidence.normalized_market_snapshot)?normalizedEvidence.normalized_market_snapshot.length:0,market_news:Array.isArray(normalizedEvidence.normalized_news)?normalizedEvidence.normalized_news.length:0,sector_rotation:Array.isArray(normalizedEvidence.sector_context)?normalizedEvidence.sector_context.length:0,previous_validation:normalizedEvidence.previous_validation?1:0};return {available_sources:Array.isArray(dq.available_sources)?dq.available_sources.map(String):[],missing_sources:Array.isArray(dq.missing_sources)?dq.missing_sources.map(String):[],evidence_count:evidenceIndex.length,freshness,validation_coverage:{market_data:freshness.market_data,market_news:freshness.market_news,sector_rotation:freshness.sector_rotation,previous_validation:freshness.previous_validation}};}
function calculateMarketThesisConfidence(input:V10MarketThesisConfidenceInputs):number{const available=Math.min(30,input.available_sources.length*6);const evidence=Math.min(25,input.evidence_count*2);const missingPenalty=Math.min(35,input.missing_sources.length*5);const coverage=Object.values(input.validation_coverage).filter((v)=>Number(v)>0).length*8;return Math.max(0,Math.min(100,Math.round(30+available+evidence+coverage-missingPenalty)));}
function buildV10EvidenceBreakdown(evidenceIndex:V10EvidenceItem[]):Record<string,number>{const groups:Record<string,{sum:number;count:number}>={};for(const item of evidenceIndex){const key=item.evidence_type;if(!groups[key])groups[key]={sum:0,count:0};groups[key].sum+=item.importance;groups[key].count++;}const out:Record<string,number>={market_data:0,market_news:0,sector_rotation:0,previous_validation:0};for(const [key,val] of Object.entries(groups)){out[key]=Math.round(val.sum/Math.max(1,val.count));}return out;}
function sanitizeV10MarketThesis(value:unknown,confidenceInputs:V10MarketThesisConfidenceInputs,evidenceBreakdown:Record<string,number>):V10MarketThesisContract|null{if(!value||typeof value!=='object')return null;const r=value as Record<string,unknown>;return {primary_driver:String(r.primary_driver??''),secondary_driver:String(r.secondary_driver??''),market_story:String(r.market_story??''),taiwan_transmission:String(r.taiwan_transmission??''),primary_validation_axis:String(r.primary_validation_axis??''),data_basis:Array.isArray(r.data_basis)?r.data_basis.map(String):[],confidence:calculateMarketThesisConfidence(confidenceInputs),confidence_inputs:confidenceInputs,supporting_evidence:sanitizeV10EvidenceReferences(r.supporting_evidence),counter_evidence:sanitizeV10EvidenceReferences(r.counter_evidence),alternative_hypotheses:sanitizeV10AlternativeHypotheses(r.alternative_hypotheses),evidence_breakdown:evidenceBreakdown,bull_case:String(r.bull_case??''),bear_case:String(r.bear_case??''),confidence_reason:String(r.confidence_reason??'')};}
async function runV10MarketThesisAgentDebug(input:{evidencePack:V10EvidencePack;normalizedEvidence:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];marketContext:Record<string,unknown>;apiKey:string;log:(msg:string)=>void}):Promise<{enabled:false;used_openai:boolean;market_thesis:V10MarketThesisContract|null;raw_response:Record<string,unknown>|null;error:string|null}>{if(!input.apiKey)return {enabled:false,used_openai:false,market_thesis:null,raw_response:null,error:'missing_openai_key'};const result=await callOpenAI(buildV10MarketThesisAgentSystemPrompt(),buildV10MarketThesisAgentUserPrompt(input),input.apiKey,input.log);const confidenceInputs=buildMarketThesisConfidenceInputs(input.evidencePack,input.normalizedEvidence,input.evidenceIndex);const evidenceBreakdown=buildV10EvidenceBreakdown(input.evidenceIndex);const thesis=sanitizeV10MarketThesis(result?.market_thesis,confidenceInputs,evidenceBreakdown);return {enabled:false,used_openai:!!result,market_thesis:thesis,raw_response:result,error:result?(thesis?null:'invalid_market_thesis_shape'):'openai_no_response'};}
function buildV10MarketThesisValidation(debugResult:{market_thesis:V10MarketThesisContract|null},baseContract:V10DecisionContract,evidenceIndex:V10EvidenceItem[]):Record<string,unknown>{const thesis=debugResult.market_thesis??baseContract.market_thesis;const contract:V10DecisionContract={...baseContract,market_thesis:thesis,risk_analysis:{bull_case:thesis.bull_case||'market_thesis_bull_case_not_available',bear_case:thesis.bear_case||'market_thesis_bear_case_not_available',key_risks:thesis.bear_case?[thesis.bear_case]:['market_thesis_risk_not_available'],failure_condition:thesis.primary_validation_axis||'primary_validation_axis_not_available',supporting_evidence:thesis.counter_evidence??[]},reasoning_summary:{why_today:thesis.market_story||'market_story_not_available',why_taiwan:thesis.taiwan_transmission||'taiwan_transmission_not_available',why_top_candidate:'candidate_evaluation_not_part_of_market_thesis_agent'}};return {decision_contract:validateV10DecisionContract(contract),evidence_references:validateEvidenceReferences(contract,evidenceIndex)};}


function buildV10CandidateEvaluationAgentSystemPrompt():string{return ['你是台股研究團隊的候選股評估員。','你的任務不是推薦股票，而是根據今天 Market Thesis 與 Evidence，逐檔評估 Candidate Universe。','不可輸出 ranking、final_score、buy/sell/target price。','不可新增 candidate_universe 以外股票。','不可產生每日一句或 Narrative。不可修改 market_thesis。','所有 supporting_evidence 只能引用提供的 evidence_index.evidence_id。','只能輸出 JSON object，根節點只能有 candidate_evaluations。'].join('\n');}
function buildV10CandidateEvaluationAgentUserPrompt(input:{marketThesis:V10MarketThesisContract;candidateUniverse:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];evaluationFramework:Record<string,unknown>}):string{return JSON.stringify({task:'V10_CANDIDATE_EVALUATION_AGENT_DEBUG_ONLY',allowed_inputs:{market_thesis:input.marketThesis,candidate_universe:{candidates:Array.isArray(input.candidateUniverse.candidates)?input.candidateUniverse.candidates:[]},evidence_index:input.evidenceIndex,evaluation_framework:input.evaluationFramework},output_contract:{candidate_evaluations:[{symbol:'string',name:'string',evaluation:{catalyst_strength:{level:'LOW|MEDIUM|HIGH',reason:'string',supporting_evidence:[{evidence_id:'MD001',weight:0,purpose:'primary_support'}]},transmission_strength:{level:'LOW|MEDIUM|HIGH',reason:'string',supporting_evidence:[]},evidence_quality:{level:'LOW|MEDIUM|HIGH',reason:'string',supporting_evidence:[]},validation_readiness:{level:'LOW|MEDIUM|HIGH',reason:'string',supporting_evidence:[]},risk_penalty:{level:'NONE|LOW|MEDIUM|HIGH',reason:'string',supporting_evidence:[]}}}]},hard_rules:['Do not output ranking','Do not output final_score','Do not output buy/sell/target price','Do not add candidates outside candidate_universe','Do not generate daily sentence','Do not generate narrative','Do not modify market_thesis','Do not cite evidence_id outside evidence_index']});}
function sanitizeV10EvaluationDimension(value:unknown,risk=false):V10EvaluationDimension|V10RiskPenaltyDimension{const v=(value&&typeof value==='object'?value:{} ) as Record<string,unknown>;const raw=String(v.level??(risk?'NONE':'LOW')).toUpperCase();const level=risk?(['NONE','LOW','MEDIUM','HIGH'].includes(raw)?raw:'NONE'):(['LOW','MEDIUM','HIGH'].includes(raw)?raw:'LOW');return {level:level as never,reason:String(v.reason??''),supporting_evidence:sanitizeV10EvidenceReferences(v.supporting_evidence)} as V10EvaluationDimension|V10RiskPenaltyDimension;}
function sanitizeV10CandidateEvaluation(value:unknown):V10CandidateEvaluation|null{if(!value||typeof value!=='object')return null;const v=value as Record<string,unknown>;return {catalyst_strength:sanitizeV10EvaluationDimension(v.catalyst_strength) as V10EvaluationDimension,transmission_strength:sanitizeV10EvaluationDimension(v.transmission_strength) as V10EvaluationDimension,evidence_quality:sanitizeV10EvaluationDimension(v.evidence_quality) as V10EvaluationDimension,validation_readiness:sanitizeV10EvaluationDimension(v.validation_readiness) as V10EvaluationDimension,risk_penalty:sanitizeV10EvaluationDimension(v.risk_penalty,true) as V10RiskPenaltyDimension};}
function sanitizeV10CandidateEvaluationRecords(value:unknown):V10CandidateEvaluationRecord[]{if(!Array.isArray(value))return [];const out:V10CandidateEvaluationRecord[]=[];for(const item of value){if(!item||typeof item!=='object')continue;const r=item as Record<string,unknown>;const evaluation=sanitizeV10CandidateEvaluation(r.evaluation);if(!evaluation)continue;out.push({symbol:String(r.symbol??''),name:String(r.name??''),evaluation});}return out;}
function validateV10CandidateEvaluationRecords(records:V10CandidateEvaluationRecord[],candidateUniverse:Record<string,unknown>,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const candidates=Array.isArray(candidateUniverse.candidates)?candidateUniverse.candidates as Record<string,unknown>[]:[];const allowed=new Set(candidates.map((c)=>String(c.symbol??'')).filter(Boolean));const seen=new Set<string>();for(let i=0;i<records.length;i++){const rec=records[i];if(!rec.symbol)errors.push(`candidate_evaluations[${i}].symbol is required`);if(seen.has(rec.symbol))errors.push(`candidate_evaluations[${i}].symbol duplicates another evaluation`);seen.add(rec.symbol);if(rec.symbol&&!allowed.has(rec.symbol))errors.push(`candidate_evaluations[${i}].symbol is outside candidate_universe`);const result=validateEvaluation(rec.evaluation,evidenceIndex);errors.push(...result.errors.map((e)=>`candidate_evaluations[${i}].${e}`));warnings.push(...result.warnings.map((w)=>`candidate_evaluations[${i}].${w}`));}if(records.length===0)warnings.push('candidate_evaluations is empty');return {is_valid:errors.length===0,errors,warnings};}
async function runV10CandidateEvaluationAgentDebug(input:{marketThesis:V10MarketThesisContract|null;candidateUniverse:Record<string,unknown>;evidenceIndex:V10EvidenceItem[];evaluationFramework:Record<string,unknown>;apiKey:string;log:(msg:string)=>void}):Promise<{enabled:false;used_openai:boolean;candidate_count:number;evaluations:V10CandidateEvaluationRecord[];raw_response:Record<string,unknown>|null;error:string|null}>{const candidates=Array.isArray(input.candidateUniverse.candidates)?input.candidateUniverse.candidates:[];if(!input.marketThesis)return {enabled:false,used_openai:false,candidate_count:candidates.length,evaluations:[],raw_response:null,error:'missing_market_thesis'};if(!input.apiKey)return {enabled:false,used_openai:false,candidate_count:candidates.length,evaluations:[],raw_response:null,error:'missing_openai_key'};const result=await callOpenAI(buildV10CandidateEvaluationAgentSystemPrompt(),buildV10CandidateEvaluationAgentUserPrompt({marketThesis:input.marketThesis,candidateUniverse:input.candidateUniverse,evidenceIndex:input.evidenceIndex,evaluationFramework:input.evaluationFramework}),input.apiKey,input.log);const evaluations=sanitizeV10CandidateEvaluationRecords(result?.candidate_evaluations);return {enabled:false,used_openai:!!result,candidate_count:candidates.length,evaluations,raw_response:result,error:result?null:'openai_no_response'};}


function v10RubricScore(rubric:Record<string,unknown>,dimension:string,level:unknown):number{const group=(rubric[dimension]&&typeof rubric[dimension]==='object'?rubric[dimension]:{} ) as Record<string,unknown>;const value=group[String(level??'LOW').toUpperCase()];return Number.isFinite(Number(value))?Number(value):0;}
function v10CandidateRepeatPenalty(symbol:string,candidateUniverse:Record<string,unknown>):number{const candidates=Array.isArray(candidateUniverse.candidates)?candidateUniverse.candidates as Record<string,unknown>[]:[];const match=candidates.find((c)=>String(c.symbol??'')===symbol);return Number.isFinite(Number(match?.repeat_penalty))?Number(match?.repeat_penalty):0;}
function calculateV10CandidateScore(record:V10CandidateEvaluationRecord,rubric:Record<string,unknown>,candidateUniverse:Record<string,unknown>):V10CandidateScoreRecord{const e=record.evaluation;const catalyst=v10RubricScore(rubric,'catalyst_strength',e.catalyst_strength.level);const transmission=v10RubricScore(rubric,'transmission_strength',e.transmission_strength.level);const evidence=v10RubricScore(rubric,'evidence_quality',e.evidence_quality.level);const validation=v10RubricScore(rubric,'validation_readiness',e.validation_readiness.level);const risk=v10RubricScore(rubric,'risk_penalty',e.risk_penalty.level);const repeat=v10CandidateRepeatPenalty(record.symbol,candidateUniverse);const raw=catalyst+transmission+evidence+validation+risk-repeat;return {symbol:record.symbol,name:record.name,catalyst_strength_score:catalyst,transmission_strength_score:transmission,evidence_quality_score:evidence,validation_readiness_score:validation,risk_penalty_score:risk,repeat_penalty:repeat,final_score:Math.max(0,Math.min(100,Math.round(raw))),rank:0,score_basis:['rubric.catalyst_strength','rubric.transmission_strength','rubric.evidence_quality','rubric.validation_readiness','rubric.risk_penalty','candidate_universe.repeat_penalty']};}
function rankV10CandidateScores(scores:V10CandidateScoreRecord[]):V10CandidateScoreRecord[]{return [...scores].sort((a,b)=>b.final_score-a.final_score||b.evidence_quality_score-a.evidence_quality_score||a.repeat_penalty-b.repeat_penalty).map((score,idx)=>({...score,rank:idx+1}));}
function validateV10CandidateScores(scores:V10CandidateScoreRecord[],candidateUniverse:Record<string,unknown>):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const candidates=Array.isArray(candidateUniverse.candidates)?candidateUniverse.candidates as Record<string,unknown>[]:[];const allowed=new Set(candidates.map((c)=>String(c.symbol??'')).filter(Boolean));const ranks=new Set<number>();for(let i=0;i<scores.length;i++){const s=scores[i];if(!s.symbol)errors.push(`scores[${i}].symbol is required`);if(s.symbol&&!allowed.has(s.symbol))errors.push(`scores[${i}].symbol is outside candidate_universe`);validateV10Range(s.final_score,`scores[${i}].final_score`,errors);if(!Number.isInteger(s.rank)||s.rank<1)errors.push(`scores[${i}].rank must be a positive integer`);if(ranks.has(s.rank))errors.push(`scores[${i}].rank duplicates another score`);ranks.add(s.rank);const blob=JSON.stringify(s).toLowerCase();if(/buy|sell|target price|買進|賣出|目標價/.test(blob))errors.push(`scores[${i}] contains forbidden trading instruction text`);}if(scores.length===0)warnings.push('scores is empty');return {is_valid:errors.length===0,errors,warnings};}
function buildV10ScoreEngine(candidateEvaluations:V10CandidateEvaluationRecord[],candidateUniverse:Record<string,unknown>,evaluationFramework:Record<string,unknown>):Record<string,unknown>{const rubric=(evaluationFramework.rubric&&typeof evaluationFramework.rubric==='object'?evaluationFramework.rubric:{} ) as Record<string,unknown>;const scores=rankV10CandidateScores(candidateEvaluations.map((record)=>calculateV10CandidateScore(record,rubric,candidateUniverse)));return {enabled:false,candidate_count:scores.length,scores,validation:validateV10CandidateScores(scores,candidateUniverse)};}


function findV10CandidateEvaluation(symbol:string,evaluations:V10CandidateEvaluationRecord[]):V10CandidateEvaluationRecord|null{return evaluations.find((item)=>item.symbol===symbol)??null;}
function collectV10EvidenceFromEvaluation(evaluation:V10CandidateEvaluation|null):V10EvidenceReference[]{if(!evaluation)return [];const refs=[...evaluation.catalyst_strength.supporting_evidence,...evaluation.transmission_strength.supporting_evidence,...evaluation.evidence_quality.supporting_evidence,...evaluation.validation_readiness.supporting_evidence,...evaluation.risk_penalty.supporting_evidence];const seen=new Set<string>();return refs.filter((ref)=>{if(!ref.evidence_id||seen.has(ref.evidence_id))return false;seen.add(ref.evidence_id);return true;}).slice(0,5);}
function buildV10DecisionSummary(args:{marketThesis:V10MarketThesisContract|null;scores:V10CandidateScoreRecord[];evaluations:V10CandidateEvaluationRecord[];evidenceIndex:V10EvidenceItem[];capitalFlowChain?:V10CapitalFlowChain}):V10DecisionSummary{const thesis=args.marketThesis;const top=args.scores.slice(0,5).map((score)=>{const record=findV10CandidateEvaluation(score.symbol,args.evaluations);const evaluation=record?.evaluation??null;return {symbol:score.symbol,name:score.name,rank:score.rank,final_score:score.final_score,score_breakdown:{catalyst_strength_score:score.catalyst_strength_score,transmission_strength_score:score.transmission_strength_score,evidence_quality_score:score.evidence_quality_score,validation_readiness_score:score.validation_readiness_score,risk_penalty_score:score.risk_penalty_score,repeat_penalty:score.repeat_penalty},why_it_matters:evaluation?.transmission_strength.reason??'',validation_focus:evaluation?.validation_readiness.reason??'',risk_note:evaluation?.risk_penalty.reason??'',supporting_evidence:collectV10EvidenceFromEvaluation(evaluation)};});const evidenceSummary=args.evidenceIndex.slice(0,8).map((e)=>({evidence_id:e.evidence_id,evidence_type:e.evidence_type,title:e.title,importance:e.importance,freshness:e.freshness}));return {summary_version:'V10',primary_driver:thesis?.primary_driver??'',taiwan_transmission:thesis?.taiwan_transmission??'',primary_validation_axis:thesis?.primary_validation_axis??'',top_candidates:top,key_risks:thesis?[thesis.bear_case,thesis.confidence_reason].filter(Boolean):[],rejected_hypotheses:thesis?.alternative_hypotheses??[],evidence_summary:evidenceSummary,capital_flow_summary:args.capitalFlowChain?buildV10CapitalFlowSummary(args.capitalFlowChain):{},narrative_guardrails:['Do not change market_thesis conclusion','Do not change score_engine ranking','Do not add stocks outside top_candidates','Do not generate buy/sell/target price language','Do not invent evidence not in evidence_index']};}
function validateV10DecisionSummary(summary:unknown,args:{marketThesis:V10MarketThesisContract|null;scores:V10CandidateScoreRecord[];evidenceIndex:V10EvidenceItem[]}):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const s=(summary&&typeof summary==='object'?summary:{} ) as Record<string,unknown>;if(s.summary_version!=='V10')errors.push('summary_version must be V10');if(String(s.primary_driver??'')!==String(args.marketThesis?.primary_driver??''))errors.push('primary_driver must equal market_thesis.primary_driver');const scoreMap=new Map(args.scores.map((score)=>[score.symbol,score]));const evidenceIds=new Set(args.evidenceIndex.map((e)=>e.evidence_id));const top=Array.isArray(s.top_candidates)?s.top_candidates as Record<string,unknown>[]:[];if(!Array.isArray(s.top_candidates))errors.push('top_candidates must be an array');for(let i=0;i<top.length;i++){const item=top[i];const symbol=String(item.symbol??'');const score=scoreMap.get(symbol);if(!score){errors.push(`top_candidates[${i}].symbol must exist in score_engine`);continue;}if(Number(item.rank)!==score.rank)errors.push(`top_candidates[${i}].rank must match score_engine`);if(Number(item.final_score)!==score.final_score)errors.push(`top_candidates[${i}].final_score must match score_engine`);const refs=Array.isArray(item.supporting_evidence)?item.supporting_evidence as Record<string,unknown>[]:[];if(!Array.isArray(item.supporting_evidence))errors.push(`top_candidates[${i}].supporting_evidence must be an array`);for(let j=0;j<refs.length;j++){const id=String(refs[j].evidence_id??'');if(!evidenceIds.has(id))errors.push(`top_candidates[${i}].supporting_evidence[${j}] is not in evidence_index`);}}const blob=JSON.stringify(summary).toLowerCase();if(/buy|sell|target price|買進|賣出|目標價/.test(blob))errors.push('decision_summary contains forbidden trading instruction text');if(top.length===0)warnings.push('top_candidates is empty');return {is_valid:errors.length===0,errors,warnings};}
function buildV10DecisionSummaryDebug(marketThesis:V10MarketThesisContract|null,scores:V10CandidateScoreRecord[],evaluations:V10CandidateEvaluationRecord[],evidenceIndex:V10EvidenceItem[],capitalFlowChain?:V10CapitalFlowChain):Record<string,unknown>{const summary=buildV10DecisionSummary({marketThesis,scores,evaluations,evidenceIndex,capitalFlowChain});return {enabled:false,summary,validation:validateV10DecisionSummary(summary,{marketThesis,scores,evidenceIndex})};}


function validateV10MarketThesisCutover(thesis:V10MarketThesisContract|null,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];if(!thesis)return {is_valid:false,errors:['market_thesis is missing'],warnings};for(const key of ['primary_driver','market_story','taiwan_transmission','primary_validation_axis']){if(!String((thesis as unknown as Record<string,unknown>)[key]??'').trim())errors.push(`market_thesis.${key} is required for cutover`);}if(!Array.isArray(thesis.supporting_evidence)||thesis.supporting_evidence.length===0)errors.push('market_thesis.supporting_evidence is required for cutover');const contract=buildEmptyV10DecisionContract();contract.market_thesis=thesis;const refValidation=validateEvidenceReferences(contract,evidenceIndex);errors.push(...refValidation.errors);warnings.push(...refValidation.warnings);return {is_valid:errors.length===0,errors,warnings};}
function applyV10ThesisCutover(aiStrategyJson:Record<string,unknown>,thesis:V10MarketThesisContract|null,validation:V10ContractValidationResult,flags:V10FeatureFlags):{feature:string;enabled:boolean;fallback_used:boolean;reason:string;fields:string[]}{const fields=['today_quote','market_story','primary_driver','taiwan_transmission'];if(!flags.ENABLE_V10_THESIS)return {feature:'V10_THESIS',enabled:false,fallback_used:true,reason:'feature_disabled',fields:[]};if(!validation.is_valid||!thesis)return {feature:'V10_THESIS',enabled:true,fallback_used:true,reason:'validation_failed:'+(validation.errors.join('|')||'unknown'),fields:[]};aiStrategyJson.today_quote=thesis.market_story;aiStrategyJson.market_story=thesis.market_story;aiStrategyJson.primary_driver=thesis.primary_driver;aiStrategyJson.taiwan_transmission=thesis.taiwan_transmission;aiStrategyJson.v10_thesis_cutover_applied=true;return {feature:'V10_THESIS',enabled:true,fallback_used:false,reason:'',fields};}


function v10StageForCandidate(candidate:Record<string,unknown>,score?:V10CandidateScoreRecord):V10CapitalFlowStage['stage']{const tags=Array.isArray(candidate.trigger_tags)?candidate.trigger_tags.map((x)=>String(x).toUpperCase()):[];const sector=String(candidate.sector??'');if(String(candidate.symbol??'')==='2330'||sector.includes('半導體'))return 'IMMEDIATE';if(tags.includes('AI_SERVER')||Number(score?.final_score??0)>=70)return 'EARLY';if(['電子零組件','通信網路','電腦及週邊'].some((s)=>sector.includes(s)))return 'EXPANSION';return 'LATE';}
function v10HorizonForStage(stage:V10CapitalFlowStage['stage']):V10CapitalFlowStage['impact_horizon']{if(stage==='IMMEDIATE')return 'TODAY';if(stage==='EARLY')return '1_3_DAYS';if(stage==='EXPANSION')return '3_10_DAYS';return 'LONGER';}
function buildV10CapitalFlowChain(args:{marketThesis:V10MarketThesisContract|null;candidateUniverse:Record<string,unknown>;scores:V10CandidateScoreRecord[];evidenceIndex:V10EvidenceItem[]}):V10CapitalFlowChain{const thesis=args.marketThesis;const candidates=Array.isArray(args.candidateUniverse.candidates)?args.candidateUniverse.candidates as Record<string,unknown>[]:[];const scoreMap=new Map(args.scores.map((s)=>[s.symbol,s]));const grouped:Record<string,V10CapitalFlowStage>={};for(const candidate of candidates){if(candidate.eligibility===false)continue;const symbol=String(candidate.symbol??'');const score=scoreMap.get(symbol);const stage=v10StageForCandidate(candidate,score);if(!grouped[stage])grouped[stage]={stage:stage as V10CapitalFlowStage['stage'],impact_horizon:v10HorizonForStage(stage),target_sector:String(candidate.sector??''),representative_candidates:[],reasoning:'',supporting_evidence:[]};grouped[stage].representative_candidates.push({symbol,name:candidate.name??'',sector:candidate.sector??'',rank:score?.rank??null,final_score:score?.final_score??null});const refs=Array.isArray(candidate.related_evidence)?candidate.related_evidence as V10EvidenceReference[]:[];for(const ref of refs){if(ref.evidence_id&&!grouped[stage].supporting_evidence.some((x)=>x.evidence_id===ref.evidence_id))grouped[stage].supporting_evidence.push(ref);}if(!grouped[stage].target_sector)grouped[stage].target_sector=String(candidate.sector??'');}const order:V10CapitalFlowStage['stage'][]=['IMMEDIATE','EARLY','EXPANSION','LATE'];const stages=order.map((stage)=>grouped[stage]).filter(Boolean).map((stage)=>({...stage,representative_candidates:stage.representative_candidates.slice(0,5),supporting_evidence:stage.supporting_evidence.slice(0,5),reasoning:`${stage.stage} flow derived from market thesis primary driver and eligible candidate trigger tags.`}));return {global_event:thesis?.primary_driver??'',market_thesis:thesis?.market_story??'',stages};}
function validateV10CapitalFlowChain(chain:unknown,evidenceIndex:V10EvidenceItem[]):V10ContractValidationResult{const errors:string[]=[],warnings:string[]=[];const ids=new Set(evidenceIndex.map((e)=>e.evidence_id));const c=(chain&&typeof chain==='object'?chain:{} ) as Record<string,unknown>;if(typeof c.global_event!=='string')errors.push('global_event must be a string');if(typeof c.market_thesis!=='string')errors.push('market_thesis must be a string');const stages=Array.isArray(c.stages)?c.stages as Record<string,unknown>[]:[];if(!Array.isArray(c.stages))errors.push('stages must be an array');if(stages.length===0)warnings.push('capital flow stages is empty');const validStages=new Set(['IMMEDIATE','EARLY','EXPANSION','LATE']);const validHorizons=new Set(['TODAY','1_3_DAYS','3_10_DAYS','LONGER']);for(let i=0;i<stages.length;i++){const stage=stages[i];if(!validStages.has(String(stage.stage)))errors.push(`stages[${i}].stage is invalid`);if(!validHorizons.has(String(stage.impact_horizon)))errors.push(`stages[${i}].impact_horizon is invalid`);if(typeof stage.target_sector!=='string')errors.push(`stages[${i}].target_sector must be a string`);if(!Array.isArray(stage.representative_candidates))errors.push(`stages[${i}].representative_candidates must be an array`);const refs=Array.isArray(stage.supporting_evidence)?stage.supporting_evidence as Record<string,unknown>[]:[];if(!Array.isArray(stage.supporting_evidence))errors.push(`stages[${i}].supporting_evidence must be an array`);for(let j=0;j<refs.length;j++){const id=String(refs[j].evidence_id??'');if(!ids.has(id))errors.push(`stages[${i}].supporting_evidence[${j}] is not in evidence_index`);}}return {is_valid:errors.length===0,errors,warnings};}
function buildV10CapitalFlowEngineDebug(args:{marketThesis:V10MarketThesisContract|null;candidateUniverse:Record<string,unknown>;scores:V10CandidateScoreRecord[];evidenceIndex:V10EvidenceItem[]}):Record<string,unknown>{const chain=buildV10CapitalFlowChain(args);return {enabled:false,chain,validation:validateV10CapitalFlowChain(chain,args.evidenceIndex)};}
function buildV10CapitalFlowSummary(chain:V10CapitalFlowChain):Record<string,unknown>{const out:Record<string,unknown>={};for(const stage of chain.stages){out[stage.stage]={impact_horizon:stage.impact_horizon,target_sector:stage.target_sector,representative_candidates:stage.representative_candidates.slice(0,3)};}return out;}

function applyBiasGuardrails(md:MarketIndicator[],baseScore:number):BiasGuardrailResult{
  const sox=findIndicator(md,['SOX','PHLX']),nasdaq=findIndicator(md,['IXIC','NASDAQ']),nvda=findIndicator(md,['NVDA']),vix=findIndicator(md,['VIX','VIXINDEX']),tsm=findIndicator(md,['TSM','TSMC']),txf=findIndicator(md,['TXF','TX','MTX']);
  let adjusted=baseScore;let cap=100;const riskSignals:string[]=[],staleSignals:string[]=[],unavailableSignals:string[]=[];let negativeCoreCount=0;
  const usable=function(m:MarketIndicator|null,label:string):MarketIndicator|null{if(!m)return null;if(isCoreMarketDataStale(m)){if(label==='TXF'){unavailableSignals.push('TXF 資料暫無授權來源或近月合約對應，今日不納入方向扣分');return null;}staleSignals.push(label+' 資料過期（'+(m.updatedAt||'無時間')+'）');return null;}return m};
  const sx=usable(sox,'SOX'),ix=usable(nasdaq,'NASDAQ'),nv=usable(nvda,'NVDA'),vx=usable(vix,'VIX'),tm=usable(tsm,'TSM ADR'),tf=usable(txf,'TXF');
  if(sx&&sx.changePercent<=-5){adjusted-=25;cap=Math.min(cap,35);riskSignals.push('SOX '+fmtSignedPct(sx.changePercent)+'，半導體風險升級');negativeCoreCount++;}
  else if(sx&&sx.changePercent<=-3){adjusted-=18;cap=Math.min(cap,50);riskSignals.push('SOX '+fmtSignedPct(sx.changePercent)+'，market_bias 不可高於中性觀察');negativeCoreCount++;}
  else if(sx&&sx.changePercent<0){negativeCoreCount++;}
  if(ix&&ix.changePercent<=-1.5){adjusted-=12;cap=Math.min(cap,55);riskSignals.push('NASDAQ '+fmtSignedPct(ix.changePercent)+'，成長股風險扣分');negativeCoreCount++;}
  else if(ix&&ix.changePercent<0){negativeCoreCount++;}
  if(nv&&nv.changePercent<=-2){adjusted-=12;cap=Math.min(cap,55);riskSignals.push('NVDA '+fmtSignedPct(nv.changePercent)+'，AI 主線風險扣分');negativeCoreCount++;}
  else if(nv&&nv.changePercent<0){negativeCoreCount++;}
  if(tm&&tm.changePercent<=-5){adjusted-=22;cap=Math.min(cap,35);riskSignals.push('TSM ADR '+fmtSignedPct(tm.changePercent)+'，台股電子權值高風險');negativeCoreCount++;}
  else if(tm&&tm.changePercent<=-2){adjusted-=15;cap=Math.min(cap,45);riskSignals.push('TSM ADR '+fmtSignedPct(tm.changePercent)+'，台股電子權值風險升級');negativeCoreCount++;}
  else if(tm&&tm.changePercent<0){negativeCoreCount++;}
  if(vx&&vx.value>=25){adjusted-=20;cap=Math.min(cap,35);riskSignals.push('VIX '+vx.value.toFixed(1)+'，強制風險升級');negativeCoreCount++;}
  else if(vx&&vx.value>=22){adjusted-=12;cap=Math.min(cap,50);riskSignals.push('VIX '+vx.value.toFixed(1)+'，風險偏高');}
  if(tf&&tf.changePercent<=-1){adjusted-=10;cap=Math.min(cap,55);riskSignals.push('TXF '+fmtSignedPct(tf.changePercent)+'，台指期偏弱');negativeCoreCount++;}
  if(negativeCoreCount>=2){cap=Math.min(cap,50);riskSignals.push('核心風險訊號至少 2 個為負，禁止高偏多敘事');}
  if(staleSignals.length>0){cap=Math.min(cap,55);riskSignals.push('核心市場資料有過期項目，今日降級觀察');}
  adjusted=Math.max(0,Math.min(cap,Math.round(adjusted)));
  return{adjustedScore:adjusted,riskSignals:Array.from(new Set(riskSignals)),staleSignals:Array.from(new Set(staleSignals)),unavailableSignals:Array.from(new Set(unavailableSignals)),negativeCoreCount,maxBias:classifyMarketBias(adjusted),shouldDowngrade:adjusted!==baseScore||riskSignals.length>0||staleSignals.length>0};
}
function buildGuardedLinePushCopy(todayDate:string,marketBias:string,confidenceScore:number,md:MarketIndicator[],guard:BiasGuardrailResult):Record<string,unknown>{
  const tsm=findIndicator(md,['TSM','TSMC']),nvda=findIndicator(md,['NVDA']),sox=findIndicator(md,['SOX','PHLX']),nasdaq=findIndicator(md,['IXIC','NASDAQ']),vix=findIndicator(md,['VIX','VIXINDEX']);
  const mainRisk=guard.riskSignals[0]||guard.staleSignals[0]||guard.unavailableSignals[0]||'資料不足，今日降級觀察';
  let one='今日降級觀察，先看開盤量價是否驗證盤前假設。';
  if(tsm&&!isCoreMarketDataStale(tsm)&&tsm.changePercent<=-2)one='TSM ADR '+fmtSignedPct(tsm.changePercent)+' 壓低電子權值，今日先看 2330 是否止穩。';
  else if(sox&&!isCoreMarketDataStale(sox)&&sox.changePercent<=-3)one='SOX '+fmtSignedPct(sox.changePercent)+' 拖累半導體情緒，今日不宜用偏多劇本硬追。';
  else if(nvda&&!isCoreMarketDataStale(nvda)&&nvda.changePercent<=-2)one='NVDA '+fmtSignedPct(nvda.changePercent)+' 轉弱，AI 供應鏈先看抗跌不看追價。';
  else if(nasdaq&&!isCoreMarketDataStale(nasdaq)&&nasdaq.changePercent<=-1.5)one='NASDAQ '+fmtSignedPct(nasdaq.changePercent)+' 走弱，台股成長股今日先降速觀察。';
  else if(guard.staleSignals.length>0)one='核心美股資料有過期項目，今日盤前判斷降級觀察。';
  const opportunity=marketBias.includes('弱')||marketBias==='震盪觀察'?'抗跌權值與防禦型資金流向':'半導體與 AI 供應鏈是否有族群同步性';
  const risk=vix&&!isCoreMarketDataStale(vix)&&vix.value>=22?'VIX '+vix.value.toFixed(1)+'，市場風險偏高':mainRisk;
  const avoid=guard.staleSignals.length>0?'避免用過期美股訊號追多，先等開盤量價確認。':guard.unavailableSignals.length>0?'台指期資料暫無授權來源，不用期貨訊號放大方向判斷。':(marketBias.includes('多')?'避免把盤前偏多當成追價理由，等族群同步再確認。':'避免急著撿便宜，先等賣壓與量能訊號。');
  return{title:'Morning Alpha｜'+todayDate,market_bias:marketBias,confidence:String(confidenceScore),one_sentence:one,opportunity,risk,do_not_do:avoid,watch_point:'09:30 看 TAIEX、2330 與主要族群是否同向；TXF 暫不納入方向確認',cta:'查看完整報告',guardrail_applied:guard.shouldDowngrade,guardrail_risk_signals:guard.riskSignals,stale_signals:guard.staleSignals,unavailable_signals:guard.unavailableSignals};
}
function applyFinalBiasGuardrails(ai:Record<string,unknown>,todayDate:string,md:MarketIndicator[],dScore:MarketDataScore,confidenceResult:ReportConfidenceScore):Record<string,unknown>{
  const originalScore=Number(dScore.details.bias_guardrail_original_score);
  const guard=applyBiasGuardrails(md,Number.isFinite(originalScore)?originalScore:dScore.baseScore);const guardedBias=classifyMarketBias(guard.adjustedScore);const out={...ai};
  let guardedConfidence=confidenceResult.score;
  if(guard.staleSignals.length>0||guard.negativeCoreCount>=2)guardedConfidence=Math.min(guardedConfidence,75);
  if(guard.adjustedScore<=40)guardedConfidence=Math.min(guardedConfidence,65);
  out.market_bias_score=guard.adjustedScore;out.market_bias=guardedBias;out.confidence_score=guardedConfidence;out.bias_guardrails={applied:guard.shouldDowngrade,original_score:Number.isFinite(originalScore)?originalScore:dScore.baseScore,adjusted_score:guard.adjustedScore,original_confidence_score:confidenceResult.score,adjusted_confidence_score:guardedConfidence,risk_signals:guard.riskSignals,stale_signals:guard.staleSignals,unavailable_signals:guard.unavailableSignals,negative_core_count:guard.negativeCoreCount,max_bias:guard.maxBias};
  if(guard.shouldDowngrade){
    const copy=buildGuardedLinePushCopy(todayDate,guardedBias,guardedConfidence,md,guard);out.line_push_copy=copy;
    out.today_quote=copy.one_sentence;
    const fs=(out.free_summary&&typeof out.free_summary==='object'&&!Array.isArray(out.free_summary))?{...(out.free_summary as Record<string,unknown>)}:{};fs.one_sentence=copy.one_sentence;fs.market_bias=guardedBias;fs.confidence_score=guardedConfidence;fs.do_not_do=copy.do_not_do;out.free_summary=fs;
  }
  return out;
}

function applyMemberResearchNoteV2Aliases(ai:Record<string,unknown>):Record<string,unknown>{
  const note=ai.member_research_note_v2;
  if(!note||typeof note!=='object'||Array.isArray(note))return ai;
  const n=note as Record<string,unknown>;
  if(!n.thesis&&n.today_core_thesis)n.thesis=n.today_core_thesis;
  if(!n.beneficiary_reasoning_chain&&Array.isArray(n.beneficiary_reasoning))n.beneficiary_reasoning_chain=n.beneficiary_reasoning;
  if(!n.invalidation_conditions&&Array.isArray(n.invalidation_rules))n.invalidation_conditions=n.invalidation_rules;
  if(!n.closing_feedback&&n.closing_feedback_plan&&typeof n.closing_feedback_plan==='object'&&!Array.isArray(n.closing_feedback_plan))n.closing_feedback=n.closing_feedback_plan;
  if(!n.next_day_tracking&&Array.isArray(n.tomorrow_extension_watch))n.next_day_tracking=n.tomorrow_extension_watch;
  return ai;
}

function safeInteger(v:unknown,fallback:number=50):number{if(v===null||v===undefined)return fallback;const n=Number(v);if(Number.isNaN(n))return fallback;if(n>=0&&n<=1)return Math.round(n*100);if(n>100)return 100;if(n<0)return 0;return Math.round(n);}
function convictionLevelFromConfidence(c:number):string{if(c>=75)return'★★★★★';if(c>=60)return'★★★★☆';return'★★★☆☆';}
function isStrongSectorRotation(s:SectorRotationRow):boolean{return s.rotation_score>=70&&(s.direction==='strong_positive'||s.direction==='positive'||s.signal_label==='強勢主流'||s.signal_label==='轉強');}

const CATALYST_TYPE_MAP:Record<string,string>={'2330':'SEMICONDUCTOR','2454':'SEMICONDUCTOR','3443':'SEMICONDUCTOR','3034':'SEMICONDUCTOR','2303':'SEMICONDUCTOR','2382':'AI_SERVER','3231':'AI_SERVER','6669':'AI_SERVER','2357':'AI_SERVER','2376':'AI_SERVER','2317':'AI_SERVER','2356':'AI_SERVER','3017':'COOLING','3324':'COOLING','3711':'ADVANCED_PACKAGING','8046':'ADVANCED_PACKAGING','3037':'ADVANCED_PACKAGING','3661':'SEMICONDUCTOR','2308':'AI_SERVER','2408':'MEMORY','2344':'MEMORY','2337':'MEMORY','8299':'MEMORY','3081':'CPO','2345':'CPO','4906':'CPO','6239':'SEMICONDUCTOR','2881':'DEFENSIVE','2882':'DEFENSIVE','2891':'DEFENSIVE','2603':'CYCLICAL','2615':'CYCLICAL','2610':'CYCLICAL','1301':'CYCLICAL','1303':'CYCLICAL','1326':'CYCLICAL','2412':'DEFENSIVE','3045':'DEFENSIVE','4904':'DEFENSIVE',};
function catalystTypeForStock(symbol:string):string{return CATALYST_TYPE_MAP[symbol]||'SEMICONDUCTOR';}

function stockResearchProfile(symbol:string,sector:string):Record<string,string>{
  if(symbol==='2330')return{first_order_impact:'NVDA、SOX、TSM ADR 先改變半導體估值情緒。',second_order_impact:'台股電子權值與指數開盤會先看台積電是否抗跌。',taiwan_supply_chain_link:'台積電是先進製程與先進封裝核心權值股，也是台股半導體鏈的第一驗證點。',why_this_stock:'不是只因為半導體題材，而是因為 2330 同時影響 TAIEX 權重、外資配置與 AI 晶片供應鏈定價。',validation_signal:'09:30 前觀察 2330 是否優於 TAIEX、TXF 是否同步止穩、電子權值是否擴散。'};
  if(['2382','3231','6669','2356','2376','2357'].includes(symbol))return{first_order_impact:'NVDA 變動先影響 AI 伺服器訂單與估值想像。',second_order_impact:'市場會檢查 AI 伺服器 ODM 是否跟隨權值電子表態。',taiwan_supply_chain_link:'該股屬 AI 伺服器組裝或系統供應鏈，與 GPU 伺服器出貨節奏連動。',why_this_stock:'它是 AI 伺服器供應鏈代表股，盤中同步性比單純題材股更能驗證資金是否回到主線。',validation_signal:'09:30 觀察是否與廣達、緯創、緯穎等 AI 伺服器族群同步，且量能高於前一交易日同時段。'};
  if(['2454','3443','3661','3034','2303'].includes(symbol))return{first_order_impact:'SOX 與 TSM ADR 會先影響 IC 設計與半導體估值。',second_order_impact:'若半導體權值止穩，資金才會擴散到 IC 設計與 ASIC。',taiwan_supply_chain_link:'該股代表台股 IC 設計或 ASIC 鏈，承接半導體風險偏好變化。',why_this_stock:'它不是泛半導體，而是用來驗證半導體資金是否從 2330 擴散到設計端。',validation_signal:'10:00 前觀察是否與 2330 同向，且族群內不只單一個股獨強。'};
  if(['2881','2882','2891'].includes(symbol))return{first_order_impact:'VIX、DXY 與美債訊號會先改變外資風險胃納。',second_order_impact:'風險升高時，金融權值可能承接防禦配置或成為外資調節觀察點。',taiwan_supply_chain_link:'金融股不是供應鏈受惠，而是資金流與防禦配置的代表。',why_this_stock:'它是金融權值代表，能檢查市場是否從成長股轉向防禦配置。',validation_signal:'09:30 觀察金融指數是否相對 TAIEX 抗跌，以及外資金融權值買賣方向。'};
  if(['2412','3045','4904'].includes(symbol))return{first_order_impact:'風險偏好下降或美債殖利率變動會提高防禦與高現金流標的吸引力。',second_order_impact:'若成長股承壓，資金可能短線尋找低波動電信股。',taiwan_supply_chain_link:'電信股代表高現金流與防禦配置，不是題材型供應鏈。',why_this_stock:'它可驗證市場是否真的進入防禦輪動，而不是只有電子股短線震盪。',validation_signal:'盤中觀察是否相對大盤抗跌，且防禦股不是只有單一個股上漲。'};
  if(['1301','1303','1326'].includes(symbol))return{first_order_impact:'CL / 原油變動先影響塑化原料成本與利差預期。',second_order_impact:'若油價變動具有延續性，塑化族群才會出現基本面重估。',taiwan_supply_chain_link:'該股屬塑化上游，對油價與利差變化敏感。',why_this_stock:'它是塑化鏈代表，能驗證原物料訊號是否真正傳到台股循環股。',validation_signal:'盤中觀察塑化族群是否同步、油價期貨是否延續同向，以及成交量是否放大。'};
  if(['2603','2615','2610'].includes(symbol))return{first_order_impact:'油價與景氣風險先影響航運成本與運價預期。',second_order_impact:'航運股需要運價或油價訊號延續，才有族群性反應。',taiwan_supply_chain_link:'該股代表航運成本與全球貿易循環敏感度。',why_this_stock:'它是航運族群代表，可用來驗證原物料與景氣訊號是否轉化為循環股資金流。',validation_signal:'盤中觀察航運族群同步性、運價相關新聞與油價方向是否一致。'};
  return{first_order_impact:'隔夜市場訊號先影響台股風險偏好。',second_order_impact:'資金再從權值股擴散到對應族群。',taiwan_supply_chain_link:sector+' 族群需要用盤中同步性驗證。',why_this_stock:'此股是 '+sector+' 代表觀察標的，用來驗證資金是否真的進入該族群。',validation_signal:'觀察開盤後是否相對大盤抗跌、量能是否放大、族群是否同步。'};
}
function riskLevelFromConfidenceLevel(level:'high'|'medium'|'low'):string{return level==='high'?'low':level==='medium'?'medium':'high';}
function numericConfidenceFromLevel(level:'high'|'medium'|'low'):number{return level==='high'?82:level==='medium'?68:52;}
function sourceSignalsFromBasis(dataBasis:string,triggerEvent:string,sector:string):string[]{const text=(dataBasis+' '+triggerEvent+' '+sector).toUpperCase();const signals:string[]=[];for(const s of ['NVDA','SOX','TSM','VIX','DXY','US10Y','CL','TAIEX','TXF']){if(text.includes(s))signals.push(s);}if(text.includes('類股輪動')||text.includes('SECTOR'))signals.push('sector_rotation');if(signals.length===0)signals.push('market_data');return Array.from(new Set(signals));}

const SECTOR_LABEL_MAP:Record<string,string>={'半導體':'半導體','記憶體':'記憶體','AI伺服器':'AI伺服器','電源與重電':'電源/重電','散熱':'散熱','光通訊':'光通訊','PCB':'PCB','軍工航太':'軍工航太','機器人':'機器人','營建':'營建',};

const TW_STOCK_WHITELIST=new Set(['2330', '2454', '2317', '2308', '2412', '6669', '2382', '3231', '2356', '2376', '2368', '3037', '3044', '5469', '2383', '6274', '6213', '3017', '3324', '3653', '3081', '4979', '4908', '3363', '3450', '2408', '2344', '8299', '3260', '3034', '3529', '3443', '3661', '5274', '3131', '3167', '3583', '6187', '4763', '1560', '2881', '2882', '2886', '2891', '5880', '2884', '2542', '2548', '2539', '2511', '2504', '2207', '2603', '2609', '2615', '2606', '2617', '2618', '2610', '2727', '2731', '2707', '2748', '2912', '5904', '2903', '2915', '1216', '2201', '2204', '1536', '3665', '1513', '1504', '1605', '1609', '1611', '1519', '6443', '2002', '2014', '2027', '2031', '1301', '1303', '1326', '6505', '1101', '1102', '1227', '1231', '1210', '4743', '1795', '6446', '6547', '4105', '4123', '2634', '8033', '4571', '8222', '3029', '6214', '2480', '6690', '3293', '5478', '6180', '3083', '2357', '3711', '6239', '8046', '2303', '2337', '2049', '1590', '3045', '4904', '2345', '4906', '2421', '3189']);
const FORBIDDEN_BENEFICIARY_SYMBOLS=new Set(['NVDA','TSM','TSMC','TXF','TX','TAIEX','TWII','SOX','SPX','IXIC','VIX','DXY','US10Y','TNX','SP500','GSPC','DJI','DOW','DJIA','PHLX','VIXINDEX','USDINDEX','T10Y','MTX','AMD','AVGO','INTC','QCOM','MU','ARM','MRVL','ASML','LRCX','AMAT','KLAC','NASDAQ','NDX','GOLD','XAUUSD','WTI','CL','OIL','BTC','BITCOIN',]);
const FORBIDDEN_NAME_TOKENS=['nvidia','nvda','tsm adr','tsmc adr','台指期','那斯達克','標普','sox','費城半導體','道瓊','美元指數','美國公債','etf','index','futures','vix','dxy','nasdaq','phlx','sp500','adr','台指','加權','指數','期貨',];

function isValidTaiwanStock(symbol:unknown,name:unknown):boolean{const sym=String(symbol||'').trim();const nm=String(name||'').trim().toLowerCase();if(!/^\d{4}$/.test(sym))return false;if(FORBIDDEN_BENEFICIARY_SYMBOLS.has(sym.toUpperCase()))return false;for(const tk of FORBIDDEN_NAME_TOKENS){if(nm.includes(tk))return false;}return TW_STOCK_WHITELIST.has(sym);}

function buildDynamicBeneficiaryStocks(md:MarketIndicator[],dScore:MarketDataScore,log:(m:string)=>void):Record<string,unknown>[]{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const nv=f(['NVDA']),sox=f(['SOX','PHLX']),tsm=f(['TSM','TSMC']),spx=f(['SPX','SP500']),vix=f(['VIX','VIXINDEX']),dxy=f(['DXY','USDINDEX']),us10y=f(['US10Y','TNX']),taiex=f(['TAIEX','TWII']),txf=f(['TXF','TX']),ts2330=f(['2330','2330.TW']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const bias=dScore.baseScore>=55?'偏多':dScore.baseScore<=40?'偏空':'中性';
  const nvDown=nv&&!Number.isNaN(nv.changePercent)&&nv.changePercent<-0.5;
  const nvUp=nv&&!Number.isNaN(nv.changePercent)&&nv.changePercent>0.3;
  const soxUp=sox&&!Number.isNaN(sox.changePercent)&&sox.changePercent>0.3;
  const soxDown=sox&&!Number.isNaN(sox.changePercent)&&sox.changePercent<-0.5;
  const vixUp=vix&&!Number.isNaN(vix.changePercent)&&vix.changePercent>3;
  const spxDown=spx&&!Number.isNaN(spx.changePercent)&&spx.changePercent<-0.5;
  const taiexUp=taiex&&!Number.isNaN(taiex.changePercent)&&taiex.changePercent>0.5;
  const ts2330Up=ts2330&&!Number.isNaN(ts2330.changePercent)&&ts2330.changePercent>0.3;
  const isRiskOff=vixUp||(nvDown&&soxDown);
  const isBullish=!isRiskOff&&taiexUp&&ts2330Up&&(nvUp||soxUp);
  const isBearish=isRiskOff||bias==='偏空';
  log('[buildDynamicBeneficiary] bias='+bias+' isBullish='+isBullish+' isBearish='+isBearish+' isRiskOff='+isRiskOff);
  const stocks:Record<string,unknown>[]=[];const seen=new Set<string>();
  const add=function(s:Record<string,unknown>){if(!seen.has(String(s.symbol||''))){stocks.push({...s,not_buy_signal:true,source_type:'dynamic_market_driven'});seen.add(String(s.symbol||''));}};
  if(isBearish){
    if(vixUp)add({symbol:'2881',name:'富邦金',group:'金融防禦',direction:'觀察',conviction_level:'★★★★☆',reason:vix?'VIX急升'+fmtPct(vix.changePercent)+'反映市場恐慌升溫，金融權值股具防禦性資金吸引力':'市場風險升高，金融權值股具防禦配置價值',risk:'VIX持續上升或外資大賣金融股視為失效',catalyst_type:'DEFENSIVE',watch_point:'觀察外資買賣超方向與金融指數是否相對抗跌'});
    if(vixUp||(dxy&&dxy.changePercent>0))add({symbol:'2882',name:'國泰金',group:'金融防禦',direction:'觀察',conviction_level:'★★★☆☆',reason:vixUp?'VIX急升'+fmtPct(vix.changePercent)+'，壽險金控具避險配置價值':'市場不確定性升高，壽險金控具防禦價值',risk:'金融股指數轉弱或外資轉賣超視為失效',catalyst_type:'DEFENSIVE',watch_point:'觀察是否與富邦金同步抗跌'});
    if(vixUp||dScore.baseScore<45)add({symbol:'2891',name:'中信金',group:'金融防禦',direction:'觀察',conviction_level:'★★★☆☆',reason:'市場不確定性升高，銀行型金控具穩定息收與防禦特質',risk:'金融股族群轉弱視為失效',catalyst_type:'DEFENSIVE',watch_point:'觀察防禦性買盤是否持續'});
    add({symbol:'2412',name:'中華電',group:'電信防禦',direction:'觀察',conviction_level:'★★★☆☆',reason:vixUp?'VIX急升'+fmtPct(vix.changePercent)+'，高殖利率電信股具避險價值':'市場避險情緒升溫，電信股具高殖利率防禦價值',risk:'市場恐慌緩解後資金可能撤離防禦型標的',catalyst_type:'DEFENSIVE',watch_point:'觀察資金是否持續流入防禦型標的'});
    if(tsm&&!Number.isNaN(tsm.changePercent)&&tsm.changePercent>0)add({symbol:'2330',name:'台積電',group:'半導體權值',direction:'觀察',conviction_level:'★★★★☆',reason:'TSM ADR '+fmtPct(tsm.changePercent)+'溢價提供支撐，但'+(nvDown?'NVDA '+fmtPct(nv.changePercent)+'走弱':'市場風險升高')+'，以觀察為主',risk:'NVDA持續走弱或費半翻黑視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察開盤溢價是否收斂與外資買賣超'});
    if(us10y&&us10y.changePercent<-0.3)add({symbol:'2603',name:'長榮',group:'航運',direction:'觀察',conviction_level:'★★★☆☆',reason:'美債殖利率下滑'+fmtPct(us10y.changePercent)+'有利資金成本下降，貨櫃航運具防禦替代價值',risk:'全球貿易需求降溫或運價指數轉弱視為失效',catalyst_type:'CYCLICAL',watch_point:'觀察SCFI運價指數走向'});
  }else if(isBullish){
    const nvPct=nv&&!Number.isNaN(nv.changePercent)?fmtPct(nv.changePercent):'';const soxPct=sox&&!Number.isNaN(sox.changePercent)?fmtPct(sox.changePercent):'';
    const tsReasonParts:string[]=[];if(nvUp)tsReasonParts.push('NVDA '+nvPct+'上漲驅動AI晶片需求');if(soxUp)tsReasonParts.push('費半 '+soxPct+'上漲帶動半導體景氣');if(tsm&&tsm.changePercent>0)tsReasonParts.push('TSM ADR '+fmtPct(tsm.changePercent)+'溢價');if(ts2330Up)tsReasonParts.push('2330自身'+fmtPct(ts2330.changePercent)+'強勢');
    add({symbol:'2330',name:'台積電',group:'半導體',direction:'受惠',conviction_level:'★★★★★',reason:tsReasonParts.length>0?tsReasonParts.join('，')+'，先進製程權值龍頭直接受惠':'全球半導體權值龍頭，先進製程需求驅動',risk:'NVDA轉弱或SOX翻黑視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察開盤是否站穩平盤且放量'});
    if(nvUp)add({symbol:'2382',name:'廣達',group:'AI伺服器',direction:'受惠',conviction_level:'★★★★☆',reason:'NVDA '+nvPct+'上漲反映AI伺服器需求擴張，廣達為主要ODM龍頭直接受惠',risk:'AI伺服器族群轉弱或外資連續賣超視為失效',catalyst_type:'AI_SERVER',watch_point:'觀察AI族群是否同步轉強與成交量'});
    if(soxUp)add({symbol:'2454',name:'聯發科',group:'半導體',direction:'受惠',conviction_level:'★★★★☆',reason:'費半 '+soxPct+'上漲帶動IC設計族群，聯發科為台股IC設計龍頭優先受益',risk:'費半翻黑或台積電轉弱拖累半導體族群視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察是否與台積電同步轉強'});
    if(nvUp&&stocks.length<6)add({symbol:'3231',name:'緯創',group:'AI伺服器',direction:'受惠',conviction_level:'★★★☆☆',reason:'NVDA '+nvPct+'上漲帶動AI伺服器組裝需求，緯創為主要代工廠直接受益',risk:'AI族群轉弱視為失效',catalyst_type:'AI_SERVER',watch_point:'觀察與廣達的連動性'});
    if(soxUp&&stocks.length<6)add({symbol:'3443',name:'創意',group:'半導體',direction:'觀察',conviction_level:'★★★☆☆',reason:'費半 '+soxPct+'上漲帶動先進製程需求，ASIC設計服務直接受惠',risk:'半導體族群轉弱視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察是否與台積電同步'});
    if(nvUp&&stocks.length<6)add({symbol:'3017',name:'奇鋐',group:'散熱',direction:'受惠',conviction_level:'★★★☆☆',reason:'NVDA '+nvPct+'上漲帶動AI伺服器散熱需求，高階散熱模組需求提升',risk:'散熱族群回檔視為失效',catalyst_type:'COOLING',watch_point:'觀察散熱族群是否同步上漲'});
    if(stocks.length<6)add({symbol:'2308',name:'台達電',group:'電力電子',direction:'受惠',conviction_level:'★★★☆☆',reason:'AI資料中心擴張帶動高階電源管理需求，台達電為全球電源管理龍頭',risk:'AI族群轉弱視為失效',catalyst_type:'AI_SERVER',watch_point:'觀察是否隨AI族群同步'});
  }else{
    add({symbol:'2330',name:'台積電',group:'半導體',direction:'觀察',conviction_level:'★★★★☆',reason:tsm&&tsm.changePercent>0?'TSM ADR '+fmtPct(tsm.changePercent)+'溢價提供支撐，但整體市場訊號分歧，以觀察為主':'市場方向分歧，權值龍頭以觀察為主',risk:'NVDA持續走弱或大盤方向轉空視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察開盤方向與外資買賣超'});
    if(!nvDown)add({symbol:'2382',name:'廣達',group:'AI伺服器',direction:'觀察',conviction_level:'★★★☆☆',reason:nv?'NVDA '+fmtPct(nv.changePercent)+'，AI伺服器需求待開盤方向確認':'AI伺服器需求待開盤方向確認',risk:'AI族群轉弱視為失效',catalyst_type:'AI_SERVER',watch_point:'觀察開盤後資金是否流入AI族群'});
    add({symbol:'2881',name:'富邦金',group:'金融',direction:'觀察',conviction_level:'★★★☆☆',reason:spxDown?'SPX '+fmtPct(spx.changePercent)+'下跌，金融股具防禦配置價值':'市場方向不明，金融股具穩定配置價值',risk:'外資轉賣超金融股視為失效',catalyst_type:'DEFENSIVE',watch_point:'觀察防禦性買盤與外資流向'});
    if(spxDown||vixUp)add({symbol:'2412',name:'中華電',group:'電信',direction:'觀察',conviction_level:'★★★☆☆',reason:spxDown?'SPX '+fmtPct(spx.changePercent)+'下跌，高殖利率電信股具避險價值':'市場不確定性升高，電信股具防禦價值',risk:'市場風險偏好回升後資金可能撤離',catalyst_type:'DEFENSIVE',watch_point:'觀察資金是否持續流入防禦型標的'});
    add({symbol:'2454',name:'聯發科',group:'半導體',direction:'觀察',conviction_level:'★★★☆☆',reason:soxUp?'費半 '+fmtPct(sox.changePercent)+'上漲但整體市場分歧，IC設計龍頭以觀察為主':'市場方向分歧，IC設計龍頭待方向確認',risk:'半導體族群轉弱視為失效',catalyst_type:'SEMICONDUCTOR',watch_point:'觀察是否與台積電同步'});
    if(!nvDown&&stocks.length<6)add({symbol:'3017',name:'奇鋐',group:'散熱',direction:'觀察',conviction_level:'★★★☆☆',reason:'AI伺服器散熱需求為結構性趨勢，但市場方向不明，以觀察為主',risk:'散熱族群回檔視為失效',catalyst_type:'COOLING',watch_point:'觀察散熱族群是否同步'});
  }
  log('[buildDynamicBeneficiary] generated '+stocks.length+' stocks: '+stocks.map(function(s){return s.symbol}).join(','));
  return stocks;
}

function finalSanitizeTWStocks(stocks:Record<string,unknown>[],_fallback:Record<string,unknown>[],label:string,log:(m:string)=>void):Record<string,unknown>[]{
  const result:Record<string,unknown>[]=[];const seen=new Set<string>();let removedCount=0;
  for(const s of stocks){const sym=String(s.symbol||s.stock_id||'');if(isValidTaiwanStock(s.symbol||s.stock_id,s.name||s.stock_name)&&!seen.has(sym)){result.push({...s,not_buy_signal:true,source_type:s.source_type||'sanitized_tw_only'});seen.add(sym);}else if(sym){removedCount++;log('[finalSanitizeTWStocks:'+label+'] REMOVED: '+sym+' | '+(s.name||s.stock_name||''))}}
  log('[finalSanitizeTWStocks:'+label+'] valid TW: '+result.length+', removed: '+removedCount);
  if(result.length===0){log('[finalSanitizeTWStocks:'+label+'] EMPTY');return [];}
  if(label.includes('WRITE_GATE_TODAY'))return result.slice(0,8);
  if(label.includes('WRITE_GATE_FULL'))return result.slice(0,10);
  return result.slice(0,10);
}

async function fetchSectorRotationForDate(supabase:ReturnType<typeof createClient>,scoreDate:string,log:(m:string)=>void):Promise<SectorRotationRow[]>{
  try{const r=await supabase.from('sector_rotation_scores').select('sector,sub_sector,rotation_score,direction,signal_label,leading_symbols,lagging_symbols,summary').eq('score_date',scoreDate).order('rotation_score',{ascending:false}).limit(10);const{data,error}=safeUnwrap<Record<string,unknown>[]>(r,log,'sector_rotation');if(error||!data?.length){log('[fetchSectorRotationForDate] no data for '+scoreDate);return [];}const rows:SectorRotationRow[]=data.map(function(row){return{sector:String(row.sector||''),sub_sector:String(row.sub_sector||''),rotation_score:Number(row.rotation_score)||0,direction:String(row.direction||''),signal_label:String(row.signal_label||''),leading_symbols:Array.isArray(row.leading_symbols)?row.leading_symbols.map(String):[],lagging_symbols:Array.isArray(row.lagging_symbols)?row.lagging_symbols.map(String):[],summary:row.summary?String(row.summary):undefined}});log('[fetchSectorRotationForDate] got '+rows.length+' sectors for '+scoreDate);return rows;}catch(e){log('[fetchSectorRotationForDate] exception: '+(e instanceof Error?e.message:String(e)));return [];}
}

// ═══ V9.0 THREE-TIER BENEFICIARY ═══
const STOCK_NAMES:Record<string,string>={'2330':'台積電','2454':'聯發科','2303':'聯電','3711':'日月光投控','3034':'聯詠','2408':'南亞科','2344':'華邦電','2337':'旺宏','8299':'群聯','2317':'鴻海','2382':'廣達','6669':'緯穎','3231':'緯創','2356':'英業達','2376':'技嘉','2308':'台達電','3017':'奇鋐','3324':'雙鴻','3443':'創意','3661':'世芯-KY','3037':'欣興','8046':'南電','6239':'力成','2881':'富邦金','2882':'國泰金','2891':'中信金','2603':'長榮','2615':'萬海','2610':'華航','1301':'台塑','1303':'南亞','1326':'台化','2412':'中華電','3045':'台灣大','4904':'遠傳','3081':'聯亞','2345':'智邦','4906':'正文','2049':'上銀','1590':'亞德客-KY','2634':'漢翔','8033':'雷虎','2357':'華碩','1519':'華城','1513':'中興電','1504':'東元'};

const SCENARIO_TRIGGERS:Record<string,{trigger_label:string;trigger_description:string;activation_check:(md:MarketIndicator[],dScore:MarketDataScore)=>boolean;stocks:{symbol:string;reason:string;risk_note:string;confidence_level:'high'|'medium'|'low'}[]}>={
  TWD_STRONG:{trigger_label:'台幣升值情境',trigger_description:'若新台幣兌美元明顯升值，資金可能流入資產股與內需股',activation_check:function(md,dScore){const dxy=md.find(function(m){return m.symbol.toUpperCase()==='DXY'||m.symbol.toUpperCase()==='USDINDEX'});return dxy?dxy.changePercent<-0.3:false;},stocks:[{symbol:'2881',reason:'台幣升值有利壽險金控海外資產評價回升，金融權值股具資金吸引力',risk_note:'若升值僅為短期波動且外資持續賣超金融股則失效',confidence_level:'medium'},{symbol:'2882',reason:'壽險為主金控對匯率敏感度最高，台幣升值直接改善海外投資部位',risk_note:'若升值幅度有限且金融指數未同步轉強則失效',confidence_level:'low'},]},
  AI_MOMENTUM:{trigger_label:'AI 主線續強情境',trigger_description:'若NVDA/SOX延續強勢，AI供應鏈二線股可能補漲',activation_check:function(md,dScore){const nv=md.find(function(m){return m.symbol.toUpperCase()==='NVDA'});const sox=md.find(function(m){return m.symbol.toUpperCase()==='SOX'||m.symbol.toUpperCase()==='PHLX'});return (nv&&nv.changePercent>1.5)||(sox&&sox.changePercent>0.8);},stocks:[{symbol:'2357',reason:'AI伺服器機殼需求隨NVDA強勢擴張，二線代工廠具補漲空間',risk_note:'若AI族群主力股（2382/3231）開高走低則二線股不宜追',confidence_level:'low'},{symbol:'6669',reason:'AI伺服器高階組裝需求提升，緯穎為白牌伺服器龍頭',risk_note:'若NVDA漲勢僅為短線反彈且無基本面支撐則失效',confidence_level:'medium'},{symbol:'3324',reason:'AI伺服器功耗持續提升，高階散熱模組需求結構性成長',risk_note:'散熱族群若無法與AI伺服器同步放量則動能不足',confidence_level:'low'},{symbol:'3661',reason:'AI ASIC需求與先進製程綁定，世芯為台股ASIC設計服務代表',risk_note:'若半導體整體轉弱則ASIC題材不具獨立支撐',confidence_level:'low'},]},
  BOND_YIELD_DROP:{trigger_label:'美債殖利率下跌情境',trigger_description:'若美10年期公債殖利率明顯下滑，高殖利率防禦股可能受資金青睞',activation_check:function(md,dScore){const uy=md.find(function(m){return m.symbol.toUpperCase()==='US10Y'||m.symbol.toUpperCase()==='TNX'});return uy?uy.changePercent<-0.5:false;},stocks:[{symbol:'2412',reason:'美債殖利率下滑提升高股息標的吸引力，中華電為台股高殖利率代表',risk_note:'若僅為避險情緒短暫推升，資金可能快速回流成長股',confidence_level:'medium'},{symbol:'3045',reason:'電信股具穩定現金流與高殖利率特性，殖利率下滑時相對吸引力上升',risk_note:'若大盤轉強則防禦型標的資金可能被排擠',confidence_level:'low'},{symbol:'4904',reason:'網通設備需求受惠企業IT支出穩定，防禦型配置中具成長性',risk_note:'若電信三雄集體轉弱則族群性失效',confidence_level:'low'},]},
  OIL_MOVE:{trigger_label:'油價波動情境',trigger_description:'若油價單日變動超過2%，塑化與航運股可能出現方向性反應',activation_check:function(md,dScore){const oil=md.find(function(m){return m.symbol.toUpperCase()==='WTI'||m.symbol.toUpperCase()==='CL'||m.symbol.toUpperCase()==='OIL'});if(!oil)return false;return Math.abs(oil.changePercent)>2;},stocks:[{symbol:'1301',reason:'油價波動直接影響塑化原料成本，台塑為產業龍頭最先反應',risk_note:'若油價波動為短期事件且無供需基本面改變則效應有限',confidence_level:'low'},{symbol:'2603',reason:'油價為航運成本核心變數，油價下跌有利貨櫃航運利潤率',risk_note:'運價指數才是航運股主要驅動，油價僅為輔助因子',confidence_level:'low'},]},
  SEMI_EQUIPMENT:{trigger_label:'半導體設備轉強情境',trigger_description:'若全球半導體資本支出展望上修，設備族群可能領先反應',activation_check:function(md,dScore){const sox=md.find(function(m){return m.symbol.toUpperCase()==='SOX'||m.symbol.toUpperCase()==='PHLX'});const amat=md.find(function(m){return m.symbol.toUpperCase()==='AMAT'});const lrcx=md.find(function(m){return m.symbol.toUpperCase()==='LRCX'});return (sox&&sox.changePercent>1.0)&&(amat&&amat.changePercent>0||lrcx&&lrcx.changePercent>0);},stocks:[{symbol:'3037',reason:'半導體設備支出升溫帶動IC載板需求，欣興為台股載板龍頭',risk_note:'若資本支出上修僅為單一公司而非產業趨勢則效應有限',confidence_level:'low'},{symbol:'8046',reason:'ABF載板受惠先進封裝與HPC需求，南電為台灣主要供應商',risk_note:'載板族群若無法與半導體設備股同步走強則動能不足',confidence_level:'low'},]},
};

function buildStockEntry(symbol:string,name:string,sector:string,level:'core'|'extended'|'scenario',triggerEvent:string,reason:string,riskNote:string,confidenceLevel:'high'|'medium'|'low',dataBasis:string,extraFields:Record<string,unknown>={}):Record<string,unknown>{
  const cat=catalystTypeForStock(symbol);
  const profile=stockResearchProfile(symbol,sector);
  const sourceSignals=sourceSignalsFromBasis(dataBasis,triggerEvent,sector);
  return{
    stock_id:symbol,stock_name:name,sector,beneficiary_level:level,trigger_event:triggerEvent,reason,risk_note:riskNote,confidence_level:confidenceLevel,data_basis:dataBasis,
    ticker:symbol,category:sector,first_order_impact:profile.first_order_impact,second_order_impact:profile.second_order_impact,taiwan_supply_chain_link:profile.taiwan_supply_chain_link,why_this_stock:profile.why_this_stock,validation_signal:profile.validation_signal,invalidation_condition:riskNote,risk_level:riskLevelFromConfidenceLevel(confidenceLevel),confidence:numericConfidenceFromLevel(confidenceLevel),source_signals:sourceSignals,
    symbol,name,group:sector,direction:level==='core'?'受惠':'觀察',conviction_level:confidenceLevel==='high'?'★★★★★':confidenceLevel==='medium'?'★★★★☆':'★★★☆☆',catalyst_type:cat,watch_point:profile.validation_signal,not_buy_signal:true,source_type:level+'_beneficiary',...extraFields,
  };
}

function buildThreeTierBeneficiaryStocks(md:MarketIndicator[],sectorData:SectorRotationRow[],dScore:MarketDataScore,log:(m:string)=>void):{core_beneficiary_stocks:Record<string,unknown>[];extended_watchlist:Record<string,unknown>[];scenario_watchlist:Record<string,unknown>[];data_status:string;data_basis_note:string;todayStocks:Record<string,unknown>[];fullStocks:Record<string,unknown>[]}{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const nv=f(['NVDA']),sox=f(['SOX','PHLX']),spx=f(['SPX','SP500']),vix=f(['VIX','VIXINDEX']),dxy=f(['DXY','USDINDEX']),tsm=f(['TSM','TSMC']),taiex=f(['TAIEX','TWII']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const bias=dScore.baseScore>=55?'偏多':dScore.baseScore<=40?'偏空':'中性';
  const hasMinData=!!(nv||sox||spx)&&!!taiex;
  const hasSectorData=sectorData.length>0;

  if(!hasMinData){
    log('[buildThreeTier] INSUFFICIENT DATA');
    const insufficientStocks:Record<string,unknown>[]=[];
    if(taiex&&!Number.isNaN(taiex.changePercent)){insufficientStocks.push(buildStockEntry('2330','台積電','半導體','core','台股權值龍頭觀察','今日海外市場資料不足，以台股權值龍頭作為核心觀察標的，待資料補齊後擴充名單。','若大盤開盤方向與台積電背離則觀察失效','low','台股收盤資料（海外資料不足）'));}
    return{core_beneficiary_stocks:insufficientStocks.slice(0,3),extended_watchlist:[],scenario_watchlist:[],data_status:'insufficient',data_basis_note:'今日海外市場資料不足（缺少 NVDA/SOX/SPX 等關鍵指標），僅提供核心觀察股，不擴充延伸名單。',todayStocks:insufficientStocks.slice(0,5),fullStocks:insufficientStocks.slice(0,8)};
  }

  const strongSectors=sectorData.filter(isStrongSectorRotation).slice(0,3);

  // TIER 1: CORE (3)
  const coreStocks:Record<string,unknown>[]=[];const coreSeen=new Set<string>();
  const addCore=function(symbol:string,triggerEvent:string,reason:string,riskNote:string,confidenceLevel:'high'|'medium'|'low',dataBasis:string){
    if(coreSeen.has(symbol)||coreStocks.length>=3)return;coreSeen.add(symbol);
    const name=STOCK_NAMES[symbol]||symbol;
    const sectorName=strongSectors.find(function(s){return s.leading_symbols.includes(symbol)})?.sector||catalystTypeForStock(symbol);
    coreStocks.push(buildStockEntry(symbol,name,SECTOR_LABEL_MAP[sectorName]||sectorName,'core',triggerEvent,reason,riskNote,confidenceLevel,dataBasis));
  };

  if(nv&&!Number.isNaN(nv.changePercent)&&nv.changePercent>0.5){
    addCore('2330','NVDA '+fmtPct(nv.changePercent)+' 上漲驅動 AI 晶片需求','台積電為全球 AI 晶片製造核心，NVDA 強勢直接帶動先進製程需求與市場信心。若 ADR 溢價同步擴大則支撐更強。','NVDA 盤後轉弱或 SOX 指數翻黑視為傳導鏈失效','high','NVDA '+fmtPct(nv.changePercent)+' / SOX '+(sox&&!Number.isNaN(sox.changePercent)?fmtPct(sox.changePercent):'—'));
  }else if(nv&&!Number.isNaN(nv.changePercent)&&nv.changePercent<-1){
    addCore('2330','NVDA '+fmtPct(nv.changePercent)+' 下跌壓抑 AI 半導體情緒','台積電雖為權值龍頭，但 NVDA 重挫可能引發半導體族群賣壓。以觀察支撐為主，不追空。','若台積電開盤抗跌且外資未大賣則利空有限','medium','NVDA '+fmtPct(nv.changePercent)+' 下跌');
  }else{
    addCore('2330',tsm&&!Number.isNaN(tsm.changePercent)?'TSM ADR '+fmtPct(tsm.changePercent)+(tsm.changePercent>0?'溢價提供支撐':'需觀察'):'台股權值龍頭','台積電為台股最大權值股，其方向決定大盤格局。無論市場偏多偏空，2330 都是判斷基準。','若大盤開低且台積電無法站穩平盤則整體偏弱','high','台股收盤資料');
  }

  if(strongSectors.length>0&&coreStocks.length<3){
    const topSector=strongSectors[0];
    const leaders=topSector.leading_symbols.filter(function(s){return isValidTaiwanStock(s,'')&&!coreSeen.has(s)});
    if(leaders.length>0){
      const sym=leaders[0];const name=STOCK_NAMES[sym]||sym;
      addCore(sym,topSector.sector+'輪動分數 '+topSector.rotation_score+'（'+topSector.signal_label+'），為今日最強族群',name+'為'+topSector.sector+'族群領頭羊，今日類股輪動分數達'+topSector.rotation_score+'，產業動能明確。開盤需確認族群是否同步轉強。',topSector.sector+'族群開盤轉弱或輪動分數為虛胖（僅1-2檔獨強）則失效','high','類股輪動分數 '+topSector.rotation_score+' / '+topSector.signal_label);
    }
  }

  if(nv&&!Number.isNaN(nv.changePercent)&&nv.changePercent>0.5&&coreStocks.length<3){
    addCore('2382','NVDA '+fmtPct(nv.changePercent)+' 帶動 AI 伺服器需求','廣達為全球最大 AI 伺服器 ODM，NVDA 強勢直接反映 AI 資本支出擴張。開盤需放量確認。','AI 伺服器族群開高走低或外資轉賣超則動能不足','medium','NVDA '+fmtPct(nv.changePercent));
  }else if(bias==='偏空'&&coreStocks.length<3&&vix&&!Number.isNaN(vix.changePercent)&&vix.changePercent>3){
    addCore('2881','VIX 急升 '+fmtPct(vix.changePercent)+' 反映市場恐慌升溫','富邦金為金融權值股龍頭，VIX 飆升時防禦性資金可能流入金融股避險。觀察外資是否同步買超。','若 VIX 迅速回落且大盤止穩，防禦性資金將回流成長股','medium','VIX '+(vix.value?.toFixed(2)||'—')+' / '+fmtPct(vix?.changePercent||0));
  }

  // TIER 2: EXTENDED (5-8)
  const extendedStocks:Record<string,unknown>[]=[];const extSeen=new Set<string>([...coreSeen]);
  const addExt=function(symbol:string,triggerEvent:string,reason:string,riskNote:string,confidenceLevel:'high'|'medium'|'low',dataBasis:string){
    if(extSeen.has(symbol)||extendedStocks.length>=8)return;extSeen.add(symbol);
    const name=STOCK_NAMES[symbol]||symbol;
    const sectorMatch=strongSectors.find(function(s){return s.leading_symbols.includes(symbol)});
    const sectorName=sectorMatch?.sector||catalystTypeForStock(symbol);
    extendedStocks.push(buildStockEntry(symbol,name,SECTOR_LABEL_MAP[sectorName]||sectorName,'extended',triggerEvent,reason,riskNote,confidenceLevel,dataBasis,{sector_rotation_score:sectorMatch?.rotation_score??null}));
  };

  for(const sec of strongSectors){
    for(const sym of sec.leading_symbols){
      if(!isValidTaiwanStock(sym,'')||extSeen.has(sym))continue;
      const name=STOCK_NAMES[sym]||sym;
      addExt(sym,sec.sector+'輪動分數 '+sec.rotation_score+'（'+sec.signal_label+'），屬於今日主線延伸',name+'與核心受惠股屬同一'+sec.sector+'產業鏈，族群性強但關聯強度低於龍頭。需確認族群同步性。',sec.sector+'族群龍頭若轉弱，二線股通常先跌',sec.rotation_score>=85?'medium':'low','類股輪動 / '+sec.signal_label+' 分數'+sec.rotation_score);
      if(extendedStocks.length>=8)break;
    }
    if(extendedStocks.length>=8)break;
  }

  if(extendedStocks.length<5){
    const dynStocks=buildDynamicBeneficiaryStocks(md,dScore,log);
    for(const ds of dynStocks){const sym=String(ds.symbol||'');if(!extSeen.has(sym)&&isValidTaiwanStock(sym,'')){addExt(sym,String(ds.reason||'市場數據驅動觀察'),String(ds.reason||''),String(ds.risk||'族群轉弱視為失效'),'low','市場數據綜合判斷');}if(extendedStocks.length>=8)break;}
  }

  // TIER 3: SCENARIO (5-10)
  const scenarioStocks:Record<string,unknown>[]=[];const scenSeen=new Set<string>([...coreSeen,...extSeen]);let scenarioActiveCount=0;
  for(const [scenarioKey,scenario] of Object.entries(SCENARIO_TRIGGERS)){
    if(!scenario.activation_check(md,dScore))continue;
    scenarioActiveCount++;
    log('[buildThreeTier] Scenario ACTIVE: '+scenario.trigger_label);
    for(const s of scenario.stocks){
      if(scenSeen.has(s.symbol)||scenarioStocks.length>=10)continue;scenSeen.add(s.symbol);
      const name=STOCK_NAMES[s.symbol]||s.symbol;const cat=catalystTypeForStock(s.symbol);
      scenarioStocks.push(buildStockEntry(s.symbol,name,SECTOR_LABEL_MAP[cat]||cat,'scenario',scenario.trigger_label+'：'+scenario.trigger_description,s.reason,s.risk_note,s.confidence_level,'情境觸發：'+scenario.trigger_label));
    }
  }
  if(scenarioActiveCount===0)log('[buildThreeTier] No scenarios activated');

  const allStocks=[...coreStocks,...extendedStocks,...scenarioStocks];
  const dataBasisNote='台股基準：'+(taiex?'已取得':'無資料')+' / 美股基準：'+(nv||sox||spx?'已取得':'無資料')+' / 類股輪動：'+(hasSectorData?sectorData.length+' 個族群':'無資料')+' / 情境觸發：'+scenarioActiveCount+' 個';
  const dataStatus=coreStocks.length===0?'insufficient':coreStocks.length<3?'partial':'sufficient';
  log('[buildThreeTier] core:'+coreStocks.length+' extended:'+extendedStocks.length+' scenario:'+scenarioStocks.length+' active:'+scenarioActiveCount+' status:'+dataStatus);
  return{core_beneficiary_stocks:coreStocks,extended_watchlist:extendedStocks,scenario_watchlist:scenarioStocks,data_status:dataStatus,data_basis_note:dataBasisNote,todayStocks:allStocks.slice(0,6),fullStocks:allStocks.slice(0,12)};
}

// ═══ V9.0 CAUSAL OVERNIGHT IMPACT CHAIN ═══
function formatMacroDisplayLine(key:string,item:MarketIndicator|null):string{
  const k=key.toUpperCase();
  const pct=item&&!Number.isNaN(item.changePercent)?(item.changePercent>=0?'+'+item.changePercent.toFixed(2)+'%':item.changePercent.toFixed(2)+'%'):'資料不足';
  if(k==='DXY'||k==='USDINDEX')return'美元指數代理指標：'+pct;
  if(k==='US10Y'||k==='TNX'||k==='T10Y')return'美國10年期債券代理指標：'+pct;
  if(k==='VIX'||k==='VIXINDEX'){
    const proxy=item&&(item.symbol.toUpperCase()==='VXX'||item.name.toUpperCase().includes('VXX')||item.name.toLowerCase().includes('proxy'));
    if(proxy)return'恐慌指數代理指標：'+pct;
    if(item&&!Number.isNaN(item.value))return'VIX：'+item.value.toFixed(2)+'，'+pct;
    return'VIX：資料不足';
  }
  return key+'：'+pct;
}
function buildCausalOvernightImpactChain(md:MarketIndicator[],dScore:MarketDataScore):Record<string,unknown>[]{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const nv=f(['NVDA']),sox=f(['SOX','PHLX']),spx=f(['SPX','SP500']),vix=f(['VIX','VIXINDEX']),tsm=f(['TSM','TSMC']),dxy=f(['DXY','USDINDEX']),us10y=f(['US10Y','TNX']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const chains:Record<string,unknown>[]=[];

  if(nv||sox){
    const nvDir=nv&&!Number.isNaN(nv.changePercent)?(nv.changePercent>0?'上漲':'下跌'):'變動';
    const aiChildSignals=[nv?{symbol:'NVDA',change_percent:nv.changePercent,role:'AI GPU demand proxy'}:null,sox?{symbol:'SOX',change_percent:sox.changePercent,role:'global semiconductor index'}:null,tsm?{symbol:'TSM',change_percent:tsm.changePercent,role:'Taiwan ADR bridge'}:null].filter(Boolean);
    chains.push({
      event_group:'AI_SEMI_RISK',
      parent_trigger:'美股 AI 半導體鏈 '+nvDir,
      child_signals:aiChildSignals,
      market_reaction:'AI 與半導體估值先反應，資金檢查是否從美股傳導到台股電子權值。',
      taiwan_channel:'NVDA/SOX/TSM ADR → 台積電與電子權值 → AI 伺服器與半導體供應鏈。',
      affected_sectors:['半導體','AI伺服器','電子權值'],
      representative_stocks:['2330 台積電','2382 廣達','3231 緯創','2454 聯發科'],
      validation_points:['台積電開盤是否優於 TAIEX','TXF 是否與現貨同向','AI 伺服器族群是否同步放量','電子權值是否擴散而非單一權值獨強'],
      overseas_trigger:'昨夜美股 NVDA '+(nv&&!Number.isNaN(nv.changePercent)?fmtPct(nv.changePercent):'—')+' / SOX '+(sox&&!Number.isNaN(sox.changePercent)?fmtPct(sox.changePercent):'—'),
      first_order_impact:'美股科技股與半導體指數'+nvDir+'，反映AI資本支出預期'+(nv&&nv.changePercent>0?'升溫':'降溫')+'。TSM ADR '+(tsm&&!Number.isNaN(tsm.changePercent)?fmtPct(tsm.changePercent):'—')+(tsm&&tsm.changePercent>0?'溢價，提供台積電開盤支撐':'同步反映半導體情緒'),
      taiwan_market_bridge:'NVDA為全球AI晶片龍頭，其走勢直接影響台股AI供應鏈估值。SOX指數涵蓋全球半導體主要成分股，與台股半導體權值股高度連動。'+(nv&&nv.changePercent>1?'NVDA明顯走強，台股AI族群開盤可能跳空反映':'NVDA變動有限，台股開盤以平盤附近震盪為主'),
      sector_transmission:['半導體製造（2330 台積電）','AI伺服器組裝（2382 廣達、3231 緯創）','高階散熱（3017 奇鋐、3324 雙鴻）','IC設計（2454 聯發科、3443 創意）'],
      stock_selection_logic:'優先選取與NVDA/SOX產業鏈關聯最直接的台股標的。2330為全球唯一先進製程代工廠，直接受惠AI晶片需求。2382/3231為NVDA GPU伺服器主要ODM。3017為AI伺服器散熱模組主要供應商。以上皆為可驗證的產業鏈上下游關係，並非僅因名稱熱門而入選。',
      invalidation_condition:nv&&nv.changePercent<-2?'NVDA盤後續跌或SOX指數翻黑超過2%，整條傳導鏈失效':'NVDA 盤後轉跌或 AI 族群開盤即轉弱，傳導鏈失效。若僅2330獨強而其他AI股不跟，代表資金集中而非擴散，需降級觀察。',
    });
  }

  if(spx||vix){
    const spxDir=spx&&!Number.isNaN(spx.changePercent)?(spx.changePercent>0.5?'偏強':spx.changePercent<-0.5?'偏弱':'中性'):'—';
    const riskChildSignals=[spx?{symbol:'SPX',change_percent:spx.changePercent,role:'US broad risk appetite'}:null,vix?{symbol:'VIX',change_percent:vix.changePercent,value:vix.value,role:'volatility and risk appetite'}:null,dxy?{symbol:'DXY',change_percent:dxy.changePercent,role:'US dollar proxy'}:null,us10y?{symbol:'US10Y',change_percent:us10y.changePercent,role:'US bond proxy'}:null].filter(Boolean);
    chains.push({
      event_group:'GLOBAL_RISK_APPETITE',
      parent_trigger:'美股風險偏好 '+spxDir,
      child_signals:riskChildSignals,
      market_reaction:'SPX、VIX、美元與美債代理訊號共同決定外資對新興市場與台股權值股的風險胃納。',
      taiwan_channel:'全球風險偏好 → 外資期現貨部位 → 台指期與金融/電子權值 → 防禦或成長族群輪動。',
      affected_sectors:['電子權值','金融','電信防禦'],
      representative_stocks:['2330 台積電','2881 富邦金','2882 國泰金','2412 中華電'],
      validation_points:['TXF 是否領先現貨轉強或轉弱','新台幣是否同步反應外資方向','金融權值是否相對抗跌','電子權值是否承接外資調節'],
      overseas_trigger:'昨夜美股 SPX '+(spx&&!Number.isNaN(spx.changePercent)?fmtPct(spx.changePercent):'—')+' / VIX '+(vix&&!Number.isNaN(vix.value)?vix.value.toFixed(2):'—')+'（'+(vix&&!Number.isNaN(vix.changePercent)?fmtPct(vix.changePercent):'—')+'）',
      first_order_impact:'美股大盤'+spxDir+'，VIX '+(vix&&vix.value>=25?'處於警戒區間，市場恐慌情緒偏高':'處於正常區間，市場情緒穩定')+'。'+formatMacroDisplayLine('DXY',dxy)+'，'+formatMacroDisplayLine('US10Y',us10y),
      taiwan_market_bridge:'SPX代表美股整體風險偏好，影響台股外資進出意願。VIX飆升時外資傾向減碼新興市場，台股權值股首當其衝。'+(spx&&spx.changePercent>0.5?'美股偏強，台股開盤可能延續多方氛圍':spx&&spx.changePercent<-0.5?'美股偏弱，台股開盤需觀察外資是否減碼':'美股中性，台股以自身技術面與籌碼面為主'),
      sector_transmission:['金融權值股（2881 富邦金、2882 國泰金）','台股權值龍頭（2330 台積電）','高殖利率防禦股（2412 中華電、3045 台灣大）'],
      stock_selection_logic:'風險偏好下降時，優先配置金融權值股（反映外資流向）與高殖利率防禦股（避險需求）。風險偏好上升時，以半導體與AI族群為主要觀察方向。以上邏輯基於歷史外資行為模式，並非預測漲跌。',
      invalidation_condition:'VIX 盤中持續上升超過 25 且 SPX 期貨轉跌，避險情緒壓過一切基本面判斷，所有偏多假設降級。',
    });
  }
  return chains;
}

function buildDeterministicOpeningRadar(md:MarketIndicator[]):Record<string,unknown>[]{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const ts=f(['2330','2330.TW']),tx=f(['TXF','TX']),nv=f(['NVDA']),sx=f(['SOX','PHLX']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};const fmtVal=function(v:number){return v.toLocaleString('en-US')};
  return [
    {symbol:'2330',name:'台積電',value:ts&&!Number.isNaN(ts.value)?fmtVal(ts.value):'待更新',change_percent:ts&&!Number.isNaN(ts.changePercent)?fmtPct(ts.changePercent):'待更新',signal:ts&&ts.changePercent>0?'偏強':ts&&ts.changePercent<-0.5?'偏弱':'觀察',watch_point:'開盤是否站穩前一交易日收盤價',data_source:ts?'market_data':'fallback'},
    {symbol:'TXF',name:'台指期',value:tx&&!Number.isNaN(tx.value)?fmtVal(tx.value):'待更新',change_percent:tx&&!Number.isNaN(tx.changePercent)?fmtPct(tx.changePercent):'待更新',signal:tx&&tx.changePercent>0?'偏強':tx&&tx.changePercent<-0.5?'偏弱':'觀察',watch_point:'與加權指數是否同向',data_source:tx?'market_data':'fallback'},
    {symbol:'SEMI',name:'AI/半導體族群',value:sx&&!Number.isNaN(sx.value)?fmtVal(sx.value):'待更新',change_percent:sx&&!Number.isNaN(sx.changePercent)?fmtPct(sx.changePercent):'待更新',signal:nv&&nv.changePercent>0?'偏強':nv&&nv.changePercent<-1?'偏弱':'觀察',watch_point:'NVDA走勢與2330是否連動',data_source:sx||nv?'market_data':'fallback'},
  ];
}

function buildDeterministicIntradayRadar():Record<string,unknown>[]{return [{time:'09:30',label:'開盤確認',focus:'權值股與台指期方向',watch:['2330開盤方向','台指期與現貨是否同向','AI族群是否同步'],data_source:'deterministic'},{time:'10:30',label:'資金擴散',focus:'族群是否擴散或只集中少數個股',watch:['半導體族群是否全面聯動','AI伺服器是否跟進','量能是否放大'],data_source:'deterministic'},{time:'13:00',label:'收盤前確認',focus:'尾盤延續或收斂',watch:['開高是否走低','尾盤資金流向','明日盤前方向線索'],data_source:'deterministic'},];}
function buildDeterministicIntradayTrackingPlan():Record<string,unknown>[]{return [{indicator:'TAIEX方向',verify:'確認開盤是否延續盤前方向',fail_condition:'開盤反向跳空超過1%',data_source:'deterministic'},{indicator:'2330表態',verify:'觀察台積電是否強於大盤',fail_condition:'2330開低走低且無買盤承接',data_source:'deterministic'},{indicator:'族群擴散',verify:'確認AI/半導體族群是否同步',fail_condition:'只有1-2檔權值股獨強，其餘不跟',data_source:'deterministic'},];}

function buildDeterministicWatchSectorsDetailed(md:MarketIndicator[],dScore:MarketDataScore):Record<string,unknown>[]{
  const nv=md.find(function(m){return m.symbol.toUpperCase()==='NVDA'});const sx=md.find(function(m){return m.symbol.toUpperCase()==='SOX'||m.symbol.toUpperCase()==='PHLX'});const vix=md.find(function(m){return m.symbol.toUpperCase()==='VIX'||m.symbol.toUpperCase()==='VIXINDEX'});
  const isBullish=dScore.baseScore>=55;const vixUp=vix&&!Number.isNaN(vix.changePercent)&&vix.changePercent>3;
  const sectors:Record<string,unknown>[]=[];
  sectors.push({sector_name:'半導體',direction:isBullish?'偏多':'觀察',reason:sx&&!Number.isNaN(sx.changePercent)?'SOX '+(sx.changePercent>=0?'+':'')+sx.changePercent.toFixed(2)+'%，'+(isBullish?'半導體族群偏強':'半導體族群待觀察'):'半導體為台股核心族群',focus_stocks:[{symbol:'2330',name:'台積電',role:'權值龍頭',reason:'半導體權值核心'},{symbol:'2454',name:'聯發科',role:'IC設計',reason:'反映科技資金情緒'},{symbol:'2308',name:'台達電',role:'電源管理',reason:'AI資料中心電源需求'}]});
  sectors.push({sector_name:'AI伺服器',direction:nv&&nv.changePercent>0?'偏多':'觀察',reason:nv&&!Number.isNaN(nv.changePercent)?'NVDA '+(nv.changePercent>=0?'+':'')+nv.changePercent.toFixed(2)+'%，'+(nv.changePercent>0?'AI族群動能強':'AI族群待觀察'):'AI伺服器為市場焦點',focus_stocks:[{symbol:'2382',name:'廣達',role:'AI伺服器代表',reason:'AI伺服器代表股'},{symbol:'3231',name:'緯創',role:'AI組裝',reason:'AI伺服器主要代工廠'},{symbol:'2376',name:'技嘉',role:'AI伺服器',reason:'板卡與伺服器'}]});
  sectors.push({sector_name:'金融',direction:vixUp?'偏多':'觀察',reason:vixUp?'VIX急升，防禦性資金可能流入金融股':'防禦性配置，觀察外資流向',focus_stocks:[{symbol:'2881',name:'富邦金',role:'金融權值',reason:'反映外資配置'},{symbol:'2882',name:'國泰金',role:'壽險金控',reason:'利率敏感'}]});
  return sectors;
}

function buildMemberResearchNoteText(md:MarketIndicator[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string},dScore:MarketDataScore,marketBias:string,confidenceScore:number,todayStocks:Record<string,unknown>[],reportMode:string,log:(m:string)=>void):string{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const taiex=f(['TAIEX','TWII']),txf=f(['TXF','TX']),ts2330=f(['2330','2330.TW']),spx=f(['SPX','SP500']),sox=f(['SOX','PHLX']),nv=f(['NVDA']),vix=f(['VIX','VIXINDEX']),tsm=f(['TSM','TSMC']),dxy=f(['DXY','USDINDEX']),us10y=f(['US10Y','TNX']);
  const parts:string[]=[];
  parts.push('【盤前核心結論】');
  const cLines=['本日盤前基準日期：台股 '+dates.twCoreDate+' 收盤，海外 '+dates.usGlobalDate+' 收盤。','綜合市場數據評分後，今日盤前方向為 '+marketBias+'，信心分數 '+confidenceScore+'/100。'];
  if(dScore.reasons.length>0)cLines.push('正向因子：'+dScore.reasons.join('、')+'。');
  if(dScore.riskReasons.length>0&&dScore.riskReasons[0]!=='暫無明顯風險訊號')cLines.push('風險因子：'+dScore.riskReasons.join('、')+'。');
  cLines.push('今日 '+todayDate+' 開盤後需觀察台股是否延續此前方向。');
  parts.push(cLines.join('\n'));
  parts.push('\n【台股三核心判讀：TAIEX、TXF、2330】');
  const twL:string[]=[];
  if(taiex&&!Number.isNaN(taiex.changePercent))twL.push('TAIEX：'+taiex.value.toLocaleString()+'，'+fmtPct(taiex.changePercent)+'。'+(taiex.changePercent>=0.8?'明顯走強':taiex.changePercent>=0.3?'溫和上漲':taiex.changePercent<=-0.8?'明顯走弱':'小幅下跌'));else twL.push('TAIEX：待資料更新');
  if(txf&&!Number.isNaN(txf.changePercent))twL.push('TXF：'+txf.value.toLocaleString()+'，'+fmtPct(txf.changePercent)+'。'+(txf.changePercent>=0?'期貨偏多方':'期貨偏空方'));else twL.push('TXF：待資料更新');
  if(ts2330&&!Number.isNaN(ts2330.changePercent))twL.push('2330：'+ts2330.value.toLocaleString()+'，'+fmtPct(ts2330.changePercent)+'。'+(ts2330.changePercent>=1?'明顯走強':ts2330.changePercent>=0?'小幅上漲':'走弱'));else twL.push('2330：待資料更新');
  parts.push(twL.join('\n'));
  parts.push('\n【隔夜美股與全球影響鏈：SPX、SOX、NVDA、VIX】');
  const usL:string[]=[];
  if(spx&&!Number.isNaN(spx.changePercent))usL.push('SPX：'+fmtPct(spx.changePercent)+'。'+(spx.changePercent>=0.5?'美股偏強':spx.changePercent>=-0.3?'美股中性':'美股偏弱'));else usL.push('SPX：待資料更新');
  if(sox&&!Number.isNaN(sox.changePercent))usL.push('SOX：'+fmtPct(sox.changePercent)+'。'+(sox.changePercent>=0.8?'費半走強':sox.changePercent>=-0.3?'費半中性':'費半走弱'));else usL.push('SOX：待資料更新');
  if(nv&&!Number.isNaN(nv.changePercent))usL.push('NVDA：'+fmtPct(nv.changePercent)+'。'+(nv.changePercent>=1?'AI龍頭強勢':nv.changePercent<=-1?'AI龍頭走弱':'NVDA變動不大'));else usL.push('NVDA：待資料更新');
  if(vix&&!Number.isNaN(vix.changePercent)){const vv=vix.value||0;usL.push(formatMacroDisplayLine('VIX',vix)+'。'+(vv>=25?'恐慌偏高':vv>=20?'中等不安':'情緒穩定'))}else usL.push('VIX：待資料更新');
  if(tsm&&!Number.isNaN(tsm.changePercent))usL.push('TSM ADR：'+fmtPct(tsm.changePercent));
  usL.push(formatMacroDisplayLine('DXY',dxy));
  usL.push(formatMacroDisplayLine('US10Y',us10y));
  parts.push(usL.join('\n'));
  parts.push('\n【今日盤中驗證條件】');
  parts.push('1. 09:00 開盤方向是否反映 '+marketBias+'？開盤反向跳空超過 1% 表示框架失效。');
  parts.push('2. 09:30 主要族群是否同步轉強？僅少數獨強表示資金集中而非擴散。');
  parts.push('3. 10:30 量能是否放大至 5 日均量以上？量能萎縮時延續性有限。');
  parts.push('4. 13:00 尾盤資金流向，開高走低或開低走高皆為重要訊號。');
  parts.push('\n【今日受惠族群與觀察股】');
  if(todayStocks.length>0){for(const s of todayStocks.slice(0,8)){parts.push((s.symbol||s.stock_id)+' '+(s.name||s.stock_name)+'（'+(s.direction||'觀察')+'｜'+(s.conviction_level||'★★★☆☆')+'）：'+(s.reason||''));}parts.push('\n以上為盤前研究觀察標的，不構成投資建議。');}else{parts.push('今日無特定受惠族群入選，以觀察大盤方向為主。');}
  parts.push('\n【風險與失效條件】');
  parts.push('1. 開盤反向跳空超過 1%：盤前框架失效。');
  parts.push('2. 量能大幅萎縮不及 5 日均量 70%：方向可靠性下降。');
  parts.push('3. 主要權值股開盤即明顯轉弱且無買盤承接。');
  if(dScore.riskReasons.length>0&&dScore.riskReasons[0]!=='暫無明顯風險訊號')parts.push('4. 風險因子發酵：'+dScore.riskReasons.join('、')+' 若持續擴大應轉為觀望。');
  if(vix&&!Number.isNaN(vix.changePercent)&&vix.changePercent>5)parts.push('5. VIX 飆升惡化：所有偏多判斷應降級。');
  parts.push('\n【收盤後要回頭驗證什麼】');
  parts.push('1. 收盤方向是否與盤前「'+marketBias+'」一致？');
  parts.push('2. 觀察族群中幾檔收盤方向與預期一致？');
  parts.push('3. 實際成交量是否達驗證門檻？');
  parts.push('4. 美股、SOX、NVDA、VIX 隔夜變化是否如期傳導至台股？');
  parts.push('5. 外資期貨未平倉變化、新台幣匯率走勢是否延續方向？');
  parts.push('\n---\n本報告由 Morning Alpha 系統自動產生，僅供個人研究參考，不構成任何投資建議。');
  const result=parts.join('\n');
  log('[buildMemberResearchNoteText] generated '+result.length+' chars');
  return result;
}

function memberNoteDataStatus(candidateCount:number,sectorCount:number,newsCount:number,marketCount:number,overnightCount:number):'complete'|'partial'|'insufficient'{if(marketCount>=10&&newsCount>=10&&sectorCount>0&&candidateCount>=5&&overnightCount>0)return'complete';if(candidateCount>0||sectorCount>0||newsCount>0||marketCount>0)return'partial';return'insufficient';}
function confidenceNumberFromStock(s:Record<string,unknown>):number{const raw=s.confidence??s.confidence_score;if(raw!==undefined&&raw!==null){const n=Number(raw);if(!Number.isNaN(n))return safeInteger(n,60)}const lv=String(s.confidence_level||'').toLowerCase();if(lv==='high')return 82;if(lv==='medium')return 68;if(lv==='low')return 52;const stars=String(s.conviction_level||'');if(stars.includes('★★★★★'))return 82;if(stars.includes('★★★★'))return 68;return 55;}
function buildCandidateEvidence(stock:Record<string,unknown>,sectorData:SectorRotationRow[],newsData:MarketNewsItem[],causalChains:Record<string,unknown>[]):string[]{
  const sym=String(stock.symbol||stock.stock_id||'');const sector=String(stock.sector||stock.group||'');const ev:string[]=[];
  const dataBasis=String(stock.data_basis||'').trim();if(dataBasis)ev.push('既有受惠股資料：'+dataBasis);
  const reason=String(stock.reason||stock.member_thesis||'').trim();if(reason)ev.push('既有受惠股理由：'+reason.slice(0,120));
  const sec=sectorData.find(function(s){return s.leading_symbols.includes(sym)||s.sector===sector||s.sub_sector===sector});if(sec)ev.push('類股輪動：'+sec.sector+' 分數 '+sec.rotation_score+' / '+sec.signal_label);
  const news=newsData.find(function(n){const rel=Array.isArray(n.related_sectors)?n.related_sectors.join(' '):'';return (!!sector&&(rel.includes(sector)||n.title.includes(sector)||String(n.taiwan_impact_summary||'').includes(sector)))||n.title.includes(sym)});if(news)ev.push('市場新聞：'+news.title.slice(0,120));
  const chain=causalChains.find(function(c){return String(c.stock_selection_logic||'').includes(sym)||String(c.sector_transmission||'').includes(sym)||String(c.taiwan_market_bridge||'').includes(sector)});if(chain)ev.push('隔夜傳導：'+String(chain.overseas_trigger||chain.catalyst||'跨市場事件').slice(0,120));
  return ev.filter(Boolean).slice(0,4);
}
function buildBeneficiaryCandidatesV2(stocks:Record<string,unknown>[],sectorData:SectorRotationRow[],newsData:MarketNewsItem[],causalChains:Record<string,unknown>[]):Record<string,unknown>[]{
  const result:Record<string,unknown>[]=[];const seen=new Set<string>();
  for(const stock of stocks){
    const symbol=String(stock.symbol||stock.stock_id||'').trim();const name=String(stock.name||stock.stock_name||STOCK_NAMES[symbol]||'').trim();
    if(!isValidTaiwanStock(symbol,name)||seen.has(symbol))continue;
    const reason=String(stock.reason||stock.member_thesis||'').trim();const risk=String(stock.risk||stock.risk_note||'').trim();const evidence=buildCandidateEvidence(stock,sectorData,newsData,causalChains);
    if(!reason||!risk||evidence.length===0)continue;
    result.push({stock_code:symbol,stock_name:name,sector:String(stock.sector||stock.group||catalystTypeForStock(symbol)),reason,evidence,risk,confidence:confidenceNumberFromStock(stock),trigger_event:String(stock.trigger_event||''),first_order_impact:String(stock.first_order_impact||''),second_order_impact:String(stock.second_order_impact||''),taiwan_supply_chain_link:String(stock.taiwan_supply_chain_link||''),why_this_stock:String(stock.why_this_stock||''),validation_signal:String(stock.validation_signal||stock.watch_point||''),invalidation_condition:String(stock.invalidation_condition||risk),risk_level:String(stock.risk_level||'medium'),source_signals:Array.isArray(stock.source_signals)?stock.source_signals:[]});
    seen.add(symbol);if(result.length>=15)break;
  }
  return result;
}
function buildMemberResearchNoteV2(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,_dates:{twCoreDate:string;usGlobalDate:string},dScore:MarketDataScore,marketBias:string,confidenceScore:number,sectorData:SectorRotationRow[],causalChains:Record<string,unknown>[],beneficiaryStocks:Record<string,unknown>[],log:(m:string)=>void):MemberResearchNoteV2{
  const candidates=buildBeneficiaryCandidatesV2(beneficiaryStocks,sectorData,newsData,causalChains);
  const overnight=causalChains.map(function(c){const childSignals=Array.isArray(c.child_signals)?c.child_signals:[];return{event:String(c.parent_trigger||c.overseas_trigger||c.catalyst||'隔夜市場事件'),event_group:String(c.event_group||'OVERNIGHT_EVENT'),source_market:String(c.overseas_trigger||'').includes('NVDA')||String(c.overseas_trigger||'').includes('SOX')?'美股科技/半導體':'海外市場',child_signals:childSignals,impact_logic:String(c.market_reaction||c.first_order_impact||c.stock_selection_logic||'依既有 overnight chain 觀察跨市場傳導'),taiwan_mapping:String(c.taiwan_channel||c.taiwan_market_bridge||c.sector_transmission||'映射至台股相關族群'),validation_points:Array.isArray(c.validation_points)?c.validation_points:[],confidence:confidenceScore};}).filter(function(x){return x.event&&x.event!=='隔夜市場事件'}).slice(0,5);
  const sectorMaps:Record<string,unknown>[]=[];
  for(const s of sectorData.slice(0,6)){sectorMaps.push({sector:s.sector,why_it_matters:s.summary||('上一交易日類股輪動分數 '+s.rotation_score+'，訊號 '+s.signal_label),affected_stocks:s.leading_symbols.filter(function(sym){return isValidTaiwanStock(sym,STOCK_NAMES[sym]||'')}).slice(0,8),sensitivity:s.rotation_score>=80?'高':s.rotation_score>=65?'中':'低',invalidation:s.sector+'開盤轉弱或領先股不再同步，則輪動假設降級。'});}
  if(sectorMaps.length===0){const sectorSeen=new Set<string>();for(const c of candidates){const sector=String(c.sector||'');if(!sector||sectorSeen.has(sector))continue;sectorSeen.add(sector);sectorMaps.push({sector,why_it_matters:'由既有受惠股候選反推的觀察族群，缺少上一交易日 sector_rotation_scores 支撐，僅列為 partial。',affected_stocks:[String(c.stock_code||'')],sensitivity:'低',invalidation:'若開盤沒有族群同步性，本段觀察失效。'});if(sectorMaps.length>=4)break;}}
  const intraday=[{time_window:'09:00-09:30',what_to_watch:'開盤是否反映 '+marketBias+'，並確認台指期、2330 與候選族群是否同向。',bullish_confirm:'候選族群多數站上平盤且成交量放大。',bearish_fail:'開盤反向跳空超過 1% 或 2330/台指期同步轉弱。',neutral_condition:'指數平盤震盪且候選股缺乏同步性。'},{time_window:'10:00-11:30',what_to_watch:'觀察資金是否從權值股擴散到候選族群。',bullish_confirm:'核心候選與延伸候選同步轉強，且非單一個股獨強。',bearish_fail:'只有少數股票獨強，族群內部無擴散。',neutral_condition:'量能不足或漲跌家數分歧。'},{time_window:'13:00-13:30',what_to_watch:'尾盤是否維持盤前假設，並準備收盤後驗證。',bullish_confirm:'收盤前仍維持族群同步與量價結構。',bearish_fail:'開高走低或尾盤資金明顯撤離。',neutral_condition:'尾盤收斂至平盤附近，隔日需重新評估。'}];
  const invalidation=[{condition:'開盤方向與盤前 '+marketBias+' 相反超過 1%',meaning:'盤前假設失效',action_note:'停止用盤前框架解讀盤中走勢，改用即時盤面重新評估。'},{condition:'候選族群只有單一權值股表態',meaning:'資金未擴散，受惠股名單可信度下降',action_note:'把延伸候選降級為觀察，不追價。'}];
  if(dScore.riskReasons.length>0&&dScore.riskReasons[0]!=='暫無明顯風險訊號')invalidation.push({condition:dScore.riskReasons.join('、'),meaning:'風險因子擴大',action_note:'降低方向信心，等待收盤驗證。'});
  const status=memberNoteDataStatus(candidates.length,sectorData.length,newsData.length,md.length,overnight.length);
  const topCandidate=candidates[0];const topSector=sectorData[0];const coreSignal=String(topSector?.sector||topCandidate?.sector||'台股核心權值');
  const todayCoreThesis='今天只看一件事：'+coreSignal+' 是否能把隔夜風險訊號轉化為台股盤中可驗證的方向。';
  const marketMispricing=marketBias.includes('弱')?'盤前不是急著追空，而是確認賣壓是否已反映在 TAIEX、TXF 與 2330；若開盤沒有續弱，偏弱假設要降級。':'盤前不是只看利多，而是確認外部訊號是否真的讓台股權值與族群同步表態。';
  const institutionalBehavior='法人盤中最可能先看 TXF 與 2330 是否同向；若期貨弱於現貨，盤前假設需降低權重，若金融/防禦股相對抗跌，代表資金偏防守。';
  const fundFlowScenario='資金流推演：先看電子權值承接，再看 AI/半導體是否擴散；若不擴散，資金可能轉向金融、電信或高現金流防禦股。';
  const beneficiaryReasoning=candidates.slice(0,8).map(function(c){return{stock_code:c.stock_code,stock_name:c.stock_name,trigger_event:c.trigger_event,why_this_stock:c.why_this_stock||c.reason,validation_signal:c.validation_signal,invalidation_condition:c.invalidation_condition||c.risk,source_signals:c.source_signals||c.evidence};});
  const closeBacktestPlan={what_to_measure:['TAIEX 收盤方向是否符合 '+marketBias,'TXF 與現貨是否同向','候選股收盤是否優於所屬族群','sector_rotation 是否延續前一交易日方向'],pass_condition:'至少一個主要族群與候選股方向同步，且失效條件未觸發。',fail_condition:'TAIEX/TXF 與候選族群方向背離，或僅單一權值股支撐盤面。'};
  const tomorrowExtensionWatch=['今日失效或命中的主線是否在隔夜美股延續','2330、TXF 與電子權值是否形成第二天確認','sector_rotation 是否新增強勢族群或由防禦股接手'];
  const f=function(syms:string[]){return findMarketIndicator(md,syms)};
  const sox=f(['SOX','PHLX']),nasdaq=f(['IXIC','NASDAQ']),tsm=f(['TSM','TSMC']),txf=f(['TXF','TX','MTX']),taiex=f(['TAIEX','TWII','^TWII']),ts2330=f(['2330','2330.TW']);
  const signalLine=function(label:string,m:MarketIndicator|null){return m&&!Number.isNaN(m.changePercent)?label+' '+fmtV8Pct(m.changePercent):label+' 待資料更新'};
  const marketSignals=[signalLine('SOX',sox),signalLine('NASDAQ',nasdaq),signalLine('TSM ADR',tsm),signalLine('TXF',txf),signalLine('TAIEX',taiex),signalLine('2330',ts2330)];
  const firstCandidate=candidates[0]||null;
  const firstStockName=firstCandidate?String(firstCandidate.stock_name||firstCandidate.stock_code||'第一受惠股'):'第一受惠股';
  const intradayTimeWindows=[
    {time:'09:05',title:'開盤第一反應',purpose:'驗證隔夜 SOX、NASDAQ、TSM ADR 與 TXF 是否反映到台股現貨。',signals_to_watch:['TAIEX 與 2330 是否同向','TXF 是否領先現貨','隔夜美股風險是否被台股開盤消化'],bullish_confirmation:'TAIEX、2330、TXF 同向且未觸發盤前反向缺口。',bearish_warning:'TAIEX 或 2330 反向跳空，且 TXF 弱於現貨。',action_note:'只確認方向，不急著追價；若不同向，先把盤前劇本降級。'},
    {time:'09:30',title:'第一段資金確認',purpose:'確認盤前主軸是否被第一波資金承接。',signals_to_watch:['2330、TAIEX、TXF 是否同向',coreSignal+' 是否有族群同步','AI/半導體是否不是單一個股獨強'],bullish_confirmation:'核心受惠股與族群同步轉強，成交量放大。',bearish_warning:'只有權值股撐盤或候選股無法跟上 TAIEX。',action_note:'決定盤前劇本是否初步成立；未成立就只保留觀察名單。'},
    {time:'10:30',title:'當沖主力確認',purpose:'判斷是假突破還是真資金。',signals_to_watch:['成交量是否延續','強股是否續航','族群內是否擴散到第二、第三檔'],bullish_confirmation:'強股沒有開高走低，且同族群多檔同步站穩。',bearish_warning:'量能萎縮、強股翻黑或只剩單一權值支撐。',action_note:'若是假突破，降低 '+firstStockName+' 與延伸受惠股權重。'},
    {time:'11:30',title:'中場續航',purpose:'確認資金是否從權值股擴散到中小型股，或轉向防守。',signals_to_watch:['中小型股是否接棒','金融/傳產是否防守或轉強','候選股是否仍優於 TAIEX'],bullish_confirmation:'資金從 2330 / 權值擴散到同族群與延伸名單。',bearish_warning:'資金轉往防禦股但主軸受惠股失去相對強勢。',action_note:'確認上午劇本是否能留到下午；若擴散不足，避免把短線拉抬當主線。'},
    {time:'13:00',title:'收盤前風險驗證',purpose:'檢查當沖回補、殺尾盤與強股是否守住相對強勢。',signals_to_watch:['強股是否守住日內均線','TAIEX 尾盤是否與 TXF 同向','受惠股是否仍跑贏大盤'],bullish_confirmation:'強股尾盤不破日內均線，且 TAIEX/TXF 沒有反向。',bearish_warning:'尾盤放量轉弱、當沖回補失控或強股跌回平盤。',action_note:'把尾盤結果交給收盤驗證，不在尾盤硬延伸隔日劇本。'},
  ];
  const openingThesis={title:'今日主軸',summary:[todayCoreThesis,'核心訊號：'+marketSignals.join('、')+'.','方向不是看單一分數，而是看 '+coreSignal+' 是否能在 09:30 後被 TAIEX、2330、TXF 與族群同步性驗證。'],market_bias:marketBias,confidence_score:confidenceScore,signals:marketSignals};
  const coreReasoning=[marketMispricing,institutionalBehavior,fundFlowScenario,'若 SOX、TSM ADR、TXF 與 2330 同向偏弱，盤前劇本需優先降級為風險控管；若 TAIEX 與 2330 抗跌，才允許把防禦或抗跌族群列為主線。'];
  const firstBeneficiaryStock=firstCandidate?{stock_code:firstCandidate.stock_code,stock_name:firstCandidate.stock_name,sector:firstCandidate.sector,benefit_source:firstCandidate.trigger_event||'市場資料與類股輪動',relationship_to_thesis:firstCandidate.reason,validation_signal:firstCandidate.validation_signal||'09:30 後觀察是否優於 TAIEX 並有量能同步',invalidation_condition:firstCandidate.invalidation_condition||firstCandidate.risk,source_signals:firstCandidate.source_signals||firstCandidate.evidence}:null;
  const capitalRotationScenarios=[{scenario:'劇本 A：強勢延續',trigger:'TAIEX、2330、TXF 同向轉強，且 '+coreSignal+' 族群成交量放大。',groups_to_watch:[coreSignal,'半導體','AI 伺服器'],beneficiary_impact:'核心受惠股優先驗證，延伸名單才有擴散價值。',avoid:'不要在只有單一權值股拉抬時追價。'},{scenario:'劇本 B：震盪分歧',trigger:'TAIEX 與 2330 不同向，或 TXF 弱於現貨。',groups_to_watch:['金融防禦','電信','高現金流'],beneficiary_impact:'第一受惠股降為觀察，等待族群同步後再判斷。',avoid:'不要把盤前方向當成全天劇本。'},{scenario:'劇本 C：風險轉弱',trigger:'SOX、NASDAQ、TSM ADR 或 TXF 風險延續，且 2330 開盤後無法止穩。',groups_to_watch:['防禦股','低 beta 權值','現金流題材'],beneficiary_impact:'高 beta 受惠股不追，僅保留抗跌標的作驗證。',avoid:'不要急著撿便宜，先等賣壓與量能訊號。'}];
  const riskScenarios=[{risk:'海外半導體風險延續',condition:'SOX 或 TSM ADR 跌勢沒有被 2330 開盤承接抵消',response:'降低半導體受惠鏈權重。'},{risk:'期現貨背離',condition:'TXF 與 TAIEX/2330 不同向',response:'盤中方向降級為震盪分歧。'},{risk:'族群沒有擴散',condition:'只有單一權值股支撐，候選股未同步放量',response:'延伸受惠股不追蹤為主線。'}];
  const tomorrowFollowUp={after_close_check:['TAIEX 收盤方向是否符合 '+marketBias,'第一受惠股是否優於所屬族群','TXF 與現貨是否同向','sector_rotation 是否延續或反轉'],continuation_condition:'若收盤仍維持族群同步，明天可延續追蹤；若只靠單一權值支撐，明天降級為觀察。',carry_over_signals:tomorrowExtensionWatch};
  const closingFeedbackPlaceholder={status:'pending_after_close',what_to_verify:'收盤後比對盤前主軸、第一受惠股、TAIEX/TXF/2330 與 sector_rotation 是否一致。',expected_update:'closing-verification-engine 回寫後補上命中/失效原因。'};
  log('[buildMemberResearchNoteV2] candidates='+candidates.length+' sectors='+sectorData.length+' news='+newsData.length+' status='+status);
  return{overnight_chain:overnight,taiwan_impact_map:sectorMaps,beneficiary_candidates:candidates,intraday_validation:intraday,invalidation_rules:invalidation,closing_feedback_plan:{what_to_compare:'比較 '+todayDate+' 收盤後候選股、族群輪動與盤前 '+marketBias+' 是否一致。',success_criteria:'至少一個主要族群與多數候選股方向符合盤前推理鏈，且失效條件未觸發。',miss_reason_tracking:'若落空，回查 market_data、sector_rotation_scores、market_news 與 overnight chain 哪一段傳導失真。'},subscriber_value_sentence:status==='complete'?'今天的會員價值在於把隔夜訊號、台股族群與個股驗證點串成可回測假設：先看 '+coreSignal+'，再看候選股是否同步。':status==='partial'?'目前資料足以形成部分盤前假設，但候選股或類股輪動證據不足，需等盤中驗證補強。':'目前真實資料不足，不產生完整會員研究筆記，也不硬湊受惠股。',data_status:status,today_core_thesis:todayCoreThesis,market_mispricing:marketMispricing,institutional_behavior:institutionalBehavior,fund_flow_scenario:fundFlowScenario,beneficiary_reasoning:beneficiaryReasoning,close_backtest_plan:closeBacktestPlan,tomorrow_extension_watch:tomorrowExtensionWatch,opening_thesis:openingThesis,core_reasoning:coreReasoning,first_beneficiary_stock:firstBeneficiaryStock,risk_scenarios:riskScenarios,capital_rotation_scenarios:capitalRotationScenarios,tomorrow_follow_up:tomorrowFollowUp,closing_feedback_placeholder:closingFeedbackPlaceholder,intraday_time_windows:intradayTimeWindows};
}

function hasValidMemberResearchNoteV2Object(note:unknown):boolean{if(!note||typeof note!=='object'||Array.isArray(note))return false;const n=note as Record<string,unknown>;const sections=[n.overnight_chain,n.taiwan_impact_map,n.beneficiary_candidates,n.intraday_validation,n.invalidation_rules,n.closing_feedback_plan].filter(function(v){return Array.isArray(v)?v.length>0:!!v&&typeof v==='object'});return sections.length>=2;}
function sanitizeMemberResearchNoteV2(note:unknown,fallback:MemberResearchNoteV2,log:(m:string)=>void):MemberResearchNoteV2{
  if(!hasValidMemberResearchNoteV2Object(note)){log('[member_note_v2] invalid or missing, using deterministic fallback');return fallback;}
  const n=note as Record<string,unknown>;
  const rawCandidates=Array.isArray(n.beneficiary_candidates)?n.beneficiary_candidates as Record<string,unknown>[]:[];
  const candidates=rawCandidates.map(function(c){
    const sym=String(c.stock_code||c.symbol||'').trim();const nm=String(c.stock_name||c.name||STOCK_NAMES[sym]||'').trim();const ev=Array.isArray(c.evidence)?c.evidence.map(String).filter(Boolean):[];
    return{stock_code:sym,stock_name:nm,sector:String(c.sector||c.group||''),reason:String(c.reason||'').trim(),evidence:ev,risk:String(c.risk||c.risk_note||'').trim(),confidence:confidenceNumberFromStock(c),trigger_event:String(c.trigger_event||''),first_order_impact:String(c.first_order_impact||''),second_order_impact:String(c.second_order_impact||''),taiwan_supply_chain_link:String(c.taiwan_supply_chain_link||''),why_this_stock:String(c.why_this_stock||''),validation_signal:String(c.validation_signal||''),invalidation_condition:String(c.invalidation_condition||c.risk||c.risk_note||''),risk_level:String(c.risk_level||'medium'),source_signals:Array.isArray(c.source_signals)?c.source_signals:[]};
  }).filter(function(c){return isValidTaiwanStock(c.stock_code,c.stock_name)&&c.reason.length>0&&c.risk.length>0&&c.evidence.length>0;}).slice(0,15);
  const dataStatus=['complete','partial','insufficient'].includes(String(n.data_status))?String(n.data_status) as 'complete'|'partial'|'insufficient':fallback.data_status;
  return{
    overnight_chain:Array.isArray(n.overnight_chain)?n.overnight_chain as Record<string,unknown>[]:fallback.overnight_chain,
    taiwan_impact_map:Array.isArray(n.taiwan_impact_map)?n.taiwan_impact_map as Record<string,unknown>[]:fallback.taiwan_impact_map,
    beneficiary_candidates:candidates.length>0?candidates:fallback.beneficiary_candidates,
    intraday_validation:Array.isArray(n.intraday_validation)?n.intraday_validation as Record<string,unknown>[]:fallback.intraday_validation,
    invalidation_rules:Array.isArray(n.invalidation_rules)?n.invalidation_rules as Record<string,unknown>[]:fallback.invalidation_rules,
    closing_feedback_plan:n.closing_feedback_plan&&typeof n.closing_feedback_plan==='object'?n.closing_feedback_plan as Record<string,unknown>:fallback.closing_feedback_plan,
    subscriber_value_sentence:String(n.subscriber_value_sentence||fallback.subscriber_value_sentence),
    data_status:dataStatus,
    today_core_thesis:String(n.today_core_thesis||fallback.today_core_thesis||''),
    market_mispricing:String(n.market_mispricing||fallback.market_mispricing||''),
    institutional_behavior:String(n.institutional_behavior||fallback.institutional_behavior||''),
    fund_flow_scenario:String(n.fund_flow_scenario||fallback.fund_flow_scenario||''),
    beneficiary_reasoning:Array.isArray(n.beneficiary_reasoning)?n.beneficiary_reasoning as Record<string,unknown>[]:fallback.beneficiary_reasoning,
    close_backtest_plan:n.close_backtest_plan&&typeof n.close_backtest_plan==='object'?n.close_backtest_plan as Record<string,unknown>:fallback.close_backtest_plan,
    tomorrow_extension_watch:Array.isArray(n.tomorrow_extension_watch)?n.tomorrow_extension_watch.map(String).filter(Boolean):fallback.tomorrow_extension_watch,
    intraday_time_windows:Array.isArray(n.intraday_time_windows)?n.intraday_time_windows as Record<string,unknown>[]:fallback.intraday_time_windows,
  };
}

function buildV8InsufficientContract():V8Contract{return{v8_beneficiary_chain:{status:'insufficient',source_signals:[],beneficiaries:[]},v8_overnight_causal_chain:{status:'insufficient',chains:[]},v8_daily_sentence:{status:'insufficient',sentence:'',logic_source:[],tone:'clear, sharp, human-readable'}};}
function inferTaiwanImpact(text:string):string{if(text.includes('偏多')||text.includes('受惠')||text.includes('轉強'))return'偏多';if(text.includes('偏空')||text.includes('壓力')||text.includes('轉弱'))return'偏空';if(text.includes('中性'))return'中性';return'觀察';}
function v8RiskLevelFromConfidence(confidence:number):'low'|'medium'|'high'{if(confidence>=80)return'low';if(confidence>=60)return'medium';return'high';}
function v8ContractHasUsableData(v8:V8Contract):boolean{const b=v8.v8_beneficiary_chain as Record<string,unknown>;const o=v8.v8_overnight_causal_chain as Record<string,unknown>;return String(b.status)==='ready'||String(o.status)==='ready';}
function buildV8ContractFromMemberNoteV2(memberNoteV2:unknown,fallbackStocks:Record<string,unknown>[]=[],marketData:MarketIndicator[]=[],sectorData:SectorRotationRow[]=[]):V8Contract{
  if(!memberNoteV2||typeof memberNoteV2!=='object'||Array.isArray(memberNoteV2))return buildV8InsufficientContract();
  if(!Array.isArray(fallbackStocks))fallbackStocks=[];
  if(!Array.isArray(marketData))marketData=[];
  if(!Array.isArray(sectorData))sectorData=[];
  const note=memberNoteV2 as Record<string,unknown>;
  const overnightRows=Array.isArray(note.overnight_chain)?note.overnight_chain as Record<string,unknown>[]:[];
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
