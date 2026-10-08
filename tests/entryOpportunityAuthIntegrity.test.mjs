import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ENTRY_AUTH_BASE,ENTRY_AUTH_PATHS,ENTRY_AUTH_MANIFEST,entryAuthPrior,entryAuthTransition,entryAuthChangedPaths} from './helpers/entryWorkerAuthIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Entry Auth exact file/hash/lineage manifest preserves every other product file',()=>{
 entryAuthTransition();assert.deepEqual(entryAuthChangedPaths(),[...ENTRY_AUTH_PATHS,ENTRY_AUTH_MANIFEST].sort());
 for(const p of execFileSync('git',['ls-tree','-r','--name-only',ENTRY_AUTH_BASE,'--','supabase','src','research','.github'],{encoding:'utf8'}).trim().split('\n')){
  if(ENTRY_AUTH_PATHS.includes(p))continue;assert.deepEqual(read(p),entryAuthPrior(p),'protected '+p);
 }
});
test('Entry Auth seal rejects changed bytes, extra secrets, functions, migrations or scope',()=>{
 for(const p of ENTRY_AUTH_PATHS)assert.throws(()=>entryAuthTransition(q=>q===p?Buffer.concat([read(q),Buffer.from('DRIFT')]):read(q)),/unreviewed candidate drift/);
 for(const mutate of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.new_secret_names.push('EXTRA'),m=>m.functions.push('line-daily-push'),m=>m.migrations.push('extra'),m=>m.gateway_change=true,m=>m.core_auth_change=true,m=>m.cron_change=true,m=>m.natural_forward_enabled=true]){
  const m=JSON.parse(read(ENTRY_AUTH_MANIFEST));mutate(m);assert.throws(()=>entryAuthTransition(p=>p===ENTRY_AUTH_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
});
