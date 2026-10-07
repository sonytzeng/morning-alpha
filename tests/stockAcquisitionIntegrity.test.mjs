import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stockAcquisitionTransition,STOCK_ACQUISITION_BASE,STOCK_ACQUISITION_PATHS,STOCK_ACQUISITION_MANIFEST} from './helpers/stockAcquisitionIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Stock Acquisition exact successor scope, hashes and immutable PR199 lineage',()=>{
 const {manifest}=stockAcquisitionTransition();
 const changed=execFileSync('git',['diff','--name-only',STOCK_ACQUISITION_BASE],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 assert.deepEqual([...new Set([...changed,...untracked])].sort(),[...STOCK_ACQUISITION_PATHS,STOCK_ACQUISITION_MANIFEST].sort());
 for(const row of manifest.files)assert.throws(()=>stockAcquisitionTransition(p=>p===row.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 const bad=structuredClone(manifest);bad.files.push({...manifest.files[0],path:'supabase/functions/unapproved/index.ts'});
 assert.throws(()=>stockAcquisitionTransition(p=>p===STOCK_ACQUISITION_MANIFEST?Buffer.from(JSON.stringify(bad)):read(p)),/only the named/);
 assert.deepEqual(manifest.migrations,[]);
 assert.deepEqual(manifest.functions,['recommendation-stock-evidence-v1']);
 const historical='docs/10k-program/recommendation-phase-transition.json';
 assert.deepEqual(read(historical),execFileSync('git',['show',STOCK_ACQUISITION_BASE+':'+historical]));
});
