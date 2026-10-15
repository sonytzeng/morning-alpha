/** Private real snapshot audit. No provider request, synthetic publication or CI fixture. */
import assert from 'node:assert/strict';
import {auditResearchFunnel} from '../scripts/vnext/research-funnel.mjs';
import {auditFirstPublication} from '../scripts/vnext/first-publication-review.mjs';
import {verifyReviewBundle,reviewSummary,reviewedMemberProjection,nextReviewAction} from '../src/features/vnext/publicationReview.ts';
assert(!process.env.CI);globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const env=process.env,reviewedAt=env.MA_VNEXT_REVIEW_AT;
assert(reviewedAt,'EXPLICIT_REVIEW_TIME_REQUIRED');
const f=await auditResearchFunnel(env.MA_VNEXT_FOUNDATION_DIR,env.MA_VNEXT_DISPLAY_NAMES,env.MA_VNEXT_STOCK_DIR,env.MA_VNEXT_CONTEXT_DIR);
assert.equal(f.snapshot_hash,'805cfbb8ae94f0bda75a43535ceb57d314b3f1aa7fed4af12cedc0f82bcf93c3');
const b=await auditFirstPublication(f,env.MA_VNEXT_STOCK_DIR,env.MA_VNEXT_CONTEXT_DIR,reviewedAt);
assert(await verifyReviewBundle(b,f.snapshot_hash));assert.equal(b.cards.length,29);
assert.equal(new Set(b.cards.map(c=>c.reason)).size,29);
assert.deepEqual(b.cards.map(c=>c.symbol).sort(),['1504','1513','1605','2049','2308','2344','2357','2379','2383','2408','2421','2609','2610','2618','2884','2886','2892','3034','3037','3189','3231','3443','3653','3661','3711','4566','6213','6274','8046']);
for(const c of b.cards){assert.equal(c.research_state,'QUALIFIED');assert.equal(c.through,'2026-10-08');assert.equal(c.cutoff,'2026-10-11T02:03:23.964Z');assert.equal(c.quality.status,'BLOCKED');assert.deepEqual(c.quality.checks.filter(x=>!x.pass).map(x=>x.key),['TIME','EVENT_CONTEXT']);assert.equal(c.publication.eligible,false);assert(c.evidence.every(e=>Date.parse(e.available_at)<=Date.parse(c.cutoff)));assert(c.financial.some(x=>x.text.includes('累計EPS')));assert(c.events.length);assert(c.confirmation.length&&c.invalidation.length);assert(c.rights.every(r=>r.uses.some(u=>!u.allowed)));}
const j=b.cards.find(c=>c.symbol==='3653');assert(j.supporting.some(c=>c.text.includes('1.53')));assert(j.supporting.find(c=>c.text.includes('6.31')).evidence_ids.includes('market-2026-10-08'));assert(j.opposing.some(c=>c.text.includes('52,932')));assert(j.events.some(c=>c.text.includes('2026-09-29')));
assert(b.cards.find(c=>c.symbol==='2379').opposing.some(c=>c.text.includes('稅後淨利低於')));
assert(b.cards.find(c=>c.symbol==='3231').opposing.some(c=>c.text.includes('17.23')));
assert(b.cards.find(c=>c.symbol==='2884').financial.some(c=>c.text.includes('欄位不齊全')));
for(const tier of ['free','premium','owner','anonymous'])assert.deepEqual(await reviewedMemberProjection(b,f.rows,row=>({now:reviewedAt,audience:tier,server_entitlement_verified:tier!=='anonymous',input_hash:row.input_hash,approved_hash:null,approved_review_hash:null,approved_at:null,quality_reviewed:false,methodology_approved:false,use:'OWN_ANALYSIS',grants:[]})),[]);
const update=await nextReviewAction(j,{now:reviewedAt,coreBusy:true,existingKeys:[],newEvidenceHash:f.snapshot_hash,condition:'UNKNOWN',attempt:0});assert.equal(update.state,'DEFERRED_CORE_PRIORITY');assert.equal(update.enabled,false);assert.equal(update.forward_sample,0);
console.log(JSON.stringify({source:'REAL_RETAINED_OFFLINE',summary:reviewSummary(b.cards),review_hash:b.snapshot_hash,funnel_hash:f.snapshot_hash,original_research_unchanged:true,network_requests:0,production_operations:0,forward:0,outcome:0}));
