import {useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from '@/lib/supabase';
import {useAcademyAccess,type AcademyAccess} from '../academy/useAcademyAccess';
import {HORIZONS} from '@/features/vnext/contracts';
import {type DailyAiMarketCardV2} from '@/features/vnext/dailyAiMarketPageV2';
import {MARKET_REVIEW_KINDS,MARKET_REVIEW_LABELS,OwnerMarketError,clearOwnerMarketCommand,createOwnerMarketCommand,
 loadOwnerMarketCommand,ownerMarketPublished,ownerMarketReady,parseOwnerMarketCatalog,parseOwnerMarketCommandReceipt,
 parseOwnerMarketInput,parseOwnerMarketMutationReceipt,parseOwnerMarketPage,parseOwnerMarketReferences,parseOwnerMarketSearch,normalizeOwnerMarketSearch,persistOwnerMarketCommand,prepareOwnerMarketSubmission,
 type MarketReviewKind,type MarketReviewStatus,type OwnerMarketCatalog,type OwnerMarketCatalogCursor,type OwnerMarketCommand,
 type OwnerMarketInput,type OwnerMarketPage,type OwnerMarketReference,type OwnerMarketScope,type OwnerMarketSearch} from '@/features/vnext/dailyAiMarketOwner';
import MemberNavigation from './MemberNavigation';
import './member.css';
import './owner-market-review.css';

type RpcError={code?:string;message?:string};
type Draft=Record<MarketReviewKind,{status:MarketReviewStatus|'';document_url:string;notes:string}>;
const blankDraft=():Draft=>Object.fromEntries(MARKET_REVIEW_KINDS.map(k=>[k,{status:'',document_url:'',notes:''}]))as Draft;
const PAGE_SIZE=30;
const statusLabel={PASS:'通過',FAIL:'不通過',PENDING:'待補件'};
const marketLabel={TWSE:'上市',TPEX:'上櫃',EMERGING:'興櫃'};
const cardStatus={WATCH:'持續觀察',WAIT:'等待條件',AVOID:'暫避',INSUFFICIENT:'資料不足'};
const timestamp=(v:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v));
const money=(v:number)=>'NT$'+new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(v);
const referenceTitle=(h:string)=>h==='SHORT'?'歷史未還原價格區間':h==='LONG'?'品質條件相同同業 P/B 參考':'同業估值參考';
const rejection=(error:RpcError)=>error.code==='42501'||error.code==='P0001'&&/^MARKET_[A-Z_]+$/.test(error.message??'');
function failure(error:unknown):string{
 const e=error as RpcError;
 if(e.code==='42501')return 'Owner 權限已失效，請重新驗證登入。';
 if(e.message==='AI_MARKET_OWNER_DISABLED')return '全市場審查入口已暫停；既有資料仍保留，待確認請求可繼續讀回。';
 if(e.message==='MARKET_PUBLICATION_NOT_READY')return '版本尚未符合四項審查、來源使用權或有效期間，資料庫未核准會員閱讀。';
 if(e.message==='MARKET_REVIEW_SUPERSEDED')return '已有較新的審查，請更新版本內容後再操作。';
 if(e.message==='MARKET_REVIEW_EXPIRED')return '這個版本已到期，無法再提交審查。';
 if(error instanceof OwnerMarketError)return '資料的身分、時間或原文雜湊未通過核對，明細暫不可用。';
 return '讀取暫時未完成，請使用重新讀取。';
}
async function callRpc(name:string,args:Record<string,unknown>,parent:AbortSignal,controllers:Set<AbortController>,timeout=10000){
 const controller=new AbortController();controllers.add(controller);let timer:ReturnType<typeof setTimeout>|undefined;
 let cancel:()=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(Error('OWNER_REQUEST_CANCELLED')),{once:true});cancel=()=>{controller.abort();};parent.addEventListener('abort',cancel,{once:true});
  if(parent.aborted)cancel();timer=setTimeout(()=>{controller.abort();reject(Error('OWNER_REQUEST_TIMEOUT'));},timeout);});
 try{return await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)throw Error('OWNER_REQUEST_CANCELLED');return supabase.rpc(name,args).abortSignal(controller.signal);}),stopped]);}
 finally{clearTimeout(timer);parent.removeEventListener('abort',cancel);controllers.delete(controller);}
}

