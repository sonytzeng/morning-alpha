// Opt-in, local PostgreSQL contract regression. No Production URL/credential,
// Auth impersonation, provider request, Acceptance RPC, Cron or notification.
// MA_LOCAL_SCOPE=ma-core-final-20260907 MA_ISOLATED_TEST_DB=ma_market_publication_test<digits>
// MA_TEST_PSQL=<existing psql> node --test tests/marketPublicationDatabase.integration.mjs
// Creates a NEW database only; never resets/deletes another run's database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const scope='ma-core-final-20260907';
const database=process.env.MA_ISOLATED_TEST_DB;
if(process.env.MA_LOCAL_SCOPE!==scope || !/^ma_market_publication_test\d+$/.test(database||'')) {
  throw new Error('EXPLICIT_FRESH_LOCAL_DATABASE_SCOPE_REQUIRED');
}
const bin=process.env.MA_TEST_PSQL||'psql';
const args=['-X','-h','127.0.0.1','-p','55439','-d',database,'-A','-t','-v','ON_ERROR_STOP=1'];
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const j=value=>`${q(JSON.stringify(value))}::jsonb`;
function command(text,db=database) {
  try { return execFileSync(bin,args.map((value,index)=>index===6?db:value).concat(['-c',text]),
    {encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}).trim(); }
  catch(error) { throw new Error(`LOCAL_SQL_FAILED: ${error.stderr?.toString().trim() || error.message}`); }
}
// Check the actual server, not just a user-supplied connection string.
const serverAddress=command('select host(inet_server_addr());','postgres');
const githubIsolatedService=process.env.GITHUB_ACTIONS==='true'
  && /^(?:172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|10\.)/.test(serverAddress)
  && command('select inet_server_port();','postgres')==='5432';
assert.ok(serverAddress==='127.0.0.1'||githubIsolatedService,'Only local loopback or this workflow isolated Docker PostgreSQL service is allowed');
assert.equal(command(`select count(*) from pg_database where datname=${q(database)};`,'postgres'),'0','Never reuse a previous test database');
command(`create database ${database};`,'postgres');
assert.equal(command('select current_database();'),database);
command(`create schema ma_isolated_guard; create table ma_isolated_guard.identity(scope text primary key); insert into ma_isolated_guard.identity values(${q(scope)});`);
function sql(text){
  assert.equal(command('select scope from ma_isolated_guard.identity;'),scope);
  return command(text);
}
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function definition(path,name) {
  const source=read(path),start=source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0,`Missing baseline ${name}`);
  const end=source.indexOf('$$;',start);
  assert.ok(end>start);
  return source.slice(start,end+3);
}
for(const file of ['tests/fixtures/core-research-schema.sql','tests/fixtures/core-research-indexes.sql','tests/fixtures/core-research-publish-baseline.sql'])sql(read(file));
for(const name of ['claim_research_input_v1','finish_research_input_v1','publish_research_bundle_v1']) {
  sql(definition('supabase/migrations/20260907030607_core_research_atomic_publication.sql',name));
}
sql(definition('supabase/migrations/20260822090305_production_architecture_v1.sql','enforce_decision_snapshot_premium_90_gate_v1'));
sql(`create trigger decision_snapshots_premium_90_gate before insert or update of status,content_score,decision_mode on public.decision_snapshots
  for each row execute function public.enforce_decision_snapshot_premium_90_gate_v1();`);
// Dedicated test-role owner only. No login or superuser permission is granted.
sql("do $$ begin if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres nologin; end if; end $$;");
sql('grant usage on schema public to postgres,service_role; grant all on all tables in schema public to postgres,service_role;');
const signatures=[
  ['enforce_decision_snapshot_premium_90_gate_v1()',false,'search_path=""'],
  ['publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)',false,'search_path=""'],
  ['publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)',true,'search_path=""'],
  ['publish_decision_snapshot_v2(date,text,uuid,jsonb)',true,'search_path=public'],
  ['publish_decision_snapshot_v3(date,text,uuid,jsonb,uuid,text,integer)',true,'search_path=""'],
];
for(const [signature] of signatures)sql(`alter function public.${signature} owner to postgres; revoke all on function public.${signature} from public,anon,authenticated; grant execute on function public.${signature} to service_role;`);
// Actual FK and RLS restrictions on all local business tables. service_role is
// the same privileged RPC caller contract; anon receives no raw-table access.
sql(`alter table public.decision_snapshots add foreign key(report_id) references public.reports(id);
  alter table public.decision_snapshots add foreign key(research_session_id) references public.research_sessions(id);
  alter table public.member_content_revisions add foreign key(report_id) references public.reports(id);
  alter table public.member_content_revisions add foreign key(decision_snapshot_id) references public.decision_snapshots(id);
  alter table public.semantic_coherence_reviews add foreign key(member_content_revision_id) references public.member_content_revisions(id);`);
