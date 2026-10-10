import {useState} from 'react';
import {HORIZONS,sourceSafe,type Horizon} from '@/features/vnext/contracts';
import type {ResearchFunnel as Funnel} from '@/features/vnext/researchFunnel';
const categories:Record<string,string>={LICENSING:'用途授權仍未確認',TIME:'來源發布時間仍不完整',EXPIRED:'已過重新檢查時間',QUALITY:'研究方法與內容尚待審核',APPROVAL:'尚無逐筆公開核准',PERMISSION:'缺少合法會員閱讀權限'};
const reasons:Record<string,string>={PARTICIPATION_NOT_ELEVATED:'成交參與未明顯增加',CLOSE_NOT_SUPPORTED:'當日收盤表現未確認',INTRADAY_RANGE_TOO_WIDE:'當日價格波動過大',
 MISSING_REVENUE_3:'缺少連續三個月營收',MISSING_INSTITUTIONAL_10:'缺少連續十個交易日法人方向',MISSING_EPS_4:'缺少四季可比獲利',MISSING_MARGIN_4:'缺少四季毛利資料',MISSING_CAPEX_4:'缺少四季資本支出',MISSING_DEMAND_1:'缺少持續需求證據',MISSING_MOAT_1:'缺少競爭優勢證據',MISSING_VALUATION_1:'缺少估值基礎'};
const label=(r:string)=>reasons[r]??(r.includes('TIME')||r.includes('FUTURE')?'資料時間尚不能可靠核對':r.includes('BASIS')?'資料口徑仍待核對':'必要證據仍待核對');
export default function ResearchFunnel({data}:{data:Funnel}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[filter,setFilter]=useState('ALL'),[query,setQuery]=useState(''),[limit,setLimit]=useState(6);
 const c=data.counts[horizon],rows=data.rows.filter(r=>r.research.horizon===horizon&&(filter==='ALL'||r.research.state===filter)&&(r.research.symbol.includes(query)||r.research.company.includes(query)))
  .sort((a,b)=>['QUALIFIED','INSUFFICIENT','REJECTED'].indexOf(a.research.state)-['QUALIFIED','INSUFFICIENT','REJECTED'].indexOf(b.research.state)||a.research.symbol.localeCompare(b.research.symbol));
 return <section id="research-funnel" aria-label="研究與公開資格分開檢查">
  <div className="vnext-intro"><p className="vnext-eyebrow">真實保存資料 · 新版研究假設，尚未正式採用</p><h1>72檔裡，哪些值得繼續研究？</h1>
   <p>先判斷研究是否成立，再檢查可不可以提供會員。資料不足不是「股票不好」，研究成立也不等於已能公開。</p>
   <p>行情截至 {data.through}；本次以後來實際取得的資料檢查，不冒充當日事前判斷。尚未證明投資成效。</p></div>
  <div className="vnext-horizons" aria-label="研究漏斗期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={h===horizon} onClick={()=>{setHorizon(h);setLimit(6);setFilter('ALL');}}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  <div className="vnext-chain" aria-label="研究結果"><section><h2>{c.qualified} 檔值得觀察</h2><p>符合本版研究假設；不是買進推薦。</p></section><section><h2>{c.rejected} 檔未符合</h2><p>資料足以評估，但本模型條件未成立。</p></section><section><h2>{c.insufficient} 檔資料不足</h2><p>尚不能可靠評估，不能當成不合格股票。</p></section></div>
  <p>已掃描 {c.scanned} 檔，完整評估 {c.evaluated} 檔。舊版必要證據齊全 {c.v1_contract_ready} 檔／不足 {c.v1_insufficient} 檔；舊版只做完整性檢查，沒有真正區分合格與不合格。</p>
  <section className="vnext-risk"><h2>符合研究，但能公開嗎？</h2><p>只審查符合研究的 {c.publication_checked} 檔：可公開 {c.publication_eligible} 檔，仍不能公開 {c.publication_checked-c.publication_eligible} 檔。</p>
   {c.publication_checked?<ul>{Object.entries(c.publication_categories).map(([key,n])=><li key={key}>{categories[key]}：{n} 檔</li>)}</ul>:<p>目前沒有符合研究條件的股票，所以未進入公開資格審查；不是授權問題把這些股票判成研究失敗。</p>}
   <p>一檔可能有多個原因，原因筆數不能相加當成股票數。</p></section>
  <details><summary>查看研究不成立與資料不足的原因統計</summary><ul>{Object.entries(c.research_reasons).map(([key,n])=><li key={key}>{label(key)}：{n} 檔</li>)}</ul></details>
  <div className="vnext-real-controls"><label>查看結果<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(6);}}><option value="ALL">全部股票</option><option value="QUALIFIED">值得觀察</option><option value="REJECTED">未符合條件</option><option value="INSUFFICIENT">資料不足</option></select></label><label>找股票<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(6);}} placeholder="股票名稱或代號"/></label></div>
  <div className="vnext-grid">{rows.slice(0,limit).map(({research:r,publication:p,input_hash})=><article className="vnext-card" key={r.symbol+r.horizon}>
   <div className="vnext-card-top"><span>{HORIZONS[r.horizon].duration}</span><span className="vnext-status">{r.state==='QUALIFIED'?'值得觀察，尚待確認':r.state==='REJECTED'?'目前未符合條件':'暫時無法可靠判斷'}</span></div><h3>{r.company}<small>{r.symbol}</small></h3><p>{r.reason}</p>
   {r.reasons.length?<ul>{[...new Set(r.reasons.map(label))].slice(0,4).map(s=><li key={s}>{s}</li>)}</ul>:null}
   <h4>什麼條件成立才開始考慮？</h4><p>{r.confirmation}</p><h4>什麼情況代表原判斷失效？</h4><p>{r.invalidation}</p>
   <h4>主要風險</h4><p>{r.risk}</p><h4>下次何時重新檢查？</h4><p>{r.next_review_at.slice(0,10)} 完整交易資料取得後；沒有啟用自動更新。</p>
   <p>{p.checked?`會員公開：${p.eligible?'符合候選審查，仍未發布':'尚未通過'}`:'尚未進入會員公開審查'}</p>
   <details><summary>查看來源、方法與技術詳細資料</summary><p>{r.version}／未採用／不是事前預測</p><p>核對截止：{r.cutoff}</p><p>研究原因：{r.reasons.join('、')||'本版條件成立'}</p><p>公開原因：{p.reasons.join('、')||'未評估或無拒絕原因'}</p><p>限制：{r.warnings.join('、')}</p><p>證據封存：{input_hash}</p>{[...new Set(r.used.map(e=>e.source))].map(source=>sourceSafe(source)?<p key={source}><a href={source} target="_blank" rel="noreferrer">原始資料來源</a></p>:null)}</details>
  </article>)}</div>
  {!rows.length?<p className="vnext-empty">沒有符合條件的保存資料，不會補造股票。</p>:limit<rows.length?<button className="vnext-primary" onClick={()=>setLimit(v=>v+6)}>再看6檔</button>:null}
  <p className="vnext-footnote">會員內容仍未公開，事前研究樣本 0，已完成成效 0。<a href="/stocks">查看會員空狀態</a></p>
 </section>;
}
