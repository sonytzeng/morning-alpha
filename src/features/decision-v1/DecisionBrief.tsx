import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Decision, Score } from './contract';
import { ACTION_LABEL, actionTone } from './engine';
import { opportunitySummary } from './presentation';
import GlossarySheet from '@/features/learning/GlossarySheet';
import './subscriber.css';

const DIRECTIONS = { BULLISH: '偏多', BEARISH: '偏空', RANGE: '區間整理' };
const REGIMES = { TREND: '趨勢行情', RANGE: '區間行情', RISK_OFF: '風險退避', HIGH_VOLATILITY: '高波動' };
const scoreText = (score: Score | null, unavailable: string) => score ? `${score.value}${score.meaning === 'probability' ? '%' : '/100'}` : unavailable;

export function SubscriberAnswer({ question, answer, reason, tone = 'blue', date, children }: {
  question: string; answer: string; reason: string; tone?: 'green' | 'amber' | 'red' | 'blue'; date?: string; children?: ReactNode;
}) {
  return <header className="ma-subscriber-answer" data-tone={tone}>
    <p className="ma-subscriber-eyebrow">{question}{date && <time>{date}</time>}</p>
    <h1>{answer}</h1><p className="ma-subscriber-reason">{reason}</p>{children}
  </header>;
}

export function DecisionBrief({ decision, date, marketBias, legacyInstruction, legacyReason, legacyCount, stocksWithheld = false, actions }: {
  decision: Decision; date: string; marketBias: string; legacyInstruction: string; legacyReason: string; legacyCount: number; stocksWithheld?: boolean; actions?: ReactNode;
}) {
  const [term, setTerm] = useState<string | null>(null);
  const hasAssessment = decision.action !== 'INSUFFICIENT_DATA';
  const direction = decision.market_direction ? DIRECTIONS[decision.market_direction] : marketBias;
  return <>
    <SubscriberAnswer question="今天市場怎麼看？" date={date} tone={actionTone(decision.action)}
      answer={direction && !['—', 'unknown', '尚未結構化'].includes(direction) ? direction : '先等待可核對的市場判斷'}
      reason={hasAssessment ? decision.reason_summary : legacyReason || decision.reason_summary}>
      <div className="ma-subscriber-three-answers">
        <div><h2>現在該怎麼做？</h2><strong>{hasAssessment ? ACTION_LABEL[decision.action] : legacyInstruction || ACTION_LABEL.INSUFFICIENT_DATA}</strong>
          {!hasAssessment && <p>新進場評估尚未完成，不將舊信心值當成進場分數。</p>}</div>
        <div><h2>有沒有值得關注的機會？</h2><strong>{opportunitySummary(decision, legacyCount, stocksWithheld)}</strong></div>
      </div>
      <dl className="ma-subscriber-metrics" aria-label="方向與進場分開評估">
        <div><dt>方向機率</dt><dd>{scoreText(decision.direction_probability, '尚無校準結果')}</dd></div>
        <div><dt>模型信心</dt><dd>{scoreText(decision.model_confidence, '證據尚未齊全')}</dd></div>
        <div><dt>進場環境</dt><dd>{scoreText(decision.entry_environment_score, '尚未完成評估')}</dd></div>
        <div><dt>市場狀態</dt><dd>{decision.market_regime ? REGIMES[decision.market_regime] : '尚未完成分類'}</dd></div>
      </dl>
      <p className="ma-subscriber-caption">{decision.calibration_status === 'INSUFFICIENT_HISTORY' ? '校準歷史不足；目前僅有可追溯的證據品質指標，不是獲利機率。' : '方向機率不等於買進勝率；信心與進場分數是不同的評估。'}<button type="button" onClick={() => setTerm('chasing-price')}>為什麼看多還不追？</button></p>
      {actions && <div className="ma-subscriber-actions">{actions}</div>}
    </SubscriberAnswer>
    <GlossarySheet term={term} source="decision_brief" onClose={() => setTerm(null)} />
  </>;
}

export function DecisionEvidence({ decision, canShowStocks }: { decision: Decision; canShowStocks: boolean }) {
  // Company/event narratives require the same gate as company cards. The server must
  // still project paid fields; hiding DOM is defense-in-depth, never entitlement.
  const visibleEvidence = canShowStocks ? decision.evidence : decision.evidence.filter(e => e.kind === 'market' || e.kind === 'calibration');
  if (!visibleEvidence.length) return null;
  return <section className="ma-subscriber-reading" aria-label="判斷與證據">
    <h2>為什麼這樣判斷？</h2>
    <details><summary>核對證據與分數方法</summary>
      <ul>{visibleEvidence.map((e) => <li key={e.id}><strong>{e.source}</strong><p>{e.summary}</p><time>{new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.observed_at))}（台北）</time></li>)}</ul>
      <p>品質指標採版本化等權規則，不是經驗證的獲利機率；方向機率必須另有樣本外校準。</p>
    </details>
    {canShowStocks && decision.action !== 'INSUFFICIENT_DATA' && decision.stock_opportunities.map((o) => <article className="ma-subscriber-opportunity" data-tone={actionTone(o.action)} key={o.symbol}>
      <header><h3>{o.symbol} {o.company_name}</h3><span>{ACTION_LABEL[o.action]}</span></header>
      <p>{o.thesis}</p>
      <dl className="ma-subscriber-chain">
        <div><dt>事件如何傳到公司</dt><dd>{o.transmission.catalyst} → {o.transmission.sector} → {o.transmission.company_exposure}</dd></div>
        <div><dt>基本面影響</dt><dd>{o.transmission.fundamental_explanation}</dd></div>
        <div><dt>價格反映了多少</dt><dd>{o.transmission.priced_in}</dd></div>
        <div><dt>機會分數</dt><dd>{o.opportunity_score.value}/100 · 品質指標，不是買進率</dd></div>
        {o.classification === 'MISPRICING_CANDIDATE' && <div><dt>錯殺觀察</dt><dd>基本面檢查齊全，仍等待確認；跌深本身不是買進證據。</dd></div>}
        <div><dt>什麼情況不再成立</dt><dd>{o.invalidation_conditions.join('；')}</dd></div>
      </dl>
    </article>)}
  </section>;
}
