// Explicit, new database only. REST transport is a labelled SDK-to-psql bridge,
// not PostgREST/Auth/Edge infrastructure. Captured outputs are restored verbatim;
// no producer, external delivery, original scope mutation or natural-day claim.
// MA_LOCAL_SCOPE=ma-content-os-captured-20260909
// MA_ISOLATED_TEST_DB=ma_content_os_capture<digits>
// node --experimental-strip-types tests/integration/coreConsolidationContentOsAddon.integration.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capturedOutput, captureHash, runCapturedContentOs, selectCapturedRows } from '../helpers/coreContentOsCapturedReplay.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scope = 'ma-content-os-captured-20260909', originalScope = 'ma-consolidation-v1-20260909170000';
const database = process.env.MA_ISOLATED_TEST_DB;
assert.equal(process.env.MA_LOCAL_SCOPE, scope);
assert.match(database || '', /^ma_content_os_capture\d{8,20}$/);
assert.equal(process.version, 'v22.23.1');
const originalRoot = '/private/tmp/' + originalScope, output = '/private/tmp/' + database;
const host = 'unix:///private/tmp/ma-clock-20260909-020052/docker.sock';
const container = 'supabase_db_' + originalScope;
const migrationPath = 'supabase/migrations/20260909015650_core_market_publication_contract.sql';
const migrationHash = '353a30988429fa1ac1847174bf00199a3f876f0311e7ae1f2ecf165d9ccb0ce0';
const date = '2026-09-21', capture = capturedOutput();
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const j = value => q(JSON.stringify(value)) + '::jsonb';
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value)
  ? value.map(item => JSON.parse(canonical(item))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const sources = [];
const read = path => { const bytes = readFileSync(resolve(repo,path)); sources.push({path,sha256:captureHash(bytes)}); return bytes.toString(); };
const migration = read(migrationPath); assert.equal(captureHash(migration), migrationHash);
const pins = capture.preservation.original_files;
const checkPins = () => { for (const pin of pins) assert.equal(captureHash(readFileSync(pin.path)),pin.sha256,pin.path); };
checkPins(); assert.equal(existsSync(output),false,'Never overwrite an earlier attempt');
mkdirSync(output,{mode:0o700});
const result = { schema_version:'CORE_CONTENT_OS_CAPTURED_DB_ADDON_V1', status:'RUNNING', scope, database,
  input_kind:'RESTORED_REAL_HANDLER_OUTPUT_NOT_NEW_PRODUCER_CHAIN', input_capture_sha256:captureHash(readFileSync(resolve(repo,'tests/fixtures/consolidation-v1/content-os/persisted-market-only-20260921.json'))),
  original_run_id:capture.provenance.original_run_id, full_supabase_claim:false, natural_day_claim:false,
  auth_gateway_executed:false, original_scope_writes:0, production_requests:0, external_line_requests:0,
  sql_sha256:migrationHash, checks:[], sources };
const save = () => writeFileSync(output+'/result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});
save();
const docker = (args,input) => execFileSync('docker',['--host',host,...args],{input,encoding:'utf8',timeout:30000,maxBuffer:24*1024*1024,stdio:['pipe','pipe','pipe']}).trim();
function command(text, db=database) {
  assert.ok(db===database||db==='postgres');
  try { return docker(['exec','-i',container,'psql','-X','-U','postgres','-d',db,'-qAt','-v','ON_ERROR_STOP=1'],text); }
  catch(error) { throw new Error('LOCAL_CAPTURE_SQL_FAILED: '+String(error.stderr||error.message).slice(0,4000)); }
}
const originalSql = text => command("BEGIN READ ONLY; SET LOCAL statement_timeout='20s'; "+text+'; ROLLBACK;','postgres');
const beforeRows = JSON.parse(readFileSync('/private/tmp/ma-content-os-captured-20260909/public-before-after.json')).after;
const names = beforeRows.map(row=>row.table);
assert.equal(names.length,81); assert.ok(names.every(name=>/^[a-z_][a-z_0-9]*$/.test(name)));
const digestSql = 'select jsonb_build_array('+names.map(name=>`(select jsonb_build_object('table',${q(name)},'count',count(*),'sha_source_md5',md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''))) from public.${name} t)`).join(',')+')';
const rolesSql = "select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypass',rolbypassrls) order by rolname) from pg_roles";
let rolesBefore;
const check = (name,fn) => { const evidence=fn(); result.checks.push({name,status:'PASS',evidence}); save(); return evidence; };
function definition(path,name) {
  const source=read(path),start=source.search(new RegExp('create or replace function public\\.'+name+'\\(','i'));
  assert.ok(start>=0);const tail=source.slice(start),delimiter=tail.match(/\bas\s+(\$[a-zA-Z_]*\$)/i)?.[1];
  assert.ok(delimiter);const first=tail.indexOf(delimiter),last=tail.indexOf(delimiter,first+delimiter.length);assert.ok(last>first);
  return tail.slice(0,last+delimiter.length)+';';
}
function sql(text) { assert.equal(command('select scope from ma_isolated_guard.identity'),scope); return command(text); }
const rows = table => { assert.match(table,/^[a-z_][a-z_0-9]*$/); return JSON.parse(sql(`begin read only; set local role service_role; select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${table} t; rollback;`)); };
try {
  check('exact existing private transport and untouched original evidence',()=>{
    assert.equal(originalSql('select scope from ma_isolated_guard.identity'),originalScope);
    const networks=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Networks}}',container]));
    assert.deepEqual(Object.keys(networks),[originalScope+'-isolated']);
    assert.equal(docker(['network','inspect','--format','{{.Internal}}',originalScope+'-isolated']),'true');
    assert.equal(canonical(JSON.parse(originalSql(digestSql))),canonical(beforeRows));
    rolesBefore=originalSql(rolesSql);
    assert.equal(originalSql("select count(*) from pg_roles where rolname in ('postgres','anon','authenticated','service_role')"),'4');
    assert.equal(originalSql(`select count(*) from pg_database where datname=${q(database)}`),'0');
    const serverTime=originalSql('select clock_timestamp()');
    assert.ok(Date.parse(serverTime)>=Date.parse(date+'T15:25:00+08:00'),'Real SQL clock must be after the captured acceptance cutoff; no clock rewrite');
    return {original_public_tables:81,original_file_pins:pins,server_time:serverTime};
  });
  command(`create database ${database}`,'postgres');
  assert.equal(command('select current_database()'),database);
  command(`create schema ma_isolated_guard; create table ma_isolated_guard.identity(scope text primary key); insert into ma_isolated_guard.identity values(${q(scope)});`);
  // Existing reviewed schema fixtures; no Auth schema/users or cluster roles.
  let schema=read('tests/fixtures/core-research-schema.sql');
  schema=schema.slice(schema.indexOf('create table public.'));
  schema=schema.slice(0,schema.indexOf('insert into public.runtime_quality_policies'));
  sql(schema);
  sql(read('tests/fixtures/core-research-indexes.sql'));
  sql(read('tests/fixtures/core-research-publish-baseline.sql'));
  const acceptance=read('tests/fixtures/core-acceptance-schema.sql');sql(acceptance.slice(0,acceptance.indexOf('-- Existing Production RPC definitions')));
  sql(read('supabase/migrations/202606260001_market_data_snapshots.sql'));
  const checkpoint=read('supabase/migrations/20260822173542_preserve_checkpoint_snapshots.sql');sql(checkpoint.slice(0,checkpoint.indexOf('alter table public.data_provider_health')));
  for(const name of ['claim_research_input_v1','finish_research_input_v1','publish_research_bundle_v1','reconcile_runtime_terminal_failures_v1']) sql(definition('supabase/migrations/20260907030607_core_research_atomic_publication.sql',name));
  sql(definition('supabase/migrations/20260822090305_production_architecture_v1.sql','enforce_decision_snapshot_premium_90_gate_v1'));
  sql('create trigger decision_snapshots_premium_90_gate before insert or update of status,content_score,decision_mode on public.decision_snapshots for each row execute function public.enforce_decision_snapshot_premium_90_gate_v1();');
  sql(read('supabase/migrations/20260908020000_incident_acceptance_market_delivery.sql'));
  sql(read('supabase/migrations/20260908050000_market_publication_recommendation_isolation.sql'));
  for(const name of ['record_content_os_incident_v1','resolve_content_os_incident_v1']) sql(definition('supabase/migrations/20260827153000_semantic_content_reliability.sql',name));
  const signatures=[
    'enforce_decision_snapshot_premium_90_gate_v1()',
    'publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)',
    'publish_member_content_revision_v1(date,uuid,uuid,text,text,jsonb,jsonb,jsonb,numeric,numeric,timestamptz,jsonb)',
    'publish_decision_snapshot_v3(date,text,uuid,jsonb,uuid,text,integer)',
    'capture_morning_alpha_acceptance_v1(date,text)',
    'reconcile_runtime_terminal_failures_v1(date,uuid)',
    'record_content_os_incident_v1(text,date,uuid,integer,text[],integer,jsonb)',
    'resolve_content_os_incident_v1(text,integer,jsonb)',
  ];
  for(const signature of [...signatures,'publish_decision_snapshot_v2(date,text,uuid,jsonb)','claim_research_input_v1(date,text,uuid,text,text,jsonb)','finish_research_input_v1(uuid,uuid,text,jsonb,integer)'])
    sql(`alter function public.${signature} owner to postgres; revoke all on function public.${signature} from public,anon,authenticated; grant execute on function public.${signature} to service_role;`);
  const access = () => sql("select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'");
  const tables=JSON.parse(sql("select json_agg(tablename order by tablename) from pg_tables where schemaname='public'"));
  sql('grant usage on schema public to service_role; grant all on all tables in schema public to service_role;');
  for(const table of tables) sql(`alter table public.${table} enable row level security; revoke all on public.${table} from public,anon,authenticated;`);
  for(const table of ['member_content_revisions','semantic_coherence_reviews'])sql(`alter table public.${table} force row level security;`);
  const metadata = signature => JSON.parse(sql(`select jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'arguments',pg_get_function_arguments(oid),'result',pg_get_function_result(oid),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where oid=${q('public.'+signature)}::regprocedure`));
  const beforeMetadata=signatures.map(signature=>({signature,metadata:metadata(signature)})),beforeAccess=access();
  sql(migration);
  check('exact candidate and original incident RPCs keep private security contracts',()=>{
    for(const item of beforeMetadata){ assert.deepEqual(metadata(item.signature),item.metadata);assert.equal(item.metadata.anon,false);assert.equal(item.metadata.authenticated,false);assert.equal(item.metadata.service,true); }
    assert.equal(access(),beforeAccess);return {signatures:beforeMetadata,sql_sha256:migrationHash};
  });
  const readbackBytes=readFileSync(originalRoot+'/actual-chain-final-readback.json');
  assert.equal(captureHash(readbackBytes),'7d6a7fd5ebcf48a6ee0916d58f8c0d13565009138cbb4f6e6b837b39ec4f9963');
  const readback=JSON.parse(readbackBytes),restored=structuredClone(capture.tables);
  const extra=['market_checkpoint_snapshots','market_data_snapshots','trading_day_state','line_delivery_outbox','learning_runs','learning_predictions','prediction_outcomes','ma_ops_runs','runtime_http_dispatches','runtime_dead_letters'];
  for(const table of extra)restored[table]=structuredClone(readback.tables[table].rows);
  assert.equal(Object.hasOwn(restored,'production_acceptance_results'),false,'Never borrow a prior PASS');
  assert.equal(Object.hasOwn(restored,'line_subscribers'),false);assert.equal(Object.hasOwn(restored,'auth.users'),false);
  // Real decision trigger reads the policy during INSERT. Restore the captured
  // policy first; do not disable the trigger or substitute a test threshold.
  const restoreOrder=['runtime_quality_policies',...Object.keys(restored).filter(table=>table!=='runtime_quality_policies')];
  for(const table of restoreOrder){
    const items=restored[table];
    const columns=JSON.parse(sql(`select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name=${q(table)}`));
    assert.ok(columns,'Missing real schema for '+table);
    for(const item of items)for(const key of Object.keys(item))assert.ok(columns.includes(key),'Never silently discard captured authority: '+table+'.'+key);
    if(items.length)sql(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},${j(items)});`);
  }
  check('restored output rows are exact and original Acceptance is absent',()=>{
    for(const [table,items]of Object.entries(restored)) assert.equal(canonical(rows(table)),canonical(items),table);
    assert.equal(rows('production_acceptance_results').length,0);
    return {row_counts:Object.fromEntries(Object.entries(restored).map(([key,value])=>[key,value.length])),no_fabricated_ready:true,producer_rerun:false};
  });
  const stableTables=Object.keys(restored).filter(table=>table!=='content_os_sync_incidents');
  const stableBefore=Object.fromEntries(stableTables.map(table=>[table,canonical(rows(table))]));
  const terminal=()=>Number(sql(`set role service_role; select public.reconcile_runtime_terminal_failures_v1(${q(date)},${q(randomUUID())});`));
  const accept=()=>{const id=sql(`set role service_role; select public.capture_morning_alpha_acceptance_v1(${q(date)},'LOCAL_CONTENT_OS_CAPTURED_OUTPUT_ADDON');`);return rows('production_acceptance_results').find(row=>row.id===id);};
  check('restored market_only is still a valid terminal state before export',()=>{assert.equal(terminal(),0);const row=accept();assert.equal(row.verdict,'PASS',JSON.stringify(row.blocking_checks));assert.equal(row.evidence.automatic_stable_day,false);return {acceptance_id:row.id,verdict:row.verdict,automatic_stable_day:false,scope:'RESTORED_OUTPUT_ONLY'};});
  const sqlRpc=async(name,body)=>{
    assert.ok(['record_content_os_incident_v1','resolve_content_os_incident_v1'].includes(name));
    if(name==='record_content_os_incident_v1')return sql(`set role service_role; select public.record_content_os_incident_v1(${q(body.p_incident_key)},${q(body.p_business_date)},${q(body.p_snapshot_id)},${Number(body.p_snapshot_version)},array[${body.p_reason_codes.map(q).join(',')}],${Number(body.p_http_status)},${j(body.p_metadata)});`);
    return Number(sql(`set role service_role; select public.resolve_content_os_incident_v1(${q(body.p_incident_key)},${Number(body.p_snapshot_version)},${j(body.p_metadata)});`));
  };
  const handlerResult=await runCapturedContentOs(capture.tables,{rpc:sqlRpc,queryRows:async(table,query)=>{
    assert.ok(Object.hasOwn(capture.tables,table));const actual={[table]:rows(table)};
    if(table==='member_content_revisions')actual.semantic_coherence_reviews=rows('semantic_coherence_reviews');
    return selectCapturedRows(actual,table,query);
  }});
  writeFileSync(output+'/handler-response.json',JSON.stringify(handlerResult,null,2)+'\n',{mode:0o600,flag:'wx'});
  check('actual handler and SDK record the missing-public-citation failure through the real incident RPC',()=>{
    assert.equal(handlerResult.status,409);assert.equal(handlerResult.body.error,'PUBLIC_MARKET_EVIDENCE_INCOMPLETE');
    assert.equal(handlerResult.incidentTrace.length,0,'No simulated RPC used in SQL lane');
    assert.equal(handlerResult.trace.some(row=>row.path.endsWith('/resolve_content_os_incident_v1')),false);
    const incidents=rows('content_os_sync_incidents');assert.equal(incidents.length,1);assert.equal(incidents[0].status,'OPEN');
    assert.deepEqual(incidents[0].reason_codes,['PUBLIC_MARKET_EVIDENCE_INCOMPLETE']);
    return {http_status:handlerResult.status,incident_id:incidents[0].id,real_incident_rpc:true,db_transport:'EXPLICIT_SQL_BRIDGE_NOT_POSTGREST'};
  });
  check('ContentOS incident blocks real Acceptance without killing market_only publication',()=>{
    assert.equal(terminal(),0);const row=accept();assert.equal(row.verdict,'FAIL');assert.deepEqual(row.blocking_checks,['CONTENT_HANDOFF_INCIDENT']);
    assert.equal(row.evidence.automatic_stable_day,false);
    for(const table of stableTables) assert.equal(canonical(rows(table)),stableBefore[table],table+' must remain unchanged');
    assert.equal(rows('production_acceptance_results').length,2,'Original locally re-evaluated PASS is preserved beside new FAIL');
    return {acceptance_id:row.id,verdict:row.verdict,blocking_checks:row.blocking_checks,automatic_stable_day:false};
  });
  result.status='PASS';result.actual_export_status='FAIL_MISSING_FROZEN_PUBLIC_EVIDENCE';result.actual_acceptance_after_export='FAIL_CONTENT_HANDOFF_INCIDENT';
}catch(error){result.status='FAIL';result.error=String(error.stack||error);process.exitCode=1;
}finally{
  try{checkPins();assert.equal(canonical(JSON.parse(originalSql(digestSql))),canonical(beforeRows));if(rolesBefore)assert.equal(originalSql(rolesSql),rolesBefore);
    result.original_preservation={public_tables:81,public_rows_unchanged:true,cluster_role_metadata_unchanged:true,original_file_pins_unchanged:true};
  }catch(error){result.status='FAIL';result.preservation_error=String(error.stack||error);process.exitCode=1;}
  result.finished_at=new Date().toISOString();save();
  console.log(JSON.stringify({status:result.status,database,result_path:output+'/result.json',sha256:captureHash(readFileSync(output+'/result.json')),checks:result.checks.length,error:result.error,full_supabase_claim:false}));
}
