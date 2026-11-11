/** Reproducible whole-universe research. Screening rules, observed price ranges,
 * relative-value scenarios and executable/reviewed trading plans are distinct. */
import {createHash} from 'node:crypto';
import {marketSnapshotHash,verifyTaiwanMarketCompletion} from './taiwan-market-universe.mjs';
import {marketObservationEvidence} from './taiwan-market-facts.mjs';
import {annualFinancialInputs,latestFinancialBridge,compactFinancialFields} from './taiwan-market-financial-inputs.mjs';
import {calculateTaiwanLongPeerReference,TAIWAN_LONG_PEER_PRICE_POLICY} from './taiwan-market-long-price.mjs';
import {createTaiwanReportedBvpsContext,calculateTaiwanReportedBvpsPeerReference,TAIWAN_REPORTED_BVPS_POLICY} from './taiwan-market-bvps.mjs';
import {compactTaiwanPriceReference,taiwanResearchReferenceSummary} from './taiwan-market-price-reference.mjs';
import {createTaiwanActionReplayEvidence} from './taiwan-market-actions.mjs';
import {MARKET_CALENDAR_VERSION,coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Error('TAIWAN_RESEARCH_'+code);};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const format=v=>finite(v)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(v):'未提供';
const average=a=>a.reduce((n,v)=>n+v,0)/a.length;
const HORIZONS=['SHORT','MEDIUM','LONG'];
export function expectedTaiwanResearchQuoteDate(cutoff) {
 const ms=Date.parse(cutoff);if(!Number.isFinite(ms))fail('CUTOFF');
 const date=new Date(ms+8*3600000).toISOString().slice(0,10);
 if(!coveredCalendarDate('TW',date))return null;
 return isMarketTradingDate('TW',date)&&ms>=Date.parse(date+'T17:05:00+08:00')?date:previousMarketTradingDate('TW',date);
}
export const TAIWAN_MARKET_RESEARCH_POLICY=Object.freeze({
 version:'TAIWAN_MARKET_RESEARCH_V1',short_sessions:61,short_average_windows:[20,60],short_atr_sessions:14,
 medium_minimum_peers:5,peer_quantiles:[0.25,0.5,0.75],peer_scope:'SAME_MARKET_INDUSTRY_QUOTE_DATE_AND_REPORTED_FINANCIAL_PERIOD',
 long_annual_years:3,long_financial_industries:['17'],maximum_evidence:100,medium_maximum_statement_age_days:180,
 short_rule:'RAW_TREND_DESCRIPTION; WATCH_REQUIRES_COMPLETE_CORPORATE_ACTION_COVERAGE',
 medium_rule:'POSITIVE_REPORTED_EARNINGS_AND_VERIFIED_REVENUE_GROWTH_AND_SAME_PERIOD_POSITIVE_EQUITY; PEER_PRICE_IS_SEPARATE_RESEARCH',
 long_rule:TAIWAN_LONG_PEER_PRICE_POLICY,
 reported_bvps_rule:TAIWAN_REPORTED_BVPS_POLICY,
 performance_validation:'NOT_ESTABLISHED',calibrated_success_rate:null,automatic_publication:false,
});
export function quantile(values,p) {
 if(!Array.isArray(values)||!values.length||values.some(v=>!finite(v))||!finite(p)||p<0||p>1)fail('QUANTILE');
 const sorted=[...values].sort((a,b)=>a-b),position=(sorted.length-1)*p,lo=Math.floor(position),hi=Math.ceil(position);
 return sorted[lo]+(sorted[hi]-sorted[lo])*(position-lo);
}
function latest(observations,family) {
 return observations.filter(o=>o.family===family&&!o.invalidated).sort((a,b)=>(b.period??b.date??b.source_as_of??'').localeCompare(a.period??a.date??a.source_as_of??'')
  ||Date.parse(b.available_at)-Date.parse(a.available_at))[0]??null;
}
function evidenceForHistory(bar,symbol) {
 const content=JSON.stringify({schema:'TAIWAN_MARKET_HISTORY_OBSERVATION_V1',kind:'DAILY_OHLCVA',family:'PRICE',symbol,
  market:bar.market,date:bar.date,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,amount:bar.amount,
  currency:'TWD',price_basis:bar.price_basis,session_scope:bar.session_scope,
  all_trades_session_complete:bar.all_trades_session_complete,source_capture:bar.source_capture});
 return {id:'market-'+sha(content).slice(0,40),symbol,kind:'PRICE',source:bar.source_capture.source_url,published_at:null,
  available_at:bar.available_at,content,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:bar.available_at,as_of:bar.available_at,evidence_hash:sha(content)};
}
function evidenceForFinancial(row,symbol) {
 const content=JSON.stringify({schema:'TAIWAN_FINANCIAL_HISTORY_OBSERVATION_V1',kind:row.family+'_HISTORY',symbol,
  market:row.market,period:row.period,period_basis:row.period_basis,period_identity_basis:row.period_identity_basis,
  period_scope:row.period_scope,amount_unit:row.amount_unit,eps_basis:row.eps_basis??null,...compactFinancialFields(row),
  source_capture:row.source_capture});
 if(content.length>12000)fail('FINANCIAL_EVIDENCE_SIZE');
 return {id:'market-'+sha(content).slice(0,40),symbol,kind:'FINANCIAL',source:row.source_url,published_at:null,
  available_at:row.available_at,content,time_basis:'OBSERVED_AFTER_RECEIPT',first_seen_at:row.available_at,as_of:row.available_at,evidence_hash:sha(content)};
}
function verifyBars(history,security,cutoff) {
 if(!history)return [];
 const {history_hash,...body}=history;
 if(history.schema!=='TAIWAN_SECURITY_HISTORY_V1'||marketSnapshotHash(body)!==history_hash||history.security_id!==security.security_id)fail('HISTORY_BINDING');
 const bars=history.bars.filter(b=>b.all_trades_session_complete===true).sort((a,b)=>a.date.localeCompare(b.date));
 const seen=new Set();
 for(const b of bars){if(seen.has(b.date)||b.symbol!==security.company.symbol||b.market!==security.company.market
  ||Date.parse(b.available_at)>Date.parse(cutoff)||Date.parse(b.date+'T13:30:00+08:00')>Date.parse(b.available_at)
  ||![b.open,b.high,b.low,b.close,b.volume,b.amount].every(v=>finite(v)&&v>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)
  ||!b.source_capture)fail('HISTORY_BAR');seen.add(b.date);}
 return bars.slice(-TAIWAN_MARKET_RESEARCH_POLICY.short_sessions);
}

