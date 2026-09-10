// Pure source/config/provider preparation checks. No runtime, login, SQL or E2E execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { REPLAY_FUNCTIONS, REPLAY_SCOPE_CONTRACTS, validateReplayConfiguration,
  replaySqlFunctionNames } from './helpers/coreConsolidationPublicExportRuntime.mjs';
import { resolveConsolidationVendorResponse } from './helpers/coreConsolidationVendorShapes.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const scope='ma-consolidation-v1-20260909183000',digest='a'.repeat(64),boot='2879f43f-0819-4a08-88dc-195166474350';
const environment={MA_LOCAL_SCOPE:scope,MA_CONSOLIDATION_REPLAY:'LOCAL_ONLY'};
const oldConfig=isolatedFunction(read('tests/coreConsolidationReplayPreparation.test.mjs'),'config',{scope,digest,boot,REPLAY_FUNCTIONS});
function config(){
  const value=structuredClone(oldConfig());
  value.clock.configuration={...value.clock.configuration,root:'/private/tmp/ma-clock-20260909-183000',
    limaHome:'/private/tmp/ma-clock-20260909-183000/lima',configPath:'/private/tmp/ma-clock-20260909-183000/clock.yaml',
    bootId:'12345678-1234-4234-9234-123456789abc'};
  value.docker.guest_boot_id=value.clock.configuration.bootId;
  Object.assign(value,{schema_version:'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V3',report_date:'2026-09-23',warmup_date:'2026-09-22',
    api_origin:'http://127.0.0.1:55491',attempt:1,previous_attempt_results:[],external_content_os_delivery:false,
    gateway_verification:Object.fromEntries([...REPLAY_FUNCTIONS,'local-core-consolidation-boundary'].map(slug=>[slug,true])),
    auth_fixture:{provenance:'GENERATED_IN_THIS_ISOLATED_STACK',new_synthetic_users:1,existing_scope_credentials_read:false,admin_role_fixtures:false}});
  value.sql_functions.push({name:'reconcile_runtime_terminal_failures_v1',definition_md5:'b'.repeat(32)});
  return value;
}

test('the independent 13-handler plan accepts only the exact fresh scope, all JWT true and one newly generated synthetic identity',()=>{
  const value=config();assert.equal(validateReplayConfiguration(value,environment),value);
  assert.equal(REPLAY_FUNCTIONS.length,13);assert.equal(new Set(REPLAY_FUNCTIONS).size,13);
  assert.equal(REPLAY_FUNCTIONS.at(-1),'content-os-morning-alpha-source');
  assert.deepEqual(Object.keys(REPLAY_SCOPE_CONTRACTS),[scope]);assert.equal(replaySqlFunctionNames(value).length,7);
});
for(const[name,mutate]of[
  ['old successful scope',v=>v.scope='ma-consolidation-v1-20260909170000'],
  ['arbitrary new scope',v=>v.scope='ma-consolidation-v1-20260909999999'],
  ['old API origin',v=>v.api_origin='http://127.0.0.1:55481'],
  ['external origin',v=>v.api_origin='https://production.example.invalid'],
  ['old result adoption',v=>v.previous_attempt_results=[{path:'/private/tmp/old/result.json',sha256:digest}]],
  ['attempt reuse',v=>v.attempt=2],
  ['missing explicit attempt',v=>delete v.attempt],
  ['old warmup date',v=>v.warmup_date='2026-09-21'],
  ['old report date',v=>v.report_date='2026-09-21'],
  ['old shared VM',v=>v.clock.configuration.root='/private/tmp/ma-clock-20260909-020052'],
  ['old VM boot identity',v=>{v.clock.configuration.bootId=boot;v.docker.guest_boot_id=boot;}],
  ['missing export handler',v=>v.functions.pop()],
  ['duplicate export handler',v=>v.functions.push(v.functions.at(-1))],
  ['public payload JWT exception',v=>v.gateway_verification['get-report-payload']=false],
  ['export JWT exception',v=>v.gateway_verification['content-os-morning-alpha-source']=false],
  ['boundary JWT exception',v=>v.gateway_verification['local-core-consolidation-boundary']=false],
  ['missing gateway proof',v=>delete v.gateway_verification],
  ['unknown public function',v=>v.gateway_verification['other-function']=false],
  ['copied old credentials',v=>v.auth_fixture.existing_scope_credentials_read=true],
  ['old credential path',v=>v.credentials_file='/private/tmp/ma-consolidation-v1-20260909170000/local-credentials.json'],
  ['multiple role identities',v=>v.auth_fixture.new_synthetic_users=3],
  ['admin role fixtures',v=>v.auth_fixture.admin_role_fixtures=true],
  ['foreign identity provenance',v=>v.auth_fixture.provenance='COPIED_FROM_OLD_SCOPE'],
  ['external consumer delivery claim',v=>v.external_content_os_delivery=true],
  ['provider egress',v=>v.boundary.egress_default_deny=false],
  ['business clock rewrite',v=>v.functions[0].business_clock_override=true],
  ['unknown SQL authoring',v=>v.sql_functions[0].name='unapproved_function'],
  ['missing terminal validator',v=>v.sql_functions.pop()],
])test('fresh public-export preparation rejects '+name,()=>{
  assert.doesNotThrow(()=>validateReplayConfiguration(config(),environment));const value=config();mutate(value);
  assert.throws(()=>validateReplayConfiguration(value,environment));
});

