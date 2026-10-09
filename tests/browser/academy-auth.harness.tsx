import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {supabase} from './academy-auth.client';
import MemberAcademy from '../../src/pages/academy/MemberAcademy';
function AuthAcceptance() {
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 return <><details style={{padding:12,background:'#fff1d2',color:'#40331c',font:'14px system-ui'}}>
 <summary>驗收環境說明與登入</summary><p>本機隔離環境，使用真正的 Supabase 登入；不是正式會員網站。帳號權限由資料庫決定，沒有角色切換器。</p>
 <form onSubmit={async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.auth.signInWithPassword({email,password});setPassword('');setMessage(error?'登入失敗，請確認帳號與密碼。':'登入成功');setBusy(false);}}>
 <label>電子郵件<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
 <label>密碼<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
 <button disabled={busy}>登入</button><button type="button" disabled={busy} onClick={async()=>{setBusy(true);const {error}=await supabase.auth.signOut();setPassword('');setMessage(error?'登出未完成':'已登出');setBusy(false);}}>登出</button><p role="status">{message}</p>
 </form></details><MemberAcademy/></>;
}
createRoot(document.getElementById('root')!).render(<AuthAcceptance/>);
