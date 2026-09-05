export type ReportDisplayMode = 'professional' | 'beginner';
export const REPORT_DISPLAY_MODE_KEY = 'ma:today:display-mode';

/** A presentation preference never establishes identity or grants access. */
export function parseReportDisplayMode(value: unknown): ReportDisplayMode {
  return value === 'beginner' ? 'beginner' : 'professional';
}

export function canShowBeginnerRecommendations(input: {
  action: string;
  premiumEligible: boolean;
  decisionMode: string;
  reportDate: string | null | undefined;
  todayDate: string;
  isHistoricalFallback: boolean;
}): boolean {
  return input.action === 'ACT'
    && input.premiumEligible === true
    && input.decisionMode === 'recommendations'
    && input.isHistoricalFallback === false
    && /^\d{4}-\d{2}-\d{2}$/.test(input.todayDate)
    && input.reportDate === input.todayDate;
}
