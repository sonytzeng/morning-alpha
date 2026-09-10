// Explicit opt-in, fresh loopback PostgreSQL only. No Production connection,
// provider, actual LINE request or scheduler execution. The separately named
// terminal-reconciliation RPC is exercised only inside this fresh test DB.
// MA_LOCAL_SCOPE=ma-core-consolidation-20260909
// MA_ISOLATED_TEST_DB=ma_core_consolidation_test<digits>
// node --experimental-strip-types --test tests/coreConsolidationDatabase.integration.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleResearchMasterV2, assembleCanonicalMarketResearch, validateResearchMasterV2, admitResearchRecommendations } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { validateOpeningPublication, evaluateClosingContract, evaluateLearningContract } from '../supabase/functions/_shared/closing-learning-contract.ts';

const scope = 'ma-core-consolidation-20260909';
const database = process.env.MA_ISOLATED_TEST_DB;
if (process.env.MA_LOCAL_SCOPE !== scope || !/^ma_core_consolidation_test\d+$/.test(database || '')) {
  throw new Error('EXPLICIT_FRESH_CORE_CONSOLIDATION_DATABASE_REQUIRED');
}
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migrationPath = 'supabase/migrations/20260909015650_core_market_publication_contract.sql';
const migration = read(migrationPath);
assert.ok(migration.includes('validate_core_market_publication_v1') && migration.includes('CORE_CONSOLIDATION_V1'), 'Named candidate must exist before creating the isolated database');
const bin = process.env.MA_TEST_PSQL || 'psql';
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const args = ['-X', '-h', '127.0.0.1', '-p', '55439', '-d', database, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
function isolatedDatabaseServer(env, inspectDocker) {
  const serviceId = env.MA_CONSOLIDATION_CI_SERVICE_ID;
  if (!env.CI && !env.GITHUB_ACTIONS && !serviceId) return { address: '127.0.0.1', port: '55439' };
  assert.equal(env.CI, 'true', 'CI service requires the actual CI job');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'CI service requires GitHub Actions');
  assert.match(serviceId || '', /^[a-f0-9]{64}$/, 'CI service requires the exact job.services.postgres.id');
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    assert.ok(!env[key], 'CI service cannot redirect Docker: ' + key);
  }
  const contexts = JSON.parse(inspectDocker(['--context', 'default', 'context', 'inspect', 'default']));
  assert.equal(contexts.length, 1, 'One exact local Docker context required');
  assert.equal(contexts[0].Name, 'default');
  assert.equal(contexts[0].Endpoints?.docker?.Host, 'unix:///var/run/docker.sock', 'Docker must be the local Unix daemon');
  const containers = JSON.parse(inspectDocker(['--context', 'default', 'container', 'inspect', serviceId]));
  assert.equal(containers.length, 1, 'One exact CI service container required');
  const container = containers[0];
  assert.equal(container.Id, serviceId, 'Inspected container must be the job service');
  assert.equal(container.Config?.Image, 'postgres:17', 'Only the reviewed PostgreSQL 17 service');
  assert.equal(container.State?.Running, true, 'CI service must be running');
  const bindings = container.HostConfig?.PortBindings?.['5432/tcp'];
  assert.equal(bindings?.length, 1, 'One fixed Postgres host binding required');
  assert.equal(bindings[0].HostPort, '55439');
  assert.ok(['', '0.0.0.0', '127.0.0.1'].includes(bindings[0].HostIp), 'No remote host binding');
  const exposed = container.NetworkSettings?.Ports?.['5432/tcp'];
  assert.ok(Array.isArray(exposed) && exposed.length > 0, 'The fixed port must actually be exposed');
  assert.ok(exposed.every(binding => binding.HostPort === '55439'
    && ['', '0.0.0.0', '127.0.0.1', '::'].includes(binding.HostIp)), 'Actual port exposure must remain 55439');
  const networks = Object.values(container.NetworkSettings?.Networks || {});
  assert.equal(networks.length, 1, 'One unambiguous CI service network required');
  const address = networks[0].IPAddress;
  assert.equal(isIP(address || ''), 4, 'CI service requires its actual IPv4 address');
  assert.ok(address.startsWith('10.') || address.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address), 'CI service must have a private Docker network address');
  return { address, port: '5432' };
}
const expectedServer = isolatedDatabaseServer(process.env, dockerArgs => execFileSync('docker', dockerArgs,
  { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }));
