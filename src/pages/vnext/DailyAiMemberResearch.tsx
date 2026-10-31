import {useEffect,useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {DAILY_AI_MEMBER_STATES,type DailyAiMemberCard,type DailyAiMemberResearch as Research,type DailyAiMemberState} from '@/features/vnext/dailyAiMember';
import {dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import './daily-ai-member.css';

const periods={SHORT:'先看近期事件與量價，確認條件成立後再評估。',MEDIUM:'追蹤未來數週的營收、營運與事件變化。',LONG:'檢查長期需求、獲利與估值能否支持布局。'};
const states=Object.keys(DAILY_AI_MEMBER_STATES) as DailyAiMemberState[];
const order:Record<DailyAiMemberState,number>={WATCH:0,WAIT:1,AVOID:2,INSUFFICIENT:3};
const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
function Evidence({card}:{card:DailyAiMemberCard}){
 if(card.sources===null)return <p className="dam-summary-note">此方案顯示研究摘要。</p>;
 return <details><summary>核對這個判斷的資料依據</summary><ul>{card.sources.map(s=><li key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer">{new URL(s.source).hostname}</a>
  <span>{s.published_at?`原發布：${date(s.published_at)}`:'原發布時間未確認；依收到後的資料研究。'} · 本次可用：{date(s.available_at)}</span>
 </li>)}</ul></details>;
}
export default function DailyAiMemberResearch({data,selectedHorizon,onHorizonChange}:{data:Research;selectedHorizon?:Horizon;onHorizonChange?:(horizon:Horizon)=>void}){
 const [localHorizon,setHorizon]=useState<Horizon>('SHORT'),[filter,setFilter]=useState<DailyAiMemberState|'ALL'>('ALL'),[query,setQuery]=useState(''),[limit,setLimit]=useState(9),[now,setNow]=useState(Date.now);
 const horizon=selectedHorizon??localHorizon;
 useEffect(()=>{const update=()=>setNow(Date.now()),timer=setInterval(update,15000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[]);
 const edition=data.edition;
 if(!edition||Date.parse(edition.expires_at)<=now)return <main className="vnext-content dam" id="stock-observations"><h1>每日股票研究</h1><section role="status" className="vnext-empty"><h2>{edition?'這個研究版本已到期':'目前尚無已發布的研究版本'}</h2><p>等待完成資料核對與發布的最新研究。</p></section></main>;
 const all=data.cards.filter(c=>c.horizon===horizon),rows=all.filter(c=>(filter==='ALL'||c.status===filter)&&(!query.trim()||`${c.symbol} ${c.company}`.includes(query.trim())))
  .sort((a,b)=>order[a.status]-order[b.status]||a.symbol.localeCompare(b.symbol));
 const change=(next:Horizon)=>{setHorizon(next);onHorizonChange?.(next);setFilter('ALL');setQuery('');setLimit(9);};
 return <main className="vnext-content dam" id="stock-observations">
  <header className="vnext-intro"><p className="vnext-eyebrow">每日股票研究 · AI 證據分析</p><h1>今天先看懂，再決定</h1>
   <p>研究版本 <strong>{edition.edition_date}</strong> · 台股收盤資料截至 <strong>{edition.data_through}</strong></p>
   <p>證據截止：{date(edition.evidence_cutoff)}；發布準備完成：{date(edition.prepared_at)}（台北）。有效至 {date(edition.expires_at)}。</p>
   <p>以下是根據當時可用資料作出的研究判讀。關注、等待與不適合分開呈現；尚未有可驗證的策略績效。</p>
  </header>
  <div className="vnext-horizons dam-periods" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>change(h)}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span><small>值得追蹤 {data.cards.filter(c=>c.horizon===h&&c.status==='WATCH').length} 檔</small></button>)}</div>
  <section className="dam-period-intro" aria-live="polite"><h2>目前查看：{HORIZONS[horizon].label}</h2><p>{HORIZONS[horizon].duration} · {periods[horizon]}</p><p>每張卡片只呈現這個期間的判斷、確認條件與失效條件。</p></section>
  <section aria-label="本期間股票分析"><div className="vnext-summary"><h2>{HORIZONS[horizon].label}清單</h2><span>{all.length} 檔</span></div>
   <div className="dam-filters" aria-label="研究結果篩選"><button aria-pressed={filter==='ALL'} onClick={()=>{setFilter('ALL');setLimit(9);}}>全部 {all.length}</button>{states.map(s=><button key={s} aria-pressed={filter===s} onClick={()=>{setFilter(s);setLimit(9);}}>{DAILY_AI_MEMBER_STATES[s]} {all.filter(c=>c.status===s).length}</button>)}</div>
   <label className="dam-search">搜尋本期間股票<input value={query} placeholder="股票名稱或代號" onChange={e=>{setQuery(e.target.value);setFilter('ALL');setLimit(9);}}/></label>
   <p role="status">{HORIZONS[horizon].label} · 符合目前篩選 {rows.length} 檔 · 先列值得追蹤，再列等待與風險；同類按代號排列。</p>
   {!all.some(c=>c.status==='WATCH')&&<p className="dam-wait">本期間目前沒有「值得追蹤」的股票，請先看等待原因與資料缺口。</p>}
   <div className="vnext-grid">{rows.slice(0,limit).map(card=><article className="vnext-card dam-card" key={card.symbol}>
    <div className="dam-card-top"><span className="dam-period-badge">{HORIZONS[horizon].label} · {HORIZONS[horizon].duration}</span><span className={`dam-status dam-status-${card.status.toLowerCase()}`}>{DAILY_AI_MEMBER_STATES[card.status]}</span></div>
    <h3>{card.company}<small>{card.symbol}</small></h3><h4>為什麼這樣判斷？</h4><p>{card.reason.text}</p><p className="dam-inference">AI 判讀 · 請搭配下方證據與反面條件</p>
    <h4>接下來看什麼確認？</h4><p>{card.confirmation}</p><div className="vnext-risk"><h4>什麼情況取消或重評？</h4><p>{card.invalidation}</p>
     {card.counter_evidence!==null&&<><h4>反面證據與風險</h4>{card.counter_evidence.length?<ul>{card.counter_evidence.map((c,i)=><li key={i}>{c.text}</li>)}</ul>:<p>本版未列出具名反面證據；不代表沒有風險。</p>}</>}
    </div>
    {card.gaps.length>0&&<section className="dam-gaps"><h4>還缺哪些資料？</h4><ul>{card.gaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></section>}
    <p className="dam-price-note">價格條件：本版未提供已驗證的買進區間，先依確認條件追蹤。</p><Evidence card={card}/>
   </article>)}</div>
   {!rows.length?<p className="vnext-empty">這個分類沒有股票，可切換其他結果查看原因。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>setLimit(value=>value+9)}>再看 9 檔</button>:null}
  </section>
 </main>;
}
