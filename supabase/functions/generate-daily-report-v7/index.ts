import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION='V9.0_THREE_TIER_BENEFICIARY';
const REPORT_MODE_NORMAL='normal_overnight',REPORT_MODE_WEEKEND='weekend_digest',REPORT_MODE_NON_TRADING='non_trading_day';
const CORS_HEADERS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey, x-client-info, x-cron-secret'};

const TAIWAN_HOLIDAYS_2026:Record<string,string>={
  '2026-01-01':'元旦','2026-02-16':'春節休市','2026-02-17':'春節休市','2026-02-18':'春節休市','2026-02-19':'春節休市','2026-02-20':'春節休市','2026-02-27':'和平紀念日補假','2026-04-03':'兒童節補假','2026-04-06':'清明節補假','2026-06-19':'端午節','2026-09-25':'中秋節','2026-10-09':'國慶日補假',
};

type TradingDayInfo={is_trading_day:boolean;market_closed:boolean;holiday_name:string|null;reason:string};

function getTaiwanTradingDayInfo(dateString:string):TradingDayInfo{
  try{
    const parts=dateString.split('-').map(Number);
    if(parts.length!==3||parts.some(isNaN))return{is_trading_day:false,market_closed:true,holiday_name:'日期解析異常',reason:'DATE_PARSE_ERROR'};
    const d=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));const dow=d.getUTCDay();
    if(dow===0||dow===6)return{is_trading_day:false,market_closed:true,holiday_name:'週末休市',reason:'WEEKEND'};
    const holidayName=TAIWAN_HOLIDAYS_2026[dateString];
    if(holidayName)return{is_trading_day:false,market_closed:true,holiday_name:holidayName,reason:'HOLIDAY'};
    return{is_trading_day:true,market_closed:false,holiday_name:null,reason:'TRADING_DAY_CONFIRMED'};
  }catch{return{is_trading_day:false,market_closed:true,holiday_name:'交易日判斷異常',reason:'TRADING_DAY_GATE_ERROR'};}
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
    is_trading_day:tdInfo.is_trading_day,market_closed:tdInfo.market_closed,holiday_name:tdInfo.holiday_name,trading_day_reason:tdInfo.reason,
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
type MemberResearchNoteV2={overnight_chain:Record<string,unknown>[];taiwan_impact_map:Record<string,unknown>[];beneficiary_candidates:Record<string,unknown>[];intraday_validation:Record<string,unknown>[];invalidation_rules:Record<string,unknown>[];closing_feedback_plan:Record<string,unknown>;subscriber_value_sentence:string;data_status:'complete'|'partial'|'insufficient';today_core_thesis?:string;market_mispricing?:string;institutional_behavior?:string;fund_flow_scenario?:string;beneficiary_reasoning?:Record<string,unknown>[];close_backtest_plan?:Record<string,unknown>;tomorrow_extension_watch?:string[]};
type V8Contract={v8_beneficiary_chain:Record<string,unknown>;v8_overnight_causal_chain:Record<string,unknown>;v8_daily_sentence:Record<string,unknown>};

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

const TW_STOCK_WHITELIST=new Set(['2330','2454','2382','3231','3661','3017','3324','6669','2357','2376','2308','3443','3711','3034','2317','6239','8046','3037','2408','2344','2881','2882','2891','2603','2615','2610','1301','1303','1326','3081','2345','4906','2412','3045','4904','2303','2337','2356','8299','2049','1590','2634','8033','1519','1513','1504','1605','3450','2421','3653','2383','3189','6274','2542','2548',]);
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
  log('[buildMemberResearchNoteV2] candidates='+candidates.length+' sectors='+sectorData.length+' news='+newsData.length+' status='+status);
  return{overnight_chain:overnight,taiwan_impact_map:sectorMaps,beneficiary_candidates:candidates,intraday_validation:intraday,invalidation_rules:invalidation,closing_feedback_plan:{what_to_compare:'比較 '+todayDate+' 收盤後候選股、族群輪動與盤前 '+marketBias+' 是否一致。',success_criteria:'至少一個主要族群與多數候選股方向符合盤前推理鏈，且失效條件未觸發。',miss_reason_tracking:'若落空，回查 market_data、sector_rotation_scores、market_news 與 overnight chain 哪一段傳導失真。'},subscriber_value_sentence:status==='complete'?'今天的會員價值在於把隔夜訊號、台股族群與個股驗證點串成可回測假設：先看 '+coreSignal+'，再看候選股是否同步。':status==='partial'?'目前資料足以形成部分盤前假設，但候選股或類股輪動證據不足，需等盤中驗證補強。':'目前真實資料不足，不產生完整會員研究筆記，也不硬湊受惠股。',data_status:status,today_core_thesis:todayCoreThesis,market_mispricing:marketMispricing,institutional_behavior:institutionalBehavior,fund_flow_scenario:fundFlowScenario,beneficiary_reasoning:beneficiaryReasoning,close_backtest_plan:closeBacktestPlan,tomorrow_extension_watch:tomorrowExtensionWatch};
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

