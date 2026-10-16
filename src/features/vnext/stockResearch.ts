/** Private research context. Numeric facts are not member publication permission or trading advice. */
import {snapshotHash,sourceSafe,hashValid} from './contracts.ts';
import {traceIssues,type ResearchFact,type ResearchEvaluation,type DailyBar} from './researchFunnel.ts';
export type StockFact=ResearchFact&{symbol:string;data_quality_status:string};
export type StockEvent={symbol:string;event_type:string;source:string;published_at:string;first_seen_at:string;available_at:string;as_of:string;evidence_hash:string;id:string;detail_review:string};
export type Benchmark={date:string;open:number;close:number;source:string;published_at:null;first_seen_at:string;available_at:string;as_of:string;evidence_hash:string};
export type StockDossier={supporting:string[];opposing:string[];latest_revenue_month:string|null;coverage:{revenue_months:number;revenue_12:boolean;revenue_36:boolean;requested_month_present:boolean;institutional_sessions:number;institutional_20:boolean;financial_periods:number;cashflow_periods:number;comparable_eps_quarters:number;capex_quarters:number;event_index:number;event_content_reviewed:number};
 data_gaps:string[];prices:{date:string;open:number;high:number;low:number;close:number;volume:number;amount:number}|null;
 relative_strength:{scope:'SAME_SESSION_OPEN_TO_CLOSE_ONLY';stock_percent:number;market_percent:number;difference_percentage_points:number;source:string}|null;
 sources:{kind:string;source:string;published_at:string|null;first_seen_at:string|null;available_at:string|null;as_of:string|null;evidence_hash:string}[];historical_only:true;adjusted_return:null};
