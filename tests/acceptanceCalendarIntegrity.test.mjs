import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarTransition,calendarPrior,calendarChangedPaths,CALENDAR_MANIFEST,CALENDAR_PATHS,CALENDAR_MIGRATION} from './helpers/acceptanceCalendarIntegrity.mjs';
const raw=p=>readFileSync(new URL('../'+p,import.meta.url));
test('CI budget changes retain every original step, assertion and permission',()=>{
 const normalize=bytes=>bytes.toString().split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n').replace(/timeout-minutes: \d+/g,'timeout-minutes: BOUNDED');
 for(const [path,budget] of [['.github/workflows/analysis-intelligence.yml',40],['.github/workflows/validate-release.yml',60]]){
  assert.equal(normalize(raw(path)),normalize(calendarPrior(path)));
  assert.match(raw(path).toString(),new RegExp('timeout-minutes: '+budget+'\\n'));
 }
});
test('Issue 238 exact acceptance and display patch preserves every other baseline byte',()=>{
 const t=calendarTransition();
 assert.deepEqual(t.manifest.functions,[]);
 assert.deepEqual(t.manifest.migrations,[CALENDAR_MIGRATION]);
 assert.equal(t.manifest.production_authorized,false);
 for(const path of CALENDAR_PATHS){
  const before=calendarPrior(path);
  if(before===null)assert.throws(()=>t.predecessorRead(path),{code:'ENOENT'});
  else assert.deepEqual(t.predecessorRead(path),before);
 }
});
test('scope, permission escalation, omission, and unsealed SQL all fail',()=>{
 const manifest=JSON.parse(raw(CALENDAR_MANIFEST));
 for(const patch of [{production_authorized:true},{functions:['unapproved']},{migrations:[]},{cron_change:true},{secret_change:true}]){
  assert.throws(()=>calendarTransition(p=>p===CALENDAR_MANIFEST?Buffer.from(JSON.stringify({...manifest,...patch})):raw(p)));
 }
 for(const paths of [[...calendarChangedPaths(),'unknown.sql'],calendarChangedPaths().slice(1)])assert.throws(()=>calendarTransition(raw,paths));
 for(const path of CALENDAR_PATHS)assert.throws(()=>calendarTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nUNREVIEWED')]):raw(p)));
 for(const path of ['supabase/functions/line-daily-push/index.ts','supabase/functions/generate-daily-report-v7/index.ts','supabase/functions/_shared/recommendation-stock-evidence.ts'])
  assert.throws(()=>calendarTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nDRIFT')]):raw(p)),/historical Calendar baseline/);
});
test('migration does not change session quality, Auth, RLS, business rows or cron',()=>{
 const sql=raw(CALENDAR_MIGRATION).toString();
 assert.doesNotMatch(sql,/\b(?:insert into|update\s+public|delete from|drop|grant|revoke|alter policy|cron\.schedule)\b/i);
 assert.match(sql,/9d0c66a17d93fa3d6319fa309ae4ca7b/);
 assert.match(sql,/aaca0aeed381e54a1333bc2385cbf04e/);
 assert.match(sql,/ACCEPTANCE_CALENDAR_COVERAGE_UNAVAILABLE/);
 assert.match(sql,/public\.market_calendar_session_v1\('TW',new\.business_date\)/);
 assert.doesNotMatch(sql,/execute.*(?:market_checkpoint_batch_integrity|commit_market_checkpoint)/);
});