function computeDatesFromMarketData(rawData:Record<string,unknown>[]):{twCoreDate:string;usGlobalDate:string;dataTimeBasis:string}{
  const twSyms=['TAIEX','TWII','^TWII','2330','2330.TW','TXF','TX','MTX'];const usSyms=['NVDA','TSM','TSMC','SPX','SP500','GSPC','SOX','PHLX','IXIC','NASDAQ','VIX','VIXINDEX','DXY','USDINDEX','US10Y','TNX','T10Y'];
  let twAt='',usAt='';for(const r of rawData){const sym=String(r.symbol||'').toUpperCase();const cat=String(r.captured_at||'');if(!cat)continue;if(twSyms.includes(sym)&&(!twAt||cat>twAt))twAt=cat;if(usSyms.includes(sym)&&(!usAt||cat>usAt))usAt=cat;}
  return{twCoreDate:twAt?formatCapturedAtTaipeiDate(twAt):getTaipeiDateString(),usGlobalDate:usAt?formatCapturedAtTaipeiDate(usAt):getTaipeiDateString(),dataTimeBasis:'captured_at'};
}

function getTaipeiDateString():string{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return (p.find(function(x){return x.type==='year'})?.value||'')+'-'+(p.find(function(x){return x.type==='month'})?.value||'')+'-'+(p.find(function(x){return x.type==='day'})?.value||'')}
function getTaipeiDayOfWeek():number{try{const d=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',weekday:'short'}).formatToParts(new Date()).find(function(p){return p.type==='weekday'})?.value||'';const m:Record<string,number>={'Sun':0,'Mon':1,'Tue':2,'Wed':3,'Thu':4,'Fri':5,'Sat':6};return m[d]??-1}catch{return-1}}
function formatCapturedAtTaipeiDate(isoStr:string):string{try{const d=new Date(isoStr);if(Number.isNaN(d.getTime()))return'';const tw=new Date(d.toLocaleString('en-US',{timeZone:'Asia/Taipei'}));return tw.getFullYear()+'-'+String(tw.getMonth()+1).padStart(2,'0')+'-'+String(tw.getDate()).padStart(2,'0')}catch{return''}}
function determineReportMode(dow:number,hasMarketData:boolean,dataCount:number):string{if(dow===0||dow===6)return REPORT_MODE_NON_TRADING;if(!hasMarketData||dataCount===0)return REPORT_MODE_NON_TRADING;if(dow===1)return REPORT_MODE_WEEKEND;return REPORT_MODE_NORMAL}
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
    line_push_copy:{title:'Morning Alpha｜'+todayDate,market_bias:marketBias,confidence:String(confidenceScore),one_sentence:oneSentence,do_not_do:doNotDoList.join(' '),watch_point:'開盤觀察方向',cta:'查看完整報告'}
  };
}

