/** Private retained evidence; no acquisition, production or synthetic performance. */
import assert from 'node:assert/strict';
import {retainedDailyCandidate} from '../scripts/vnext/daily-retained.mjs';
import {verifyDailyPreview} from '../src/features/vnext/dailyPreview.ts';
assert(!process.env.CI);globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const e=process.env,r=await retainedDailyCandidate({foundation:e.MA_VNEXT_FOUNDATION_DIR,names:e.MA_VNEXT_DISPLAY_NAMES,stock:e.MA_VNEXT_STOCK_DIR,context:e.MA_VNEXT_CONTEXT_DIR,directory:e.MA_VNEXT_DAILY_DIR,now:new Date().toISOString()});
assert.equal(r.funnel_hash,'805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3');
assert.deepEqual(r.summary.horizons,{SHORT:{scanned:72,qualified:1,rejected:71,insufficient:0},MEDIUM:{scanned:72,qualified:28,rejected:44,insufficient:0},LONG:{scanned:72,qualified:0,rejected:0,insufficient:72}});
assert.equal(r.idempotency,'ALREADY_COMPLETE');assert.equal(r.checkpoint.locks.length,216);assert.equal(r.checkpoint.outcome.rows.length,648);
assert.equal(r.summary.entry_source_missing_symbols,72);assert.equal(r.checkpoint.publication.eligible,0);
assert(r.checkpoint.locks.every(l=>l.mode==='HISTORICAL_REPLAY'&&l.provenance==='RETAINED_REAL_EVIDENCE'));
assert(r.checkpoint.outcome.rows.every(o=>!o.performance_eligible&&o.net_return===null&&o.forward_performance_sample===0));
assert(await verifyDailyPreview(r.preview));
console.log(JSON.stringify({identity:'RETAINED_REAL_EVIDENCE_NOT_FORWARD',horizons:r.summary.horizons,entry_missing:72,predictions:216,outcome_tracking_states:648,forward:0,measured_outcome:0,publication:0,idempotency:r.idempotency,source_hash:r.funnel_hash,preview_hash:r.preview.snapshot_hash,production_operations:0}));
