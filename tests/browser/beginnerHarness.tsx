import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import '../../src/index.css';
import './harness.css';
import BeginnerTodayView from '../../src/pages/report/BeginnerTodayView';
import { getCurrentEntitlement } from '../../src/services/entitlementService';
import { canUseProductFeature } from '../../src/config/productFeatures';
import { canShowBeginnerRecommendations } from '../../src/features/learning/beginnerReportContract';
import { useReportDisplayMode } from '../../src/features/learning/useReportDisplayMode';
import type { UserEntitlement } from '../../src/types/subscription';
import { BEGINNER_FIXTURE } from './beginnerFixture';

// No Supabase session injection, network mocks, fake roles, or production report mutation.
function OwnerBeginnerHarness() {
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [authStatus, setAuthStatus] = useState('checking');
  const [mode, setMode] = useReportDisplayMode();
  const [scenario, setScenario] = useState('ACT');
  useEffect(() => {
    let active = true;
    void getCurrentEntitlement().then(value => {
      if (!active) return;
      setEntitlement(value);
      setAuthStatus(canUseProductFeature('beginner_report_mode', value) ? 'server_owner_verified' : 'owner_required');
    }).catch(() => { if (active) setAuthStatus('server_entitlement_unavailable'); });
    return () => { active = false; };
  }, []);
  const fixture = {
    ...BEGINNER_FIXTURE,
    action: ['WAIT', 'STOP'].includes(scenario) ? scenario : 'ACT',
    premiumEligible: scenario !== 'NO_PREMIUM',
    decisionMode: ['no_trade', 'blocked'].includes(scenario) ? scenario : 'recommendations',
    isHistoricalFallback: scenario === 'HISTORICAL',
    reportDate: scenario === 'WRONG_DATE' ? '2026-09-03' : BEGINNER_FIXTURE.reportDate,
  };
  const mayEnter = canUseProductFeature('beginner_report_mode', entitlement)
    && !fixture.isHistoricalFallback && fixture.reportDate === fixture.todayDate;
  const stocks = mayEnter && canShowBeginnerRecommendations(fixture) ? fixture.stocks : [];
  return <>
    <aside className="ma-owner-e2e" aria-label="隔離測試狀態">
      <strong>PR #100 LOCAL TEST FIXTURE — 非正式報告／非投資建議</strong>
      <p role="status">Auth: {authStatus} · server tier: {entitlement?.tier || 'unverified'} · 模擬台北交易日：{fixture.todayDate}</p>
      <label>測試情境<select value={scenario} onChange={e => setScenario(e.target.value)}>
        {['ACT', 'WAIT', 'STOP', 'NO_PREMIUM', 'no_trade', 'blocked', 'HISTORICAL', 'WRONG_DATE'].map(value => <option key={value}>{value}</option>)}
      </select></label>
    </aside>
    {mayEnter && mode === 'beginner' ? <BeginnerTodayView
      reportDate={fixture.reportDate}
      marketStatusLabel="隔離測試：交易日"
      scenario="測試情境：半導體與電子供應鏈的相對大盤表現是否同步，並持續核對成交量、資金擴散與失效條件。"
      explanation="這段長繁體中文只用來驗證閱讀與排版。資料、日期及標的均屬隔離測試情境；即使觀察方向一致，也不能把未驗證的推論視為確定結果，必須等待下一個確認點。"
      action={fixture.action === 'ACT' ? '條件成立，依既定風險規則觀察（測試）' : '等待，不顯示推薦股票（測試）'}
      nextCheckpoint="10:30 量價與相對大盤確認（測試）"
      stocks={stocks}
      confirmationItems={['成交量與價格同步（測試）', '代表股與相對大盤方向一致（測試）']}
      invalidationItems={['量價與相對大盤出現相反證據時，原情境不再適用（測試）']}
      avoidAction="不要把隔離測試資料當成今日正式投資建議。"
      onShowProfessional={() => setMode('professional')}
    /> : <main className="ma-owner-e2e">
      <h1>小白模式 Browser E2E</h1>
      {mayEnter ? <button type="button" onClick={() => setMode('beginner')}>切換小白模式</button>
        : <p>無符合條件的入口：需伺服器 Owner 權限、同一測試日期且非歷史 fallback。</p>}
    </main>}
  </>;
}

function HarnessNavigationBoundary() {
  const location = useLocation();
  const isFixture = location.pathname === '/__e2e/beginner' && !location.search && !location.hash;
  useEffect(() => {
    if (!isFixture) {
      // Let the normal application entry render the destination; never keep mock
      // content alive under a real route. The production router stays untouched.
      window.location.replace(location.pathname + location.search + location.hash);
    }
  }, [isFixture, location.pathname, location.search, location.hash]);
  return isFixture ? <OwnerBeginnerHarness /> : null;
}

if (!import.meta.env.DEV || window.location.origin !== 'http://localhost:3000'
  || window.location.pathname !== '/__e2e/beginner' || window.location.search) {
  throw new Error('Local, query-free Owner E2E only');
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><HarnessNavigationBoundary /></BrowserRouter></StrictMode>);
