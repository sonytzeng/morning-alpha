import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { trackPageView } from '@/utils/analytics';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { buildDecisionPresentation } from '@/lib/decisionPresentation';
import { buildRuntimeDecisionTimeline, selectNextRuntimeTimelineNode } from '@/lib/runtimeDecisionTimeline';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';
import { humanizePublicRuntimeText } from '@/utils/publicRuntimeCopy';
import { resolvePremiumContentAvailability } from '@/lib/premiumContentAvailability';
import { getSubscriberReportProjection } from '@/lib/subscriberReportProjection';
import { getSubscriberOpportunityList } from '@/lib/subscriberOpportunities';
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const UNSAFE_OPPORTUNITY_TEXT = /event[\\s_-]*score|market[\\s_-]*score|ai[\\s_-]*chain|undefined|null|確認訊號.{0,2}提供|取消條件.{0,2}提供|\\b[a-z][a-z0-9]*_[a-z0-9_]+\\b/i;

function publicOpportunityText(value: string | undefined): string | undefined {
  const text = value?.trim() || '';
  if (!text || UNSAFE_OPPORTUNITY_TEXT.test(text)) return undefined;
  return humanizePublicRuntimeText(text);
}

function opportunityBadge(roleLabel: string | undefined) {
  const role = roleLabel?.trim() || '';
  if (/停止|排除|風險|失效/.test(role)) return { label: '停止觀察', className: 'ma-badge-danger' };
  if (/確認|成立/.test(role)) return { label: '條件成立', className: 'ma-badge-success' };
  if (/觀察|候選|等待|今日主線|次要主線|資金輪動|代表股/.test(role)) return { label: '觀察中', className: 'ma-badge-warning' };
  return { label: '待補資料', className: 'ma-badge-neutral' };
}

