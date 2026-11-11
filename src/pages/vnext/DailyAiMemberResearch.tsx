import {useEffect,useMemo,useState} from 'react';
import {HORIZONS,compareTime,type Horizon} from '@/features/vnext/contracts';
import {DAILY_AI_MEMBER_STATES,dailyAiAnalysisOrigin,type DailyAiMemberCard,type DailyAiMemberSource,type DailyAiMemberResearch as Research,type DailyAiMemberState} from '@/features/vnext/dailyAiMember';
import {dailyAiAnalysisText,dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import {dailyAiPricePlanForCard,type DailyAiMemberPricePlans,type DailyAiPricePlan} from '@/features/vnext/dailyAiPricePlan';
import {dailyAiPriceDisplay,DAILY_AI_PRICE_PRECISION_PENDING} from '@/features/vnext/dailyAiPriceDisplay';
import './daily-ai-member.css';
import './daily-ai-comparison.css';

const periods={SHORT:'先看近期事件與量價，確認條件成立後再評估。',MEDIUM:'追蹤未來數週的營收、營運與事件變化。',LONG:'檢查長期需求、獲利與估值能否支持布局。'};
const states=Object.keys(DAILY_AI_MEMBER_STATES) as DailyAiMemberState[];
export type DailyAiMemberViewState={filter:DailyAiMemberState|'ALL';query:string;limit:number};
type ComparisonScope={research:string;prices:string;validity:string;unavailable:boolean};
const order:Record<DailyAiMemberState,number>={WATCH:0,WAIT:1,AVOID:2,INSUFFICIENT:3};
const formatter=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const date=(value:string)=>formatter.format(new Date(value));
// PostgreSQL may retain microseconds; a browser timer must use the first
// representable millisecond at or after that exact deadline.
const sourceKinds={NEWS:'新聞／公告',MARKET:'市場資料',FINANCIAL:'財務資料',PRICE:'價格資料'};
const priceDeadlineMs=(value:string)=>{const ms=Date.parse(value);return Number.isFinite(ms)&&compareTime(value,new Date(ms).toISOString())>0?ms+1:ms;};
function PricePlan({plan,status,sources}:{plan:DailyAiPricePlan;status:DailyAiMemberState;sources:readonly DailyAiMemberSource[]}){
 const display=dailyAiPriceDisplay(plan);
 return <section className="dam-price-plan" aria-label="條件式價格研究"><h4>條件式價格研究</h4>
  <p>{status==='WAIT'?'目前仍在等待確認；價格進入區間後，仍需核對上方確認條件。':'研究區間用來追蹤條件，仍需核對事件與風險。'}</p>
  {display?<dl><div><dt>研究區間</dt><dd>NT${display.entry_range[0]}～{display.entry_range[1]}</dd></div>
   <div><dt>超過先等</dt><dd>NT${display.wait_above} 以上先等待重評</dd></div>
   {display.stop!==null?<div><dt>停止參考價</dt><dd>NT${display.stop}</dd></div>:null}
  </dl>:<p role="status">{DAILY_AI_PRICE_PRECISION_PENDING}</p>}
  <p className="dam-price-invalidation"><strong>停止／重評條件：</strong>{plan.invalidation}</p>
  <p className="dam-summary-note">條件式研究；關注與等待狀態均不代表買進指令，研究價格不等於可下單報價。</p>
  <details><summary>價格依據與有效期</summary><p>{plan.basis}</p><p>研究方法：{plan.method}</p>
   <p>價格計畫核對：{date(plan.as_of)}；有效至 {date(plan.expires_at)}（台北）。</p>
   <ul>{sources.map(source=><li key={source.id}><a href={source.source} target="_blank" rel="noopener noreferrer">{new URL(source.source).hostname}</a>
    <span>{source.published_at?`原發布：${date(source.published_at)}`:'原發布時間未確認'} · 本次可用：{date(source.available_at)}</span></li>)}</ul>
  </details>
 </section>;
}
function Gaps({gaps}:{gaps:string[]}){
 if(!gaps.length)return null;
 return <section className="dam-gaps"><h4>研究限制與待確認資料</h4><ul>{gaps.slice(0,3).map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul>{gaps.length>3&&<details><summary>再看 {gaps.length-3} 項資料限制</summary><ul>{gaps.slice(3).map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></details>}</section>;
}
const openFinancialSource=(source:string)=>/^https:\/\/openapi\.twse\.com\.tw\/v1\/(?:opendata\/|exchangeReport\/BWIBBU_d(?:$|\?))/.test(source)||/^https:\/\/www\.tpex\.org\.tw\/openapi\/v1\//.test(source);
function EditionSources({year}:{year:string}){
 return <details className="dam-gaps"><summary>本版資料來源與授權說明</summary>
  <p>以下為完整研究版本的官方資料來源範圍，免費摘要也保留此說明。各股票實際採用的項目、期間與取得情形，請搭配資料依據及缺口判讀。</p>
  <ul>
   <li>臺灣證券交易所，{year} 年資料：<a href="https://data.gov.tw/dataset/20756" target="_blank" rel="noopener noreferrer">上市公司各產業 EPS 統計資訊</a>、<a href="https://data.gov.tw/dataset/91998" target="_blank" rel="noopener noreferrer">上市公司綜合損益表（一般業）</a>、<a href="https://data.gov.tw/dataset/11764" target="_blank" rel="noopener noreferrer">個股每日估值：本益比、殖利率與股價淨值比</a>、<a href="https://data.gov.tw/dataset/18415" target="_blank" rel="noopener noreferrer">上市公司每日重大訊息</a>。</li>
   <li>櫃買中心，{year} 年資料：<a href="https://data.gov.tw/dataset/20757" target="_blank" rel="noopener noreferrer">上櫃公司各產業 EPS 統計資訊</a>、<a href="https://data.gov.tw/dataset/11373" target="_blank" rel="noopener noreferrer">上櫃股票每日估值：本益比、殖利率與股價淨值比</a>、<a href="https://data.gov.tw/dataset/18418" target="_blank" rel="noopener noreferrer">上櫃公司每日重大訊息</a>。</li>
  </ul>
  <p>上述資料集由金融監督管理委員會證券期貨局提供，原始資料來自臺灣證券交易所及櫃買中心，依<a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">政府資料開放授權條款第 1 版</a>釋出及利用。資料年份標示不代表每筆財報均為當期，請保留各筆實際期別。</p>
  <p>Board of Governors of the Federal Reserve System（美國聯準會理事會）：<a href="https://www.federalreserve.gov/feeds/press_all.xml" target="_blank" rel="noopener noreferrer">官方新聞發布 RSS</a>。依其<a href="https://www.federalreserve.gov/disclaimer.htm" target="_blank" rel="noopener noreferrer">公開領域與著作權政策</a>，未另行標示權利的資訊屬公共領域，第三方素材及標誌除外。RSS 僅提供聯準會發布背景，不能代替美股收盤行情。</p>
  <p>引用美國證券交易委員會（SEC）<a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener noreferrer">EDGAR 公開申報資料</a>時，依其<a href="https://www.sec.gov/about/webmaster-frequently-asked-questions" target="_blank" rel="noopener noreferrer">公開申報內容使用說明</a>保留來源。公司申報數字、自有研究意見與明示假設的估值情境會分開說明。研究意見由 Morning Alpha 整理；情境估值依分析假設推算，使用時請一併核對敏感度與重評條件。季度與年度的會計準則、期間及修訂狀態，以各筆資料與缺口為準。</p>
  <p>事實摘要與研究判讀由 Morning Alpha 整理，未轉載新聞或公告全文。</p>
  <p>引用資料中的候選研究註記保留產出時狀態；本頁可讀範圍以本版發布審核為準。</p>
 </details>;
}
function Evidence({card,year}:{card:DailyAiMemberCard;year:string}){
 if(card.sources===null)return <p className="dam-summary-note">此方案顯示研究摘要。</p>;
 const openFinancial=card.sources.some(s=>openFinancialSource(s.source));
 const treasury=card.sources.some(s=>new URL(s.source).hostname==='home.treasury.gov');
 return <details><summary>核對這個判斷的資料依據</summary><ul>{card.sources.map(s=><li key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer">{new URL(s.source).hostname}</a>
  <span>{s.published_at?`原發布：${date(s.published_at)}`:'原發布時間未確認；依收到後的資料研究。'} · 本次可用：{date(s.available_at)}</span>
 </li>)}</ul>{openFinancial&&<p>本卡引用臺灣證券交易所／櫃買中心 {year} 年 EPS、財報、每日估值或重大訊息等公開資料，依<a href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">政府資料開放授權條款第 1 版</a>使用；各資料集顯名見上方共用來源說明。</p>}{treasury&&<p>美國公債殖利率：U.S. Treasury，資料集標示 <a href="https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates" target="_blank" rel="noopener noreferrer">CC0</a>；利率資料不代表美股指數收盤。</p>}</details>;
}
export default function DailyAiMemberResearch({data,pricePlans=null,pricePlansUnavailable=false,pricePlansLoading=false,priceSubjectUserId,selectedHorizon,onHorizonChange,viewState,onViewChange,checkedAt,refreshing=false,onRefresh}:{data:Research;pricePlans?:DailyAiMemberPricePlans|null;pricePlansUnavailable?:boolean;pricePlansLoading?:boolean;priceSubjectUserId?:string;selectedHorizon?:Horizon;onHorizonChange?:(horizon:Horizon)=>void;
 checkedAt?:string;refreshing?:boolean;onRefresh?:()=>void;
 viewState?:DailyAiMemberViewState;onViewChange?:(change:(previous:DailyAiMemberViewState)=>DailyAiMemberViewState)=>void}){
 const [localHorizon,setHorizon]=useState<Horizon>('SHORT'),[localView,setLocalView]=useState<DailyAiMemberViewState>({filter:'ALL',query:'',limit:9}),[now,setNow]=useState(Date.now);
 const [comparison,setComparison]=useState<{scope:ComparisonScope|null;symbols:string[]}>({scope:null,symbols:[]});
 const horizon=selectedHorizon??localHorizon;
 const {filter,query,limit}=viewState??localView;
 const changeView=(change:(previous:DailyAiMemberViewState)=>DailyAiMemberViewState)=>{if(viewState===undefined)setLocalView(change);onViewChange?.(change);};
 const expiresAt=data.edition?.expires_at??null;
 const planExpiries=pricePlans?.edition_id===data.edition?.id&&pricePlans?.tier===data.tier
  &&(!priceSubjectUserId||pricePlans.subject_user_id===priceSubjectUserId)?pricePlans.plans.map(plan=>priceDeadlineMs(plan.expires_at)).filter(expiry=>Number.isFinite(expiry)&&expiry>now):[];
 const priceDeadline=planExpiries.length?Math.min(...planExpiries):Infinity;
 useEffect(()=>{
  const update=()=>setNow(previous=>Math.max(previous,Date.now())),timer=setInterval(update,15000);
  const expiry=expiresAt===null?null:Math.min(Date.parse(expiresAt),priceDeadline);
  const deadline=expiry===null?undefined:setTimeout(()=>setNow(previous=>Math.max(previous,Date.now(),expiry)),Math.min(2147483647,Math.max(0,expiry-Date.now())));
  document.addEventListener('visibilitychange',update);
  update();
  return()=>{clearInterval(timer);clearTimeout(deadline);document.removeEventListener('visibilitychange',update);};
 },[expiresAt,priceDeadline]);
 const edition=data.edition;
 // Build the per-period list and counts once per validated cards projection.
 // Clock ticks, price reads and comparison clicks do not sort every stock again.
 const views=useMemo(()=>{
  const make=()=>({cards:[] as DailyAiMemberCard[],counts:{WATCH:0,WAIT:0,AVOID:0,INSUFFICIENT:0}});
  const periods={SHORT:make(),MEDIUM:make(),LONG:make()};
  for(const card of data.cards){periods[card.horizon].cards.push(card);periods[card.horizon].counts[card.status]++;}
  for(const period of Object.values(periods))period.cards.sort((a,b)=>order[a.status]-order[b.status]||a.symbol.localeCompare(b.symbol));
  const commonGaps=[...new Set(data.cards[0]?.gaps??[])].filter(gap=>data.cards.every(card=>card.gaps.includes(gap)));
  return {periods,commonGaps,commonGapSet:new Set(commonGaps)};
 },[data.cards]);
 const all=views.periods[horizon].cards,counts=views.periods[horizon].counts;
 const rows=useMemo(()=>all.filter(card=>(filter==='ALL'||card.status===filter)&&(!query.trim()||`${card.symbol} ${card.company}`.includes(query.trim()))),[all,filter,query]);
 // Store chosen symbols and an exact read scope, never a new recommendation.
 // Bind it to the exact approved snapshot, tier,
 // subject and period; a changed read hides comparison before effect cleanup.
 // Exact text equality avoids accepting a colliding UI revision fingerprint.
 const comparisonResearch=useMemo(()=>JSON.stringify([priceSubjectUserId??null,data.tier,data.business_date,edition,horizon,all]),
  [priceSubjectUserId,data.tier,data.business_date,edition,horizon,all]);
 const comparisonPrices=useMemo(()=>JSON.stringify(pricePlans),[pricePlans]);
 const comparisonValidity=pricePlans?.plans.map(plan=>compareTime(plan.expires_at,new Date(now).toISOString())>0?'1':'0').join('')??'';
 const comparisonScope=useMemo(()=>({research:comparisonResearch,prices:comparisonPrices,validity:comparisonValidity,unavailable:pricePlansUnavailable}),
  [comparisonResearch,comparisonPrices,comparisonValidity,pricePlansUnavailable]);
 useEffect(()=>{setComparison({scope:comparisonScope,symbols:[]});},[comparisonScope]);
 const comparisonCurrent=comparison.scope===comparisonScope&&!!priceSubjectUserId&&!!edition&&Date.parse(edition.expires_at)>now;
 const compared=comparisonCurrent?all.filter(card=>comparison.symbols.includes(card.symbol)):[];
 const toggleComparison=(symbol:string)=>{
  if(!priceSubjectUserId||!edition||Date.parse(edition.expires_at)<=Math.max(now,Date.now()))return;
  setComparison(previous=>{const selected=previous.scope===comparisonScope?previous.symbols:[];
   return {scope:comparisonScope,symbols:selected.includes(symbol)?selected.filter(value=>value!==symbol):selected.length<3?[...selected,symbol]:selected};});
 };
 if(!edition||Date.parse(edition.expires_at)<=now)return <main className="vnext-content dam" id="stock-observations"><h1>每日股票研究</h1><section role="status" className="vnext-empty"><h2>{edition?'這個研究版本已到期':'目前尚無已發布的研究版本'}</h2><p>等待完成資料核對與發布的最新研究。</p>{onRefresh&&<button type="button" className="vnext-primary" onClick={onRefresh} disabled={refreshing}>{refreshing?'正在核對版本':'重新核對版本'}</button>}</section></main>;
 const offlineReviewed=dailyAiAnalysisOrigin(edition)==='OFFLINE_REVIEWED';
 const sourceYear=data.business_date.slice(0,4),{commonGaps,commonGapSet}=views;
 const missingPrice=data.tier==='free'?'免費摘要未包含價格計畫；完整內容仍以完成核准的研究為準。':pricePlansLoading?'正在核對本版已核准價格計畫。':pricePlansUnavailable?'價格計畫暫時無法核對，先依確認條件追蹤。':'本版未提供已核准價格區間，先依確認條件追蹤。';
 const cardPriceNote=(card:DailyAiMemberCard)=>card.status==='INSUFFICIENT'?'這個期間資料尚不足，未提供價格計畫。':card.status==='AVOID'?'這個期間目前為暫不考慮，未提供價格計畫。':missingPrice;
 const change=(next:Horizon)=>{setHorizon(next);onHorizonChange?.(next);changeView(()=>({filter:'ALL',query:'',limit:9}));};
 return <main className="vnext-content dam" id="stock-observations">
  <header className="vnext-intro"><p className="vnext-eyebrow">每日股票研究 · {offlineReviewed?'離線審核分析':'AI 證據分析'}</p><h1>今天先看懂，再決定</h1>
   <p>研究版本 <strong>{edition.edition_date}</strong> · 台股收盤資料截至 <strong>{edition.data_through}</strong></p>
   <p>本版可讀範圍：{all.length} 檔{data.tier==='free'?'免費研究摘要':'既有觀察股票'}，不是全市場分析完成數。</p>
   <p>證據截止：{date(edition.evidence_cutoff)}；發布準備完成：{date(edition.prepared_at)}（台北）。有效至 {date(edition.expires_at)}。</p>
   {edition.edition_date!==data.business_date&&<p className="dam-wait">目前可讀的是 {edition.edition_date} 研究版本；請依上列資料日期判讀。</p>}
   {(checkedAt||onRefresh)&&<section className="dam-read-status" aria-label="研究更新狀態"><div>
    {checkedAt&&<p>上次成功核對可讀版本：<time dateTime={checkedAt}>{date(checkedAt)}</time>（台北）；這不是行情更新時間。</p>}
    <p>{refreshing?'正在重新核對會員權限與研究版本。':'畫面開啟時會定期核對可讀版本；新研究完成發布後才會顯示。'}</p>
   </div>{onRefresh&&<button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing?'正在核對版本':'重新核對版本'}</button>}</section>}
   {data.tier!=='free'&&(pricePlansLoading||pricePlansUnavailable)&&<section className="dam-read-status" aria-label="價格讀取狀態"><p role="status">{pricePlansLoading?'正在核對本版已核准價格計畫；研究卡片可先閱讀。':'價格計畫暫時無法核對，不代表本版沒有價格計畫。'}</p>{pricePlansUnavailable&&onRefresh&&<button type="button" onClick={onRefresh} disabled={refreshing}>重新核對價格</button>}</section>}
   <p>以下是根據當時可用資料作出的研究判讀。關注、等待與不適合分開呈現；尚未有可驗證的策略績效。</p>
   {commonGaps.length>0&&<details className="dam-gaps"><summary>還缺哪些資料？本版共同限制 {commonGaps.length} 項</summary><p>以下限制適用於本版所有股票與期間，個股差異另列在卡片內。</p><ul>{commonGaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></details>}
   <EditionSources year={sourceYear}/>
  </header>
  <div className="vnext-horizons dam-periods" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>change(h)}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span><small>值得追蹤 {views.periods[h].counts.WATCH} 檔</small></button>)}</div>
  <section className="dam-period-intro" aria-live="polite"><h2>目前查看：{HORIZONS[horizon].label}</h2><p>{HORIZONS[horizon].duration} · {periods[horizon]}</p><p>每張卡片只呈現這個期間的判斷、確認條件與失效條件。</p></section>
  <section aria-label="本期間股票分析"><div className="vnext-summary"><h2>{HORIZONS[horizon].label}清單</h2><span>{all.length} 檔</span></div>
   <div className="dam-filters" aria-label="研究結果篩選"><button aria-pressed={filter==='ALL'} onClick={()=>changeView(previous=>({...previous,filter:'ALL',limit:9}))}>全部 {all.length}</button>{states.map(s=><button key={s} aria-pressed={filter===s} onClick={()=>changeView(previous=>({...previous,filter:s,limit:9}))}>{DAILY_AI_MEMBER_STATES[s]} {counts[s]}</button>)}</div>
   <label className="dam-search">搜尋本期間股票<input value={query} placeholder="股票名稱或代號" onChange={e=>{const query=e.target.value;changeView(()=>({filter:'ALL',query,limit:9}));}}/></label>
   <p role="status">{HORIZONS[horizon].label} · 符合目前篩選 {rows.length} 檔 · 先列值得追蹤，再列等待與風險；同類按代號排列。</p>
   {!counts.WATCH&&<p className="dam-wait">本期間目前沒有「值得追蹤」的股票，請先看等待原因與資料缺口。</p>}
   {priceSubjectUserId&&<section className="dam-comparison" aria-label="股票研究比較">
    <div className="dam-comparison-heading"><h3>並排比較股票研究</h3>{compared.length>0&&<button type="button" onClick={()=>setComparison({scope:comparisonScope,symbols:[]})}>清除比較</button>}</div>
    <p role="status">已選 {compared.length}／3 檔。從下方勾選同一期間的 2～3 檔；比較保留原判讀，不另計排名。</p>
    {compared.length<2?<p>選好至少 2 檔後，可一起核對理由、價格條件與風險。</p>:<div className="dam-comparison-scroll" tabIndex={0} role="region" aria-label="股票研究比較表，可左右捲動">
     <table><caption>{HORIZONS[horizon].label} · 同一研究版本 {edition.edition_date}</caption><thead><tr><th scope="col">核對項目</th>{compared.map(card=><th scope="col" key={card.symbol}>{card.company}<small>{card.symbol}</small><button type="button" aria-label={`移除${card.company}比較`} onClick={()=>toggleComparison(card.symbol)}>移除</button></th>)}</tr></thead>
      <tbody>
       <tr><th scope="row">期間與狀態</th>{compared.map(card=><td key={card.symbol}>{HORIZONS[card.horizon].duration}<br/>{DAILY_AI_MEMBER_STATES[card.status]}</td>)}</tr>
       <tr><th scope="row">研究理由</th>{compared.map(card=><td key={card.symbol}>{dailyAiAnalysisText(card.reason.text)}</td>)}</tr>
       <tr><th scope="row">價格區間與等待</th>{compared.map(card=>{const plan=dailyAiPricePlanForCard(pricePlans?.tier===data.tier?pricePlans:null,card,edition.id,now,priceSubjectUserId);const display=plan?dailyAiPriceDisplay(plan):null;return <td key={card.symbol}>{plan?<>{display?<><p>研究區間：NT${display.entry_range[0]}～{display.entry_range[1]}</p><p>NT${display.wait_above} 以上先等待重評</p></>:<p>{DAILY_AI_PRICE_PRECISION_PENDING}</p>}<p>依據：{plan.basis}</p><p>核對：{date(plan.as_of)}；有效至 {date(plan.expires_at)}</p></>:cardPriceNote(card)}</td>;})}</tr>
       <tr><th scope="row">確認條件</th>{compared.map(card=><td key={card.symbol}>{dailyAiAnalysisText(card.confirmation)}</td>)}</tr>
       <tr><th scope="row">失效與重評</th>{compared.map(card=>{const plan=dailyAiPricePlanForCard(pricePlans?.tier===data.tier?pricePlans:null,card,edition.id,now,priceSubjectUserId);const display=plan?dailyAiPriceDisplay(plan):null;return <td key={card.symbol}><p>{dailyAiAnalysisText(card.invalidation)}</p>{plan&&<><p>價格計畫：{plan.invalidation}</p>{display&&display.stop!==null&&<p>停止參考價：NT${display.stop}</p>}</>}</td>;})}</tr>
       <tr><th scope="row">反面證據</th>{compared.map(card=><td key={card.symbol}>{card.counter_evidence===null?'此方案僅提供研究摘要。':card.counter_evidence.length?<ul>{card.counter_evidence.map((claim,i)=><li key={i}>{dailyAiAnalysisText(claim.text)}</li>)}</ul>:'本版未列具名反面證據，不代表沒有風險。'}</td>)}</tr>
       <tr><th scope="row">資料時間</th>{compared.map(card=><td key={card.symbol}><p>台股收盤截至：{edition.data_through}</p><p>證據截止：{date(edition.evidence_cutoff)}</p><p>研究有效至：{date(edition.expires_at)}</p></td>)}</tr>
       <tr><th scope="row">新聞與資料來源</th>{compared.map(card=><td key={card.symbol}>{card.sources===null?'此方案僅提供研究摘要。':card.sources.length?<><ul>{card.sources.map(source=><li key={source.id}><a href={source.source} target="_blank" rel="noopener noreferrer">{sourceKinds[source.kind]} · {new URL(source.source).hostname}</a><p>{source.published_at?`原發布：${date(source.published_at)}`:'原發布時間未確認'}；可用：{date(source.available_at)}</p></li>)}</ul>{!card.sources.some(source=>source.kind==='NEWS')&&<p>本卡未列已核對的新聞來源。</p>}</>:'本卡尚無可列出的資料來源。'}</td>)}</tr>
       <tr><th scope="row">資料缺口</th>{compared.map(card=><td key={card.symbol}>{card.gaps.length?<ul>{card.gaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul>:'本版未另列缺口，不代表證據完整。'}</td>)}</tr>
      </tbody>
     </table>
    </div>}
   </section>}
   <div className="vnext-grid">{rows.slice(0,limit).map(card=>{const plan=dailyAiPricePlanForCard(pricePlans?.tier===data.tier?pricePlans:null,card,edition.id,now,priceSubjectUserId);
    const planSources=plan?pricePlans?.source_sets?.find(set=>set.symbol===card.symbol)?.sources.filter(source=>plan.evidence_ids.includes(source.id))??[]:[];
    return <article className="vnext-card dam-card" key={card.symbol}>
    <div className="dam-card-top"><span className="dam-period-badge">{HORIZONS[horizon].label} · {HORIZONS[horizon].duration}</span><span className={`dam-status dam-status-${card.status.toLowerCase()}`}>{DAILY_AI_MEMBER_STATES[card.status]}</span></div>
    <h3>{card.company}<small>{card.symbol}</small></h3>{priceSubjectUserId&&<label className="dam-compare-choice"><input type="checkbox" checked={compared.some(selected=>selected.symbol===card.symbol)} disabled={compared.length>=3&&!compared.some(selected=>selected.symbol===card.symbol)} onChange={()=>toggleComparison(card.symbol)}/>{card.company}加入比較</label>}<h4>為什麼這樣判斷？</h4><p>{dailyAiAnalysisText(card.reason.text)}</p><p className="dam-inference">{offlineReviewed?'離線審核分析':'AI 判讀'} · 請搭配下方證據與反面條件</p>
    <h4>接下來看什麼確認？</h4><p>{dailyAiAnalysisText(card.confirmation)}</p><div className="vnext-risk"><h4>什麼情況取消或重評？</h4><p>{dailyAiAnalysisText(card.invalidation)}</p>
     {card.counter_evidence!==null&&<><h4>反面證據與風險</h4>{card.counter_evidence.length?<ul>{card.counter_evidence.map((c,i)=><li key={i}>{dailyAiAnalysisText(c.text)}</li>)}</ul>:<p>本版未列出具名反面證據；不代表沒有風險。</p>}</>}
    </div>
    <Gaps gaps={card.gaps.filter(gap=>!commonGapSet.has(gap))}/>
    {plan?<PricePlan plan={plan} status={card.status} sources={planSources}/>:<p className="dam-price-note">{cardPriceNote(card)}</p>}<Evidence card={card} year={sourceYear}/>
   </article>;})}</div>
   {!rows.length?<p className="vnext-empty">這個分類沒有股票，可切換其他結果查看原因。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>changeView(previous=>({...previous,limit:previous.limit+9}))}>再看 9 檔</button>:null}
  </section>
 </main>;
}
