import {useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import type {DailyPreview} from '@/features/vnext/dailyPreview';
const entryStrategies = [
 ['OVERSOLD_REVERSAL', '超跌反轉'], ['PULLBACK_ENTRY', '趨勢回檔'], ['BREAKOUT_CONTINUATION', '突破延續'],
] as const;
const entryStates:Record<string,string> = {
 ENTRY_READY:'研究條件符合，尚未確認成交', WAIT_CONFIRMATION:'等待條件確認',
 AVOID_ENTRY:'不適合進場', INSUFFICIENT_EVIDENCE:'資料不足，無法判斷',
};
type DailyRow = DailyPreview['rows'][number];
function entryResults(row:DailyRow) {
 return entryStrategies.map(([strategy,label])=>{
  const matches=row.entry.filter(e=>e.strategy===strategy);
  const entry=!row.entry_source_missing&&matches.length===1&&Object.hasOwn(entryStates,matches[0].status)?matches[0]:null;
  const status=entry?.status??'INSUFFICIENT_EVIDENCE';
  return {strategy,label,status,reasons:entry?.reasons??[],
   trigger:status==='ENTRY_READY'||status==='WAIT_CONFIRMATION'?entry?.trigger:null,
   invalidation:status==='ENTRY_READY'||status==='WAIT_CONFIRMATION'?entry?.invalidation:null};
 });
}
function EntryResearch({row}:{row:DailyRow}) {
 const results=entryResults(row);
 return <details aria-label={`${row.company}進場研究`}><summary>查看三種進場判斷與條件</summary>
  <p>以下為同一份保存資料的進場研究，不隨短、中、長期頁籤改成不同買點；條件符合也不代表已成交。</p>
  {results.map(e=><section key={e.strategy}><h4>{e.label}：{entryStates[e.status]}</h4>
   {e.reasons.length?<ul>{e.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>:<p>{e.status==='INSUFFICIENT_EVIDENCE'?'尚未取得完整的同時點判斷與理由。':'這份資料沒有附上判斷理由，須補查。'}</p>}
   {e.trigger&&<p><strong>觸發條件：</strong>{e.trigger}</p>}
   {e.invalidation&&<p><strong>失效條件：</strong>{e.invalidation}</p>}
  </section>)}
 </details>;
}
export default function DailyIntelligence({data}:{data:DailyPreview}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[filter,setFilter]=useState('QUALIFIED'),[limit,setLimit]=useState(6);
 const summary=data.summary.horizons[horizon],horizonRows=data.rows.filter(r=>r.horizon===horizon),rows=horizonRows.filter(r=>filter==='ALL'||r.state===filter);
 const incompleteEntries=horizonRows.filter(r=>entryResults(r).some(e=>e.status==='INSUFFICIENT_EVIDENCE')).length;
 return <section aria-label="每日股票研究候選" id="daily-intelligence">
  <div className="vnext-intro"><p className="vnext-eyebrow">僅供研究者 · 自動流程尚未正式啟用</p><h1>今天有哪些值得研究的股票？</h1>
   <p><strong>今天尚無自然產生的新研究。以下是截至 {data.through} 行情的保存資料回顧，不是今日推薦或事前預測。</strong></p>
   <p>三種期間分開判斷；值得觀察不等於適合現在買進。研究已保留原始時間，尚未通過會員公開審核。</p></div>
  <div className="vnext-horizons" aria-label="每日研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  <div className="vnext-chain"><section><h2>符合研究條件 {summary.qualified} 檔</h2><p>仍須確認進場條件與主要風險。</p></section><section><h2>未符合研究條件 {summary.rejected} 檔</h2><p>不等於沒有其他研究價值。</p></section><section><h2>資料不足 {summary.insufficient} 檔</h2><p>暫時無法可靠判斷。</p></section></div>
  <section className="vnext-risk"><h2>現在能判斷買點嗎？</h2><p>{incompleteEntries?`本期間有 ${incompleteEntries} 檔的進場研究仍有資料缺口；可在各股卡片查看缺少什麼。`:'本期間各股已有三種進場判斷，可在卡片查看結果、觸發與失效條件。'}</p><p>超跌反轉、趨勢回檔與突破延續分開呈現。這些是保存資料的研究結果；資料不足或不適合進場時，不顯示買價與停損條件。</p></section>
  <div className="vnext-real-controls"><label>查看研究結果<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(6);}}><option value="QUALIFIED">符合研究條件</option><option value="REJECTED">未符合研究條件</option><option value="INSUFFICIENT">資料不足</option><option value="ALL">全部股票</option></select></label><p>本期間已掃描 {summary.scanned} 檔</p></div>
  <div className="vnext-grid">{rows.slice(0,limit).map(r=><article className="vnext-card" key={r.symbol+r.horizon}><h3>{r.company}<small>{r.symbol}</small></h3><p>{r.reason}</p><h4>什麼條件成立才考慮？</h4><p>{r.confirmation}</p><h4>什麼情況取消？</h4><p>{r.invalidation}</p><h4>最大風險</h4><p>{r.risk}</p><EntryResearch row={r}/><p>下次檢查：{r.next_review_at.slice(0,10)} 完整交易資料取得後；目前尚未自動執行。</p></article>)}</div>
  {!rows.length?<p className="vnext-empty">這個分類目前沒有可用研究，不勉強湊股票。</p>:rows.length>limit?<button className="vnext-primary" onClick={()=>setLimit(n=>n+6)}>再看6檔</button>:null}
  <section className="vnext-footnote"><p>事前研究樣本：0；已驗證成效：0。尚不能判斷分析是否有效。<br/>免費與進階會員目前可見研究均為0；已寄送授權詢問不等於取得授權。</p></section>
  <details><summary>查看技術詳細資料與流程驗證</summary><p>隔離流程：{data.stages.join(' → ')}</p><p>待到期觀察：{data.pending_outcomes}；未知／證據不足：{data.unknown_outcomes}。這些是追蹤狀態，不是已完成績效。</p><p>研究截止：{data.evaluated_at}<br/>本次回顧鎖定：{data.locked_at}<br/>來源指紋：{data.source_hash}<br/>執行指紋：{data.run_key}</p></details>
 </section>;
}
