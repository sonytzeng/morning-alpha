import { createRoot } from 'react-dom/client';
import AcademyPage from '../../src/pages/academy/page';
function identity(detail: string) { window.dispatchEvent(new CustomEvent('academy-synthetic-identity', { detail })); }
createRoot(document.getElementById('root')!).render(<>
  <aside style={{ background: '#fce8c4', color: '#402f12', padding: 12, font: '12px system-ui', overflowWrap: 'anywhere' }}>
    <strong>LOCAL SYNTHETIC IDENTITY · 非正式 Owner 授權</strong>
    <p>只驗證 UI；沒有 Production SDK、憑證、私有教材或外部請求。登入角色與真實 Owner 無關。</p>
    <button type="button" onClick={() => identity('signed-out')}>模擬登出</button>{' '}
    <button type="button" onClick={() => identity('owner2')}>切換合成身份</button>{' '}
    <button type="button" onClick={() => identity('refresh-denied')}>模擬權限撤銷</button>
  </aside><AcademyPage />
</>);