function command(text, db = database) {
  try { return execFileSync(bin, args.map((value, index) => index === 6 ? db : value).concat(['-c', text]),
    { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch (error) { throw new Error('ISOLATED_SQL_FAILED: ' + (error.stderr?.toString().trim() || error.message)); }
}
assert.equal(command('select host(inet_server_addr());', 'postgres'), expectedServer.address, 'Actual server must match verified loopback or this exact local CI service');
assert.equal(command('select inet_server_port();', 'postgres'), expectedServer.port);
assert.equal(command(`select count(*) from pg_database where datname=${q(database)};`, 'postgres'), '0', 'Never reset/reuse another database');
command(`create database ${database};`, 'postgres');
assert.equal(command('select current_database();'), database);
command(`create schema ma_isolated_guard; create table ma_isolated_guard.identity(scope text primary key); insert into ma_isolated_guard.identity values(${q(scope)});`);
function sql(text) {
  assert.equal(command('select scope from ma_isolated_guard.identity;'), scope);
  return command(text);
}
function definition(path, name) {
  const source = read(path), pattern = new RegExp('create or replace function public\\.' + name + '\\(', 'i');
  const start = source.search(pattern);
  assert.ok(start >= 0, 'Missing original function: ' + name);
  const tail = source.slice(start), delimiter = tail.match(/\bas\s+(\$[a-zA-Z_]*\$)/i)?.[1];
  assert.ok(delimiter, 'Original function dollar delimiter required');
  const bodyStart = tail.indexOf(delimiter), bodyEnd = tail.indexOf(delimiter, bodyStart + delimiter.length);
  assert.ok(bodyEnd > bodyStart);
  return tail.slice(0, bodyEnd + delimiter.length) + ';';
}
for (const path of ['tests/fixtures/core-research-schema.sql', 'tests/fixtures/core-research-indexes.sql', 'tests/fixtures/core-research-publish-baseline.sql']) sql(read(path));
const acceptanceFixture = read('tests/fixtures/core-acceptance-schema.sql');
const schemaEnd = acceptanceFixture.indexOf('-- Existing Production RPC definitions');
assert.ok(schemaEnd > 0); sql(acceptanceFixture.slice(0, schemaEnd));
sql(read('supabase/migrations/202606260001_market_data_snapshots.sql'));
const checkpointSchema = read('supabase/migrations/20260822173542_preserve_checkpoint_snapshots.sql');
sql(checkpointSchema.slice(0, checkpointSchema.indexOf('alter table public.data_provider_health')));
for (const name of ['claim_research_input_v1', 'finish_research_input_v1', 'publish_research_bundle_v1', 'reconcile_runtime_terminal_failures_v1']) sql(definition('supabase/migrations/20260907030607_core_research_atomic_publication.sql', name));
sql(definition('supabase/migrations/20260822090305_production_architecture_v1.sql', 'enforce_decision_snapshot_premium_90_gate_v1'));
sql(`create trigger decision_snapshots_premium_90_gate before insert or update of status,content_score,decision_mode on public.decision_snapshots for each row execute function public.enforce_decision_snapshot_premium_90_gate_v1();`);
sql(read('supabase/migrations/20260908020000_incident_acceptance_market_delivery.sql'));
sql(read('supabase/migrations/20260908050000_market_publication_recommendation_isolation.sql'));
const signatures = [
  ['enforce_decision_snapshot_premium_90_gate_v1()', 'trigger', false],
  ['publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)', 'jsonb', false],
  ['publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)', 'uuid', true],
  ['publish_decision_snapshot_v3(date,text,uuid,jsonb,uuid,text,integer)', 'uuid', true],
  ['capture_morning_alpha_acceptance_v1(date,text)', 'uuid', true],
];
const validatorSignature = 'validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)';
const terminalSignature = 'reconcile_runtime_terminal_failures_v1(date,uuid)';
sql("do $$ begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres nologin; end if; end $$;");
sql('grant usage on schema public to postgres,service_role; grant all on all tables in schema public to postgres,service_role;');
for (const [signature] of [...signatures, [terminalSignature], ['publish_decision_snapshot_v2(date,text,uuid,jsonb)'], ['claim_research_input_v1(date,text,uuid,text,text,jsonb)'], ['finish_research_input_v1(uuid,uuid,text,jsonb,integer)']]) {
  sql(`alter function public.${signature} owner to postgres; revoke all on function public.${signature} from public,anon,authenticated; grant execute on function public.${signature} to service_role;`);
}
const tables = JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public';"));
for (const table of tables) sql(`alter table public.${table} enable row level security; revoke all on public.${table} from public,anon,authenticated; create policy isolated_owner on public.${table} to postgres using(true) with check(true);`);
for (const table of ['member_content_revisions', 'semantic_coherence_reviews']) sql(`alter table public.${table} force row level security;`);
sql(`alter table public.decision_snapshots add foreign key(report_id) references public.reports(id);
  alter table public.member_content_revisions add foreign key(decision_snapshot_id) references public.decision_snapshots(id);
  alter table public.semantic_coherence_reviews add foreign key(member_content_revision_id) references public.member_content_revisions(id);
  alter table public.prediction_outcomes add foreign key(prediction_id) references public.learning_predictions(id);`);
const functionMetadata = signature => JSON.parse(sql(`select json_build_object('definition',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,
  'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p where p.oid=${q('public.' + signature)}::regprocedure;`));
const triggerMetadata = () => sql("select json_agg(json_build_object('definition',pg_get_triggerdef(oid),'enabled',tgenabled,'function',tgfoid::regprocedure::text) order by tgname) from pg_trigger where not tgisinternal;");
const accessMetadata = () => sql("select json_agg(json_build_object('name',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r';");
const before = new Map(signatures.map(([signature]) => [signature, functionMetadata(signature)]));
const terminalBefore = functionMetadata(terminalSignature);
const v2Before = functionMetadata('publish_decision_snapshot_v2(date,text,uuid,jsonb)');
const triggersBefore = triggerMetadata(), accessBefore = accessMetadata();
sql(`insert into public.production_acceptance_results(business_date,evaluator_version,idempotency_key,verdict,blocking_checks,evidence)
  values('2026-09-07','ISOLATED_ORIGINAL_FAIL','isolated-original-fail-0709','FAIL',array['ORIGINAL_EVIDENCE_FAILURE'],'{"fixture":true,"original":true}'),
    ('2026-09-08','ISOLATED_ORIGINAL_FAIL','isolated-original-fail-0809','FAIL',array['ORIGINAL_DELIVERY_FAILURE'],'{"fixture":true,"original":true}');`);
const historical = () => sql("select jsonb_agg(to_jsonb(a) order by business_date) from production_acceptance_results a where evaluator_version='ISOLATED_ORIGINAL_FAIL';");
const historicalBefore = historical();
sql(migration);
const once = new Map([...signatures, [validatorSignature]].map(([signature]) => [signature, functionMetadata(signature)]));
const terminalOnce = functionMetadata(terminalSignature);
sql(migration);

function fixture() {
  const input = isolatedFunction(read('supabase/functions/generate-daily-report-v7/research-master-v2.test.ts'), 'completeFixture')();
  const ai = input.legacy, correlation = randomUUID(), fingerprint = randomUUID().replaceAll('-', '').repeat(2);
  const sentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  Object.assign(ai, { today_quote: sentence, v8_daily_sentence: { sentence }, free_summary: { one_sentence: sentence }, line_push_copy: { one_sentence: sentence },
    data_quality: 'complete', missing_sources: [], v10_beneficiary_enabled: true, member_value_score: 0,
    is_trading_day: true, market_status: 'OPEN', report_mode: input.reportMode,
    content_evidence_quality: { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3, verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true } });
  ai.member_research_note_v2.today_core_thesis = sentence;
  ai.today_beneficiary_stocks_v10 = ['3034', '3529', '5274', '3131', '4763'].map(symbol => ({ symbol, name: 'synthetic-' + symbol, reason: '只有產業行情，沒有該公司的支持證據', evidence_refs: ['SEC001'] }));
  const stocks = assembleResearchMasterV2(input);
  stocks.quality = validateResearchMasterV2(stocks, input).quality;
  // Counterfactual private rejected-input capture, not newly admitted claims
  // and never a fabricated market audit or a historical Production result.
  stocks.quality.unsupported_claims = ['3034', '3529', '5274', '3131', '4763'].map(symbol => 'ISOLATED_UNSUPPORTED_STOCK_' + symbol);
  stocks.quality.evidence_coverage = 76; stocks.quality.publish_status = 'degraded';
  assert.equal(stocks.quality.unsupported_claims.length, 5);
  ai.stock_research = { schema_version: 'STOCK_RESEARCH_V1', report_date: input.reportDate, document: stocks };
  ai.canonical_market_state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
  ai.research_master_v2 = ai.canonical_market_state.document;
  const gate = evaluateMarketReportGate(ai, input.reportDate);
  assert.equal(gate.eligible, true, JSON.stringify(gate.reason_codes));
  assert.equal(gate.decision_mode, 'market_only');
  Object.assign(ai, { decision_mode: 'market_only', canonical_action: 'WAIT', report_status: 'READY',
    recommendation_status: 'BLOCKED', market_report_gate: gate, today_beneficiary_stocks: [], today_beneficiary_stocks_v10: [] });
  const report = { report_date: input.reportDate, report_mode: input.reportMode, today_quote: sentence, today_summary: sentence, summary: sentence, ai_strategy_json: ai };
  const decision = { input_fingerprint: fingerprint, report_mode: input.reportMode, is_trading_day: true, market_status: 'OPEN',
    data_as_of: input.generatedAt, engine_version: 'isolated-core-consolidation', decision_mode: 'market_only', content_score: gate.content_score,
    content_grade: 'high_quality', coverage_score: 100, action: 'WAIT', market_regime: '中性觀察', confidence_score: 64,
    source_freshness: { status: 'complete' }, source_refs: canonicalMarketSourceRefs(ai),
    generated_text: { generated_at: input.generatedAt, daily_sentence: sentence, market_bias: '中性觀察', recommendations: [], market_report_gate: gate, canonical_market_state: ai.canonical_market_state,
      data_quality: ai.data_quality, missing_sources: structuredClone(ai.missing_sources), content_evidence_quality: structuredClone(ai.content_evidence_quality) } };
  const contract = { snapshot_id: correlation, snapshot_version: 1, report_date: input.reportDate, action: 'WAIT', decision_mode: 'market_only', data_quality_status: 'complete', primary_symbols: [], market_report_gate: gate };
  const member = { today_core_thesis: sentence, line_summary: sentence, canonical_contract: contract, beneficiary_candidates: [], representative_stocks: [] };
  const semantic = { status: 'PASSED', eligible: true, reason_codes: [], conflicting_fields: [], gate_version: 'ISOLATED_CORE_CONSOLIDATION' };
  return { date: input.reportDate, input, correlation, fingerprint, report, decision, contract, member, semantic };
}
const validate = f => JSON.parse(sql(`set role service_role; select public.validate_core_market_publication_v1(${q(f.date)},${j(f.report.ai_strategy_json)},${j(f.decision)},${j(f.contract)},${j(f.member)},${j(f.semantic)});`).replace(/^SET\n/, ''));
const claim = f => JSON.parse(sql(`select public.claim_research_input_v1(${q(f.date)},${q(f.fingerprint)},${q(f.correlation)},'isolated-core-consolidation','isolated-test','{"missing_sources":[],"market_count":3,"news_count":1,"sector_count":1}');`));
const publish = (f, run) => JSON.parse(sql(`set role service_role; select public.publish_research_bundle_v1(${q(run.run_id)},${q(f.correlation)},${j(f.report)},${j(f.decision)},${j(f.contract)},${j(f.member)},${j(f.semantic)});`).replace(/^SET\n/, ''));
const rowState = () => sql(`select jsonb_build_object(${['reports', 'decision_snapshots', 'member_content_revisions', 'semantic_coherence_reviews', 'editorial_reviews', 'research_sessions', 'line_delivery_outbox'].map(table => `${q(table)},(select jsonb_agg(to_jsonb(r) order by id) from public.${table} r)`).join(',')});`);
let valid, published, opening, closingSnapshot, closingContract, learningContract, prediction, outcome, run;

test('CI adapter accepts only the exact local job service and leaves ordinary loopback authority unchanged', () => {
  assert.deepEqual(isolatedDatabaseServer({}, () => assert.fail('Local mode must never inspect Docker')), { address: '127.0.0.1', port: '55439' });
  const serviceId = 'a'.repeat(64);
  const proof = () => ({ env: { CI: 'true', GITHUB_ACTIONS: 'true', MA_CONSOLIDATION_CI_SERVICE_ID: serviceId },
    contexts: [{ Name: 'default', Endpoints: { docker: { Host: 'unix:///var/run/docker.sock' } } }],
    containers: [{ Id: serviceId, Config: { Image: 'postgres:17' }, State: { Running: true },
      HostConfig: { PortBindings: { '5432/tcp': [{ HostIp: '', HostPort: '55439' }] } },
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55439' }] },
        Networks: { job_network: { IPAddress: '172.18.0.2' } } } }] });
  const verify = candidate => isolatedDatabaseServer(candidate.env, dockerArgs => {
    if (dockerArgs[2] === 'context') {
      assert.deepEqual(dockerArgs, ['--context', 'default', 'context', 'inspect', 'default']);
      return JSON.stringify(candidate.contexts);
    }
    assert.deepEqual(dockerArgs, ['--context', 'default', 'container', 'inspect', serviceId]);
    return JSON.stringify(candidate.containers);
  });
  assert.deepEqual(verify(proof()), { address: '172.18.0.2', port: '5432' });
  for (const [label, mutate] of [
    ['not GitHub Actions', p => { delete p.env.GITHUB_ACTIONS; }],
    ['not CI', p => { p.env.CI = 'false'; }],
    ['missing service', p => { delete p.env.MA_CONSOLIDATION_CI_SERVICE_ID; }],
    ['abbreviated service', p => { p.env.MA_CONSOLIDATION_CI_SERVICE_ID = 'a'.repeat(12); }],
    ['redirected Docker host', p => { p.env.DOCKER_HOST = 'tcp://remote:2375'; }],
    ['redirected Docker context', p => { p.env.DOCKER_CONTEXT = 'remote'; }],
    ['remote daemon', p => { p.contexts[0].Endpoints.docker.Host = 'tcp://remote:2375'; }],
    ['wrong context', p => { p.contexts[0].Name = 'remote'; }],
    ['wrong service', p => { p.containers[0].Id = 'b'.repeat(64); }],
    ['wrong image', p => { p.containers[0].Config.Image = 'postgres:latest'; }],
    ['stopped service', p => { p.containers[0].State.Running = false; }],
    ['wrong host port', p => { p.containers[0].HostConfig.PortBindings['5432/tcp'][0].HostPort = '5432'; }],
    ['wrong exposed port', p => { p.containers[0].NetworkSettings.Ports['5432/tcp'][0].HostPort = '5432'; }],
    ['remote host binding', p => { p.containers[0].HostConfig.PortBindings['5432/tcp'][0].HostIp = '203.0.113.1'; }],
    ['multiple networks', p => { p.containers[0].NetworkSettings.Networks.other = { IPAddress: '172.19.0.2' }; }],
    ['missing network IP', p => { delete p.containers[0].NetworkSettings.Networks.job_network.IPAddress; }],
    ['nonlocal network IP', p => { p.containers[0].NetworkSettings.Networks.job_network.IPAddress = '203.0.113.1'; }],
  ]) {
    const candidate = proof(); mutate(candidate); assert.throws(() => verify(candidate), assert.AssertionError, label);
  }
});

test('named migration twice preserves five RPC signatures/defaults/owner/private ACL/security/search_path and original trigger/RLS', () => {
  for (const [signature, result, definer] of signatures) {
    const original = before.get(signature), current = functionMetadata(signature);
    assert.deepEqual(current, once.get(signature), 'second apply is identical: ' + signature);
    const { definition: ignoredOld, ...oldContract } = original;
    const { definition: ignoredNew, ...newContract } = current;
    assert.deepEqual(newContract, oldContract, 'original catalog contract retained: ' + signature);
    assert.equal(current.result, result); assert.equal(current.definer, definer); assert.equal(current.owner, 'postgres');
    assert.deepEqual(current.config, ['search_path=""']); assert.equal(current.anon, false); assert.equal(current.auth, false); assert.equal(current.service, true);
  }
  assert.deepEqual(functionMetadata('publish_decision_snapshot_v2(date,text,uuid,jsonb)'), v2Before);
  const validator = functionMetadata(validatorSignature);
  assert.equal(validator.result, 'jsonb'); assert.equal(validator.definer, false); assert.equal(validator.owner, 'postgres');
  assert.deepEqual(validator.config, ['search_path=""']); assert.equal(validator.anon, false); assert.equal(validator.auth, false); assert.equal(validator.service, true);
  assert.equal(triggerMetadata(), triggersBefore); assert.equal(accessMetadata(), accessBefore); assert.equal(historical(), historicalBefore);
  assert.equal(sql("select premium_publish_min||'/'||auto_repair_min from runtime_quality_policies where active;"), '90/70');
});

test('market READY with private recommendation 76 percent and five unsupported claims publishes atomically without stocks', () => {
  valid = fixture(); assert.equal(validate(valid).eligible, true);
  run = claim(valid); assert.equal(run.status, 'ACQUIRED'); published = publish(valid, run); assert.equal(published.success, true);
  const row = JSON.parse(sql(`select row_to_json(r) from reports r where id=${q(published.report_id)};`));
  assert.equal(row.ai_strategy_json.stock_research.document.quality.evidence_coverage, 76);
  assert.equal(row.ai_strategy_json.stock_research.document.quality.unsupported_claims.length, 5);
  assert.equal(row.ai_strategy_json.market_publication_contract.status, 'PUBLISHED');
  assert.equal(row.ai_strategy_json.market_publication_contract.revision_id, published.decision_snapshot_id);
  assert.equal(row.ai_strategy_json.market_publication_contract.publication_run_id, run.run_id);
  assert.deepEqual(JSON.parse(sql(`select generated_text->'recommendations' from decision_snapshots where id=${q(published.decision_snapshot_id)};`)), []);
  const stable = rowState(); assert.equal(claim(valid).status, 'REUSED'); assert.equal(rowState(), stable);
});

test('stale/missing/wrong identity and unsupported market evidence reject validator and roll back publication', () => {
  const candidate = fixture(), lease = claim(candidate), stable = rowState();
  assert.equal(lease.status, 'ACQUIRED', 'negative controls need their own actual lease');
  for (const [name, mutate] of [
    ['missing CMS', f => { delete f.decision.generated_text.canonical_market_state; }],
    ['stale date', f => { f.decision.generated_text.canonical_market_state.report_date = '2026-07-13'; }],
    ['wrong contract date', f => { f.contract.report_date = '2026-07-13'; }],
    ['missing ledger refs', f => { f.decision.source_refs = []; }],
    ['missing committed market bias', f => { delete f.decision.generated_text.market_bias; delete f.decision.market_regime; }],
    ['forged source tuple', f => { f.decision.source_refs[0].source = 'UNVERIFIED'; }],
    ['unsupported market claim', f => { f.decision.generated_text.canonical_market_state.document.quality.unsupported_claims.push('UNSUPPORTED_MARKET'); }],
    ['market ledger stock scope', f => { f.decision.generated_text.canonical_market_state.document.quality.coverage_audit.claims[0].scope = 'stock'; }],
    ['editorial 89', f => { f.decision.content_score = 89; }],
    ['coverage 99', f => { f.decision.coverage_score = 99; }],
    ['semantic false', f => { f.semantic.eligible = false; }],
    ['semantic blocked', f => { f.semantic.status = 'BLOCKED'; }],
    ['semantic conflicts', f => { f.semantic.conflicting_fields = ['today_core_thesis']; }],
    ['member wrong identity', f => { f.member.canonical_contract = { ...f.contract, snapshot_id: randomUUID() }; }],
    ['market-only stock leak', f => { f.member.beneficiary_candidates = [{ symbol: '2317' }]; }],
  ]) {
    const f = structuredClone(candidate); mutate(f);
    assert.equal(validate(f).eligible, false, name);
    assert.throws(() => publish(f, lease), /GATE_BLOCKED|PUBLICATION|SEMANTIC|CONTRACT|INPUT_REVISION_MISMATCH/, name);
    assert.equal(rowState(), stable, name);
  }
  assert.equal(sql(`select status from pipeline_runs where id=${q(lease.run_id)};`), 'RUNNING');
  sql(`select public.finish_research_input_v1(${q(lease.run_id)},${q(candidate.correlation)},'DEGRADED','{"error_code":"ISOLATED_NEGATIVES_COMPLETE"}',null);`);
});

test('TS and SQL require the same exact evidence ID union and real producer freshness context', () => {
  const ts = f => buildCanonicalMarketState(canonicalMarketDocument(f.decision.generated_text)).status === 'READY';
  const state = f => f.decision.generated_text.canonical_market_state;
  const sourceContext = (f, freshness, source) => {
    const claims = state(f).document.quality.coverage_audit.claims, id = claims[0].sources[0].evidence_id;
    for (const claim of claims) for (const row of claim.sources) if (row.evidence_id === id) {
      row.freshness = freshness;
      if (source) row.source = source;
      if (source === 'reports' || source === 'sector_rotation_scores') row.source_date = '2026-07-13';
    }
    f.decision.source_refs = canonicalMarketSourceRefs(f.decision.generated_text);
  };
  for (const [freshness, source] of [['fresh', 'market_data'], ['recent', 'market_news'],
    ['previous_trading_day', 'sector_rotation_scores'], ['previous_report', 'reports']]) {
    const f = fixture(); sourceContext(f, freshness, source);
    assert.equal(ts(f), true, freshness); assert.equal(validate(f).eligible, true, freshness);
  }
  for (const [name, mutate] of [
    ['missing state IDs', f => { delete state(f).evidence_ids; }],
    ['empty state IDs', f => { state(f).evidence_ids = []; }],
    ['foreign state IDs', f => { state(f).evidence_ids = ['FOREIGN_ID']; }],
    ['duplicate state IDs', f => { state(f).evidence_ids.push(state(f).evidence_ids[0]); }],
    ['wrong claim IDs', f => {
      const claims = state(f).document.quality.coverage_audit.claims; claims[0].evidence_ids = ['FOREIGN_ID'];
      state(f).evidence_ids = [...new Set(claims.flatMap(claim => claim.evidence_ids))];
    }],
    ['blank freshness', f => sourceContext(f, '')],
    ['unknown freshness', f => sourceContext(f, 'unknown')],
    ['null freshness', f => sourceContext(f, null)],
    ['invented freshness', f => sourceContext(f, 'verified')],
    ['wrong market prior context', f => sourceContext(f, 'previous_trading_day', 'market_data')],
    ['wrong news prior context', f => sourceContext(f, 'previous_report', 'market_news')],
    ['wrong sector current context', f => sourceContext(f, 'fresh', 'sector_rotation_scores')],
    ['wrong previous report context', f => sourceContext(f, 'recent', 'reports')],
    ['prior date cannot equal current date', f => {
      sourceContext(f, 'previous_report', 'reports');
      for (const claim of state(f).document.quality.coverage_audit.claims) for (const row of claim.sources)
        if (row.source === 'reports') row.source_date = f.date;
      f.decision.source_refs = canonicalMarketSourceRefs(f.decision.generated_text);
    }],
  ]) {
    const f = fixture(); assert.equal(ts(f), true); assert.equal(validate(f).eligible, true);
    mutate(f); assert.equal(ts(f), false, name); assert.equal(validate(f).eligible, false, name);
  }
  // The actual delivery evaluator's duplicate-tuple negative lives in
  // consolidationCanonicalEvidence.test.mjs; this is its persisted SQL input.
  const duplicateSource = fixture(); assert.equal(validate(duplicateSource).eligible, true);
  duplicateSource.decision.source_refs.push(structuredClone(duplicateSource.decision.source_refs[0]));
  assert.equal(validate(duplicateSource).eligible, false, 'SQL must not deduplicate an invalid snapshot tuple set into acceptance');
});

test('actual member-insert failure rolls back all publication rows and keeps the original successful receipt', () => {
  const f = fixture(), lease = claim(f), stable = rowState();
  assert.equal(lease.status, 'ACQUIRED');
  sql("create function public.isolated_member_failure() returns trigger language plpgsql as $$ begin raise exception 'ISOLATED_CORE_MEMBER_FAILURE'; end $$; create trigger isolated_member_failure before insert on public.member_content_revisions for each row execute function public.isolated_member_failure();");
  try { assert.throws(() => publish(f, lease), /ISOLATED_CORE_MEMBER_FAILURE/); assert.equal(rowState(), stable); }
  finally { sql('drop trigger isolated_member_failure on public.member_content_revisions; drop function public.isolated_member_failure();'); }
  sql(`select public.finish_research_input_v1(${q(lease.run_id)},${q(f.correlation)},'DEGRADED','{"error_code":"ISOLATED_ATOMIC_ROLLBACK"}',null);`);
});

test('direct v3/member RPCs cannot bypass canonical market, semantic or identity gates', () => {
  const stable = rowState();
  for (const mutate of [decision => { delete decision.generated_text.canonical_market_state; }, decision => { decision.content_score = 89; }, decision => { decision.coverage_score = 99; }]) {
    const decision = structuredClone(valid.decision); mutate(decision);
    assert.throws(() => sql(`set role service_role; select public.publish_decision_snapshot_v3(${q(valid.date)},'PREMARKET',${q(published.report_id)},${j(decision)},${q(randomUUID())},${q('isolated-direct-' + randomUUID())},1);`), /GATE_BLOCKED|PUBLICATION/);
    assert.equal(rowState(), stable);
  }
  const member = JSON.parse(sql(`select row_to_json(m) from member_content_revisions m where id=${q(published.member_content_revision_id)};`));
  const semantic = JSON.parse(sql(`select result from semantic_coherence_reviews where member_content_revision_id=${q(member.id)};`));
  for (const change of ['semantic', 'revision', 'score', 'coverage']) {
    const canonical = structuredClone(member.canonical_contract), content = structuredClone(member.member_content), result = structuredClone(semantic);
    if (change === 'semantic') result.eligible = false;
    if (change === 'revision') canonical.snapshot_id = randomUUID();
    const score = change === 'score' ? 89 : member.content_score, coverage = change === 'coverage' ? 99 : member.evidence_coverage;
    assert.throws(() => sql(`set role service_role; select public.publish_member_content_revision_v1(${q(valid.date)},${q(published.report_id)},${q(published.decision_snapshot_id)},
      ${q('isolated-direct-member-' + randomUUID())},${q(member.source_revision)},${j(canonical)},${j(content)},${j(result)},${score},${coverage},${q(member.generated_at)},'{}');`));
    assert.equal(rowState(), stable, change);
  }
});

function capture() {
  const id = sql(`set role service_role; select public.capture_morning_alpha_acceptance_v1(${q(valid.date)},'ISOLATED_CORE_CONSOLIDATION');`).replace(/^SET\n/, '');
  return JSON.parse(sql(`select row_to_json(a) from production_acceptance_results a where id=${q(id)};`));
}
function reportRow() { return JSON.parse(sql(`select row_to_json(r) from reports r where id=${q(published.report_id)};`)); }
function snapshotRow(id) { return JSON.parse(sql(`select row_to_json(d) from decision_snapshots d where id=${q(id)};`)); }

test('historical timing fixtures bind real opening receipt, durable close rows and market learning; raw completed JSON alone never passes', () => {
  const date = valid.date, revision = published.decision_snapshot_id, memberId = published.member_content_revision_id;
  // Explicit local historical seed, not actual natural execution or a clock override.
  sql(`update decision_snapshots set valid_from=${q(date + 'T07:00:00+08:00')},created_at=${q(date + 'T07:00:00+08:00')} where id=${q(revision)};
    update pipeline_runs set completed_at=${q(date + 'T07:02:00+08:00')},provider_status=provider_status||'{"trigger":"scheduled"}'::jsonb where id=${q(run.run_id)};
    update semantic_coherence_reviews set checked_at=${q(date + 'T07:01:00+08:00')} where member_content_revision_id=${q(memberId)};
    update reports set ai_strategy_json=jsonb_set(ai_strategy_json,'{market_publication_contract,opening_publication_revision_id}',${j(revision)}) where id=${q(published.report_id)};`);
  const report = reportRow(), decision = snapshotRow(revision), receipt = JSON.parse(sql(`select row_to_json(p) from pipeline_runs p where id=${q(run.run_id)};`));
  opening = validateOpeningPublication({ report, snapshot: decision, publicationRun: receipt });
  assert.equal(opening.status, 'PUBLISHED', JSON.stringify(opening.reason_codes));
  const before = capture(); assert.equal(before.verdict, 'FAIL'); assert.equal(before.evidence.automatic_stable_day, false);
  const quotes = ['TAIEX', '2330', 'TXF'].map((symbol, index) => ({ symbol, value: 1000 + index * 100, change_percent: 1 + index * 0.1,
    captured_at: date + (symbol === 'TXF' ? 'T13:45:00+08:00' : 'T13:30:00+08:00'), source: 'isolated-real-row-fixture', phase: 'close', trading_date: date }));
  for (const quote of quotes) sql(`insert into market_data_snapshots(symbol,value,change_percent,captured_at,source,phase,trading_date,checkpoint,raw)
    values(${q(quote.symbol)},${quote.value},${quote.change_percent},${q(quote.captured_at)},${q(quote.source)},'close',${q(date)},'1430','{"fixture":true}');`);
  const close = { version: 'S2_P2_CLOSE_VERIFICATION_V2', status: 'completed', data_status: 'complete', report_date: date,
    opening_decision_snapshot_id: revision, opening_decision_snapshot_version: decision.version, verified_at: date + 'T14:31:00+08:00',
    evidence_fingerprint: 'isolated-exact-closing-evidence', actual_taiex_close: quotes[0], actual_2330_close: quotes[1], actual_txf_close: quotes[2],
    actual_direction: 'up', hit_or_miss: 'partial', predicted_beneficiary_stocks: [], beneficiary_list_validation: { data_status: 'not_applicable', items: [] },
    data_source: { table: 'market_data_snapshots', no_fake_data: true } };
  closingSnapshot = { id: randomUUID(), report_id: published.report_id, report_date: date, session_type: 'CLOSING', status: 'FINAL', version: 1,
    coverage_score: 100, source_freshness: { status: 'complete' }, valid_from: date + 'T14:32:00+08:00',
    generated_text: { opening_decision_snapshot_id: revision, opening_decision_snapshot_version: decision.version,
      evidence_fingerprint: close.evidence_fingerprint, closing_verification_v2: close } };
  closingContract = evaluateClosingContract({ opening, closingSnapshot });
  assert.equal(closingContract.status, 'COMPLETE', JSON.stringify(closingContract.reason_codes));
  sql(`update reports set ai_strategy_json=ai_strategy_json||jsonb_build_object('closing_contract',${j(closingContract)},'closing_verification_v2',${j(close)}) where id=${q(published.report_id)};`);
  assert.equal(capture().verdict, 'FAIL', 'self-reported closing before durable snapshot must fail');
  sql(`insert into decision_snapshots(id,report_id,report_date,session_type,status,version,idempotency_key,decision_mode,coverage_score,source_freshness,valid_from,generated_text,is_current)
    values(${q(closingSnapshot.id)},${q(published.report_id)},${q(date)},'CLOSING','FINAL',1,${q('isolated-close-' + date)},'closing_verification',100,'{"status":"complete"}',${q(closingSnapshot.valid_from)},${j(closingSnapshot.generated_text)},true);`);
  prediction = { id: randomUUID(), report_id: published.report_id, report_date: date, decision_snapshot_id: revision,
    prediction_at: date + 'T07:00:00+08:00', analysis_window: 'PREMARKET', prediction_scope: 'market', symbol: 'TAIEX', record_status: 'valid', data_quality_status: 'complete' };
  outcome = { prediction_id: prediction.id, horizon: 'close', target_date: date, status: 'completed', data_quality_status: 'complete',
    evaluated_at: date + 'T14:33:00+08:00', return_percent: quotes[0].change_percent, direction_correct: false,
    source_refs: [{ table: 'market_data_snapshots', ...quotes[0] }] };
  learningContract = evaluateLearningContract({ opening, closing: closingContract, predictions: [prediction], outcomes: [outcome] });
  assert.equal(learningContract.status, 'COMPLETE');
  const learningId = randomUUID(), checkpointIds = Object.fromEntries(['premarket', '0900', '0930', '1030', '1300', '1410', '1430'].map(key => [key, randomUUID()]));
  const checkpoints = Object.fromEntries(Object.entries(checkpointIds).map(([key, correlation_id]) => [key, { status: 'SUCCEEDED', correlation_id,
    updated_at: date + 'T14:35:00+08:00', metadata: { core_batch_complete: true } }]));
  checkpoints.continuous_learning = { status: 'SUCCEEDED', metadata: { run_id: learningId, opening_publication_revision_id: revision, learning_contract: learningContract } };
  sql(`insert into learning_predictions(id,decision_snapshot_id,report_id,report_date,prediction_at,analysis_window,prediction_scope,symbol,thesis,direction,expected_horizon,data_quality_status,idempotency_key)
    values(${q(prediction.id)},${q(revision)},${q(published.report_id)},${q(date)},${q(prediction.prediction_at)},'PREMARKET','market','TAIEX','isolated-market-thesis','neutral','close','complete',${q('isolated-prediction-' + date)});
    insert into prediction_outcomes(prediction_id,horizon,target_session,target_date,status,data_quality_status,evaluated_at,return_percent,direction_correct,source_refs)
    values(${q(prediction.id)},'close',0,${q(date)},'completed','complete',${q(outcome.evaluated_at)},${outcome.return_percent},false,${j(outcome.source_refs)});
    insert into learning_runs(id,run_date,run_type,idempotency_key,engine_version,status,completed_at,metadata)
    values(${q(learningId)},${q(date)},'daily',${q('isolated-learning-' + date)},'isolated-core-consolidation','succeeded',${q(date + 'T14:34:00+08:00')},${j({ learning_contract: learningContract, opening_publication_revision_id: revision })});
    insert into trading_day_state(trading_date,current_state,state_rank,checkpoint_status) values(${q(date)},'DAY_COMPLETED',150,${j(checkpoints)});
    insert into ma_ops_runs(check_type,status,severity,completed_at,details_json) values('report','passed','info',${q(date + 'T07:05:00+08:00')},${j({ target_date: date })}),('closing','passed','info',${q(date + 'T14:35:00+08:00')},${j({ target_date: date })});
    insert into line_delivery_outbox(report_date,decision_snapshot_id,line_subscriber_id,line_user_id,push_type,idempotency_key,status,sent_at,payload)
    values(${q(date)},${q(revision)},${q(randomUUID())},'isolated-not-deliverable','daily_report',${q('isolated-line-' + date)},'SENT',${q(date + 'T07:30:00+08:00')},'{"fixture":true}');`);
  let version = 1;
  for (const [checkpoint, correlation] of Object.entries(checkpointIds)) for (const symbol of checkpoint === 'premarket' ? ['TAIEX', '2330', 'TXF', 'NVDA', 'TSM', 'SPX'] : ['TAIEX', '2330', 'TXF']) {
    const pre = checkpoint === 'premarket', time = pre ? '07:00' : checkpoint.slice(0, 2) + ':' + checkpoint.slice(2);
    const phase = pre ? 'premarket' : ['1410', '1430'].includes(checkpoint) ? 'close' : 'intraday';
    const closeQuote = quotes.find(row => row.symbol === symbol);
    const observedAt = date + 'T' + time + ':00+08:00', createdAt = date + 'T' + time + ':03+08:00';
    const sourceAt = phase === 'close' ? closeQuote.captured_at : date + 'T' + time + (['2330', 'TXF'].includes(symbol) ? ':02+08:00' : ':00+08:00');
    const value = closeQuote?.value || 1000, change = closeQuote?.change_percent || 1;
    const source = phase === 'close' ? 'isolated-real-row-fixture' : 'isolated';
    const immutableCheckpoint = pre ? 'PREMARKET' : checkpoint;
    sql(`insert into market_checkpoint_snapshots(checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,source,source_timestamp,correlation_id,snapshot_version,raw,created_at)
      values(${q(immutableCheckpoint)},${q(date)},${q(observedAt)},${q(phase)},${q(symbol)},${value},${change},${q(source)},${q(sourceAt)},${q(correlation)},${version},'{"contract":"FETCH_CHECKPOINT_EVIDENCE_V1","fixture":true}',${q(createdAt)});
      insert into market_data_snapshots(symbol,value,change_percent,captured_at,source,phase,trading_date,checkpoint,raw)
      values(${q(symbol)},${value},${change},${q(sourceAt)},${q(source)},${q(phase)},${q(date)},${q(checkpoint)},${j({ fixture: true, correlation_id: correlation, immutable_snapshot_version: version, immutable_checkpoint: immutableCheckpoint, returned_date: sourceAt })})
      on conflict(symbol,trading_date,phase,checkpoint) do update set value=excluded.value,change_percent=excluded.change_percent,captured_at=excluded.captured_at,source=excluded.source,raw=excluded.raw;`);
    version++;
  }
  const result = capture(); assert.equal(result.verdict, 'PASS', JSON.stringify(result.blocking_checks));
  assert.equal(result.evidence.automatic_stable_day, false); assert.ok(result.evidence.automatic_blocking_checks.includes('HISTORICAL_REPLAY'));
  assert.notEqual(result.id, before.id); assert.equal(capture().id, result.id);
  assert.equal(sql(`select verdict from production_acceptance_results where id=${q(before.id)};`), 'FAIL');
  assert.equal(historical(), historicalBefore);
});

test('a later real atomic publication preserves the original opening and its Closing/Learning/LINE evidence', () => {
  assert.equal(capture().verdict, 'PASS');
  const newer = fixture(), lease = claim(newer); assert.equal(lease.status, 'ACQUIRED');
  const next = publish(newer, lease); assert.equal(next.success, true);
  assert.notEqual(next.decision_snapshot_id, published.decision_snapshot_id);
  const pointer = reportRow().ai_strategy_json.market_publication_contract;
  assert.equal(pointer.revision_id, next.decision_snapshot_id);
  assert.equal(pointer.opening_publication_revision_id, published.decision_snapshot_id, 'publisher retains actually verified original opening');
  // This is still an explicit historical simulation, not natural execution.
  sql(`update decision_snapshots set valid_from=${q(valid.date + 'T11:00:00+08:00')},created_at=${q(valid.date + 'T11:00:00+08:00')} where id=${q(next.decision_snapshot_id)};
    update pipeline_runs set completed_at=${q(valid.date + 'T11:02:00+08:00')} where id=${q(lease.run_id)};
    update semantic_coherence_reviews set checked_at=${q(valid.date + 'T11:01:00+08:00')} where member_content_revision_id=${q(next.member_content_revision_id)};`);
  const result = capture(); assert.equal(result.verdict, 'PASS', JSON.stringify(result.blocking_checks));
  assert.equal(result.evidence.canonical_revision_id, published.decision_snapshot_id);
  assert.equal(result.evidence.current_revision_id, next.decision_snapshot_id);
  assert.equal(result.evidence.closing_snapshot_id, closingSnapshot.id);
  assert.equal(result.evidence.manual_intervention, true, 'scheduled opening cannot conceal later manually triggered committed publication');
  assert.ok(result.evidence.automatic_blocking_checks.includes('MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'));
  assert.equal(result.evidence.automatic_stable_day, false);
});

test('closing/learning wrong revision, missing raw price/source, malformed time and JSON-only completion remain fail-closed', () => {
  assert.equal(capture().verdict, 'PASS');
  const originalAi = reportRow().ai_strategy_json;
  for (const [name, mutation, restoration] of [
    ['wrong opening pointer', `update reports set ai_strategy_json=jsonb_set(ai_strategy_json,'{market_publication_contract,opening_publication_revision_id}',${j(randomUUID())}) where id=${q(published.report_id)}`, `update reports set ai_strategy_json=${j(originalAi)} where id=${q(published.report_id)}`],
    ['missing durable close', `update decision_snapshots set status='PARTIAL' where id=${q(closingSnapshot.id)}`, `update decision_snapshots set status='FINAL' where id=${q(closingSnapshot.id)}`],
    ['wrong durable opening', `update decision_snapshots set generated_text=jsonb_set(generated_text,'{opening_decision_snapshot_id}',${j(randomUUID())}) where id=${q(closingSnapshot.id)}`, `update decision_snapshots set generated_text=${j(closingSnapshot.generated_text)} where id=${q(closingSnapshot.id)}`],
    ['missing raw close value', `update market_data_snapshots set value=null where trading_date=${q(valid.date)} and symbol='TAIEX'`, `update market_data_snapshots set value=1000 where trading_date=${q(valid.date)} and symbol='TAIEX'`],
    ['raw TXF stale', `update market_data_snapshots set captured_at=${q(valid.date + 'T13:30:00+08:00')} where trading_date=${q(valid.date)} and symbol='TXF' and phase='close'`, `update market_data_snapshots set captured_at=${q(valid.date + 'T13:45:00+08:00')} where trading_date=${q(valid.date)} and symbol='TXF' and phase='close'`],
    ['outcome wrong horizon', `update prediction_outcomes set horizon='1D' where prediction_id=${q(prediction.id)}`, `update prediction_outcomes set horizon='close' where prediction_id=${q(prediction.id)}`],
    ['outcome missing refs', `update prediction_outcomes set source_refs='[]' where prediction_id=${q(prediction.id)}`, `update prediction_outcomes set source_refs=${j(outcome.source_refs)} where prediction_id=${q(prediction.id)}`],
    ['outcome fake return', `update prediction_outcomes set return_percent=0 where prediction_id=${q(prediction.id)}`, `update prediction_outcomes set return_percent=${outcome.return_percent} where prediction_id=${q(prediction.id)}`],
    ['outcome malformed time ref', `update prediction_outcomes set source_refs=jsonb_set(source_refs,'{0,captured_at}','"not-a-time"') where prediction_id=${q(prediction.id)}`, `update prediction_outcomes set source_refs=${j(outcome.source_refs)} where prediction_id=${q(prediction.id)}`],
  ]) {
    sql(mutation); const result = capture(); assert.equal(result.verdict, 'FAIL', name); assert.equal(result.evidence.automatic_stable_day, false, name);
    sql(restoration); assert.equal(capture().verdict, 'PASS', name + ' restored');
  }
});

test('private current QA cannot override frozen market, while exact raw checkpoint/correlation/version remains mandatory', () => {
  assert.equal(capture().verdict, 'PASS');
  const original = reportRow(), changed = structuredClone(original.ai_strategy_json);
  changed.research_master_v2 = { quality: { evidence_coverage: 0, unsupported_claims: ['PRIVATE_QA_FAILED'] } };
  changed.market_report_gate = { eligible: false, reason_codes: ['PRIVATE_STOCK_QA'] };
  changed.data_quality = 'insufficient';
  sql(`update reports set today_quote='PRIVATE_DRAFT_NOT_PUBLISHED',ai_strategy_json=${j(changed)} where id=${q(published.report_id)};`);
  assert.equal(capture().verdict, 'PASS', 'only immutable published market document controls Acceptance');
  sql(`update reports set today_quote=${q(original.today_quote)},ai_strategy_json=${j(original.ai_strategy_json)} where id=${q(published.report_id)};`);
  const where = `trading_date=${q(valid.date)} and phase='intraday' and checkpoint='0930' and symbol='TAIEX'`;
  const raw = JSON.parse(sql(`select raw from market_data_snapshots where ${where};`));
  for (const [field, value] of [['correlation_id', randomUUID()], ['immutable_snapshot_version', 999999], ['immutable_checkpoint', 'RECOVERY']]) {
    sql(`update market_data_snapshots set raw=jsonb_set(raw,${q('{' + field + '}')},${j(value)}) where ${where};`);
    const result = capture(); assert.equal(result.verdict, 'FAIL', field);
    assert.ok(result.blocking_checks.includes('CHECKPOINT_0930_TAIEX_EVIDENCE_MISSING'));
    sql(`update market_data_snapshots set raw=${j(raw)} where ${where};`); assert.equal(capture().verdict, 'PASS', field + ' restored');
  }
});

test('scheduled label alone is not natural execution; exact scheduler receipt still cannot turn historical replay or Recovery into a stable day', () => {
  let result = capture(); assert.ok(result.evidence.automatic_blocking_checks.includes('AUTOMATION_PROVENANCE_UNVERIFIED'));
  const pipeline = randomUUID(), date = valid.date;
  // Isolated natural-provenance control: all committed research receipts, not
  // just the frozen opening, must have an explicitly scheduled producer.
  sql(`update pipeline_runs set provider_status=provider_status||'{"trigger":"scheduled"}'::jsonb
    where trading_date=${q(date)} and status='SUCCEEDED' and idempotency_key like 'research-input:%';
    insert into pipeline_runs(id,trading_date,checkpoint,idempotency_key,status,provider_status) values(${q(pipeline)},${q(date)},'PREMARKET',${q('isolated-scheduler-' + date)},'SUCCEEDED',${j({ decision_snapshot_id: published.decision_snapshot_id })});
    insert into runtime_http_dispatches(trading_date,job_name,checkpoint,endpoint,idempotency_key,dispatch_status,http_status,response_success,response_body,completed_at)
    values(${q(date)},'daily_delivery','daily_generate','isolated-no-http',${q('isolated-dispatch-' + date)},'SUCCEEDED',200,true,${j({ pipeline_run_id: pipeline, report_date: date, decision_snapshot_id: published.decision_snapshot_id })},${q(date + 'T07:30:00+08:00')});`);
  result = capture(); assert.equal(result.verdict, 'PASS'); assert.equal(result.evidence.manual_intervention, false);
  assert.equal(result.evidence.automatic_blocking_checks.includes('AUTOMATION_PROVENANCE_UNVERIFIED'), false);
  assert.equal(result.evidence.automatic_stable_day, false); assert.ok(result.evidence.automatic_blocking_checks.includes('HISTORICAL_REPLAY'));
  sql(`insert into ma_ops_recovery_actions(environment,action_type,target,idempotency_key,status,before_json)
    values('development','isolated-recovery-observation','isolated-no-handler',${q('isolated-recovery-' + date)},'succeeded',${j({ report_date: date, fixture: true })});`);
  result = capture(); assert.equal(result.evidence.manual_intervention, true); assert.equal(result.evidence.automatic_stable_day, false);
  assert.ok(result.evidence.automatic_blocking_checks.includes('MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'));
  assert.equal(historical(), historicalBefore);
});

test('original historical FAIL rows and private business-table permissions survive all isolated observations', () => {
  assert.equal(historical(), historicalBefore); assert.equal(accessMetadata(), accessBefore); assert.equal(triggerMetadata(), triggersBefore);
  for (const table of tables) for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_table_privilege(${q(role)},${q('public.' + table)},'SELECT');`), 'f');
});

test('actual company admission and audited research preserve a qualified stock through the same atomic SQL path', () => {
  // Explicit synthetic company-news input, using the existing producer's
  // admission and quality calculation. Never assign a passing coverage score.
  const f = fixture(), input = f.input, ai = input.legacy;
  const companyNews = input.evidenceIndex.find(row => row.evidence_id === 'NEWS001');
  companyNews.title = '2330 台積電營收更新';
  companyNews.summary = '台積電 2330 營收更新，半導體主線需再由市場同步確認。';
  companyNews.source = 'Company IR';
  input.candidateUniverse.candidates[0].related_evidence = [{ evidence_id: 'NEWS001' }, { evidence_id: 'SEC001' }];
  ai.today_beneficiary_stocks_v10 = [{
    symbol: '2330', name: '台積電', trigger_event: companyNews.title,
    entry_condition: '09:30 台積電與台股量價同步後再確認，不在事件前先追價。',
    transmission_logic: 'SOX 與台積電營收更新支持半導體主線，再由台灣先進製程及封裝量價反應驗證。',
    taiwan_supply_chain_link: '台積電提供半導體先進製程及先進封裝，依公司營收來源與台股量價驗證。',
    validation_signal: '09:30 台積電相對加權指數維持強勢，且半導體成交比重同步上升。',
    invalidation_condition: '台積電轉弱且半導體族群沒有同步，或公司後續更新否定營收條件。',
    data_basis: 'NEWS001; https://investor.tsmc.com/; market_data:SOX',
  }];
  const admission = admitResearchRecommendations(input);
  assert.equal(admission.accepted.length, 1); assert.deepEqual(admission.rejected, []);
  ai.today_beneficiary_stocks_v10 = admission.accepted;
  ai.today_beneficiary_stocks = admission.accepted;
  ai.v10_analysis_debug = { evidence_index: input.evidenceIndex };
  const research = assembleResearchMasterV2(input);
  research.quality = validateResearchMasterV2(research, input).quality;
  assert.equal(research.quality.evidence_coverage, 100);
  assert.deepEqual(research.quality.unsupported_claims, []);
  assert.equal(research.quality.coverage_audit.numerator, research.quality.coverage_audit.denominator);
  ai.stock_research = { schema_version: 'STOCK_RESEARCH_V1', report_date: f.date, document: research };
  ai.canonical_market_state = buildCanonicalMarketState(assembleCanonicalMarketResearch(input));
  ai.research_master_v2 = ai.canonical_market_state.document;
  const gate = evaluateMarketReportGate(ai, f.date);
  assert.equal(gate.eligible, true, JSON.stringify(gate));
  assert.equal(gate.decision_mode, 'recommendations'); assert.equal(gate.recommendation_gate.status, 'QUALIFIED');
  Object.assign(ai, { decision_mode: 'recommendations', recommendation_status: 'QUALIFIED', market_report_gate: gate });
  Object.assign(f.decision, { decision_mode: 'recommendations', content_score: gate.content_score, source_refs: canonicalMarketSourceRefs(ai) });
  Object.assign(f.decision.generated_text, { recommendations: admission.accepted, market_report_gate: gate, canonical_market_state: ai.canonical_market_state });
  Object.assign(f.contract, { decision_mode: 'recommendations', primary_symbols: ['2330'], market_report_gate: gate });
  Object.assign(f.member, { canonical_contract: f.contract, beneficiary_candidates: admission.accepted, representative_stocks: admission.accepted });
  assert.equal(validate(f).eligible, true);
  const beforeRejected = rowState();
  for (const mutate of [
    row => { row.report.ai_strategy_json.stock_research.document.quality.evidence_coverage = 99; },
    row => { row.report.ai_strategy_json.stock_research.document.quality.unsupported_claims = ['synthetic unsupported company claim']; },
    row => { row.decision.generated_text.recommendations = []; },
  ]) {
    const rejected = structuredClone(f); mutate(rejected);
    assert.equal(validate(rejected).eligible, false, 'Qualified path must retain its independent Evidence Gate');
  }
  assert.equal(rowState(), beforeRejected, 'Read-only private validation cannot mutate publication');
  const acquired = claim(f); assert.equal(acquired.status, 'ACQUIRED');
  const result = publish(f, acquired); assert.equal(result.success, true, JSON.stringify(result));
  const stored = JSON.parse(sql(`select row_to_json(s) from decision_snapshots s where id=${q(result.decision_snapshot_id)};`));
  assert.equal(stored.decision_mode, 'recommendations');
  // Compare the exact submitted JSON wire shape, not the VM fixture's Array
  // prototype against PostgreSQL JSON parsed in this Node realm.
  assert.deepEqual(stored.generated_text.recommendations, JSON.parse(JSON.stringify(admission.accepted)));
  assert.equal(stored.generated_text.recommendations[0].confidence, null, 'Missing stock confidence remains absent even for qualified evidence');
  const stable = rowState();
  const repeated = publish(f, acquired); assert.equal(repeated.decision_snapshot_id, result.decision_snapshot_id);
  assert.equal(rowState(), stable, 'Exact repeat cannot duplicate a qualified publication');
  assert.equal(historical(), historicalBefore); assert.equal(accessMetadata(), accessBefore);
});

test('concurrent calls to the final atomic publication RPC return one committed decision and member revision', async () => {
  const f = fixture(), acquired = claim(f);
  assert.equal(acquired.status, 'ACQUIRED');
  const readCounts = () => JSON.parse(sql(`select jsonb_build_object(
    'reports',(select count(*) from reports where report_date=${q(f.date)}),
    'snapshots',(select count(*) from decision_snapshots where report_date=${q(f.date)}),
    'members',(select count(*) from member_content_revisions where report_date=${q(f.date)}),
    'outbox',(select count(*) from line_delivery_outbox));`));
  const beforeParallel = readCounts();
  const statement = `set role service_role; select public.publish_research_bundle_v1(${q(acquired.run_id)},${q(f.correlation)},${j(f.report)},${j(f.decision)},${j(f.contract)},${j(f.member)},${j(f.semantic)});`;
  const concurrentCall = () => new Promise((resolve, reject) => {
    execFile(bin, args.concat(['-c', statement]), { encoding: 'utf8', timeout: 30000 }, (error, stdout, stderr) => {
      if (error) { reject(new Error('ISOLATED_PARALLEL_SQL_FAILED: ' + stderr)); return; }
      try { resolve(JSON.parse(stdout.trim().replace(/^SET\n/, ''))); } catch (parseError) { reject(parseError); }
    });
  });
  // Two independent PostgreSQL client processes, not Promise-wrapped sync SQL.
  const [left, right] = await Promise.all([concurrentCall(), concurrentCall()]);
  for (const result of [left, right]) assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(left.decision_snapshot_id, right.decision_snapshot_id);
  assert.equal(left.member_content_revision_id, right.member_content_revision_id);
  const afterParallel = readCounts();
  assert.equal(afterParallel.reports, beforeParallel.reports);
  assert.equal(afterParallel.snapshots, beforeParallel.snapshots + 1);
  assert.equal(afterParallel.members, beforeParallel.members + 1);
  assert.equal(afterParallel.outbox, beforeParallel.outbox, 'Publication cannot dispatch LINE');
  const settled = rowState();
  assert.equal(publish(f, acquired).decision_snapshot_id, left.decision_snapshot_id);
  assert.equal(rowState(), settled, 'A later retry also preserves the exact persisted result');
  assert.equal(historical(), historicalBefore); assert.equal(accessMetadata(), accessBefore);
});

// Separately approved sixth existing RPC. These append-only cases retain the
// original fifteen callbacks and run only after a real isolated publication.
let terminalContext;
const terminalRows = () => sql(`select jsonb_build_object(${[
  'reports', 'decision_snapshots', 'member_content_revisions', 'semantic_coherence_reviews', 'editorial_reviews',
  'pipeline_runs', 'runtime_http_dispatches', 'runtime_http_dispatch_attempts', 'runtime_dead_letters',
  'trading_day_state', 'production_acceptance_results', 'line_delivery_outbox', 'learning_predictions', 'prediction_outcomes',
].map(table => `${q(table)},(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.${table} r)`).join(',')});`);
const reconcile = (date = terminalContext.f.date, correlation = randomUUID()) => Number(sql(
  `set role service_role; select public.reconcile_runtime_terminal_failures_v1(${q(date)},${q(correlation)});`).replace(/^SET\n/, ''));
const terminalRow = (table, id) => JSON.parse(sql(`select row_to_json(r) from public.${table} r where id=${q(id)};`));

test('sixth terminal RPC preserves its exact original private catalog contract across both candidate applications', () => {
  const current = functionMetadata(terminalSignature);
  assert.deepEqual(current, terminalOnce, 'Second application must not alter the sixth function');
  const { definition: oldBody, ...oldContract } = terminalBefore;
  const { definition: newBody, ...newContract } = current;
  assert.notEqual(newBody, oldBody, 'The reviewed terminal predicate must actually be replaced');
  assert.deepEqual(newContract, oldContract, 'No signature/default/owner/ACL/security/search_path change');
  assert.equal(current.arguments, 'p_business_date date, p_correlation_id uuid');
  assert.equal(current.result, 'integer'); assert.equal(current.definer, true); assert.equal(current.owner, 'postgres');
  assert.deepEqual(current.config, ['search_path=""']);
  assert.equal(current.acl, '{postgres=X/postgres,service_role=X/postgres}');
  assert.equal(current.anon, false); assert.equal(current.auth, false); assert.equal(current.service, true);
  assert.equal(sql(`select count(*) from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid='public.${terminalSignature}'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE';`), '0');
  for (const role of ['anon', 'authenticated']) assert.throws(() => sql(`set role ${role};
    select public.reconcile_runtime_terminal_failures_v1('2026-07-14',${q(randomUUID())});`), /permission denied for function/);
  assert.equal(triggerMetadata(), triggersBefore); assert.equal(accessMetadata(), accessBefore); assert.equal(historical(), historicalBefore);
});

test('a real committed market-only publication returns terminal zero without inventing delivery, lifecycle or Acceptance', () => {
  const f = fixture(), lease = claim(f); assert.equal(lease.status, 'ACQUIRED');
  const receipt = publish(f, lease); assert.equal(receipt.success, true);
  // Explicit historical time fixture, as in the original Acceptance cases:
  // identities and success rows come from the real atomic RPC, not JSON seeds.
  sql(`update decision_snapshots set valid_from=${q(f.date + 'T11:00:00+08:00')},created_at=${q(f.date + 'T11:00:00+08:00')} where id=${q(receipt.decision_snapshot_id)};
    update member_content_revisions set generated_at=${q(f.date + 'T11:00:00+08:00')} where id=${q(receipt.member_content_revision_id)};
    update editorial_reviews set reviewed_at=${q(f.date + 'T11:01:00+08:00')} where decision_snapshot_id=${q(receipt.decision_snapshot_id)};
    update semantic_coherence_reviews set checked_at=${q(f.date + 'T11:01:30+08:00')} where member_content_revision_id=${q(receipt.member_content_revision_id)};
    update pipeline_runs set completed_at=${q(f.date + 'T11:02:00+08:00')} where id=${q(lease.run_id)};`);
  terminalContext = { f, lease, receipt };
  const stored = snapshotRow(receipt.decision_snapshot_id), persistedRun = terminalRow('pipeline_runs', lease.run_id);
  assert.equal(stored.status, 'READY'); assert.equal(stored.decision_mode, 'market_only');
  assert.equal(stored.generated_text.canonical_market_state.status, 'READY');
  assert.equal(persistedRun.status, 'SUCCEEDED'); assert.equal(persistedRun.provider_status.result.success, true);
  assert.equal(persistedRun.provider_status.result.decision_snapshot_id, stored.id);
  assert.equal(reportRow().ai_strategy_json.market_publication_contract.publication_run_id, lease.run_id);
  const stable = terminalRows();
  assert.equal(reconcile(), 0); assert.equal(reconcile(), 0);
  assert.equal(terminalRows(), stable, 'Zero repairs cannot create or mutate any business receipt');
  assert.equal(historical(), historicalBefore);
});

test('terminal publication proof rejects missing or wrong durable identities, semantic rows and frozen evidence atomically', () => {
  const { f, lease, receipt } = terminalContext, rid = q(receipt.report_id), sid = q(receipt.decision_snapshot_id), mid = q(receipt.member_content_revision_id);
  const reportJson = (path, value) => `update reports set ai_strategy_json=jsonb_set(ai_strategy_json,${q('{' + path + '}')},${j(value)}) where id=${rid};`;
  const runJson = (path, value) => `update pipeline_runs set provider_status=jsonb_set(provider_status,${q('{' + path + '}')},${j(value)}) where id=${q(lease.run_id)};`;
  const snapshotJson = (path, value) => `update decision_snapshots set generated_text=jsonb_set(generated_text,${q('{' + path + '}')},${j(value)}) where id=${sid};`;
  const forgedCanonicalId = randomUUID();
  const coMutatedCanonical = `update member_content_revisions set canonical_contract=jsonb_set(canonical_contract,'{snapshot_id}',${j(forgedCanonicalId)}),
    member_content=jsonb_set(member_content,'{canonical_contract,snapshot_id}',${j(forgedCanonicalId)}) where id=${mid};
    ${reportJson('canonical_contract,snapshot_id', forgedCanonicalId)}`;
  const stable = terminalRows(); assert.equal(reconcile(), 0);
  for (const [label, mutation] of [
    ['missing CORE pointer', `update reports set ai_strategy_json=ai_strategy_json-'market_publication_contract' where id=${rid};`],
    ['wrong CORE schema', reportJson('market_publication_contract,schema_version', 'UNKNOWN')],
    ['unpublished CORE', reportJson('market_publication_contract,status', 'READY')],
    ['wrong CORE date', reportJson('market_publication_contract,report_date', '2026-07-13')],
    ['wrong report revision', reportJson('revision_id', randomUUID())],
    ['wrong CORE revision', reportJson('market_publication_contract,revision_id', randomUUID())],
    ['wrong bound member', reportJson('canonical_member_revision_id', randomUUID())],
    ['missing actual run', reportJson('market_publication_contract,publication_run_id', randomUUID())],
    ['non-successful run', `update pipeline_runs set status='FAILED' where id=${q(lease.run_id)};`],
    ['missing completed time', `update pipeline_runs set completed_at=null where id=${q(lease.run_id)};`],
    ['future completed time', `update pipeline_runs set completed_at=clock_timestamp()+interval '1 hour' where id=${q(lease.run_id)};`],
    ['wrong run business date', `update pipeline_runs set trading_date='2026-07-13' where id=${q(lease.run_id)};`],
    ['non-atomic receipt', `update pipeline_runs set idempotency_key=${q('isolated-unbound-' + randomUUID())} where id=${q(lease.run_id)};`],
    ['false result', runJson('result,success', false)],
    ['wrong result report', runJson('result,report_id', randomUUID())],
    ['wrong result date', runJson('result,report_date', '2026-07-13')],
    ['wrong result revision', runJson('result,decision_snapshot_id', randomUUID())],
    ['wrong result member', runJson('result,member_content_revision_id', randomUUID())],
    ['wrong result semantic', runJson('result,semantic_status', 'BLOCKED')],
    ['partial committed snapshot', `update decision_snapshots set status='PARTIAL' where id=${sid};`],
    ['missing exact member row', `update member_content_revisions set decision_snapshot_id=${q(published.decision_snapshot_id)} where id=${mid};`],
    ['member version mismatch', `update member_content_revisions set decision_snapshot_version=99999 where id=${mid};`],
    ['member canonical identity mismatch', `update member_content_revisions set canonical_contract=jsonb_set(canonical_contract,'{snapshot_id}',${j(randomUUID())}) where id=${mid};`],
    ['co-mutated canonical JSON cannot replace actual row identity', coMutatedCanonical],
    ['co-mutated canonical version cannot replace actual row version', `update member_content_revisions set canonical_contract=jsonb_set(canonical_contract,'{snapshot_version}','99999'),
      member_content=jsonb_set(member_content,'{canonical_contract,snapshot_version}','99999') where id=${mid}; ${reportJson('canonical_contract,snapshot_version', 99999)}`],
    ['member canonical text mismatch', `update member_content_revisions set member_content=jsonb_set(member_content,'{today_core_thesis}','"UNPUBLISHED_PRIVATE_THESIS"') where id=${mid};`],
    ['member summary mismatch', `update member_content_revisions set member_content=jsonb_set(member_content,'{line_summary}','"UNPUBLISHED_PRIVATE_SUMMARY"') where id=${mid};`],
    ['member canonical content mismatch', `update member_content_revisions set member_content=jsonb_set(member_content,'{canonical_contract,snapshot_id}',${j(randomUUID())}) where id=${mid};`],
    ['missing exact semantic row', `update semantic_coherence_reviews set decision_snapshot_id=${q(published.decision_snapshot_id)} where member_content_revision_id=${mid};`],
    ['blocked semantic', `update semantic_coherence_reviews set status='BLOCKED' where member_content_revision_id=${mid};`],
    ['semantic false result', `update semantic_coherence_reviews set result=jsonb_set(result,'{eligible}','false') where member_content_revision_id=${mid};`],
    ['semantic version mismatch', `update semantic_coherence_reviews set canonical_snapshot_version=99999 where member_content_revision_id=${mid};`],
    ['semantic reasons', `update semantic_coherence_reviews set reason_codes=array['ISOLATED_CONFLICT'] where member_content_revision_id=${mid};`],
    ['semantic conflicting fields', `update semantic_coherence_reviews set conflicting_fields=array['today_core_thesis'] where member_content_revision_id=${mid};`],
    ['semantic after atomic receipt', `update semantic_coherence_reviews set checked_at=${q(f.date + 'T11:03:00+08:00')} where member_content_revision_id=${mid};`],
    ['rejected editorial', `update editorial_reviews set review_status='REJECTED' where decision_snapshot_id=${sid};`],
    ['editorial below retained threshold', `update editorial_reviews set content_score=89 where decision_snapshot_id=${sid};`],
    ['missing frozen CMS', `update decision_snapshots set generated_text=generated_text-'canonical_market_state' where id=${sid};`],
    ['missing frozen data quality', `update decision_snapshots set generated_text=generated_text-'data_quality' where id=${sid};`],
    ['insufficient frozen data quality', snapshotJson('data_quality', 'insufficient')],
    ['missing frozen missing-sources measurement', `update decision_snapshots set generated_text=generated_text-'missing_sources' where id=${sid};`],
    ['nonempty frozen missing sources', snapshotJson('missing_sources', ['TAIEX'])],
    ['missing source refs', `update decision_snapshots set source_refs='[]' where id=${sid};`],
    ['unsupported frozen claim', snapshotJson('canonical_market_state,document,quality,unsupported_claims', ['UNSUPPORTED_FROZEN_MARKET'])],
    ['frozen evidence 99', snapshotJson('canonical_market_state,document,quality,evidence_coverage', 99)],
    ['foreign evidence IDs', snapshotJson('canonical_market_state,evidence_ids', ['FOREIGN_ID'])],
    ['unknown frozen freshness', snapshotJson('canonical_market_state,document,quality,coverage_audit,claims,0,sources,0,freshness', 'unknown')],
    ['market-only stock leak', snapshotJson('recommendations', [{ symbol: '2330' }])],
  ]) {
    // Every corruption is transaction-scoped. Failed RPC or explicit rollback
    // restores the real prior publication; no failed artifact is rewritten.
    assert.throws(() => sql(`begin; ${mutation} set local role service_role;
      select public.reconcile_runtime_terminal_failures_v1(${q(f.date)},${q(randomUUID())}); rollback;`),
    /TERMINAL_RECONCILIATION_BLOCKED|CORE_MARKET_PUBLICATION_GATE_BLOCKED/, label);
    assert.equal(terminalRows(), stable, label + ': failure must be atomic');
  }
  assert.throws(() => reconcile('2026-07-13'), /TERMINAL_RECONCILIATION_BLOCKED/);
  assert.equal(reconcile(), 0); assert.equal(terminalRows(), stable);
});

test('receipt-bound member diagnostic scores and status do not become a second market publication gate', () => {
  const { f, receipt } = terminalContext, stable = terminalRows();
  // The immutable decision market evidence/editorial, canonical member text,
  // exact semantic row and successful atomic receipt remain untouched.
  for (const [label, change] of [
    ['private status', "status='BLOCKED'"],
    ['private content score', 'content_score=76'],
    ['private evidence score', 'evidence_coverage=76'],
    ['all private diagnostics', "status='BLOCKED',content_score=76,evidence_coverage=76"],
  ]) {
    const result = sql(`begin; update member_content_revisions set ${change} where id=${q(receipt.member_content_revision_id)};
      set local role service_role; select public.reconcile_runtime_terminal_failures_v1(${q(f.date)},${q(randomUUID())}); rollback;`);
    assert.deepEqual(result.split('\n').filter(line => /^\d+$/.test(line)), ['0'], label);
    assert.equal(terminalRows(), stable, label + ': only the test transaction was changed');
  }
});

test('new current private QA cannot replace a committed market-only terminal authority', () => {
  const { f, receipt } = terminalContext, original = reportRow();
  const qa = { ...f.decision, decision_mode: 'blocked', content_score: 76, content_grade: 'reject',
    input_fingerprint: randomUUID(), generated_text: { daily_sentence: 'ISOLATED_UNPUBLISHED_QA', recommendations: [] } };
  const qaId = sql(`set role service_role; select public.publish_decision_snapshot_v2(${q(f.date)},'PREMARKET',${q(receipt.report_id)},${j(qa)});`).replace(/^SET\n/, '');
  assert.notEqual(qaId, receipt.decision_snapshot_id); assert.equal(snapshotRow(qaId).is_current, true);
  assert.equal(snapshotRow(qaId).status, 'INSUFFICIENT_DATA'); assert.equal(snapshotRow(receipt.decision_snapshot_id).is_current, false);
  const changed = structuredClone(original.ai_strategy_json);
  Object.assign(changed, { data_quality: 'insufficient', content_score: 0, member_value_score: 0,
    market_report_gate: { eligible: false, reason_codes: ['PRIVATE_QA_REJECTED'] },
    canonical_market_state: { status: 'PARTIAL', reason_codes: ['PRIVATE_QA_REJECTED'] },
    stock_research: { document: { quality: { evidence_coverage: 76, unsupported_claims: ['PRIVATE_STOCK_QA'] } } } });
  sql(`update reports set ai_strategy_json=${j(changed)},today_quote='ISOLATED_PRIVATE_DRAFT' where id=${q(receipt.report_id)};`);
  try {
    const stable = terminalRows(); assert.equal(reconcile(), 0); assert.equal(terminalRows(), stable);
    assert.equal(reportRow().ai_strategy_json.market_publication_contract.revision_id, receipt.decision_snapshot_id);
    assert.equal(reportRow().ai_strategy_json.canonical_member_revision_id, receipt.member_content_revision_id);
  } finally { sql(`update reports set ai_strategy_json=${j(original.ai_strategy_json)},today_quote=${q(original.today_quote)} where id=${q(receipt.report_id)};`); }
  assert.equal(reconcile(), 0, 'A newer current QA snapshot remains diagnostic after raw report fields are restored');
});

test('Acceptance independently rejects frozen quality and co-mutated opening canonical identities', () => {
  assert.equal(capture().verdict, 'PASS', 'The actual frozen-opening and current-commitment control must pass first');
  const sid = q(published.decision_snapshot_id), mid = q(published.member_content_revision_id), stable = terminalRows();
  for (const [label, mutation, expectedReason] of [
    ['missing frozen quality', `update decision_snapshots set generated_text=generated_text-'data_quality' where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['insufficient frozen quality', `update decision_snapshots set generated_text=jsonb_set(generated_text,'{data_quality}','"insufficient"') where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['missing frozen source measurement', `update decision_snapshots set generated_text=generated_text-'missing_sources' where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['missing actual frozen source', `update decision_snapshots set generated_text=jsonb_set(generated_text,'{missing_sources}','["TAIEX"]') where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['missing immutable source tuples', `update decision_snapshots set source_refs='[]' where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['foreign frozen evidence IDs', `update decision_snapshots set generated_text=jsonb_set(generated_text,'{canonical_market_state,evidence_ids}','["FOREIGN_ID"]') where id=${sid};`, 'CORE_MARKET_PUBLICATION_UNVERIFIED'],
    ['co-mutated opening canonical ID', `update member_content_revisions set canonical_contract=jsonb_set(canonical_contract,'{snapshot_id}',${j(terminalContext.receipt.decision_snapshot_id)}),
      member_content=jsonb_set(member_content,'{canonical_contract,snapshot_id}',${j(terminalContext.receipt.decision_snapshot_id)}) where id=${mid};`, 'PREMIUM_SEMANTIC_NOT_PASSED'],
    ['co-mutated opening canonical version', `update member_content_revisions set canonical_contract=jsonb_set(canonical_contract,'{snapshot_version}','99999'),
      member_content=jsonb_set(member_content,'{canonical_contract,snapshot_version}','99999') where id=${mid};`, 'PREMIUM_SEMANTIC_NOT_PASSED'],
  ]) {
    const output = sql(`begin; ${mutation} set local role service_role;
      create temp table isolated_acceptance_observation as select public.capture_morning_alpha_acceptance_v1(${q(valid.date)},'ISOLATED_TERMINAL_FROZEN_NEGATIVE') as id;
      select row_to_json(a) from public.production_acceptance_results a join isolated_acceptance_observation i on a.id=i.id; rollback;`);
    const result = JSON.parse(output.split('\n').find(line => line.startsWith('{')) || 'null');
    assert.ok(result, label + ': actual capture result required'); assert.equal(result.verdict, 'FAIL', label);
    assert.ok(result.blocking_checks.includes(expectedReason), label + ': ' + JSON.stringify(result.blocking_checks));
    assert.equal(result.evidence.automatic_stable_day, false, label);
    assert.equal(terminalRows(), stable, 'The observation transaction cannot change old evidence: ' + label);
  }
  assert.equal(historical(), historicalBefore);
});

function terminalPair(mutate = () => {}, failedStatus = 'FAILED') {
  const { f, receipt } = terminalContext, key = randomUUID();
  const failure = { id: randomUUID(), trading_date: f.date, job_name: 'isolated-terminal-' + key,
    checkpoint: 'closing_health', endpoint: 'isolated-no-http', correlation_id: randomUUID(), idempotency_key: 'failure-' + key,
    dispatch_status: failedStatus, http_status: 409, response_success: false, response_error_code: 'ISOLATED_ORIGINAL_FAILURE',
    response_body: { success: false, error_code: 'ISOLATED_ORIGINAL_FAILURE', original_marker: key },
    request_body: { fixture: true, original_request: key }, completed_at: f.date + 'T14:45:00+08:00', next_retry_at: f.date + 'T14:50:00+08:00' };
  const success = { ...failure, id: randomUUID(), idempotency_key: 'success-' + key, dispatch_status: 'SUCCEEDED',
    http_status: 200, response_success: true, response_error_code: null, next_retry_at: null,
    completed_at: f.date + 'T15:00:00+08:00', response_body: { success: true, report_date: f.date, decision_snapshot_id: receipt.decision_snapshot_id } };
  mutate(success, failure);
  for (const row of [failure, success]) {
    const columns = Object.keys(row), values = columns.map(column => row[column] === null ? 'null'
      : typeof row[column] === 'object' ? j(row[column]) : q(row[column]));
    sql(`insert into runtime_http_dispatches(${columns.join(',')}) values(${values.join(',')});`);
  }
  const attemptId = randomUUID(), deadId = randomUUID();
  sql(`insert into runtime_http_dispatch_attempts(id,dispatch_id,attempt,http_status,response_error_code,response_body,completed_at)
    values(${q(attemptId)},${q(failure.id)},1,409,'ISOLATED_ORIGINAL_FAILURE',${j(failure.response_body)},${q(failure.completed_at)});
    insert into runtime_dead_letters(id,component,operation,idempotency_key,correlation_id,attempt,max_attempts,error_code,request_payload,context)
    values(${q(deadId)},'runtime_http_dispatch',${q(failure.job_name)},${q('dead-' + key)},${q(failure.correlation_id)},1,3,
      'ISOLATED_ORIGINAL_FAILURE',${j(failure.request_body)},${j({ dispatch_id: failure.id, trading_date: f.date, original_marker: key })});`);
  return { failure: terminalRow('runtime_http_dispatches', failure.id), success: terminalRow('runtime_http_dispatches', success.id),
    attempt: terminalRow('runtime_http_dispatch_attempts', attemptId), dead: terminalRow('runtime_dead_letters', deadId) };
}
function assertTerminalRepair(pair, correlation) {
  const after = terminalRow('runtime_http_dispatches', pair.failure.id), evidence = after.response_body.terminal_reconciliation;
  const { dispatch_status: oldStatus, next_retry_at: oldRetry, updated_at: oldUpdated, response_body: oldBody, ...oldFields } = pair.failure;
  const { dispatch_status: newStatus, next_retry_at: newRetry, updated_at: newUpdated, response_body: newBody, ...newFields } = after;
  assert.deepEqual(newFields, oldFields, 'Original HTTP status/error/time/request and all other failure fields are retained');
  assert.equal(newStatus, 'SKIPPED'); assert.equal(newRetry, null); assert.ok(newUpdated);
  assert.deepEqual({ ...newBody, terminal_reconciliation: undefined }, { ...oldBody, terminal_reconciliation: undefined });
  assert.equal(evidence.reason, 'SAME_JOB_DURABLE_SUCCESS'); assert.equal(evidence.success_dispatch_id, pair.success.id);
  assert.equal(evidence.decision_snapshot_id, terminalContext.receipt.decision_snapshot_id);
  assert.equal(evidence.correlation_id, correlation); assert.equal(evidence.original_http_status, pair.failure.http_status);
  assert.equal(evidence.original_error_code, pair.failure.response_error_code);
  assert.equal(Date.parse(evidence.original_completed_at), Date.parse(pair.failure.completed_at));
  assert.ok(Number.isFinite(Date.parse(evidence.reconciled_at)));
  assert.deepEqual(terminalRow('runtime_http_dispatches', pair.success.id), pair.success);
  assert.deepEqual(terminalRow('runtime_http_dispatch_attempts', pair.attempt.id), pair.attempt, 'Original attempt evidence is immutable');
  const dead = terminalRow('runtime_dead_letters', pair.dead.id);
  const { status: ignoredOldStatus, resolved_at: ignoredOldTime, context: oldContext, ...oldDead } = pair.dead;
  const { status: ignoredNewStatus, resolved_at: ignoredNewTime, context: newContext, ...newDead } = dead;
  assert.deepEqual(newDead, oldDead); assert.equal(dead.status, 'resolved'); assert.ok(dead.resolved_at);
  assert.deepEqual(newContext, { ...oldContext, terminal_reconciliation: evidence });
}

test('terminal replacement retains exact same-job/checkpoint/endpoint/later-success rules and original failed attempts', () => {
  for (const [label, mutate] of [
    ['other date', row => { row.trading_date = '2026-07-13'; }],
    ['other job', row => { row.job_name += '-other'; }],
    ['other checkpoint', row => { row.checkpoint = 'continuous_learning'; }],
    ['other endpoint', row => { row.endpoint += '-other'; }],
    ['not successful dispatch', row => { row.dispatch_status = 'FAILED'; }],
    ['false business success', row => { row.response_success = false; }],
    ['non-success HTTP', row => { row.http_status = 409; }],
    ['missing completion', row => { row.completed_at = null; }],
    ['earlier success', row => { row.completed_at = terminalContext.f.date + 'T14:44:00+08:00'; }],
    ['same-time success', (row, failure) => { row.completed_at = failure.completed_at; }],
    ['wrong response date', row => { row.response_body.report_date = '2026-07-13'; }],
    ['wrong response revision', row => { row.response_body.decision_snapshot_id = randomUUID(); }],
    ['missing response revision', row => { delete row.response_body.decision_snapshot_id; }],
  ]) {
    terminalPair(mutate); const stable = terminalRows();
    assert.equal(reconcile(), 0, label); assert.equal(terminalRows(), stable, label + ': no unrelated failure may be rewritten');
  }
  for (const status of ['FAILED', 'TIMED_OUT', 'DEAD_LETTERED']) {
    const pair = terminalPair(() => {}, status), correlation = randomUUID();
    assert.equal(reconcile(undefined, correlation), 1); assertTerminalRepair(pair, correlation);
    const stable = terminalRows(); assert.equal(reconcile(), 0); assert.equal(terminalRows(), stable, 'Exact retry cannot rewrite evidence');
  }
  assert.equal(historical(), historicalBefore); assert.equal(accessMetadata(), accessBefore);
});

test('terminal repair rolls back if durable dead-letter persistence fails after dispatch reconciliation', () => {
  const pair = terminalPair(), stable = terminalRows();
  sql(`create function public.isolated_terminal_failure() returns trigger language plpgsql as $$ begin
    if new.id=${q(pair.dead.id)}::uuid then raise exception 'ISOLATED_TERMINAL_PERSISTENCE_FAILURE'; end if; return new; end $$;
    create trigger isolated_terminal_failure before update on public.runtime_dead_letters for each row execute function public.isolated_terminal_failure();`);
  try { assert.throws(() => reconcile(), /ISOLATED_TERMINAL_PERSISTENCE_FAILURE/); assert.equal(terminalRows(), stable, 'No partial SKIPPED dispatch may survive a later persistence failure'); }
  finally { sql('drop trigger isolated_terminal_failure on public.runtime_dead_letters; drop function public.isolated_terminal_failure();'); }
  const correlation = randomUUID(); assert.equal(reconcile(undefined, correlation), 1); assertTerminalRepair(pair, correlation);
  assert.equal(triggerMetadata(), triggersBefore); assert.equal(historical(), historicalBefore);
});

test('concurrent terminal calls repair once without duplicate dispatch or artificial natural stability', async () => {
  const pair = terminalPair(), correlations = [randomUUID(), randomUUID()];
  const countRows = () => sql("select jsonb_build_object('dispatches',(select count(*) from runtime_http_dispatches),'attempts',(select count(*) from runtime_http_dispatch_attempts),'dead_letters',(select count(*) from runtime_dead_letters),'acceptance',(select count(*) from production_acceptance_results),'line',(select count(*) from line_delivery_outbox));");
  const counts = countRows(), day = sql('select jsonb_agg(to_jsonb(s)) from trading_day_state s;');
  const call = correlation => new Promise((resolve, reject) => {
    const statement = `set role service_role; select public.reconcile_runtime_terminal_failures_v1(${q(terminalContext.f.date)},${q(correlation)});`;
    execFile(bin, args.concat(['-c', statement]), { encoding: 'utf8', timeout: 30000 }, (error, stdout, stderr) => {
      if (error) { reject(new Error('ISOLATED_PARALLEL_TERMINAL_FAILED: ' + stderr)); return; }
      resolve(Number(stdout.trim().replace(/^SET\n/, '')));
    });
  });
  const results = await Promise.all(correlations.map(call));
  assert.deepEqual([...results].sort(), [0, 1]);
  assertTerminalRepair(pair, correlations[results.indexOf(1)]);
  assert.equal(countRows(), counts); assert.equal(sql('select jsonb_agg(to_jsonb(s)) from trading_day_state s;'), day);
  const stable = terminalRows(); assert.equal(reconcile(), 0); assert.equal(terminalRows(), stable);
  assert.equal(sql("select count(*) from production_acceptance_results where evidence->'automatic_stable_day'='true'::jsonb;"), '0');
  assert.equal(historical(), historicalBefore); assert.equal(accessMetadata(), accessBefore); assert.equal(triggerMetadata(), triggersBefore);
});
