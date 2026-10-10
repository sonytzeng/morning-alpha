import {useState} from 'react';
import {HORIZONS,sourceSafe,type Horizon} from '@/features/vnext/contracts';
import type {PublicationReadiness as Readiness} from '@/features/vnext/publicationReadiness';

export default function PublicationReadiness({data}:{data:Readiness}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[query,setQuery]=useState(''),[limit,setLimit]=useState(6);
 const cards=data.cards.filter(c=>c.horizon===horizon&&(c.symbol.includes(query.trim())||c.company.includes(query.trim())));
 return <section id="publication-readiness" aria-label="會員內容發布準備">
  <div className="vnext-intro"><p className="vnext-eyebrow">真實來源核對 · 僅供 Owner 審查</p><h2>哪些研究可以提供會員？</h2>
   <p>目前短期、中期、長期均沒有通過所有公開條件的股票。下方是待補證據清單，不是推薦，也不是事前預測。</p>
   <p>量價資料截至 {data.through}；首次取得時間照原紀錄保存，不當成今天的即時資訊。</p>
   <a href="/stocks">查看會員目前會看到的內容</a></div>
  <div className="vnext-horizons" aria-label="發布審查期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{HORIZONS[h].label}</strong><span>可公開 {data.eligible[h]} 檔／已核對72檔</span></button>)}</div>
  <div className="vnext-real-controls"><label>查待補證據的股票<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(6);}} placeholder="股票名稱或代號"/></label></div>
  <div className="vnext-grid">{cards.slice(0,limit).map(c=><article className="vnext-card" key={c.symbol+c.horizon}>
   <div className="vnext-card-top"><span>{HORIZONS[c.horizon].duration}</span><span className="vnext-status">暫時無法可靠判斷</span></div>
   <h3>{c.company}<small>{c.symbol}</small></h3><p>{c.reason}</p>
   <h4>為什麼還不能公開？</h4><ul>{c.gaps.map(g=><li key={g}>{g}</li>)}</ul>
   {c.rights.some(r=>r.status!=='OPEN_DATA_WITH_ATTRIBUTION')?<p className="vnext-risk">部分來源的會員使用權利尚未確認；改寫成摘要也不會自動取得授權。</p>:null}
   <h4>什麼條件成立才開始考慮？</h4><p>{c.confirmation}</p><h4>什麼情況需要重新檢查？</h4><p>{c.invalidation}</p>
   <h4>下次何時再檢查？</h4><p>{c.next_review}</p>
   <details><summary>查看來源、授權與精確拒絕原因</summary>{c.rights.map(r=><section key={r.id}>{sourceSafe(r.source)?<a href={r.source} target="_blank" rel="noopener noreferrer">原始資料來源</a>:<span>來源網址無法安全開啟</span>}<p>{r.reason}</p>{r.grant?<><a href={r.grant.dataset} target="_blank" rel="noopener noreferrer">開放資料集授權說明</a><p>{r.grant.attribution}</p></>:null}</section>)}<p>資料核對截止：{c.cutoff}</p><p>{c.blockers.join('、')}</p></details>
  </article>)}</div>
  {!cards.length?<p className="vnext-empty">核對範圍沒有符合查詢的股票，不會補造候選。</p>:limit<cards.length?<button className="vnext-primary" onClick={()=>setLimit(v=>v+6)}>再看6檔</button>:null}
  <p className="vnext-footnote">事前驗證樣本 0，已完成成效 0。自然更新尚未啟用；研究內容沒有提供正式會員。</p>
 </section>;
}
