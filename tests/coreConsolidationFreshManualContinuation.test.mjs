import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assertFreshManualInputAdoption, localFetchCorrelationHeaders } from './helpers/coreConsolidationFreshManualContinuation.mjs';
const capture=JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/fresh-manual-correlation-failure.json',import.meta.url)));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260917.json',import.meta.url)));
const input=()=>({...structuredClone(capture),actual:structuredClone(capture.baseline),fixture:structuredClone(fixture)});
test('actual fresh manual Fetch is only adopted as input and original runner FAIL is retained',()=>{
 assert.equal(capture.provenance.kind,'LOCAL_ACTUAL_HANDLER_CAPTURE'); assert.equal(capture.provenance.historical_capture,false);
 const proof=assertFreshManualInputAdoption(input());assert.equal(proof.status,'PRECONDITION_INPUT_ONLY');
 assert.equal(proof.prior_runner_result,'FAIL_RETAINED');assert.equal(proof.manual_fetch_resent,false);assert.equal(proof.publication_adopted,false);
});
for(const[name,mutate]of[
 ['scope',x=>x.config.scope='ma-consolidation-v1-20260909133500'],['main date',x=>x.config.report_date='2026-09-18'],
 ['prior PASS',x=>x.priorResult.status='PASS'],['full chain claim',x=>x.priorResult.full_persisted_chain_executed=true],
 ['different failure',x=>x.priorResult.records.at(-1).error='another failure'],['extra handler',x=>x.priorResult.records.push({stage:'handler:generate-daily-report-v7'})],
 ['HTTP failure',x=>x.priorResult.records[4].http=409],['business failure',x=>x.priorResult.records[4].business_success=false],
 ['wrong request correlation',x=>x.priorResult.records[3].request_body.correlation_id='wrong'],['wrong returned correlation',x=>x.priorResult.records[4].response_body.correlation_id='wrong'],
 ['unknown table',x=>delete x.actual.tables.market_quotes],['404 is not empty',x=>x.actual.tables.reports.http=404],
 ['boot identity',x=>x.actual.guest.boot_id='other'],['result hash',x=>x.actual.prior_result.sha256='0'.repeat(64)],
 ['config hash',x=>x.actual.config_sha256='0'.repeat(64)],['prior run',x=>x.actual.prior_result.run_id='other'],
 ['warmup date',x=>x.actual.warmup_date=x.config.report_date],['raw drift',x=>x.actual.tables.market_data.rows[0].value++],
 ['provider extra call',x=>x.actual.boundary.receipts.push(x.actual.boundary.receipts[0])],
])test('manual adoption rejects '+name,()=>{assert.doesNotThrow(()=>assertFreshManualInputAdoption(input()));const x=input();mutate(x);assert.throws(()=>assertFreshManualInputAdoption(x));});
for(const table of ['reports','decision_snapshots','line_delivery_outbox','line_subscribers','learning_runs','learning_predictions','prediction_outcomes','news_events','market_news','sector_rotation_scores','pipeline_runs','member_content_revisions','production_acceptance_results','runtime_http_dispatches','runtime_dead_letters','ma_ops_runs'])
 test('no business adoption from '+table,()=>{const x=input();x.actual.tables[table].rows.push({id:'unexpected'});x.baseline=structuredClone(x.actual);assert.throws(()=>assertFreshManualInputAdoption(x));});
