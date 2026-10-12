import {HORIZONS,snapshotHash,type Horizon} from './contracts.ts';
export type DailyPreview={schema:'VNEXT_DAILY_OWNER_PREVIEW_1';classification:'HISTORICAL_REPLAY_NOT_CURRENT';through:string;evaluated_at:string;locked_at:string;
 summary:{horizons:Record<Horizon,{scanned:number;qualified:number;rejected:number;insufficient:number}>;entry_source_missing_symbols:number;forward_sample:0;outcome_sample:0;free_visible:0;premium_visible:0;natural_forward_execution:'NOT_ENABLED'};
 stages:string[];pending_outcomes:number;unknown_outcomes:number;rows:{symbol:string;company:string;horizon:Horizon;state:string;reason:string;confirmation:string;invalidation:string;risk:string;next_review_at:string;entry_source_missing:boolean;entry:{strategy:string;status:string;reasons:string[];trigger:string|null;invalidation:string|null}[]}[];
 source_hash:string;run_key:string;snapshot_hash:string;production_changed:false};
export async function verifyDailyPreview(value:DailyPreview){
 const {snapshot_hash,...body}=value;
 return value.schema==='VNEXT_DAILY_OWNER_PREVIEW_1'&&value.classification==='HISTORICAL_REPLAY_NOT_CURRENT'&&value.production_changed===false
  &&value.rows.length===216&&new Set(value.rows.map(r=>r.symbol+':'+r.horizon)).size===216
  &&Object.keys(HORIZONS).every(h=>value.rows.filter(r=>r.horizon===h).length===72)
  &&value.summary.forward_sample===0&&value.summary.outcome_sample===0&&value.summary.free_visible===0&&value.summary.premium_visible===0
  &&value.summary.natural_forward_execution==='NOT_ENABLED'&&snapshot_hash===await snapshotHash(body);
}
