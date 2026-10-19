import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyOwnerStatusCopy,ownerStatusCopyWebsiteOperations,OWNER_STATUS_COPY_BASE,OWNER_STATUS_COPY_MANIFEST,OWNER_STATUS_COPY_SOURCE,
 ownerStatusCopyHistoricalRead,ownerStatusCopyHistoricalReader,ownerStatusCopyHistoricalFsRead} from './helpers/ownerStatusCopyAdmission.mjs';
import {verifyFrontendTypeClosure,verifyHistoricalFrontendTypeClosureForOwnerCopy} from './helpers/frontendTypeClosureAdmission.mjs';
import {integrationInventory,integrationPhysicalRead,integrationPhysicalMode} from './helpers/integrationAdmission.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const prior=path=>execFileSync('git',['--no-replace-objects','show',OWNER_STATUS_COPY_BASE+':'+path]);

test('current successor admits one copy-only website operation and preserves all 23 other B24 physical sources',()=>{
 const m=verifyOwnerStatusCopy(),ops=ownerStatusCopyWebsiteOperations();assert.equal(m.production_authorized,false);
 assert.equal(ops.length,1);assert.equal(ops[0].path,OWNER_STATUS_COPY_SOURCE);assert.equal(ops[0].operation,'MODIFY');
 assert.equal(ops[0].classification,'CLIENT_UI_STATUS_COPY_ONLY');assert.equal(ops[0].source_bytes,readFileSync(OWNER_STATUS_COPY_SOURCE).length);
 const old=JSON.parse(readFileSync(m.predecessor_website.path));
 assert.deepEqual(readFileSync(m.predecessor_website.path),prior(m.predecessor_website.path));
 assert.equal(old.website.operations.length,24);
 for(const row of old.website.operations)if(row.path!==OWNER_STATUS_COPY_SOURCE)assert.equal(hash(readFileSync(row.path)),row.target_sha256,row.path);
 assert.notEqual(hash(readFileSync(OWNER_STATUS_COPY_SOURCE)),old.files.find(row=>row.path===OWNER_STATUS_COPY_SOURCE).after_sha256);
 // The old physical guard remains strict. This is not retroactive B24 approval.
 assert.throws(()=>verifyFrontendTypeClosure(),/FRONTEND_TYPE_SOURCE:src\/pages\/admin\/analysis\/OwnerCockpit\.tsx/);
 const historical=verifyHistoricalFrontendTypeClosureForOwnerCopy();assert.deepEqual(historical,old);
 ops[0].target_sha256='0'.repeat(64);assert.notEqual(ownerStatusCopyWebsiteOperations()[0].target_sha256,ops[0].target_sha256);
});
test('current successor rejects injected source, mode, inventory, receipt and authority drift',()=>{
 const paths=integrationInventory(),good=readFileSync(OWNER_STATUS_COPY_SOURCE);
 assert.throws(()=>verifyOwnerStatusCopy(path=>path===OWNER_STATUS_COPY_SOURCE?Buffer.concat([good,Buffer.from('INJECTED')]):integrationPhysicalRead(path),paths));
 assert.throws(()=>verifyOwnerStatusCopy(integrationPhysicalRead,paths,path=>path===OWNER_STATUS_COPY_SOURCE?'100755':integrationPhysicalMode(path)),/MODE/);
 assert.throws(()=>verifyOwnerStatusCopy(integrationPhysicalRead,[...paths,'src/unreviewed.ts']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyOwnerStatusCopy(integrationPhysicalRead,paths.filter(path=>path!==OWNER_STATUS_COPY_SOURCE)),/UNKNOWN_PATH/);
 const original=JSON.parse(readFileSync(OWNER_STATUS_COPY_MANIFEST));
 for(const mutate of [m=>m.base='HEAD',m=>m.files.pop(),m=>m.website.operations.push({...m.website.operations[0]}),
  ...['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'].map(flag=>m=>m[flag]=true)]){
  const forged=structuredClone(original);mutate(forged);
  assert.throws(()=>verifyOwnerStatusCopy(path=>path===OWNER_STATUS_COPY_MANIFEST?Buffer.from(JSON.stringify(forged)):integrationPhysicalRead(path),paths));
 }
});
test('historical adapter maps only exact current Owner bytes and preserves unknown paths, text drift and exceptions',()=>{
 const live=readFileSync(OWNER_STATUS_COPY_SOURCE),before=prior(OWNER_STATUS_COPY_SOURCE);
 assert.deepEqual(ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,live),before);
 assert.equal(ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,live.toString()),before.toString());
 assert.deepEqual(ownerStatusCopyHistoricalFsRead(new URL('../'+OWNER_STATUS_COPY_SOURCE,import.meta.url)),before);
 const copy=ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,live);copy.fill(0);
 assert.deepEqual(ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,live),before);
 for(const value of [Buffer.concat([live,Buffer.from('DRIFT')]),live.toString()+'DRIFT',live.toString()+'\uD800']){
  assert.equal(ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,value),value);
  assert.equal(ownerStatusCopyHistoricalReader(()=>value)(OWNER_STATUS_COPY_SOURCE),value);
 }
 const sentinel=Buffer.from('UNKNOWN');for(const path of ['src/lib/publicMarketReadModel.ts','../'+OWNER_STATUS_COPY_SOURCE,'HEAD:'+OWNER_STATUS_COPY_SOURCE])assert.equal(ownerStatusCopyHistoricalRead(path,sentinel),sentinel);
 const failure=Error('SOURCE_THROW');assert.throws(()=>ownerStatusCopyHistoricalReader(()=>{throw failure;})(OWNER_STATUS_COPY_SOURCE),error=>error===failure);
 const poison=Buffer.from(live);poison.valueOf=()=>Buffer.from('DRIFT');assert.deepEqual(ownerStatusCopyHistoricalRead(OWNER_STATUS_COPY_SOURCE,poison),before);
});
test('historical B24 entry still rejects current injected drift rather than translating it away',()=>{
 const paths=integrationInventory(),good=readFileSync(OWNER_STATUS_COPY_SOURCE),bad=Buffer.concat([good,Buffer.from('NEGATIVE')]);
 assert.throws(()=>verifyHistoricalFrontendTypeClosureForOwnerCopy(path=>path===OWNER_STATUS_COPY_SOURCE?bad:integrationPhysicalRead(path),paths),/SOURCE_DRIFT/);
 assert.throws(()=>verifyHistoricalFrontendTypeClosureForOwnerCopy(integrationPhysicalRead,paths,path=>path===OWNER_STATUS_COPY_SOURCE?'100755':integrationPhysicalMode(path)),/MODE/);
 const failure=Error('HISTORICAL_SOURCE_THROW');assert.throws(()=>verifyHistoricalFrontendTypeClosureForOwnerCopy(path=>{if(path===OWNER_STATUS_COPY_SOURCE)throw failure;return integrationPhysicalRead(path);}),error=>error===failure);
});
