/** Owner requested zero additional paid model calls on 2026-11-01.
 * This is a code-level, fail-closed stop. Request fields and environment
 * values cannot opt in. Re-enabling requires a separate reviewed code change.
 * Official source acquisition and existing stored research readers remain usable.
 */
export const STOCK_AI_PAID_CALLS_ENABLED:boolean=false;
export const STOCK_AI_PAID_CALLS_DISABLED='STOCK_AI_PAID_MODEL_DISABLED';

export function assertStockAiPaidModelAllowed(){
 if(!STOCK_AI_PAID_CALLS_ENABLED)throw Error(STOCK_AI_PAID_CALLS_DISABLED);
}

/** Only the existing exact source selector is free of model execution.
 * Mixed source/repair/recovery selectors must never bypass the stop.
 */
export function stockAiPaidModelRequestGuard(input:unknown):Response|null{
 if(STOCK_AI_PAID_CALLS_ENABLED)return null;
 if(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===1
  &&Object.hasOwn(input,'intake_id')
  &&typeof (input as Record<string,unknown>).intake_id==='string'
  &&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test((input as {intake_id:string}).intake_id))return null;
 return Response.json({state:'PAUSED',error:STOCK_AI_PAID_CALLS_DISABLED,model_calls:0,
  automatic_continuation:false,requires_next_checkpoint:false,member_published:false},
 {status:409,headers:{'Cache-Control':'no-store'}});
}
