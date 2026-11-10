import {useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {AcademyAccess} from '../../src/pages/academy/useAcademyAccess';
import DailyAiOwnerPricePlans from '../../src/pages/vnext/DailyAiOwnerPricePlans';
import {getReadCounts,subscribeReadCounts} from './ownerPriceCalculationSupabaseMock';
import '../../src/pages/vnext/vnext.css';
import './owner-price-calculation-preview.css';

const OWNER='00000000-0000-4000-8000-000000000101';
function identity(generation:number){const controller=new AbortController();return {controller,access:{kind:'member',id:OWNER,generation,signal:controller.signal,
 catalog:{version:'ACADEMY_MEMBER_V11',user_id:OWNER,tier:'owner',chapters:[],progress:[]}} satisfies AcademyAccess};}
function Preview(){
 const [session,setSession]=useState(()=>identity(1)),[signedIn,setSignedIn]=useState(true),counts=useSyncExternalStore(subscribeReadCounts,getReadCounts);
 const access:AcademyAccess=signedIn?session.access:{kind:'denied'};
 return <div className="vnext"><header className="fixture-banner"><strong>本地合成流程驗證 · 非真實股票推薦</strong><p>以下公司、價格與來源都為測試資料。正式 Supabase、登入與寫入皆未連線；不代表任何來源授權、策略成效或發布驗收。</p>
  <button type="button" onClick={()=>{if(signedIn){session.controller.abort();setSignedIn(false);}else{setSession(identity(session.access.generation+1));setSignedIn(true);}}>{signedIn?'模擬登出，隱藏私人內容':'恢復合成 Owner 工作階段'}</button>
  <p role="status">本地讀取：價格清單 {counts.prices} 次 · 單筆計算 {counts.calculations} 次 · 被攔截寫入 {counts.blockedWrites} 次</p>
 </header><main className="vnext-content"><h1>價格審查：先核對，再決定</h1><p>使用實際 Owner 元件、實際計算器產物與相同內容驗證。請切換短、中、長期，再開啟某張卡片的「核對公式、假設與來源」。</p>
  {signedIn?<DailyAiOwnerPricePlans access={access} editionId={'a'.repeat(64)}/>:<section className="vnext-empty" role="status"><h2>私人計算內容已隱藏</h2><p>這是合成登出驗證。恢復工作階段後會重新讀取，不沿用前一身分的明細。</p></section>}
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
