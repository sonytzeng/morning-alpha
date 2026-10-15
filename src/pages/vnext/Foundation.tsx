import {useState} from 'react';
import type {FoundationSummary} from '@/features/vnext/foundation';
export default function Foundation({data}:{data:FoundationSummary}){
 const [symbol,setSymbol]=useState('2330'),row=data.rows.find(r=>r.symbol===symbol);
 return <section id="foundation" className="vnext-card vnext-foundation" aria-label="新取得資料的完整程度">
  <h2>研究資料補到哪裡了？</h2>
  <p>目前 {data.coverage['250']}／72 檔具備完整250交易日量價，資料到 {data.through}。這是本次新取得的資料，不會改寫歷史研究，也不代表已找到買點。</p>
  <p>若分開計算「實際有交易的250筆日量價」，目前 {data.traded_coverage}／72 檔已取得。停牌日仍保留為缺口，不改變策略門檻或假設當日可成交。</p>
  <div className="vnext-chain">{(['20','60','120','250'] as const).map(n=><section key={n}><h3>{n}日量價</h3><p>{data.coverage[n]}／72 檔完整</p></section>)}</div>
  <p>已核對 {data.action_events} 筆除權息等紀錄；完整權益與價格調整仍待確認，暫不計算調整後報酬。</p>
  <p>當期月營收 {data.official_facts.REVENUE} 檔、每股盈餘 {data.official_facts.EPS} 檔。單期實績不能替代長期成長趨勢。</p>
  <details><summary>查看本次資料缺口與來源</summary>
   <p>目前官方重大訊息快照中，研究72檔命中 {data.official_facts.EVENT} 筆。這不代表過去沒有公告；本次快照不是歷史公告全集，也不能直接判定利多或利空。</p>
   <div className="vnext-real-controls"><label>檢查股票量價<select value={symbol} onChange={e=>setSymbol(e.target.value)}>{data.rows.map(r=><option key={r.symbol} value={r.symbol}>{r.symbol}</option>)}</select></label></div>
   <p>{row?.symbol}：250交易日中，{row?.coverage['250']}日具有合法且完整的量價。</p>
   {row?.gaps.length?<p>缺失日期：{row.gaps.map(g=>g.date).join('、')}。缺失日不補零值、不拿其他日期代替。</p>:<p>所需交易日沒有缺漏。</p>}
   <h3>已核對的公司關係</h3>
   {data.relations.length?<><p>健策（3653）→ 台積電（2330）：官方2025年供應商獎項確認供應關係。</p><p>只能證明當時具名關係，不能推論今日訂單、產品占比、獲利或股價。其餘未取得證據的關係維持未知。</p><a href={data.relations[0].source} target="_blank" rel="noreferrer">查看台積電官方來源</a></>:<p>尚未取得可確認公司間關係的來源，不從同產業推測供應鏈。</p>}
   <p>需求、訂單、營收、獲利、股價之間仍需逐步驗證；目前不宣稱完整產業影響鏈。</p>
   <p>下一步：核對公司行動權益、連續財務資料與公告內文，再評估可否形成研究判斷。每日增量更新目前僅有候選設計，尚未啟用。</p>
   <details><summary>技術詳細資料</summary><p>首次取得保留在每筆資料內。本次快照完成：{data.observed_at}<br/>涵蓋期間：{data.from}～{data.through}<br/>歷史截止可採用本次新證據：0<br/>資料指紋：{data.history_hash}<br/>來源指紋：{data.sources_hash}</p><p>Owner私人研究限定，商用再散布未核准。Forward Sample = 0；Outcome Sample = 0。</p></details>
  </details>
 </section>;
}