/** A rerating sensitivity, not a forecast or an estimate of intrinsic value.
 * No EPS is reverse-engineered from price/PE and no arbitrary sector PE is used. */
export function peerRelativePrice({security,securities}) {
 const quote=latest(security.observations,'PRICE'),valuation=latest(security.observations,'VALUATION');
 if(!quote?.valid_trade||!finite(quote.close)||!valuation?.financial_period||quote.date!==valuation.date
  ||!finite(valuation.close)||Math.abs(quote.close-valuation.close)>0.000001
  ||security.company.instrument_kind!=='ORDINARY_COMPANY_EQUITY')return {state:'UNAVAILABLE',reason:'SAME_DATE_PRICE_AND_EXPLICIT_FINANCIAL_PERIOD_REQUIRED'};
 const metric=security.company.industry_code==='17'?'pb':valuation.pe>0?'pe':'pb';
 if(!(valuation[metric]>0))return {state:'UNAVAILABLE',reason:'POSITIVE_REPORTED_MULTIPLE_REQUIRED'};
 const peers=securities.filter(s=>s.security_id!==security.security_id&&s.company.market===security.company.market
  &&s.company.industry_code===security.company.industry_code&&s.company.instrument_kind==='ORDINARY_COMPANY_EQUITY').flatMap(s=>{
   const v=latest(s.observations,'VALUATION');return v&&v.date===valuation.date&&v.financial_period===valuation.financial_period&&v[metric]>0
    ?[{security_id:s.security_id,multiple:v[metric],source_capture:v.source_capture}]:[];
  });
 if(peers.length<TAIWAN_MARKET_RESEARCH_POLICY.medium_minimum_peers)return {state:'UNAVAILABLE',reason:'AT_LEAST_FIVE_COMPARABLE_PEERS_REQUIRED',peer_count:peers.length};
 const multiples=TAIWAN_MARKET_RESEARCH_POLICY.peer_quantiles.map(p=>quantile(peers.map(x=>x.multiple),p));
 return {schema:'TAIWAN_PEER_RERATING_SCENARIO_V1',state:'CALCULATED_RESEARCH_ONLY',security_id:security.security_id,
  method:metric==='pe'?'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE':'CURRENT_PRICE_TIMES_PEER_PB_DIVIDED_BY_CURRENT_OFFICIAL_PB',
  metric:metric.toUpperCase(),quote_date:quote.date,financial_period:valuation.financial_period,current_price:quote.close,current_multiple:valuation[metric],
  peer_count:peers.length,peer_quantiles:TAIWAN_MARKET_RESEARCH_POLICY.peer_quantiles,multiple_scenarios:multiples,
  price_scenarios:multiples.map(v=>quote.close*v/valuation[metric]),peers,
  issuer_source_captures:[quote.source_capture,valuation.source_capture],range_meaning:'PEER_MULTIPLE_RERATING_SENSITIVITY_NOT_INTRINSIC_VALUE_OR_TARGET',
  forecast:false,buy_ready:false,production_eligible:false,review:null};
}

