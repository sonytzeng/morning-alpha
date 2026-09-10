// Captured local synthetic failure guard tests; not a FULL_DB_E2E result.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assertNarrativeInputSuccessor,assertPremarketInputAdoption} from './helpers/coreConsolidationPremarketContinuation.mjs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
import {applySystemicCatalystFloors} from '../supabase/functions/_shared/news-catalyst-scoring.mjs';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const before=read('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260916.json');
const after=read('./fixtures/consolidation-v1/providers/full-chain-synthetic-20260916-news-v3.json');
const capture=read('./fixtures/consolidation-v1/providers/premarket-news-failure-continuation002.json');
const input=()=>{const value=structuredClone(capture);return {...value,actual:structuredClone(value.baseline),fixture:structuredClone(before)};};
test('local actual PREMARKET producer input remains input-only; all prior FAIL results remain failures',()=>{
 assert.equal(capture.provenance.kind,'LOCAL_ACTUAL_HANDLER_CAPTURE');assert.equal(capture.provenance.historical_capture,false);
 const proof=assertPremarketInputAdoption(input());assert.equal(proof.status,'PRECONDITION_INPUT_ONLY');
 assert.equal(proof.previous_news_failure,'FAIL_RETAINED');assert.equal(proof.publication_adopted,false);
 assert.equal(proof.market_fetch_resent,false);assert.equal(proof.verified_symbols.length,11);
});
for(const [name,mutate] of [
 ['prior PASS',x=>x.priorResult.status='PASS'],['prior full chain',x=>x.priorResult.full_persisted_chain_executed=true],
 ['wrong error fingerprint',x=>x.priorResult.records.at(-1).error='other'],['later handler',x=>x.priorResult.records.unshift({stage:'handler:generate-daily-report-v7'})],
 ['HTTP unsuccessful',x=>x.priorResult.records.find(r=>r.http===200).http=409],['handler business failure',x=>x.priorResult.records.find(r=>r.business_success).business_success=false],
 ['wrong scope',x=>x.actual.scope='foreign'],['wrong business date',x=>x.actual.report_date='2026-09-17'],['wrong warmup date',x=>x.actual.warmup_date='2026-09-14'],
 ['wrong boot',x=>x.actual.guest.boot_id='foreign'],['wrong prior run',x=>x.actual.prior_result.run_id='foreign'],
 ['missing table',x=>delete x.actual.tables.market_news],['404 pretending empty',x=>x.actual.tables.news_events.http=404],
 ['changed raw quote',x=>x.actual.tables.market_data.rows[0].value++],['changed rejected headline',x=>x.actual.tables.market_news.rows[0].title='new'],
 ['changed prior sector',x=>x.actual.tables.sector_rotation_scores.rows[0].score_date='2026-09-16'],
 ['changed immutable',x=>x.actual.tables.market_checkpoint_snapshots.rows[0].source='other'],
 ['changed provider receipt',x=>x.actual.boundary.receipts[0].response_sha256='0'.repeat(64)],
 ['unexpected provider call',x=>x.actual.boundary.receipts.push(x.actual.boundary.receipts[0])],
])test('post-PREMARKET rejects '+name,()=>{assert.doesNotThrow(()=>assertPremarketInputAdoption(input()));const value=input();mutate(value);assert.throws(()=>assertPremarketInputAdoption(value));});
for(const table of ['reports','decision_snapshots','line_delivery_outbox','line_subscribers','learning_runs','learning_predictions','prediction_outcomes','news_events','pipeline_runs','member_content_revisions','production_acceptance_results','runtime_http_dispatches','runtime_dead_letters','ma_ops_runs'])
 test('cannot adopt any new '+table,()=>{const x=input();x.actual.tables[table].rows.push({id:'unexpected'});x.baseline=structuredClone(x.actual);assert.throws(()=>assertPremarketInputAdoption(x));});
