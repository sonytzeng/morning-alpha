/* eslint-disable react-refresh/only-export-components -- This module exports render helpers, not a refresh boundary. */
import { renderSafeText } from '@/utils/renderSafe';
import { getMemberNoteSectionCount } from '@/utils/aiStrategyParser';

// ═══════════════════════════════════════════════════
// Safe Helpers
// ═══════════════════════════════════════════════════

function grab(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '—';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '—';
}

function grabObj(obj: unknown, key: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const v = o[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function grabArr(obj: unknown, key: string): unknown[] {
  if (!obj || typeof obj !== 'object') return [];
  const o = obj as Record<string, unknown>;
  return Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
}

export function grabBool(obj: unknown, key: string): boolean | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  return typeof o[key] === 'boolean' ? (o[key] as boolean) : null;
}

// ═══════════════════════════════════════════════════
// Tiny sub-components
// ═══════════════════════════════════════════════════

function SectionLine({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  if (!value || value === '—') return null;
  return (
    <p className={highlight ? 'text-foreground-800 font-medium text-xs' : 'text-foreground-600 text-xs'}>
      <span className="text-foreground-400">{label}：</span>{value}
    </p>
  );
}

function BlockLabel({ children, colorClass }: { children: React.ReactNode; colorClass?: string }) {
  return (
    <span className={`text-foreground-400 text-[10px] uppercase tracking-wider font-semibold ${colorClass ?? ''}`}>
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════
// Known section key → display title mapping
// ═══════════════════════════════════════════════════

const KNOWN_KEY_TITLES: Record<string, string> = {
  main_scenario: '今日主劇本',
  evidence: '資料證據',
  overnight_impact_chain: '隔夜影響鏈',
  do_not_do: '今日不要做',
  watchlist: '今日觀察名單',
  intraday_tracking: '盤中追蹤',
  invalidation: '失效條件',
  close_review: '收盤驗證',
  validation_feedback_adjustment: '驗證回饋與修正',
};

const COLOR_MAP: Record<string, string> = {
  main_scenario: 'border-l-amber-400',
  evidence: 'border-l-sky-400',
  overnight_impact_chain: 'border-l-violet-400',
  do_not_do: 'border-l-rose-400',
  watchlist: 'border-l-emerald-400',
  intraday_tracking: 'border-l-cyan-400',
  invalidation: 'border-l-orange-400',
  close_review: 'border-l-slate-400',
  validation_feedback_adjustment: 'border-l-teal-400',
};

// ═══════════════════════════════════════════════════
// NOTEBOOK HEADER — quick summary of member note
// ═══════════════════════════════════════════════════

export function renderNotebookHeader(memberNote: Record<string, unknown> | null) {
  if (!memberNote) return null;

  const reportDate = grab(memberNote, 'generated_for_date');
  const isTradingDay = typeof memberNote.is_trading_day === 'boolean'
    ? (memberNote.is_trading_day ? '交易日' : '非交易日')
    : '—';
  const dataBasis = grab(memberNote, 'data_basis');
  const direction = grab(memberNote, 'market_bias', 'direction');
  const confidence = grab(memberNote, 'confidence_score');
  const quality = grab(memberNote, 'quality_score');
  const version = grab(memberNote, 'generated_by', 'version');
  const sectionsArr = Array.isArray(memberNote.sections) ? memberNote.sections : [];
  const sectionCount = sectionsArr.length > 0 ? sectionsArr.length : getMemberNoteSectionCount(memberNote);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-500 mb-3 bg-background-50 rounded-xl p-3 border border-background-100">
      {reportDate !== '—' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
          <i className="ri-calendar-line text-foreground-400"></i>
          報告日期：<span className="text-foreground-800 font-medium">{reportDate}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
        <i className="ri-sun-line text-foreground-400"></i>
        交易狀態：<span className="text-foreground-800 font-medium">{isTradingDay}</span>
      </span>
      {direction !== '—' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
          <i className="ri-compass-3-line text-foreground-400"></i>
          盤前方向：<span className="text-foreground-800 font-medium">{direction}</span>
        </span>
      )}
      {confidence !== '—' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
          <i className="ri-focus-2-line text-foreground-400"></i>
          把握度：<span className="text-foreground-800 font-medium">{confidence}</span>
        </span>
      )}
      {quality !== '—' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
          <i className="ri-shield-check-line text-foreground-400"></i>
          品質：<span className="text-foreground-800 font-medium">{quality}</span>
        </span>
      )}
      {version !== '—' && (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
          <i className="ri-git-branch-line text-foreground-400"></i>
          版本：<span className="text-foreground-800 font-mono text-[11px]">{version}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-white rounded-lg border border-background-100">
        <i className="ri-file-list-3-line text-foreground-400"></i>
        段落：<span className="text-foreground-800 font-medium">{sectionCount} 段</span>
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN: renderNotebookSections — Entry point
// ═══════════════════════════════════════════════════

export function renderNotebookSections(sections: unknown[], memberNote?: Record<string, unknown> | null) {
  if (sections.length === 0) {
    // V7.53: Fallback to flat structure rendering
    if (memberNote) {
      return renderFlatNotebookContent(memberNote);
    }
    return <p className="text-foreground-400 text-sm bg-background-50 rounded-lg p-3">會員研究筆記段落尚未產生。</p>;
  }

  return (
    <div className="space-y-4">
      {sections.map((sec, i) => {
        if (!sec || typeof sec !== 'object') {
          // Plain string fallback
          if (typeof sec === 'string' && sec.trim()) {
            return (
              <div key={i} className="bg-white rounded-xl border border-background-200 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-xs font-bold">{String(i + 1).padStart(2, '0')}</span>
                  <h4 className="text-foreground-800 font-semibold text-sm">第{i + 1}段</h4>
                </div>
                <p className="text-foreground-600 text-xs leading-relaxed">{sec}</p>
              </div>
            );
          }
          return null;
        }

        const s = sec as Record<string, unknown>;
        const key = String(s.key || '');
        const title = String(s.title || KNOWN_KEY_TITLES[key] || `第${i + 1}段`);
        const borderColor = COLOR_MAP[key] || 'border-l-foreground-300';

        return (
          <div key={key || i} className="bg-white rounded-xl border border-background-200 overflow-hidden">
            {/* Section header with badge number */}
            <div className="flex items-center gap-3 px-4 py-3 bg-background-50 border-b border-background-100">
              <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-[11px] font-bold">{String(i + 1).padStart(2, '0')}</span>
              <h4 className="text-foreground-800 font-semibold text-sm leading-none">{title}</h4>
            </div>
            {/* Section content */}
            <div className="px-4 py-3.5 text-foreground-600 text-xs space-y-2">
              {renderSectionContent(key, s)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// renderSectionContent — Dispatcher + Universal fallback
// ═══════════════════════════════════════════════════

function renderSectionContent(key: string, s: Record<string, unknown>) {
  // Route to specific renderers for known keys
  switch (key) {
    case 'main_scenario':
      return renderMainScenario(s);
    case 'evidence':
      return renderEvidence(s);
    case 'overnight_impact_chain':
      return renderOvernightChain(s);
    case 'do_not_do':
      return renderDoNotDo(s);
    case 'watchlist':
      return renderWatchlist(s);
    case 'intraday_tracking':
      return renderIntradayTracking(s);
    case 'invalidation':
      return renderInvalidation(s);
    case 'close_review':
      return renderCloseReview(s);
    case 'validation_feedback_adjustment':
      return renderValidationFeedbackSection(s);
    default:
      // Universal smart fallback — never "未知段落格式"
      return renderUniversalSection(s);
  }
}

// ═══════════════════════════════════════════════════
// KNOWN KEY RENDERERS
// ═══════════════════════════════════════════════════

function renderMainScenario(s: Record<string, unknown>) {
  return (
    <>
      <SectionLine label="內容" value={grab(s, 'content')} highlight />
      <SectionLine label="結論" value={grab(s, 'conclusion')} highlight />
      <SectionLine label="分析" value={grab(s, 'reasoning')} />
      {grabArr(s, 'supporting_signals').length > 0 && (
        <div>
          <BlockLabel>支持訊號</BlockLabel>
          <ul className="list-disc list-inside mt-0.5">
            {grabArr(s, 'supporting_signals').map((sig, i) => (
              <li key={i} className="text-foreground-600">{renderSafeText(sig)}</li>
            ))}
          </ul>
        </div>
      )}
      {grabArr(s, 'confirmation_conditions').length > 0 && (
        <div>
          <BlockLabel>成立條件</BlockLabel>
          <ul className="list-disc list-inside mt-0.5">
            {grabArr(s, 'confirmation_conditions').map((c, i) => (
              <li key={i} className="text-foreground-600">{renderSafeText(c)}</li>
            ))}
          </ul>
        </div>
      )}
      <SectionLine label="風險提醒" value={grab(s, 'risk_note')} />
    </>
  );
}

function renderEvidence(s: Record<string, unknown>) {
  const items = grabArr(s, 'evidence_items') as Record<string, unknown>[];
  return (
    <>
      <SectionLine label="結論" value={grab(s, 'conclusion')} />
      {items.length > 0 ? (
        <div className="space-y-2 mt-1">
          {items.map((ei, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              <p className="text-foreground-700 font-medium text-xs">{renderSafeText(ei.signal)}</p>
              <p className="text-foreground-500 text-[11px] mt-0.5">{renderSafeText(ei.observation)}</p>
              <p className="text-foreground-600 text-[11px] mt-0.5">
                <span className="text-foreground-400">解讀：</span>{renderSafeText(ei.interpretation)}
              </p>
              {ei.supports && (
                <p className="text-foreground-500 text-[10px] mt-0.5">
                  <span className="text-foreground-400">支持：</span>{renderSafeText(ei.supports)}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground-400 text-xs">此段尚未產生。</p>
      )}
    </>
  );
}

function renderOvernightChain(s: Record<string, unknown>) {
  const chains = grabArr(s, 'chains') as Record<string, unknown>[];
  return (
    <>
      {chains.length > 0 ? (
        <div className="space-y-2">
          {chains.map((c, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              <p className="text-foreground-700 font-medium text-xs">催化事件：{renderSafeText(c.catalyst)}</p>
              <p className="text-foreground-500 text-[11px] mt-0.5">
                影響族群：{Array.isArray(c.affected_sectors) ? (c.affected_sectors as string[]).map(renderSafeText).join('、') : renderSafeText(c.affected_sectors)}
              </p>
              {Array.isArray(c.representative_stocks) && (c.representative_stocks as unknown[]).length > 0 && (
                <div className="mt-0.5">
                  <span className="text-foreground-400 text-[10px]">代表觀察股：</span>
                  {(c.representative_stocks as Record<string, unknown>[]).map((rs, j) => (
                    <span key={j} className="text-foreground-600 text-[11px] ml-1">
                      {renderSafeText(rs.name)}{rs.role ? `（${renderSafeText(rs.role)}）` : ''}{rs.reason ? `：${renderSafeText(rs.reason)}` : ''}
                      {j < (c.representative_stocks as unknown[]).length - 1 ? '、' : ''}
                    </span>
                  ))}
                </div>
              )}
              {Array.isArray(c.intraday_watch_points) && (c.intraday_watch_points as unknown[]).length > 0 && (
                <div className="mt-0.5">
                  <span className="text-foreground-400 text-[10px]">盤中觀察點：</span>
                  {(c.intraday_watch_points as string[]).map((wp, j) => (
                    <span key={j} className="text-foreground-600 text-[11px]">{wp}{j < (c.intraday_watch_points as string[]).length - 1 ? '；' : ''}</span>
                  ))}
                </div>
              )}
              <p className="text-foreground-500 text-[11px] mt-0.5">
                <span className="text-foreground-400">失效條件：</span>{renderSafeText(c.invalidation_condition)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground-400 text-xs">隔夜影響鏈資料不足，暫不產生此段。</p>
      )}
    </>
  );
}

function renderDoNotDo(s: Record<string, unknown>) {
  const items = grabArr(s, 'items');
  return (
    <>
      {items.length > 0 ? (
        <ul className="list-decimal list-inside space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-foreground-700 text-xs">
              {typeof item === 'string' ? item : renderSafeText((item as Record<string, unknown>)?.text ?? item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-foreground-400 text-xs">此段尚未產生。</p>
      )}
    </>
  );
}

function renderWatchlist(s: Record<string, unknown>) {
  const core = grabArr(s, 'core_watch') as Record<string, unknown>[];
  const sec = grabArr(s, 'secondary_watch') as Record<string, unknown>[];
  const risk = grabArr(s, 'risk_watch') as Record<string, unknown>[];
  return (
    <div className="space-y-3">
      {[{ tier: '核心觀察', data: core, color: 'border-amber-400' },
        { tier: '次要觀察', data: sec, color: 'border-sky-400' },
        { tier: '風險觀察', data: risk, color: 'border-rose-400' },
      ].map((group) => group.data.length > 0 && (
        <div key={group.tier}>
          <p className={`text-xs font-semibold mb-1.5 pl-2 border-l-2 ${group.color}`}>{group.tier}</p>
          <div className="space-y-1.5">
            {group.data.map((w, j) => (
              <div key={j} className="bg-background-50 rounded p-2.5 border border-background-100">
                <p className="text-foreground-700 font-medium text-xs">
                  {renderSafeText(w.name)}
                  <span className="text-foreground-400 font-normal ml-1">— {renderSafeText(w.reason)}</span>
                </p>
                <p className="text-foreground-500 text-[11px] mt-0.5">訊號線索：{renderSafeText(w.signal)}</p>
                <p className="text-foreground-500 text-[11px]">
                  強：{renderSafeText(w.strong_condition)} / 弱：{renderSafeText(w.weak_condition)}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
      {core.length === 0 && sec.length === 0 && risk.length === 0 && (
        <p className="text-foreground-400 text-xs">此段尚未產生。</p>
      )}
    </div>
  );
}

function renderIntradayTracking(s: Record<string, unknown>) {
  const timeline = grabArr(s, 'timeline') as Record<string, unknown>[];
  return (
    <>
      {timeline.length > 0 ? (
        <div className="space-y-2">
          {timeline.map((t, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              <p className="text-foreground-700 font-semibold text-xs">{renderSafeText(t.time)}</p>
              <p className="text-foreground-600 text-[11px] mt-0.5">
                <span className="text-foreground-400">問題：</span>{renderSafeText(t.question)}
              </p>
              <p className="text-foreground-500 text-[11px]">
                <span className="text-foreground-400">觀察：</span>{renderSafeText(t.what_to_watch ?? t.interpretation)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground-400 text-xs">此段尚未產生。</p>
      )}
    </>
  );
}

function renderInvalidation(s: Record<string, unknown>) {
  const items = grabArr(s, 'items') as Record<string, unknown>[];
  return (
    <>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((inv, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              <p className="text-foreground-700 text-xs font-medium">
                如果發生：{renderSafeText(inv.condition)}
              </p>
              <p className="text-foreground-600 text-[11px] mt-0.5">
                <span className="text-foreground-400">代表：</span>{renderSafeText(inv.meaning)}
              </p>
              <p className="text-foreground-500 text-[11px]">
                <span className="text-foreground-400">修正：</span>{renderSafeText(inv.required_adjustment)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-foreground-400 text-xs">此段尚未產生。</p>
      )}
    </>
  );
}

function renderCloseReview(s: Record<string, unknown>) {
  return (
    <>
      <SectionLine label="盤前假設" value={grab(s, 'premarket_assumption')} />
      <SectionLine label="收盤結果" value={grab(s, 'close_result')} />
      <SectionLine label="驗證結論" value={grab(s, 'verification_result')} highlight />
      <SectionLine label="判斷正確" value={grab(s, 'what_was_right')} />
      <SectionLine label="偏保守或失準" value={grab(s, 'what_was_conservative_or_wrong')} />
      <SectionLine label="明日修正" value={grab(s, 'tomorrow_adjustment')} />
    </>
  );
}

function renderValidationFeedbackSection(s: Record<string, unknown>) {
  return (
    <>
      <SectionLine label="驗證結論" value={grab(s, 'conclusion')} highlight />
      <SectionLine label="最近驗證摘要" value={grab(s, 'recent_review_summary')} />
      <SectionLine label="今日修正方向" value={grab(s, 'adjustment_today')} />
      {grabArr(s, 'signals_to_confirm').length > 0 && (
        <div>
          <BlockLabel>今日必須確認的訊號</BlockLabel>
          <ul className="list-disc list-inside mt-0.5">
            {grabArr(s, 'signals_to_confirm').map((sig, i) => (
              <li key={i} className="text-foreground-600">{renderSafeText(sig)}</li>
            ))}
          </ul>
        </div>
      )}
      <SectionLine label="若重複偏差" value={grab(s, 'risk_if_repeated')} />
    </>
  );
}

// ═══════════════════════════════════════════════════
// V7.53 FLAT NOTEBOOK CONTENT RENDERER
// Renders member_research_note as flat fields (title/executive_view/data_basis/key_observations/main_thesis/risk_notes)
// ═══════════════════════════════════════════════════

function renderFlatNotebookContent(memberNote: Record<string, unknown>) {
  const blocks: React.ReactNode[] = [];

  const title = grab(memberNote, 'title');
  const executiveView = grab(memberNote, 'executive_view');
  const dataBasis = grab(memberNote, 'data_basis');
  const keyObs = grabArr(memberNote, 'key_observations');
  const mainThesis = grab(memberNote, 'main_thesis');
  const riskNotes = grab(memberNote, 'risk_notes');

  let blockIndex = 0;

  // 1. Title
  if (title !== '—') {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-background-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-background-50 border-b border-background-100">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-[11px] font-bold">01</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">標題</h4>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-foreground-700 text-sm font-medium leading-relaxed">{title}</p>
        </div>
      </div>
    );
  }

  // 2. Executive View (main content)
  if (executiveView !== '—') {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-background-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-background-50 border-b border-background-100">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-[11px] font-bold">{String(blockIndex).padStart(2, '0')}</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">執行摘要</h4>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-foreground-700 text-sm leading-relaxed whitespace-pre-wrap">{executiveView}</p>
        </div>
      </div>
    );
  }

  // 3. Data Basis
  if (dataBasis !== '—') {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-background-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-background-50 border-b border-background-100">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-[11px] font-bold">{String(blockIndex).padStart(2, '0')}</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">資料依據</h4>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-foreground-700 text-sm leading-relaxed whitespace-pre-wrap">{dataBasis}</p>
        </div>
      </div>
    );
  }

  // 4. Key Observations (array)
  if (keyObs.length > 0) {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-background-200 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-background-50 border-b border-background-100">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-foreground-900 text-white flex items-center justify-center text-[11px] font-bold">{String(blockIndex).padStart(2, '0')}</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">關鍵觀察（{keyObs.length} 項）</h4>
        </div>
        <div className="px-4 py-3.5 space-y-3">
          {keyObs.map((obs, i) => {
            if (typeof obs === 'string') {
              return (
                <div key={i} className="bg-background-50 rounded-lg p-3 border border-background-100">
                  <p className="text-foreground-700 text-sm leading-relaxed">{obs}</p>
                </div>
              );
            }
            if (typeof obs === 'object' && obs !== null) {
              const o = obs as Record<string, unknown>;
              const obsTitle = grab(o, 'title');
              const obsContent = grab(o, 'content');
              const obsCategory = grab(o, 'category');
              return (
                <div key={i} className="bg-background-50 rounded-lg p-3 border border-background-100">
                  {obsTitle !== '—' && <p className="text-foreground-800 font-semibold text-xs mb-1">{obsTitle}</p>}
                  {obsContent !== '—' && <p className="text-foreground-600 text-xs leading-relaxed">{obsContent}</p>}
                  {obsCategory !== '—' && <span className="inline-flex items-center px-2 py-0.5 mt-1.5 rounded-full text-[10px] bg-background-200 text-foreground-500">{obsCategory}</span>}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    );
  }

  // 5. Main Thesis
  if (mainThesis !== '—') {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-amber-500/20 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/5 border-b border-amber-500/10">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center text-[11px] font-bold">{String(blockIndex).padStart(2, '0')}</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">主劇本</h4>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-foreground-700 text-sm leading-relaxed whitespace-pre-wrap">{mainThesis}</p>
        </div>
      </div>
    );
  }

  // 6. Risk Notes
  if (riskNotes !== '—') {
    blocks.push(
      <div key={`flat-${blockIndex++}`} className="bg-white rounded-xl border border-rose-500/20 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-rose-500/5 border-b border-rose-500/10">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-rose-500 text-white flex items-center justify-center text-[11px] font-bold">{String(blockIndex).padStart(2, '0')}</span>
          <h4 className="text-foreground-800 font-semibold text-sm leading-none">風險提醒</h4>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-rose-700 text-sm leading-relaxed whitespace-pre-wrap">{riskNotes}</p>
        </div>
      </div>
    );
  }

  if (blocks.length === 0) {
    return <p className="text-foreground-400 text-sm bg-background-50 rounded-lg p-3">會員研究筆記段落尚未產生。</p>;
  }

  return <div className="space-y-4">{blocks}</div>;
}

// ═══════════════════════════════════════════════════
// UNIVERSAL FALLBACK RENDERER
// Intelligently detects available fields and renders them.
// NEVER shows "未知段落格式".
// ═══════════════════════════════════════════════════

function renderUniversalSection(section: Record<string, unknown>): React.ReactNode {
  // Collect all rendered blocks
  const blocks: React.ReactNode[] = [];

  // 1. conclusion
  const conclusion = grab(section, 'conclusion');
  if (conclusion !== '—') {
    blocks.push(
      <div key="conclusion" className="bg-background-50 rounded-lg p-3 border border-background-100">
        <BlockLabel>結論</BlockLabel>
        <p className="text-foreground-700 text-xs mt-0.5 leading-relaxed">{conclusion}</p>
      </div>
    );
  }

  // 0. content — main body text, shown first if present
  const content = grab(section, 'content');
  if (content !== '—') {
    blocks.unshift(
      <div key="content" className="bg-background-50 rounded-lg p-3 border border-background-100">
        <p className="text-foreground-700 text-xs leading-relaxed">{content}</p>
      </div>
    );
  }

  // 2. reasoning
  const reasoning = grab(section, 'reasoning');
  if (reasoning !== '—') {
    blocks.push(
      <div key="reasoning">
        <BlockLabel>判斷理由</BlockLabel>
        <p className="text-foreground-600 text-xs mt-0.5 leading-relaxed">{reasoning}</p>
      </div>
    );
  }

  // 3. supporting_signals
  const supportingSignals = grabArr(section, 'supporting_signals');
  if (supportingSignals.length > 0) {
    blocks.push(
      <div key="supporting_signals">
        <BlockLabel>支持訊號</BlockLabel>
        <ul className="list-disc list-inside mt-0.5 space-y-0.5">
          {supportingSignals.map((sig, i) => (
            <li key={i} className="text-foreground-600 text-xs">{renderSafeText(sig)}</li>
          ))}
        </ul>
      </div>
    );
  }

  // 4. confirmation_conditions
  const confirmationConditions = grabArr(section, 'confirmation_conditions');
  if (confirmationConditions.length > 0) {
    blocks.push(
      <div key="confirmation_conditions">
        <BlockLabel>成立條件</BlockLabel>
        <ul className="list-disc list-inside mt-0.5 space-y-0.5">
          {confirmationConditions.map((c, i) => (
            <li key={i} className="text-foreground-600 text-xs">{renderSafeText(c)}</li>
          ))}
        </ul>
      </div>
    );
  }

  // 5. risk_note
  const riskNote = grab(section, 'risk_note');
  if (riskNote !== '—') {
    blocks.push(
      <div key="risk_note" className="bg-rose-500/5 border border-rose-500/15 rounded-lg p-3">
        <BlockLabel colorClass="text-rose-500">風險提醒</BlockLabel>
        <p className="text-rose-600 text-xs mt-0.5 leading-relaxed">{riskNote}</p>
      </div>
    );
  }

  // 6. evidence_items
  const evidenceItems = grabArr(section, 'evidence_items') as Record<string, unknown>[];
  if (evidenceItems.length > 0) {
    blocks.push(
      <div key="evidence_items">
        <BlockLabel>資料證據</BlockLabel>
        <div className="space-y-2 mt-1">
          {evidenceItems.map((ei, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              {ei.signal && <p className="text-foreground-700 font-medium text-xs">{renderSafeText(ei.signal)}</p>}
              {ei.observation && <p className="text-foreground-500 text-[11px] mt-0.5">{renderSafeText(ei.observation)}</p>}
              {ei.interpretation && (
                <p className="text-foreground-600 text-[11px] mt-0.5">
                  <span className="text-foreground-400">解讀：</span>{renderSafeText(ei.interpretation)}
                </p>
              )}
              {ei.supports && (
                <p className="text-foreground-500 text-[10px] mt-0.5">
                  <span className="text-foreground-400">支持：</span>{renderSafeText(ei.supports)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 7. chains
  const chains = grabArr(section, 'chains') as Record<string, unknown>[];
  if (chains.length > 0) {
    blocks.push(
      <div key="chains">
        <BlockLabel>影響鏈</BlockLabel>
        <div className="space-y-2 mt-1">
          {chains.map((c, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              {c.catalyst && <p className="text-foreground-700 font-medium text-xs">催化事件：{renderSafeText(c.catalyst)}</p>}
              {c.affected_sectors && (
                <p className="text-foreground-500 text-[11px] mt-0.5">
                  影響族群：{Array.isArray(c.affected_sectors) ? (c.affected_sectors as string[]).map(renderSafeText).join('、') : renderSafeText(c.affected_sectors)}
                </p>
              )}
              {Array.isArray(c.representative_stocks) && (c.representative_stocks as unknown[]).length > 0 && (
                <div className="mt-0.5">
                  <span className="text-foreground-400 text-[10px]">代表觀察股：</span>
                  {(c.representative_stocks as Record<string, unknown>[]).map((rs, j) => (
                    <span key={j} className="text-foreground-600 text-[11px] ml-1">
                      {renderSafeText(rs.name)}{rs.role ? `（${renderSafeText(rs.role)}）` : ''}{rs.reason ? `：${renderSafeText(rs.reason)}` : ''}
                      {j < (c.representative_stocks as unknown[]).length - 1 ? '、' : ''}
                    </span>
                  ))}
                </div>
              )}
              {Array.isArray(c.intraday_watch_points) && (c.intraday_watch_points as unknown[]).length > 0 && (
                <div className="mt-0.5">
                  <span className="text-foreground-400 text-[10px]">盤中觀察點：</span>
                  {(c.intraday_watch_points as string[]).map((wp, j) => (
                    <span key={j} className="text-foreground-600 text-[11px]">{wp}{j < (c.intraday_watch_points as string[]).length - 1 ? '；' : ''}</span>
                  ))}
                </div>
              )}
              {c.invalidation_condition && (
                <p className="text-foreground-500 text-[11px] mt-0.5">
                  <span className="text-foreground-400">失效條件：</span>{renderSafeText(c.invalidation_condition)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 8. items (generic array — can be strings or objects with condition/meaning/required_adjustment)
  const items = grabArr(section, 'items');
  if (items.length > 0) {
    const isAllStrings = items.every((it) => typeof it === 'string');
    const isAllObjects = items.every((it) => typeof it === 'object' && it !== null);

    if (isAllStrings) {
      blocks.push(
        <div key="items">
          <BlockLabel>重點清單</BlockLabel>
          <ul className="list-disc list-inside mt-0.5 space-y-0.5">
            {(items as string[]).map((it, i) => (
              <li key={i} className="text-foreground-600 text-xs">{it}</li>
            ))}
          </ul>
        </div>
      );
    } else if (isAllObjects) {
      blocks.push(
        <div key="items">
          <BlockLabel>條件清單</BlockLabel>
          <div className="space-y-2 mt-1">
            {(items as Record<string, unknown>[]).map((it, i) => (
              <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
                {it.condition && (
                  <p className="text-foreground-700 text-xs font-medium">如果發生：{renderSafeText(it.condition)}</p>
                )}
                {it.meaning && (
                  <p className="text-foreground-600 text-[11px] mt-0.5">
                    <span className="text-foreground-400">代表：</span>{renderSafeText(it.meaning)}
                  </p>
                )}
                {it.required_adjustment && (
                  <p className="text-foreground-500 text-[11px]">
                    <span className="text-foreground-400">修正：</span>{renderSafeText(it.required_adjustment)}
                  </p>
                )}
                {!it.condition && !it.meaning && !it.required_adjustment && (
                  <p className="text-foreground-600 text-[11px]">{renderSafeText(it)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    } else {
      // Mixed array — render each item safely
      blocks.push(
        <div key="items">
          <BlockLabel>重點清單</BlockLabel>
          <ul className="list-disc list-inside mt-0.5 space-y-0.5">
            {items.map((it, i) => (
              <li key={i} className="text-foreground-600 text-xs">{renderSafeText(it)}</li>
            ))}
          </ul>
        </div>
      );
    }
  }

  // 9. core_watch / secondary_watch / risk_watch
  const hasWatchlists = ['core_watch', 'secondary_watch', 'risk_watch'].some(
    (k) => grabArr(section, k).length > 0
  );
  if (hasWatchlists) {
    const coreW = grabArr(section, 'core_watch') as Record<string, unknown>[];
    const secW = grabArr(section, 'secondary_watch') as Record<string, unknown>[];
    const riskW = grabArr(section, 'risk_watch') as Record<string, unknown>[];
    blocks.push(
      <div key="watchlists">
        <BlockLabel>觀察名單</BlockLabel>
        <div className="space-y-2 mt-1">
          {[{ tier: '核心觀察', data: coreW, color: 'border-amber-400' },
            { tier: '次要觀察', data: secW, color: 'border-sky-400' },
            { tier: '風險觀察', data: riskW, color: 'border-rose-400' },
          ].map((group) => group.data.length > 0 && (
            <div key={group.tier}>
              <p className={`text-[11px] font-semibold mb-1 pl-2 border-l-2 ${group.color}`}>{group.tier}</p>
              <div className="space-y-1.5">
                {group.data.map((w, j) => (
                  <div key={j} className="bg-background-50 rounded p-2.5 border border-background-100">
                    <p className="text-foreground-700 font-medium text-xs">
                      {renderSafeText(w.name)}
                      {w.reason && <span className="text-foreground-400 font-normal ml-1">— {renderSafeText(w.reason)}</span>}
                    </p>
                    {w.signal && <p className="text-foreground-500 text-[11px] mt-0.5">訊號線索：{renderSafeText(w.signal)}</p>}
                    {(w.strong_condition || w.weak_condition) && (
                      <p className="text-foreground-500 text-[11px]">
                        強：{renderSafeText(w.strong_condition)} / 弱：{renderSafeText(w.weak_condition)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 10. timeline
  const timeline = grabArr(section, 'timeline') as Record<string, unknown>[];
  if (timeline.length > 0) {
    blocks.push(
      <div key="timeline">
        <BlockLabel>時間軸</BlockLabel>
        <div className="space-y-2 mt-1">
          {timeline.map((t, i) => (
            <div key={i} className="bg-background-50 rounded p-2.5 border border-background-100">
              {t.time && <p className="text-foreground-700 font-semibold text-xs">{renderSafeText(t.time)}</p>}
              {t.question && (
                <p className="text-foreground-600 text-[11px] mt-0.5">
                  <span className="text-foreground-400">問題：</span>{renderSafeText(t.question)}
                </p>
              )}
              {(t.what_to_watch || t.interpretation) && (
                <p className="text-foreground-500 text-[11px]">
                  <span className="text-foreground-400">觀察：</span>{renderSafeText(t.what_to_watch ?? t.interpretation)}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 11. Close review fields
  const hasCloseReview = ['premarket_assumption', 'close_result', 'verification_result', 'what_was_right',
    'what_was_conservative_or_wrong', 'tomorrow_adjustment'].some((k) => grab(section, k) !== '—');

  if (hasCloseReview) {
    blocks.push(
      <div key="close_review" className="bg-background-50 rounded-lg p-3 border border-background-100">
        <BlockLabel>收盤驗證</BlockLabel>
        <div className="space-y-1 mt-1">
          <SectionLine label="盤前假設" value={grab(section, 'premarket_assumption')} />
          <SectionLine label="收盤結果" value={grab(section, 'close_result')} />
          <SectionLine label="驗證結論" value={grab(section, 'verification_result')} highlight />
          <SectionLine label="判斷正確" value={grab(section, 'what_was_right')} />
          <SectionLine label="偏保守或失準" value={grab(section, 'what_was_conservative_or_wrong')} />
          <SectionLine label="明日修正" value={grab(section, 'tomorrow_adjustment')} />
        </div>
      </div>
    );
  }

  // 12. Validation feedback fields
  const hasValidationFeedback = ['recent_review_summary', 'adjustment_today', 'signals_to_confirm',
    'risk_if_repeated'].some((k) => grab(section, k) !== '—' || grabArr(section, k).length > 0);

  if (hasValidationFeedback) {
    blocks.push(
      <div key="validation_feedback" className="bg-teal-500/3 rounded-lg p-3 border border-teal-500/10">
        <BlockLabel colorClass="text-teal-500">最近驗證回饋</BlockLabel>
        <div className="space-y-1 mt-1">
          <SectionLine label="驗證摘要" value={grab(section, 'recent_review_summary')} />
          <SectionLine label="今日修正" value={grab(section, 'adjustment_today')} />
          {grabArr(section, 'signals_to_confirm').length > 0 && (
            <div>
              <span className="text-foreground-400 text-[10px]">需確認訊號：</span>
              <ul className="list-disc list-inside mt-0.5">
                {grabArr(section, 'signals_to_confirm').map((sig, i) => (
                  <li key={i} className="text-foreground-600 text-xs">{renderSafeText(sig)}</li>
                ))}
              </ul>
            </div>
          )}
          <SectionLine label="重複風險" value={grab(section, 'risk_if_repeated')} />
        </div>
      </div>
    );
  }

  // 13. Generic text fields that don't match any pattern above
  const genericFields = Object.entries(section).filter(([k, v]) => {
    if (typeof k !== 'string') return false;
    if (v === null || v === undefined || v === '') return false;
    if (['key', 'title'].includes(k)) return false;
    // Skip fields we've already rendered above
    const renderedFields = new Set([
      'conclusion', 'reasoning', 'supporting_signals', 'confirmation_conditions',
      'risk_note', 'evidence_items', 'chains', 'items', 'core_watch', 'secondary_watch',
      'risk_watch', 'timeline', 'premarket_assumption', 'close_result', 'verification_result',
      'what_was_right', 'what_was_conservative_or_wrong', 'tomorrow_adjustment',
      'recent_review_summary', 'adjustment_today', 'signals_to_confirm', 'risk_if_repeated',
      'content',
    ]);
    return !renderedFields.has(k);
  });

  for (const [k, v] of genericFields) {
    if (typeof v === 'string' && v.trim()) {
      blocks.push(<SectionLine key={k} label={formatFieldLabel(k)} value={v} />);
    } else if (typeof v === 'number') {
      blocks.push(<SectionLine key={k} label={formatFieldLabel(k)} value={String(v)} />);
    } else if (Array.isArray(v) && v.length > 0) {
      blocks.push(
        <div key={k}>
          <BlockLabel>{formatFieldLabel(k)}</BlockLabel>
          <ul className="list-disc list-inside mt-0.5 space-y-0.5">
            {v.map((item, i) => (
              <li key={i} className="text-foreground-600 text-xs">{renderSafeText(item)}</li>
            ))}
          </ul>
        </div>
      );
    } else if (typeof v === 'object' && v !== null) {
      // Nested object — render as safe JSON
      const json = safeJsonStringify(v);
      if (json) {
        blocks.push(
          <div key={k} className="bg-background-50 rounded p-2.5 border border-background-100">
            <BlockLabel>{formatFieldLabel(k)}</BlockLabel>
            <pre className="text-foreground-600 text-[10px] mt-0.5 whitespace-pre-wrap font-mono leading-relaxed">{json}</pre>
          </div>
        );
      }
    }
  }

  // If absolutely nothing was rendered, show a graceful empty state
  if (blocks.length === 0) {
    return (
      <p className="text-foreground-400 text-xs">此欄位資料尚未產生。</p>
    );
  }

  return <>{blocks}</>;
}

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

function formatFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    conclusion: '結論',
    reasoning: '判斷理由',
    supporting_signals: '支持訊號',
    confirmation_conditions: '成立條件',
    risk_note: '風險提醒',
    evidence_items: '資料證據',
    chains: '影響鏈',
    items: '重點清單',
    core_watch: '核心觀察',
    secondary_watch: '次要觀察',
    risk_watch: '風險觀察',
    timeline: '時間軸',
    premarket_assumption: '盤前假設',
    close_result: '收盤結果',
    verification_result: '驗證結論',
    what_was_right: '判斷正確',
    what_was_conservative_or_wrong: '偏保守或失準',
    tomorrow_adjustment: '明日修正',
    recent_review_summary: '驗證摘要',
    adjustment_today: '今日修正',
    signals_to_confirm: '需確認訊號',
    risk_if_repeated: '重複風險',
    catalyst: '催化事件',
    affected_sectors: '影響族群',
    representative_stocks: '代表觀察股',
    intraday_watch_points: '盤中觀察點',
    invalidation_condition: '失效條件',
    condition: '條件',
    meaning: '含義',
    required_adjustment: '需修正',
    signal: '訊號',
    observation: '觀察',
    interpretation: '解讀',
    supports: '支持',
    name: '名稱',
    role: '角色',
    reason: '原因',
    strong_condition: '強條件',
    weak_condition: '弱條件',
    time: '時間',
    question: '問題',
    what_to_watch: '觀察重點',
    thesis: '論點',
    description: '說明',
    summary: '摘要',
    note: '備註',
    text: '內容',
    content: '內文',
  };
  return labels[field] || field.replace(/_/g, ' ');
}

function safeJsonStringify(obj: unknown): string | null {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════
// Validation Feedback Renderer
// ═══════════════════════════════════════════════════

export function renderValidationFeedback(
  aiJson: Record<string, unknown> | null,
  memberNote: Record<string, unknown> | null,
) {
  const vf = grabObj(aiJson, 'recent_validation_feedback');
  if (!vf) {
    return (
      <div className="bg-background-50 rounded-lg p-4 text-center">
        <p className="text-foreground-500 text-sm">最近驗證回饋尚未產生。</p>
      </div>
    );
  }

  const vfAvail = (vf as Record<string, unknown>).available === true;
  if (!vfAvail) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
        <i className="ri-information-line text-amber-500 text-base mt-0.5"></i>
        <div>
          <p className="text-amber-700 text-sm font-medium">最近驗證資料不足</p>
          <p className="text-amber-600/70 text-xs mt-1">
            最近沒有足夠的收盤驗證資料，今日判讀無法依據歷史偏差修正。請確認 close-market-review 是否正常運作。
          </p>
        </div>
      </div>
    );
  }

  const vfLookback = typeof (vf as Record<string, unknown>).lookback_days === 'number' ? (vf as Record<string, unknown>).lookback_days : 0;
  const vfDate = String((vf as Record<string, unknown>).latest_review_date || '—');
  const vfSummary = String((vf as Record<string, unknown>).recent_pattern_summary || '—');
  const vfCorrection = Array.isArray((vf as Record<string, unknown>).bias_correction_notes) ? (vf as Record<string, unknown>).bias_correction_notes as string[] : [];
  const vfMistakes = Array.isArray((vf as Record<string, unknown>).repeated_mistakes) ? (vf as Record<string, unknown>).repeated_mistakes as string[] : [];
  const vfWorked = Array.isArray((vf as Record<string, unknown>).what_worked) ? (vf as Record<string, unknown>).what_worked as string[] : [];
  const vfAdjust = Array.isArray((vf as Record<string, unknown>).what_to_adjust_next_report) ? (vf as Record<string, unknown>).what_to_adjust_next_report as string[] : [];
  const vfCaution = String((vf as Record<string, unknown>).caution_for_today_prompt || '');

  const sections = grabArr(memberNote, 'sections') as Record<string, unknown>[];
  const vfaSection = sections.find((s) => s.key === 'validation_feedback_adjustment');
  const hasVfaSection = !!vfaSection && String(vfaSection.conclusion || '').length >= 10;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-background-50 border border-background-100">
          <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">回顧天數</p>
          <p className="text-foreground-800 text-sm font-bold">{String(vfLookback)} 天</p>
        </div>
        <div className="p-3 rounded-lg bg-background-50 border border-background-100">
          <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">最近驗證日期</p>
          <p className="text-foreground-800 text-sm font-bold">{vfDate}</p>
        </div>
        <div className="p-3 rounded-lg bg-background-50 border border-background-100">
          <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">已納入 OpenAI prompt</p>
          <p className={`text-sm font-bold ${hasVfaSection ? 'text-emerald-600' : 'text-amber-600'}`}>
            {hasVfaSection ? '已納入' : '尚未納入'}
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl bg-primary-500/3 border border-primary-500/10">
        <p className="text-foreground-500 text-[10px] uppercase tracking-wider mb-1.5">最近驗證模式</p>
        <p className="text-foreground-800 text-sm leading-relaxed font-medium">{vfSummary}</p>
      </div>

      {vfCorrection.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/3 border border-amber-500/15">
          <p className="text-amber-700 text-[10px] uppercase tracking-wider font-semibold mb-2">盤前偏差修正</p>
          <ul className="space-y-1">
            {vfCorrection.map((n, i) => (
              <li key={i} className="text-amber-800 text-xs flex items-start gap-2">
                <i className="ri-arrow-right-circle-line text-amber-500 mt-0.5 flex-shrink-0"></i>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vfMistakes.length > 0 && (
        <div className="p-4 rounded-xl bg-red-500/3 border border-red-500/15">
          <p className="text-red-600 text-[10px] uppercase tracking-wider font-semibold mb-2">重複錯誤</p>
          <ul className="space-y-1">
            {vfMistakes.map((n, i) => (
              <li key={i} className="text-red-700 text-xs flex items-start gap-2">
                <i className="ri-alert-line text-red-500 mt-0.5 flex-shrink-0"></i>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vfWorked.length > 0 && (
        <div className="p-4 rounded-xl bg-emerald-500/3 border border-emerald-500/15">
          <p className="text-emerald-600 text-[10px] uppercase tracking-wider font-semibold mb-2">做得好的部分</p>
          <ul className="space-y-1">
            {vfWorked.map((n, i) => (
              <li key={i} className="text-emerald-700 text-xs flex items-start gap-2">
                <i className="ri-check-line text-emerald-500 mt-0.5 flex-shrink-0"></i>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vfAdjust.length > 0 && (
        <div className="p-4 rounded-xl bg-sky-500/3 border border-sky-500/15">
          <p className="text-sky-600 text-[10px] uppercase tracking-wider font-semibold mb-2">今日建議調整</p>
          <ul className="space-y-1">
            {vfAdjust.map((n, i) => (
              <li key={i} className="text-sky-700 text-xs flex items-start gap-2">
                <i className="ri-compass-3-line text-sky-500 mt-0.5 flex-shrink-0"></i>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vfCaution && (
        <div className="p-4 rounded-xl bg-white border border-background-200">
          <p className="text-foreground-500 text-[10px] uppercase tracking-wider mb-1.5">今日注意</p>
          <p className="text-foreground-700 text-sm leading-relaxed">{vfCaution}</p>
        </div>
      )}

      {vfaSection && (
        <div className="p-4 rounded-xl bg-white border border-background-200">
          <p className="text-foreground-500 text-[10px] uppercase tracking-wider mb-2">第 9 段：最近驗證回饋與今日修正</p>
          <div className="space-y-2 text-xs">
            <p className="text-foreground-800">
              <span className="text-foreground-400">驗證結論：</span>
              {renderSafeText(vfaSection.conclusion)}
            </p>
            <p className="text-foreground-700">
              <span className="text-foreground-400">驗證摘要：</span>
              {renderSafeText(vfaSection.recent_review_summary)}
            </p>
            <p className="text-foreground-700">
              <span className="text-foreground-400">今日修正：</span>
              {renderSafeText(vfaSection.adjustment_today)}
            </p>
            {Array.isArray((vfaSection as Record<string, unknown>).signals_to_confirm) && ((vfaSection as Record<string, unknown>).signals_to_confirm as unknown[]).length > 0 && (
              <div>
                <span className="text-foreground-400">需確認訊號：</span>
                <ul className="list-disc list-inside mt-0.5">
                  {((vfaSection as Record<string, unknown>).signals_to_confirm as string[]).map((sig, i) => (
                    <li key={i} className="text-foreground-600">{renderSafeText(sig)}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-foreground-700">
              <span className="text-foreground-400">重複風險：</span>
              {renderSafeText(vfaSection.risk_if_repeated)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