for(const table of ['reports','decision_snapshots','research_sessions','editorial_reviews','pipeline_runs','member_content_revisions','semantic_coherence_reviews']) {
  sql(`alter table public.${table} enable row level security; create policy local_owner_contract on public.${table} to postgres using(true) with check(true);`);
}
for(const table of ['member_content_revisions','semantic_coherence_reviews'])sql(`alter table public.${table} force row level security;`);

const metadata=()=>JSON.parse(sql(`select json_agg(json_build_object('name',p.proname,'hash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enforce_decision_snapshot_premium_90_gate_v1','publish_research_bundle_v1','publish_member_content_revision_v1','publish_decision_snapshot_v2','publish_decision_snapshot_v3');`));
const before=metadata();
const originals=JSON.parse(sql(`select json_agg(json_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid)) order by p.proname)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('enforce_decision_snapshot_premium_90_gate_v1','publish_research_bundle_v1','publish_member_content_revision_v1');`));
const triggerBefore=sql("select pg_get_triggerdef(oid) from pg_trigger where tgname='decision_snapshots_premium_90_gate';");
const migration=read('supabase/migrations/20260908050000_market_publication_recommendation_isolation.sql');
sql(migration); const once=metadata(); sql(migration);

function fixture(date='2026-09-08',mode='market_only') {
  const correlation=randomUUID(),fingerprint=randomUUID().replaceAll('-','').repeat(2);
  const sentence='市場資金與成交量需要在09:30確認，市場證據成立但暫不發布個股推薦。';
  const gate={contract_version:'MARKET_REPORT_GATE_V2',report_date:date,eligible:true,status:'READY_MARKET_ONLY',report_status:'READY',decision_mode:'market_only',
    content_score:92,reason_codes:[],recommendation_status:'BLOCKED',recommendation_gate:{status:'BLOCKED',eligible:false,universe_evaluation_complete:false,
      screening:{status:'INCOMPLETE',universe_count:null,evaluated_count:null,rejected:[]}}};
  const quality={publish_status:'ready',evidence_coverage:100,unsupported_claims:[],duplicate_claims:[],contradictions:[],missing_sections:[]};
  const stocks=mode==='recommendations'?[{symbol:'2317',name:'isolated fixture company'}]:[];
  const action=mode==='recommendations'?'SELECTIVE':'WAIT';
  const report={report_date:date,summary:sentence,today_summary:sentence,today_quote:sentence,
    ai_strategy_json:{data_quality:'complete',decision_mode:mode,canonical_action:action,report_status:'READY',recommendation_status:'BLOCKED',market_report_gate:gate,today_quote:sentence,
      today_beneficiary_stocks:stocks,today_beneficiary_stocks_v10:stocks,
      content_evidence_quality:{verified_market_count:3,blank_market_change_count:0},
      research_master_v2:{report_date:date,today_date:date,quality},line_push_copy:{one_sentence:sentence}}};
  const decision={input_fingerprint:fingerprint,report_mode:'normal_overnight',is_trading_day:true,market_status:'OPEN',
    data_as_of:date+'T07:00:00+08:00',engine_version:'isolated-market-publication-test',decision_mode:mode,content_score:92,content_grade:'high_quality',coverage_score:100,action,
    source_refs:[{id:'ISOLATED_MARKET_EVIDENCE',source:'isolated-public-market-fixture',data_as_of:date+'T07:00:00+08:00'}],
    generated_text:{daily_sentence:sentence,recommendations:stocks,market_report_gate:gate}};
  const contract={report_date:date,snapshot_id:correlation,snapshot_version:1,decision_mode:mode,action,primary_symbols:stocks.map(row=>row.symbol),data_quality_status:'complete',market_report_gate:gate};
  const member={today_core_thesis:sentence,line_summary:sentence,canonical_contract:contract,beneficiary_candidates:stocks,representative_stocks:stocks};
  const semantic={status:'PASSED',eligible:true,reason_codes:[],conflicting_fields:[],gate_version:'ISOLATED_MARKET_TEST'};
  return {date,correlation,fingerprint,gate,quality,report,decision,contract,member,semantic};
}
function claim(f){
  return JSON.parse(sql(`select public.claim_research_input_v1(${q(f.date)},${q(f.fingerprint)},${q(f.correlation)},'isolated-test','isolated',
    '{"source":"isolated-fixture","missing_sources":[],"market_count":3,"news_count":1,"sector_count":1}');`));
}
function publish(f,run){return JSON.parse(sql(`set role service_role; select public.publish_research_bundle_v1(${q(run.run_id)},${q(f.correlation)},${j(f.report)},${j(f.decision)},${j(f.contract)},${j(f.member)},${j(f.semantic)});`).replace(/^SET\n/,''));}
function rowsState(){
  return sql(`select json_build_object('reports',(select json_agg(r order by id) from reports r),'decisions',(select json_agg(d order by id) from decision_snapshots d),
    'members',(select json_agg(m order by id) from member_content_revisions m),'semantic',(select json_agg(s order by id) from semantic_coherence_reviews s),
    'research',(select json_agg(r order by id) from research_sessions r));`);
}

