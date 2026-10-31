import {useEffect,useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {DAILY_AI_MEMBER_STATES,type DailyAiMemberCard,type DailyAiMemberResearch as Research,type DailyAiMemberState} from '@/features/vnext/dailyAiMember';
import {dailyAiAnalysisText,dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import './daily-ai-member.css';

const periods={SHORT:'先看近期事件與量價，確認條件成立後再評估。',MEDIUM:'追蹤未來數週的營收、營運與事件變化。',LONG:'檢查長期需求、獲利與估值能否支持布局。'};
const states=Object.keys(DAILY_AI_MEMBER_STATES) as DailyAiMemberState[];
export type DailyAiMemberViewState={filter:DailyAiMemberState|'ALL';query:string;limit:number};
const order:Record<DailyAiMemberState,number>={WATCH:0,WAIT:1,AVOID:2,INSUFFICIENT:3};
const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
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
export default function DailyAiMemberResearch({data,selectedHorizon,onHorizonChange,viewState,onViewChange}:{data:Research;selectedHorizon?:Horizon;onHorizonChange?:(horizon:Horizon)=>void;
 viewState?:DailyAiMemberViewState;onViewChange?:(change:(previous:DailyAiMemberViewState)=>DailyAiMemberViewState)=>void}){
 const [localHorizon,setHorizon]=useState<Horizon>('SHORT'),[localView,setLocalView]=useState<DailyAiMemberViewState>({filter:'ALL',query:'',limit:9}),[now,setNow]=useState(Date.now);
 const horizon=selectedHorizon??localHorizon;
 const {filter,query,limit}=viewState??localView;
 const changeView=(change:(previous:DailyAiMemberViewState)=>DailyAiMemberViewState)=>{if(viewState===undefined)setLocalView(change);onViewChange?.(change);};
 const expiresAt=data.edition?.expires_at??null;
 useEffect(()=>{
  const update=()=>setNow(previous=>Math.max(previous,Date.now())),timer=setInterval(update,15000);
  const expiry=expiresAt===null?null:Date.parse(expiresAt);
  const deadline=expiry===null?undefined:setTimeout(()=>setNow(previous=>Math.max(previous,Date.now(),expiry)),Math.min(2147483647,Math.max(0,expiry-Date.now())));
  document.addEventListener('visibilitychange',update);
  return()=>{clearInterval(timer);clearTimeout(deadline);document.removeEventListener('visibilitychange',update);};
 },[expiresAt]);
 const edition=data.edition;
 if(!edition||Date.parse(edition.expires_at)<=now)return <main className="vnext-content dam" id="stock-observations"><h1>每日股票研究</h1><section role="status" className="vnext-empty"><h2>{edition?'這個研究版本已到期':'目前尚無已發布的研究版本'}</h2><p>等待完成資料核對與發布的最新研究。</p></section></main>;
 const sourceYear=data.business_date.slice(0,4),all=data.cards.filter(c=>c.horizon===horizon),rows=all.filter(c=>(filter==='ALL'||c.status===filter)&&(!query.trim()||`${c.symbol} ${c.company}`.includes(query.trim())))
  .sort((a,b)=>order[a.status]-order[b.status]||a.symbol.localeCompare(b.symbol));
 const commonGaps=[...new Set(data.cards[0]?.gaps??[])].filter(gap=>data.cards.every(card=>card.gaps.includes(gap))),commonGapSet=new Set(commonGaps);
 const change=(next:Horizon)=>{setHorizon(next);onHorizonChange?.(next);changeView(()=>({filter:'ALL',query:'',limit:9}));};
 return <main className="vnext-content dam" id="stock-observations">
  <header className="vnext-intro"><p className="vnext-eyebrow">每日股票研究 · AI 證據分析</p><h1>今天先看懂，再決定</h1>
   <p>研究版本 <strong>{edition.edition_date}</strong> · 台股收盤資料截至 <strong>{edition.data_through}</strong></p>
   <p>證據截止：{date(edition.evidence_cutoff)}；發布準備完成：{date(edition.prepared_at)}（台北）。有效至 {date(edition.expires_at)}。</p>
   <p>以下是根據當時可用資料作出的研究判讀。關注、等待與不適合分開呈現；尚未有可驗證的策略績效。</p>
   {commonGaps.length>0&&<details className="dam-gaps"><summary>還缺哪些資料？本版共同限制 {commonGaps.length} 項</summary><p>以下限制適用於本版所有股票與期間，個股差異另列在卡片內。</p><ul>{commonGaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></details>}
   <EditionSources year={sourceYear}/>
  </header>
  <div className="vnext-horizons dam-periods" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>change(h)}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span><small>值得追蹤 {data.cards.filter(c=>c.horizon===h&&c.status==='WATCH').length} 檔</small></button>)}</div>
  <section className="dam-period-intro" aria-live="polite"><h2>目前查看：{HORIZONS[horizon].label}</h2><p>{HORIZONS[horizon].duration} · {periods[horizon]}</p><p>每張卡片只呈現這個期間的判斷、確認條件與失效條件。</p></section>
  <section aria-label="本期間股票分析"><div className="vnext-summary"><h2>{HORIZONS[horizon].label}清單</h2><span>{all.length} 檔</span></div>
   <div className="dam-filters" aria-label="研究結果篩選"><button aria-pressed={filter==='ALL'} onClick={()=>changeView(previous=>({...previous,filter:'ALL',limit:9}))}>全部 {all.length}</button>{states.map(s=><button key={s} aria-pressed={filter===s} onClick={()=>changeView(previous=>({...previous,filter:s,limit:9}))}>{DAILY_AI_MEMBER_STATES[s]} {all.filter(c=>c.status===s).length}</button>)}</div>
   <label className="dam-search">搜尋本期間股票<input value={query} placeholder="股票名稱或代號" onChange={e=>{const query=e.target.value;changeView(()=>({filter:'ALL',query,limit:9}));}}/></label>
   <p role="status">{HORIZONS[horizon].label} · 符合目前篩選 {rows.length} 檔 · 先列值得追蹤，再列等待與風險；同類按代號排列。</p>
   {!all.some(c=>c.status==='WATCH')&&<p className="dam-wait">本期間目前沒有「值得追蹤」的股票，請先看等待原因與資料缺口。</p>}
   <div className="vnext-grid">{rows.slice(0,limit).map(card=><article className="vnext-card dam-card" key={card.symbol}>
    <div className="dam-card-top"><span className="dam-period-badge">{HORIZONS[horizon].label} · {HORIZONS[horizon].duration}</span><span className={`dam-status dam-status-${card.status.toLowerCase()}`}>{DAILY_AI_MEMBER_STATES[card.status]}</span></div>
    <h3>{card.company}<small>{card.symbol}</small></h3><h4>為什麼這樣判斷？</h4><p>{dailyAiAnalysisText(card.reason.text)}</p><p className="dam-inference">AI 判讀 · 請搭配下方證據與反面條件</p>
    <h4>接下來看什麼確認？</h4><p>{dailyAiAnalysisText(card.confirmation)}</p><div className="vnext-risk"><h4>什麼情況取消或重評？</h4><p>{dailyAiAnalysisText(card.invalidation)}</p>
     {card.counter_evidence!==null&&<><h4>反面證據與風險</h4>{card.counter_evidence.length?<ul>{card.counter_evidence.map((c,i)=><li key={i}>{dailyAiAnalysisText(c.text)}</li>)}</ul>:<p>本版未列出具名反面證據；不代表沒有風險。</p>}</>}
    </div>
    <Gaps gaps={card.gaps.filter(gap=>!commonGapSet.has(gap))}/>
    <p className="dam-price-note">價格條件：本版未提供已驗證的買進區間，先依確認條件追蹤。</p><Evidence card={card} year={sourceYear}/>
   </article>)}</div>
   {!rows.length?<p className="vnext-empty">這個分類沒有股票，可切換其他結果查看原因。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>changeView(previous=>({...previous,limit:previous.limit+9}))}>再看 9 檔</button>:null}
  </section>
 </main>;
}
