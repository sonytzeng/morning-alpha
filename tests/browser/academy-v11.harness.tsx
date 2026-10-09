import {createRoot} from 'react-dom/client';
import AcademyPage from '../../src/pages/academy/page';
import {switchTestIdentity} from './academy-v11.mock';
createRoot(document.getElementById('root')!).render(<><aside style={{padding:12,background:'#fff1d2',color:'#40331c',font:'14px system-ui'}}>
 <strong>隔離候選預覽 · 測試身分，不是 Sony 正式 Owner</strong><p>原創教材＋真正 PostgreSQL RLS；不連線 Production。角色切換僅供測試，正式頁面不存在。</p>
 {['anonymous','free','premium','owner','other'].map(role=><button key={role} type="button" style={{minHeight:44,margin:4}} onClick={()=>void switchTestIdentity(role)}>{role}</button>)}</aside><AcademyPage/></>);