// ═══════════════════════════════════════════════════
function OpportunitiesContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ds, setDs] = useState<MorningAlphaDisplayState | null>(null);
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);

  useEffect(() => {
    trackPageView('/opportunities');
    async function load() {
      try {
        setLoading(true);
        const resolved = await resolveActiveMorningAlphaReport();
        const report = resolved.rawRow;

        if (!report) { setDs(null); return; }

        const displayState = getMorningAlphaDisplayState(report as unknown as Record<string, unknown> | null);
        setDs(displayState);
        setIsHistoricalFallback(resolved.isHistoricalFallback);
        setFallbackReportDate(resolved.fallbackReportDate);

      } catch {
        setError('今日觀察名單暫時無法取得，請稍後重新載入。');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ═══ Loading ═══
  if (loading) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-foreground-500 text-sm">載入中...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3"></i>
            <h2 className="text-foreground-900 font-semibold text-base mb-2">讀取失敗</h2>
            <p className="text-foreground-500 text-sm mb-4">{error}</p>
            <button type="button" onClick={() => window.location.reload()} className="min-h-11 px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-xl transition-colors whitespace-nowrap">重新載入</button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!ds) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-time-line text-foreground-200 text-3xl mb-3"></i>
            <h2 className="text-foreground-900 font-semibold text-base mb-2">今日報告尚未產生</h2>
            <p className="text-foreground-500 text-sm mb-4">每天 07:30 自動生成，請稍後再回來查看。</p>
            <Link to="/" className="inline-flex min-h-11 items-center justify-center px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-xl transition-colors whitespace-nowrap">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ Market closed ═══
  if (ds.market_status !== 'OPEN') {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-background-100 border border-background-200/70 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-secondary-100 border border-secondary-200 flex items-center justify-center">
              <i className="ri-calendar-close-line text-secondary-500 text-2xl"></i>
            </div>
            <h1 className="text-foreground-900 font-bold text-xl mb-2">今日台股休市</h1>
            <p className="text-foreground-500 text-sm mb-2">日期：{ds.currentDate}</p>
            {ds.holidayName && <p className="text-foreground-400 text-sm mb-4">休市原因：{ds.holidayName}</p>}
            <p className="text-foreground-400 text-xs leading-relaxed mb-5">今日台股休市，不產生今日受惠股。請於下一個交易日再查看最新主線地圖。</p>
            <Link to="/" className="mt-2 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (isHistoricalFallback) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-background-100 border border-background-200/70 rounded-2xl p-6">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/20 bg-amber-500/10">
              <i className="ri-time-line text-amber-300 text-2xl"></i>
            </div>
            <h1 className="text-foreground-900 font-bold text-xl mb-2">今日盤前報告尚未產生</h1>
            <p className="text-foreground-500 text-sm mb-2">今日日期：{ds.currentDate}</p>
            {fallbackReportDate && <p className="text-foreground-400 text-sm mb-4">上一份報告參考：{fallbackReportDate}</p>}
            <p className="text-foreground-400 text-xs leading-relaxed mb-5">今日受惠股需等待 07:30 盤前報告產生後才會顯示。為避免誤導，這裡不會把上一份報告的受惠股顯示成今日名單。</p>
            <Link to="/" className="mt-2 inline-flex min-h-11 items-center justify-center px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const projection = getSubscriberReportProjection(ds.rawRow);
  if (!projection.analysisAvailable || !projection.recommendation.available) {
    return (
      <div className="ma-page ma-pixel-page ma-opportunities-page flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4" data-subscriber-state={projection.displayStatus} data-report-date={projection.identity.reportDate} data-revision-id={projection.identity.revisionId || ''}>
          <section className="max-w-md rounded-2xl border border-amber-400/20 bg-navy-900/70 p-6 text-center" role="status">
            <p className="text-sm text-slate-400">{projection.identity.reportDate}</p>
            <h1 className="mt-3 text-xl font-bold text-white">{projection.analysisAvailable ? '今日推薦狀態' : projection.title}</h1>
            <p className="mt-3 text-sm text-slate-400">{projection.recommendation.message}</p>
            <Link to="/report/today" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-white/10 px-4 py-2 text-sm text-white">查看今日市場判斷</Link>
          </section>
        </main>
        <Footer />
      </div>
    );
  }
  const rawAI = (ds.rawAI || {}) as Record<string, unknown>;
  const premiumAvailability = resolvePremiumContentAvailability(ds.rawRow, projection);
  const presentedStocks = getSubscriberOpportunityList(ds.rawRow, projection);
  const safePresentedStocks = presentedStocks.map((stock) => ({
    stock,
    reason: publicOpportunityText(stock.oneLineReason),
    confirmation: publicOpportunityText(stock.confirmation),
    invalidation: publicOpportunityText(stock.invalidation),
  }));
  const completeEnoughStocks = safePresentedStocks.filter(({ reason, confirmation, invalidation }) => (
    Boolean(reason && confirmation && invalidation)
  ));
  const visibleStrongCount = completeEnoughStocks.length;
  const hasStrongBeneficiaryEvidence = visibleStrongCount > 0;
  const canonicalNarrative = buildCanonicalNarrative({ displayState: ds, ai: rawAI });
  const opportunityPresentation = buildDecisionPresentation({
    displayState: ds,
    narrative: canonicalNarrative,
  });
  const runtimeTimeline = buildRuntimeDecisionTimeline({
    projection,
    hasReport: true,
    isTradingDay: ds.is_trading_day,
  });
  const nextRuntimeNode = selectNextRuntimeTimelineNode(runtimeTimeline);
  const thesisTitle = hasStrongBeneficiaryEvidence
    ? publicOpportunityText(opportunityPresentation.mission.title) || '等待今日主線確認'
    : premiumAvailability.eligible ? '入選個股的呈現條件尚未完整' : '個股研究尚未通過 Premium 資格';
  const thesisExplanation = publicOpportunityText(opportunityPresentation.mission.explanation);
  const checkpointLabel = nextRuntimeNode
    ? `${nextRuntimeNode.time}｜${nextRuntimeNode.label}`
    : [
        opportunityPresentation.nextCheckpoint.time,
        publicOpportunityText(opportunityPresentation.nextCheckpoint.label),
      ].filter(Boolean).join('｜') || '等待下一個有效市場節點';
  const opportunityHeroTitle = hasStrongBeneficiaryEvidence
    ? `今天有 ${visibleStrongCount} 檔通過推薦篩選`
    : completeEnoughStocks.length > 0
      ? `今天沒有強受惠股，先觀察 ${completeEnoughStocks.length} 檔`
      : '今天不公布個股名單';
  const opportunityListTitle = hasStrongBeneficiaryEvidence ? '受惠候選比較' : '觀察股比較';
  const opportunityListDescription = hasStrongBeneficiaryEvidence
    ? '依序比較入選理由、成立條件與取消條件；通過篩選仍不等於買進訊號。'
    : '只有理由、成立條件、取消條件與當日證據都完整，股票才會出現在這裡。';

  return (
    <div className="ma-page ma-pixel-page ma-opportunities-page flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden" data-subscriber-state={projection.displayStatus} data-report-date={projection.identity.reportDate} data-revision-id={projection.identity.revisionId || ''}>
        <section className="ma-opportunities-v2-hero">
          <div className="ma-pixel-content">
            <div className="ma-opportunities-v2-hero-grid">
              <div>
                <p className="ma-pixel-eyebrow"><i className="ri-compass-3-line" aria-hidden="true" />今日機會篩選台 · {ds.reportDate}</p>
                <h1>{opportunityHeroTitle}</h1>
                <p>{hasStrongBeneficiaryEvidence
                  ? '這裡是通過證據門檻的受惠候選，仍不是買進名單。'
                  : '當日證據尚未通過門檻；不沿用昨天名單、不拿固定股票填版面，也不把觀察股包裝成受惠股。'}</p>
              </div>
              <aside>
                <span>當前確認節點</span>
                <strong>{checkpointLabel}</strong>
                <p>節點完成前，所有股票維持觀察。</p>
              </aside>
            </div>
            <ol className="ma-opportunities-v2-funnel" aria-label="今日受惠股篩選流程">
              <li><span>01</span><strong>主線先成立</strong><small>先確認市場方向</small></li>
              <li><span>02</span><strong>個股要承接</strong><small>再看量價與代表股</small></li>
              <li><span>03</span><strong>風險不能破</strong><small>失效就取消觀察</small></li>
            </ol>
          </div>
        </section>

        <div className="ma-pixel-content ma-pixel-page-sections ma-opportunities-v2-sections">
          <section className="ma-opportunities-v2-thesis" aria-labelledby="opportunity-thesis-title">
            <div>
              <p className="ma-pixel-eyebrow">今日主線</p>
              <h2 id="opportunity-thesis-title">{thesisTitle}</h2>
              {thesisExplanation && <p>{thesisExplanation}</p>}
            </div>
            <dl>
              <div><dt>目前策略</dt><dd>只觀察，不追價</dd></div>
              <div><dt>入選門檻</dt><dd>主線與個股訊號同向</dd></div>
              <div><dt>重新判斷</dt><dd>{checkpointLabel}</dd></div>
            </dl>
          </section>

          <section className="space-y-3">
            <VisualSectionHeader icon="ri-stock-line" title={opportunityListTitle} description={opportunityListDescription} />

            {completeEnoughStocks.length > 0 ? (
              <div className="ma-opportunity-grid">
                {completeEnoughStocks.map(({ stock, reason, confirmation, invalidation }, index) => {
                  const badge = hasStrongBeneficiaryEvidence
                    ? opportunityBadge(stock.roleLabel)
                    : { label: '待確認', className: 'ma-badge-warning' };
                  return (
                  <article key={`${stock.symbol}-${stock.name}`} className="ma-opportunity-card">
                    <header>
                      <div><span>{hasStrongBeneficiaryEvidence ? '候選' : '觀察'} {String(index + 1).padStart(2, '0')}</span><small>{hasStrongBeneficiaryEvidence ? publicOpportunityText(stock.roleLabel) || '受惠候選' : '尚未通過受惠門檻'}</small></div>
                      <span className={`ma-badge ${badge.className}`}>{badge.label}</span>
                    </header>
                    <h3><span>{stock.symbol}</span>{stock.name}</h3>
                    <p className="ma-opportunity-card-state"><i className="ri-time-line" aria-hidden="true" />目前維持觀察，等待 {checkpointLabel}</p>
                    <dl className="ma-opportunity-details">
                      <div><dt>{hasStrongBeneficiaryEvidence ? '為什麼列入候選' : '為什麼先觀察'}</dt><dd>{reason || '觀察理由資料尚未完整。'}</dd></div>
                      <div><dt>成立前要看到</dt><dd>{confirmation || '等待下一個有效市場節點補齊確認條件。'}</dd></div>
                      <div><dt>什麼情況取消</dt><dd>{invalidation || '取消條件資料尚未完整，暫不升級判斷。'}</dd></div>
                    </dl>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-5 text-sm leading-relaxed text-amber-200">
                <strong className="mb-1 block text-amber-100">今日不公布個股名單</strong>
                {premiumAvailability.eligible
                  ? '正式入選資料的理由、成立條件或取消條件尚未完整。補齊前不展示個股，不沿用舊名單。'
                  : '市場判斷已發布，但個股研究尚未通過獨立 Premium 資格；不以市場就緒狀態代替。'}
              </div>
            )}
          </section>

          <nav className="ma-opportunities-v2-next" aria-label="今日受惠股後續頁面">
            <div><strong>接著怎麼看</strong><span>先回到判斷，再追蹤盤中證據。</span></div>
            <div>
              <Link to="/">今日判斷<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
              <Link to="/war-room">盤中追蹤<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
              <Link to="/member-note">完整研究<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
            </div>
          </nav>
        </div>
      </main>

      <Footer />
    </div>
  );
}


export default function Opportunities() {
  return (
    <ErrorBoundary fallbackTitle="今日主線地圖 暫時無法載入" fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。">
      <OpportunitiesContent />
    </ErrorBoundary>
  );
}
