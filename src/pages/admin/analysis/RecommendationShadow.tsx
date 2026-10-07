import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { summarizeV2Outcomes, type SummaryOutcome } from '../../../features/research/recommendation-shadow-v2-summary';
import { currentMarket, readTradingLab } from '../../../features/research/tradingLab';
import { analysisLabel } from '../../../features/research/intelligence';
import ForwardBrief from './ForwardBrief';
import { v2SampleStatus } from '../../../features/research/recommendation-v2-forward';

type RecordValue = Record<string, unknown>;
const object = (x: unknown): RecordValue => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as RecordValue : {};
const list = (x: unknown): RecordValue[] => Array.isArray(x) ? x.map(object) : [];
const texts = (x: unknown): string[] => Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
const number = (x: unknown) => typeof x === 'number' && Number.isFinite(x) ? x : null;
const display = (x: unknown) => number(x) === null ? '未取得' : number(x)!.toLocaleString('zh-TW', { maximumFractionDigits: 4 });
const reasons: Record<string, string> = {
 MARKET_SOURCE_INVALID:'當時的大盤來源不完整，不能判斷',OHLC_VOLUME_AMOUNT_20_SESSIONS_INVALID:'缺少完整 20 個交易日量價',
 BENCHMARK_SESSION_HISTORY_MISSING:'缺少相同日期的大盤比較資料',MARKET_DOWNSIDE_RISK:'市場跌幅超出研究風險範圍',
 OBSERVED_LIQUIDITY_INSUFFICIENT:'實際成交不足，不適合這套研究條件',NEGATIVE_MOMENTUM:'近期價格趨勢仍偏弱',
 UNDERPERFORMING_MARKET:'表現弱於同期大盤',SECTOR_COMPARISON_INSUFFICIENT:'同產業可比較股票不足',SECTOR_TREND_NEGATIVE:'同產業近期表現偏弱',
 VOLUME_CONFIRMATION_PENDING:'成交量尚未放大確認',INSTITUTIONAL_DIRECTION_UNAVAILABLE:'法人股數方向尚不完整',
 INSTITUTIONAL_SELLING_PRESSURE:'法人合計呈淨賣出',ACTUAL_GROWTH_UNAVAILABLE:'實際營收趨勢尚不完整',
 ACTUAL_REVENUE_DETERIORATION:'月營收成長轉弱',ACTUAL_REPORTED_EPS_NEGATIVE:'官方最近揭露每股盈餘為負',EVENT_SOURCE_UNAVAILABLE:'官方公司事件來源不完整',
 MATERIAL_EVENT_IMPACT_UNASSESSED:'有重大公告，影響仍待研究，不直接當利多',STOP_DISTANCE_OUTSIDE_RESEARCH_RISK_BUDGET:'失效價位距離超出風險預算',
 POSITIVE_COMPLETED_PRICE_TREND:'已完成交易日的價格趨勢向上',NOT_UNDERPERFORMING_TAIEX:'同期表現不弱於加權指數',
 INSTITUTIONAL_NET_BUY_SHARES:'三大法人股數合計淨買入',ACTUAL_REVENUE_YOY_NONNEGATIVE:'實際月營收年增率非負',
};
const label = (s: string) => reasons[s] || '此項證據需核對，請展開來源詳細資訊';
const stateLabel: Record<string, string> = { READY:'研究條件齊全，仍須等待進場條件',WATCH:'值得觀察，還有待確認項目',NONE:'完整評估後，不符合本研究條件',BLOCKED:'必要資料或系統缺口，無法判定' };
const evidenceLabels: Record<string,string> = {market:'市場配合',sector:'產業配合',liquidity:'成交活絡程度',relative_strength:'與大盤相比',momentum:'價格趨勢',volume_price:'量價確認',institutional:'法人股數方向',fundamental:'實際營收／財務趨勢',catalyst:'公司公告情境',risk:'風險',entry:'進場與失效條件'};
const box='rounded-xl border bg-white p-4';

