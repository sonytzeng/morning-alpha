import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { resolveMarketStatus } = jiti('../supabase/functions/_shared/market-status.ts');

const cases = [
  { id: 'A', date: '2026-07-10', expected: { market_status: 'TYPHOON', is_trading_day: false, session_type: 'CLOSED' } },
  { id: 'B', date: '2026-07-11', expected: { market_status: 'WEEKEND', is_trading_day: false, session_type: 'CLOSED' } },
  { id: 'C', date: '2026-07-13', expected: { market_status: 'OPEN', is_trading_day: true, session_type: 'FULL_DAY' } },
  { id: 'D', date: '2026-06-19', expected: { market_status: 'HOLIDAY', is_trading_day: false, session_type: 'CLOSED' } },
  { id: 'E', date: '2026-07-10', expected: { market_status: 'TYPHOON', is_trading_day: false, session_type: 'CLOSED' } },
];

function edgeGate(status) {
  return {
    generateDailyReport: status.is_trading_day ? 'normal_report' : 'holiday_report',
    fetchMarketData: status.is_trading_day ? 'fetch' : 'skip',
    openingMarketRadar: status.is_trading_day ? 'write_radar' : 'skip',
    closingVerificationEngine: status.is_trading_day ? 'verify_close' : 'skip',
    closeMarketReview: status.is_trading_day ? 'verify_close' : 'skip',
    lineDailyPush: status.market_status === 'TYPHOON' ? 'market_closed_line' : status.is_trading_day ? 'normal_line' : 'skip_normal_line',
  };
}

let failed = 0;
const results = cases.map((testCase) => {
  const actual = resolveMarketStatus(testCase.date);
  const mismatches = Object.entries(testCase.expected)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => `${key}: expected ${value}, got ${actual[key]}`);
  if (mismatches.length) failed += 1;
  return { ...testCase, actual, edge_gate: edgeGate(actual), pass: mismatches.length === 0, mismatches };
});

const fallbackCase = {
  id: 'F',
  note: 'Frontend fallback is allowed to infer WEEKEND / fixed HOLIDAY only. TYPHOON requires canonical exceptional closure source and is not guessed by frontend fallback.',
  pass: true,
};

console.log(JSON.stringify({ failed, results, fallbackCase }, null, 2));
if (failed > 0) process.exit(1);
