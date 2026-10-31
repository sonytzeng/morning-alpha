import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {AcademyAccess} from '@/pages/academy/useAcademyAccess';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {DAILY_AI_MEMBER_STATES} from '@/features/vnext/dailyAiMember';
import {dailyAiGapLabel} from '@/features/vnext/dailyAiCopy';
import {dailyAiOwnerCanApprove,dailyAiOwnerCanRevoke,dailyAiOwnerReviewRequest,parseDailyAiOwner,parseDailyAiOwnerReviewResult,type DailyAiOwnerAction,type DailyAiOwnerAudience,type DailyAiOwnerResearch} from '@/features/vnext/dailyAiOwner';
import './daily-ai-member.css';

const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const status=(value:string|undefined)=>value==='PASS'?'通過':value==='FAIL'?'未通過':'待完成';

export function OwnerAiEditionReview({data,busy=false,onReview}:{data:DailyAiOwnerResearch;busy?:boolean;onReview:(action:DailyAiOwnerAction,audience:DailyAiOwnerAudience)=>void}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[query,setQuery]=useState(''),[limit,setLimit]=useState(9),[audience,setAudience]=useState<DailyAiOwnerAudience>('premium'),[now,setNow]=useState(Date.now);
 useEffect(()=>{const update=()=>setNow(Date.now()),timer=setInterval(update,15000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[]);
 const e=data.edition,r=data.review,publication=data.publication;
 if(!e)return <section className="vnext-empty" role="status"><h3>尚無完成的每日 AI 研究版本</h3><p>必須先完成 72 檔、216 個期間分析，才能在這裡預覽與核准。</p></section>;
 const canApprove=dailyAiOwnerCanApprove(data,now),canRevoke=dailyAiOwnerCanRevoke(data),current=Date.parse(e.expires_at)>now;
 const rows=data.cards.filter(c=>c.horizon===horizon&&(!query.trim()||`${c.symbol} ${c.company}`.includes(query.trim())));
 return <div className="dam">
  <p>研究版本 <strong>{e.edition_date}</strong> · 收盤資料截至 <strong>{e.data_through}</strong> · {e.jobs} 檔 / {e.periods} 個期間分析</p>
  <p>證據截止 {date(e.evidence_cutoff)}；準備完成 {date(e.prepared_at)}；有效至 {date(e.expires_at)}（台北）。</p>
  <p>這是 Owner 私人預覽。會員閱讀權限依實際審查與核准紀錄決定。</p>
  <ul aria-label="每日 AI 研究發布檢查">
   <li>完整性與原始資料承諾：{data.integrity_ready?'通過':'尚未通過'}</li>
   <li>全部 {data.source_urls.length} 個來源的會員使用權：{data.rights_ready?'通過':'尚未通過'}</li>
   <li>獨立審查：品質 {status(r?.quality)} · 時效 {status(r?.time_status)} · 授權 {status(r?.licensing)}</li>
   <li>本版審查有效性：{data.review_ready&&r&&r.snapshot_hash===e.id&&Date.parse(r.expires_at)>now?'通過':'尚未通過'}</li>
   <li>研究版本有效期：{current?'有效':'已到期，只供核對歷史內容'}</li>
  </ul>
  {r?<details><summary>查看實際獨立審查紀錄</summary><p>{r.reason}</p><p>審查者：{r.reviewer_ref}；審查時間：{date(r.recorded_at)}；有效至：{date(r.expires_at)}。</p><p>審查編號：<code>{r.id}</code></p><p>品質文件：<code>{r.quality_document_hash}</code></p><p>時效文件：<code>{r.time_document_hash}</code></p><p>授權文件：<code>{r.license_document_hash}</code></p>{r.snapshot_hash!==e.id&&<p>審查對應的版本與本版不一致，無法核准。</p>}</details>:<p>尚未收到獨立審查，不可發布。這個頁面不能代填審查通過或來源授權。</p>}
  <p>{publication?`最近發布紀錄：${publication.action==='APPROVE'?'已核准':'已撤回'} ${publication.audience==='free'?'免費及 Premium':'Premium'} 閱讀（${date(publication.occurred_at)}）。`:'本版尚無會員發布核准紀錄。'}</p>
  {publication?.action==='APPROVE'&&(!canApprove||publication.review_id!==r?.id)&&<p>最新審查或有效條件已改變；既有核准紀錄不代表會員目前仍可讀取。</p>}
  <label>核准閱讀範圍 <select value={audience} disabled={busy} onChange={event=>setAudience(event.target.value as DailyAiOwnerAudience)}><option value="premium">Premium 會員</option><option value="free">免費摘要及 Premium 完整研究</option></select></label>{' '}
  <button disabled={busy||!canApprove} onClick={()=>onReview('APPROVE',audience)}>核准本版會員閱讀</button>{' '}
  <button disabled={busy||!canRevoke} onClick={()=>onReview('REVOKE',publication?.audience??'premium')}>撤回本版會員閱讀</button>
  {!canApprove&&<p role="status">發布條件尚未全部通過。請先完成缺少的來源使用權、獨立審查或有效版本。</p>}
  <details><summary>研究版本與批次識別</summary><p>版本：<code>{e.id}</code></p><p>批次：<code>{e.batch_id}</code></p></details>
  <h3>逐期間核對研究內容</h3>
  <div className="vnext-horizons dam-periods" aria-label="Owner 預覽研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} aria-pressed={horizon===h} onClick={()=>{setHorizon(h);setQuery('');setLimit(9);}}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span><small>{data.cards.filter(c=>c.horizon===h).length} 檔</small></button>)}</div>
  <h4>目前預覽：{HORIZONS[horizon].label}</h4><label className="dam-search">搜尋本期間股票<input value={query} placeholder="公司或代號" onChange={event=>{setQuery(event.target.value);setLimit(9);}}/></label>
  <p role="status">符合條件 {rows.length} 檔；每張卡片只顯示所選期間的分析。</p>
  <div className="vnext-grid">{rows.slice(0,limit).map(c=><article className="vnext-card dam-card" key={c.symbol}><div className="dam-card-top"><span className="dam-period-badge">{HORIZONS[c.horizon].label}</span><span className={`dam-status dam-status-${c.status.toLowerCase()}`}>{DAILY_AI_MEMBER_STATES[c.status]}</span></div><h4>{c.company} {c.symbol}</h4><h5>AI 判斷與理由</h5><p>{c.reason.text}</p><h5>接下來確認</h5><p>{c.confirmation}</p><h5>取消或重評條件</h5><p>{c.invalidation}</p><h5>反面證據</h5>{c.counter_evidence?.length?<ul>{c.counter_evidence.map((claim,i)=><li key={i}>{claim.text}</li>)}</ul>:<p>本版未列出具名反面證據。</p>}{c.gaps.length>0&&<><h5>資料缺口</h5><ul>{c.gaps.map((gap,i)=><li key={i}>{dailyAiGapLabel(gap)}</li>)}</ul></>}<details><summary>核對來源與時間（{c.sources?.length??0}）</summary><ul>{c.sources?.map(s=><li key={s.id}><a href={s.source} target="_blank" rel="noopener noreferrer">{s.id} · {new URL(s.source).hostname}</a><p>{s.published_at?`原發布 ${date(s.published_at)}`:'原發布時間未確認，僅依實際收到後的資料研究。'}；可用時間 {date(s.available_at)}。</p></li>)}</ul></details></article>)}</div>
  {rows.length>limit&&<button onClick={()=>setLimit(value=>value+9)}>再看 9 檔</button>}
 </div>;
}

type Scope={identity:string;generation:number;accessSignal:AbortSignal;controller:AbortController};
export default function OwnerAiPublication({access}:{access:AcademyAccess}){
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{identity:string;generation:number;data:DailyAiOwnerResearch}|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const currentAccess=useRef(access),scope=useRef<Scope|null>(null),pending=useRef(false);currentAccess.current=access;
 const current=useCallback((candidate:Scope)=>{const a=currentAccess.current;return scope.current===candidate&&!candidate.controller.signal.aborted&&a.kind==='member'&&a.catalog.tier==='owner'&&!a.signal.aborted&&a.signal===candidate.accessSignal&&a.id===candidate.identity&&a.generation===candidate.generation;},[]);
 useEffect(()=>{setNotice('');},[access]);
 useEffect(()=>{
  setResult(null);setError(false);setBusy(false);pending.current=false;
  if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted)return;
  const candidate:Scope={identity:access.id,generation:access.generation,accessSignal:access.signal,controller:new AbortController()};scope.current=candidate;
  const abort=()=>{candidate.controller.abort();if(scope.current===candidate){setResult(null);setBusy(false);setNotice('');}};access.signal.addEventListener('abort',abort,{once:true});
  void(async()=>{try{const response=await supabase.rpc('get_daily_ai_owner_research_v1').abortSignal(candidate.controller.signal);if(!current(candidate))return;if(response.error)throw Error('AI_OWNER_READ');const data=parseDailyAiOwner(response.data);if(current(candidate))setResult({identity:candidate.identity,generation:candidate.generation,data});}catch{if(current(candidate))setError(true);}})();
  return()=>{access.signal.removeEventListener('abort',abort);candidate.controller.abort();if(scope.current===candidate)scope.current=null;};
 },[access,revision,current]);
 const owner=access.kind==='member'&&access.catalog.tier==='owner'&&!access.signal.aborted;
 const data=owner&&access.kind==='member'&&result?.identity===access.id&&result.generation===access.generation?result.data:null;
 const submit=async(action:DailyAiOwnerAction,audience:DailyAiOwnerAudience)=>{
  const candidate=scope.current;if(!data||!candidate||!current(candidate)||pending.current)return;
  let args:ReturnType<typeof dailyAiOwnerReviewRequest>;try{args=dailyAiOwnerReviewRequest(data,action,audience,crypto.randomUUID());}catch{return;}
  pending.current=true;setBusy(true);setNotice('');
  try{const response=await supabase.rpc('review_daily_ai_research_edition_v1',args).abortSignal(candidate.controller.signal);if(!current(candidate))return;if(response.error)throw Error('AI_OWNER_ACTION');parseDailyAiOwnerReviewResult(response.data,action);if(current(candidate))setNotice(action==='APPROVE'?'核准紀錄已保存，正在重新核對本版狀態。':'撤回紀錄已保存，正在重新核對本版狀態。');}
  catch{if(current(candidate))setNotice('這次未確認完成。正在重新讀取實際紀錄；審查、授權或版本可能已改變。');}
  finally{if(current(candidate)){pending.current=false;setBusy(false);setRevision(value=>value+1);}}
 };
 if(!owner)return null;
 return <section className="vnext-section" aria-labelledby="owner-daily-ai-heading"><h2 id="owner-daily-ai-heading">每日 AI 股票研究 · 會員發布</h2><button disabled={busy} onClick={()=>{setNotice('');setRevision(value=>value+1);}}>重新讀取每日 AI 審查</button><p role="status">{data?notice:''}</p>{error?<p role="status">目前無法取得完整版本或審查結果，無法核准。</p>:!data?<p role="status">正在讀取完整研究與實際發布條件。</p>:<OwnerAiEditionReview key={data.edition?.id??'empty'} data={data} busy={busy} onReview={submit}/>}</section>;
}
