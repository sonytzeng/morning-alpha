// Opt-in fresh LOCAL PostgreSQL only. No Production connection, business seed,
// Auth data, provider call, report INSERT or external transport.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const db=process.env.MA_ISOLATED_TEST_DB;
if(!/^ma_research_gate_test\d+$/.test(db||''))throw Error('FRESH_LOCAL_RESEARCH_DATABASE_REQUIRED');
const port=process.env.MA_RESEARCH_DB_PORT||'55439';
if(!/^\d{4,5}$/.test(port))throw Error('LOCAL_PORT_REQUIRED');
const args=['-X','-q','-h','127.0.0.1','-p',port,'-d',db,'-At','-v','ON_ERROR_STOP=1'];
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const sql=(text,database=db)=>execFileSync(process.env.MA_TEST_PSQL||'psql',args.map((x,i)=>i===args.indexOf('-d')+1?database:x),{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(sql(`select count(*) from pg_database where datname=${q(db)}`,'postgres'),'0');
sql('create database '+db,'postgres');
sql("do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end$$;");
sql('create table runtime_quality_policies(active boolean,premium_publish_min integer);insert into runtime_quality_policies values(true,90);');
const original=read('supabase/migrations/20260909015650_core_market_publication_contract.sql');
const start=original.indexOf('CREATE OR REPLACE FUNCTION public.validate_core_market_publication_v1(');
const end=original.indexOf('$function$;',start)+'$function$;'.length;
assert.ok(start>0&&end>start);sql(original.slice(start,end));
sql("revoke all on function validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) from public; grant execute on function validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;");
const catalog=()=>sql("select jsonb_build_object('owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid)) from pg_proc where oid='validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure;");
const before=catalog();
const fixture=JSON.parse(read('tests/fixtures/production-parity-v4/research-publication-20260930.json'));
function validate(f=fixture){
 const ai={canonical_market_state:f.state,market_report_gate:f.gate,data_quality:'complete',today_beneficiary_stocks:[],today_beneficiary_stocks_v10:[],stock_research:{document:{report_date:f.stock_report_date,quality:f.stock_quality}}};
 const decision={source_refs:f.source_refs,content_score:f.content_score,coverage_score:f.coverage_score,decision_mode:f.decision_mode,action:f.action,market_regime:f.market_regime,
  generated_text:{canonical_market_state:f.state,market_report_gate:f.gate,data_quality:'complete',missing_sources:[],daily_sentence:f.daily_sentence,market_bias:f.market_bias,recommendations:f.recommendations}};
 return JSON.parse(sql(`select validate_core_market_publication_v1(${q(f.report_date)},${q(JSON.stringify(ai))}::jsonb,${q(JSON.stringify(decision))}::jsonb,null,null,null);`));
}
const migration=read('supabase/migrations/20260930005956_research_committed_close_provenance_v1.sql');
test('real Handler projection: predecessor rejects solely derived provenance; exact migration restores publication',()=>{
 assert.deepEqual(validate().reason_codes,['MARKET_SOURCE_PROVENANCE_INVALID']);
 sql(migration); assert.deepEqual(validate().reason_codes,[]); assert.equal(validate().eligible,true);
 assert.equal(catalog(),before,'owner/ACL/signature/security/search_path unchanged');
 const hash=sql("select md5(pg_get_functiondef('validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure));");
 sql(migration);assert.equal(sql("select md5(pg_get_functiondef('validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure));"),hash,'exact idempotent migration');
});
test('old reconstructed source remains compatible, but stale/current/future/mislabeled evidence remains blocked',()=>{
 const mutate=(field,value)=>{const f=structuredClone(fixture);for(const c of f.state.document.quality.coverage_audit.claims)for(const s of c.sources)if(s.source==='authoritative_market_data_snapshots_v1')s[field]=value;for(const s of f.source_refs)if(s.source==='authoritative_market_data_snapshots_v1')s[field]=value;return f;};
 assert.equal(validate(mutate('source','sector_rotation_scores')).eligible,true,'existing published-sector contract unchanged');
 for(const [field,value] of [['freshness','stale'],['freshness','fresh'],['source_date','2026-09-30'],['source_date','2026-10-01'],['source','UNKNOWN_RECONSTRUCTION']]){
  assert.equal(validate(mutate(field,value)).eligible,false,field+':'+value);
 }
 const bad=structuredClone(fixture);bad.state.document.quality.evidence_coverage=99;assert.equal(validate(bad).eligible,false,'no Quality Gate reduction');
});
test('unknown predecessor cannot be admitted by a marker, and no business tables are introduced',()=>{
 const def=sql("select pg_get_functiondef('validate_core_market_publication_v1(date,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);");
 sql(def.replace('declare','declare\n -- UNREVIEWED'));assert.throws(()=>sql(migration),/RESEARCH_PROVENANCE_UNREVIEWED_PREDECESSOR/);
 sql(def);
 assert.equal(sql("select string_agg(table_name,',') from information_schema.tables where table_schema='public';"),'runtime_quality_policies');
});