export function RecommendationShadowView({ data }: { data: RecordValue }) {
 const latest=object(data.latest),candidates=list(latest.candidates),counts=object(latest.counts),market=object(data.market_overview);
 const [symbol,setSymbol]=useState('');
 const ordered=[...candidates].sort((a,b)=>['READY','WATCH','NONE','BLOCKED'].indexOf(String(a.status))-['READY','WATCH','NONE','BLOCKED'].indexOf(String(b.status))||String(a.symbol).localeCompare(String(b.symbol)));
 const candidate=ordered.find(c=>c.symbol===symbol)||ordered[0],entry=object(candidate?.entry),metrics=object(candidate?.evidence);
 const problems=candidate?[...texts(candidate.blockers),...texts(candidate.rejections),...texts(candidate.pending)]:[];
 const outcomes=list(data.outcomes).filter(o=>typeof o.prediction_id==='string'&&typeof o.horizon==='number') as SummaryOutcome[];
 const statusDates=object(data.forward_dates_by_status);
 const summary=data.outcomes_truncated?null:summarizeV2Outcomes(outcomes,texts(data.forward_dates),{READY:texts(statusDates.READY),WATCH:texts(statusDates.WATCH)});
 const percent=(n:number|null)=>n===null?'尚無足夠結果':`${(n*100).toFixed(2)}%`;
 return <section className="space-y-4" aria-labelledby="recommendation-shadow-title">
  <section className={box} aria-label="今天市場怎麼看"><h1 className="text-2xl font-semibold">今天市場怎麼看，現在該不該進？</h1>
   {market.date===data.today_date?<><p className="mt-2 text-sm">{String(market.date)} · 沿用正式市場判斷，不由 V2 改寫</p>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['市場型態',analysisLabel(String(market.regime))],['市場方向',String(market.direction)],['正式操作',analysisLabel(String(market.action))],['風險',market.risk?analysisLabel(String(market.risk)):'待當日證據']].map(([k,v])=><div key={k}><dt className="text-sm text-slate-600">{k}</dt><dd className="font-semibold">{v}</dd></div>)}</dl>
    <p className="mt-3">{String(market.conclusion)}</p><p className="mt-2 text-sm">{String(market.waitReason)}</p></>:<p className="mt-2 text-sm">今日市場唯讀資料尚未可用，不以較早研究代替；下方 V2 只代表標示截點的觀察。</p>}
  </section>
  <header><p className="text-sm text-amber-700">Owner 專用 · 新方法研究 · 不影響正式推薦或 LINE</p><h2 id="recommendation-shadow-title" className="mt-2 text-2xl font-semibold">今天有哪些股票值得觀察？</h2>
   <p className="mt-2 text-sm">V1 保留原正式門檻。V2 研究實際營收、法人股數與量價，不把不存在的共識預估補成零，也不把公告自動解讀成利多。</p></header>
  {!candidate?<p className={box} role="status">尚無已保存的 V2 比較。沒有股票名單不代表已完整評估；本頁不觸發採集、不補跑，也不產生 Forward 樣本。</p>:<>
   <section className={box}><p>{String(latest.business_date)} · 研究範圍 {display(latest.universe)} 檔，非全市場</p>
    {latest.business_date!==data.today_date?<p className="mt-2 text-sm text-amber-700" role="status">這是已保存的較早研究，不是今日新評估；休市或尚無今日執行結果時，不沿用為今日判斷。</p>:null}
    <p className="mt-2 text-sm">相同資料截點比較：V1 資料缺口 {candidates.filter(c=>c.v1_status==='BLOCKED').length} 檔。V1 仍要求法人金額與市場共識等正式證據；法人股數不等於金額、實際財報不等於共識。V2 只獨立研究可驗證的實際資料，不因缺少共識預估自動阻擋，也不取代 V1。</p>
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['WATCH','待確認'],['READY','研究達標'],['NONE','評估後不採用'],['BLOCKED','必要資料缺口']].map(([key,title])=><div key={key}><dt className="text-sm text-slate-600">{title}</dt><dd className="text-2xl font-semibold">{display(counts[key])}</dd></div>)}</dl>
    <p className="mt-3 text-sm text-amber-700">研究達標不是正式推薦，不是自動下單，也不代表已通過成效驗證。</p>
   </section>
   <ForwardBrief data={data} onInspect={setSymbol}/>
   <section className={box}><label>查看股票<select value={String(candidate.symbol)} onChange={e=>setSymbol(e.target.value)} className="max-w-full rounded border p-2">{ordered.map(c=><option key={String(c.symbol)} value={String(c.symbol)}>{String(c.symbol)} · {stateLabel[String(c.status)]}</option>)}</select></label>
    <h3 className="mt-4 text-lg font-semibold">{String(candidate.symbol)}：{stateLabel[String(candidate.status)]||'狀態待確認'}</h3>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><h4 className="font-semibold">哪些訊號支持？</h4><ul className="mt-2 space-y-2 text-sm">{texts(candidate.supporting).map(s=><li key={s}>{label(s)}</li>)}</ul>{!texts(candidate.supporting).length?<p className="mt-2 text-sm">尚無經驗證的支持訊號。</p>:null}</div>
     <div><h4 className="font-semibold">哪些反對，還要等什麼？</h4><ul className="mt-2 space-y-2 text-sm">{problems.map(s=><li key={s}>{label(s)}</li>)}</ul>{!problems.length?<p className="mt-2 text-sm">研究條件齊全，但只在下一交易日原始進場條件成立時觀察結果。</p>:null}</div></div>
    <h4 className="mt-4 font-semibold">什麼條件才進？什麼情況失效？</h4>
    <p className="mt-2 text-sm">僅研究下一交易日（{String(entry.not_before||'尚未確定')}）突破 20 日高點 {display(entry.trigger_price)} 的情境；跌至 {display(entry.invalidation_price)} 失效。未觸發即到期，不追補進場；開盤跳空導致風險超標時也不進場。</p>
    <p className="mt-2 text-sm">證據信心：尚未完成 Forward 校準，不能解讀為上漲機率。證據完整度 {number(candidate.evidence_completeness)===null?'未量測':`${(number(candidate.evidence_completeness)!*100).toFixed(0)}%`} 不等於勝率。</p>
    <details className="mt-4"><summary>證據狀態、原始理由與來源</summary><dl className="grid gap-3 sm:grid-cols-2">{Object.entries(metrics).map(([key,value])=>{const m=object(value);return <div key={key}><dt className="font-semibold">{evidenceLabels[key]||key}</dt><dd>{({AVAILABLE:'可用',PARTIAL:'部分可用',UNAVAILABLE:'不可用'} as Record<string,string>)[String(m.status)]||'未知'}</dd><dd className="mt-1 break-words text-xs text-slate-500">{String(m.reason||'')}</dd></div>;})}</dl>
     <p className="mt-3 break-words text-xs">V1 原因：{texts(candidate.v1_reasons).join('、')||'未提供'}</p><p className="mt-2 break-words text-xs">V2 原因：{problems.join('、')||'無待確認項目'}</p>
     <p className="mt-2 break-words text-xs">方法：{String(latest.methodology_version)} · 截點：{String(latest.cutoff)} · Evidence：{String(latest.input_sha256)}</p>
    </details>
   </section>
  </>}
  <section className={box}><h3 className="font-semibold">後來結果如何？最近準不準？</h3>
   <p className="mt-2">Forward 日期 {display(data.forward_sample)} · 已觀測預測 {display(data.outcome_sample)}</p>
   <p className="mt-2 text-sm">Analysis Value：{v2SampleStatus(new Set(texts(data.forward_dates)).size)}。歷史重播、同日多股票與重跑，不會冒充獨立 Forward 交易日。樣本增加不代表策略已有效。</p>
   <p className="mt-2 text-sm">WATCH 是待確認的觀察，不是 READY 達標推薦。以下主要績效只計原始鎖定為 READY 的結果；WATCH 獨立列示，不混算勝率。</p>
   <p className="mt-2 text-sm">追蹤 1／3／5／10／20 交易日的價格報酬、盈虧、期望值、盈虧比與回撤；尚未到期就不顯示假結果。日線無法證明盤中先後，採保守停損優先；有利／不利走勢為日線估計，不是逐筆精確值。未計成本與股息，不等於實際交易或總報酬。</p>
   <details><summary>全期 WATCH／READY 結果（分開計算）</summary>
    <p className="mt-2 text-sm">完整到期的獨立 Forward 日期：{display(data.completed_forward_dates)}。Close 與本凍結方法的 1D 都是「下一個進場交易日收盤」，並非兩筆獨立觀測；3D／5D／10D／20D 沿用原契約。未設定獲利目標，不虛構 target hit。</p>
    {list(data.performance_all).map(r=><section key={`${String(r.prediction_status)}:${String(r.horizon)}`} className="mt-3 rounded border p-3"><h4>{r.prediction_status==='READY'?'條件達標研究':'待確認觀察研究'} · {r.horizon===1?'Close／1D':`${String(r.horizon)}D`}</h4><p>已觀測 {display(r.observed)} · 條件未觸發 {display(r.not_entered)} · 失效 {display(r.invalidation_hits)}</p><p>平均報酬 {percent(number(r.mean_return))} · 有利／不利變動 {percent(number(r.mean_mfe))}／{percent(number(r.mean_mae))}</p></section>)}
    {!list(data.performance_all).length?<p className="mt-2">尚無到期結果，不製造績效。</p>:null}
   </details>
   {summary?<details><summary>近期可完整讀取的研究結果明細</summary><div className="grid gap-3 sm:grid-cols-2">{summary.horizons.map(h=><section className="rounded border p-3" key={h.horizon}><h4>{h.horizon} 個交易日</h4><p>有效觀測 {h.entered_samples} · 未觸發 {h.not_entered} · 盈／虧 {h.wins}／{h.losses}</p><p>平均報酬／期望值：{percent(h.expectancy)}</p><p>平均有利／不利走勢：{percent(h.mean_mfe)}／{percent(h.mean_mae)}</p><p>盈虧比：{h.profit_factor===null?'未取得足夠虧損觀測，不宣稱無限大':display(h.profit_factor)}</p><p>同期出場等權組合回撤：{percent(h.cohort_drawdown)}</p></section>)}</div><p className="mt-2 text-sm">不同股票與期間可能重疊；以上出場日組合不是可投資組合，也不是帳戶淨值。</p></details>:null}
   {data.outcomes_truncated?<p className="mt-2 text-sm text-amber-700">結果超過單頁範圍；不以此截斷清單宣稱整體績效。</p>:null}
   {summary?<details><summary>待確認觀察（WATCH）的獨立追蹤</summary><p>Forward 日期 {display(summary.by_status.WATCH.forward_sample)} · 已觀測 {display(summary.by_status.WATCH.outcome_sample)}</p>{summary.by_status.WATCH.horizons.map(h=><p key={h.horizon}>{h.horizon} 日：觀測 {h.entered_samples}、未觸發 {h.not_entered}、條件研究平均報酬 {percent(h.expectancy)}；不是達標推薦績效。</p>)}</details>:null}
   <details><summary>已保存的結果（不是模擬成交紀錄）</summary>{list(data.outcomes).slice(0,20).map((o,i)=><p className="mt-2 text-sm" key={`${String(o.prediction_id)}:${String(o.horizon)}:${i}`}>{String(o.symbol||'來源待核對')} · {String(o.prediction_date||'')} 的研究 · {display(o.horizon)} 日：{o.state==='NOT_ENTERED'?'條件未觸發，不算交易或勝利':number(o.return)===null?'尚無可信結果':`${(number(o.return)!*100).toFixed(2)}%（未扣成本）`}</p>)}{!list(data.outcomes).length?<p>尚無到期結果。</p>:null}</details>
   <p className="mt-3 text-sm text-amber-700">即使有 20 個 Forward 日期，也只可提出方法審查；未經 Sony 核准，不會升級成正式推薦。</p>
  </section>
 </section>;
}

