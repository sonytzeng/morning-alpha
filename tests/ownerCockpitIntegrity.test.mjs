import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {COCKPIT_BASE,COCKPIT_MANIFEST,COCKPIT_PATHS,cockpitTransition,cockpitChangedPaths,cockpitPrior} from './helpers/ownerCockpitIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Cockpit exact hashes and scope preserve every unrelated production byte',()=>{
 cockpitTransition();assert.deepEqual(cockpitChangedPaths(),[...COCKPIT_PATHS,COCKPIT_MANIFEST].sort());
 for(const p of execFileSync('git',['ls-tree','-r','--name-only',COCKPIT_BASE,'--','supabase','src','research','.github'],{encoding:'utf8'}).trim().split('\n'))if(!COCKPIT_PATHS.includes(p))assert.deepEqual(read(p),cockpitPrior(p),p);
});
test('Cockpit seal rejects altered bytes and unapproved production scope',()=>{
 for(const p of COCKPIT_PATHS)assert.throws(()=>cockpitTransition(q=>q===p?Buffer.concat([read(q),Buffer.from('DRIFT')]):read(q)),/unreviewed candidate drift/);
 for(const alter of [m=>m.functions.push('line-daily-push'),m=>m.migrations.push('extra'),m=>m.secret_change=true,m=>m.legacy_backfill=true,m=>m.files.pop(),m=>m.member_access=true]){
  const m=JSON.parse(read(COCKPIT_MANIFEST));alter(m);assert.throws(()=>cockpitTransition(p=>p===COCKPIT_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));}
});
