// Private offline acceptance, no raw data in Git/CI and no provider requests.
import assert from 'node:assert/strict';
import {auditPublication} from '../scripts/vnext/publication-readiness.mjs';
assert(!process.env.CI,'PRIVATE_REAL_AUDIT_NOT_CI');
globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const r=auditPublication(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
assert.equal(r.cards.length,216);assert.equal(r.history_hash,'7b21dbe4b3cfd50371cd791d3988d24c1e137db1d397e50c41dbe0cc2274d4aa');
assert.equal(r.sources_hash,'ad8e4fb00b79a5d749194172c0c5c875e1a37902cb8ba374b4397a4e6af0fe9a');
assert.equal(r.cards.filter(c=>c.evidence_ready).length,0);assert.deepEqual(r.eligible,{SHORT:0,MEDIUM:0,LONG:0});
for(const c of r.cards){assert(c.company&&c.symbol&&c.reason&&c.confirmation&&c.invalidation&&c.next_review);assert(c.blockers.includes('PUBLICATION_REVIEW_REQUIRED'));}
assert(r.cards.filter(c=>c.horizon==='SHORT').every(c=>c.blockers.includes('LICENSING_UNVERIFIED')));
assert(r.cards.filter(c=>c.horizon==='MEDIUM').every(c=>c.blockers.includes('MISSING_ORDERS')&&c.rights.some(x=>x.status==='OPEN_DATA_WITH_ATTRIBUTION')));
assert(r.cards.filter(c=>c.horizon==='LONG').every(c=>c.blockers.includes('MISSING_VALUATION')&&c.blockers.includes('MISSING_DEMAND')));
assert(r.cards.every(c=>c.evidence_issues.some(x=>x.reason==='MISSING_PUBLISHED_AT')));
console.log(JSON.stringify({real_dossiers:216,universe:72,evidence_ready:0,member_eligible:r.eligible,source_hashes:'UNCHANGED',forward:0,outcome:0,network_requests:0,production_operations:0}));
