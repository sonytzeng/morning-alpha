/** Candidate-only response filter for both JSON copies saved by Generator248.
 * Auth remains the existing request-user Owner predicate. No stored mutation. */
import {withoutResearchOwnerReceipt as stripAiReceipt} from './research-owner-field-access.ts';
export {canReadResearchOwnerFields} from './research-owner-field-access.ts';

export function withoutResearchOwnerReceipt<T extends Record<string,unknown>>(report:T):T {
 const primary=stripAiReceipt(report);
 const raw=stripAiReceipt({ai_strategy_json:report.raw_ai_json});
 if(raw.ai_strategy_json===report.raw_ai_json)return primary;
 return {...primary,raw_ai_json:raw.ai_strategy_json};
}
