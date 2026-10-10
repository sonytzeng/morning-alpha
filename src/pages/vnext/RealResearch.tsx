import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAcademyAccess} from '@/pages/academy/useAcademyAccess';
import {HORIZONS} from '@/features/vnext/contracts';
import type {Horizon} from '@/features/vnext/contracts';
import {FAMILY_LABELS,verifyResearchLock} from '@/features/vnext/realResearch';
import type {RealResearchReport,ResearchCard} from '@/features/vnext/realResearch';
import {validFoundation} from '@/features/vnext/foundation';
import type {FoundationSummary} from '@/features/vnext/foundation';
import Foundation from './Foundation';
import PublicationReadiness from './PublicationReadiness';
import ResearchFunnel from './ResearchFunnel';
import {verifyFunnel,type ResearchFunnel as Funnel} from '@/features/vnext/researchFunnel';
import {validPublicationReadiness,type PublicationReadiness as Readiness} from '@/features/vnext/publicationReadiness';
import './vnext.css';

const labels={SHORT:'短期機會',MEDIUM:'中期機會',LONG:'長期機會'};
const stamp=(value:string|null)=>value?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(value)):'未保存，不能代填';
function RealCard({card}:{card:ResearchCard}){
 return <article className="vnext-card"><div className="vnext-card-top"><span>{HORIZONS[card.horizon].duration}</span><span className="vnext-status">{card.status==='INSUFFICIENT_EVIDENCE'?'暫時無法可靠判斷':'值得觀察，等待確認'}</span></div>
  <h3>{card.company}<small>{card.symbol}</small></h3><p>{card.reason}</p>
  <h4>目前知道什麼？</h4>{card.known.length?<ul>{card.known.map(s=><li key={s}>{s}</li>)}</ul>:<p>目前沒有足夠的可用資料，不能推測公司狀況。</p>}
  <h4>什麼條件成立才開始考慮？</h4><p>{card.confirmation}</p>
  <section className="vnext-risk"><h4>什麼情況代表判斷失效？</h4><p>{card.invalidation}</p></section>
  <h4>下次何時重新評估？</h4><p>{card.next_review}</p>
  <details><summary>為什麼目前還不能成立？（{card.gaps.length}項資料缺口）</summary><ul>{card.gaps.map(g=><li key={g}>{g}</li>)}</ul></details>
  <details><summary>查看證據與技術詳細資料（{card.evidence.length}）</summary>{card.evidence.map(e=><section key={e.id}>
   <h4>{FAMILY_LABELS[e.kind]}</h4><p>{e.summary}</p><a href={e.source} target="_blank" rel="noreferrer">查看資料來源</a>
   <dl><div><dt>原始發布時間</dt><dd>{stamp(e.published_at)}</dd></div><div><dt>首次取得時間</dt><dd>{stamp(e.first_seen_at)}</dd></div><div><dt>可取得時間</dt><dd>{stamp(e.available_at)}</dd></div><div><dt>資料時間</dt><dd>{stamp(e.as_of)}</dd></div></dl>
   <small>原始期間：{e.period??'未保存'}<br/>證據指紋：{e.evidence_hash}</small></section>)}<p>精確拒絕原因：{card.technical_gaps.join('、')}</p></details>
  <p className="vnext-disclaimer">歷史研究，不是正式推薦。證據不足時，不應把參考位置當成買賣指令。</p>
 </article>;
}
export function RealResearchWorkspace({reports,foundation,publication,funnel}:{reports:RealResearchReport[];foundation?:FoundationSummary;publication?:Readiness;funnel?:Funnel}){
 const [date,setDate]=useState(reports.at(-1)!.business_date),[horizon,setHorizon]=useState<Horizon>('SHORT'),[query,setQuery]=useState(''),[limit,setLimit]=useState(6),[area,setArea]=useState('stocks');
 const report=reports.find(r=>r.business_date===date)!,all=report.cards.filter(c=>c.horizon===horizon).sort((a,b)=>a.symbol.localeCompare(b.symbol)),cards=all.filter(c=>c.symbol.includes(query.trim())||c.company.includes(query.trim()));
 const events=[...new Map(report.events.map(e=>[e.id+':'+e.symbol,e])).values()];
 return <main className="vnext"><a className="vnext-skip" href="#real-research">跳至主要內容</a>
  <header className="vnext-header"><a className="vnext-brand" href="/vnext">MORNING ALPHA<span>有依據，才有判斷</span></a><span>僅供 Owner 研究 · 不提供會員</span></header>
  <nav className="vnext-navigation" aria-label="研究頁面"><button aria-current={area==='stocks'?'page':undefined} onClick={()=>setArea('stocks')}>股票觀察</button><button aria-current={area==='events'?'page':undefined} onClick={()=>setArea('events')}>事件與公司關係</button></nav>
  <div id="real-research" className="vnext-content">{funnel?<ResearchFunnel data={funnel}/>:publication?<PublicationReadiness data={publication}/>:null}<div className="vnext-intro"><p className="vnext-eyebrow">以下保留舊版歷史研究 · 尚未證明投資成效</p><h2>查看原截止時間的研究紀錄</h2>
   <p>目前查看 {date} 的歷史研究，不是今天的即時買點。先分清楚已知事實、等待條件與缺失資料。</p>{foundation?<a href="#foundation">查看本次新取得資料與剩餘缺口</a>:null}</div>
   <div className="vnext-real-controls"><label>查看保存日期<select value={date} onChange={e=>{setDate(e.target.value);setLimit(6);}}>{reports.map(r=><option key={r.business_date}>{r.business_date}</option>)}</select></label><p>只使用當時已取得的資料<br/>原始截止：{stamp(report.cutoff)}（台北時間）</p></div>
   {area==='stocks'?<><div className="vnext-horizons" role="group" aria-label="研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>{setHorizon(h);setLimit(6);}}><strong>{labels[h]}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
    <section className="vnext-risk" role="status"><h2>{report.counts[horizon].qualified?`${report.counts[horizon].qualified}檔待確認`:'目前沒有足夠證據成立的候選'}</h2><p>已檢查 {report.universe} 檔。{report.counts[horizon].insufficient} 檔資料仍不足；這不代表市場沒有機會，也不表示這些股票都不值得研究。</p><p>{horizon==='SHORT'?'量價與法人紀錄可讀，但原始發布時間、完整公司消息與確認結構仍有缺口。':horizon==='MEDIUM'?'單月營收與單日法人不能替代訂單、展望或連續趨勢；目前無法判定啟動、回檔或過熱。':'一份獲利實績不能證明需求持續、競爭優勢或估值合理；長期資料仍需補齊。'}</p></section>
    <div className="vnext-real-controls"><label>查股票名稱或代號<input value={query} onChange={e=>{setQuery(e.target.value);setLimit(6);}} placeholder="例如：台積電或2330"/></label><p>下方為資料檢查結果，依股票代號排列，不是推薦排名。</p></div>
    <div className="vnext-grid">{cards.slice(0,limit).map(c=><RealCard key={date+c.horizon+c.symbol} card={c}/>)}</div>
    {!cards.length&&<p className="vnext-empty">保存的72檔範圍沒有符合查詢的股票，不會臨時補造標的。</p>}
    {limit<cards.length&&<button className="vnext-primary" onClick={()=>setLimit(v=>v+6)}>再看6檔（已顯示{Math.min(limit,cards.length)}／{cards.length}）</button>}
   </>:<><section className="vnext-risk"><h2>公告存在，不等於公司受惠</h2><p>保存了 {events.length} 筆官方事件識別與時間，但此最小資料不含公告標題、內文及影響分析。因此不能推論影響哪些產業，或受惠／受損方向。</p></section>
    <div className="vnext-grid">{events.map(e=><article key={e.id+e.symbol} className="vnext-card"><h3>{report.cards.find(c=>c.symbol===e.symbol)?.company??e.symbol}<small>{e.symbol}</small></h3><p>已保存官方重大公告紀錄；內容與產業影響尚待查證。</p><p>何時再驗證：取得對應公告內文，再核對訂單、營收與獲利，不自動判定為利多。</p><details><summary>查看事件來源與時間</summary><a href={e.source} target="_blank" rel="noreferrer">官方公告資料來源</a><p>發布：{stamp(e.published_at)}<br/>可取得：{stamp(e.available_at)}</p><small>事件指紋：{e.evidence_hash}</small></details></article>)}</div>
    <section className="vnext-empty"><h2>公司之間的供應鏈，暫時無法確認</h2><p>同產業不等於客戶或供應商。沒有公司間可追溯關係證據時，不會畫出猜測的上中下游。</p><p>需求 → 訂單 → 營收 → 獲利 → 股價，每一步都需獨立證據。</p></section></>}
   {foundation?<Foundation data={foundation}/>:null}
   <aside className="vnext-footnote"><p>歷史重播：{reports.length}日。事前驗證樣本：0；已完成成效：0。<br/>目前樣本不足，尚不能判定分析有效。沒有啟用自然研究排程或下單。</p></aside>
   <details><summary>查看研究版本與鎖定紀錄</summary><p>HISTORICAL_REPLAY / NOT_FORWARD</p><p>版本：{report.version}<br/>輸入指紋：{report.input_hash}<br/>研究指紋：{report.snapshot_hash}<br/>原資料鎖定：{stamp(report.source_lock_at)}</p><p>公司名稱來自目前正式代號對照，僅作顯示，不是當時全市場或存活股票證明。</p></details>
  </div></main>;
}
export default function RealResearchPage(){
 const {access,retry}=useAcademyAccess();
 const [state,setState]=useState<{id:string;generation:number;reports?:RealResearchReport[];foundation?:FoundationSummary;publication?:Readiness;funnel?:Funnel;error?:boolean}|null>(null);
 useEffect(()=>{
  setState(null);if(access.kind!=='member'||access.catalog.tier!=='owner')return;
  let live=true;const controller=new AbortController(),abort=()=>controller.abort();access.signal.addEventListener('abort',abort);
  const timer=setTimeout(()=>{controller.abort();if(live&&!access.signal.aborted)setState({id:access.id,generation:access.generation,error:true});},15000);
  void(async()=>{try{
   const {data}=await supabase.auth.getSession();if(!data.session)throw Error('NO_SESSION');
   const r=await fetch('/__vnext_owner_research',{headers:{Authorization:'Bearer '+data.session.access_token},signal:controller.signal,cache:'no-store'});
   if(!r.ok)throw Error('READ_DENIED');const body=await r.json();
   if(body.schema!=='VNEXT_REAL_RESEARCH_RESPONSE_V1'||body.member_publication!==false||!Array.isArray(body.reports)||body.reports.length!==2)throw Error('INVALID_RESPONSE');
   for(const report of body.reports)if(report.owner_only!==true||report.mode!=='HISTORICAL_REPLAY'||!await verifyResearchLock(report))throw Error('LOCK_INVALID');
   if(body.foundation&&!validFoundation(body.foundation))throw Error('FOUNDATION_INVALID');
   if(body.publication&&!validPublicationReadiness(body.publication))throw Error('PUBLICATION_INVALID');
   if(body.funnel&&!await verifyFunnel(body.funnel))throw Error('FUNNEL_INVALID');
   if(live&&!controller.signal.aborted&&!access.signal.aborted)setState({id:access.id,generation:access.generation,reports:body.reports,foundation:body.foundation,publication:body.publication,funnel:body.funnel});
  }catch{if(live&&!controller.signal.aborted&&!access.signal.aborted)setState({id:access.id,generation:access.generation,error:true});}finally{clearTimeout(timer);}})();
  return()=>{live=false;clearTimeout(timer);controller.abort();access.signal.removeEventListener('abort',abort);};
 },[access]);
 if(access.kind==='member'&&access.catalog.tier==='owner'&&state?.id===access.id&&state.generation===access.generation&&state.reports&&!access.signal.aborted)return <RealResearchWorkspace reports={state.reports} foundation={state.foundation} publication={state.publication} funnel={state.funnel}/>;
 const denied=access.kind==='denied'||access.kind==='member'&&access.catalog.tier!=='owner',failed=state?.error||access.kind==='unavailable';
 return <main className="vnext"><section className="vnext-content vnext-empty" role="status"><h1>{denied?'此頁僅供 Owner 研究':failed?'暫時無法讀取保存證據':'正在確認研究閱讀權限'}</h1><p>{denied?'一般會員與進階會員不能讀取本輪尚未核准的研究資料。':'未讀取成功不會顯示範例或假成功結果。'}</p>{denied?<a className="vnext-primary" href="/login">登入研究帳號</a>:failed?<button className="vnext-primary" onClick={retry}>重新讀取</button>:null}</section></main>;
}
