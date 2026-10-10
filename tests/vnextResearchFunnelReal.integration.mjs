import assert from 'node:assert/strict';
import {auditResearchFunnel} from '../scripts/vnext/research-funnel.mjs';
import {verifyFunnel,projectQualifiedResearch} from '../src/features/vnext/researchFunnel.ts';
assert(!process.env.CI,'PRIVATE_REAL_AUDIT_NOT_CI');globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
const r=await auditResearchFunnel(process.env.MA_VNEXT_FOUNDATION_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
assert(await verifyFunnel(r));assert.equal(r.history_hash,'7b21dbe4b3cfd50371cd791d3988d24c1e137db1d397e50c41dbe0cc2274d4aa');
assert.equal(r.sources_hash,'ad8e4fb00b79a5d749194172c0c5c875e1a37902cb8ba374b4397a4e6af0fe9a');
assert.deepEqual(Object.values(r.counts).map(c=>[c.scanned,c.evaluated,c.qualified,c.rejected,c.insufficient,c.publication_checked,c.publication_eligible]),[[72,72,1,71,0,1,0],[72,0,0,0,72,0,0],[72,0,0,0,72,0,0]]);
assert.deepEqual(r.rows.filter(x=>x.research.state==='QUALIFIED').map(x=>x.research.symbol),['3653']);
for(const row of r.rows){assert.equal(row.research.v1.state,'INSUFFICIENT');assert.equal(row.publication.eligible,false);assert.equal(row.publication.checked,row.research.state==='QUALIFIED');}
assert.deepEqual(r.rows.find(x=>x.research.state==='QUALIFIED').publication.categories,['APPROVAL','LICENSING','QUALITY','TIME']);
const p=row=>({now:r.cutoff,audience:'free',server_entitlement_verified:true,input_hash:row.input_hash,approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]});
assert.deepEqual(await projectQualifiedResearch(r.rows,p),[]);
const changed=structuredClone(r);changed.rows[0].research.state='QUALIFIED';assert.equal(await verifyFunnel(changed),false);
console.log(JSON.stringify({mode:'REAL_OFFLINE_NEW_HYPOTHESIS_NOT_PROMOTED',counts:r.counts,forward:0,outcome:0,source_hashes:'UNCHANGED',network_requests:0,production_operations:0}));
