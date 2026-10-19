// Source integrity for an offline Owner study; never source admission,
// Production research execution, member publication or recommendation proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {verifyIntegrationCandidate,INTEGRATION_MANIFEST,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
const BASE='9de380f6d8473e920e19d955d0782950ed4cae2f';
const MANIFEST='docs/operations/evidence/retained-quarter-family-20261019.json';
const FLAGS=['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'];
const prior=path=>execFileSync('git',['--no-replace-objects','show',BASE+':'+path],{maxBuffer:8*1024*1024});
const FILES=[
 {path:'scripts/vnext/research-funnel.mjs',mode:'100644',before_sha256:'dbe0d0b16cc7e6f746b939b441cf88040daa521219da0cace0793e8d26e86ccc',after_sha256:'9e34803f12f8d02c3dd8858a92985818fa16af348423a067af020049f8ca23ba'},
 {path:'research/retained-quarter-financials.ts',mode:'100644',before_sha256:null,after_sha256:'3577cd5ac6e4b7300b2dde022d453fa663134b5e513503df6616fca87fe6d9ba'},
 {path:'tests/vnextRetainedQuarterFinancials.test.mjs',mode:'100644',before_sha256:null,after_sha256:'14b78b0e766b5d2a50ae1c3b13595822a671ee4496ca7d2525442dcfce017bec'},
];
function candidate(){
 verifyIntegrationCandidate();const m=JSON.parse(readFileSync(MANIFEST));
 assert.deepEqual(Object.keys(m).sort(),['schema','base','files','protected_sources','prior_rules','predecessor','scope','worker',...FLAGS].sort());
 assert.equal(m.schema,'RETAINED_QUARTER_FINANCIAL_FAMILY_OFFLINE_ADMISSION_V1');assert.equal(m.base,BASE);assert.deepEqual(m.files,FILES);
 for(const flag of FLAGS)assert.equal(m[flag],false);
 assert.deepEqual(m.scope,{mode:'OFFLINE_OWNER_RETAINED_SNAPSHOT_REVIEW',financial_families:['EPS','MARGIN','CAPEX'],quarters:4,numeric_facts:12,source_originals:4,
  private_fact_pack_in_git:false,new_source_acquisition:false,production_import:false,shared_evaluator_change:false,methodology_promotion:false,new_forward_or_outcome:false,
  remaining_documented_reviews:['DEMAND','MOAT','VALUATION'],original_long_contract_supply_chain_still_required:true});
 assert.deepEqual(m.worker,{new_deployment_payload:false,preserved_C_candidate_payload_sha256:'c86202f3123aeddefc6ca39efdca0b25cfcadee955527cff7c1a92a7dee6e7d9',
  preserved_C_recovery_payload_sha256:'0d88f57588d02cb63ba467a3803b44815110a67ad5712e40903c241806bd02d2',runtime_files:44,payload_files:74});
 for(const row of FILES){
  if(row.before_sha256!==null)assert.equal(integrationHash(prior(row.path)),row.before_sha256);
  assert.equal(integrationHash(readFileSync(row.path)),row.after_sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 for(const row of [...m.protected_sources,...m.prior_rules]){
  assert.deepEqual(readFileSync(row.path),prior(row.path),'unchanged current source or historical assertion:'+row.path);
  assert.equal(integrationHash(readFileSync(row.path)),row.sha256);assert.equal(integrationPhysicalMode(row.path),row.mode);
 }
 assert.deepEqual(readFileSync(m.predecessor.path),prior(m.predecessor.path));assert.equal(integrationHash(readFileSync(m.predecessor.path)),m.predecessor.sha256);
 return m;
}
test('the exact offline three-file adapter preserves original contracts, deployed dependencies and private-data boundaries',()=>{
 const m=candidate();assert.equal(m.files.length,3);assert.equal(m.protected_sources.length,12);assert.equal(m.prior_rules.length,5);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261019-retained-quarter-family.json');
 const imports=spawnSync('git',['grep','--name-only','retained-quarter-financials','--','src','supabase/functions'],{encoding:'utf8'});
 assert.equal(imports.status,1);assert.equal(imports.stdout,'','no production source imports this offline adapter');
});
test('current outer verification only appends a fixed C predecessor and this exact offline source inventory',()=>{
 const path='tests/helpers/integrationAdmission.mjs';let expected=prior(path).toString();
 expected=expected.replace("export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json';",
  "export const INTEGRATION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-retained-quarter-family.json';");
 const marker="const FROZEN_SOURCE_ACQUISITION_MANIFEST='docs/operations/evidence/core-member-integration-20261019-source-acquisition.json';";
 expected=expected.replace(marker,marker+"\nconst PRIOR_C_WORKER_RPC_DIAGNOSTICS='9de380f6d8473e920e19d955d0782950ed4cae2f';\nconst FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST='docs/operations/evidence/core-member-integration-20261019-c-worker-rpc-diagnostics.json';");
 expected=expected.replace('export const INTEGRATION_DELTAS=Object.freeze([',"export const INTEGRATION_DELTAS=Object.freeze([\n FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST,\n 'docs/operations/evidence/retained-quarter-family-20261019.json',\n 'docs/operations/retained-quarter-family-20261019.md',\n 'tests/retainedQuarterFamilyAdmission.test.mjs',\n 'scripts/vnext/research-funnel.mjs',\n 'research/retained-quarter-financials.ts',\n 'tests/vnextRetainedQuarterFinancials.test.mjs',");
 const check=" assert.deepEqual(Buffer.from(read(FROZEN_SOURCE_ACQUISITION_MANIFEST)),frozenReceipt(PRIOR_SOURCE_ACQUISITION,FROZEN_SOURCE_ACQUISITION_MANIFEST),'INTEGRATION_SOURCE_ACQUISITION_RECEIPT_DRIFT');";
 expected=expected.replace(check,check+"\n assert.deepEqual(Buffer.from(read(FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST)),frozenReceipt(PRIOR_C_WORKER_RPC_DIAGNOSTICS,FROZEN_C_WORKER_RPC_DIAGNOSTICS_MANIFEST),'INTEGRATION_C_WORKER_RPC_DIAGNOSTICS_RECEIPT_DRIFT');");
 assert.equal(readFileSync(path,'utf8'),expected,'all prior source, physical, inventory, mode and flag refusals remain exact');
});
test('every current source drift, unknown path, mode, deletion and unlisted baseline alteration is refused',()=>{
 const seal=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const row of seal.files){
  const bad=Buffer.concat([integrationPhysicalRead(row.path),Buffer.from('CURRENT_SOURCE_DRIFT')]);
  assert.throws(()=>verifyIntegrationCandidate(path=>path===row.path?bad:integrationPhysicalRead(path),paths),/DRIFT/);
 }
 for(const row of FILES){
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths,p=>p===row.path?'100755':integrationPhysicalMode(p)),/MODE/);
  assert.throws(()=>verifyIntegrationCandidate(path=>{if(path===row.path)throw Error('SOURCE_REMOVED');return integrationPhysicalRead(path);},paths),/SOURCE_REMOVED/);
  assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,paths.filter(p=>p!==row.path)),/UNKNOWN_PATH/);
 }
 for(const path of ['research/unreviewed.ts','tests/private-financial-pack.json','docs/unreviewed.json'])assert.throws(()=>verifyIntegrationCandidate(integrationPhysicalRead,[...paths,path]),/UNKNOWN_PATH/);
 const path='package-lock.json',bad=Buffer.concat([integrationPhysicalRead(path),Buffer.from('BASELINE_DRIFT')]);
 assert.throws(()=>verifyIntegrationCandidate(p=>p===path?bad:integrationPhysicalRead(p),paths),/BASELINE_DRIFT/);
});
test('neither the new receipt nor predecessor bytes can turn this offline repair into a release or source approval',()=>{
 const original=verifyIntegrationCandidate(),paths=integrationInventory();
 for(const mutate of [m=>m.parents.member='HEAD',m=>m.files.pop(),m=>m.files.push({...m.files[0],path:'PRIVATE_UNREVIEWED'}),...FLAGS.map(flag=>m=>m[flag]=true)]){
  const forged=structuredClone(original);mutate(forged);assert.throws(()=>verifyIntegrationCandidate(path=>path===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
 const previous=candidate().predecessor.path;
 assert.throws(()=>verifyIntegrationCandidate(path=>path===previous?Buffer.concat([integrationPhysicalRead(path),Buffer.from(' ') ]):integrationPhysicalRead(path),paths),/C_WORKER_RPC_DIAGNOSTICS_RECEIPT_DRIFT/);
});
test('original C seven-proof source view is fixed 9de while adapter, actual C SDK, Deno and builds remain current',()=>{
 const text=readFileSync('.github/workflows/core-member-integration.yml','utf8'),steps=text.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const admission=steps.find(block=>block.includes('verifyIntegrationCandidate();'));assert(admission);assert(admission.includes('tests/retainedQuarterFamilyAdmission.test.mjs'));assert.doesNotMatch(admission,/working-directory:/);
 const checkout=steps.find(block=>block.includes('path: build/retained-quarter-family-historical-base'));assert(checkout);assert.match(checkout,/ref: 9de380f6d8473e920e19d955d0782950ed4cae2f/);assert.match(checkout,/persist-credentials: false/);
 assert(steps.indexOf(admission)<steps.indexOf(checkout));
 const historical=steps.find(block=>block.includes('run: node --experimental-strip-types --test tests/cWorkerRpcDiagnosticsAdmission.test.mjs'));assert(historical);assert.match(historical,/working-directory: build\/retained-quarter-family-historical-base/);
 for(const file of ['tests/vnextRetainedQuarterFinancials.test.mjs','tests/cWorkerRpcFailureDiagnostics.integration.mjs']){
  const block=steps.find(block=>block.includes('run: node')&&block.includes(file));assert(block);assert.doesNotMatch(block,/working-directory:/);
 }
 const deno=steps.find(block=>block.includes('deno check --no-lock research/retained-quarter-financials.ts supabase/functions/vnext-daily-research-v1/index.ts'));assert(deno);assert.doesNotMatch(deno,/working-directory:/);
 for(const command of ['npm run type-check','npm run lint','npm run build']){const block=steps.find(block=>block.includes('run: '+command));assert(block);assert.doesNotMatch(block,/working-directory:/);}
 const quarterPath='.github/workflows/owner-quarter-live-candidate.yml',quarter=readFileSync(quarterPath,'utf8');
 const expectedQuarter=prior(quarterPath).toString().replace('node --experimental-strip-types --test tests/cWorkerRpcDiagnosticsAdmission.test.mjs',
  'node --experimental-strip-types --test tests/retainedQuarterFamilyAdmission.test.mjs');
 assert.equal(quarter,expectedQuarter,'the current quarter precheck changes only its exact admission selector; historical artifact packaging stays intact');
 const quarterSteps=quarter.split(/(?=^      - )/m).filter(block=>/^      - /.test(block));
 const quarterAdmission=quarterSteps.find(block=>block.includes('verifyIntegrationCandidate();'));
 const quarterCheckout=quarterSteps.find(block=>block.includes('path: build/priced-in-historical-base'));
 assert(quarterAdmission&&quarterCheckout);assert(quarterAdmission.includes('tests/retainedQuarterFamilyAdmission.test.mjs'));
 assert.doesNotMatch(quarterAdmission,/working-directory:/);assert(quarterSteps.indexOf(quarterAdmission)<quarterSteps.indexOf(quarterCheckout));
 for(const path of ['.github/workflows/vnext-candidate.yml','.github/workflows/recommendation-v2-shadow.yml','.github/workflows/c-worker-sdk-freshness-20261019.yml'])assert.deepEqual(readFileSync(path),prior(path),'no memory, deadline, broad test or freshness change:'+path);
});