test('isolated migration twice retains original owner/private ACL, trigger binding, v2/v3 and 90/100 policy',()=>{
  assert.deepEqual(metadata(),once);
  assert.equal(sql("select pg_get_triggerdef(oid) from pg_trigger where tgname='decision_snapshots_premium_90_gate';"),triggerBefore);
  for(const name of ['publish_decision_snapshot_v2','publish_decision_snapshot_v3'])assert.deepEqual(once.find(row=>row.name===name),before.find(row=>row.name===name));
  for(const [signature,definer,config] of signatures){
    const row=JSON.parse(sql(`select json_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,
      'anon',has_function_privilege('anon',oid,'EXECUTE'),'auth',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE'))
      from pg_proc where oid=${q('public.'+signature)}::regprocedure;`));
    assert.deepEqual(row,{owner:'postgres',definer,config:[config],anon:false,auth:false,service:true});
  }
  assert.equal(sql('select premium_publish_min||\'/\'||auto_repair_min from runtime_quality_policies where active;'),'90/70');
  assert.equal(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('capture_morning_alpha_acceptance_v1','reconcile_runtime_terminal_failures_v1','reconcile_runtime_http_dispatches_v1');"),'0','No Acceptance/reconciler included in this test or migration');
});

let published,valid;
test('Market PASS + Recommendation BLOCKED atomically publishes same-date READY/WAIT with zero stocks and is idempotent',()=>{
  valid=fixture(); const run=claim(valid); assert.equal(run.status,'ACQUIRED'); published=publish(valid,run);
  assert.equal(published.success,true);
  const row=JSON.parse(sql(`select json_build_object('mode',d.decision_mode,'status',d.status,'action',d.action,'stocks',d.generated_text->'recommendations',
    'date',r.report_date,'same_revision',r.ai_strategy_json->>'revision_id'=d.id::text and m.decision_snapshot_id=d.id,
    'same_proof',d.generated_text->'market_report_gate'=r.ai_strategy_json->'market_report_gate' and m.canonical_contract->'market_report_gate'=r.ai_strategy_json->'market_report_gate',
    'member_stocks',m.member_content->'beneficiary_candidates','member_status',m.status) from reports r join decision_snapshots d on d.report_id=r.id
    join member_content_revisions m on m.decision_snapshot_id=d.id where d.id=${q(published.decision_snapshot_id)};`));
  assert.deepEqual(row,{mode:'market_only',status:'READY',action:'WAIT',stocks:[],date:valid.date,same_revision:true,same_proof:true,member_stocks:[],member_status:'PASSED'});
  const stable=rowsState();assert.equal(claim(valid).status,'REUSED');assert.equal(rowsState(),stable);
});

test('missing/invalid proof, stocks, 89 score, 99 coverage and semantic failure all rollback existing publication',()=>{
  const candidate=fixture(); const run=claim(candidate); const stable=rowsState();
  const mutations=[
    ['missing gate',f=>{delete f.decision.generated_text.market_report_gate;}],
    ['mismatched gate',f=>{f.report.ai_strategy_json.market_report_gate={...f.gate,report_date:'2026-09-06'};}],
    ['market not eligible',f=>{f.gate.eligible=false;}],
    ['market stale date',f=>{f.gate.report_date='2026-09-06';}],
    ['market quality missing',f=>{delete f.quality.contradictions;}],
    ['market unsupported',f=>{f.quality.unsupported_claims=['unsupported'];}],
    ['stock array',f=>{f.decision.generated_text.recommendations=[{symbol:'2317'}];}],
    ['member stock array',f=>{f.member.beneficiary_candidates=[{symbol:'2317'}];}],
    ['fake stock score',f=>{f.decision.opportunity_score=75;}],
    ['89 editorial',f=>{f.decision.content_score=89;f.gate.content_score=89;}],
    ['99 decision coverage',f=>{f.decision.coverage_score=99;}],
    ['99 research coverage',f=>{f.quality.evidence_coverage=99;}],
    ['semantic blocked',f=>{f.semantic.status='BLOCKED';f.semantic.eligible=false;}],
    ['unsafe action',f=>{f.decision.action='SELECTIVE';}],
  ];
  for(const [name,mutate] of mutations){const f=structuredClone(candidate);mutate(f);assert.throws(()=>publish(f,run),undefined,name);assert.equal(rowsState(),stable,name);}
  assert.equal(sql(`select status from pipeline_runs where id=${q(run.run_id)};`),'RUNNING');
  sql(`select public.finish_research_input_v1(${q(run.run_id)},${q(candidate.correlation)},'DEGRADED','{"error_code":"ISOLATED_NEGATIVE_CASES_COMPLETE"}',null);`);
});

test('direct v2/v3 cannot bypass proof or claim pipeline success after rejected market-only snapshot',()=>{
  for(const version of [2,3])for(const mutate of [d=>{delete d.generated_text.market_report_gate;},d=>{d.content_score=89;},d=>{d.generated_text.recommendations=[{symbol:'2317'}];}]){
    const f=structuredClone(valid); mutate(f.decision); const stable=rowsState();const pipelineBefore=sql('select count(*) from pipeline_runs;');
    const trailing=version===3?`,${q(randomUUID())},${q('isolated-direct-'+randomUUID())},1`:'';
    assert.throws(()=>sql(`set role service_role;select public.publish_decision_snapshot_v${version}(${q(f.date)},'PREMARKET',${q(published.report_id)},${j(f.decision)}${trailing});`));
    assert.equal(rowsState(),stable);assert.equal(sql('select count(*) from pipeline_runs;'),pipelineBefore);
  }
});

test('direct member RPC rejects stocks, missing proof, score or evidence mismatch without inserting a revision',()=>{
  const memberCall=f=>`set role service_role;select public.publish_member_content_revision_v1(${q(f.date)},${q(published.report_id)},${q(published.decision_snapshot_id)},
    ${q('isolated-member-'+randomUUID())},'isolated-source',${j(f.contract)},${j(f.member)},${j(f.semantic)},${f.decision.content_score},${f.decision.coverage_score},now(),'{}');`;
  for(const mutate of [f=>{f.member.representative_stocks=[{symbol:'2317'}];},f=>{delete f.contract.market_report_gate;},f=>{f.decision.content_score=89;},f=>{f.decision.coverage_score=99;}]){
    const f=structuredClone(valid);f.contract.snapshot_id=published.decision_snapshot_id;mutate(f);const stable=rowsState();
    assert.throws(()=>sql(memberCall(f)));assert.equal(rowsState(),stable);
  }
});

test('updates watched by the unchanged premium trigger cannot corrupt an existing READY market-only result',()=>{
  for(const change of ['content_score=89',"status='PARTIAL'",'content_score=null']) {
    const stable=rowsState();
    assert.throws(()=>sql(`set role service_role;update decision_snapshots set ${change} where id=${q(published.decision_snapshot_id)};`));
    assert.equal(rowsState(),stable);
  }
});

test('NO_QUALIFIED_OPPORTUNITY requires an explicit complete positive universe, not an empty inferred screen',()=>{
  const f=fixture('2026-09-09');const run=claim(f);const stable=rowsState();
  f.gate.recommendation_status='NO_QUALIFIED_OPPORTUNITY';f.gate.recommendation_gate.status='NO_QUALIFIED_OPPORTUNITY';
  f.report.ai_strategy_json.recommendation_status='NO_QUALIFIED_OPPORTUNITY';
  assert.throws(()=>publish(f,run));assert.equal(rowsState(),stable);
  f.gate.recommendation_gate.universe_evaluation_complete=true;
  f.gate.recommendation_gate.screening={status:'COMPLETE',universe_count:2,evaluated_count:1,rejected:[]};
  assert.throws(()=>publish(f,run));assert.equal(rowsState(),stable);
  f.gate.recommendation_gate.screening.evaluated_count=2;
  assert.equal(publish(f,run).success,true);
});

test('legacy recommendation and genuine no_trade publication branches retain their existing contract',()=>{
  for(const [mode,date] of [['recommendations','2026-09-10'],['no_trade','2026-09-11']]){
    const f=fixture(date,mode);const run=claim(f);const result=publish(f,run);
    assert.equal(result.success,true);
    assert.equal(sql(`select decision_mode||':'||status from decision_snapshots where id=${q(result.decision_snapshot_id)};`),mode+':READY');
  }
});

test('captured three-function rollback restores exact local baseline definitions/ACL; reapply is repeatable without row changes',()=>{
  const stable=rowsState();
  const acl=signatures.slice(0,3).map(([signature])=>`alter function public.${signature} owner to postgres;revoke all on function public.${signature} from public,anon,authenticated;grant execute on function public.${signature} to service_role;`).join('\n');
  sql('begin;\n'+originals.map(row=>row.definition+';').join('\n')+'\n'+acl+'\ncommit;');
  assert.deepEqual(metadata(),before);
  assert.equal(rowsState(),stable);
  sql(migration);sql(migration);
  assert.deepEqual(metadata(),once);
  assert.equal(rowsState(),stable);
});
