import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {supabase} from './vnext.client';
import MembershipStatusCard from '../../src/components/membership/MembershipStatusCard';
import Pricing from '../../src/pages/pricing/Pricing';
import MemberPage from '../../src/pages/vnext/MemberPage';
import MorningHeroCard from '../../src/pages/account/components/MorningHeroCard';
import '../../src/index.css';
function Preview(){
 const [id,setId]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{const {data}=supabase.auth.onAuthStateChange((_event,s)=>setId(s?.user.id||''));return()=>data.subscription.unsubscribe();},[]);
 return <BrowserRouter><aside style={{padding:16,background:'#fff0ce',color:'#503610'}}><strong>隔離會員政策預覽｜真實本機登入，不是正式帳號或付款驗收</strong><details><summary style={{padding:12}}>驗收環境登入</summary>
 <form style={{display:'flex',gap:12,flexWrap:'wrap'}} onSubmit={async e=>{e.preventDefault();const {error}=await supabase.auth.signInWithPassword({email,password});setPassword('');setMessage(error?'登入失敗':'登入成功');}}>
 <label>電子郵件<input style={{display:'block',maxWidth:'100%',color:'#111'}} type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>密碼<input style={{display:'block',maxWidth:'100%',color:'#111'}} type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button>登入</button>
 <button type="button" onClick={()=>void supabase.auth.signOut()}>結束驗收登入</button><p role="status">{message}</p></form></details>
 <nav style={{display:'flex',gap:16,flexWrap:'wrap'}}><a href="/membership">我的權益</a><a href="/pricing">會員方案</a><a href="/stocks">股票觀察</a><a href="/schedule-review">排程顯示驗收</a></nav></aside>
 {location.pathname==='/pricing'?<Pricing/>:location.pathname==='/stocks'?<MemberPage/>:location.pathname==='/schedule-review'?<main style={{minHeight:'90vh',padding:20,background:'#020812'}}><h1 style={{color:'white',fontSize:24}}>排程元件隔離驗收｜沒有報告或投資結果</h1><MorningHeroCard todayReport={null} hasTodayReport={false} streak={0} isWeekend={false} hasAnyReport={false}/></main>:<main style={{minHeight:'90vh',padding:20,background:'#020812'}}><div style={{maxWidth:1100,margin:'auto'}}><h1 style={{color:'white',fontSize:28,marginBottom:20}}>我的會員權益</h1><MembershipStatusCard key={id}/></div></main>}</BrowserRouter>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
