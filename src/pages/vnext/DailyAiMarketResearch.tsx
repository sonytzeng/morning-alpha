import {useEffect,useState} from 'react';
import {HORIZONS,compareTime,type Horizon} from '@/features/vnext/contracts';
import {DAILY_AI_MEMBER_STATES} from '@/features/vnext/dailyAiMember';
import {dailyAiAnalysisText,dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import {dailyAiPriceDisplay,DAILY_AI_PRICE_PRECISION_PENDING} from '@/features/vnext/dailyAiPriceDisplay';
import {adaptDailyAiMarketPageV2,DAILY_AI_MARKETS,type DailyAiMarketPageCacheV2,type DailyAiMarketPageQuery,type DailyAiMarketReadScopeV2,type DailyAiMarketResearchReferenceV1} from '@/features/vnext/dailyAiMarketPageV2';
import './daily-ai-member.css';
import './daily-ai-market.css';

const markets={TWSE:'上市',TPEX:'上櫃',EMERGING:'興櫃'};
const sourceKinds={PRICE:'價格資料',FINANCIAL:'財務資料',NEWS:'新聞／公告',MARKET:'市場資料'};
const formatter=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const date=(at:string)=>formatter.format(new Date(at));
const deadline=(at:string)=>{const ms=Date.parse(at);return compareTime(at,new Date(ms).toISOString())>0?ms+1:ms;};
const referenceNumber=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});
const referenceMeaning=(reference:DailyAiMarketResearchReferenceV1)=>reference.method_version==='TAIWAN_REPORTED_BVPS_PEER_V1'
 ?`以原季報的每股參考淨值乘上同市場、同產業、同報價日及同財報期的同業計算 P/B 分位數。同業 P/B 由其當日價格除以原報表每股參考淨值計算。${reference.horizon==='LONG'?'公司與同業另須通過相同三年獲利、現金流及資產負債品質條件。':''}財報期後未調整的股本變動會擋下計算；原帳面淨值不是即時淨值。`
 :reference.horizon==='SHORT'
 ?'近 20 個交易日的原始最低價與最高價；價格尚未還原除權息等公司事件。'
 :reference.horizon==='LONG'
  ?'使用同市場、同產業、同報價日與同財報期，且通過相同三年獲利、現金流及資產負債品質條件之同業股價淨值比，換算第 25、50、75 分位的估值參考。'
  :`使用同市場、同產業、同報價日與同財報期的同業${reference.method_id.includes('PEER_PE_')?'本益比':'股價淨值比'}，換算第 25、50、75 分位的估值參考。`;