const monthsBack=(last:string,count:number)=>Array.from({length:count},(_,i)=>{const [y,m]=last.split('-').map(Number);return new Date(Date.UTC(y,m-count+i,1)).toISOString().slice(0,7);});
const money=(v:number)=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:0}).format(v);
export function stockDossier({research,bars,facts,events,benchmark,expectedSessions,lastMonth}:{research:ResearchEvaluation;bars:DailyBar[];facts:StockFact[];events:StockEvent[];benchmark:Benchmark[];expectedSessions:string[];lastMonth:string}):StockDossier{
 const at=research.cutoff,usable=facts.filter(f=>f.symbol===research.symbol&&traceIssues(f,at).length===0),revenues=usable.filter(f=>f.kind==='REVENUE').sort((a,b)=>a.period!.localeCompare(b.period!)),institutions=usable.filter(f=>f.kind==='INSTITUTIONAL'&&f.basis==='SHARES').sort((a,b)=>a.period!.localeCompare(b.period!));
 const latestMonth=revenues.at(-1)?.period??null,countMonths=(n:number)=>latestMonth!==null&&latestMonth<=lastMonth&&monthsBack(latestMonth,n).every(p=>revenues.filter(f=>f.period===p&&typeof f.values.revenue_thousand_twd==='number').length===1),financial=usable.filter(f=>f.kind==='FINANCIAL_YTD'),cashflow=usable.filter(f=>f.kind==='CASHFLOW_YTD');
 const validEvents=events.filter(e=>e.symbol===research.symbol&&traceIssues(e,at).length===0),last=bars.find(b=>b.date===research.through),index=benchmark.find(b=>b.date===research.through);
 const relative=last&&index&&traceIssues({...index,id:'market-'+index.date},at).length===0?{scope:'SAME_SESSION_OPEN_TO_CLOSE_ONLY' as const,stock_percent:(last.close/last.open-1)*100,market_percent:(index.close/index.open-1)*100,difference_percentage_points:((last.close/last.open)-(index.close/index.open))*100,source:index.source}:null;
 const coverage={revenue_months:new Set(revenues.map(f=>f.period)).size,revenue_12:countMonths(12),revenue_36:countMonths(36),requested_month_present:revenues.some(f=>f.period===lastMonth),institutional_sessions:new Set(institutions.map(f=>f.period)).size,institutional_20:expectedSessions.length>=20&&expectedSessions.slice(-20).every(d=>institutions.filter(f=>f.period===d).length===1),financial_periods:new Set(financial.map(f=>f.period)).size,cashflow_periods:new Set(cashflow.map(f=>f.period)).size,comparable_eps_quarters:usable.filter(f=>f.kind==='EPS'&&f.basis==='SINGLE_QUARTER').length,capex_quarters:usable.filter(f=>f.kind==='CAPEX'&&f.basis==='SINGLE_QUARTER').length,event_index:validEvents.length,event_content_reviewed:0};
 const supporting:string[]=[],opposing:string[]=[];
 if(research.horizon==='SHORT'&&last){if(research.metrics.amount_ratio>=1.5)supporting.push(`最近一日成交金額為前19個交易日平均的 ${research.metrics.amount_ratio.toFixed(2)} 倍，顯示參與增加。`);
  if(last.close>last.open&&Number.isFinite(research.metrics.close_location))supporting.push(`開盤 ${last.open} 元、收盤 ${last.close} 元；收盤位於當日價格區間的 ${(research.metrics.close_location*100).toFixed(1)}% 位置。`);
  if(relative){const text=`當日開盤至收盤，股票 ${relative.stock_percent.toFixed(2)}%，大盤 ${relative.market_percent.toFixed(2)}%；相差 ${relative.difference_percentage_points.toFixed(2)} 個百分點。這只代表當日相對表現，不是20日趨勢或投資報酬。`;(relative.difference_percentage_points>0?supporting:opposing).push(text);}
  const daily=institutions.find(f=>f.period===research.through);if(daily){for(const [k,label] of [['foreign_net_shares','外資'],['trust_net_shares','投信'],['dealer_net_shares','自營商']] as const){const v=daily.values[k];if(typeof v==='number')(v>0?supporting:opposing).push(`${label}當日${v>0?'買超':v<0?'賣超':'買賣平衡'} ${money(Math.abs(v))} 股；這是股數，不是金額。`);}}
 }
 if(research.horizon==='MEDIUM'){const last3=revenues.slice(-3);if(last3.length===3)(last3.every(f=>typeof f.values.yoy_percent==='number'&&f.values.yoy_percent>0)?supporting:opposing).push(`最近三個月營收年增率：${last3.map(f=>`${f.period} ${typeof f.values.yoy_percent==='number'?f.values.yoy_percent.toFixed(2)+'%':'無法比較'}`).join('、')}。`);
  if(research.metrics.net_shares!==undefined)(research.metrics.net_shares>0?supporting:opposing).push(`最近10個交易日三大法人合計${research.metrics.net_shares>0?'買超':'賣超'} ${money(Math.abs(research.metrics.net_shares))} 股。`);
  opposing.push('營收與法人方向不能證明訂單增加、產業轉強或股價已合理；尚未完成這些公司層面的審核。');}
 if(research.horizon==='LONG'){supporting.push(`已取得 ${coverage.revenue_months} 個月營收與 ${coverage.financial_periods} 期原始累計財報，僅作資料核對。`);opposing.push('累計EPS不能直接相減當成單季EPS；投資現金流不能冒充資本支出。需求、競爭優勢與估值仍未得到完整驗證。');}
 for(const e of validEvents.filter(e=>e.event_type==='TRADING_ATTENTION'))opposing.push(`${e.published_at.slice(0,10)} 有官方注意交易相關公告；這是風險查核線索，不是利多或已確認處置。`);
 opposing.push(validEvents.length?`查到 ${validEvents.length} 筆官方事件索引，但內文與影響尚未逐筆審核，不能宣稱沒有利空。`:'本次期間未取得可用事件內容；不能把空索引當成沒有公司風險。');
 opposing.push('完整價格調整權益尚未確認，不計算調整後趨勢、策略勝率或合理買價。');
 const selected=[...revenues.slice(-3),...institutions.slice(-10),...financial.slice(-4),...cashflow.slice(-4),...validEvents];
 const sources=selected.map(f=>({kind:'kind' in f?f.kind:'EVENT',source:f.source,published_at:f.published_at,first_seen_at:f.first_seen_at,available_at:f.available_at,as_of:f.as_of,evidence_hash:f.evidence_hash}));
 const gaps=[...(!coverage.revenue_12?['連續12個月營收仍有缺口']:[]),...(!coverage.institutional_20?['連續20個交易日法人仍有缺口']:[]),'可比較單季EPS與資本支出不足','事件內容、產業需求、競爭優勢、估值及現行供應鏈尚待驗證','原始發布時間與會員用途授權仍需核對'];
 return {supporting,opposing,coverage,latest_revenue_month:latestMonth,data_gaps:gaps,prices:last?{date:last.date,open:last.open,high:last.high,low:last.low,close:last.close,volume:last.volume,amount:last.amount}:null,relative_strength:relative,sources,historical_only:true,adjusted_return:null};
}
/** Pure queue plan: no timers, network, Production writes or caller wiring. */
export async function researchRunPlan(input:{session:string;cutoff:string;version:string;evidenceHash:string;coreComplete:boolean;coreBusy:boolean;existingLocks:string[]}){
 if(!/^\d{4}-\d\d-\d\d$/.test(input.session)||!Number.isFinite(Date.parse(input.cutoff))||!input.version||!hashValid(input.evidenceHash))throw Error('RESEARCH_PLAN_INVALID');
 const key=await snapshotHash({session:input.session,cutoff:input.cutoff,version:input.version,evidenceHash:input.evidenceHash});
 return {enabled:false,core_awaits_research:false,key,state:!input.coreComplete||input.coreBusy?'DEFERRED_CORE_PRIORITY':input.existingLocks.includes(key)?'ALREADY_LOCKED':'CANDIDATE_READY',max_attempts:3,timeout_ms:20000,concurrency:1,append_only:true,outcome_link:{prediction_hash:key,horizons:['SHORT','MEDIUM','LONG'],producer_enabled:false}};
}
export function validDossier(d:StockDossier){return d.historical_only===true&&d.adjusted_return===null&&d.sources.every(e=>sourceSafe(e.source)&&hashValid(e.evidence_hash))&&Object.values(d.coverage).every(v=>typeof v==='boolean'||Number.isInteger(v)&&v>=0);}