function analyseSecurity({security,securities,history,financialRows,annualInput,cutoff,actions,expectedQuoteDate}) {
 if(actions!==null&&actions.schema!=='TAIWAN_MARKET_ACTION_COVERAGE_SET_V1')fail('VERIFIED_CORPORATE_ACTION_ADAPTER_NOT_CONNECTED');
 const symbol=security.company.symbol,observations=security.observations.filter(o=>!o.invalidated);
 const identity=latest(observations,'ROSTER');if(!identity)fail('ROSTER_EVIDENCE_REQUIRED');
 const prices=verifyBars(history,security,cutoff),rows=financialRows;
 for(const r of rows)if(Date.parse(r.available_at)>Date.parse(cutoff)||!r.source_capture||r.symbol!==symbol)fail('FINANCIAL_TIME_OR_IDENTITY');
 const selected=observations.filter(o=>o.family!=='ANNOUNCEMENT').concat(observations.filter(o=>o.family==='ANNOUNCEMENT').slice(-3));
 const evidence=selected.map(marketObservationEvidence),byObservation=new Map(selected.map((o,i)=>[o,evidence[i].id]));
 const historyEvidence=prices.map(b=>evidenceForHistory(b,symbol));evidence.push(...historyEvidence);
 const financialEvidence=rows.map(r=>evidenceForFinancial(r,symbol));
 const actionRow=actions?.corporate_actions?.[security.security_id]??null;
 const actionEvidence=actionRow?.market==='TPEX'?createTaiwanActionReplayEvidence(actionRow).map(e=>({...e,id:'market-'+e.evidence_hash.slice(0,40)})):[];
 if(evidence.length+financialEvidence.length+actionEvidence.length>TAIWAN_MARKET_RESEARCH_POLICY.maximum_evidence)fail('PACKET_EVIDENCE_LIMIT');
 evidence.push(...financialEvidence);const rowEvidence=new Map(rows.map((r,i)=>[r,financialEvidence[i].id]));
 evidence.push(...actionEvidence);
 const cite=(text,items)=>({text,evidence_ids:[...new Set(items.filter(Boolean).map(item=>typeof item==='string'?item:byObservation.get(item)??rowEvidence.get(item.source_record??item)).filter(Boolean))]});
 const chooseFinancial=family=>{
  const current=latest(observations,family),history=latestFinancialBridge(rows,family);
  return history&&(!current?.period||history.period>current.period)?history:current;
 };
 const quote=latest(observations,'PRICE'),revenue=latest(observations,'REVENUE'),income=chooseFinancial('INCOME')??latest(observations,'EPS_AS_REPORTED'),balance=chooseFinancial('BALANCE');
 const citedIdentity=byObservation.get(identity),horizons=[],missing=new Set(),diagnostics={};let shortPrice=null;
 const add=(horizon,status,reason,counter,confirmation,invalidation,gaps)=>{
  if(!reason.evidence_ids.length)fail('EMPTY_REASON_SOURCE');for(const c of counter)if(!c.evidence_ids.length)fail('EMPTY_COUNTER_SOURCE');
  horizons.push({horizon,status,reason,counter_evidence:counter,confirmation,invalidation,gaps:[...new Set(gaps)]});gaps.forEach(g=>missing.add(g));
 };
 const quoteGaps=[];if(!quote?.valid_trade)quoteGaps.push('VALID_CURRENT_PRICE_REQUIRED');
 if(!expectedQuoteDate)quoteGaps.push('TRADING_CALENDAR_COVERAGE_REQUIRED');
 else if(quote?.date!==expectedQuoteDate)quoteGaps.push('EXPECTED_COMPLETED_SESSION_QUOTE_REQUIRED');
 if(security.company.instrument_kind!=='ORDINARY_COMPANY_EQUITY')quoteGaps.push('SECURITY_CLASS_SPECIFIC_PRICE_METHOD_REQUIRED');
 if(security.company.market==='EMERGING'){
  add('SHORT',quote?.valid_trade?'WAIT':'INSUFFICIENT',quote?cite(`興櫃採議價交易；${quote.date} 加權均價 ${format(quote.average)} 元，最後成交價 ${format(quote.last)} 元，不能當成上市櫃開收盤價。`,[quote]):cite('官方名單已納入此興櫃公司，本次仍缺可用的原生行情。',[identity]),
   [cite('需要持續核對推薦券商買賣報價、價差與可成交量，最近成交價不能保證可成交。',[quote??identity])],
   '報買報賣與成交量持續可核對，再評估議價市場的進出條件。','報價停止、價差擴大或流動性不足時取消短期交易假設。',
   [...quoteGaps,'EMERGING_QUOTE_EXECUTION_MODEL_REQUIRED']);
 }else if(prices.length<TAIWAN_MARKET_RESEARCH_POLICY.short_sessions){
  add('SHORT','INSUFFICIENT',cite(`本次已取得 ${prices.length} 個完整交易範圍的歷史日資料，短期規則需要 61 個交易日。`,[citedIdentity,...historyEvidence.map(e=>e.id)]),
   [cite('日資料不足時，均線、波動與成交量的比較期間不一致。',[identity])],
   '完整歷史交易日、公司事件與最新行情全部可核對後重新計算。','缺交易日、資料日期過舊或出現未處理的公司事件時停用價格規則。',
   [...quoteGaps,'PRICE_HISTORY_61_COMPLETE_SESSIONS_REQUIRED']);
 }else{
  const last=prices.at(-1),last20=prices.slice(-20),ma20=average(last20.map(b=>b.close)),ma60=average(prices.slice(-60).map(b=>b.close));
  const tr=prices.slice(-14).map((b,i)=>{const prev=prices[prices.length-15+i];return Math.max(b.high-b.low,Math.abs(b.high-prev.close),Math.abs(b.low-prev.close));});
  const atr=average(tr),return20=(last.close/prices.at(-21).close-1)*100,medianAmount=quantile(last20.map(b=>b.amount),0.5);
  const requiredDates=history.expected_dates.filter(d=>d<=last.date).slice(-61),datesMatch=requiredDates.length===61&&requiredDates.every((d,i)=>d===prices[i].date);
  // A caller-supplied `complete: true` is not evidence. A versioned event-ledger
  // adapter must verify full coverage before it can enable this gate.
  const completeActions=!!(actionEvidence.length&&actionRow.complete&&actionRow.from<=prices[0].date&&actionRow.through>=last.date);
  const priceEvents=completeActions?actionRow.events.filter(e=>e.effective_date>=prices[0].date&&e.effective_date<=last.date):[];
  const gaps=[...quoteGaps];if(last.date!==expectedQuoteDate)gaps.push('EXPECTED_COMPLETED_SESSION_HISTORY_REQUIRED');
  if(!datesMatch)gaps.push('COMPLETE_CONSECUTIVE_MARKET_SESSIONS_REQUIRED');if(!completeActions)gaps.push('CORPORATE_ACTION_COVERAGE_REQUIRED');
  if(priceEvents.length)gaps.push('RAW_HISTORY_HAS_CORPORATE_ACTION_DISCONTINUITY');
  const state=gaps.length?'WAIT':last.close>ma20&&ma20>ma60?'WATCH':last.close<ma20&&ma20<ma60?'AVOID':'WAIT';
  diagnostics.short={through:last.date,ma20,ma60,atr14:atr,raw_price_change_20_sessions_percent:return20,median_turnover_20:medianAmount,
   return_is_total_shareholder_return:false,consecutive_market_sessions:datesMatch,corporate_action_coverage_complete:completeActions,
   corporate_action_events_in_window:priceEvents.map(e=>({kind:e.kind,effective_date:e.effective_date,event_id:e.event_id})),adjustment_applied:false};
  shortPrice={schema:'TAIWAN_OBSERVED_PRICE_RANGE_V1',security_id:security.security_id,through:last.date,current_price:last.close,
   range:[Math.min(...last20.map(b=>b.low)),Math.max(...last20.map(b=>b.high))],atr14:atr,
   meaning:'OBSERVED_UNADJUSTED_20_SESSION_RANGE_NOT_FAIR_VALUE_OR_TRADE_TARGET',forecast:false,buy_ready:false,production_eligible:false,
   source_capture_ids:[...new Set(prices.map(b=>b.source_capture.capture_id))]};
  add('SHORT',state,cite(`截至 ${last.date}，收盤 ${format(last.close)} 元，20 日均價 ${format(ma20)} 元，60 日均價 ${format(ma60)} 元；這是原始價格趨勢觀察。${completeActions?`五類公司行動已核對，分析視窗內有 ${priceEvents.length} 個事件。`:''}`,[...historyEvidence.map(e=>e.id),...actionEvidence.map(e=>e.id)]),
   [cite(`近 20 日成交金額中位數 ${format(medianAmount)} 元；未還原公司事件的價格變動不能當成實現報酬。`,[...historyEvidence.slice(-20).map(e=>e.id),...actionEvidence.map(e=>e.id)])],
   '完整公司事件核對後，價格趨勢及成交金額持續符合規則才列入觀察。','趨勢反轉、流動性下降或發現未處理的除權息及股本變動時重新評估。',gaps);
 }
 const peer=peerRelativePrice({security,securities}),mediumGaps=[];
 if(!revenue||!revenue.yoy_arithmetic_verified)mediumGaps.push('VERIFIED_MONTHLY_REVENUE_COMPARISON_REQUIRED');
 if(!income||income.eps_basic===null||!income.period)mediumGaps.push('PERIOD_IDENTIFIED_REPORTED_EARNINGS_REQUIRED');
 if(peer.state!=='CALCULATED_RESEARCH_ONLY')mediumGaps.push(peer.reason);
 if(!quote?.valid_trade)mediumGaps.push('VALID_CURRENT_PRICE_REQUIRED');
 if(!expectedQuoteDate)mediumGaps.push('TRADING_CALENDAR_COVERAGE_REQUIRED');
 else if(quote?.date!==expectedQuoteDate)mediumGaps.push('EXPECTED_COMPLETED_SESSION_QUOTE_REQUIRED');
 const positive=revenue?.yoy_arithmetic_verified&&revenue.yoy_percent>0&&income?.eps_basic>0;
 const negative=revenue?.yoy_arithmetic_verified&&revenue.yoy_percent<0&&income?.eps_basic<0;
 const incomePeriodValid=typeof income?.period==='string'&&/^\d{4}Q[1-4]$/.test(income.period);
 const statementEnd=incomePeriodValid?Date.UTC(Number(income.period.slice(0,4)),Number(income.period.at(-1))*3,0):null;
 const financialFresh=statementEnd!==null&&(Date.parse(cutoff)-statementEnd)/86400000<=TAIWAN_MARKET_RESEARCH_POLICY.medium_maximum_statement_age_days;
 if(!financialFresh)mediumGaps.push('RECENT_REPORTED_FINANCIAL_PERIOD_REQUIRED');
 const positiveEquity=incomePeriodValid&&balance?.equity>0&&balance?.period===income?.period&&balance.balance_identity_verified===true;
 if(!positiveEquity)mediumGaps.push('SAME_PERIOD_VERIFIED_POSITIVE_EQUITY_REQUIRED');
 const hasCore=!!revenue?.yoy_arithmetic_verified&&incomePeriodValid&&finite(income?.eps_basic);
 let mediumState=!hasCore?'INSUFFICIENT':negative?'AVOID':positive&&positiveEquity?'WATCH':'WAIT';
 if((!quote?.valid_trade||quote.date!==expectedQuoteDate||!expectedQuoteDate||!financialFresh)&&mediumState==='WATCH')mediumState='WAIT';
 const mediumReason=revenue&&income?cite(`${revenue.period} 原報表營收年增 ${format(revenue.yoy_percent)}%；${income.period??'期間未標示'} 原報表基本每股盈餘 ${format(income.eps_basic)} 元，未轉成單季、稀釋或 TTM EPS。${positiveEquity?'同期間資產負債表的權益為正，且資產與負債加權益相符。':''}`,[revenue,income,positiveEquity?balance:null])
  :cite('已逐檔核對官方資料，本次仍缺可相互核對的月營收或具期間的獲利資料。',[revenue??income??identity]);
 const mediumCounter=[cite('單月營收與單份財報不能證明成長會延續；需再核對後續公告及獲利品質。',[revenue??income??identity])];
 const reportedValue=latest(observations,'VALUATION');
 if(reportedValue)mediumCounter.push(cite(`官方 ${reportedValue.date} 本益比 ${format(reportedValue.pe)}、股價淨值比 ${format(reportedValue.pb)}；市場倍數本身不能保證成長或報酬。`,[reportedValue]));
 add('MEDIUM',mediumState,mediumReason,mediumCounter,'後續營收與原始財報持續支持成長，且估值、現金流及公司事件同步核對。',
  '營收趨勢轉弱、獲利下降、財報更正或估值前提不再成立時撤回中期假設。',mediumGaps);

 const {years,annuals,metrics:annualMetrics}=annualInput;
 const longGaps=[];for(const a of annuals){if(!a.income)longGaps.push(`${a.year}_ANNUAL_INCOME_REQUIRED`);if(!a.balance)longGaps.push(`${a.year}_ANNUAL_BALANCE_REQUIRED`);if(!a.cashflow)longGaps.push(`${a.year}_ANNUAL_CASHFLOW_REQUIRED`);}
 const financialSector=TAIWAN_MARKET_RESEARCH_POLICY.long_financial_industries.includes(security.company.industry_code);
 if(financialSector)longGaps.push('FINANCIAL_SECTOR_CAPITAL_ADEQUACY_AND_ASSET_QUALITY_REVIEW_REQUIRED');
 for(const a of annualMetrics)if(a.net_profit===null||a.equity===null||a.assets===null||!financialSector&&a.operating_cashflow===null)longGaps.push(`${a.year}_ANNUAL_QUALITY_FIELDS_REQUIRED`);
 for(const a of annualMetrics)if(a.cashflow_reconciliation?.within_year===false||a.cashflow_reconciliation?.opening_matches_previous_closing===false)
  longGaps.push(`${a.year}_CASHFLOW_BALANCE_RECONCILIATION_REVIEW_REQUIRED`);
 const longSources=annuals.flatMap(a=>[a.income,a.balance,a.cashflow]).filter(Boolean),latestMetric=annualMetrics.at(-1);
 const quality=annualMetrics.every(a=>a.net_profit>0&&a.equity>0&&a.assets>=a.equity&&(a.parent_net_profit===null||a.parent_net_profit>=0))
  &&annualMetrics.every(a=>finite(a.operating_cashflow))&&annualMetrics.filter(a=>a.operating_cashflow>0).length>=2
  &&annualMetrics.reduce((n,a)=>n+a.operating_cashflow,0)>0;
 let longState=longGaps.length?'INSUFFICIENT':quality?'WATCH':'WAIT';
 if(latestMetric.equity!==null&&latestMetric.equity<=0||annualMetrics.filter(a=>a.net_profit!==null&&a.net_profit<0).length>=2)longState='AVOID';
 if(!expectedQuoteDate||quote?.date!==expectedQuoteDate||!quote?.valid_trade){longGaps.push('EXPECTED_COMPLETED_SESSION_QUOTE_REQUIRED');if(longState==='WATCH')longState='WAIT';}
 const longReason=longSources.length?cite(`${years[0]}–${years.at(-1)} 年度報表已逐年核對 ${longSources.length} 份；最近年度原報表總淨利 ${format(latestMetric.net_profit)} 仟元、權益 ${format(latestMetric.equity)} 仟元、營業現金流 ${format(latestMetric.operating_cashflow)} 仟元。`,longSources)
  :cite('已納入長期分析；本次快照不足以確認三年獲利與現金流的持續性，歷史財報列入取得清單。',[income??balance??identity]);
 add('LONG',longState,longReason,[cite('營業現金流尚未扣除資本支出與融資需求，不能直接當作股東自由現金流或估值輸入。',longSources.length?longSources:[income??balance??identity])],
  '連續年度獲利、現金流、資產負債與產業條件相互支持，並完成股本及估值假設核對。','持續虧損、現金轉換惡化、淨值受損或產業需求前提失效時撤回長期假設。',longGaps);
 diagnostics.long={annuals:annualMetrics,financial_sector:financialSector,free_cash_flow_inferred:false};
 const dates=[quote?.date,...prices.map(p=>p.date)].filter(Boolean).sort();
 const packet={symbol,company:security.company.short_name||security.company.company,cutoff,evidence,data_gaps:[...missing]};if(dates.length)packet.data_through=dates.at(-1);
 const analysis={schema:'DAILY_AI_STOCK_ANALYSIS_V2',symbol,cutoff,input_hash:marketSnapshotHash(packet),horizons,
  sources:evidence.map(({content,...source})=>{void content;return source;}),analysis_origin:'DETERMINISTIC_SCREENING',
  method_version:TAIWAN_MARKET_RESEARCH_POLICY.version,model_generated:false,member_published:false};
 if(shortPrice)shortPrice.input_packet_hash=analysis.input_hash;
 return {security_id:security.security_id,packet,analysis,diagnostics,price_research:{short:shortPrice,medium:peer,
  long:null}};
}

