import {useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {reviewSummary,type ReviewBundle,type ReviewCard,type ReviewClaim} from '@/features/vnext/publicationReview';
import {admissionSummary,type Admission,type AdmissionBundle} from '@/features/vnext/publicationAdmission';
import {BLOCKER_LABELS,blockerCategories,blockerCounts,type BlockerCategory} from '@/features/vnext/publicationBlockers';
const time=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(s));
const horizonLabels={SHORT:'短期',MEDIUM:'中期',LONG:'長期'};
function Claims({items}:{items:ReviewClaim[]}){return <ul>{items.map((c,i)=><li key={i}>{c.text}</li>)}</ul>;}
type ApprovalSubmit=(hash:string,reason:string,key:string)=>Promise<string>;
const matrixLabels:Record<string,string>={DATA_MISSING:'還缺哪些資料',DATA_INTEGRATION:'已有資料是否接好',TIME_METADATA:'時間與效期',METHODOLOGY_QUALITY:'獨立研究品質',RAW_REDISTRIBUTION:'原始資料用途',ANALYSIS_COMMERCIAL_RIGHTS:'自行研究的會員用途',OWNER_APPROVAL:'逐筆核准'};
function ApprovalPanel({audit,submit}:{audit:Admission;submit?:ApprovalSubmit}){
 const [reason,setReason]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[key]=useState(()=>crypto.randomUUID());
 const ready=audit.owner_approval_ready&&Boolean(submit);
 async function approve(){if(!ready||!submit||!reason.trim()||pending)return;setPending(true);try{setMessage(await submit(audit.review_hash,reason,key));}catch{setMessage('核准未完成；請重新載入檢查最新狀態，沒有發布會員內容。');}finally{setPending(false);}}
 return <section aria-label="逐筆發布審核">
  <h4>這份研究查到哪裡？</h4>
  <p>已保存資料：{audit.receipt_pit_valid?'取得時間與研究截止一致':'需要檢查時間'}。內容品質：{audit.quality==='PASS'?'查核通過；不是獲利保證':audit.quality==='FAIL'?'發現明確問題':'仍有待確認項目，不是不合格'}。</p>
  <details><summary>查看七項檢查與下一步</summary>{audit.matrix.map(m=><section key={m.key}><h4>{matrixLabels[m.key]} · {m.state==='PASS'?'已通過':m.state==='FAIL'?'需要修正':'尚待確認'}</h4><p>{m.reason}</p><p>下一步：{m.remedy}</p></section>)}</details>
  <p>{ready?'品質、用途與時間已通過，請逐筆確認內容。':'現在不能核准。補齊前置證據後才可提交；不是Sony已拒絕這項研究。'}</p>
  <label>審核說明<textarea aria-label="逐筆審核說明" value={reason} maxLength={500} disabled={!ready||pending} onChange={e=>setReason(e.target.value)}/></label>
  <button className="vnext-primary" disabled={!ready||pending||!reason.trim()} onClick={()=>void approve()}>{pending?'正在檢查前置條件':'核准此研究候選'}</button>
  <p>目前是隔離候選；即使完成核准，也不會直接發布正式會員網站。</p>
  {message?<p role="status">{message}</p>:null}
  <details><summary>查看獨立品質查核紀錄</summary><p>審查時間：{time(audit.reviewed_at)}；有效期限：{time(audit.expires_at)}</p><ul>{audit.checks.map(c=><li key={c.key}>{c.state==='PASS'?'通過':c.state==='FAIL'?'不符合':'待確認'}：{c.reason}</li>)}</ul><p>內容審查與選股引擎分開；Codex逐筆查核不冒充Sony核准、法律意見或策略有效性驗證。這次才讀到的公告不倒填原研究時間。</p></details>
 </section>;
}
function Card({card,audit,submit}:{card:ReviewCard;audit?:Admission;submit?:ApprovalSubmit}){
 return <article className="vnext-card" data-review-symbol={card.symbol}>
  <div className="vnext-card-top"><span>{horizonLabels[card.horizon]} · {HORIZONS[card.horizon].duration}</span><span className="vnext-status">研究合格，未核准公開</span></div>
  <h3>{card.company}<small>{card.symbol}</small></h3><p>{card.reason}</p>
  <p>{audit?blockerCategories(audit).map(k=>BLOCKER_LABELS[k]).join(' · '):'尚待取得審核結果'}</p>
  <details className="vnext-stock-review"><summary>查看{card.company}的研究與發布審核</summary>
  <h4>要等什麼條件？</h4><p>{card.confirmation}</p>
  <section className="vnext-risk"><h4>什麼情況取消？</h4><p>{card.invalidation}</p></section>
  <h4>能不能給會員看？</h4><p>{audit?.owner_approval_ready?'前置條件通過，仍須Sony逐筆核准；尚未發布會員。':'目前不行。時間、內容與使用權分開查核，任一項待確認都不能公開。'}</p>
  <p>下次檢查：{time(card.next_review_at)}（台北時間）完整資料取得後，不是自動下單時間。</p>
  {audit?<ApprovalPanel audit={audit} submit={submit}/>:null}
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
  </details>
 </article>;
}
export default function PublicationReview({data,admission,submit}:{data:ReviewBundle;admission?:AdmissionBundle;submit?:ApprovalSubmit}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[query,setQuery]=useState(''),[limit,setLimit]=useState(6),[category,setCategory]=useState<BlockerCategory|'ALL'>('ALL');
 const stats=reviewSummary(data.cards),auditStats=admission?admissionSummary(admission):null,counts=admission?blockerCounts(admission):null,audits=new Map(admission?.cards.map(a=>[a.review_hash,a]));
 const cards=data.cards.filter(c=>c.horizon===horizon&&(c.symbol.includes(query.trim())||c.company.includes(query.trim()))&&(category==='ALL'||audits.has(c.review_hash)&&blockerCategories(audits.get(c.review_hash)!).includes(category)));
 return <section aria-labelledby="first-review-title" className="vnext-review">
  <div className="vnext-intro"><p className="vnext-eyebrow">僅供內部研究 · 還不能提供會員</p><h1 id="first-review-title">目前有幾項研究可以發布？</h1><p>{counts?`目前${counts.READY}項已備齊前置條件，可交Sony核准。`:'尚未取得完整審核結果，不能當作通過。'}品質通過不等於有發布權，也不代表未來會上漲。</p><p>原有{stats.qualified}項研究保留：短期{stats.short}項、中期{stats.medium}項。行情截至{data.cards[0]?.through??'未取得'}，於{data.cards[0]?time(data.cards[0].cutoff):'未取得'}（台北時間）取得資料後評估，不是當時盤前預測。</p></div>
  {counts?<><div className="vnext-grid vnext-blocker-grid" aria-label="研究發布狀況">{(Object.keys(BLOCKER_LABELS) as BlockerCategory[]).map(k=><button className="vnext-card" key={k} aria-pressed={category===k} onClick={()=>{setCategory(k);setLimit(6);}}><span>{BLOCKER_LABELS[k]}</span><strong>{counts[k]} 項</strong><span>查看這類研究</span></button>)}</div><p>同一研究可能同時缺資料與使用權；分類數量不能相加。「待確認」不等於品質不合格。</p></>:null}
  {auditStats?<section className="vnext-card" aria-label="獨立審核進度"><h2>逐項審核進度</h2><p>{auditStats.receipt_pit_valid}項的實際取得時間可核對。內容查核通過{auditStats.quality_pass}項、明確不符合{auditStats.quality_fail}項、待補查核{auditStats.quality_pending}項；用途確認{auditStats.licensing_approved}項，可交Sony核准{auditStats.owner_approval_ready}項。</p><p>原始資料的再散布權利，與自行研究的商用用途分開判斷。缺時間或授權，不會改寫原研究合格結果。</p></section>:null}
  <div className="vnext-horizons" role="group" aria-label="逐筆審查期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{horizonLabels[h]}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  {category!=='ALL'?<p role="status">正在查看：{BLOCKER_LABELS[category]} <button className="vnext-primary" onClick={()=>{setCategory('ALL');setLimit(6);}}>顯示全部研究</button></p>:null}
  <div className="vnext-real-controls"><label>找股票<input value={query} placeholder="例如：健策或3653" onChange={e=>{setQuery(e.target.value);setLimit(6);}}/></label><p>依代號排列，不是推薦順位；每家公司使用自己的保存證據。</p></div>
  <div className="vnext-grid">{cards.slice(0,limit).map(c=><Card key={c.review_hash} card={c} audit={audits.get(c.review_hash)} submit={submit}/>)}</div>
  {!cards.length&&<section className="vnext-empty"><h2>{horizon==='LONG'?'長期：暫時無法可靠判斷':'沒有符合查詢的研究'}</h2><p>{horizon==='LONG'?'72檔仍缺必要的可比較財務、資本支出、需求、競爭優勢與估值審查，不代表這些公司沒有投資價值。':'沒有用範例股票填補結果。'}</p></section>}
  {limit<cards.length&&<button className="vnext-primary" onClick={()=>setLimit(n=>n+6)}>再看6項（{Math.min(limit,cards.length)}／{cards.length}）</button>}
  <aside className="vnext-footnote"><p>事前驗證樣本：0；已完成結果：0。尚未證明投資分析有效。每日更新仍是隔離候選，不會阻塞正式報告或LINE。</p></aside>
 </section>;
}
