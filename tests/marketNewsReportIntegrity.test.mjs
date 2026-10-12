import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NEWS_REPORT_BASE,NEWS_REPORT_MANIFEST,NEWS_REPORT_PATHS,newsReportTransition,newsReportChangedPaths} from './helpers/marketNewsReportIntegrity.mjs';
import {academyV11Transition} from './helpers/academyV11Integrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('news retention candidate validates exact live scope before all previous immutable gates',()=>{
 const t=newsReportTransition();assert.equal(t.manifest.base,NEWS_REPORT_BASE);
 assert.deepEqual(newsReportChangedPaths(),[...NEWS_REPORT_PATHS,NEWS_REPORT_MANIFEST].sort());
 assert.deepEqual(t.manifest.functions,['fetch-global-market-news','daily-delivery-orchestrator']);
 assert.deepEqual(t.manifest.migrations,[]);academyV11Transition();
});
test('candidate bytes, additional files, deployment escalation and old manifests cannot be hidden',()=>{
 for(const path of NEWS_REPORT_PATHS)assert.throws(()=>newsReportTransition(p=>p===path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)));
 for(const change of [m=>m.production_authorized=true,m=>m.strategy_change=true,m=>m.functions.push('generate-daily-report-v7'),
  m=>m.migrations.push('unauthorized.sql'),m=>m.files.pop(),m=>m.base='HEAD']){
  const m=JSON.parse(read(NEWS_REPORT_MANIFEST));change(m);
  assert.throws(()=>newsReportTransition(p=>p===NEWS_REPORT_MANIFEST?Buffer.from(JSON.stringify(m)):read(p)));
 }
 assert.throws(()=>newsReportTransition(read,[...newsReportChangedPaths(),'unknown.ts']));
 assert.throws(()=>newsReportTransition(p=>p==='docs/academy/v11/transition.json'?Buffer.from('{}'):read(p)),/historical News Report baseline/);
});