for(const [name,mutate] of [
 ['raw value',x=>x.actual.tables.market_data.rows[0].value++],
 ['canonical correlation',x=>x.actual.tables.market_quotes.rows.find(r=>r.trading_date===x.config.report_date).raw_payload.correlation_id='foreign'],
 ['alias checkpoint',x=>x.actual.tables.market_data_snapshots.rows.find(r=>r.trading_date===x.config.report_date).raw.immutable_checkpoint='0930'],
 ['immutable source',x=>x.actual.tables.market_checkpoint_snapshots.rows.find(r=>r.trading_date===x.config.report_date).source='unknown'],
 ['source symbol',x=>x.actual.tables.market_checkpoint_snapshots.rows.find(r=>r.trading_date===x.config.report_date).raw.source_symbol='wrong'],
 ['US10Y inverse proof',x=>x.actual.tables.market_checkpoint_snapshots.rows.find(r=>r.trading_date===x.config.report_date&&r.symbol==='US10Y').raw.source_raw.direction_multiplier=1],
 ['main lifecycle state',x=>x.actual.tables.trading_day_state.rows.find(r=>r.trading_date===x.config.report_date).current_state='DAY_COMPLETED'],
 ['main extra checkpoint',x=>x.actual.tables.trading_day_state.rows.find(r=>r.trading_date===x.config.report_date).checkpoint_status['0900']={status:'SUCCEEDED'}],
 ['warmup close promotion',x=>x.actual.tables.trading_day_state.rows.find(r=>r.trading_date===x.config.warmup_date).checkpoint_status['1430']={status:'SUCCEEDED'}],
 ['prior sector relabel',x=>x.actual.tables.sector_rotation_scores.rows[0].score_date=x.config.report_date],
 ['news selection promotion',x=>x.actual.tables.market_news.rows[0].is_selected=true],
 ['news score promotion',x=>x.actual.tables.market_news.rows[0].final_score=100],
 ['provider response',x=>x.actual.boundary.receipts.at(-1).response_sha256='0'.repeat(64)],
 ['provider historical claim',x=>x.actual.boundary.receipts.at(-1).historical_capture=true],
 ['provider external source',x=>x.actual.boundary.receipts.at(-1).provider='reuters'],
])test('simultaneous baseline/current mutation still rejects '+name,()=>{const x=input();mutate(x);x.baseline=structuredClone(x.actual);assert.throws(()=>assertPremarketInputAdoption(x));});
test('raw narrative successor preserves quote, phase, dates, original rejected URLs and explicit synthetic provenance',()=>assert.equal(assertNarrativeInputSuccessor(before,after),true));
for(const [name,mutate] of [
 ['quote',x=>x.quotes.SPY.value++],['clock phase',x=>x.phases[1].ends_at='2026-09-17T00:00:00Z'],['date',x=>x.report_date='2026-09-17'],
 ['historical label',x=>x.provenance.historical_capture=true],['old URL overwrite',x=>x.news[0].url=before.news[0].url],
 ['external publisher alias',x=>x.news[0].source='Reuters'],['computed news score',x=>x.news[0].final_score=100],
 ['computed news status',x=>x.news[0].is_selected=true],['quote authority in prose',x=>{const p=JSON.parse(x.openai_completion.choices[0].message.content);p.market_publication_contract={status:'PUBLISHED'};x.openai_completion.choices[0].message.content=JSON.stringify(p);}],
 ['stock recommendation',x=>{const p=JSON.parse(x.openai_completion.choices[0].message.content);p.today_beneficiary_stocks=[{symbol:'2330'}];x.openai_completion.choices[0].message.content=JSON.stringify(p);}],
 ['nested score',x=>{const p=JSON.parse(x.openai_completion.choices[0].message.content);p.member_research_note_v2.confidence_score=100;x.openai_completion.choices[0].message.content=JSON.stringify(p);}],
])test('narrative successor rejects '+name,()=>{const x=structuredClone(after);mutate(x);assert.throws(()=>assertNarrativeInputSuccessor(before,x));});
test('actual news scorer selects the synthetic raw event text without seeded scores or lowered threshold',()=>{
 const source=readFileSync(new URL('../supabase/functions/fetch-global-market-news/index.ts',import.meta.url),'utf8');
 const deps={applySystemicCatalystFloors};for(const name of ['BLACKLIST_KEYWORDS','HIGH_VALUE_KEYWORDS','TAIWAN_SUPPLY_CHAIN_MAP','TAIWAN_KEYWORDS','IMPACT_KEYWORDS','CATEGORY_MAP','normalizeTitle','detectRejectionReason','detectTaiwanMapping'])deps[name]=isolatedFunction(source,name,deps);
 const score=isolatedFunction(source,'scoreNewsItem',deps);
 assert.ok(before.news.every(row=>score(row.title,row.summary).isSelected===false));
 for(const row of after.news){const result=score(row.title,row.summary);assert.equal(result.isSelected,true);assert.ok(result.finalScore>=60);assert.equal(result.isBlacklisted,false);}
 assert.ok(after.news.every(row=>Object.keys(row).length===3));
});
