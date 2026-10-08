import {useEffect,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase';
import {readTradingLab,type TradingLabData} from '@/features/research/tradingLab';
import {cockpitToday,taipeiToday,plainAction,plainRegime,strategyNames,entryNames,filterResearch,safePlan,money} from '@/features/research/cockpit';
import type {EntryEvaluation,EntryResult} from '../../../../research/entry-opportunity';
import CockpitJournal from './CockpitJournal';
import './cockpit.css';
type ReadData={today_date:string;latest:EntryEvaluation|null;history:EntryEvaluation[];forward_sample:number;outcome_sample:number};
function parseEntry(v:unknown):ReadData{const r=v as ReadData&{owner_only:boolean;shadow_only:boolean;production_eligible:boolean};
 if(!r||r.owner_only!==true||r.shadow_only!==true||r.production_eligible!==false||![r.forward_sample,r.outcome_sample].every(n=>Number.isInteger(n)&&n>=0))throw Error('ENTRY_CONTRACT');
 if(r.latest&&(!Array.isArray(r.latest.candidates)||r.latest.candidates.some(c=>!(c.strategy in strategyNames)||!(c.status in entryNames))))throw Error('ENTRY_CONTRACT');return {...r,history:[]};}
export default function OwnerCockpit({children}:{children:ReactNode}){
 const [tab,setTab]=useState('today'),[lab,setLab]=useState<TradingLabData|null>(null),[entry,setEntry]=useState<ReadData|null>(null);
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[clock,setClock]=useState(()=>taipeiToday()),[denied,setDenied]=useState(false);
 useEffect(()=>{let active=true,generation=0;const timer=setInterval(()=>setClock(taipeiToday()),60000);
  const {data:auth}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN'){generation++;if(active){setLab(null);setEntry(null);setDenied(true);}}});const g=generation;
  void(async()=>{try{const [l,e]=await Promise.all([supabase.functions.invoke('owner-trading-lab-v1',{body:{operation:'READ'}}),supabase.rpc('get_owner_entry_opportunity_v1')]);
   if(!active||g!==generation)return;
   if(e.error?.code==='42501'){setDenied(true);return;}
   if(!l.error&&!l.data?.error)setLab(readTradingLab(l.data));else setError('今日市場資料暫時無法讀取；不是市場沒有機會。');
   if(e.error){setError('進場研究暫時無法讀取，請稍後再試。');return;}
   const parsed=parseEntry(e.data),h=await supabase.from('entry_opportunity_runs').select('business_date,mode,result').eq('mode','HISTORICAL_REPLAY').order('evaluation_time',{ascending:false}).order('locked_at',{ascending:false}).limit(20);
   if(!active||g!==generation)return;if(h.error){setError('歷史研究目前無法讀取。');return;}
   const dates=new Set<string>();for(const x of h.data||[]){const r=parseEntry({...e.data,latest:x.result}).latest;if(!r||r.business_date!==x.business_date||r.mode!=='HISTORICAL_REPLAY')throw Error('ENTRY_HISTORY');if(!dates.has(r.business_date)){parsed.history.push(r);dates.add(r.business_date);}}
   setEntry(parsed);
  }catch{if(active&&g===generation)setError('資料格式或連線未完成確認；暫時不提供研究判斷。');}finally{if(active&&g===generation)setLoading(false);}})();
  return()=>{active=false;clearInterval(timer);auth.subscription.unsubscribe();};},[]);
 if(denied)return <section className="cockpit" role="status"><h1>請重新登入</h1><p>只有具名授權的本人可讀取研究與交易資料。</p></section>;
 const today=cockpitToday(lab,entry?.latest||null,clock);
 return <section className="cockpit" aria-label="投資研究與交易中心">
  <header className="cockpit-header"><div><p className="cockpit-eyebrow">僅供本人研究 · 不會自動下單</p><h1>投資研究與交易中心</h1></div><p>{clock} · 台北</p></header>
  <nav className="cockpit-tabs" aria-label="研究中心主要功能">{[['today','今天怎麼做'],['research','股票買賣研究'],['trades','我的交易與成效']].map(([key,name])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{name}</button>)}</nav>
  {error&&<p className="cockpit-warning" role="alert">{error}</p>}
  {loading?<p role="status">正在讀取已保存的市場與研究資料…</p>:null}
  {tab==='today'&&<div className="cockpit-stack"><article className="cockpit-hero"><p className="cockpit-eyebrow">先看市場，再決定要不要研究進場</p><h2>今天有沒有值得研究的買點？</h2>
   {!today.market?<p className="cockpit-lead">今天的分析還在準備，目前先不要使用昨天的結果做今天的判斷。</p>:<><p className="cockpit-lead">{today.market.conclusion}</p><p>{today.market.direction} · {plainRegime(today.market.regime)}</p></>}
   <div className="cockpit-metrics"><div><span>目前建議</span><strong>{today.market?plainAction(today.market.action):'先等待今天的正式分析'}</strong></div><div><span>值得關注</span><strong>{today.watch===null?'尚未完成今日研究':`${today.watch} 檔`}</strong></div><div><span>符合研究進場條件</span><strong>{today.ready===null?'暫不推定':`${today.ready} 檔`}</strong></div></div>
   <p className="cockpit-warning">每日自動進場研究尚未啟用。已有的歷史研究不能當成今天的買賣判斷。</p>
   <h3>下一步</h3><p>{today.market?.waitReason||'等待今天的分析與可觀察條件，不由舊資料推算進場時機。'}</p>
   <button className="cockpit-primary" onClick={()=>setTab('research')}>查看股票與歷史研究</button>
  </article><div className="cockpit-two"><article className="cockpit-card"><h3>哪些訊號支持？</h3><ReasonList rows={today.market?.supporting||[]} empty="尚無當日可核對的支持理由。"/></article><article className="cockpit-card"><h3>哪些訊號提醒我小心？</h3><ReasonList rows={today.market?.contradicting||[]} empty="尚無當日可核對的風險理由，不代表沒有風險。"/></article></div>
   <details className="cockpit-card"><summary>查看完整分析依據與研究工具</summary>{children}</details>
  </div>}
  {tab==='research'&&<Research data={entry} today={clock} names={(lab as TradingLabData&{symbol_names?:Record<string,string>}|null)?.symbol_names||{}} onJournal={()=>setTab('trades')}/>}
  {tab==='trades'&&<CockpitJournal legacy={lab}/>}
 </section>;
}
function ReasonList({rows,empty}:{rows:string[];empty:string}){return rows.length?<ul>{rows.slice(0,3).map((r,i)=><li key={i}>{r}</li>)}</ul>:<p>{empty}</p>;}
function Research({data,today,names,onJournal}:{data:ReadData|null;today:string;names:Record<string,string>;onJournal:()=>void}){
 const [date,setDate]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState('ALL'),[selected,setSelected]=useState('');
 const catalog=[...(data?.latest?[data.latest]:[]),...(data?.history||[])].filter((r,i,a)=>a.findIndex(x=>x.business_date===r.business_date)===i);
 const row=catalog.find(r=>r.business_date===date)||catalog[0];const candidates=filterResearch((row?.candidates||[]).map(c=>({...c,name:c.name||names[c.symbol]})),query,status);
 const symbols=[...new Set(candidates.map(c=>c.symbol))],symbol=symbols.includes(selected)?selected:symbols[0];const shown=candidates.filter(c=>c.symbol===symbol);
 const historical=row?.mode==='HISTORICAL_REPLAY'||row?.business_date!==today;
 return <div className="cockpit-stack"><header><h2>找到股票，看懂條件，再決定</h2><p>研究條件不是買入指令；先核對日期、風險與失效條件。</p></header>
  <div className="cockpit-filters"><label>研究日期<select value={row?.business_date||''} onChange={e=>{setDate(e.target.value);setSelected('');}}>{catalog.map(r=><option key={r.business_date} value={r.business_date}>{r.business_date} · {r.mode==='HISTORICAL_REPLAY'?'歷史研究':'事前研究'}</option>)}</select></label><label>搜尋股票<input placeholder="輸入名稱或代號" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>目前狀態<select value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">全部股票</option>{Object.entries(entryNames).map(([v,n])=><option value={v} key={v}>{n}</option>)}</select></label></div>
  {historical&&row?<p className="cockpit-warning" role="note">{row.business_date} 歷史研究，不能當成今天的買賣判斷。</p>:null}
  <p>研究範圍 {row?.universe??'尚未取得'} 檔，非全市場。{row?`已檢查 ${row.scanned} 檔。`:''}符合目前篩選：{symbols.length} 檔。</p>
  {!symbols.length?<article className="cockpit-card"><h3>目前沒有符合篩選的研究</h3><p>{row?'可換一個狀態或名稱查詢；這不代表市場沒有機會。':'尚無已保存的進場研究；不補造股票或價格。'}</p></article>:<div className="cockpit-research-grid"><aside className="cockpit-stock-list" aria-label="股票列表">{symbols.map(s=>{const c=candidates.find(c=>c.symbol===s)!;return <button key={s} aria-pressed={symbol===s} onClick={()=>setSelected(s)}><strong>{c.name||'名稱未提供'} {s}</strong><span>{[...new Set(candidates.filter(x=>x.symbol===s).map(x=>entryNames[x.status]))].join('；')}</span></button>;})}</aside>
   <div className="cockpit-stack">{shown.map(c=><StockCard c={c} key={c.strategy} historical={historical} onJournal={onJournal}/> )}</div></div>}
  <details className="cockpit-card"><summary>查看研究樣本與資料限制</summary><p>事前研究日期：{data?.forward_sample??'未讀取'}；完成結果：{data?.outcome_sample??'未讀取'}。歷史研究不算事前樣本。</p><p>目前資料不足，還不能判斷這套策略是否有效。每日自動研究與進場結果追蹤尚未啟用。</p><p>日線資料無法確認實際成交及同日停損、停利先後，不能當成已實現績效。</p></details>
 </div>;
}
function StockCard({c,historical,onJournal}:{c:EntryResult;historical:boolean;onJournal:()=>void}){
 const plan=safePlan(c);return <article className="cockpit-card"><p className="cockpit-eyebrow">{strategyNames[c.strategy]}</p><h3>{c.name||''} {c.symbol}</h3><p className={`cockpit-state state-${c.status}`}>{entryNames[c.status]}</p>
  <h4>{c.status==='AVOID_ENTRY'?'為什麼目前不建議？':c.status==='INSUFFICIENT_EVIDENCE'?'還缺什麼資料？':'為什麼值得關注？'}</h4><ReasonList rows={c.reasons} empty="尚無足夠的判斷理由。"/>
  <h4>什麼條件成立才考慮買？</h4><p>{c.status==='INSUFFICIENT_EVIDENCE'?'暫時無法可靠判斷，不提供進場價。':c.entry_trigger||'沒有可信的確認條件，先不推定。'}</p>
  <h4>什麼情況代表判斷失效？</h4><p>{c.invalidation||'目前沒有足夠證據提供失效價位。'}</p>
  <h4>現在最大的風險是什麼？</h4><p>{historical?'這是歷史截點的條件；今天的價格與市場狀態可能已不同。':c.status==='WAIT_CONFIRMATION'?'確認訊號尚未成立，不能把觀察當成已可買入。':'研究判斷仍可能失效，觸發價格不保證能成交。'}</p>
  {plan?<div className="cockpit-metrics"><div><span>研究觸發區間</span><strong>{money(plan.reference_range[0])}～{money(plan.reference_range[1])}</strong></div><div><span>失效參考價</span><strong>{money(plan.stop)}</strong></div><div><span>每股風險／風險報酬比</span><strong>{money(plan.risk_distance)}／1：{money(plan.reward_risk)}</strong></div></div>:<p>資料不足或沒有合理價格區間，不提供虛構價格。</p>}
  <button onClick={onJournal}>前往我的交易（不會自動建立）</button><details><summary>查看完整分析依據</summary><p>策略版本：{c.strategy_version}</p><p>進場環境：{c.entry_environment}；機會品質：{c.opportunity_quality}</p><p>證據信心：{(c.evidence_confidence.completeness*100).toFixed(0)}%，不是上漲機率。</p><p>目標觀察期間：1／3／5／10／20 交易日，分別評估。</p><p>目標情境：{plan?money(plan.target):'資料不足'}。價格條件不是成交保證。</p><ReasonList rows={c.reasons} empty="資料不足"/><p className="cockpit-technical">{c.evidence_refs.join('\n')}</p></details>
 </article>;
}
