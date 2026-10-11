/** Private real29 audit. Offline, unchanged research. No grants or approval writes. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditResearchFunnel} from '../scripts/vnext/research-funnel.mjs';
import {auditFirstPublication} from '../scripts/vnext/first-publication-review.mjs';
import {auditMemberAdmission} from '../scripts/vnext/member-admission.mjs';
import {admissionSummary,approvedProjection,appendOwnerDecision} from '../src/features/vnext/publicationAdmission.ts';
import {publicationMatrix} from '../src/features/vnext/publicationBlockers.ts';
import {REVIEW_FILE} from '../scripts/vnext/publication-blockers.mjs';
import {privateDirectory,immutable} from '../scripts/vnext/foundation-history.mjs';
import {resolve} from 'node:path';
assert(!process.env.CI);globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const e=process.env,doc=JSON.parse(readFileSync(REVIEW_FILE,'utf8')),at=doc.reviewed_at;
const f=await auditResearchFunnel(e.MA_VNEXT_FOUNDATION_DIR,e.MA_VNEXT_DISPLAY_NAMES,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR);
assert.equal(f.snapshot_hash,'805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3');
const review=await auditFirstPublication(f,e.MA_VNEXT_STOCK_DIR,e.MA_VNEXT_CONTEXT_DIR,'2026-10-11T08:13:04.000Z');
assert.equal(review.snapshot_hash,doc.review_bundle_hash);
const before=JSON.stringify(review),{admission:a,registry}=await auditMemberAdmission(f,review,{foundation:e.MA_VNEXT_FOUNDATION_DIR,stock:e.MA_VNEXT_STOCK_DIR,context:e.MA_VNEXT_CONTEXT_DIR,reviewed:true},at);
assert.equal(JSON.stringify(review),before);assert.equal(registry.grants.length,0);
const summary=admissionSummary(a);assert.equal(summary.quality_pass,7);assert.equal(summary.quality_fail,0);assert.equal(summary.quality_pending,22);assert.equal(summary.time_valid,0);assert.equal(summary.receipt_pit_valid,29);assert.equal(summary.licensing_approved,0);assert.equal(summary.owner_approval_ready,0);
for(const c of a.cards){assert.equal(c.checks.find(x=>x.key==='METHODOLOGY').state,'PASS');assert.equal(c.matrix.find(x=>x.key==='DATA_INTEGRATION').state,'PASS');await assert.rejects(()=>appendOwnerDecision(review.cards.find(r=>r.review_hash===c.review_hash),c,[],{action:'APPROVE',reason:'ISOLATED negative control, not Sony approval',key:'blocker-control-'+c.symbol},{verified:true,ref:'NOT_SONY_SYNTHETIC_CONTROL'},at),/PREREQUISITES/);}
for(const tier of ['free','premium','owner','anonymous'])assert.deepEqual(await approvedProjection(review,a,[],{verified:tier!=='anonymous',tier},at,registry),[]);
const rows=a.cards.map(c=>({...publicationMatrix(c),research_status:review.cards.find(r=>r.review_hash===c.review_hash).research_state,source_use_review:review.cards.find(r=>r.review_hash===c.review_hash).rights}));
if(e.MA_VNEXT_ADMISSION_DIR){const dir=privateDirectory(e.MA_VNEXT_ADMISSION_DIR);immutable(resolve(dir,'blocker-admission-'+a.snapshot_hash+'.json'),a);immutable(resolve(dir,'blocker-matrix-'+a.snapshot_hash+'.json'),{reviewed_at:at,review_hash:review.snapshot_hash,rows});}
console.log(JSON.stringify({source:'REAL_RETAINED_29',summary,rows:rows.map(r=>({symbol:r.symbol,research:r.research_status,quality:r.quality_status,time:r.time_status,license:r.licensing_status,owner:r.owner_approval_readiness,publication:r.publication_eligibility})),review_hash:review.snapshot_hash,admission_hash:a.snapshot_hash,official_bodies_read:13,original_event_indices:211,forward:0,outcome:0,production_operations:0}));
