import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ENTRY_BASE,ENTRY_MANIFEST,ENTRY_PATHS,entryPrior,entryTransition,entryChangedPaths} from './helpers/entryOpportunityIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Entry research exact candidate inventory, immutable predecessor and unchanged business producers',()=>{
 entryTransition();assert.deepEqual(entryChangedPaths(),[...ENTRY_PATHS,ENTRY_MANIFEST].sort());
 const paths=execFileSync('git',['ls-tree','-r','--name-only',ENTRY_BASE,'--','supabase','src','research','.github'],{encoding:'utf8'}).trim().split('\n');
 for(const p of paths){if(p==='src/pages/admin/analysis/page.tsx')continue;assert.deepEqual(read(p),entryPrior(p),'protected existing path '+p);}
 const page=read('src/pages/admin/analysis/page.tsx').toString().replace("import EntryOpportunity from './EntryOpportunity';\n",'').replace('    <EntryOpportunity />\n','');
 assert.equal(page,entryPrior('src/pages/admin/analysis/page.tsx').toString(),'only independent Owner component mount');
});
test('Entry seal rejects unknown files, drift, changed lineage and unauthorized Production scope',()=>{
 for(const path of ENTRY_PATHS)assert.throws(()=>entryTransition(p=>p===path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/unreviewed candidate drift/);
 for(const mutate of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.functions.push('line-daily-push'),m=>m.migrations.push('extra'),
  m=>m.production_release_authorized=true,m=>m.v2_change=true,m=>m.member_access=true,m=>m.base='HEAD']){
  const m=JSON.parse(read(ENTRY_MANIFEST));mutate(m);assert.throws(()=>entryTransition(p=>p===ENTRY_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
});
