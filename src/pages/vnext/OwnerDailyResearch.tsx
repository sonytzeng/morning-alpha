import {useEffect,useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {OWNER_ENTRY_LABELS,ownerDailyCounts,ownerDailyEntryResults,ownerDailyReason,type OwnerDailyResearch as DailyData} from '@/features/vnext/ownerDailyResearch';
import type {DailyLock} from '@/features/vnext/dailyIntelligence';
import {dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import './completed-research.css';
const labels={QUALIFIED:'符合觀察條件',REJECTED:'目前不符合',INSUFFICIENT:'資料不足'};
const runLabels={NOT_OBSERVED:'尚未取得今日執行紀錄',QUEUED:'等待或接續處理',RUNNING:'正在處理',COMPLETE:'流程已結束',BLOCKED:'流程受阻',EXPIRED:'本次盤前評估已逾時'};
const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const money=(value:number)=>value.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2});
function EntryResearch({lock,now}:{lock:DailyLock;now:number}){
 const entries=ownerDailyEntryResults(lock,now);
 return <details aria-label={`${lock.company}進場研究`}><summary>查看進場判斷、價格與等待原因</summary>
  <p>三種量價進場模型共用同一份資料，適用當日短線條件；中、長期頁籤不把這些價位當成公司合理估值。尚未核准會員發布。</p>
  {entries.map(entry=><section key={entry.strategy}><h4>{entry.label}：{OWNER_ENTRY_LABELS[entry.status]}</h4>
   {entry.reasons.length?<ul>{entry.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>:<p>尚待補核判斷理由。</p>}
   {entry.plan?<div className="cr-plan"><h5>等待確認的量價條件</h5><dl className="cr-prices"><div><dt>條件區間</dt><dd>{money(entry.plan.range[0])}～{money(entry.plan.range[1])} 元</dd></div><div><dt>超過先等</dt><dd>{money(entry.plan.wait_above)} 元</dd></div><div><dt>失效參考</dt><dd>{money(entry.plan.stop)} 元</dd></div></dl>
    <p><strong>確認條件：</strong>{entry.trigger}</p><p><strong>取消條件：</strong>{entry.invalidation}</p>
    <p>適用 {date(entry.plan.valid_from)}～{date(entry.plan.valid_until)}；未觸發即到期，跳空超過區間不追。失效價不保證可成交停損。</p>
    <p>按既有成本假設估算，風險報酬約 {entry.plan.reward_risk.toFixed(2)}：1；區間幅度情境 {money(entry.plan.scenario)} 元。這些條件尚未證明可獲利。</p>
   </div>:entry.plan_state==='DATE_MISMATCH'?<p className="cr-wait">保存的價格計畫交易日與本次評估不一致，須修正並取得新評估。</p>:entry.plan_state==='EXPIRED'?<p className="cr-wait">當日價格計畫已到期；須取得下一交易日的新資料重評。</p>:entry.plan_state==='MISSING'||entry.plan_state==='INVALID'?<p className="cr-wait">尚無通過當日時間、價格與風險檢查的完整計畫。</p>:<p className="cr-wait">{entry.status==='AVOID_ENTRY'?'本模型目前不適合進場，依上述原因等待重評。':'必要進場證據未齊，暫無可用價格條件。'}</p>}
   {entry.sources.length>0&&<details><summary>進場判斷使用的來源</summary><ul>{entry.sources.map((url,i)=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">來源 {i+1} · {new URL(url).hostname}</a></li>)}</ul></details>}
  </section>)}
 </details>;
}
export default function OwnerDailyResearch({data,unavailable,requestDate,horizon,onHorizonChange,onRefresh}:{data:DailyData|null;unavailable:boolean;requestDate:string;
 horizon:Horizon;onHorizonChange:(h:Horizon)=>void;onRefresh:()=>void}){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('ALL'),[limit,setLimit]=useState(9),[now,setNow]=useState(Date.now);
 useEffect(()=>{const refresh=()=>setNow(Date.now()),close=Date.parse(requestDate+'T13:30:00+08:00');refresh();
  const timer=setInterval(refresh,15000),deadline=setTimeout(refresh,Math.max(0,close-Date.now()));
  return()=>{clearInterval(timer);clearTimeout(deadline);};
 },[requestDate]);
 const counts=data?ownerDailyCounts(data,horizon):null,all=data?.rows.filter(r=>r.horizon===horizon)??[];
 const rows=all.filter(r=>(filter==='ALL'||r.research.state===filter)&&(!query.trim()||`${r.symbol} ${r.company}`.includes(query.trim())));
 return <main className="vnext-content cr" id="owner-daily-research" aria-label="今日自動評估">
  <header className="vnext-intro"><p className="vnext-eyebrow">本人每日自動評估</p><h1>今天的股票評估做到哪裡？</h1><p>執行日期：<strong>{requestDate}</strong>（台北）。本頁直接讀取每日流程保存的結果，每 30 秒重新核對。</p>
   <p>研究條件符合仍須確認價格與風險；這些結果尚未發布給會員。</p><button onClick={onRefresh}>重新讀取今日評估</button></header>
  {!data?<section className="vnext-empty" role="status"><h2>{unavailable?'目前無法確認今日評估':'正在讀取今日評估'}</h2><p>{unavailable?'讀取或資料驗證未完成，不代表今天沒有研究結果。':'正在核對本人權限、日期與已保存結果。'}</p></section>:<>
   <section className="vnext-risk" aria-label="今日評估進度" role="status"><h2>{runLabels[data.state]}</h2>{ownerDailyReason(data.reason)&&<p>{ownerDailyReason(data.reason)}</p>}
    <p>已保存紀錄 <strong>{data.rows.length}／216</strong> 個期間；已取得 <strong>{data.source_count}</strong> 份來源紀錄。</p>
    {data.rows.length===216?<><p>已保存 72 檔 × 三期間紀錄；必要資料不足的項目仍未完成有效評估。保存紀錄不代表推薦品質全部通過。</p><p>行情截至 <strong>{data.through}</strong>；證據截止 {date(data.evidence_cutoff!)}；紀錄保存於 {date(data.locked_at!)}。</p></>:<p>{data.state==='NOT_OBSERVED'?'尚未收到今日自然執行紀錄。下方舊文件保留原資料日期，不代替今日評估。':'尚未取得完整的 72 檔、三期間評估；不以舊文件或零買點代替。'}</p>}
   </section>
   {data.rows.length===216&&<><div className="vnext-horizons" aria-label="今日自動評估期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>{onHorizonChange(h);setFilter('ALL');setQuery('');setLimit(9);}}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
    <section aria-label="今日逐檔評估"><h2>{HORIZONS[horizon].label} · 已保存 {counts!.saved} 檔／有效評估 {counts!.evaluated} 檔</h2><div className="cr-counts"><span>符合觀察條件 {counts!.qualified} 檔</span><span>目前不符合 {counts!.rejected} 檔</span><span>資料不足 {counts!.insufficient} 檔</span></div>
     <div className="cr-controls"><label>搜尋股票<input value={query} placeholder="公司名稱或代號" onChange={e=>{setQuery(e.target.value);setLimit(9);}}/></label><label>評估結果<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(9);}}><option value="ALL">全部股票</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
     <p role="status">符合目前篩選：{rows.length} 檔</p><div className="vnext-grid">{rows.slice(0,limit).map(l=><article className="vnext-card" key={l.id}><p className="cr-period-badge">{HORIZONS[l.horizon].label} · {labels[l.research.state]}</p><h3>{l.company}<small>{l.symbol}</small></h3>
      <h4>為什麼這樣判斷？</h4><p>{l.research.reason}</p><h4>什麼條件才考慮？</h4><p>{l.confirmation}</p><h4>什麼情況取消或重評？</h4><p>{l.invalidation}</p><div className="vnext-risk"><h4>主要風險</h4><p>{l.research.risk}</p></div>
      <EntryResearch lock={l} now={now}/>
      <p className="cr-wait">{Date.parse(l.next_review_at)<=now?'本份評估已到重評時間，原判斷僅供核對。':'本頁顯示已保存的觀察評估，會員價格計畫仍須另行核准。'}</p><p>下次檢查：{date(l.next_review_at)}。本次行情資料截至：{l.research.through}。</p>
      <details><summary>查看資料缺口與來源</summary>{l.research.reasons.length?<ul>{l.research.reasons.map((r,i)=><li key={i}>{dailyAiGapLabel(r)}</li>)}</ul>:<p>此觀察模型所需條件已通過；會員發布與進場仍須另外確認。</p>}<ul>{[...new Set(l.research.used.map(t=>t.source))].map(url=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname}</a></li>)}</ul></details>
     </article>)}</div>{rows.length>limit&&<button className="vnext-primary" onClick={()=>setLimit(n=>n+9)}>再看 9 檔</button>}{!rows.length&&<p>目前篩選沒有結果，可切換全部股票查看其他判斷。</p>}
    </section></>}
  </>}
 </main>;
}
