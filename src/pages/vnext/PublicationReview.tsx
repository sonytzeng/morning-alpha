import {useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {reviewSummary,type ReviewBundle,type ReviewCard,type ReviewClaim} from '@/features/vnext/publicationReview';
const time=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(s));
const horizonLabels={SHORT:'短期',MEDIUM:'中期',LONG:'長期'};
const blockers:Record<string,string>={QUALITY_BLOCKED:'公司事件與研究品質尚待查核',LICENSING_UNVERIFIED:'會員用途授權尚未確認',TIME_BLOCKED:'部分原始發布時間未保存',PUBLICATION_APPROVAL_REQUIRED:'尚未取得逐筆公開核准'};
function Claims({items}:{items:ReviewClaim[]}){return <ul>{items.map((c,i)=><li key={i}>{c.text}</li>)}</ul>;}
function Card({card}:{card:ReviewCard}){
 return <article className="vnext-card" data-review-symbol={card.symbol}>
  <div className="vnext-card-top"><span>{horizonLabels[card.horizon]} · {HORIZONS[card.horizon].duration}</span><span className="vnext-status">研究合格，未核准公開</span></div>
  <h3>{card.company}<small>{card.symbol}</small></h3><p>{card.reason}</p>
  <h4>要等什麼條件？</h4><p>{card.confirmation}</p>
  <section className="vnext-risk"><h4>什麼情況取消？</h4><p>{card.invalidation}</p></section>
  <h4>能不能給會員看？</h4><p>目前不行。{card.publication.blockers.map(b=>blockers[b]??'需要進一步審核').join('；')}。</p>
  <p>下次檢查：{time(card.next_review_at)}（台北時間）完整資料取得後，不是自動下單時間。</p>
  <details><summary>查看支持與反對理由</summary><h4>支持觀察的事實</h4><Claims items={card.supporting}/><h4>反對訊號與限制</h4><Claims items={card.opposing}/></details>
  <details><summary>查看同期財務與公司事件</summary><h4>財務核對</h4><Claims items={card.financial}/><h4>公司事件</h4><Claims items={card.events}/></details>
  <details><summary>查看技術詳細資料與授權紀錄</summary>
   <p>行情截至：{card.through}<br/>研究截止：{time(card.cutoff)}<br/>本次審查：{time(card.reviewed_at)}</p>
   <p>歷史探索研究，不是盤前預測。原研究判定：{card.research_state}</p>
   <ul>{card.quality.checks.map(c=><li key={c.key}>{c.pass?'通過':'尚未通過'}：{c.reason}（{c.key}）</li>)}</ul>
   <p>時間問題 {card.time_issues.length} 筆；沒有用取得時間代填發布時間。</p>
   {card.rights.map(r=><section key={r.source}><a href={r.source} target="_blank" rel="noreferrer">精確資料來源</a> · <a href={r.review_source} target="_blank" rel="noreferrer">核對規範</a><p>{r.uses.map(u=>`${u.use==='RAW_DATA'?'原始資料':u.use==='OFFICIAL_FACT'?'事實揭露':'自行分析'}：${u.allowed?'需遵守顯名條件':'用途未確認'}`).join('／')}</p><p>{r.next_action}</p></section>)}
   <p>策略版本：{card.research_version}<br/>研究指紋：{card.research_hash}<br/>審查指紋：{card.review_hash}</p>
  </details>
 </article>;
}
export default function PublicationReview({data}:{data:ReviewBundle}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[query,setQuery]=useState(''),[limit,setLimit]=useState(6);
 const stats=reviewSummary(data.cards),cards=data.cards.filter(c=>c.horizon===horizon&&(c.symbol.includes(query.trim())||c.company.includes(query.trim())));
 return <section aria-labelledby="first-review-title" className="vnext-review">
  <div className="vnext-intro"><p className="vnext-eyebrow">僅供內部研究 · 還不能提供會員</p><h1 id="first-review-title">哪些股票已經符合研究條件？</h1><p>行情截至{data.cards[0]?.through??'未取得'}，研究在{data.cards[0]?time(data.cards[0].cutoff):'未取得'}（台北時間）取得資料後評估。符合探索條件，不等於品質審核通過、正式推薦或未來會上漲。</p></div>
  <div className="vnext-grid" aria-label="研究發布狀況">
   <section className="vnext-card"><h2>值得研究</h2><p><strong>{stats.qualified} 項</strong>符合探索條件：短期 {stats.short} 項、中期 {stats.medium} 項。長期72檔必要證據不足。</p></section>
   <section className="vnext-card"><h2>還不能公開</h2><p><strong>{stats.reviewed} 項</strong>仍需確認授權、原發布時間與公司事件內容。研究合格與會員發布是兩件事。</p></section>
   <section className="vnext-card"><h2>已核准會員內容</h2><p><strong>0 項</strong>。免費及進階會員目前都顯示真實空狀態，不會硬湊股票。</p></section>
  </div>
  <div className="vnext-horizons" role="group" aria-label="逐筆審查期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{horizonLabels[h]}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  <div className="vnext-real-controls"><label>找股票<input value={query} placeholder="例如：健策或3653" onChange={e=>{setQuery(e.target.value);setLimit(6);}}/></label><p>依代號排列，不是推薦順位；每家公司使用自己的保存證據。</p></div>
  <div className="vnext-grid">{cards.slice(0,limit).map(c=><Card key={c.review_hash} card={c}/>)}</div>
  {!cards.length&&<section className="vnext-empty"><h2>{horizon==='LONG'?'長期：暫時無法可靠判斷':'沒有符合查詢的研究'}</h2><p>{horizon==='LONG'?'72檔仍缺必要的可比較財務、資本支出、需求、競爭優勢與估值審查，不代表這些公司沒有投資價值。':'沒有用範例股票填補結果。'}</p></section>}
  {limit<cards.length&&<button className="vnext-primary" onClick={()=>setLimit(n=>n+6)}>再看6項（{Math.min(limit,cards.length)}／{cards.length}）</button>}
  <aside className="vnext-footnote"><p>事前驗證樣本：0；已完成結果：0。尚未證明投資分析有效。每日更新仍是隔離候選，不會阻塞正式報告或LINE。</p></aside>
 </section>;
}