for(const[name,mutate]of[
 ['canonical correlation',x=>x.actual.tables.market_quotes.rows[0].raw_payload.correlation_id='wrong'],
 ['alias correlation',x=>x.actual.tables.market_data_snapshots.rows[0].raw.correlation_id='wrong'],
 ['canonical provider',x=>x.actual.tables.market_quotes.rows[0].provider='wrong'],
 ['alias source',x=>x.actual.tables.market_data_snapshots.rows[0].source='wrong'],
 ['alias checkpoint',x=>x.actual.tables.market_data_snapshots.rows[0].raw.immutable_checkpoint='1430'],
 ['canonical version',x=>x.actual.tables.market_quotes.rows[0].raw_payload.immutable_snapshot_version++],
 ['alias date',x=>x.actual.tables.market_data_snapshots.rows[0].trading_date=x.config.report_date],
 ['immutable source',x=>x.actual.tables.market_checkpoint_snapshots.rows[0].source='unknown'],
 ['immutable source symbol',x=>x.actual.tables.market_checkpoint_snapshots.rows[0].raw.source_symbol='wrong'],
 ['inverse proxy',x=>x.actual.tables.market_checkpoint_snapshots.rows.find(r=>r.symbol==='US10Y').raw.source_raw.direction_multiplier=1],
 ['raw value',x=>x.actual.tables.market_data.rows[0].value++],
 ['lifecycle completion',x=>x.actual.tables.trading_day_state.rows[0].current_state='DAY_COMPLETED'],
 ['natural checkpoint promotion',x=>x.actual.tables.trading_day_state.rows[0].checkpoint_status['1430']={status:'SUCCEEDED'}],
 ['health failed count',x=>x.actual.tables.data_provider_health.rows[0].failed_count=1],
 ['receipt hash',x=>x.actual.boundary.receipts[0].response_sha256='0'.repeat(64)],
 ['historical provider',x=>x.actual.boundary.receipts[0].historical_capture=true],
])test('simultaneous baseline/current tamper rejects '+name,()=>{const x=input();mutate(x);x.baseline=structuredClone(x.actual);assert.throws(()=>assertFreshManualInputAdoption(x));});
test('local Fetch correlation travels in actual HTTP header while body is unchanged',()=>{
 const body={phase:'premarket',correlation_id:'12345678-1234-4234-9234-123456789abc'},before=structuredClone(body);
 const req=new Request('http://127.0.0.1:55471/functions/v1/fetch-market-data-v10',{method:'POST',headers:localFetchCorrelationHeaders('/functions/v1/fetch-market-data-v10',body),body:JSON.stringify(body)});
 assert.equal(req.headers.get('x-correlation-id'),body.correlation_id);assert.deepEqual(body,before);
 const fetchSource=readFileSync(new URL('../supabase/functions/fetch-market-data-v10/index.ts',import.meta.url),'utf8');
 assert.match(fetchSource,/requestedCorrelationId = req\.headers\.get\("x-correlation-id"\)/);
 const driver=readFileSync(new URL('./integration/coreConsolidationFullChain.e2e.mjs',import.meta.url),'utf8');
 assert.match(driver,/Object\.assign\(headers, localFetchCorrelationHeaders\(path, body\)\)/);
 assert.match(driver,/assert\.equal\(result\.body\.correlation_id, correlation/);
});
for(const path of ['https://finnhub.io/api/v1/quote','https://api.line.me/v2/bot/message/push','/functions/v1/line-daily-push','/functions/v1/generate-daily-report-v7','/auth/v1/token'])
 test('correlation helper does not inject a test field into '+path,()=>assert.deepEqual(localFetchCorrelationHeaders(path,{correlation_id:'invalid'}),{}));
test('invalid local correlation rejects before dispatch',()=>assert.throws(()=>localFetchCorrelationHeaders('/functions/v1/fetch-market-data-v10',{correlation_id:'invalid'})));

const driver=readFileSync(new URL('./integration/coreConsolidationFullChain.e2e.mjs',import.meta.url),'utf8');
const loaders=()=>{
 const calls=[];const make=(name,schema)=>(manifest,repo)=>{assert.equal(manifest.schema_version,schema);assert.equal(repo,'exact-repo');calls.push(name);return name;};
 return {calls,loadFreshManualContinuation:make('fresh','CORE_CONSOLIDATION_FRESH_MANUAL_CONTINUATION_V1'),
 loadPremarketContinuation:make('premarket','CORE_CONSOLIDATION_PREMARKET_CONTINUATION_V1'),
 loadWarmupContinuation:make('warmup','CORE_CONSOLIDATION_WARMUP_CONTINUATION_V1')};
};
for(const[kind,flags,schema]of[
 ['fresh',{freshManual:true},'CORE_CONSOLIDATION_FRESH_MANUAL_CONTINUATION_V1'],
 ['premarket',{postPremarket:true},'CORE_CONSOLIDATION_PREMARKET_CONTINUATION_V1'],
 ['warmup',{},'CORE_CONSOLIDATION_WARMUP_CONTINUATION_V1'],
])test('final source verification routes '+kind+' through its exact unchanged loader',()=>{
 const deps=loaders(),fn=isolatedFunction(driver,'recheckContinuationInputs',deps);
 assert.equal(fn({...flags,manifest:{schema_version:schema}},'exact-repo'),kind);assert.deepEqual(deps.calls,[kind]);
});
test('final fresh-manual verification rejects a different schema without falling through to legacy loader',()=>{
 const deps=loaders(),fn=isolatedFunction(driver,'recheckContinuationInputs',deps);
 assert.throws(()=>fn({freshManual:true,manifest:{schema_version:'CORE_CONSOLIDATION_WARMUP_CONTINUATION_V1'}},'exact-repo'));
 assert.deepEqual(deps.calls,[]);
});
test('fresh non-continuation final verification performs no adoption',()=>{
 const deps=loaders(),fn=isolatedFunction(driver,'recheckContinuationInputs',deps);assert.equal(fn(null,'exact-repo'),undefined);assert.deepEqual(deps.calls,[]);
});
test('hash-pinned actual terminal capture stays FAIL despite durable market Closing and Learning',()=>{
 const base=new URL('./fixtures/consolidation-v1/local-failures/',import.meta.url);
 const index=JSON.parse(readFileSync(new URL('index.json',base)));assert.equal(index.full_chain_pass,false);
 assert.equal(index.entries.length,1);const row=index.entries[0],bytes=readFileSync(new URL(row.path,base));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
 const value=JSON.parse(bytes),o=value.observed;assert.equal(value.fixture_id,row.fixture_id);assert.equal(o.full_chain_result,'FAIL');
 assert.equal(o.http_status,409);assert.equal(o.details,'TERMINAL_RECONCILIATION_BLOCKED:CURRENT_QUALITY_NOT_APPROVED');
 assert.equal(o.acceptance,'NOT_RUN');assert.equal(o.acceptance_rows,0);assert.equal(o.automatic_stable_day,false);
 assert.equal(o.closing.status,'COMPLETE');assert.equal(o.learning.contract.status,'COMPLETE');
 assert.equal(o.learning.raw_whole_set_retry_verified,true);assert.equal(o.local_line_delivery_count,1);
 const p=o.published_predicate_rows[0];assert.equal(p.decision_mode,'market_only');assert.equal(p.content_score,100);assert.equal(p.coverage_score,100);
 assert.equal(p.editorial_status,'APPROVED');assert.equal(p.member_status,'PASSED');assert.equal(p.semantic_status,'PASSED');
 assert.deepEqual(o.legacy_allowed_modes,['recommendations','no_trade']);assert.equal(o.legacy_allowed_modes.includes(p.decision_mode),false);
 assert.equal(value.authoring_boundary.additional_local_sql_authoring_authorized,false);
});
test('permanent terminal evidence contains synthetic provenance and no copied credentials or subscriber identifiers',()=>{
 const bytes=readFileSync(new URL('./fixtures/consolidation-v1/local-failures/terminal-market-only-20260917.json',import.meta.url),'utf8'),v=JSON.parse(bytes);
 assert.equal(v.provenance.historical_capture,false);assert.equal(v.provenance.production_data,false);assert.equal(v.provenance.provider_kind,'SYNTHETIC_PROVIDER_CONTROL');
 for(const key of ['credentials_included','auth_users_included','subscriber_identifiers_included','provider_request_headers_included'])assert.equal(v.redaction[key],false);
 assert.doesNotMatch(bytes,/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|U[0-9a-f]{32}|service_role_key|cron_secret|@example/);
});
