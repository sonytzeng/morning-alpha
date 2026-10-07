import { useState } from 'react';
import OwnerExperiment from './OwnerExperiment';
import { v2DailySnapshot, v2DailyHealth, v2SampleStatus, V2_GATE_REASONS, type DailyV2 } from '../../../features/research/recommendation-v2-forward';

type Row=Record<string,unknown>;
const object=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.map(object):[];
const strings=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'):[];
const labels:Record<string,string>={liquidity:'成交活絡度',market:'市場配合',sector:'產業配合',relative_strength:'相對大盤強弱',momentum:'價格趨勢',volume_price:'量價確認',institutional:'法人股數方向',fundamental:'實際營收／財報',catalyst:'公司公告',risk:'風險預算',entry:'進場條件'};
const box='rounded-xl border bg-white p-4';
const metric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:4}):'尚無可信數值';
const sampleLabels:Record<string,string>={INSUFFICIENT_SAMPLE:'樣本不足',EARLY:'早期觀察',PRELIMINARY:'初步有效性觀察',LARGER_SAMPLE_NOT_PROOF:'較有意義樣本，仍不是有效保證'};

export default function ForwardBrief({data,onInspect}:{data:Row;onInspect:(symbol:string)=>void}){
 const [window,setWindow]=useState(5);
 const latest=object(data.latest),names=object(data.company_names);
 let snapshot:Row={};
 try{snapshot=v2DailySnapshot(latest,Object.fromEntries(Object.entries(names).filter((r):r is [string,string]=>typeof r[1]==='string')));}catch{/* no manufactured complete funnel */}
 const history=rows(data.history),expected=strings(data.expected_trading_dates);
 const health=v2DailyHealth(history as DailyV2[],expected,String(latest.methodology_version));
 const dates=strings(data.forward_dates),sample=v2SampleStatus(new Set(dates).size);
 const counts=object(snapshot.counts),current=latest.business_date===data.today_date;
 const displayed=history.slice(0,window),near=rows(snapshot.near_miss);
 return <section className="space-y-4" aria-label="每日研究摘要">
  <section className={box}><h3 className="text-lg font-semibold">今天有股票嗎？</h3>
   {!current?<p className="mt-2">今日尚無自然 V2 評估；不拿較早資料冒充今天。</p>:counts.NONE===72?<p className="mt-2 font-semibold">今天 72 檔完整評估後沒有股票達標。</p>:<p className="mt-2">V2 研究達標 {metric(counts.READY)} 檔 · 待確認觀察 {metric(counts.WATCH)} 檔 · 不採用 {metric(counts.NONE)} 檔 · 真正資料缺口 {metric(counts.BLOCKED)} 檔</p>}
   <p className="mt-2 text-sm">以上是獨立 Shadow 研究，不是正式推薦；正式 V1 結果另外列示。範圍固定為 72 檔已登錄股票，不是全市場。</p>
   <p className="mt-2 text-sm">Forward：{new Set(dates).size} 個獨立交易日 · {sampleLabels[sample]}。同一天多檔、多個 checkpoint 不增加日期樣本；歷史重播和沒有候選的日子不算預測樣本。</p>
   <p className="mt-2 text-sm">方法已凍結；不因沒有股票自動降低門檻。Sony 操作驗收仍待本人判定。</p>
  </section>
  <section className={box}><h3 className="text-lg font-semibold">最接近條件的股票（不是推薦）</h3>
   <p className="mt-2 text-sm">依未滿足條件數整理，最多 5 檔，僅供研究。沒有買進指令，不計入 V2 WATCH／READY 績效。</p>
   {!near.length?<p className="mt-2 text-sm">目前沒有可列示的已完整評估 Near-Miss；不把資料缺口排成推薦。</p>:<div className="mt-3 grid gap-3 lg:grid-cols-2">{near.map(c=><article key={String(c.symbol)} className="min-w-0 rounded border p-3">
    <h4 className="font-semibold">{String(c.symbol)} {typeof c.name==='string'?c.name:'公司名稱尚未可讀'}</h4>
    <p className="mt-2 text-sm">通過：{strings(c.passed).map(k=>labels[k]||k).join('、')||'沒有已確認通過的條件'}</p>
    <p className="mt-2 text-sm text-amber-700">還差：{strings(c.missing).map(k=>labels[k]||k).join('、')}。因此今天不推薦。</p>
    <details className="mt-2 text-sm"><summary>風險與實際證據</summary><dl className="mt-2 space-y-2">{['risk','relative_strength','momentum','institutional','fundamental','catalyst'].map(key=>{
     const e=object(object(c.evidence)[key]),value=object(e.value);
     const content=key==='institutional'?`三大法人淨股數 ${metric(value.net_shares)}（不是金額）`:key==='fundamental'?`營收年增 ${metric(value.revenue_yoy)}、月增 ${metric(value.revenue_mom)}（比率；不是共識預估）`:key==='catalyst'?`近期公告 ${rows(value.events).length} 筆；不自動當利多`:metric(e.value);
     return <div key={key}><dt className="font-semibold">{labels[key]}</dt><dd className="break-words">{content}</dd></div>;
    })}</dl></details>
    <button type="button" className="mt-3 min-h-11 rounded border px-4 py-2" onClick={()=>onInspect(String(c.symbol))}>查看支持、反對與失效條件</button>
    {current&&typeof data.latest_run_id==='string'?<OwnerExperiment symbol={String(c.symbol)} runId={data.latest_run_id}/>:null}
   </article>)}</div>}
  </section>
  <section className={box}><h3 className="text-lg font-semibold">每天在哪一層被淘汰？</h3>
   <p className="mt-2 text-sm">自然執行紀錄與連續日數截至：{typeof data.calendar_as_of==='string'?data.calendar_as_of:'尚無自然紀錄'}。沒有新紀錄時，不推定今天已執行。</p>
   <p className="mt-2 text-sm">獨立通過是各條件單獨檢查；逐層剩餘是到該層所有條件都通過，不把兩種數字混用。</p>
   <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="漏斗比較期間">{[[1,'今天'],[2,'今天與前一交易日'],[5,'最近 5 日'],[20,'最近 20 日']].map(([n,label])=><button type="button" className="min-h-11 rounded border px-3 py-2" aria-pressed={window===n} key={n} onClick={()=>setWindow(Number(n))}>{label}</button>)}</div>
   {!displayed.length?<p className="mt-3 text-sm">尚無新自然觸發的每日紀錄；舊研究保留，不回填成自然 Forward。</p>:displayed.map(day=><details className="mt-3" key={String(day.business_date)}><summary>{String(day.business_date)} · {String(day.evaluation_phase)} · 觀察 {metric(object(day.counts).WATCH)}／達標 {metric(object(day.counts).READY)}／不採用 {metric(object(day.counts).NONE)}／缺口 {metric(object(day.counts).BLOCKED)}</summary>
    <ul className="mt-2 space-y-1 text-sm">{rows(day.funnel).map(g=><li key={String(g.gate)}>{labels[String(g.gate)]||String(g.gate)}：獨立通過 {metric(g.independent_pass)}，逐層剩餘 {metric(g.cumulative_pass)}</li>)}</ul></details>)}
   <p className="mt-3 text-sm">連續資料缺口：{health.blocked_trading_days} 個交易日。{health.service_status==='SERVICE_DEGRADED'?'已達服務降級警戒。':health.service_status==='WARNING'?'已達警告門檻。':'尚未達 3 日警告門檻。'}</p>
   <p className="mt-2 text-sm">連續無觀察／達標：{health.zero_candidate_days} 個交易日。{health.zero_candidate_review==='ZERO_CANDIDATE_REVIEW'?'啟動零候選研究：檢視淘汰條件集中、72 檔範圍與市場適配；不自動改規則或擴大範圍。':'滿 5 個交易日才啟動零候選研究檢視。'}</p>
   {health.zero_candidate_review==='ZERO_CANDIDATE_REVIEW'?<article className="mt-3 rounded border p-3"><h4 className="font-semibold">零候選研究檢視（不更改規則）</h4>
    <p className="mt-2 text-sm">最常出現的未達條件如下；同一股票可有多個原因，次數不是不同股票數，也不是勝率。</p>
    <ul className="mt-2 text-sm">{health.most_frequent_reasons.slice(0,5).map(([reason,count])=>{const gate=Object.entries(V2_GATE_REASONS).find(([,codes])=>codes.includes(reason))?.[0];return <li key={reason}>{gate?labels[gate]:'其他證據條件'}：{count} 次<details><summary>核對原始分類</summary>{reason}</details></li>;})}</ul>
    <p className="mt-2 text-sm">72 檔不是全市場；名單範圍、當時市場與方法限制仍需分別研究。僅凭零候選不能證明方法過嚴，也不能證明市場沒有機會；擴大候選稽核不會修改正式 Universe。</p>
   </article>:null}
   {health.missing_execution_dates.length?<details className="mt-2 text-sm"><summary>未有完整自然執行紀錄的日期</summary><p className="break-words">{health.missing_execution_dates.join('、')}</p><p>不將這些日期補成 NONE 或 Forward 樣本。</p></details>:null}
  </section>
 </section>;
}
