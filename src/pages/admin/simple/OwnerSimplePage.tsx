import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { object, rows, text, numeric, readOwnerStatus, ownerSummary, officialStatus, STATUS_LABEL, taipeiTime, taipeiDate, type RecordValue, type SummaryItem, type OwnerStatus } from '@/features/owner/status';
import './owner-simple.css';

export type SimplePage = 'today'|'system'|'health'|'data'|'learning';
const PAGES = {
 today:['今日狀況','今天 Morning Alpha 正常嗎？'], system:['系統檢查','目前系統狀況'],
 health:['系統健康','最近系統穩定嗎？'], data:['資料檢查','今天的資料可以相信嗎？'],
 learning:['分析成效','Morning Alpha 最近判斷準不準？'],
};
function Badge({status}:{status:OwnerStatus}) { return <span className={`owner-status owner-status-${status}`}>{STATUS_LABEL[status]}</span>; }
function Card({item}:{item:SummaryItem}) { return <article className="owner-simple-card"><div className="owner-card-top"><h3>{item.title}</h3><Badge status={item.status}/></div><p>{item.detail}</p><small>資料日期：{item.date||'尚未取得'}</small></article>; }
function Metrics({r}:{r:RecordValue}) {
 const quality=object(r.quality),stock=object(quality.stock_shadow),snapshot=object(stock.latest_snapshot),counts=object(snapshot.counts);
 const metrics=rows(quality.market_direction),n=numeric(stock.forward_sample);
 return <>
  <section className="owner-simple-card"><h2>市場方向</h2><p>只比較市場方向判斷與收盤結果，不是股票推薦勝率，也不是實際交易績效。</p>
   <div className="owner-simple-grid">{metrics.map(m=><article className="owner-metric" key={text(String(m.days))}><h3>最近 {String(m.days)} 天</h3>
    <strong>{m.truncated===false&&numeric(m.accuracy)!==null&&Number(m.independent_days)>=5?`${m.accuracy}%`:'資料不足'}</strong>
    <p>有效樣本 {String(m.samples)} 筆・{String(m.independent_days)} 個獨立交易日</p><p>與基準比較：尚無可對照的正式基準結果。</p>
    <small>{m.truncated?'讀取上限已達，不以部分資料估算完整準確率。':'目前資料不足，尚不能判斷長期準確率；短期數字不代表未來表現。'}</small>
   </article>)}</div>
  </section>
  <section className="owner-simple-card"><h2>股票推薦研究</h2><p>第二版僅供研究觀察，尚未對會員發布。與第一版正式推薦分開。</p>
   <div className="owner-simple-grid"><div className="owner-metric"><h3>前瞻觀察樣本</h3><strong>{n??'尚未取得'}</strong><p>只計前瞻樣本，不把歷史重播算進來。</p></div>
   <div className="owner-metric"><h3>完成全部觀察期間</h3><strong>{numeric(stock.completed_forward_dates)??'尚未取得'}</strong><p>獨立交易日；不是獲利次數。</p></div>
   <div className="owner-metric"><h3>最新候選狀態</h3><p>等待確認：{numeric(counts.WATCH)??'尚未取得'} 檔</p><p>符合研究條件：{numeric(counts.READY)??'尚未取得'} 檔</p><small>資料日期：{text(snapshot.business_date)||'尚未取得'}</small></div></div>
   <p className="owner-note">{n===0?'尚未累積前瞻驗證樣本。':'樣本仍需累積與獨立驗證。'}目前不能據此宣稱選股有效。</p>
   <p>選股勝率、平均報酬與最大回撤：未取得足夠且口徑一致的有效績效樣本，不顯示估算數字。</p>
   <Link className="owner-simple-link" to="/admin/analysis">查看分析中心：正式推薦、研究觀察、模擬交易與 Sony 實際交易分開查看 →</Link>
  </section>
 </>;
}
function DataCards({r}:{r:RecordValue}) {
 const summary=ownerSummary(r),market=summary.items.find(x=>x.key==='market')!,news=object(r.news),stock=object(r.stock_data);
 const currentStock=stock.business_date===r.today_date,stockTotal=numeric(stock.universe),stockPassed=numeric(stock.historical_20d);
 const stockComplete=currentStock&&stockTotal!==null&&stockTotal>0&&stockPassed===stockTotal&&stock.failed_captures===0;
 const latest=rows(r.batches).filter(x=>x.status==='COMMITTED').sort((a,b)=>text(b.committed_at).localeCompare(text(a.committed_at)))[0];
 const closing=summary.flow.find(x=>x.key==='closing')!;
 const items:SummaryItem[]=[
  {...market,title:'核心市場資料',detail:market.detail+' 整體營運判定以正式驗收結果為準。'},
  {key:'overseas',title:'海外市場資料',status:market.status,detail:market.status==='PASS'?'盤前完整批次已包含海外市場來源；不以台灣日期要求海外市場當日開盤。':'尚未確認今日完整海外來源，不以資料存在就當作完整。',date:text(r.today_date)},
  {key:'stock',title:'股票量價資料',status:stockComplete?'PASS':currentStock?'DATA_MISSING':'NOT_OBSERVED',detail:currentStock?`已保存並通過來源驗證的二十日量價資料：${stockPassed??'未知'}／${stockTotal??'未知'} 檔。這是個股資料範圍，不是核心市場方向評分。`:'尚未取得今天個股量價的正式取得摘要；不推論股票資料完整，也不推論市場方向錯誤。',date:text(stock.business_date)},
  {key:'news',title:'市場新聞',status:numeric(news.selected_48h)!==null&&Number(news.selected_48h)>0?'NOT_OBSERVED':'DATA_MISSING',detail:`近兩天已選新聞 ${numeric(news.selected_48h)??'尚未取得'} 則；筆數不等於研究品質通過，是否影響判斷仍以正式研究結果為準。`,date:text(news.latest_at)?taipeiDate(text(news.latest_at)):''},
  {...closing,title:'收盤資料',detail:closing.detail+(latest?` 最近市場資料完成於 ${taipeiTime(text(latest.committed_at))}。`:'')},
 ];
 return <div className="owner-simple-grid">{items.map(item=><Card key={item.key} item={item}/>)}</div>;
}