export default function OwnerMarketReview(){const {access,retry}=useAcademyAccess();return <OwnerMarketReviewContent access={access} retry={retry}/>;}
export function OwnerMarketReviewContent({access,retry}:{access:AcademyAccess;retry:()=>void}){
 const identity=access.kind==='member'?access.id:null,generation=access.kind==='member'?access.generation:-1,signal=access.kind==='member'?access.signal:null;
 const allowed=access.kind==='member'&&access.catalog.tier==='owner'&&!access.signal.aborted;
 const auth=useRef(access);auth.current=access;
 const live=useRef(false),epoch=useRef(0),controllers=useRef(new Set<AbortController>()),requests=useRef({catalog:0,page:0,detail:0,search:0});
 const searchAbort=useRef<AbortController|null>(null);
 const currentPage=useRef<OwnerMarketPage|null>(null),pending=useRef<OwnerMarketCommand|null>(null),writeBusy=useRef(false);
 const [catalog,setCatalog]=useState<OwnerMarketCatalog|null>(null),[page,setPage]=useState<OwnerMarketPage|null>(null);
 const [viewKey,setViewKey]=useState(''),[loading,setLoading]=useState(''),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false);
 const [detail,setDetail]=useState<{input:OwnerMarketInput;references:readonly OwnerMarketReference[]}|null>(null),[detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const [command,setCommand]=useState<OwnerMarketCommand|null>(null),[commandBusy,setCommandBusy]=useState(false),[journalError,setJournalError]=useState(false);
 const [draft,setDraft]=useState<Draft>(blankDraft),[reason,setReason]=useState(''),[audience,setAudience]=useState<''|'free'|'premium'>('');
 const [visible,setVisible]=useState(9),[now,setNow]=useState(Date.now());
 const [stockQuery,setStockQuery]=useState(''),[search,setSearch]=useState<OwnerMarketSearch|null>(null),[searchLoading,setSearchLoading]=useState(false),[searchError,setSearchError]=useState('');
 const scope=():OwnerMarketScope|null=>{const a=auth.current;return live.current&&a.kind==='member'&&a.catalog.tier==='owner'&&!a.signal.aborted?{identity:a.id,generation:a.generation,signal:a.signal,tier:'owner'}:null;};
 const valid=(s:OwnerMarketScope,run:number)=>{const a=scope();return !!a&&run===epoch.current&&a.identity===s.identity&&a.generation===s.generation&&a.signal===s.signal;};
 const clearSearch=()=>{++requests.current.search;searchAbort.current?.abort();searchAbort.current=null;setSearch(null);setSearchError('');setSearchLoading(false);};
 const denied=()=>{clearSearch();setBlocked(true);currentPage.current=null;setPage(null);setDetail(null);retry();};
 async function loadPage(id:string,start=0){
  const s=scope();if(!s)return;const run=epoch.current,token=++requests.current.page;++requests.current.detail;
  clearSearch();setStockQuery('');currentPage.current=null;setPage(null);setDetail(null);setDetailError('');setDetailLoading(false);setLoading('page');setVisible(9);setDraft(blankDraft());setReason('');setAudience('');
  try{const result=await callRpc('get_daily_ai_owner_market_page_v2',{p_edition_id:id,p_offset:start,p_limit:PAGE_SIZE},s.signal,controllers.current);
   if(result.error)throw result.error;const parsed=await parseOwnerMarketPage(result.data,s,{edition_id:id,start,limit:PAGE_SIZE});
   if(!valid(s,run)||token!==requests.current.page)return;currentPage.current=parsed;setPage(parsed);setNow(Date.now());
  }catch(error){if(valid(s,run)&&token===requests.current.page){setMessage(failure(error));if((error as RpcError).code==='42501')denied();}}
  finally{if(valid(s,run)&&token===requests.current.page)setLoading('');}
 }
 async function loadCatalog(cursor:OwnerMarketCatalogCursor|null=null){
  const s=scope();if(!s)return;const run=epoch.current,token=++requests.current.catalog;setLoading('catalog');setMessage('');
  clearSearch();setStockQuery('');++requests.current.page;++requests.current.detail;currentPage.current=null;setPage(null);setDetail(null);setDetailError('');setDetailLoading(false);
  try{const result=await callRpc('get_daily_ai_owner_market_catalog_v2',{p_before:cursor,p_limit:20},s.signal,controllers.current);
   if(result.error)throw result.error;const parsed=parseOwnerMarketCatalog(result.data,s);
   if(!valid(s,run)||token!==requests.current.catalog)return;setCatalog(parsed);setLoading('');
   if(!cursor&&parsed.editions[0])void loadPage(parsed.editions[0].id);
  }catch(error){if(valid(s,run)&&token===requests.current.catalog){setLoading('');setMessage(failure(error));if((error as RpcError).code==='42501')denied();}}
 }
 async function loadDetail(id:string){
  const s=scope(),p=currentPage.current;if(!s||!p)return;const run=epoch.current,token=++requests.current.detail;
  setDetail(null);setDetailError('');setDetailLoading(true);
  try{const [packet,refs]=await Promise.all([
   callRpc('get_daily_ai_owner_market_input_v2',{p_edition_id:p.edition.id,p_security_id:id},s.signal,controllers.current),
   callRpc('get_daily_ai_owner_market_references_v2',{p_plan_hash:p.edition.plan_hash,p_security_id:id},s.signal,controllers.current)
  ]);if(packet.error)throw packet.error;if(refs.error)throw refs.error;
   const input=await parseOwnerMarketInput(packet.data,s,p,id),references=await parseOwnerMarketReferences(refs.data,s,p,input);
   if(valid(s,run)&&token===requests.current.detail&&currentPage.current===p)setDetail({input,references});
  }catch(error){if(valid(s,run)&&token===requests.current.detail){setDetailError(failure(error));if((error as RpcError).code==='42501')denied();}}
  finally{if(valid(s,run)&&token===requests.current.detail)setDetailLoading(false);}
 }
 async function findStock(event:FormEvent){
  event.preventDefault();const s=scope(),p=currentPage.current;if(!s||!p)return;
  clearSearch();let query:string;try{query=normalizeOwnerMarketSearch(stockQuery);}catch{setSearchError('請輸入 1～80 字的股票代號、簡稱或公司全名；不支援萬用字元或控制字元。');return;}
  const run=epoch.current,token=++requests.current.search,controller=new AbortController();searchAbort.current=controller;
  const cancel=()=>controller.abort();s.signal.addEventListener('abort',cancel,{once:true});setSearchLoading(true);
  try{const result=await callRpc('get_daily_ai_owner_market_search_v2',{p_edition_id:p.edition.id,p_query:query,p_limit:20},controller.signal,controllers.current);
   if(result.error)throw result.error;const parsed=parseOwnerMarketSearch(result.data,s,{edition_id:p.edition.id,query,limit:20},Date.now());
   if(valid(s,run)&&token===requests.current.search&&currentPage.current===p)setSearch(parsed);
  }catch(error){if(valid(s,run)&&token===requests.current.search&&currentPage.current===p){setSearchError('公司搜尋暫不可用，請稍後重新搜尋。');if((error as RpcError).code==='42501')denied();}}
  finally{s.signal.removeEventListener('abort',cancel);if(searchAbort.current===controller)searchAbort.current=null;if(valid(s,run)&&token===requests.current.search)setSearchLoading(false);}
 }
 useEffect(()=>{
  live.current=true;const run=++epoch.current,inflight=controllers.current;for(const c of inflight)c.abort();inflight.clear();requests.current={catalog:0,page:0,detail:0,search:0};
  searchAbort.current?.abort();searchAbort.current=null;setStockQuery('');setSearch(null);setSearchError('');setSearchLoading(false);
  currentPage.current=null;pending.current=null;writeBusy.current=false;setPage(null);setCatalog(null);setDetail(null);setCommand(null);setCommandBusy(false);setJournalError(false);setBlocked(false);setMessage('');
  setViewKey(allowed?identity+':'+generation:'');setDraft(blankDraft());setReason('');setAudience('');setDetailError('');setDetailLoading(false);
  if(allowed&&identity&&signal){
   try{const saved=loadOwnerMarketCommand(window.sessionStorage,identity);pending.current=saved;setCommand(saved);if(saved)setMessage('上次請求尚待確認。請先讀回執行結果；系統不會自動重送。');}
   catch{setJournalError(true);setMessage('本機請求紀錄無法讀取，已停止寫入。重新載入前請先確認先前操作結果。');}
   void loadCatalog();
  }
  const interval=setInterval(()=>{if(live.current)setNow(Date.now());},1000);
  return()=>{live.current=false;epoch.current=run+1;for(const c of inflight)c.abort();inflight.clear();clearInterval(interval);};
  // This lifecycle is keyed only to the verified Auth generation. Read helpers
  // deliberately use refs so a normal React render cannot start another RPC.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[identity,generation,signal,allowed]);
 const finishCommand=(c:OwnerMarketCommand)=>{clearOwnerMarketCommand(window.sessionStorage,c);pending.current=null;setCommand(null);};
 async function mutate(kind:'REVIEW'|'APPROVE'|'REVOKE'){
  const s=scope(),p=currentPage.current;if(!s||!p||pending.current||writeBusy.current||journalError||blocked)return;
  if(kind==='REVIEW'&&Date.parse(p.edition.expires_at)<=Date.now()||kind==='APPROVE'&&!ownerMarketReady(p)||kind!=='REVIEW'&&(!p.review||!audience))return;
  const run=epoch.current;writeBusy.current=true;setCommandBusy(true);setMessage('');let c:OwnerMarketCommand|null=null;
  try{
   const body=kind==='REVIEW'?prepareOwnerMarketSubmission({schema:'DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1',edition_id:p.edition.id,reason,
    documents:MARKET_REVIEW_KINDS.map(k=>({kind:k,...draft[k]}))},p.edition.id):{edition_id:p.edition.id,review_id:p.review!.id,action:kind,audience};
   c=await createOwnerMarketCommand(s,kind,p.edition.id,body);if(!valid(s,run))return;
   try{persistOwnerMarketCommand(window.sessionStorage,c);}catch{setJournalError(true);setMessage('無法保存唯一請求識別碼，尚未送出操作。');return;}
   pending.current=c;setCommand(c);
   const result=await callRpc(kind==='REVIEW'?'submit_daily_ai_owner_market_review_v2':'review_daily_ai_market_edition_v2',kind==='REVIEW'
    ?{p_edition_id:p.edition.id,p_request_key:c.request_key,p_submission:body}
    :{p_edition_id:p.edition.id,p_review_id:p.review!.id,p_action:kind,p_audience:audience,p_request_key:c.request_key},s.signal,controllers.current,15000);
   if(!valid(s,run))return;
   if(result.error){if(rejection(result.error)){finishCommand(c);setMessage(failure(result.error));if(result.error.code==='42501')denied();else void loadPage(p.edition.id,p.start);return;}throw result.error;}
   await parseOwnerMarketMutationReceipt(result.data,s,c);if(!valid(s,run))return;finishCommand(c);
   setMessage(kind==='REVIEW'?'四項審查已保存；會員閱讀仍需另外核准。':kind==='APPROVE'?'會員閱讀核准已由資料庫記錄。':'會員閱讀撤回已由資料庫記錄。');void loadPage(p.edition.id,p.start);
  }catch(error){if(valid(s,run))setMessage(c&&pending.current?'操作結果待確認。請讀回同一請求的資料庫紀錄；不要重送或重新核准。':error instanceof OwnerMarketError?'請為四項審查各自選擇判斷，填寫 HTTPS 文件網址及至少 10 字說明，並填寫整體審查說明。':failure(error));}
  finally{if(valid(s,run)){writeBusy.current=false;setCommandBusy(false);}}
 }
 async function reconcile(){
  const s=scope(),c=pending.current;if(!s||!c||writeBusy.current)return;const run=epoch.current;writeBusy.current=true;setCommandBusy(true);
  try{const response=await callRpc('get_daily_ai_owner_market_command_v2',{p_request_key:c.request_key},s.signal,controllers.current);
   if(response.error)throw response.error;const receipt=await parseOwnerMarketCommandReceipt(response.data,s,c);if(!valid(s,run))return;
   if(receipt.state==='NOT_RECORDED'){setMessage('目前尚未讀到這筆請求，仍不能判定是否失敗。保留同一識別碼，稍後再讀回；不會自動重送。');return;}
   finishCommand(c);setMessage(c.kind==='REVIEW'?'已確認四項審查保存；尚未因此發布會員內容。':c.kind==='APPROVE'?'已讀回資料庫的核准紀錄。':'已讀回資料庫的撤回紀錄。');void loadPage(c.edition_id);
  }catch(error){if(valid(s,run)){setMessage('結果仍待確認；原請求識別碼已保留。'+failure(error));if((error as RpcError).code==='42501')denied();}}
  finally{if(valid(s,run)){writeBusy.current=false;setCommandBusy(false);}}
 }
 const current=allowed&&viewKey===identity+':'+generation&&!blocked;
 if(!current)return <div className="vnext vm"><MemberNavigation/><main className="vnext-content om-review"><h1>全市場研究審查</h1>
  {access.kind==='loading'||allowed&&!blocked?<p role="status">正在確認 Owner 權限…</p>:<><p>{access.kind==='unavailable'?'目前無法確認 Owner 權限。':'此入口限 Owner 使用，私有版本與審查資料已隱藏。'}</p><button onClick={retry}>重新驗證權限</button><a href="/stocks">返回股票研究</a></>}</main></div>;
 const busy=!!loading||commandBusy,writeLocked=busy||!!command||journalError;
 const update=(kind:MarketReviewKind,field:keyof Draft[MarketReviewKind],value:string)=>setDraft(previous=>({...previous,[kind]:{...previous[kind],[field]:value}}));
 const submit=(event:FormEvent)=>{event.preventDefault();void mutate('REVIEW');};
 return <div className="vnext vm"><a className="vnext-skip" href="#market-owner-main">跳到全市場審查</a><MemberNavigation/>
  <main id="market-owner-main" className="vnext-content om-review"><header><p className="om-eyebrow">Owner 私有工作區</p><h1>全市場研究審查</h1>
   <p>先檢視原始依據與計算，再儲存四項人工審查，最後決定會員閱讀。未核准內容只在這個工作區顯示。</p>
   <nav aria-label="研究工作區"><a href="/stocks">會員股票研究</a><a href="/stocks/review">個人股票檢討</a></nav></header>
   {message&&<p className="om-message" role="status">{message}</p>}
   {command&&<section className="om-pending" aria-label="待確認請求"><h2>請求結果待確認</h2><p>操作：{command.kind==='REVIEW'?'儲存四項審查':command.kind==='APPROVE'?'核准會員閱讀':'撤回會員閱讀'} · {timestamp(command.created_at)}</p>
    <p>未取得確定回覆前，暫停新的寫入。讀回結果只查資料庫，不重送原操作。</p><label>唯一請求識別碼<input readOnly value={command.request_key}/></label>
    <button disabled={commandBusy} onClick={()=>void reconcile()}>讀回原請求結果</button></section>}
   <section aria-label="待審版本"><div className="om-section-heading"><h2>選擇研究版本</h2><button disabled={busy} onClick={()=>void loadCatalog()}>重新讀取最新版本</button></div>
    {loading==='catalog'&&<p role="status">讀取私有版本清單…</p>}
    {catalog?.editions.length===0&&<p>目前沒有已完成分析並封存的全市場版本。</p>}
    {!!catalog?.editions.length&&<><label>私有版本<select value={page?.edition.id??''} disabled={busy} onChange={e=>void loadPage(e.target.value)}><option value="" disabled>選擇版本</option>
     {catalog.editions.map(e=><option key={e.id} value={e.id}>{e.edition_date} · {timestamp(e.prepared_at)}{Date.parse(e.expires_at)<=now?' · 已到期':''}</option>)}</select></label>
     {catalog.next_cursor&&<button disabled={busy} onClick={()=>void loadCatalog(catalog.next_cursor)}>讀取更早 20 個版本</button>}</>}
   </section>
   {loading==='page'&&<p role="status">讀取此版本的分頁卡片與審查依據…</p>}
   {page&&<><section aria-label="版本範圍"><div className="om-section-heading"><h2>{page.edition.edition_date} 全市場版本</h2><strong>{ownerMarketPublished(page,now)?'會員閱讀已核准':Date.parse(page.edition.expires_at)<=now?'版本已到期':'尚未供會員閱讀'}</strong></div>
    <p>規則式資料篩選 · 資料截點 {timestamp(page.edition.evidence_cutoff)} · 版本形成 {timestamp(page.edition.prepared_at)} · 到期 {timestamp(page.edition.expires_at)}</p>
    <p>名單納入 {page.coverage.reduce((n,m)=>n+m.universe_count,0).toLocaleString()} 檔；已保存分析 {page.coverage.reduce((n,m)=>n+m.analysed_count,0).toLocaleString()} 檔／{page.total.toLocaleString()} 張卡片。保存分析不代表審查通過。</p>
    <div className="om-table-scroll"><table><caption>各市場資料涵蓋與實際更新日</caption><thead><tr><th>市場</th><th>名單／分析</th><th>名單日期</th><th>最新行情日期</th><th>財務資料取得</th></tr></thead>
     <tbody>{page.coverage.map(m=><tr key={m.market}><th>{marketLabel[m.market]}</th><td>{m.universe_count}／{m.analysed_count}</td><td>{m.roster_as_of??'未知'}</td><td>{m.price_date??'無可用行情'}</td><td>{m.financial_available_at?timestamp(m.financial_available_at):'無可用來源'}</td></tr>)}</tbody></table></div>
    <p>來源使用權：{page.source_use.approved}／{page.source_use.total} 個來源符合既有記錄。{!page.rights_ready&&' 未完成時，即使四項審查全為通過，仍無法核准會員閱讀。'}</p>
    {!!page.source_use.blocked_sources.length&&<details><summary>尚缺使用依據的來源{page.source_use.total-page.source_use.approved>20?'（先列 20 個）':''}</summary><ul>{page.source_use.blocked_sources.map(url=><li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></details>}
   </section>
   <section aria-label="現有審查"><h2>四項審查與發布紀錄</h2>{!page.review?<p>尚未提交人工審查。</p>:<><div className="om-review-grid">{MARKET_REVIEW_KINDS.map(k=><div key={k}><h3>{MARKET_REVIEW_LABELS[k]}</h3><strong>{statusLabel[page.review!.statuses[k]]}</strong>
    {page.review!.documents.filter(d=>d.kind===k).map(d=><details key={d.hash}><summary>查看保留的審查文件</summary>{d.url&&<a href={d.url} target="_blank" rel="noreferrer">開啟原審查文件</a>}{d.notes&&<p>{d.notes}</p>}<pre>{d.text}</pre></details>)}</div>)}</div>
    <p>{page.review.reason}</p><p>審查者：{page.review.reviewer_ref} · 有效至 {timestamp(page.review.expires_at)}</p></>}
    {page.publication&&<p>最新發布操作：{page.publication.action==='APPROVE'?'核准':'撤回'} · {page.publication.audience==='premium'?'付費會員':'免費摘要與付費內容'}{page.publication.review_id!==page.review?.id?' · 已有新審查，舊核准不再適用':''}</p>}
   </section>
   <section aria-label="全市場卡片分頁"><div className="om-section-heading"><h2>選股理由與已計算參考</h2><span>第 {page.start+1}～{page.start+page.cards.length} 張，共 {page.total.toLocaleString()} 張</span></div>
    <form className="om-stock-search" aria-label="搜尋本版全市場公司" onSubmit={event=>void findStock(event)}>
     <label>股票代號或公司名稱<input name="owner-stock-query" type="search" value={stockQuery} maxLength={80} placeholder="例如 2330、台積電或公司全名" required
      onChange={event=>{clearSearch();setStockQuery(event.target.value);}}/></label><button disabled={searchLoading}>搜尋公司</button></form>
    {searchLoading&&<p role="status">搜尋此版本的上市、上櫃與興櫃名單…</p>}{searchError&&<p role="alert">{searchError}</p>}
    {search&&<div className="om-search-results" aria-label="公司搜尋結果"><p>{search.companies.length?`找到 ${search.companies.length} 家公司，選擇後查看單檔原件與計算。`:'此版本沒有符合的公司。'}{search.has_more&&' 還有其他符合公司，請輸入更完整的名稱。'}</p>
     <ul>{search.companies.map(company=><li key={company.security_id}><button type="button" disabled={detailLoading}
      onClick={()=>void loadDetail(company.security_id)}>{company.symbol} {company.short_name} · {marketLabel[company.market]}</button><span>{company.company}</span></li>)}</ul></div>}
    <div className="om-card-grid">{page.cards.slice(0,visible).map(card=><PreviewCard key={card.market+card.symbol+card.horizon} card={card} open={()=>void loadDetail(card.market+':'+card.symbol)}/>)}</div>
    {visible<page.cards.length&&<button onClick={()=>setVisible(n=>Math.min(n+9,PAGE_SIZE))}>再展開 9 張</button>}
    <div className="om-actions"><button disabled={busy||page.start===0} onClick={()=>void loadPage(page.edition.id,Math.max(0,page.start-PAGE_SIZE))}>上一頁</button>
     <button disabled={busy||page.start+page.cards.length>=page.total} onClick={()=>void loadPage(page.edition.id,page.start+PAGE_SIZE)}>下一頁</button></div>
   </section>
   {(detailLoading||detailError||detail)&&<section aria-label="單檔原始依據"><h2>單檔原始依據與方法</h2>{detailLoading&&<p role="status">核對此股票的原文、雜湊與價格計算…</p>}{detailError&&<p role="alert">{detailError}</p>}
    {detail&&<><h3>{detail.input.security_id} {detail.input.company}</h3><p>資料日 {detail.input.data_through} · 已核對同股票、同版本的 packet 與分析原文。</p>
     {!detail.references.length&&<p>這個股票尚無已保存的估值參考；不以空值推定為可買。</p>}
     {detail.references.map(ref=><ReferenceDetails key={ref.horizon} value={ref}/>)}
     <details><summary>原始資料引用（{detail.input.evidence.length} 筆）</summary>{detail.input.evidence.map(e=><details key={e.id}><summary>{e.kind} · {timestamp(e.available_at)}</summary>
      <a href={e.source} target="_blank" rel="noreferrer">開啟原來源</a><p>首次取得 {timestamp(e.first_seen_at)} · 內容時點 {timestamp(e.as_of)}</p><pre>{e.content}</pre></details>)}</details>
     <details><summary>核對識別碼</summary><label>輸入原文雜湊<input readOnly value={detail.input.packet_hash}/></label><label>分析原文雜湊<input readOnly value={detail.input.analysis_hash}/></label></details>
    </>}
   </section>}
   <section aria-label="人工審查提交"><h2>儲存人工審查</h2><p>四項都需親自選擇判斷，提供實際文件網址及說明。這個操作只保存審查；不會新增來源授權或自動發布。</p>
    <form onSubmit={submit}><fieldset disabled={writeLocked||Date.parse(page.edition.expires_at)<=now}><legend>本次四項判斷</legend>
     <div className="om-review-grid">{MARKET_REVIEW_KINDS.map(k=><fieldset key={k}><legend>{MARKET_REVIEW_LABELS[k]}</legend>
      <label>判斷<select name={k+'-status'} required value={draft[k].status} onChange={e=>update(k,'status',e.target.value)}><option value="" disabled>請選擇本次判斷</option><option value="PASS">通過</option><option value="FAIL">不通過</option><option value="PENDING">待補件</option></select></label>
      <label>實際審查文件網址<input name={k+'-url'} type="url" placeholder="https://" required maxLength={2000} value={draft[k].document_url} onChange={e=>update(k,'document_url',e.target.value)}/></label>
      <label>判斷依據與限制<textarea name={k+'-notes'} required minLength={10} maxLength={8000} value={draft[k].notes} onChange={e=>update(k,'notes',e.target.value)}/></label>
     </fieldset>)}</div><label>整體審查說明<textarea name="review-reason" minLength={10} maxLength={3000} required value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <button type="submit">儲存四項審查</button></fieldset></form>
   </section>
   <section aria-label="會員閱讀決定"><h2>會員閱讀決定</h2><p>核准會使用剛讀取的最新審查版本。來源使用權、四項通過及效期都由伺服器重新檢查。</p>
    <label>閱讀範圍<select value={audience} disabled={writeLocked} onChange={e=>setAudience(e.target.value as typeof audience)}><option value="" disabled>請選擇閱讀範圍</option><option value="premium">付費會員</option><option value="free">免費固定摘要與付費完整內容</option></select></label>
    <div className="om-actions"><button disabled={writeLocked||!audience||!ownerMarketReady(page,now)} onClick={()=>void mutate('APPROVE')}>核准會員閱讀</button>
     <button className="om-revoke" disabled={writeLocked||!audience||!page.review} onClick={()=>void mutate('REVOKE')}>撤回會員閱讀</button></div>
    {!ownerMarketReady(page,now)&&<p>目前尚未符合核准條件；請處理待補審查、缺少的來源使用依據或已到期版本。</p>}
   </section></>}
  </main></div>;
}
function PreviewCard({card,open}:{card:DailyAiMarketCardV2;open:()=>void}){
 const reference=card.research_reference;
 return <article className="om-card"><p>{marketLabel[card.market]} · {HORIZONS[card.horizon].label}</p><h3>{card.symbol} {card.company}</h3><strong>{cardStatus[card.status]}</strong><p>{card.reason.text}</p>
  <p><b>等待條件：</b>{card.confirmation}</p><p><b>失效或重評：</b>{card.invalidation}</p>
  {reference&&<div className="om-reference"><h4>{referenceTitle(card.horizon)}</h4><p>{reference.quote_date} 現價 {money(reference.current_price)}</p><p>{money(reference.lower)}～{money(reference.upper)}{reference.median!==null?' · 中位 '+money(reference.median):''}</p>
   {reference.peer_count!==null&&<p>同業樣本 {reference.peer_count} 檔</p>}<p>研究用途，尚非正式買賣價格；方法適用性仍須審查。</p></div>}
  <details><summary>反面證據與缺件</summary>{card.counter_evidence?.map((e,i)=><p key={i}>{e.text}</p>)}{card.gaps.map((g,i)=><p key={i}>{g}</p>)}</details>
  <button onClick={open}>查看 {card.symbol} 原件與計算</button></article>;
}
function ReferenceDetails({value}:{value:OwnerMarketReference}){
 const s=value.summary,method=s.method_version==='TAIWAN_REPORTED_BVPS_PEER_V1'
  ?`原季報每股參考淨值 × 同市場、同產業、同報價日及同財報期之同業計算 P/B 分位數；同業 P/B＝同日收盤價 ÷ 各公司原季報每股參考淨值。${s.horizon==='LONG'?'公司與同業另須通過相同三年獲利、現金流及資產負債品質條件。':''}季末後已核對五類公司事件，未調整的股數變動會擋下計算；現金股利另列，不自動扣減原季報淨值。這不是即時淨值、現金流折現或內在價值。`
  :s.horizon==='SHORT'?'最後 20 個完整交易日的未還原最低／最高價，不推算未來目標。':s.horizon==='LONG'
  ?'以三年財務品質條件相同的同市場、同產業、同期同業 P/B 分位數，換算相對價格；不是現金流折現或內在價值。'
  :'現價 × 同市場、同產業、同日同業估值分位數 ÷ 本股官方估值倍數；屬同業倍數敏感度參考。';
 return <details className="om-reference"><summary>{HORIZONS[s.horizon].label} · {referenceTitle(s.horizon)}</summary><p>{method}</p>
  <p>{s.quote_date} 現價 {money(s.current_price)} · 參考 {money(s.lower)}～{money(s.upper)}{s.median!==null?' · 中位 '+money(s.median):''}{s.peer_count!==null?' · 同業 '+s.peer_count+' 檔':''}</p>
  <p>不是買進觸發、停損或報酬預測。此筆計算保留研究狀態，沒有自動方法核准。</p>
  <details><summary>計算原件與方法參數</summary><pre>{JSON.stringify(value.reference,null,2)}</pre></details>
  {!!value.sources.length&&<details><summary>本股與同業原件引用（{value.sources.length} 筆）</summary><ul>{value.sources.map((source,i)=><li key={i}>{source.security_id} · {timestamp(source.received_at)} · <a href={source.source_url} target="_blank" rel="noreferrer">官方來源</a></li>)}</ul></details>}
  <label>計算識別碼<input readOnly value={s.reference_hash}/></label></details>;
}
