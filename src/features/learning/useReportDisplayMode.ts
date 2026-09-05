import { useCallback, useState } from 'react';
import { parseReportDisplayMode, REPORT_DISPLAY_MODE_KEY, type ReportDisplayMode } from './beginnerReportContract';

export function useReportDisplayMode() {
  const [mode, setMode] = useState<ReportDisplayMode>(() => {
    try { return parseReportDisplayMode(sessionStorage.getItem(REPORT_DISPLAY_MODE_KEY)); }
    catch { return 'professional'; }
  });
  const selectMode = useCallback((value: ReportDisplayMode) => {
    const next = parseReportDisplayMode(value);
    setMode(next);
    // Only the display preference is stored. Every mount still refetches server entitlement.
    try { sessionStorage.setItem(REPORT_DISPLAY_MODE_KEY, next); }
    catch { /* Restricted storage must not block report reading. */ }
  }, []);
  return [mode, selectMode] as const;
}