test('the three sealed 12-handler predecessors remain byte-identical',()=>{
  for(const[path,pin]of[
    ['tests/integration/coreConsolidationFullChain.e2e.mjs','b100f04377ab1d3da8f430dde3deb5ca0063ba07ea94fc09ea7722e9f135fa7c'],
    ['tests/helpers/coreConsolidationReplayRuntime.mjs','973000439d48b9341aa246d90aaa00198b70cf535889f715a5b586d4c60aa178'],
    ['tests/integration/coreConsolidationPrepareLocal.mjs','a754b1dde917ace6f413aee6378a5073bd9a048fcb53cbe2fed4faad32fd1e7e'],
  ])assert.equal(hash(read(path)),pin,path);
});
function declaration(source,name){const file=ts.createSourceFile('test.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const matches=file.statements.filter(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name);assert.equal(matches.length,1);return matches[0].getText(file);}
test('the strict clock, credentials, actual SQL readback, raw lineage and network validators are unchanged predecessor declarations',()=>{
  const before=read('tests/helpers/coreConsolidationReplayRuntime.mjs'),after=read('tests/helpers/coreConsolidationPublicExportRuntime.mjs');
  for(const name of ['canonicalNumeric','checkPinnedReplayInputs','readNewLocalCredentials','guardedLocalFetch',
    'createGuestReadback','assertClockAgreement','createReplayClock','assertCheckpointLineage'])assert.equal(declaration(after,name),declaration(before,name),name);
});
test('new driver retains the actual whole-chain gates and adds GET export without citation or incident seeds',()=>{
  const source=read('tests/integration/coreConsolidationPublicExportFullChain.e2e.mjs');
  for(const text of ["assert.equal(supplied.schema_version, 'CORE_CONSOLIDATION_FULL_CHAIN_CONFIG_V3')",
    "Fresh scenario required; no resume onto seeded/old business rows:","assert.equal(outboxBefore.length, 1)",
    "Learning retry must not add/rewrite actual outcome rows", "assert.equal(result.verdict, 'PASS')",
    "await verifyPublicExport('publication')","await verifyPublicExport('closing')",
    "await request('/functions/v1/' + slug, undefined, 'internal', 'GET')",
    "publication.evidence.member.id","canonicalMarketSourceRefs(publication.evidence.snapshot.generated_text)",
    "PROJECTION_CONTRACT_ONLY_NOT_DOWNSTREAM_DELIVERY"])assert.ok(source.includes(text),text);
  assert.ok(!source.includes(".from('content_os_sync_incidents').update"));
  assert.ok(!source.includes(".rpc('resolve_content_os_incident_v1'"));
  assert.ok(!source.includes('verify_jwt = false'));assert.ok(!source.includes('verifyJWT: false'));
});
test('new raw provider fixture retains original quote/prose and honest weekday timestamps; metadata must be produced by the handler',()=>{
  const path='tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260921.json';
  const original=JSON.parse(read(path)),next=JSON.parse(read('tests/fixtures/consolidation-v1/providers/full-chain-synthetic-20260923.json'));
  assert.equal(next.provenance.synthetic_template.sha256,hash(read(path)));
  assert.deepEqual(next.quotes,original.quotes);assert.deepEqual(next.openai_completion,original.openai_completion);
  assert.equal(next.provenance.historical_capture,false);assert.equal(next.provenance.historical_success_claim,false);
  assert.equal(next.report_date,'2026-09-23');assert.equal(next.warmup_date,'2026-09-22');
  assert.equal(next.phases[0].source_times.US,'2026-09-21T20:00:00.000Z');
  assert.equal(next.phases[1].source_times.US,'2026-09-22T20:00:00.000Z');
  for(const phase of next.phases)for(const time of Object.values(phase.source_times))assert.ok(Date.parse(time)<=Date.parse(phase.starts_at));
  const news=resolveConsolidationVendorResponse({url:'https://finnhub.io/api/v1/news?category=general'},next,'2026-09-23T07:00:00+08:00');
  assert.equal(news.body.length,6);
  for(const row of news.body){assert.equal(row.source,'Synthetic market provider');assert.equal(new URL(row.url).hostname,'fixture.example.invalid');
    assert.ok(row.url.includes('20260923'));assert.equal(row.datetime,Date.parse('2026-09-23T06:30:00+08:00')/1000);
    for(const key of ['source_refs','canonical_market_state','is_selected','final_score','content_score','publish_status'])assert.equal(row[key],undefined);}
});
