import {useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import type {DailyPreview} from '@/features/vnext/dailyPreview';
export default function DailyIntelligence({data}:{data:DailyPreview}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[filter,setFilter]=useState('QUALIFIED'),[limit,setLimit]=useState(6);
 const summary=data.summary.horizons[horizon],rows=data.rows.filter(r=>r.horizon===horizon&&(filter==='ALL'||r.state===filter));
 return <section aria-label="每日股票研究候選" id="daily-intelligence">
  <div className="vnext-intro"><p className="vnext-eyebrow">僅供研究者 · 自動流程尚未正式啟用</p><h1>今天有哪些值得研究的股票？</h1>
   <p><strong>今天尚無自然產生的新研究。以下是截至 {data.through} 行情的保存資料回顧，不是今日推薦或事前預測。</strong></p>
   <p>三種期間分開判斷；值得觀察不等於適合現在買進。研究已保留原始時間，尚未通過會員公開審核。</p></div>
  <div className="vnext-horizons" aria-label="每日研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  <div className="vnext-chain"><section><h2>符合研究條件 {summary.qualified} 檔</h2><p>仍須確認進場條件與主要風險。</p></section><section><h2>未符合研究條件 {summary.rejected} 檔</h2><p>不等於沒有其他研究價值。</p></section><section><h2>資料不足 {summary.insufficient} 檔</h2><p>暫時無法可靠判斷。</p></section></div>
  <section className="vnext-risk"><h2>現在能判斷買點嗎？</h2><p>這次保存研究有 {data.summary.entry_source_missing_symbols} 檔缺少同一時點的完整進場證據。等待確認／不適合進場的數量尚不能可靠列出；不會借用其他日期的判斷。</p><p>超跌反轉、趨勢回檔與突破延續已接入隔離流程；資料未齊時，不顯示猜測的買價或停損價。</p></section>
  <div className="vnext-real-controls"><label>查看研究結果<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(6);}}><option value="QUALIFIED">符合研究條件</option><option value="REJECTED">未符合研究條件</option><option value="INSUFFICIENT">資料不足</option><option value="ALL">全部股票</option></select></label><p>本期間已掃描 {summary.scanned} 檔</p></div>
  <div className="vnext-grid">{rows.slice(0,limit).map(r=><article className="vnext-card" key={r.symbol+r.horizon}><h3>{r.company}<small>{r.symbol}</small></h3><p>{r.reason}</p><h4>什麼條件成立才考慮？</h4><p>{r.confirmation}</p><h4>什麼情況取消？</h4><p>{r.invalidation}</p><h4>最大風險</h4><p>{r.risk}</p><p>進場判斷：{r.entry_source_missing?'暫時無法可靠判斷，等待同時點證據。':'查看三種進場研究結果。'}</p><p>下次檢查：{r.next_review_at.slice(0,10)} 完整交易資料取得後；目前尚未自動執行。</p></article>)}</div>
  {!rows.length?<p className="vnext-empty">這個分類目前沒有可用研究，不勉強湊股票。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>setLimit(n=>n+6)}>再看6檔</button>:null}
  <section className="vnext-footnote"><p>事前研究樣本：0；已驗證成效：0。尚不能判斷分析是否有效。<br/>免費與進階會員目前可見研究均為0；已寄送授權詢問不等於取得授權。</p></section>
  <details><summary>查看技術詳細資料與流程驗證</summary><p>隔離流程：{data.stages.join(' → ')}</p><p>待到期觀察：{data.pending_outcomes}；未知／證據不足：{data.unknown_outcomes}。這些是追蹤狀態，不是已完成績效。</p><p>研究截止：{data.evaluated_at}<br/>本次回顧鎖定：{data.locked_at}<br/>來源指紋：{data.source_hash}<br/>執行指紋：{data.run_key}</p></details>
 </section>;
}
