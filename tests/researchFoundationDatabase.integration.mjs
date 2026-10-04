import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const db = process.env.MA_ISOLATED_TEST_DB;
assert.match(db || '', /^ma_10k_phase1_test\d+$/);
const container = process.env.MA_TEST_DOCKER_CONTAINER;
if (container) assert.equal(container, 'ma-10k-phase1-db');
const port = process.env.MA_TEST_PGPORT || '55439';
assert.match(port,/^\d{4,5}$/);
const execute = (database, input) => execFileSync(container ? 'docker' : 'psql', container
  ? ['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1']
  : ['-X','-q','-h','127.0.0.1','-p',port,'-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1'],
{ input, encoding:'utf8', timeout:30000, stdio:['pipe','pipe','pipe'] }).trim();
const sql = input => execute(db,input);
assert.equal(execute('postgres',`select count(*) from pg_database where datname='${db}'`),'0','Must use a NEW isolation database; never reset an existing DB');
execute('postgres',`create database ${db}`);
sql(readFileSync(root+'tests/fixtures/research-foundation-dependencies.sql','utf8'));
const sourceHash = () => sql("select md5(string_agg(pg_get_functiondef(oid),'' order by oid)) from pg_proc where pronamespace='auth'::regnamespace");
const before = sourceHash();
const migration = readFileSync(root+'supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql','utf8');
sql(migration);
assert.equal(sourceHash(),before,'Existing auth helper is unchanged');
assert.throws(()=>sql(migration),/already exists/,'Forward-only migration has an explicit duplicate guard');
let assertions=2;
const equal=(a,b)=>{assert.equal(a,b);assertions++;};
const denied=(q,pattern=/permission denied|row-level security/)=>{assert.throws(()=>sql(q),pattern);assertions++;};
const tables=['research_feature_versions','research_methodology_versions','research_method_versions','research_method_features',
  'research_analysis_graphs','research_signal_observations','research_quality_observations'];
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003',admin='10000000-0000-4000-8000-000000000004';
const snap='20000000-0000-4000-8000-000000000001',pred='30000000-0000-4000-8000-000000000001',outcome='40000000-0000-4000-8000-000000000001',graph='50000000-0000-4000-8000-000000000001',method='60000000-0000-4000-8000-000000000001';
const asUser=(id,q)=>`begin; set local role authenticated; set local request.jwt.claim.sub='${id}'; ${q}; rollback;`;
sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid'),('${admin}','admin');
insert into decision_snapshots values('${snap}','2026-10-02',1,'synthetic-fingerprint',
'{"market_report_gate":{"operational_market":{"report_level":"DEGRADED"}}}','2026-10-02T07:00:00+08:00');
insert into learning_predictions values('${pred}','${snap}','2026-10-02','2026-10-02T07:01:00+08:00','valid');
insert into prediction_outcomes values('${outcome}','${pred}','close','2026-10-02','2026-10-02T14:35:00+08:00','completed','complete',false,-1,0.5,-2,'[]');`);
equal(sql(asUser(owner,'select public.is_research_owner_v1()')),'f');
denied(asUser(owner,'select public.get_research_foundation_v1()'),/RESEARCH_OWNER_REQUIRED/);
sql(`insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_TEST_ONLY_APPROVAL')`);
const graphInsert=(id=graph,level='DEGRADED',kind='HISTORICAL_REPLAY',date='2026-10-02',revision=1)=>
`insert into research_analysis_graphs(id,business_date,decision_snapshot_id,decision_revision,decision_fingerprint,methodology_id,methodology_version,report_level,evidence_as_of,observation_kind)
values('${id}','${date}','${snap}',${revision},'synthetic-fingerprint','RESEARCH_FOUNDATION_V1',1,'${level}','2026-10-02T07:02:00+08:00','${kind}')`;
sql(`set role service_role; ${graphInsert()}`);
sql(`insert into research_method_versions(method_id,version,kind,method_name,teacher_label,description,source_type,source_title,source_date,source_reference,extracted_claim,normalized_rule,market_scope,entry_conditions,exit_conditions,invalidation_conditions,risk_conditions,expected_horizon,status)
values('${method}',1,'RULE_CANDIDATE','Synthetic rule','Synthetic teacher','Test only','INTERNAL_RESEARCH','Fixture','2026-10-01','synthetic://fixture','Testable fixture','{}','TW','["entry"]','["exit"]','["invalidate"]','["risk"]','1D','RESEARCH');
insert into research_method_features values('${method}',1,'TAIEX',1);
insert into research_signal_observations(graph_id,signal_key,feature_key,feature_version,disposition,evidence_ids,evidence_available_at,strength,confidence,decision_contribution)
values('${graph}','synthetic','TAIEX',1,'CONTRADICTING',array['synthetic-evidence'],'2026-10-02T07:01:00+08:00',25,30,'{"kind":"SHADOW_TEST"}');`);
const measurement=(version='MEASURE_FIXTURE_V1',out=outcome,eligible=true)=>`insert into research_quality_observations(graph_id,prediction_id,outcome_id,quality_dimension,measurement_version,report_level,eligible,metrics)
values('${graph}','${pred}','${out}','DECISION','${version}','DEGRADED',${eligible},'{"direction":"WRONG"}')`;
sql(`set role service_role; ${measurement()}`);
for (const table of tables) {
  denied(`set role anon; select * from ${table}`);
  for(const id of [member,paid,admin]) equal(sql(asUser(id,`select count(*) from ${table}`)),'0');
  assert(Number(sql(asUser(owner,`select count(*) from ${table}`)))>0); assertions++;
  denied(asUser(owner,`delete from ${table}`));
  denied(`set role service_role; delete from ${table}`);
  denied(`delete from ${table}`,/RESEARCH_APPEND_ONLY/);
}
denied(`truncate ${tables.join(',')}`,/RESEARCH_APPEND_ONLY/);
equal(sql(asUser(owner,"select public.get_research_foundation_v1()->>'mode'")),'SHADOW');
for(const id of [member,paid,admin]) denied(asUser(id,'select public.get_research_foundation_v1()'),/RESEARCH_OWNER_REQUIRED/);
denied('set role anon; select public.get_research_foundation_v1()');
denied(`set role service_role; select public.get_research_foundation_v1()`);
equal(sql(asUser(paid,`set local request.jwt.claims='{"user_metadata":{"role":"admin","owner":true}}'; select public.is_research_owner_v1()`)),'f');
denied(asUser(owner,`select * from research_private.owner_access`));
denied(asUser(admin,`insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${admin}',true,'UNAUTHORIZED_ACCESS')`));
equal(sql("select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename like 'research_%'"),'0');
equal(sql("select count(*) from pg_class where relname like 'research_%' and relkind='r' and relrowsecurity and relforcerowsecurity"),'7');
denied(graphInsert('50000000-0000-4000-8000-000000000002','FULL'),/PROVENANCE_UNAVAILABLE_OR_MISMATCH/);
denied(graphInsert('50000000-0000-4000-8000-000000000002','DEGRADED','FORWARD'),/FORWARD_CANNOT_BE_BACKDATED/);
denied(graphInsert('50000000-0000-4000-8000-000000000002','DEGRADED','HISTORICAL_REPLAY','2026-10-01'),/CANONICAL_LINEAGE_MISMATCH/);
denied(graphInsert('50000000-0000-4000-8000-000000000002','DEGRADED','HISTORICAL_REPLAY','2026-10-02',2),/CANONICAL_LINEAGE_MISMATCH/);
denied(`insert into research_signal_observations(graph_id,signal_key,feature_key,feature_version,disposition,evidence_ids,evidence_available_at,decision_contribution)
values('${graph}','future','TAIEX',1,'SUPPORTING',array['future'],'2026-10-02T13:30:00+08:00','{}')`,/SIGNAL_LOOKAHEAD/);
denied(`insert into research_signal_observations(graph_id,signal_key,feature_key,feature_version,disposition,strength,decision_contribution)
values('${graph}','missing','TAIEX',1,'MISSING',87,'{}')`,/check constraint/);
denied(`insert into research_methodology_versions(methodology_id,version,description,production_eligible) values('invalid',1,'test',true)`,/check constraint/);
denied(`insert into research_methodology_versions(methodology_id,version,supersedes_version,description) values('RESEARCH_FOUNDATION_V1',3,1,'test')`,/check constraint/);
denied(measurement(),/duplicate key/);
const frozen=sql('select source_outcome_hash from research_quality_observations');
sql(`update prediction_outcomes set return_percent=2 where id='${outcome}'`);
equal(sql('select source_outcome_hash from research_quality_observations'),frozen);
sql(measurement('MEASURE_FIXTURE_V2'));
equal(sql('select count(distinct source_outcome_hash) from research_quality_observations'),'2');
denied("update research_quality_observations set metrics='{}'",/RESEARCH_APPEND_ONLY/);
sql(`update prediction_outcomes set data_quality_status='stale_data' where id='${outcome}'`);
denied(measurement('MEASURE_FIXTURE_V3'),/OUTCOME_NOT_ELIGIBLE/);
sql(`update prediction_outcomes set data_quality_status='complete',target_date='2999-01-01' where id='${outcome}'`);
denied(measurement('MEASURE_FIXTURE_V3'),/FUTURE_OUTCOME/);
sql(`update research_private.owner_access set enabled=false`);
equal(sql(asUser(owner,'select count(*) from research_feature_versions')),'0');
equal(sql('select count(*) from learning_predictions'),'1');
equal(sql('select count(*) from decision_snapshots'),'1');
equal(sql("select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like '%promot%'"),'0');
console.log(JSON.stringify({fresh_database:db,checks:assertions,rls_roles:['anonymous','member','paid','unlisted_admin','owner','service_role'],append_only:'PASS',lineage:'PASS',promotion:'NOT_AVAILABLE',production_changes:0}));