export default function OwnerSimplePage({page}:{page:SimplePage}) {
 const [data,setData]=useState<RecordValue|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let live=true,generation=0;
  const load=async(g:number)=>{
   setLoading(true);setData(null);setError('');
   try{
    const {data:result,error:failure}=await supabase.rpc('get_owner_backend_status_v1');
    if(!live||g!==generation)return;
    if(failure)throw Error(failure.code==='42501'?'OWNER_REQUIRED':'OWNER_READ_UNAVAILABLE');
    setData(readOwnerStatus(result));
   }catch(e){if(live&&g===generation)setError(e instanceof Error?e.message:'OWNER_READ_UNAVAILABLE');}
   finally{if(live&&g===generation)setLoading(false);}
  };
  const auth=supabase.auth.onAuthStateChange(event=>{
   if(!['SIGNED_OUT','SIGNED_IN','TOKEN_REFRESHED'].includes(event))return;
   const g=++generation;setData(null);
   if(event==='SIGNED_OUT'){setError('OWNER_REQUIRED');setLoading(false);}
   else setTimeout(()=>{if(live&&g===generation)void load(g);},0);
  });
  void load(generation);
  return ()=>{live=false;generation++;auth.data.subscription.unsubscribe();};
 },[refresh]);
 return <OwnerSimpleView page={page} data={data} loading={loading} error={error} onRefresh={()=>setRefresh(x=>x+1)}/>;
}

