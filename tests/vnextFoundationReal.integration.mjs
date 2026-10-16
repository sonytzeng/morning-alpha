// Offline private real-source audit. Never public CI, never Production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {auditFoundation,foundationSummary,incrementalPlan} from '../scripts/vnext/foundation-validation.mjs';
import {loadRetainedResearch} from '../scripts/vnext/real-evidence.mjs';
import {validFoundation} from '../src/features/vnext/foundation.ts';
assert(!process.env.CI,'PRIVATE_REAL_AUDIT_NOT_CI');
globalThis.fetch=()=>{throw Error('OFFLINE_NO_NETWORK');};
const {history:h,sources:s,coverage,traded_coverage,old_cutoff_admissible}=auditFoundation(process.env.MA_VNEXT_FOUNDATION_DIR);
const summary=foundationSummary(process.env.MA_VNEXT_FOUNDATION_DIR);assert(validFoundation(summary));
assert.deepEqual(old_cutoff_admissible,[0,0]);assert.equal(s.adjusted_return_eligible,false);
const reports=await loadRetainedResearch(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
for(const r of reports){const prior=JSON.parse(readFileSync(resolve(process.env.MA_VNEXT_LOCK_DIR,r.business_date+'-'+r.snapshot_hash+'.json'),'utf8'));assert.deepEqual(r,prior,'OLD_REPLAY_LOCK_UNCHANGED');assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);}
const plan=incrementalPlan({completedSession:h.through,coreComplete:true,coreBusy:false,stocks:h.rows.map(r=>({symbol:r.symbol,exchange:r.exchange}))});assert.equal(plan.enabled,false);assert(plan.jobs.length<=12);
console.log(JSON.stringify({coverage,traded_coverage,missing:h.rows.filter(r=>!r.coverage[250].complete).map(r=>({symbol:r.symbol,valid:r.coverage[250].valid,gaps:r.coverage[250].gaps})),actions:s.actions.length,official_facts:summary.official_facts,event_sources:s.sources.filter(r=>r.kind==='EVENT').map(r=>({source_rows:r.source_rows,matched:r.matched})),relations:s.relations.length,old_cutoff_admissible,original_replay:'UNCHANGED',adjusted_return_eligible:false,daily_enabled:false,forward:0,outcome:0,production_writes:0,history_hash:summary.history_hash,sources_hash:summary.sources_hash}));
