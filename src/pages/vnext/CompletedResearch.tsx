import {useEffect,useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {completedPlanState,type CompletedResearch as Research,type CompletedFocus} from '@/features/vnext/completedResearch';
import './completed-research.css';
const states={QUALIFIED:'符合觀察條件',REJECTED:'目前不符合',INSUFFICIENT:'資料不足'};
const money=(n:number)=>n.toLocaleString('zh-TW',{maximumFractionDigits:2,minimumFractionDigits:2});
const periodCopy={SHORT:'看近期量價與事件，等待進場確認。',MEDIUM:'看營收與法人方向能否持續，追蹤未來數週的變化。',LONG:'看長期獲利、需求與估值，確認是否適合長期布局。'};
const date=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s));
function Plan({focus,now}:{focus:CompletedFocus;now:number}){
 const p=focus.plan,state=completedPlanState(p,now);
 if(!p)return <p className="cr-wait">目前沒有通過確認的買進區間。</p>;
 if(state==='EXPIRED')return <p className="cr-wait">原價格計畫已於 {date(p.valid_until)} 到期。須取得新的完整資料重評，不沿用舊買區。</p>;
 return <section className="cr-plan" aria-label="條件式價格計畫"><h4>等待確認的價格計畫</h4><p>{p.pending.join('；')}。未確認前不視為可以買進。</p>
  <dl className="cr-prices"><div><dt>條件區間</dt><dd>{money(p.range[0])}～{money(p.range[1])}</dd></div><div><dt>這個價格起不追</dt><dd>{money(p.no_chase)}</dd></div><div><dt>失效參考</dt><dd>{money(p.stop)}</dd></div></dl>
  <p>適用時間：{date(p.valid_from)}～{date(p.valid_until)}。未觸發即到期；失效價不保證能成交停損。</p>
  <details><summary>查看價格依據</summary><p>區間幅度情境 {money(p.scenario)} 元；計入成本假設後風險報酬約 {p.reward_risk.toFixed(2)}：1。這是條件計畫，不是公司合理價或獲利保證。</p></details>
 </section>;
}
export default function CompletedResearch({data,selectedHorizon,onHorizonChange}:{data:Research;selectedHorizon?:Horizon;onHorizonChange?:(horizon:Horizon)=>void}){
 const [localHorizon,setHorizon]=useState<Horizon>('SHORT'),[filter,setFilter]=useState('QUALIFIED'),[query,setQuery]=useState(''),[limit,setLimit]=useState(9),[now,setNow]=useState(Date.now);
 const horizon=selectedHorizon??localHorizon;
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(timer);},[]);
 const all=data.rows.filter(r=>r.horizon===horizon),rows=all.filter(r=>(filter==='ALL'||r.state===filter)&&(!query||`${r.symbol} ${r.company}`.includes(query.trim())));
 const focus=data.focus.filter(f=>f.horizons.includes(horizon)),change=(h:Horizon)=>{setHorizon(h);onHorizonChange?.(h);setFilter('QUALIFIED');setLimit(9);setQuery('');};
 return <main className="vnext-content cr" id="stock-observations">
  <header className="vnext-intro"><p className="vnext-eyebrow">本人股票研究 · 真實收盤資料</p><h1>看懂股票，再決定價格</h1>
   <p>行情截至 <strong>{data.data_through}</strong>；分析完成於 {date(data.evaluated_at)}（台北）。已分析 72 檔，短、中、長期分別判斷。</p>
   <p>這批研究僅供本人查看，尚未發布給會員。篩選符合不代表進場條件已成立。</p><a href="/vnext/publication">查看會員內容審核</a></header>
  <div className="vnext-horizons" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>change(h)}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span><small>{data.rows.filter(r=>r.horizon===h&&r.state==='QUALIFIED').length} 檔符合觀察條件</small></button>)}</div>
  <section className="cr-period-intro" aria-live="polite"><h2>目前查看：{HORIZONS[horizon].label}</h2><p>{HORIZONS[horizon].duration} · {periodCopy[horizon]}</p><p>同一檔股票可能出現在不同期間；各期間的判斷與條件分開閱讀。</p></section>
  <section aria-label="本期重點判斷"><h2>{HORIZONS[horizon].label}：先看這些判斷</h2><div className="vnext-grid">{focus.map(f=>{const r=all.find(r=>r.symbol===f.symbol)!;return <article className="vnext-card cr-focus" key={f.symbol}><p className="cr-period-badge">{HORIZONS[horizon].label} · {HORIZONS[horizon].duration}</p><p className="vnext-status">{states[r.state]}</p><h3>{r.company}<small>{r.symbol}</small></h3>
   <p>資料日收盤：{money(r.close)} 元</p><h4>為什麼這樣判斷？</h4><p>{horizon==='MEDIUM'?r.reason:f.reason}</p><h4>什麼條件才考慮？</h4><p>{horizon==='MEDIUM'?r.confirmation:f.confirmation}</p>{horizon==='SHORT'?<Plan focus={f} now={now}/>:<p className="cr-wait">本期間尚無已確認的價格計畫；請依本期間條件等待重評。</p>}
   <div className="vnext-risk"><h4>主要風險</h4><p>{horizon==='MEDIUM'?r.risk:f.risk}</p><h4>什麼情況取消或重評？</h4><p>{horizon==='MEDIUM'?r.invalidation:f.invalidation}</p></div>
   <details><summary>核對原始來源</summary><ul>{f.sources.map((url,i)=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">來源 {i+1} · {new URL(url).hostname}</a></li>)}</ul></details></article>;})}</div>
   {!focus.length&&<p>目前沒有完成逐項解讀的重點股票；下方仍可查看本期間全部篩選結果。</p>}</section>
  <section aria-label="72檔分析結果"><div className="vnext-summary"><h2>{HORIZONS[horizon].label}完整清單</h2><span>本期間 72 檔</span></div>
   <div className="cr-counts">{(Object.keys(states) as (keyof typeof states)[]).map(s=><span key={s}>{states[s]} <strong>{all.filter(r=>r.state===s).length}</strong> 檔</span>)}</div>
   <div className="cr-controls"><label>搜尋股票<input value={query} placeholder="股票名稱或代號" onChange={e=>{setQuery(e.target.value);setFilter('ALL');setLimit(9);}}/></label><label>篩選結果<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(9);}}><option value="QUALIFIED">符合觀察條件</option><option value="REJECTED">目前不符合</option><option value="INSUFFICIENT">資料不足</option><option value="ALL">全部股票</option></select></label></div>
   <p role="status">符合目前篩選：{rows.length} 檔</p><div className="vnext-grid">{rows.slice(0,limit).map(r=><article className="vnext-card" key={r.symbol}><p className="cr-period-badge">{HORIZONS[horizon].label}</p><span className="vnext-status">{states[r.state]}</span><h3>{r.company}<small>{r.symbol}</small></h3><p>資料日收盤：{money(r.close)} 元</p><p>{r.reason}</p>
    <h4>確認條件</h4><p>{r.confirmation}</p><h4>失效條件</h4><p>{r.invalidation}</p><div className="vnext-risk"><h4>主要風險</h4><p>{r.risk}</p></div>
    <details><summary>資料依據與缺口</summary>{r.gaps.length?<ul>{r.gaps.map(g=><li key={g}>{g}</li>)}</ul>:<p>本期間篩選所需資料已齊；進場與公告另行判斷。</p>}<ul>{r.sources.map((url,i)=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">資料來源 {i+1} · {new URL(url).hostname}</a></li>)}</ul></details></article>)}</div>
   {!rows.length?<p className="vnext-empty">這個分類沒有股票。可切換「全部股票」查看等待原因，不勉強給出買點。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>setLimit(n=>n+9)}>再看 9 檔</button>:null}</section>
  <p className="vnext-footnote">這是依資料日期作出的研究，不是過去已發布的預測。尚無可驗證的策略績效；沒有自動下單或追蹤成交。</p>
 </main>;
}
