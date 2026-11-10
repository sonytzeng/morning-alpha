import type {DailyAiPricePlanBody} from './dailyAiPricePlan.ts';

// This is the existing UI's display capacity, NOT an exchange tick rule or a
// statement of source precision. Never round a reviewed threshold for display.
const formatter=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2});
export const DAILY_AI_PRICE_PRECISION_PENDING='價格數值需要額外精度核對，暫不顯示區間與停止價。';
export type DailyAiPriceDisplay=Readonly<{entry_range:readonly [string,string];wait_above:string;stop:string|null}>;

function exactDisplay(value:number):string|null{
 if(!Number.isFinite(value)||value<=0||!Number.isSafeInteger(Math.trunc(value)))return null;
 const shown=formatter.format(value);
 return Number(shown.replaceAll(',',''))===value?shown:null;
}

/** All numeric thresholds display together or none do. The original body and
 * hash remain intact. This does not attest source precision or orderability. */
export function dailyAiPriceDisplay(plan:DailyAiPricePlanBody):DailyAiPriceDisplay|null{
 const low=exactDisplay(plan.entry_range[0]),high=exactDisplay(plan.entry_range[1]),wait=exactDisplay(plan.wait_above);
 const stop=plan.stop_kind==='PRICE'&&plan.stop!==null?exactDisplay(plan.stop):null;
 if(low===null||high===null||wait===null||plan.stop_kind==='PRICE'&&stop===null)return null;
 return Object.freeze({entry_range:Object.freeze([low,high]) as readonly [string,string],wait_above:wait,stop});
}
