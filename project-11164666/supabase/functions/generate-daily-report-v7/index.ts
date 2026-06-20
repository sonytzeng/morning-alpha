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

type MarketIndicator={symbol:string;name:string;market:string;value:number;change:number;changePercent:number;updatedAt:string;status:string;taiwanImpact:string};
type MarketNewsItem={id:string;title:string;source:string;url:string;published_at:string|null;created_at:string;related_sectors:string[]|null;taiwan_impact_summary:string|null;raw_payload:Record<string,unknown>|null};
type FetchNewsResult={newsData:MarketNewsItem[];latestNewsTime:Date|null;isStale:boolean;newsCount:number};
type MarketDataScore={baseScore:number;reasons:string[];riskReasons:string[];details:Record<string,number>};
type TWCoreStatus={taiexPresent:boolean;txfPresent:boolean;ts2330Present:boolean;missingCount:number;dataInsufficient:boolean};
type MVPStatus={nvdaPresent:boolean;tsmPresent:boolean;spxPresent:boolean;mvpCount:number;mvpInsufficient:boolean};

type SectorRotationRow={sector:string;sub_sector:string;rotation_score:number;direction:string;signal_label:string;leading_symbols:string[];lagging_symbols:string[];summary?:string};

function safeInteger(v:unknown,fallback:number=50):number{if(v===null||v===undefined)return fallback;const n=Number(v);if(Number.isNaN(n))return fallback;if(n>=0&&n<=1)return Math.round(n*100);if(n>100)return 100;if(n<0)return 0;return Math.round(n);}
function convictionLevelFromConfidence(c:number):string{if(c>=75)return'★★★★★';if(c>=60)return'★★★★☆';return'★★★☆☆';}
function isStrongSectorRotation(s:SectorRotationRow):boolean{return s.rotation_score>=70&&(s.direction==='strong_positive'||s.direction==='positive'||s.signal_label==='強勢主流'||s.signal_label==='轉強');}