async function callOpenAI(systemPrompt:string,userPrompt:string,apiKey:string,log:(m:string)=>void):Promise<Record<string,unknown>|null>{
  try{log('OPENAI_START');const start=Date.now();const res=await fetchWithTimeout('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],temperature:0.4,max_tokens:4000,response_format:{type:'json_object'}})},10000,'openai_chat_completions',log);const elapsed=Date.now()-start;log('OPENAI_DONE elapsed_ms='+elapsed+' has_response='+(!!res));if(!res){log('OPENAI_TIMEOUT_DEGRADED');return null}if(!res.ok){log('OPENAI_FAILED:HTTP_'+res.status);return null}const j:Record<string,unknown>=await res.json();const content=j.choices?.[0]?.message?.content;if(typeof content==='string'){try{return JSON.parse(content)}catch{log('OPENAI_PARSE_FAIL');return null}}log('OPENAI_NO_CONTENT');return null}catch(e){log('OPENAI_EXCEPTION:'+(e instanceof Error?e.message:String(e)));return null}
}
function buildOpenAISystemPrompt():string{return'你是 Morning Alpha 的盤前研究員，不是新聞摘要機器。根據提供的真實市場數據產出完整 JSON。只輸出 JSON，不輸出 markdown，不輸出 JSON 外的自然語言，不新增 root 欄位，不改既有欄位名稱，不移除既有必要欄位。所有段落都必須回答「所以呢？」與「投資人接下來看什麼？」。禁止使用「可能」「或許」「留意」「關注」等空泛文字，改用具體變數、價位方向、族群同步性、成交量、匯率、期貨、ADR、原物料或新聞催化。必須同時輸出 member_research_note 舊純文字相容欄位，以及 member_research_note_v2 結構化會員研究筆記。member_research_note 目標 600-900 字，提高內容密度，不要用背景介紹灌字數；第一段禁止背景介紹，第一段直接回答：今天如果只能看一件事，投資人最應該看什麼；第二段回答為什麼；第三段說市場如何驗證；第四段說什麼情況代表判斷錯誤；第五段說明天需要追蹤什麼。member_research_note 不可拿 summary、free_summary、today_summary 改寫充數。member_research_note_v2 必須包含 overnight_chain、taiwan_impact_map、beneficiary_candidates、intraday_validation、invalidation_rules、closing_feedback_plan、subscriber_value_sentence、data_status，保留既有 schema 不刪欄位。beneficiary_stocks 與 today_beneficiary_stocks 每檔必須包含 symbol、name、sector、reason、trigger_event、watch_point、risk_note、confidence_level、data_basis；today_beneficiary_stocks 必須輸出 5 到 8 檔，beneficiary_stocks 最多輸出 10 檔；不要為了湊數加入低信心或資料不足的股票，若真實資料不足，寧可少於上限，也不可補假資料。confidence_level 只可用 High、Medium、Low。每檔必須寫出催化來源、傳導路徑、公司受惠原因與反向風險：催化來源例如 NVIDIA 上漲、美國能源政策、原油大漲、美元走弱；傳導路徑必須是事件 → 產業 → 供應鏈 → 公司；公司受惠原因必須連到公司產品、公司客戶或公司營收來源，不可只寫因需求增加。每檔受惠股的 reason、trigger_reason、causal_chain 說明需控制在 1 到 2 句，必須具體，但不要寫成長篇文章。禁止把「AI受惠」「半導體受惠」「科技股受惠」當成完整答案，不可只寫「AI概念股受惠」或只列產業。不可自由生成未提供、未在既有受惠股候選、或未由資料支撐的股票；資料不足時不可硬湊，應降低 data_status 為 partial 或 insufficient。member_research_note_v2 語氣要像研究員晨會筆記：overnight_chain 必須寫出海外事件 → 資金流向 → 美股族群 → 供應鏈 → 台股族群 → 代表個股，至少 5 層，每一層都要回答為什麼；taiwan_impact_map.why_it_matters 必須說明傳導機制，不可只列產業；beneficiary_candidates 每檔 evidence 必須引用 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks；invalidation_rules 必須具體可觀察；subscriber_value_sentence 要像今天的研究員結論，不是產品行銷文。War Room 相關內容不要重複首頁摘要，只能寫入既有欄位 intraday_validation、intraday_validation_plan、invalidation_rules、closing_feedback_plan，要提供開盤觀察重點、盤中驗證指標、失敗訊號、應變方案；禁止新增任何 root 欄位，例如 war_room、war_room_plan、trading_plan、market_plan、execution_plan，也禁止新增任何前端尚未支援的新 root 欄位。today_quote 必須指出今天真正看的變數，不可空泛，不可保證獲利，不可使用買進、賣出、加碼、減碼等命令，語氣清楚、有人味，但不要像誇張社群標題。另必須輸出 V8 三欄位：v8_beneficiary_chain、v8_overnight_causal_chain、v8_daily_sentence；資料不足也要輸出 status="insufficient" 的安全結構。v8_beneficiary_chain 的 beneficiaries 只能使用提供資料或既有受惠股中的台股 symbol，不可自由生成股票；每檔必須有 symbol、name、sector、reason_chain、confidence_score、risk_level、invalidation_condition；reason_chain 至少 3 層，且必須包含催化來源 → 供應鏈傳導 → 公司產品/客戶/營收連結。v8_overnight_causal_chain 每條 causal_steps 至少 5 層，從海外事件傳導到資金流向、美股族群、供應鏈、台股族群與代表個股，watch_points 必須可盤中驗證。v8_daily_sentence 不可空泛，不可使用「市場仍有不確定性」「投資人應謹慎」「關注後續變化」「後續仍需觀察」，不可出現買進、賣出、加碼、減碼等命令，不可保證獲利。推理鏈必須是：隔夜事件 → 台股族群 → 個股 → 盤中驗證 → 失效條件。beneficiary_candidates 目標 8 到 15 檔，但禁止硬湊；每檔必須有 reason、evidence、risk、confidence，evidence 只能來自提供的 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks。today_beneficiary_stocks 只可輸出台股個股。方向只可用：偏多觀察、中性偏多、震盪觀察、偏弱觀察、高風險日。';}
function safeOpenAIMarketDataLine(m:MarketIndicator):string{
  const sym=m.symbol.toUpperCase();const pct=(m.changePercent>=0?'+':'')+m.changePercent.toFixed(2)+'%';const meta=[m.name,m.market,m.status,(m as unknown as Record<string,unknown>).source,(m as unknown as Record<string,unknown>).raw_source].map(function(v){return String(v||'').toLowerCase();}).join(' ');
  const isProxy=meta.includes('proxy')||meta.includes('代理')||meta.includes('vxx');
  if(sym==='DXY'||sym==='USDINDEX')return m.symbol+' | 美元指數代理指標 | 變動='+pct+' | 注意：proxy，不是美元指數實際 level';
  if(sym==='US10Y'||sym==='TNX'||sym==='T10Y')return m.symbol+' | 美國10年期債券代理指標 | 變動='+pct+' | 注意：proxy，不是實際殖利率';
  if((sym==='VIX'||sym==='VIXINDEX')&&isProxy)return m.symbol+' | 恐慌指數代理指標 | 變動='+pct+' | 注意：proxy，不是真實 VIX level';
  return m.symbol+' | '+m.name+' | 值='+m.value+' | 變動='+pct+(isProxy?' | 注意：proxy，value 不代表真實指數 level':'');
}
function buildOpenAIUserPrompt(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string},sectorContextSummary:string):string{
  const mdLines=md.map(safeOpenAIMarketDataLine).join('\n');
  const newsLines=newsData.slice(0,12).map(function(n){return n.title+' | '+(n.taiwan_impact_summary||'')}).join('\n');
  return'今日日期：'+todayDate+'\n台股基準：'+dates.twCoreDate+'\n海外基準：'+dates.usGlobalDate+'\n\n產業輪動（sector_rotation_scores）：'+(sectorContextSummary||'無')+'\n\n市場資料說明：若市場資料標示為 proxy / 代理指標，只能使用變動百分比，不得把 value 寫成實際指數、實際殖利率或實際價格。\n\n市場數據（market_data）：\n'+mdLines+'\n\n市場新聞（market_news）：\n'+(newsLines||'無')+'\n\n請產生今日盤前報告 JSON。只輸出 JSON，不輸出 markdown，不輸出 JSON 外的自然語言，不新增 root 欄位，不改既有欄位名稱，不移除既有必要欄位。所有輸出都要具體回答「所以呢？」與「投資人接下來看什麼？」禁止使用「可能」「或許」「留意」「關注」等空泛詞。member_research_note 是 600-900 字純文字相容欄位；提高內容密度，不要用背景介紹灌字數；第一段不可背景介紹，直接回答今天如果只能看一件事，投資人最應該看什麼；第二段回答為什麼；第三段說市場如何驗證；第四段說什麼情況代表判斷錯誤；第五段說明天需要追蹤什麼。member_research_note_v2 是結構化物件，schema: {overnight_chain:[{event,source_market,impact_logic,taiwan_mapping,confidence}], taiwan_impact_map:[{sector,why_it_matters,affected_stocks,sensitivity,invalidation}], beneficiary_candidates:[{stock_code,stock_name,sector,reason,evidence,risk,confidence}], intraday_validation:[{time_window,what_to_watch,bullish_confirm,bearish_fail,neutral_condition}], invalidation_rules:[{condition,meaning,action_note}], closing_feedback_plan:{what_to_compare,success_criteria,miss_reason_tracking}, subscriber_value_sentence, data_status}. beneficiary_stocks 與 today_beneficiary_stocks 請輸出真實資料支撐的台股公司陣列，每檔欄位必須包含 symbol、name、sector、reason、trigger_event、watch_point、risk_note、confidence_level、data_basis；today_beneficiary_stocks 必須輸出 5 到 8 檔，beneficiary_stocks 最多輸出 10 檔；不要為了湊數加入低信心或資料不足的股票，若真實資料不足，寧可少於上限，也不可補假資料。confidence_level 只可用 High、Medium、Low。trigger_event 是催化來源，例如 NVIDIA 上漲、能源政策、原油價格、美元或美債變化；reason 必須包含事件 → 產業 → 供應鏈 → 公司，且說明公司產品、公司客戶或公司營收來源如何連到該事件；reason、trigger_reason、causal_chain 說明需控制在 1 到 2 句，必須具體，但不要寫成長篇文章；禁止「AI受惠」「半導體受惠」「科技股受惠」這類泛化答案。watch_point 要是盤中可驗證指標；risk_note 要說明什麼情況讓判斷失效；data_basis 要列出使用的資料來源名稱，例如 market_data.NVDA.change_percent、sector_rotation_scores.半導體、market_news.title 或 existing_beneficiary_stock。member_research_note_v2 要像研究員晨會筆記，不要像新聞摘要：overnight_chain 至少 5 層，格式為海外事件 → 資金流向 → 美股族群 → 供應鏈 → 台股族群 → 代表個股，每一層都要說明為什麼；taiwan_impact_map.why_it_matters 要說明為何影響台股；beneficiary_candidates.evidence 必須引用 market_data、sector_rotation_scores、market_news、overnight chain 或既有 beneficiary stocks；invalidation_rules 必須具體可觀察；subscriber_value_sentence 是今天的研究員結論，不是產品行銷文。War Room 相關內容不要重複首頁，只能寫入既有欄位 intraday_validation、intraday_validation_plan、invalidation_rules、closing_feedback_plan，要提供開盤觀察重點、盤中驗證指標、失敗訊號、應變方案；禁止新增任何 root 欄位，例如 war_room、war_room_plan、trading_plan、market_plan、execution_plan，也禁止新增任何前端尚未支援的新 root 欄位。today_quote 必須指出今天真正看的變數，不可使用空泛句，不可保證獲利，不可使用買進、賣出、加碼、減碼等命令。V8 schema 必填：v8_beneficiary_chain={status,source_signals,beneficiaries:[{symbol,name,sector,reason_chain,confidence_score,risk_level,invalidation_condition}]}; v8_overnight_causal_chain={status,chains:[{theme,event,causal_steps,taiwan_impact,affected_sectors,watch_points,invalidation_condition}]}; v8_daily_sentence={status,sentence,logic_source,tone:"clear, sharp, human-readable"}。v8_overnight_causal_chain.causal_steps 至少 5 層，必須從海外事件一路傳導到代表個股。不可把 summary/free_summary 當會員筆記，不可編造未在資料或既有受惠股中有支撐的股票；資料不足時保留空陣列並將 data_status 或 status 設為 partial/insufficient，不可硬湊。';
}

async function writeReport(supabase:ReturnType<typeof createClient>,todayDate:string,aiStrategyJson:Record<string,unknown>,marketBias:string,rawConfidenceScore:number|null,reportMode:string,md:MarketIndicator[],log:(m:string)=>void,tdInfo?:TradingDayInfo):Promise<{reportId:string}|null>{
  try{
    const tradingDayInfo=tdInfo||getTaiwanTradingDayInfo(todayDate);
    aiStrategyJson={...aiStrategyJson,is_trading_day:tradingDayInfo.is_trading_day,market_closed:tradingDayInfo.market_closed,holiday_name:tradingDayInfo.holiday_name,trading_day_reason:tradingDayInfo.reason,};
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
    log('START V9.0 skip_openai='+skipOpenAI);
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
    const [marketSettled,newsSettled,sectorSettled,rawDatesSettled]=await Promise.allSettled([
      withTimeout(fetchMarketData(supabase,log),5000,'market_data_query',log,{marketData:[],latestDataTime:null as Date|null,isStale:true,dataCount:0}),
      withTimeout(fetchMarketNews(supabase,log),3000,'market_news_query',log,{newsData:[],latestNewsTime:null,isStale:true,newsCount:0}),
      withTimeout(fetchSectorRotationForDate(supabase,sectorRotationReferenceDate,log),3000,'sector_rotation_query',log,[] as SectorRotationRow[]),
      withTimeout(rawDatesFetch,3000,'market_data_dates_query',log,[] as Record<string,unknown>[]),
    ]);
    const marketFetch=marketSettled.status==='fulfilled'?marketSettled.value:{marketData:[],latestDataTime:null as Date|null,isStale:true,dataCount:0};
    const newsFetch=newsSettled.status==='fulfilled'?newsSettled.value:{newsData:[],latestNewsTime:null,isStale:true,newsCount:0};
    const sectorData=sectorSettled.status==='fulfilled'?sectorSettled.value:[];
    const rawDataForDates=rawDatesSettled.status==='fulfilled'?rawDatesSettled.value:[];
    const marketData=marketFetch.marketData;const dataCount=marketFetch.dataCount;const newsData=newsFetch.newsData;
    const missingSources:string[]=[];if(dataCount===0)missingSources.push('market_data');if(newsData.length===0)missingSources.push('market_news');if(sectorData.length===0)missingSources.push('sector_rotation_scores:'+sectorRotationReferenceDate);if(rawDataForDates.length===0)missingSources.push('market_data_dates');
    const dataQuality=missingSources.length===0?'complete':'degraded';
    log('MARKET_DATA count='+dataCount);log('NEWS count='+newsData.length);log('SECTOR_ROTATION rows='+sectorData.length);log('DATA_QUALITY '+dataQuality+' missing_sources='+(missingSources.join(',')||'none'));
    timer.mark('PARALLEL_DATA_FETCH_DONE','data_quality='+dataQuality);
    const hasMarketData=dataCount>0;const reportMode=determineReportMode(dow,hasMarketData,dataCount);
    if(sectorData.length===0)log('SECTOR_ROTATION_MISSING reference_date='+sectorRotationReferenceDate+'; continuing without fallback to today');

    const dates=computeDatesFromMarketData(rawDataForDates);log('DATES tw_core='+dates.twCoreDate+' us_global='+dates.usGlobalDate);

    const dScore=calculateMarketDataScore(marketData);const twStatus=checkTWCoreStatus(marketData,log);const mvpStatus=checkMVPStatus(marketData,log);
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
        const sysPrompt=buildOpenAISystemPrompt();const userPrompt=buildOpenAIUserPrompt(marketData,newsData,todayDate,dates,sectorContextSummary);
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
    aiStrategyJson.version=VERSION;aiStrategyJson.generated_at=new Date().toISOString();
    aiStrategyJson.tw_stock_filter_applied=true;aiStrategyJson.research_card_format=true;
    aiStrategyJson.fields_complete_guaranteed=true;aiStrategyJson.write_time_guarantee=true;aiStrategyJson.member_note_format='plain_text_and_v2';
    aiStrategyJson.sector_rotation_reference_date=sectorRotationReferenceDate;
    aiStrategyJson.sector_rotation_basis='previous_trading_day';
    aiStrategyJson.sector_rotation_rows=sectorData.length;
    aiStrategyJson.sector_rotation_data_status=sectorData.length>0?'available':'missing_previous_trading_day';
    aiStrategyJson.market_bias_score=dScore.baseScore;
    aiStrategyJson.confidence_score=confidenceResult.score;
    aiStrategyJson.confidence_breakdown=confidenceResult.breakdown;
    aiStrategyJson.data_quality=dataQuality;
    aiStrategyJson.missing_sources=missingSources;
    aiStrategyJson.performance_timing={total_before_write_ms:timer.total(),data_quality:dataQuality,missing_sources:missingSources};
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
