// SYNTHETIC local render/race control only, not a Production identity test.
import { lineDecisionFixture } from '../helpers/lineDecisionFixture.mjs';
let listener: (event: string) => void = () => {};
let allowed = new URLSearchParams(location.search).get('role') === 'owner';
export const logout = () => { allowed = false; listener('SIGNED_OUT'); };
export const supabase = { auth: { onAuthStateChange(fn: typeof listener) { listener = fn; return {data:{subscription:{unsubscribe(){}}}}; } },
 rpc: async (name: string) => ({ error: allowed ? null : {code:'42501'}, data: name === 'get_research_foundation_v1' ? {} : null }) };
export const callGetReportHistory = async () => ({ reports: ['2026-10-05','2026-10-06','2026-10-07'].map(report_date=>({report_date})) });
export async function callGetReportPayload({reportDate}: {reportDate: string | null}) {
 await new Promise(resolve => setTimeout(resolve, new URLSearchParams(location.search).has('slow') ? 1500 : 30));
 const r = lineDecisionFixture();
 if(reportDate) {
  r.report_date=reportDate;r.subscriber_projection.identity.reportDate=reportDate;
  r.payload.admin_source_report.ai_strategy_json.canonical_market_state.report_date=reportDate;
  r.payload.admin_source_report.ai_strategy_json.canonical_market_state.document.report_date=reportDate;
 }
 return r;
}