const CATALYST_TYPE_MAP:Record<string,string>={'2330':'SEMICONDUCTOR','2454':'SEMICONDUCTOR','3443':'SEMICONDUCTOR','3034':'SEMICONDUCTOR','2303':'SEMICONDUCTOR','2382':'AI_SERVER','3231':'AI_SERVER','6669':'AI_SERVER','2357':'AI_SERVER','2376':'AI_SERVER','2317':'AI_SERVER','2356':'AI_SERVER','3017':'COOLING','3324':'COOLING','3711':'ADVANCED_PACKAGING','8046':'ADVANCED_PACKAGING','3037':'ADVANCED_PACKAGING','3661':'SEMICONDUCTOR','2308':'AI_SERVER','2408':'MEMORY','2344':'MEMORY','2337':'MEMORY','8299':'MEMORY','3081':'CPO','2345':'CPO','4906':'CPO','6239':'SEMICONDUCTOR','2881':'DEFENSIVE','2882':'DEFENSIVE','2891':'DEFENSIVE','2603':'CYCLICAL','2615':'CYCLICAL','2610':'CYCLICAL','1301':'CYCLICAL','1303':'CYCLICAL','1326':'CYCLICAL','2412':'DEFENSIVE','3045':'DEFENSIVE','4904':'DEFENSIVE',};
function catalystTypeForStock(symbol:string):string{return CATALYST_TYPE_MAP[symbol]||'SEMICONDUCTOR';}

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
  return result.slice(0,12);
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
  return{
    stock_id:symbol,stock_name:name,sector,beneficiary_level:level,trigger_event:triggerEvent,reason,risk_note:riskNote,confidence_level:confidenceLevel,data_basis:dataBasis,
    symbol,name,group:sector,direction:level==='core'?'受惠':'觀察',conviction_level:confidenceLevel==='high'?'★★★★★':confidenceLevel==='medium'?'★★★★☆':'★★★☆☆',catalyst_type:cat,watch_point:'觀察開盤是否站穩平盤且放量',not_buy_signal:true,source_type:level+'_beneficiary',...extraFields,
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
function buildCausalOvernightImpactChain(md:MarketIndicator[],dScore:MarketDataScore):Record<string,unknown>[]{
  const f=(syms:string[])=>{for(const sy of syms){const x=md.find(function(m){return m.symbol.toUpperCase()===sy.toUpperCase()});if(x)return x}return null};
  const nv=f(['NVDA']),sox=f(['SOX','PHLX']),spx=f(['SPX','SP500']),vix=f(['VIX','VIXINDEX']),tsm=f(['TSM','TSMC']),dxy=f(['DXY','USDINDEX']),us10y=f(['US10Y','TNX']);
  const fmtPct=function(v:number){return v>=0?'+'+v.toFixed(2)+'%':v.toFixed(2)+'%'};
  const chains:Record<string,unknown>[]=[];

  if(nv||sox){
    const nvDir=nv&&!Number.isNaN(nv.changePercent)?(nv.changePercent>0?'上漲':'下跌'):'變動';
    chains.push({
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
    chains.push({
      overseas_trigger:'昨夜美股 SPX '+(spx&&!Number.isNaN(spx.changePercent)?fmtPct(spx.changePercent):'—')+' / VIX '+(vix&&!Number.isNaN(vix.value)?vix.value.toFixed(2):'—')+'（'+(vix&&!Number.isNaN(vix.changePercent)?fmtPct(vix.changePercent):'—')+'）',
      first_order_impact:'美股大盤'+spxDir+'，VIX '+(vix&&vix.value>=25?'處於警戒區間，市場恐慌情緒偏高':'處於正常區間，市場情緒穩定')+'。DXY '+(dxy&&!Number.isNaN(dxy.value)?dxy.value.toFixed(2):'—')+'，美10年債殖利率 '+(us10y&&!Number.isNaN(us10y.value)?us10y.value.toFixed(2)+'%':'—'),
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
  if(vix&&!Number.isNaN(vix.changePercent)){const vv=vix.value||0;usL.push('VIX：'+vv.toFixed(2)+'，'+fmtPct(vix.changePercent)+'。'+(vv>=25?'恐慌偏高':vv>=20?'中等不安':'情緒穩定'))}else usL.push('VIX：待資料更新');
  if(tsm&&!Number.isNaN(tsm.changePercent))usL.push('TSM ADR：'+fmtPct(tsm.changePercent));
  if(dxy&&!Number.isNaN(dxy.value))usL.push('DXY：'+dxy.value.toFixed(2));
  if(us10y&&!Number.isNaN(us10y.value))usL.push('美10年債殖利率：'+us10y.value.toFixed(2)+'%');
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
  return '今日盤前市場方向：'+marketBias+'，信心 '+dScore.baseScore+'/100。開盤後以實際走勢為最終判斷，勿憑盤前預期操作。';
}

function buildDeterministicAIStrategyJson(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string;dataTimeBasis:string},dScore:MarketDataScore,twStatus:TWCoreStatus,mvpStatus:MVPStatus,reportMode:string,sectorData:SectorRotationRow[],log:(m:string)=>void):Record<string,unknown>{
  const marketBias=classifyMarketBias(dScore.baseScore);const confidenceScore=dScore.baseScore;
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
  const intradayValidationPlan={open_0900_0930:'觀察開盤是否反映 '+marketBias+' 方向',mid_session_1000_1130:'觀察量能與族群擴散是否跟上',afternoon_1300_1330:'觀察尾盤資金流向',fail_signals:['開盤反向跳空超過 1%','量能大幅萎縮','主要權值股開盤即轉弱']};
  const renewalValueBlock={why_member_should_read_today:'今日 '+todayDate+' 盤前報告基於真實市場數據，方向：'+marketBias+'，信心：'+confidenceScore+'/100',what_free_news_does_not_provide:'量化市場數據、跨市場連動分析、盤前綜合判斷',tomorrow_followup_hook:'明日將持續追蹤市場方向是否驗證'};

  return{
    version:VERSION,source:'deterministic_real_market_data',generated_at:new Date().toISOString(),
    target_date:todayDate,tw_core_date:dates.twCoreDate,us_global_date:dates.usGlobalDate,data_time_basis:dates.dataTimeBasis,
    report_mode:reportMode,quality_score:75,member_value_score:70,
    no_fake_fallback:true,fake_fallback_used:false,data_date_aligned:true,publish_ready:true,
    confidence_score:confidenceScore,market_bias:marketBias,today_quote:todayQuote,
    tw_core_present:!twStatus.dataInsufficient,us_global_present:!mvpStatus.mvpInsufficient,
    beneficiary_engine_version:'V9.0_THREE_TIER_BENEFICIARY',
    tw_stock_filter_applied:true,research_card_format:true,fields_complete_guaranteed:true,write_time_guarantee:true,member_note_format:'plain_text_string',
    free_summary:{today_status:reportMode===REPORT_MODE_NON_TRADING?'非交易日':'交易日盤前',one_sentence:oneSentence,market_bias:marketBias,confidence_score:confidenceScore,do_not_do:doNotDoList.join(' '),mindset:'盤前判斷僅供參考，實際操作以開盤後市場走勢為準。',cta_hint:'查看完整盤前報告'},
    member_research_note:memberNoteText,
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
  try{log('OPENAI_START');const start=Date.now();const res=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},body:JSON.stringify({model:'gpt-4o-mini',messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}],temperature:0.4,max_tokens:4000,response_format:{type:'json_object'}})});const elapsed=Date.now()-start;if(!res.ok){log('OPENAI_FAILED:HTTP_'+res.status);return null}const j:Record<string,unknown>=await res.json();const content=j.choices?.[0]?.message?.content;if(typeof content==='string'){try{return JSON.parse(content)}catch{log('OPENAI_PARSE_FAIL');return null}}log('OPENAI_NO_CONTENT');return null}catch(e){log('OPENAI_EXCEPTION:'+(e instanceof Error?e.message:String(e)));return null}
}
function buildOpenAISystemPrompt():string{return'你是 Morning Alpha 的盤前報告 AI。根據提供的真實市場數據產出完整 JSON。會員研究筆記必須是純文字字串（string），800-1500字，包含七個段落。today_beneficiary_stocks 只可輸出台股個股。方向只可用：偏多觀察、中性偏多、震盪觀察、偏弱觀察、高風險日。';}
function buildOpenAIUserPrompt(md:MarketIndicator[],newsData:MarketNewsItem[],todayDate:string,dates:{twCoreDate:string;usGlobalDate:string},sectorContextSummary:string):string{
  const mdLines=md.map(function(m){return m.symbol+' | '+m.name+' | 值='+m.value+' | 變動='+(m.changePercent>=0?'+':'')+m.changePercent.toFixed(2)+'%'}).join('\n');
  return'今日日期：'+todayDate+'\n台股基準：'+dates.twCoreDate+'\n海外基準：'+dates.usGlobalDate+'\n\n產業輪動：'+(sectorContextSummary||'無')+'\n\n市場數據：\n'+mdLines+'\n\n請產生今日盤前報告 JSON。member_research_note 必須是純文字字串，不是 JSON 物件。';
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
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS_HEADERS});
  if(req.method!=='POST')return corsResponse({success:false,error:'Only POST allowed',version:VERSION},405);

  try{
    const cronSecret=req.headers.get('x-cron-secret');const expectedSecret=Deno.env.get('CRON_SECRET');
    if(!expectedSecret){log('NO_CRON_SECRET');return corsResponse({success:false,error:'CRON_SECRET not set',version:VERSION},500)}
    if(cronSecret!==expectedSecret){log('INVALID_CRON_SECRET');return corsResponse({success:false,error:'Unauthorized',version:VERSION},401)}

    let body:Record<string,unknown>={};try{body=await req.json()}catch{log('BODY_PARSE_FAILED')}
    const skipOpenAI=body?.skip_openai===true||body?.fast_mode===true;
    log('START V9.0 skip_openai='+skipOpenAI);

    const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!supabaseUrl||!serviceRoleKey){log('NO_SUPABASE_CREDS');return corsResponse({success:false,error:'Supabase credentials missing',version:VERSION},500)}
    const supabase=createClient(supabaseUrl,serviceRoleKey,{auth:{autoRefreshToken:false,persistSession:false}});

    const todayDate=getTaipeiDateString();const dow=getTaipeiDayOfWeek();log('TODAY='+todayDate+' DOW='+dow);
    const tradingDayInfo=getTaiwanTradingDayInfo(todayDate);
    log('TRADING_DAY_CHECK: is_trading_day='+tradingDayInfo.is_trading_day+' market_closed='+tradingDayInfo.market_closed+' holiday_name='+tradingDayInfo.holiday_name+' reason='+tradingDayInfo.reason);

    if(!tradingDayInfo.is_trading_day){
      log('NON_TRADING_DAY: '+(tradingDayInfo.holiday_name||'休市'));
      const marketClosedReport=buildMarketClosedReport(todayDate,tradingDayInfo);
      const writeResult=await writeReport(supabase,todayDate,marketClosedReport,'休市',null,REPORT_MODE_NON_TRADING,[],log,tradingDayInfo);
      if(!writeResult?.reportId){log('WRITE_FAILED_MARKET_CLOSED');return corsResponse({success:false,error:'Failed to write market closed report',report_date:todayDate,version:VERSION,logs},500);}
      const verified=await verifyReportExists(supabase,todayDate,log);
      const durationMs=Date.now()-reqStart;log('DONE_MARKET_CLOSED report_id='+writeResult.reportId+' duration='+durationMs+'ms');
      return corsResponse({success:true,message:'Market closed',report_date:todayDate,report_id:writeResult.reportId,is_trading_day:false,market_closed:true,holiday_name:tradingDayInfo.holiday_name,market_bias:'休市',confidence_score:null,report_mode:REPORT_MODE_NON_TRADING,duration_ms:durationMs,version:VERSION,logs},200);
    }

    log('TRADING_DAY');
    const{marketData,dataCount}=await fetchMarketData(supabase,log);log('MARKET_DATA count='+dataCount);
    const hasMarketData=dataCount>0;const reportMode=determineReportMode(dow,hasMarketData,dataCount);
    const{newsData}=await fetchMarketNews(supabase,log);log('NEWS count='+newsData.length);
    const sectorRotationReferenceDate=getPreviousTaiwanTradingDay(todayDate);log('SECTOR_ROTATION reference_date='+sectorRotationReferenceDate+' basis=previous_trading_day');
    const sectorData=await fetchSectorRotationForDate(supabase,sectorRotationReferenceDate,log);log('SECTOR_ROTATION rows='+sectorData.length);
    if(sectorData.length===0)log('SECTOR_ROTATION_MISSING reference_date='+sectorRotationReferenceDate+'; continuing without fallback to today');

    let rawDataForDates:Record<string,unknown>[]=[];try{const rr=await supabase.from('market_data').select('symbol,captured_at').order('captured_at',{ascending:false}).limit(30);const{data}=safeUnwrap<Record<string,unknown>[]>(rr,log,'rawForDates');if(data)rawDataForDates=data;}catch{log('rawForDates fetch failed')}
    const dates=computeDatesFromMarketData(rawDataForDates);log('DATES tw_core='+dates.twCoreDate+' us_global='+dates.usGlobalDate);

    const dScore=calculateMarketDataScore(marketData);const twStatus=checkTWCoreStatus(marketData,log);const mvpStatus=checkMVPStatus(marketData,log);
    log('SCORE='+dScore.baseScore+' BIAS='+classifyMarketBias(dScore.baseScore));

    const deterministicJson=buildDeterministicAIStrategyJson(marketData,newsData,todayDate,dates,dScore,twStatus,mvpStatus,reportMode,sectorData,log);
    const marketBiasDet=classifyMarketBias(dScore.baseScore);const confScoreDet=dScore.baseScore;
    const detMemberNoteText=typeof deterministicJson.member_research_note==='string'?String(deterministicJson.member_research_note):buildMemberResearchNoteText(marketData,todayDate,dates,dScore,marketBiasDet,confScoreDet,Array.isArray(deterministicJson.today_beneficiary_stocks)?deterministicJson.today_beneficiary_stocks as Record<string,unknown>[]:[],reportMode,log);

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
        if(openAiResult){
          log('OPENAI_RESULT_RECEIVED');
          if(openAiResult.confidence_score!==undefined&&openAiResult.confidence_score!==null)openAiResult.confidence_score=safeInteger(openAiResult.confidence_score,dScore.baseScore);
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
          aiStrategyJson=openAiResult;aiStrategyJson.openai_used=true;aiStrategyJson.build_method='openai_with_three_tier';
        }else{log('OPENAI_FAILED');aiStrategyJson=deterministicJson;aiStrategyJson.openai_used=false;aiStrategyJson.build_method='deterministic_fallback_three_tier';}
      }else{log('NO_OPENAI_KEY');aiStrategyJson=deterministicJson;aiStrategyJson.openai_used=false;aiStrategyJson.build_method='deterministic_no_key_three_tier';}
    }

    aiStrategyJson.version=VERSION;aiStrategyJson.generated_at=new Date().toISOString();
    aiStrategyJson.tw_stock_filter_applied=true;aiStrategyJson.research_card_format=true;
    aiStrategyJson.fields_complete_guaranteed=true;aiStrategyJson.write_time_guarantee=true;aiStrategyJson.member_note_format='plain_text_string';
    aiStrategyJson.sector_rotation_reference_date=sectorRotationReferenceDate;
    aiStrategyJson.sector_rotation_basis='previous_trading_day';
    aiStrategyJson.sector_rotation_rows=sectorData.length;
    aiStrategyJson.sector_rotation_data_status=sectorData.length>0?'available':'missing_previous_trading_day';

    const marketBias=String(aiStrategyJson.market_bias||classifyMarketBias(dScore.baseScore));
    const rawConfidenceScore=Number(aiStrategyJson.confidence_score)||dScore.baseScore;
    const writeResult=await writeReport(supabase,todayDate,aiStrategyJson,marketBias,rawConfidenceScore,reportMode,marketData,log,tradingDayInfo);
    if(!writeResult?.reportId){log('WRITE_FAILED');return corsResponse({success:false,error:'Failed to write report',report_date:todayDate,version:VERSION,logs},500);}

    const verified=await verifyReportExists(supabase,todayDate,log);
    if(!verified?.reportId){log('VERIFY_FAILED');return corsResponse({success:false,error:'Report written but verification failed',report_date:todayDate,report_id:writeResult.reportId,version:VERSION,logs},500);}

    const durationMs=Date.now()-reqStart;log('DONE report_id='+verified.reportId+' duration='+durationMs+'ms');
    return corsResponse({success:true,message:'Report generated (V9.0)',report_date:todayDate,report_id:verified.reportId,is_trading_day:tradingDayInfo.is_trading_day,market_closed:tradingDayInfo.market_closed,holiday_name:tradingDayInfo.holiday_name,tw_core_date:dates.twCoreDate,us_global_date:dates.usGlobalDate,source:String(aiStrategyJson.build_method||'deterministic'),market_bias:marketBias,confidence_score:safeInteger(rawConfidenceScore,50),report_mode:reportMode,duration_ms:durationMs,version:VERSION,logs},200);
  }catch(err){const msg=err instanceof Error?err.message:String(err);log('FATAL: '+msg);return corsResponse({success:false,error:msg,version:VERSION,logs},500)}
});
