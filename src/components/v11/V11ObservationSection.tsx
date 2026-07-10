import { renderSafeText } from '@/utils/renderSafe';

export type V11ObservationItem = {
  symbol: string;
  name: string;
  industryCode: string;
  industryName: string;
  rank: number | null;
  role: string;
  roleTitle: string;
  roleQuestion: string;
  decisionStep: number | null;
  nextRole: string;
  decisionConfidence: number | null;
  confirmationChecklist: string[];
  riskChecklist: string[];
  capitalRotationPath: string[];
  externalPriority: { title: string; importance: number }[];
  title: string;
  question: string;
  narrative: string;
  validationPoint: string;
  stopCondition: string;
  representativeSymbols: string[];
  representativeNames: string[];
  observationReason: string;
  confirmationPendingReason: string;
  stopObservingCondition: string;
  observationChain: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function externalPriorityList(value: unknown): { title: string; importance: number }[] {
  return asRecordArray(value)
    .map((item) => ({ title: text(item.title), importance: numberOrNull(item.importance) ?? 0 }))
    .filter((item) => item.title)
    .slice(0, 3);
}

function narrativeFallback(row: Record<string, unknown>, matcher: string): string {
  return textList(row.scoring_reasons).find((item) => item.includes(matcher))?.replace(/^.*?[：:]/, '').trim() || '';
}

export function mapV11ObservationItems(rows: unknown, limit = 5): V11ObservationItem[] {
  const seen = new Set<string>();

  return asRecordArray(rows)
    .map((row, index) => {
      const chain = textList(row.observation_chain || row.benefit_chain);
      const representativeSymbols = textList(row.representative_symbols);
      const representativeNames = textList(row.representative_names);
      const industryName = text(row.industry_name || row.industry || row.sector || row.industry_code);
      const symbol = text(row.symbol || row.stock_id || row.stock_code || representativeSymbols[0]);
      const name = text(row.name || row.stock_name || row.company_name || representativeNames[0]);
      const narrative = text(row.narrative || row.description || row.reason) || text(row.observation_reason) || narrativeFallback(row, '為什麼');
      const validationPoint = text(row.validation_point || row.confirmation_reason) || text(row.confirmation_pending_reason) || narrativeFallback(row, '還缺');
      const stopCondition = text(row.stop_condition) || text(row.stop_observing_condition) || narrativeFallback(row, '不用再觀察');
      return {
        symbol,
        name,
        industryCode: text(row.industry_code),
        industryName,
        rank: numberOrNull(row.rank) ?? index + 1,
        role: text(row.role),
        roleTitle: text(row.role_title),
        roleQuestion: text(row.role_question),
        decisionStep: numberOrNull(row.decision_step),
        nextRole: text(row.next_role),
        decisionConfidence: numberOrNull(row.decision_confidence),
        confirmationChecklist: textList(row.confirmation_checklist),
        riskChecklist: textList(row.risk_checklist),
        capitalRotationPath: textList(row.capital_rotation_path),
        externalPriority: externalPriorityList(row.external_priority),
        title: text(row.title),
        question: text(row.question),
        narrative,
        validationPoint,
        stopCondition,
        representativeSymbols,
        representativeNames,
        observationReason: narrative,
        confirmationPendingReason: validationPoint,
        stopObservingCondition: stopCondition,
        observationChain: chain,
      };
    })
    .filter((item) => Boolean(item.symbol || item.name || item.observationReason))
    .filter((item) => {
      const key = [
        item.role || item.industryCode || item.industryName,
        item.roleQuestion || item.question,
        item.narrative || item.observationReason,
        item.validationPoint || item.confirmationPendingReason,
        item.stopCondition || item.stopObservingCondition,
      ].map((part) => part.trim().toLowerCase()).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function roleStepLabel(item: V11ObservationItem): string {
  const fallback: Record<string, number> = {
    MAIN_THESIS: 1,
    CONFIRMATION: 2,
    RISK: 3,
    CAPITAL_NEXT: 4,
    EXTERNAL: 5,
  };
  const step = item.decisionStep ?? fallback[item.role];
  return step ? `STEP ${step}` : 'STEP';
}

function checklistFor(item: V11ObservationItem): string[] {
  if (item.role === 'CONFIRMATION' && item.confirmationChecklist.length > 0) return item.confirmationChecklist;
  if (item.role === 'RISK' && item.riskChecklist.length > 0) return item.riskChecklist;
  if (item.role === 'EXTERNAL' && item.externalPriority.length > 0) {
    return item.externalPriority.map((entry) => `${entry.title}｜重要度 ${entry.importance}/5`);
  }
  return [];
}

function flowFor(item: V11ObservationItem): string[] {
  if (item.role === 'CAPITAL_NEXT' && item.capitalRotationPath.length > 0) return item.capitalRotationPath;
  return item.observationChain;
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    MAIN_THESIS: '今日主線',
    CONFIRMATION: '確認條件',
    RISK: '最大風險',
    CAPITAL_NEXT: '資金下一站',
    EXTERNAL: '外部變數',
  };
  return labels[role] || '觀察劇本';
}

function scriptTitle(item: V11ObservationItem): string {
  if (item.roleQuestion) return item.roleQuestion;
  if (item.roleTitle) return item.roleTitle;
  if (item.title) return item.title;
  if (item.question) return item.question;
  if (item.industryName) return `${item.industryName}今天扮演什麼角色？`;
  return '今天有沒有新主線？';
}

function scriptSummary(item: V11ObservationItem): string {
  const target = [item.symbol, item.name].filter(Boolean).join(' ');
  if (item.narrative) return item.narrative;
  if (item.observationReason) return item.observationReason;
  if (item.observationChain.length > 0) return item.observationChain.join(' → ');
  if (item.industryName && target) return `${item.industryName}還沒轉成強受惠，先看 ${target} 是否出現第一個確認訊號。`;
  if (item.industryName) return `${item.industryName}還在等待市場表態。`;
  return '這條線還沒有足夠正向證據，今天先放在觀察清單。';
}

function Card({ item, tone }: { item: V11ObservationItem; tone: 'light' | 'dark' }) {
  const isDark = tone === 'dark';
  const cardClass = isDark
    ? 'bg-white/[0.035] border-white/8'
    : 'bg-background-50 border-background-200/70';
  const labelClass = isDark ? 'text-white/38' : 'text-foreground-400';
  const titleClass = isDark ? 'text-white' : 'text-foreground-900';
  const bodyClass = isDark ? 'text-white/70' : 'text-foreground-600';
  const mutedClass = isDark ? 'text-white/45' : 'text-foreground-400';

  return (
    <article className={`rounded-2xl border p-4 md:p-5 ${cardClass}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className={`text-[10px] uppercase tracking-[0.22em] mb-1 ${labelClass}`}>{renderSafeText(roleStepLabel(item))} · {renderSafeText(roleLabel(item.role))}</p>
          <h3 className={`text-base font-bold leading-snug ${titleClass}`}>{renderSafeText(scriptTitle(item))}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] border ${isDark ? 'bg-amber-400/10 text-amber-200 border-amber-300/20' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
          {item.decisionConfidence !== null ? `信心 ${Math.round(item.decisionConfidence)}` : '觀察'}
        </span>
      </div>

      <div className={`mb-4 rounded-xl border px-3 py-2 ${isDark ? 'bg-black/15 border-white/5' : 'bg-white border-background-200/70'}`}>
        <p className={`text-xs ${mutedClass}`}>代表股</p>
        <p className={`text-sm font-semibold ${titleClass}`}>
          {[...(item.representativeSymbols.length > 0 ? item.representativeSymbols : [item.symbol]), ...(item.representativeNames.length > 0 ? item.representativeNames : [item.name])].filter(Boolean).slice(0, 2).join(' / ') || '待確認代表股'}
        </p>
      </div>

      {flowFor(item).length > 1 && (
        <div className={`mb-4 rounded-xl border px-3 py-2 text-xs ${isDark ? 'bg-white/[0.025] border-white/5 text-white/58' : 'bg-white border-background-200/70 text-foreground-500'}`}>
          {flowFor(item).slice(0, 5).map((part, index) => (
            <span key={`${part}-${index}`}>{index > 0 ? ' → ' : ''}{renderSafeText(part)}</span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <p className={`text-[10px] font-semibold mb-1 ${labelClass}`}>一句摘要</p>
          <p className={`text-sm leading-relaxed ${bodyClass}`}>{renderSafeText(scriptSummary(item))}</p>
        </div>
        <div>
          <p className={`text-[10px] font-semibold mb-1 ${labelClass}`}>為什麼重要</p>
          <p className={`text-sm leading-relaxed ${bodyClass}`}>{renderSafeText(item.observationReason || '市場還在找下一條能接棒的資金路線。')}</p>
        </div>
        <div>
          <p className={`text-[10px] font-semibold mb-1 ${labelClass}`}>今天看什麼</p>
          <p className={`text-sm leading-relaxed ${bodyClass}`}>{renderSafeText(item.validationPoint || item.confirmationPendingReason || '先看 09:30 後有沒有量能和同族群跟進。')}</p>
          {checklistFor(item).length > 0 && (
            <ul className={`mt-2 space-y-1 text-xs leading-relaxed ${bodyClass}`}>
              {checklistFor(item).slice(0, 4).map((entry, index) => (
                <li key={`${entry}-${index}`}>□ {renderSafeText(entry)}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className={`text-[10px] font-semibold mb-1 ${labelClass}`}>何時停看</p>
          <p className={`text-sm leading-relaxed ${bodyClass}`}>{renderSafeText(item.stopCondition || item.stopObservingCondition || '若開盤後沒有資金跟進，今天先把這條線降權。')}</p>
        </div>
      </div>
    </article>
  );
}

type V11ObservationSectionProps = {
  items: V11ObservationItem[];
  tone?: 'light' | 'dark';
  className?: string;
  title?: string;
  subtitle?: string;
  emptyText?: string;
};

export default function V11ObservationSection({
  items,
  tone = 'dark',
  className = '',
  title = '今日五大觀察劇本',
  subtitle = '五條值得盯盤的線索：有機會，但還沒到強受惠。',
  emptyText = '今天還沒有值得放進觀察清單的明確線索。',
}: V11ObservationSectionProps) {
  const isDark = tone === 'dark';
  const sectionClass = isDark
    ? 'bg-navy-900/70 border-navy-800'
    : 'bg-background-100 border-background-200/70';
  const titleClass = isDark ? 'text-white' : 'text-foreground-900';
  const subtitleClass = isDark ? 'text-white/50' : 'text-foreground-500';

  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${sectionClass} ${className}`}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-5">
        <div>
          <p className={`text-[10px] uppercase tracking-[0.3em] font-semibold mb-2 ${isDark ? 'text-amber-200/80' : 'text-amber-700'}`}>
            Morning Brief
          </p>
          <h2 className={`text-lg md:text-xl font-bold ${titleClass}`}>{title}</h2>
          <p className={`text-xs md:text-sm leading-relaxed mt-1 ${subtitleClass}`}>{subtitle}</p>
        </div>
        <span className={`self-start rounded-full px-2.5 py-1 text-[10px] border ${isDark ? 'bg-amber-400/10 text-amber-200 border-amber-300/20' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
          {items.length} 個劇本
        </span>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map((item, index) => (
            <Card key={`${item.symbol || item.name || 'script'}-${item.rank ?? index}`} item={item} tone={tone} />
          ))}
        </div>
      ) : (
        <div className={`rounded-xl border p-4 text-sm leading-relaxed ${isDark ? 'bg-white/[0.025] border-white/5 text-white/55' : 'bg-background-50 border-background-200/70 text-foreground-500'}`}>
          {emptyText}
        </div>
      )}
    </section>
  );
}