/** Presentational view shared by real Owner reads and clearly labeled isolated UI tests. */
export function OwnerSimpleView({page,data,loading=false,error='',onRefresh}:{page:SimplePage;data:RecordValue|null;loading?:boolean;error?:string;onRefresh:()=>void}) {
 const summary=data?ownerSummary(data):null;
 return <div className="owner-simple" data-owner-page={page}>
  <header className="owner-simple-header"><div><p className="owner-eyebrow">管理後台・{PAGES[page][0]}</p><h1>{PAGES[page][1]}</h1><p>{data?`${data.today_date}・台北時間 ${taipeiTime(text(data.as_of))} 的唯讀結果`:'僅限正式 Owner；不更動正式業務'}</p></div><button onClick={onRefresh} disabled={loading}>重新整理</button></header>
  {loading?<section className="owner-simple-card" role="status">正在讀取正式狀態，尚未判定正常或異常。</section>:error?<section className="owner-simple-card" role="alert"><h2>{error==='OWNER_REQUIRED'?'此頁僅限 Sony Owner':'暫時無法取得正式驗證結果'}</h2><p>{error==='OWNER_REQUIRED'?'登入一般或付費會員帳號也不能讀取後台資料。登出後不保留研究內容。':'目前不能判定系統正常；請重新整理。這是讀取結果，不會自動執行修復或補發。'}</p><Link className="owner-simple-link" to="/account">前往帳號頁</Link><details><summary>查看技術詳細資料</summary><pre>{error}</pre></details></section>:data&&summary&&<>
   {page!=='learning'&&<section className="owner-simple-card owner-overview"><div><p>正式營運驗收</p><Badge status={summary.status}/><p>{summary.acceptanceDate===data.today_date?'沿用今天已保存的正式判定，未在前端重新評分。':`今天尚無正式整體判定；最近已保存的驗收日期：${summary.acceptanceDate||'尚未取得'}。`}</p></div><div><h2>今天需要我處理什麼？</h2><p>{summary.action}</p></div></section>}
   {page==='today'&&<div className="owner-simple-grid">{summary.items.map(item=><Card key={item.key} item={item}/>)}<article className="owner-simple-card"><h3>下一次更新時間</h3><strong>{summary.next?`${taipeiDate(summary.next.at)} ${taipeiTime(summary.next.at)}`:'尚未取得'}</strong><p>依正式排程與台股交易日曆。排程時間不是完成保證。</p></article></div>}
   {page==='system'&&<div className="owner-simple-grid">{summary.flow.filter(x=>x.key!=='learning').map(item=><Card key={item.key} item={item}/>)}</div>}
   {page==='health'&&<><div className="owner-simple-grid">{summary.flow.filter(x=>['report','market','line','learning'].includes(x.key)).map(item=><Card key={item.key} item={item}/>)}</div><section className="owner-simple-card"><h2>最近正式驗收紀錄</h2><p>歷史故障如實保留；後一天正常不等於前一天故障已被改寫或修復。</p><div className="owner-history">{rows(data.history).length?rows(data.history).map(h=><article key={text(h.business_date)}><strong>{text(h.business_date)}</strong><Badge status={officialStatus(h.overall_status||h.verdict)}/><p>{h.verdict==='PASS'?'當日正式驗收完成。':'當時有未完成或受限項目；原始檢查保留在技術詳細資料。'}</p><small>是否已恢復：未提供同一事故的恢復證據。</small></article>):<p>尚無歷史驗收資料。</p>}</div><p className="owner-note">舊健康分數只供診斷，保留在詳細資料中，不覆蓋目前正式營運判定。</p></section></>}
   {page==='data'&&<DataCards r={data}/>}
   {page==='learning'&&<Metrics r={data}/>}
   <details className="owner-simple-card owner-technical"><summary>查看技術詳細資料</summary><p>以下為唯讀資料契約、原始狀態、來源版本、時間與歷史診斷。不是另一套營運判定。</p><pre>{JSON.stringify(data,null,2)}</pre></details>
   <footer>僅供 Owner 查看・不會執行重送、補資料或改變投資策略</footer>
  </>}
 </div>;
}