export default function DailyAiMarketResearch({cache,scope,loading,onQuery,onNext,onFirst,onRefresh}:{
 cache:DailyAiMarketPageCacheV2;scope:DailyAiMarketReadScopeV2;loading:boolean;
 onQuery:(query:DailyAiMarketPageQuery)=>void;onNext:()=>void;onFirst:()=>void;onRefresh:()=>void;
}){
 const [now,setNow]=useState(Date.now),[search,setSearch]=useState(cache.data.query.search);
 const pageKey=JSON.stringify([scope.identity,scope.tier,scope.requestDate,cache.data.edition?.id,cache.data.query_hash,cache.data.page.start]);
 const [expansion,setExpansion]=useState({key:pageKey,count:9}),visible=expansion.key===pageKey?expansion.count:9;
 const current=Math.max(now,Date.now()),data=cache.data;
 const expiries=[...(data.edition?[deadline(data.edition.expires_at)]:[]),...data.cards.flatMap(card=>card.price?[deadline(card.price.plan.expires_at)]:[])].filter(value=>value>current);
 const expires=expiries.length?Math.min(...expiries):null;
 useEffect(()=>{
  const update=()=>setNow(previous=>Math.max(previous,Date.now())),interval=setInterval(update,15000);
  const timer=expires===null?undefined:setTimeout(()=>setNow(previous=>Math.max(previous,Date.now(),expires)),Math.min(2147483647,Math.max(0,expires-Date.now())));
  document.addEventListener('visibilitychange',update);update();
  return()=>{clearInterval(interval);clearTimeout(timer);document.removeEventListener('visibilitychange',update);};
 },[expires]);
 useEffect(()=>{setSearch(data.query.search);},[data.query.search,data.query_hash]);
 const view=adaptDailyAiMarketPageV2(cache,scope,visible,current);
 if(!view||!view.edition)return <main className="vnext-content dam" id="stock-observations"><h1>股票研究</h1><section className="vnext-empty" role="status"><h2>這個可讀研究版本已到期或需要重新核對</h2><p>重新取得目前會員可讀內容後，才會顯示股票與研究參考價。</p><button className="vnext-primary" onClick={onRefresh} disabled={loading}>{loading?'正在核對版本':'重新核對版本'}</button></section></main>;
 const query=view.query,coverage=view.universe.markets;
 const rosterTotal=coverage.every(m=>m.universe_count!==null)?coverage.reduce((sum,m)=>sum+m.universe_count!,0):null;
 const publishedTotal=coverage.every(m=>m.published_count!==null)?coverage.reduce((sum,m)=>sum+m.published_count!,0):null;
 const change=(next:Partial<DailyAiMarketPageQuery>)=>onQuery({...query,...next});
 return <main className="vnext-content dam dam-market" id="stock-observations">
  <header className="vnext-intro"><p className="vnext-eyebrow">台灣股票研究 · {view.analysis_label}</p><h1>依期間、理由與條件追蹤股票</h1>
   <p>可讀研究版本 <strong>{view.edition.edition_date}</strong> · 證據截止 {date(view.edition.evidence_cutoff)} · 有效至 {date(view.edition.expires_at)}（台北）。</p>
   <p>{view.edition.analysis_origin==='DETERMINISTIC_SCREENING'?'本版以固定規則整理官方資料與待確認條件，研究判讀仍須分別核對證據及限制。':'以下保留發布時的研究判讀、支持資料與反面條件。'}尚未有可驗證的策略績效。</p>
   <section className="dam-read-status" aria-label="研究更新狀態"><div><p>上次成功核對可讀版本：<time dateTime={view.checked_at}>{date(view.checked_at)}</time>（台北）。這不是各資料來源的更新時間。</p><p>{loading?'正在核對權益、研究與價格版本。':'畫面開啟時會定期核對可讀版本；新計算完成獨立審核與發布後才會顯示。'}</p></div><button type="button" onClick={onRefresh} disabled={loading}>{loading?'正在核對版本':'重新核對版本'}</button></section>
  </header>
  <section className="dam-universe" aria-label="市場名單與可讀研究涵蓋率"><h2>名單範圍與已核准內容</h2>
   <p>官方名單納入 <strong>{rosterTotal===null?'尚待完整核對':`${rosterTotal.toLocaleString('zh-TW')} 檔`}</strong>；本期間、目前會員權益下已核准可讀 <strong>{publishedTotal===null?'尚待核對':`${publishedTotal.toLocaleString('zh-TW')} 檔`}</strong>。納入名單不代表已完成分析、已核准價格或值得買進。</p>
   <details><summary>查看三市場的資料日期與涵蓋數</summary><p>名單快照形成日期：{view.universe.snapshot_date}。各市場原出表日與資料日期各自保留，未知值不以今天補齊。</p>
    <div className="dam-market-table" tabIndex={0} role="region" aria-label="三市場資料時間表，可左右捲動"><table><thead><tr><th scope="col">市場</th><th scope="col">名單／可讀研究</th><th scope="col">名單原出表日</th><th scope="col">價格資料日期</th><th scope="col">財務資料可用時間</th><th scope="col">公告資料可用時間</th></tr></thead><tbody>{coverage.map(m=><tr key={m.market}><th scope="row">{markets[m.market]}</th><td>{m.universe_count??'未知'}／{m.published_count??'未知'}<small>{{UNKNOWN:'涵蓋數尚待核對',PARTIAL:'部分已有可讀研究',COMPLETE:'名單皆有可讀研究'}[m.coverage]}</small></td><td>{m.roster_as_of??'未確認'}</td><td>{m.data_as_of.price_date??'未確認'}</td><td>{m.data_as_of.financial_available_at?date(m.data_as_of.financial_available_at):'未確認'}</td><td>{m.data_as_of.news_available_at?date(m.data_as_of.news_available_at):'未確認'}</td></tr>)}</tbody></table></div>
    <p>涵蓋數指目前身份可閱讀的已核准分析。尚無可讀分析的公司不會被推定為「暫不考慮」。個股使用的資料與取得時間，請看各卡片依據。</p>
   </details>
  </section>
  <div className="vnext-horizons dam-periods" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button type="button" key={h} aria-pressed={query.horizon===h} disabled={loading} onClick={()=>change({horizon:h,status:'ALL'})}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  <section className="dam-market-controls" aria-label="股票查詢條件">
   <label>上市櫃市場<select value={query.market} disabled={loading} onChange={event=>change({market:event.target.value as DailyAiMarketPageQuery['market']})}><option value="ALL">全部三市場</option>{DAILY_AI_MARKETS.map(m=><option key={m} value={m}>{markets[m]}</option>)}</select></label>
   <form onSubmit={event=>{event.preventDefault();if(!loading)change({search:search.trim()});}}><label>股票代號或名稱<input value={search} maxLength={80} placeholder="輸入後搜尋" onChange={event=>setSearch(event.target.value)}/></label><button type="submit" disabled={loading}>搜尋股票</button>{query.search&&<button type="button" disabled={loading} onClick={()=>change({search:''})}>清除搜尋</button>}</form>
  </section>
  <section aria-label="本期間可讀股票分析"><div className="vnext-summary"><h2>{HORIZONS[query.horizon].label} · {query.market==='ALL'?'三市場':markets[query.market]}</h2><span>符合查詢 {view.counts.matching_total.toLocaleString('zh-TW')} 檔</span></div>
   <div className="dam-filters" aria-label="研究結果篩選"><button type="button" disabled={loading} aria-pressed={query.status==='ALL'} onClick={()=>change({status:'ALL'})}>全部 {Object.values(view.counts.by_status).reduce((sum,n)=>sum+n,0)}</button>{(Object.keys(DAILY_AI_MEMBER_STATES) as Array<keyof typeof DAILY_AI_MEMBER_STATES>).map(s=><button type="button" key={s} disabled={loading} aria-pressed={query.status===s} onClick={()=>change({status:s})}>{DAILY_AI_MEMBER_STATES[s]} {view.counts.by_status[s]}</button>)}</div>
   <p role="status">已核准可讀範圍 {view.counts.available_total.toLocaleString('zh-TW')} 檔；{view.page_count?`目前頁面 ${data.page.start+1}～${data.page.start+view.page_count} 筆，已展開 ${view.visible_count} 張。`:'目前查詢 0 筆。'}先列值得追蹤、等待，再列不適合與資料不足；同類依市場及代號排列。</p>
   <div className="vnext-grid">{view.cards.map(card=>{
    const plan=card.price?.plan,price=plan?dailyAiPriceDisplay(plan):null,reference=card.research_reference;
    return <article className="vnext-card dam-card" key={card.market+':'+card.symbol}><div className="dam-card-top"><span className="dam-period-badge">{markets[card.market]} · {HORIZONS[card.horizon].label}</span><span className={`dam-status dam-status-${card.status.toLowerCase()}`}>{DAILY_AI_MEMBER_STATES[card.status]}</span></div><h3>{card.company}<small>{card.symbol}</small></h3>
     <h4>為什麼這樣判斷？</h4><p>{dailyAiAnalysisText(card.reason.text)}</p><h4>接下來看什麼確認？</h4><p>{dailyAiAnalysisText(card.confirmation)}</p>
     <div className="vnext-risk"><h4>什麼情況取消或重評？</h4><p>{dailyAiAnalysisText(card.invalidation)}</p></div>
     {reference&&<section className="dam-research-reference" aria-label={reference.horizon==='SHORT'?'歷史價格區間':'同業估值參考'}>
      <h4>{reference.horizon==='SHORT'?'歷史價格區間':reference.horizon==='LONG'?'財務品質相符的同業估值參考':'同業估值參考'}</h4>
      <p className="dam-reference-status">研究用途 · 方法成效尚未驗證</p>
      <dl><div><dt>資料日收盤價</dt><dd>NT${referenceNumber.format(reference.current_price)}<small>{reference.quote_date}</small></dd></div>
       <div><dt>{reference.horizon==='SHORT'?'近 20 日高低範圍':'同業估值第 25～75 分位'}</dt><dd>{reference.horizon!=='SHORT'?'約 ':''}NT${referenceNumber.format(reference.lower)}～{referenceNumber.format(reference.upper)}</dd></div>
       {reference.median!==null&&<div><dt>同業估值中位</dt><dd>約 NT${referenceNumber.format(reference.median)}</dd></div>}
       {reference.peer_count!==null&&<div><dt>比較樣本</dt><dd>{reference.peer_count} 家其他同業</dd></div>}</dl>
      <p>{reference.horizon==='SHORT'?'這個範圍用來核對已發生的價格變動。':'這組數字用來比較同業估值差異。'}買賣條件與方法審查仍需另行完成。</p>
      <details><summary>參考方式與核對碼</summary><p>{referenceMeaning(reference)}</p><p>資料來源及取得時間列於下方「核對這張卡的資料依據」。</p>
       <label className="dam-reference-code">研究參考核對碼（點選後可複製）<input type="text" readOnly value={reference.reference_hash} onFocus={event=>event.currentTarget.select()}/></label>
      </details>
     </section>}
     {plan?<section className="dam-price-plan" aria-label="已核准研究參考價"><h4>研究參考價</h4>{price?<dl><div><dt>條件式研究區間</dt><dd>NT${price.entry_range[0]}～{price.entry_range[1]}</dd></div><div><dt>超過先等</dt><dd>NT${price.wait_above} 以上等待重評</dd></div>{price.stop!==null&&<div><dt>停止參考價</dt><dd>NT${price.stop}</dd></div>}</dl>:<p>{DAILY_AI_PRICE_PRECISION_PENDING}</p>}<p>停止／重評條件：{plan.invalidation}</p><p className="dam-summary-note">價格進入區間仍須核對確認條件；研究參考價不等於可下單報價。</p><details><summary>價格方法、來源與有效期</summary><p>{plan.basis}</p><p>方法：{plan.method}</p><p>計畫核對 {date(plan.as_of)}；有效至 {date(plan.expires_at)}（台北）。</p><ul>{card.price!.sources.map(s=><li key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer">{new URL(s.source).hostname}</a><span>本次可用：{date(s.available_at)}</span></li>)}</ul></details></section>:<p className="dam-price-note">{card.price_state==='EXPIRED'?'原價格計畫已到期，等待重新核對後的可讀計畫。':card.status==='INSUFFICIENT'?'本期間資料不足，未提供價格計畫。':card.status==='AVOID'?'本期間暫不考慮，未提供價格計畫。':card.price_state==='NOT_INCLUDED'?'免費摘要未包含價格計畫。':'本版未提供已核准價格計畫，先依確認條件追蹤。'}</p>}
     {card.gaps.length>0&&<details className="dam-gaps"><summary>研究限制與缺件 {card.gaps.length} 項</summary><ul>{card.gaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></details>}
     {card.counter_evidence!==null&&<details><summary>反面證據與風險</summary>{card.counter_evidence.length?<ul>{card.counter_evidence.map((claim,i)=><li key={i}>{dailyAiAnalysisText(claim.text)}</li>)}</ul>:<p>本版未列具名反面證據，不代表沒有風險。</p>}</details>}
     {card.sources!==null?<details><summary>核對這張卡的資料依據</summary><ul>{card.sources.map(s=><li key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer">{sourceKinds[s.kind]} · {new URL(s.source).hostname}</a><span>{s.published_at?`原發布：${date(s.published_at)}`:'原發布時間未確認'}；本次可用：{date(s.available_at)}</span></li>)}</ul></details>:<p className="dam-summary-note">目前顯示免費研究摘要；完整資料依據依會員可讀權益提供。</p>}
    </article>;
   })}</div>
   {!view.cards.length&&<section className="vnext-empty"><h3>這個查詢目前沒有可讀研究</h3><p>可清除搜尋或切換市場、期間、研究狀態。沒有可讀卡片不代表市場沒有機會。</p></section>}
   <nav className="dam-market-pages" aria-label="股票研究分頁">{view.has_more_on_page&&<button type="button" className="vnext-primary" onClick={()=>setExpansion({key:pageKey,count:Math.min(60,visible+9)})}>再展開 9 張</button>}{data.page.start>0&&<button type="button" onClick={onFirst} disabled={loading}>回第一頁</button>}{view.next_cursor&&<button type="button" onClick={onNext} disabled={loading}>下一頁研究</button>}</nav>
  </section>
 </main>;
}
