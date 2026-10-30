import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySourceUnionPinnedProof,reuseSourceUnionPinnedProof,verifyIntegrationCandidate} from './helpers/integrationAdmission.mjs';
test('immutable Owner publication proofs execute at their exact original tree after full current-tree admission',()=>{
 verifyIntegrationCandidate();
 assert.throws(()=>reuseSourceUnionPinnedProof('owner_copy'),/REQUIRES_ACTUAL_REPLAY/);
 const result=verifySourceUnionPinnedProof('owner_copy');
 assert.equal(result.revision,'ff88a4ed7ce10116a6fad84110770953941fcd08');
 assert.equal(result.tests.length,5);assert(result.tests_run>0);assert.equal(result.tests_run,result.tests_passed);
 assert.equal(result.cleanup,'VERIFIED_REMOVED');verifyIntegrationCandidate();
 console.log(JSON.stringify({historical_owner_proof:result,current_runtime_proof:'Separate current lifecycle, contract, database and source-union checks'}));
});
