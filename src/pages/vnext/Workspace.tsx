import { useState } from 'react';
import { ArrowUpRight, BookOpen, Clock3, Layers3, Network, Search, ShieldCheck } from 'lucide-react';
import { HORIZONS } from '@/features/vnext/contracts';
import type { Horizon, Projection } from '@/features/vnext/contracts';
import type { VNextProjection } from '@/features/vnext/projection';
import './vnext.css';

const labels = { WATCHING:'持續觀察', CONDITION_MET:'觀察條件已成立', INVALIDATED:'原判斷已失效', EXPIRED:'觀察期間已結束' };
const classes = {CONFIRMED_FACT:'已確認事實',REPORTED_CLAIM:'來源報導，仍待驗證',INFERENCE:'研究推論',UNVERIFIED:'尚未確認'};
function date(value: string) { return new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)); }
function ObservationCard({ row }: {row: Projection}) {
  return <article className="vnext-card">
    <div className="vnext-card-top"><span>{HORIZONS[row.horizon].label}</span><span className="vnext-status">{labels[row.status]}</span></div>
    <h3>{row.company}<small>{row.symbol}</small></h3><p className="vnext-reason">{row.reason}</p>
    <dl><div><dt>觀察多久</dt><dd>{HORIZONS[row.horizon].duration}</dd></div><div><dt>什麼時候再確認</dt><dd>{date(row.next_review_at)}（台北時間）</dd></div></dl>
    <section><h4>等什麼條件？</h4><ul>{row.confirmation.map((text,i)=><li key={i}>{text}</li>)}</ul></section>
    <section className="vnext-risk"><h4>什麼情況代表看錯？</h4><ul>{row.invalidation.map((text,i)=><li key={i}>{text}</li>)}</ul></section>
    <details><summary>查看依據與來源（{row.evidence.length}）</summary>{row.evidence.map((e,i)=><section key={i}><span className="vnext-status">{classes[e.classification]}</span><p>{e.summary}</p><a href={e.source_ref} target="_blank" rel="noreferrer">{e.source} <ArrowUpRight size={14} aria-hidden="true" /></a><small>資料可取得時間：{date(e.available_at)}</small></section>)}</details>
    <p className="vnext-disclaimer">這是研究觀察，不是買進建議，也不保證獲利。</p>
  </article>;
}
export default function VNextWorkspace({ data }: {data: VNextProjection}) {
  const [area,setArea]=useState('observations'),[horizon,setHorizon]=useState<Horizon>('SHORT');
  const rows=data.observations.filter(row=>row.horizon===horizon);
  return <main className="vnext"><a className="vnext-skip" href="#vnext-content">跳至主要內容</a>
    <header className="vnext-header"><a href="/" className="vnext-brand">MORNING ALPHA<span>有依據，才有判斷</span></a><span className="vnext-private"><ShieldCheck size={16} aria-hidden="true"/>研究預覽 · 尚未正式發布</span></header>
    <nav className="vnext-navigation" aria-label="主要功能">{[['market','今日市場',Layers3],['observations','股票觀察',Search],['industry','產業趨勢',Network],['academy','股票學院',BookOpen]].map(([key,label,Icon])=><button key={String(key)} type="button" aria-current={area===key?'page':undefined} onClick={()=>setArea(String(key))}>{typeof Icon!=='string'&&<Icon size={18} aria-hidden="true"/>}{String(label)}</button>)}</nav>
    <div id="vnext-content" className="vnext-content">
      {area==='observations'&&<><div className="vnext-intro"><p className="vnext-eyebrow">先理解理由，再等待條件</p><h1>值得持續留意的股票</h1><p>把短線變化和長期理由分開看。每個觀察都有依據，也有可能失效的時候。</p></div>
        <div className="vnext-horizons" role="group" aria-label="觀察期間">{(Object.keys(HORIZONS) as Horizon[]).map(key=><button type="button" key={key} aria-pressed={key===horizon} onClick={()=>setHorizon(key)}><strong>{HORIZONS[key].label}</strong><span>{HORIZONS[key].duration}</span></button>)}</div>
        <div className="vnext-summary"><h2>{HORIZONS[horizon].label}</h2><span>{rows.length ? `${rows.length} 筆可閱讀觀察` : '尚無已核准的觀察'}</span></div>
        {rows.length?<div className="vnext-grid">{rows.map(row=><ObservationCard key={row.id} row={row}/>)}</div>:<section className="vnext-empty"><Clock3 size={32} aria-hidden="true"/><h3>有足夠依據，才提供觀察</h3><p>目前沒有可供此帳號閱讀的{HORIZONS[horizon].label}。可能仍在整理資料或等待審核；這不代表市場沒有機會。</p><p>現在不需要操作，也不要因為空白而猜測買賣方向。</p></section>}
      </>}
      {area==='market'&&<section className="vnext-intro"><p className="vnext-eyebrow">既有每日服務維持不變</p><h1>今天市場怎麼看？</h1><p>請以正式每日報告的市場日期、行動與風險為準。研究觀察不會覆蓋正式判斷。</p><a className="vnext-primary" href="/report/today">查看今日完整分析 <ArrowUpRight size={18}/></a></section>}
      {area==='industry'&&<section className="vnext-intro"><p className="vnext-eyebrow">事件 → 公司關係 → 營運驗證</p><h1>消息，如何變成公司的改變？</h1><p>先確認事件，再看訂單、營收與獲利。供應鏈關係存在，不代表股價一定上漲。</p><div className="vnext-chain" aria-label="產業證據驗證流程">{['需求','訂單','營收','獲利','市場預期','估值與股價'].map(label=><section key={label}><h2>{label}</h2><p>尚無核准證據</p></section>)}</div><p role="status">目前尚未提供可公開的事件時間線與公司關係。資料或授權未完成前，不會補上推測內容。</p></section>}
      {area==='academy'&&<section className="vnext-intro"><p className="vnext-eyebrow">從基礎，建立自己的判斷</p><h1>下一步，學懂你看到的市場</h1><p>免費會員可學 7 章、練習 14 題；進階會員可學 10 章、練習 23 題。課程與進度沿用既有股票學院。</p><a className="vnext-primary" href="/academy">前往股票學院 <ArrowUpRight size={18}/></a></section>}
      <aside className="vnext-footnote"><ShieldCheck size={20} aria-hidden="true"/><p>尚未證明分析有效。研究資料與正式推薦分開，不能把歷史重播當成事前預測。</p></aside>
    </div>
  </main>;
}
