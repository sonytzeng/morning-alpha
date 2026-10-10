import {useState} from 'react';
import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import {type MemberResearch,type MemberObservation} from '@/features/vnext/member';
const statuses={WATCHING:'等待確認',CONDITION_MET:'觀察條件已符合',INVALIDATED:'原判斷已失效',EXPIRED:'觀察已到期',REVIEW_DUE:'等待重新評估'};
const date=(s:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s));
const relations={CUSTOMER:'客戶',SUPPLIER:'供應商',COMPETITOR:'競爭者',PRODUCT:'產品關係'};
function Card({card,full,saved,onWatch,busy}:{card:MemberObservation;full:boolean;saved:boolean;onWatch:(id:string,saved:boolean)=>void;busy:boolean}){
 const d=card.details;
 return <article className="vnext-card vm-card"><div className="vnext-card-top"><span>{HORIZONS[card.horizon].label} · {HORIZONS[card.horizon].duration}</span><span className="vnext-status">{statuses[card.status]}</span></div>
  <h3>{card.company}<small>{card.symbol}</small></h3><p className="vnext-reason">{card.reason}</p>
  <h4>什麼條件成立才開始考慮？</h4><ul>{card.confirmation.map((s,i)=><li key={i}>{s}</li>)}</ul>
  <div className="vnext-risk"><h4>主要風險</h4><p>{card.risk}</p><h4>什麼情況原本的判斷會失效？</h4><ul>{card.invalidation.map((s,i)=><li key={i}>{s}</li>)}</ul></div>
  <dl><div><dt>研究資料截至</dt><dd>{date(card.as_of)}</dd></div><div><dt>下次重新評估</dt><dd>{date(card.next_review_at)}</dd></div></dl>
  {full&&d?<><button type="button" className="vm-watch" disabled={busy} aria-pressed={saved} onClick={()=>onWatch(card.id,!saved)}>{saved?'移出我的觀察清單':'加入我的觀察清單'}</button>
   <details><summary>查看完整研究依據</summary>{(['SUPPORTS','CONTRADICTS','CONTEXT'] as const).map(stance=><section key={stance}><h4>{{SUPPORTS:'支持原判斷的證據',CONTRADICTS:'反對原判斷的證據',CONTEXT:'補充研究資料'}[stance]}</h4>
    {d.evidence.filter(e=>e.stance===stance).length?d.evidence.filter(e=>e.stance===stance).map((e,i)=><div key={i}><p>{e.summary}</p><small>{{CONFIRMED_FACT:'已確認事實',REPORTED_CLAIM:'來源陳述',INFERENCE:'研究推論',UNVERIFIED:'尚待查證'}[e.classification]} · {date(e.available_at)}</small><a href={e.url} target="_blank" rel="noopener noreferrer">來源：{e.source}</a></div>):<p>目前沒有已核准可公開的{stance==='CONTRADICTS'?'反方證據；不代表沒有風險':'資料'}。</p>}</section>)}
   <section><h4>已查證的產業事件</h4>{d.events.length?d.events.map((e,i)=><div key={i}><p>{e.title}</p><p>何時重新檢查：{e.invalidation}</p><small>{date(e.available_at)}</small>{e.urls.map(u=><a key={u} href={u} target="_blank" rel="noopener noreferrer">{e.source}</a>)}</div>):<p>尚無已核准可公開的事件，不推定利多或利空。</p>}</section>
   <section><h4>有來源支持的公司關係</h4>{d.relations.length?d.relations.map((r,i)=><div key={i}><p>{r.from} → {relations[r.type]} → {r.to}</p><small>關係存在不代表股價一定受惠 · {date(r.available_at)}</small>{r.urls.map(u=><a key={u} href={u} target="_blank" rel="noopener noreferrer">{r.source}</a>)}</div>):<p>目前無法確認直接公司關係，不以同產業推定。</p>}</section>
   <section><h4>後續結果追蹤</h4>{d.outcomes.length?d.outcomes.map(o=><p key={o.horizon_days}>{o.horizon_days}個交易日：{{NOT_MATURED:'尚未到觀察期限',NOT_ENTERED:'未觸發可確認的進場',UNCONFIRMED:'結果仍無法可靠確認'}[o.state]}</p>):<p>尚無可驗證的後續結果。不顯示勝率或報酬。</p>}</section></details></>:<p className="vm-upgrade">Premium 可閱讀完整研究依據與保存觀察清單。<a href="/pricing">了解會員方案</a></p>}
  <p className="vnext-disclaimer">研究觀察，不是正式推薦，也不保證買點或獲利。</p></article>;
}
export default function MemberExperience({data,onWatch,busy,notice,market}:{data:MemberResearch;onWatch:(id:string,saved:boolean)=>void;busy:boolean;notice:string;market:{date:string;direction:string;regime:string;action:string}|null}){
 const [horizon,setHorizon]=useState<Horizon>('SHORT'),[view,setView]=useState<'current'|'saved'|'history'>('current');
 const full=data.tier!=='free',pool=view==='history'?data.history:view==='saved'?[...data.observations,...data.history].filter(o=>data.watchlist.includes(o.id)):data.observations;
 const rows=pool.filter(o=>o.horizon===horizon);
 return <main className="vnext-content" id="stock-observations"><section className="vnext-intro"><p className="vnext-eyebrow">股票觀察 · {full?'完整研究內容':'免費會員每日最多3檔'}</p><h1>今天有哪些股票值得觀察？</h1><p>先看理由，再看條件與風險。依你的觀察時間選擇，不必急著買進。</p></section>
  <section className="vm-market" aria-label="市場方向摘要"><h2>先看市場，再研究個股</h2>{market?<p>{market.date}市場方向：{market.direction} · {market.regime} · {market.action}</p>:<p>目前尚未取得可確認的市場摘要，請查看正式今日市場。不以研究結果代替市場判斷。</p>}<a href="/report/today">查看今日市場</a></section>
  <div className="vnext-horizons" aria-label="觀察期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><button key={h} type="button" aria-pressed={h===horizon} onClick={()=>setHorizon(h)}><strong>{HORIZONS[h].label}</strong><span>{HORIZONS[h].duration}</span></button>)}</div>
  {full&&<nav className="vm-filters" aria-label="觀察內容"><button aria-pressed={view==='current'} onClick={()=>setView('current')}>目前觀察</button><button aria-pressed={view==='saved'} onClick={()=>setView('saved')}>我的觀察清單</button><button aria-pressed={view==='history'} onClick={()=>setView('history')}>歷史追蹤</button></nav>}
  <div className="vnext-summary"><h2>{HORIZONS[horizon].label}{view==='history'?' · 歷史追蹤':view==='saved'?' · 我的清單':''}</h2><span>共 {rows.length} 筆</span></div><p role="status" className="vm-notice">{notice}</p>
  {rows.length?<div className="vnext-grid">{rows.map(card=><Card key={card.id} card={card} full={full} saved={data.watchlist.includes(card.id)} onWatch={onWatch} busy={busy}/>)}</div>:<section className="vnext-empty"><h3>{view==='saved'?'還沒有加入觀察清單':view==='history'?'目前沒有可公開的歷史追蹤':data.observations.length?'這個期間目前沒有符合公開研究條件的股票':'今天沒有符合公開研究條件的股票'}</h3><p>{view==='current'?'資料、時效與公開權利必須全部確認，才會提供觀察。沒有候選不代表市場沒有機會，也不是正式推薦的結果。':'只保留可合法閱讀的研究；撤回或權限變更的資料不會繼續顯示。'}</p><a href="/academy">先到股票學院學習</a></section>}
  <aside className="vnext-footnote"><p>短期看量價變化，中期看營收與事件，長期看需求與獲利。三種期間分開驗證；尚未有足夠實際追蹤結果，不能宣稱分析有效。</p></aside>
 </main>;
}
