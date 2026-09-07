import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../../src/index.css';
import { DecisionBrief, DecisionEvidence } from '../../src/features/decision-v1/DecisionBrief';
import { evaluateDecisionV1 } from '../../src/features/decision-v1/engine';
import { decisionFixture, DAY } from '../fixtures/decision-v1.mjs';

// Explicit render fixture, not a fake Auth service, real route, provider, or production report.
if (import.meta.env.PROD || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Local serve-only fixture');
function Harness() {
  const [scenario, setScenario] = useState('EXTENDED');
  const input = decisionFixture();
  if (scenario === 'EXTENDED') { input.price_state = 'EXTENDED'; Object.values(input.entry).forEach((m: { value: number }) => { m.value = .35; }); }
  if (scenario === 'MISSING') input.entry.risk_reward = null;
  if (scenario === 'NO_QUALIFIED') input.stock_opportunities = [];
  if (scenario === 'DAMAGED') { input.stock_opportunities[0].price_state = 'SELLOFF'; input.stock_opportunities[0].transmission.fundamental_impact = 'DAMAGED'; }
  if (scenario === 'MISPRICING') input.stock_opportunities[0].price_state = 'SELLOFF';
  const decision = evaluateDecisionV1(input, DAY);
  return <main className="ma-page">
    <aside style={{padding:'12px 20px',color:'#cbd5e1'}}><strong>隔離 UI 測試 · 合成資料，非正式市場報告</strong><label style={{display:'block'}}>測試情境 <select aria-label="測試情境" value={scenario} onChange={e=>setScenario(e.target.value)}>{['EXTENDED','MISSING','NO_QUALIFIED','DAMAGED','MISPRICING'].map(value=><option key={value}>{value}</option>)}</select></label></aside>
    <DecisionBrief decision={decision} date={DAY} marketBias="合成方向評估" legacyInstruction="評估尚未完成，先等待" legacyReason="合成資料不足情境：不假裝完成篩選" legacyCount={0}/>
    <DecisionEvidence decision={decision} canShowStocks />
  </main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><Harness /></BrowserRouter>);
