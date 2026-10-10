import {useState,lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {supabase} from './vnext.client';
import VNextPage from '../../src/pages/vnext/page';
const MemberAcademy=lazy(()=>import('../../src/pages/academy/MemberAcademy'));
function Preview(){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState('');
 return <><aside style={{padding:12,background:'#fff0ce',color:'#503610',font:'14px system-ui'}}><strong>隔離研究預覽 · 所有示範股票與資料均為測試，不是真實行情</strong>
 <details open={window.location.pathname==='/login'}><summary style={{padding:'10px 0',cursor:'pointer'}}>驗收環境登入</summary><p>使用本機 Supabase 真實登入，不是 Sony 正式帳號。沒有前端角色切換器。</p>
 <form style={{display:'flex',gap:12,flexWrap:'wrap'}} onSubmit={async e=>{e.preventDefault();const {error}=await supabase.auth.signInWithPassword({email,password});setPassword('');setMessage(error?'登入失敗':'登入成功');}}>
 <label>電子郵件<input style={{display:'block',maxWidth:'100%',padding:8}} type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>密碼<input style={{display:'block',maxWidth:'100%',padding:8}} type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button>登入</button><button type="button" onClick={async()=>{await supabase.auth.signOut();setPassword('');setMessage('已登出');}}>登出</button><p role="status">{message}</p></form></details></aside>
 {window.location.pathname==='/academy'?<Suspense fallback={<p role="status">正在開啟股票學院</p>}><MemberAcademy/></Suspense>:<VNextPage/>}</>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<Preview/>);
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount());