export function runTaiwanMarketResearch({universe,plan,facts,history=null,financial_history=null,corporate_actions=null,expected_quote_date=undefined}) {
 const {facts_hash,...factsBody}=facts??{}, {plan_hash,...planBody}=plan??{};
 if(facts?.schema!=='TAIWAN_MARKET_FACT_SET_V1'||marketSnapshotHash(factsBody)!==facts_hash||plan?.schema!=='DAILY_AI_MARKET_WORK_PLAN_V2'
  ||marketSnapshotHash(planBody)!==plan_hash||facts.universe_hash!==universe.universe_hash||plan.universe_hash!==universe.universe_hash
  ||Date.parse(facts.cutoff)>Date.parse(plan.cutoff)||facts.securities.length!==universe.total)fail('BATCH_BINDING');
 const expectedQuoteDate=expectedTaiwanResearchQuoteDate(plan.cutoff);
 if(expected_quote_date!==undefined&&expected_quote_date!==expectedQuoteDate)fail('EXPECTED_SESSION_MISMATCH');
 const companyMap=new Map(universe.companies.map(c=>[c.security_id,marketSnapshotHash(c)]));
 const historyRows=history?.stocks??[],financialRows=financial_history?.records??[];
 if(!Array.isArray(historyRows)||!Array.isArray(financialRows))fail('INPUT_COLLECTIONS');
 const hmap=new Map(historyRows.map(h=>[h.security_id,h])),financialMap=new Map(),annualMap=new Map(),annualInputs=new Map(),all=new Map();
 for(const row of financialRows){if(!financialMap.has(row.security_id))financialMap.set(row.security_id,[]);financialMap.get(row.security_id).push(row);}
 for(const security of facts.securities){const annual=annualFinancialInputs(financialMap.get(security.security_id)??[],plan.cutoff);annualInputs.set(security.security_id,annual);annualMap.set(security.security_id,annual.metrics);}
 for(const security of facts.securities){if(all.has(security.security_id)||companyMap.get(security.security_id)!==marketSnapshotHash(security.company))fail('DUPLICATE_OR_CHANGED_SECURITY');
  all.set(security.security_id,analyseSecurity({security,securities:facts.securities,history:hmap.get(security.security_id),financialRows:financialMap.get(security.security_id)??[],annualInput:annualInputs.get(security.security_id),cutoff:plan.cutoff,
   actions:corporate_actions,expectedQuoteDate}));}
 const price_input_pool=Object.create(null),price_input_bindings=Object.create(null),annualQuality=new Map();
 for(const security of facts.securities){const cohort=facts.securities.filter(s=>s.company.market===security.company.market&&s.company.industry_code===security.company.industry_code),price=all.get(security.security_id).price_research;
  price.long=calculateTaiwanLongPeerReference({security_id:security.security_id,securities:cohort,annual_metrics:annualMap,cutoff:plan.cutoff,expected_quote_date:expectedQuoteDate});
  annualQuality.set(security.security_id,price.long.issuer_quality??null);
  // Keep whole-market memory bounded: established peer samples can be shared
  // immediately; only unavailable TPEX results await the BVPS fallback.
  if(security.company.market!=='TPEX'||price.long.state==='CALCULATED_RESEARCH_ONLY')
   price.long=compactTaiwanPriceReference(price.long,price_input_pool,price_input_bindings);
 }
 const tpex=facts.securities.filter(s=>s.company.market==='TPEX');
 // Validate the complete source set once. This fallback uses the original
 // explicitly reported BVPS; it never manufactures a quarter or official P/B.
 if(tpex.length&&financialRows.length&&corporate_actions){
  const context=createTaiwanReportedBvpsContext({securities:tpex,financial_rows:financialRows,corporate_actions,
   cutoff:plan.cutoff,expected_quote_date:expectedQuoteDate,annual_quality:annualQuality});
  for(const security of tpex){const result=all.get(security.security_id),price=result.price_research;
   for(const horizon of ['MEDIUM','LONG']){const key=horizon.toLowerCase();if(price[key]?.state==='CALCULATED_RESEARCH_ONLY')continue;
    const prior=price[key],reference=calculateTaiwanReportedBvpsPeerReference({security_id:security.security_id,horizon,context});
    const analysis=result.analysis.horizons.find(h=>h.horizon===horizon);
    if(prior?.reason)analysis.gaps=analysis.gaps.filter(g=>g!==prior.reason);
    price[key]=reference;
    result.diagnostics[key+'_reported_bvps']={state:reference.state,method_version:reference.method_version,
     reference_hash:reference.reference_hash,peer_count:reference.peer_count,reasons:reference.reasons??(reference.reason?[reference.reason]:[])};
    if(reference.state==='CALCULATED_RESEARCH_ONLY'){
     const expectedCaptures=new Set(Object.values(reference.issuer_source_captures).map(c=>c.capture_id+':'+c.source_row_hash));
     const foundCaptures=new Set(),ids=result.packet.evidence.filter(e=>{const body=JSON.parse(e.content),c=body.source_capture;
      const key=c&&c.capture_id+':'+c.source_row_hash;if(!expectedCaptures.has(key))return false;foundCaptures.add(key);return true;}).map(e=>e.id);
     if(foundCaptures.size!==expectedCaptures.size)fail('BVPS_ISSUER_EVIDENCE_NOT_IN_PACKET');
     const actionIds=reference.issuer_action_proof.coverage_evidence.map(e=>e.id),packetIds=new Set(result.packet.evidence.map(e=>e.id));
     if(actionIds.some(id=>!packetIds.has(id)))fail('BVPS_ACTION_EVIDENCE_NOT_IN_PACKET');
     analysis.reason={text:analysis.reason.text+` ${reference.financial_period} 原季報每股參考淨值 ${format(reference.reported_bvps)} 元，乘以 ${reference.peer_count} 家同期同業的計算 P/B 分位數，得出價格參考；同業 P/B 採同日收盤價除以各公司原季報每股淨值。`,
      evidence_ids:[...new Set([...analysis.reason.evidence_ids,...ids,...actionIds])]};
     analysis.counter_evidence.push({text:'每股淨值保留原季報數值；季末後已核對五類公司事件並排除未調整的股數變動。現金股利另列，未推算即時淨值，也未將同業分位數當成未來報酬。',evidence_ids:[...new Set([...ids,...actionIds])]});
    }else analysis.gaps=[...new Set([...analysis.gaps,...(reference.reasons??[reference.reason])])];
   }
   result.packet.data_gaps=[...new Set(result.analysis.horizons.flatMap(h=>h.gaps))];
   result.analysis.input_hash=marketSnapshotHash(result.packet);
   if(price.short)price.short.input_packet_hash=result.analysis.input_hash;
  }
 }
 for(const result of all.values()){
  for(const horizon of ['short','medium','long'])if(result.price_research[horizon]?.input_encoding!=='SHARED_PRICE_INPUTS_V1')
   result.price_research[horizon]=compactTaiwanPriceReference(result.price_research[horizon],price_input_pool,price_input_bindings);
 }
 const price_input_pool_hash=marketSnapshotHash(price_input_pool);
 const shards=plan.shards.map(shard=>({shard_id:shard.shard_id,stocks:shard.security_ids.map(id=>{const r=all.get(id);if(!r)fail('MISSING_SECURITY');
  const research_references=Object.fromEntries(HORIZONS.map(horizon=>[horizon,taiwanResearchReferenceSummary({security_id:id,horizon,reference:r.price_research[horizon.toLowerCase()],input_pool_hash:price_input_pool_hash})]));
  return {security_id:r.security_id,packet:r.packet,analysis:r.analysis,research_references};}),cards:shard.security_ids.flatMap(id=>all.get(id).analysis.horizons.map(h=>({security_id:id,horizon:h.horizon,status:h.status})))}));
 const completion=verifyTaiwanMarketCompletion(plan,shards),counts=Object.fromEntries(HORIZONS.map(h=>[h,Object.fromEntries(['WATCH','WAIT','AVOID','INSUFFICIENT'].map(status=>[status,
  [...all.values()].filter(r=>r.analysis.horizons.some(v=>v.horizon===h&&v.status===status)).length]))]));
 const acquisition_queue=[...all.values()].flatMap(r=>r.analysis.horizons.flatMap(h=>h.gaps.map(code=>({security_id:r.security_id,horizon:h.horizon,code,status:'REQUIRED_EVIDENCE_NOT_ASSUMED'}))));
 const body={schema:'TAIWAN_MARKET_RESEARCH_RUN_V1',universe_hash:universe.universe_hash,plan_hash,facts_hash,cutoff:plan.cutoff,
  expected_quote_date:expectedQuoteDate,calendar_version:MARKET_CALENDAR_VERSION,
  analysis_origin:'DETERMINISTIC_SCREENING',method_version:TAIWAN_MARKET_RESEARCH_POLICY.version,policy_hash:marketSnapshotHash(TAIWAN_MARKET_RESEARCH_POLICY),
  coverage:{...completion,counts,security_count:all.size,formal_recommendations:0,approved_price_plans:0},shards,
  price_research:[...all.values()].map(r=>({security_id:r.security_id,...r.price_research})),
  price_input_pool,price_input_bindings,price_input_pool_hash,
  diagnostics:[...all.values()].map(r=>({security_id:r.security_id,...r.diagnostics})),acquisition_queue,
  methodology_approved:false,member_published:false};
 return {...body,run_hash:marketSnapshotHash(body)};
}
