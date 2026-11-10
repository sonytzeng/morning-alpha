import {refreshDailyAiFinancials} from '../../../research/daily-ai-financial-refresh.ts';
import {withRetainedSecDailyFinancials} from '../../../research/sec-daily-financial-replay.candidate.ts';
import {withDocumentedReviewV2Financials} from '../../../research/documented-review-replay-v2.candidate.ts';
import {withRetainedIssuerIrDailyFinancials} from '../../../research/issuer-ir-daily-financial-replay.ts';
import {withRetainedUmcIrDailyFinancials} from '../../../research/umc-ir-daily-financial-replay.ts';
import {withRetainedInstitutionalDailyFinancials} from '../../../research/institutional-daily-financial-replay.ts';
import {withRetainedIssuer16DailyFinancials} from '../../../research/issuer16-daily-financial-replay.ts';
import {withRetainedPortalMarginDailyFinancials} from '../../../research/portal-margin-daily-financial-replay.ts';
export function createFinancialRefresh(rpc:(name:string,args:Record<string,unknown>,signal?:AbortSignal)=>Promise<unknown>){
const localFinancialRefresh=withRetainedPortalMarginDailyFinancials(withRetainedIssuer16DailyFinancials(withRetainedInstitutionalDailyFinancials(withRetainedUmcIrDailyFinancials(withRetainedIssuerIrDailyFinancials(
    withDocumentedReviewV2Financials(withRetainedSecDailyFinancials(refreshDailyAiFinancials,(args,registrySignal)=>rpc('load_daily_stock_ai_sec_replay_v1',args,registrySignal))),
    (args,registrySignal)=>rpc('load_daily_stock_ai_issuer_ir_replay_v1',args,registrySignal),
   ),(args,registrySignal)=>rpc('load_daily_stock_ai_umc_ir_replay_v1',args,registrySignal)),(args,registrySignal)=>rpc('load_daily_stock_ai_institutional_replay_v1',args,registrySignal)),(args,registrySignal)=>rpc('load_daily_stock_ai_issuer16_replay_v1',args,registrySignal)),(args,registrySignal)=>rpc('load_daily_stock_ai_portal_margin_replay_v1',args,registrySignal));
return localFinancialRefresh;
}
