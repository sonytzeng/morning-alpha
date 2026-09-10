// Pure guard controls only. These synthetic structures are not business proof,
// not provider responses and never written into a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertPublicExportPrefixAdoption, PUBLIC_EXPORT_PREFIX as p, PUBLIC_EXPORT_CONTINUATION_TABLES as tables } from './helpers/coreConsolidationPublicExportContinuation.mjs';
const counts = [11,22,22,22,2,2,1,1,0,0,0,0,0,12,12,3,2,1,0,0,0,0,1,1,0,1,1];
function fixture() {
  const base = { scope:'ma-consolidation-v1-20260909183000',report_date:'2026-09-23',warmup_date:'2026-09-22',
    prior_result_sha256:'80b61c535cb1a293c810c386b75af60c71faecebee2a2794fadb0aedb554635a',prior_run_id:p.prior_run_id,
    tables:Object.fromEntries(tables.map((name,i)=>[name,Array.from({length:counts[i]},(_,n)=>({test_only:name+':'+n}))])),
    boundary:{success:true,scope:'ma-consolidation-v1-20260909183000',receipts:Array.from({length:29},(_,i)=>({provider:'synthetic-unit-provider',id:i}))} };
  base.tables.reports=[{id:p.report_id,report_date:'2026-09-23',ai_strategy_json:{revision_id:p.snapshot_id,canonical_member_revision_id:p.member_id}}];
  base.tables.decision_snapshots=[{id:p.snapshot_id,report_id:p.report_id,version:1,decision_mode:'market_only',generated_text:{unit_marker:'frozen'}}];
  base.tables.member_content_revisions=[{id:p.member_id,decision_snapshot_id:p.snapshot_id}];
  base.tables.pipeline_runs=[{id:p.publication_run_id,status:'SUCCEEDED'},{id:'unit-other',status:'SUCCEEDED'}];
  const priorResult={scope:base.scope,status:'FAIL',run_id:p.prior_run_id,full_persisted_chain_executed:false,
    records:[{stage:'durable-publication',report_id:p.report_id,revision_id:p.snapshot_id,member_revision_id:p.member_id,publication_run_id:p.publication_run_id},
      ...Array.from({length:21},()=>({stage:'unit-prefix-record'})),{stage:'handler:content-os-morning-alpha-source',http:503,response_body:{code:'BOOT_ERROR'}},{stage:'FIRST_FAILURE'}]};
  return{priorResult,baseline:base,actual:{...structuredClone(base),guest:{boot_id:'d9f73673-b3e3-4daf-8080-13d8dde5b2c0',observed_at:'2026-09-23T07:30:00+08:00'}}};
}
test('pure guard accepts only the exact synthetic shape, not an E2E status',()=>{const r=assertPublicExportPrefixAdoption(fixture());assert.equal(r.status,'EXACT_PERSISTED_PREFIX_VERIFIED');assert.equal(r.producer_requests_resent,false);assert.equal(r.publication_must_be_revalidated_by_actual_central_contract,true)});
const negatives={
  'prior result promoted':x=>x.priorResult.status='PASS',
  'prior run changed':x=>x.priorResult.run_id='other',
  'prior full chain falsely complete':x=>x.priorResult.full_persisted_chain_executed=true,
  'prior failure replaced':x=>x.priorResult.records.at(-1).stage='PASS',
  'export503 changed to409':x=>x.priorResult.records.at(-2).http=409,
  'export error changed':x=>x.priorResult.records.at(-2).response_body.code='OTHER',
  'prior prefix extra record':x=>x.priorResult.records.push({stage:'fake'}),
  'scope moved':x=>x.actual.scope='ma-consolidation-v1-20260909170000',
  'main date relabeled':x=>x.actual.report_date='2026-09-24',
  'warmup relabeled':x=>x.actual.warmup_date='2026-09-21',
  'prior digest drift':x=>x.actual.prior_result_sha256='0'.repeat(64),
  'missing table':x=>delete x.actual.tables.research_sessions,
  'unexpected table':x=>x.actual.tables.unreviewed=[],
  'report tuple drift':x=>x.actual.tables.reports[0].id='other',
  'snapshot pointer drift':x=>x.actual.tables.reports[0].ai_strategy_json.revision_id='other',
  'member pointer drift':x=>x.actual.tables.reports[0].ai_strategy_json.canonical_member_revision_id='other',
  'snapshot identity drift':x=>x.actual.tables.decision_snapshots[0].id='other',
  'snapshot version drift':x=>x.actual.tables.decision_snapshots[0].version=2,
  'snapshot source drift':x=>x.actual.tables.decision_snapshots[0].generated_text.unit_marker='foreign',
  'member identity drift':x=>x.actual.tables.member_content_revisions[0].id='other',
  'member snapshot binding drift':x=>x.actual.tables.member_content_revisions[0].decision_snapshot_id='other',
  'publication run drift':x=>x.actual.tables.pipeline_runs[0].id='other',
  'publication run failed':x=>x.actual.tables.pipeline_runs[0].status='FAILED',
  'provider receipt changed':x=>x.actual.boundary.receipts[0].id='other',
  'provider request repeated':x=>x.actual.boundary.receipts.push({provider:'openai'}),
  'LINE already sent':x=>x.actual.boundary.receipts[0].provider='line',
  'unexpected audit fixture field':x=>x.actual.boundary.fixture_sha256='invented',
  'unexpected audit source field':x=>x.actual.boundary.boundary_source_sha256='invented',
  'old shared VM':x=>x.actual.guest.boot_id='2879f43f-0819-4a08-88dc-195166474350',
  'before publication window':x=>x.actual.guest.observed_at='2026-09-23T06:59:59+08:00',
  'opening window expired':x=>x.actual.guest.observed_at='2026-09-23T08:45:00+08:00',
};
for(const [name,mutate]of Object.entries(negatives))test('reject '+name,()=>{assert.doesNotThrow(()=>assertPublicExportPrefixAdoption(fixture()));const x=fixture();mutate(x);assert.throws(()=>assertPublicExportPrefixAdoption(x))});
for(const table of tables)test('reject any full-row change or added pending row in '+table,()=>{const x=fixture();assert.doesNotThrow(()=>assertPublicExportPrefixAdoption(x));if(x.actual.tables[table].length)x.actual.tables[table][0].unexpected='drift';else x.actual.tables[table].push({unexpected:'already performed'});assert.throws(()=>assertPublicExportPrefixAdoption(x))});
test('actual export-through-Acceptance tail stays byte-identical to reviewed13 driver',()=>{const read=name=>readFileSync(new URL('./integration/'+name,import.meta.url),'utf8');const tail=s=>s.slice(s.indexOf('    const publication = await published();'),s.indexOf('\n  } catch (error)'));assert.equal(tail(read('coreConsolidationPublicExportContinuation.e2e.mjs')),tail(read('coreConsolidationPublicExportFullChain.e2e.mjs')))});
test('new driver never replays completed producer prefix',()=>{const s=readFileSync(new URL('./integration/coreConsolidationPublicExportContinuation.e2e.mjs',import.meta.url),'utf8');const prefix=s.slice(s.indexOf('  try {'),s.indexOf('    const publication = await published();'));assert.match(prefix,/assertPublicExportPrefixAdoption/);assert.match(prefix,/PUBLIC_EXPORT_CONTINUATION_TABLES/);assert.doesNotMatch(prefix,/call\('(?:fetch-market-data-v10|fetch-global-market-news|generate-daily-report-v7|generate-sector-rotation)'/)});