export default function RecommendationShadow(){
 const [state,setState]=useState<{kind:'loading'|'ready'|'denied'|'unavailable';data?:RecordValue}>({kind:'loading'});
 useEffect(()=>{let active=true,generation=0;const clear=()=>{generation++;if(active)setState({kind:'denied'});};
  const {data:subscription}=supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='SIGNED_IN')clear();});
  const g=generation;
  void supabase.rpc('get_owner_recommendation_v2_forward').then(async ({data,error})=>{
   if(!active||g!==generation)return;
   if(error){setState({kind:error.code==='42501'?'denied':'unavailable'});return;}
   const r=object(data);if(r.shadow_only!==true||r.promotion_allowed!==false){setState({kind:'unavailable'});return;}
   setState({kind:'ready',data:r});
   // Existing Owner read operation only. Never REFRESH_OUTCOMES or trade writes.
   try{
    const market=await supabase.functions.invoke('owner-trading-lab-v1',{body:{operation:'READ'}});
    if(!active||g!==generation||market.error)return;
    setState({kind:'ready',data:{...r,market_overview:currentMarket(readTradingLab(market.data))}});
   }catch{ /* Honest missing-market message; V2 read remains available. */ }
  },()=>{if(active&&g===generation)setState({kind:'unavailable'});});
  return()=>{active=false;subscription.subscription.unsubscribe();};
 },[]);
 if(state.kind==='ready'&&state.data)return <RecommendationShadowView data={state.data}/>;
 return <section className={box} role="status"><h2 className="font-semibold">個股新方法研究</h2><p className="mt-2 text-sm">{state.kind==='loading'?'確認研究存取權限中…':state.kind==='denied'?'只有具名授權 Owner 可讀取；未提供研究資料。':'研究候選尚未上線或暫時不可讀，正式市場與 V1 推薦不受影響。'}</p></section>;
}
