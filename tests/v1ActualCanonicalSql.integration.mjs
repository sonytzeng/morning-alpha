/** SYNTHETIC Fresh PostgreSQL tests, not Production E2E / original-file replay.
 * Run: node --test tests/v1ActualCanonicalSql.integration.mjs
 * Requires existing ma-runtime-sparse-ci:latest, built by the repository's
 * tests/fixtures/runtime-sparse-postgres.Dockerfile (postgres:17 + libfaketime).
 * This test NEVER builds/pulls it. The isolated DB clock is frozen at the
 * declared SYNTHETIC instant, not the host/Production clock. No SQL clock
 * predicates are removed or given jitter tolerance.
 * No network, ports, mounts, credentials, .env or external source reads. A new
 * random-labelled container uses bounded tmpfs PGDATA (no persistent data
 * volume); removal and cleanup are asserted. This also avoids consuming a
 * developer's already-full Docker data disk. Never prune unrelated resources.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {appendCanonicalActual,V1_ACTUAL_CANONICAL_FUNCTION} from '../src/features/vnext/v1ActualCanonical.ts';
import {loadDecisionEvidence} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildRecommendationProof,RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {prepareIssuerActualCanonicalIntake} from '../research/issuer-actual-canonical-intake.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {emptyEvidenceData} from '../supabase/functions/_shared/decision-v1-data.ts';
import {syntheticIssuerPdfActual} from './fixtures/issuerPdfActual.mjs';

const migration=readFileSync(new URL('../supabase/migrations/20261020070000_v1_actual_canonical_candidate.sql',import.meta.url),'utf8');
const synthetic=readFileSync(new URL('./fixtures/v1ActualCanonical-synthetic.sql',import.meta.url),'utf8');
const original=readFileSync(new URL('../supabase/migrations/20260822090305_production_architecture_v1.sql',import.meta.url),'utf8');
const originalTable=original.match(/create table if not exists public\.earnings_events \([\s\S]*?\n\);/)?.[0];
assert(originalTable,'use the real canonical schema, not a permissive substitute');
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const IMAGE='ma-runtime-sparse-ci:latest',SYNTHETIC_DB_CLOCK='2026-10-20 00:10:00';
const seedIds={source_revision_id:'10000000-0000-0000-0000-000000000001',row_id:'20000000-0000-0000-0000-000000000001'};
const SOURCE_AUTH='00000000-0000-0000-0000-000000000001';

test('SYNTHETIC Fresh DB: Actual-only SQL capability, preserved canonical contract and verified cleanup',async t=>{
 const name='ma-v1-actual-synthetic-'+process.pid+'-'+randomUUID().slice(0,8),label='morning-alpha.test=v1-actual-canonical';
 let created=false,cleaned=false,formalProofVerified=false,database='postgres';
 const command=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8e6,timeout:30000});
 const docker=(args,input)=>{const r=command(args,input);if(r.status!==0)throw Error('LOCAL_DOCKER_OR_SQL: '+(r.stderr||r.error?.message||r.stdout).slice(-6000));return r.stdout.trim();};
 const q=(text,role)=>docker(['exec','-i',name,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U',role?'v1_actual_synthetic_caller':'postgres','-d',database],(role?'set role '+role+';\n':'')+text);
 const json=(text,role)=>JSON.parse(q(text,role));
 const count=()=>json("select jsonb_build_array((select count(*) from public.earnings_events),(select count(*) from v1_actual_candidate.canonical_audit));");
 const tableRow=(table,id)=>json(`select to_jsonb(t) from v1_actual_candidate.${table} t where id=${quote(id)};`);
 const insert=(table,value)=>json(`insert into v1_actual_candidate.${table} select (jsonb_populate_record(null::v1_actual_candidate.${table},${quote(JSON.stringify(value))}::jsonb)).* returning to_jsonb(${table});`);
 // Exact existing Supabase RPC name/argument/result contract; real SQL role call
 // to that public-schema wrapper, NOT a direct private-core transport.
 const sqlTransport=async(name,args)=>{assert.equal(name,V1_ACTUAL_CANONICAL_FUNCTION);return {data:json(`select public.${name}(${quote(args.p_source_revision_id)}::uuid,${quote(args.p_row_id)}::uuid);`,'service_role'),error:null};};
 const call=ids=>appendCanonicalActual({source_revision_id:ids.source_revision_id,row_id:ids.row_id},sqlTransport);
 const deny=async(ids,pattern)=>{const before=count();await assert.rejects(call(ids),pattern);assert.deepEqual(count(),before,'rejection is zero-write');};
 let sourceTemplate,rowTemplate,reviewTemplate,rightsTemplate;
 // Only administrative SQL can create this SYNTHETIC independent evidence.
 function makeCase({source={},row={},review={},rights={},omitReview=false,omitRights=false}={}){
  const sourceId=randomUUID(),rowId=randomUUID(),at=q('select clock_timestamp();');
  const s=insert('source_revisions',{...sourceTemplate,id:sourceId,provider:'SYNTHETIC_'+sourceId.replaceAll('-','').toUpperCase(),...source});
  const r=insert('actual_rows',{...rowTemplate,id:rowId,source_revision_id:s.id,symbol:s.symbol,...row});
  const reviewedAt=q('select clock_timestamp();');
  let v,g;
  if(!omitReview)v=insert('independent_reviews',{...reviewTemplate,id:randomUUID(),source_revision_id:s.id,row_id:r.id,
   source_record_sha256:s.record_sha256,row_record_sha256:r.record_sha256,announcement_version_ref:s.source_version_ref,reviewed_at:reviewedAt,...review});
  if(!omitRights)g=insert('internal_rights',{...rightsTemplate,id:randomUUID(),source_revision_id:s.id,
   source_ref:s.source_ref,source_record_sha256:s.record_sha256,reviewed_at:reviewedAt,...rights});
  return {source_revision_id:s.id,row_id:r.id,s,r,v,g,started_at:at};
 }
 const revoke=(field,id)=>q(`insert into v1_actual_candidate.revocations(${field},reason,document_ref,document_sha256) values(${quote(id)},'SYNTHETIC-REVOCATION','SYNTHETIC-REVOCATION-DOCUMENT',repeat('f',64));`);
 const meta=()=>q("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl,'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public' and tablename='earnings_events')) from pg_class where oid='public.earnings_events'::regclass;");
 try{
  const image=JSON.parse(docker(['image','inspect',IMAGE]))[0]; // Never pull/build over a network.
  assert(image.Config.Env.includes('PG_MAJOR=17'));
  const dockerfile=readFileSync(new URL('./fixtures/runtime-sparse-postgres.Dockerfile',import.meta.url),'utf8');
  assert(dockerfile.startsWith('FROM postgres:17\n'));assert.match(dockerfile,/libfaketime/);
  assert.equal(image.Config.User,'postgres');
  assert.equal(docker(['run','--rm','--pull','never','--network','none','--entrypoint','id',IMAGE,'-u']),'999');
  const id=docker(['run','-d','--pull','never','--name',name,'--label',label,'--network','none',
   '--tmpfs','/var/lib/postgresql/data:rw,size=268435456,uid=999,gid=999,mode=0700',
   '--env','FAKETIME='+SYNTHETIC_DB_CLOCK,
   '--env','FAKETIME_DONT_FAKE_MONOTONIC=1','--env','FAKETIME_ONLY_CMDS=postgres',IMAGE]);
  assert.match(id,/^[a-f0-9]{64}$/);created=true;
  const info=JSON.parse(docker(['inspect',name]))[0];
  assert.equal(info.HostConfig.NetworkMode,'none');assert.deepEqual(info.HostConfig.PortBindings,{});
  assert.equal(info.Config.Labels['morning-alpha.test'],'v1-actual-canonical');
  assert.deepEqual(info.HostConfig.Tmpfs,{'/var/lib/postgresql/data':'rw,size=268435456,uid=999,gid=999,mode=0700'});
  assert(info.Mounts.every(m=>m.Type==='tmpfs'),'no host bind mounts or persistent data volumes');
  let ready=false,lastPing='';
  for(let i=0;i<200;i++){
   // The entrypoint's temporary initialization server is Unix-socket-only.
   // Wait for final loopback TCP readiness, not that soon-to-stop temp server.
   const ping=command(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','postgres']);
   lastPing=(ping.stderr||ping.stdout||ping.error?.message||'').slice(-2000);
   if(ping.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,100));
  }
  if(!ready){
   const logs=command(['logs','--tail','45',name]);
   assert.fail('isolated PostgreSQL must become ready: '+lastPing+' '+docker(['inspect','--format','{{json .State}}',name])+' '+logs.stdout+' '+logs.stderr);
  }
  assert.equal(q("select clock_timestamp()=timestamptz '2026-10-20T00:10:00Z';"),'t','fixed clock is test infrastructure, not SQL predicate mutation');
  q('create database v1_actual_synthetic;');database='v1_actual_synthetic';
  q(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
   create role v1_actual_synthetic_caller login noinherit;grant anon,authenticated,service_role to v1_actual_synthetic_caller;
   ${originalTable}
   alter table public.earnings_events enable row level security;
   alter table public.earnings_events force row level security;
   revoke all on public.earnings_events from public,anon,authenticated;
   grant all on public.earnings_events to service_role;
   insert into public.earnings_events(provider,symbol,fiscal_period,announced_at,source_ref,raw_payload)
   values('SYNTHETIC_LEGACY','9999','2020-Q1','2020-04-01T00:00:00Z','https://synthetic.invalid/legacy','{"SYNTHETIC_OLD_ROW_MUST_SURVIVE":true}');`);
  const beforeMeta=meta(),oldRow=q("select to_jsonb(e) from public.earnings_events e where provider='SYNTHETIC_LEGACY';");
  q(migration);
  assert.equal(meta(),beforeMeta);
  assert.deepEqual(count(),[1,0]);
  await t.test('no registry seeds, all seven tables FORCE RLS, precise private ACL and two-ID signature',()=>{
   assert.equal(q("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='v1_actual_candidate' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity;"),'7');
   assert.equal(q("select count(*) from pg_policies where schemaname='v1_actual_candidate';"),'0');
   for(const role of ['anon','authenticated']){
    assert.throws(()=>q("select public.append_v1_canonical_actual_candidate_v1(null,null);",role),/permission denied/);
    assert.throws(()=>q('select * from public.earnings_events;',role),/permission denied/);
   }
   for(const table of ['authorities','source_revisions','actual_rows','independent_reviews','internal_rights','revocations','canonical_audit']){
    assert.throws(()=>q(`select * from v1_actual_candidate.${table};`,'service_role'),/permission denied/);
    assert.throws(()=>q(`insert into v1_actual_candidate.${table} default values;`,'service_role'),/permission denied/);
   }
   assert.equal(q("select has_function_privilege('anon','v1_actual_candidate.append_actual_v1(uuid,uuid)','execute');"),'f');
   assert.equal(q("select has_function_privilege('authenticated','v1_actual_candidate.append_actual_v1(uuid,uuid)','execute');"),'f');
   assert.equal(q("select has_function_privilege('service_role','v1_actual_candidate.append_actual_v1(uuid,uuid)','execute');"),'f');
   for(const role of ['anon','authenticated'])assert.equal(q(`select has_function_privilege('${role}','public.append_v1_canonical_actual_candidate_v1(uuid,uuid)','execute');`),'f');
   assert.equal(q("select has_function_privilege('service_role','public.append_v1_canonical_actual_candidate_v1(uuid,uuid)','execute');"),'t');
   assert.equal(q("select has_schema_privilege('service_role','v1_actual_candidate','usage');"),'f');
   assert.equal(q("select pg_get_function_identity_arguments('public.append_v1_canonical_actual_candidate_v1(uuid,uuid)'::regprocedure);"),'p_source_revision_id uuid, p_row_id uuid');
   assert.throws(()=>q("set request.jwt.claims='{}'; select public.append_v1_canonical_actual_candidate_v1(null,null,true);",'service_role'),/does not exist/);
   assert.throws(()=>q('set role postgres;','service_role'),/permission denied/);
   assert.throws(()=>q('select public.append_v1_canonical_actual_candidate_v1(null,null);','service_role'),/ACTUAL_ID_REQUIRED/);
  });
  q(synthetic);
  sourceTemplate=tableRow('source_revisions',seedIds.source_revision_id);rowTemplate=tableRow('actual_rows',seedIds.row_id);
  reviewTemplate=tableRow('independent_reviews','30000000-0000-0000-0000-000000000001');rightsTemplate=tableRow('internal_rights','40000000-0000-0000-0000-000000000001');
  let first;
  await t.test('actual transaction appends a UUID canonical row and audit; exact replay is zero-write',async()=>{
   first=await call(seedIds);assert.equal(first.status,'INSERTED');assert.equal(first.v1_ready,false);
   const saved=json(`select to_jsonb(e) from public.earnings_events e where id=${quote(first.earnings_event_id)};`);
   assert.equal(saved.revenue_actual,123456789);assert.equal(saved.eps_actual,1.25);
   for(const field of ['revenue_consensus','eps_consensus','guidance_direction','surprise_score'])assert.equal(saved[field],null);
   assert.equal(saved.raw_payload.measurement.revenue_definition,'IFRS_REVENUE');
   assert.equal(saved.raw_payload.measurement.eps_basis,'DILUTED');
   assert.equal(saved.raw_payload.rights_scope,'INTERNAL_CANONICAL_ACTUAL_STORAGE_ONLY');
   assert(Date.parse(saved.created_at)>=Date.parse(sourceTemplate.recorded_at));
   const before=count(),again=await call(seedIds);assert.equal(again.status,'REPLAY');
   assert.equal(again.earnings_event_id,first.earnings_event_id);assert.equal(again.audit_id,first.audit_id);assert.deepEqual(count(),before);
   assert.equal(q('select count(*) from v1_actual_candidate.canonical_audit;'),'1');
  });
  await t.test('unknown IDs, unrelated row and missing independent records fail closed',async()=>{
   await deny({source_revision_id:randomUUID(),row_id:randomUUID()},/ACTUAL_SOURCE_MISSING/);
   await deny({...seedIds,row_id:randomUUID()},/ACTUAL_ROW_MISSING/);
   await deny(makeCase({omitReview:true}),/ACTUAL_REVIEW_MISSING/);
   await deny(makeCase({omitRights:true}),/ACTUAL_INTERNAL_RIGHTS_MISSING/);
   await deny(makeCase({review:{status:'PENDING'}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   await deny(makeCase({rights:{status:'REJECTED'}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   await deny(makeCase({review:{authority_id:SOURCE_AUTH}}),/ACTUAL_INDEPENDENT_AUTHORITY_REQUIRED/);
   await deny(makeCase({review:{source_record_sha256:'0'.repeat(64)}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   await deny(makeCase({review:{row_record_sha256:'0'.repeat(64)}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   await deny(makeCase({rights:{source_ref:'https://synthetic.invalid/other-source'}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   await deny(makeCase({rights:{expires_at:'2020-01-01T00:00:00Z'}}),/ACTUAL_APPROVAL_OR_RIGHTS_INVALID/);
   const authority=insert('authorities',{...tableRow('authorities',SOURCE_AUTH),id:randomUUID(),authority_ref:'SYNTHETIC-PENDING-SOURCE',status:'PENDING'});
   await deny(makeCase({source:{authority_id:authority.id}}),/ACTUAL_AUTHORITY_UNAPPROVED/);
   await deny(makeCase({source:{source_format:'PDF_UNSUPPORTED'}}),/ACTUAL_SOURCE_FORMAT_UNSUPPORTED/);
   await deny(makeCase({source:{source_format:'UNKNOWN'}}),/ACTUAL_SOURCE_FORMAT_UNSUPPORTED/);
  });
  await t.test('old retained2330 null announcement/version cannot be source-admitted by fresh receipt or quality claims',async()=>{
   const old=JSON.parse(readFileSync(new URL('../supabase/functions/_shared/retained-2330-quarter-actuals-20261019.json',import.meta.url),'utf8')).rows[0];
   assert.equal(old.announced_at,null);assert.equal(old.source_version,null);
   await deny(makeCase({source:{source_version_ref:old.source_version,version_status:'UNKNOWN'},review:{announced_at:old.announced_at}}),/ACTUAL_SOURCE_VERSION_OR_RECEIPT_INVALID/);
   await deny(makeCase({source:{source_version_ref:' unknown ',version_status:'EXACT'}}),/ACTUAL_SOURCE_VERSION_OR_RECEIPT_INVALID/);
   await deny(makeCase({review:{announced_at:null}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({review:{announcement_precision:'DATE_ONLY'}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({review:{announcement_document_sha256:null}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({review:{announcement_version_ref:'UNRELATED-VERSION'}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({review:{announced_at:'2020-01-01T00:00:00Z'}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({review:{announced_at:'2026-10-01T00:00:00.001Z'}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({source:{available_at:'2200-01-01T00:00:00Z'}}),/ACTUAL_SOURCE_VERSION_OR_RECEIPT_INVALID/);
   assert.throws(()=>q("update v1_actual_candidate.independent_reviews set status='APPROVED';",'service_role'),/permission denied/);
  });
  let pdf;
  await t.test('native PDF intake -> original service-only atomic RPC needs REAL independent approval dimensions, never parser self-approval',async()=>{
   const parsed=syntheticIssuerPdfActual(),cutoff='2026-10-20T00:10:00Z';
   const intake=await prepareIssuerActualCanonicalIntake({...emptyEvidenceData(),universe:[{symbol:'2330',is_active:true}]},
    {report_date:'2026-10-20',today_date:'2026-10-20',generated_at:cutoff,data_as_of:cutoff,revision_id:'SYNTHETIC_ONLY',is_trading_day:true},
    [{parsed,parsed_sha256:await snapshotHash(parsed)}]);
   pdf=intake.prepared[0];assert(pdf);
   // These are separate LOCAL administrative fake approvals, NOT extraction or
   // real issuer/rights evidence. The prepared unknown version still denies.
   await deny(makeCase({source:pdf.source,row:pdf.actual}),/ACTUAL_SOURCE_VERSION_OR_RECEIPT_INVALID/);
   await deny(makeCase({source:{...pdf.source,source_version_ref:'SYNTHETIC-PDF-V1',version_status:'EXACT'},row:pdf.actual,omitReview:true}),/ACTUAL_REVIEW_MISSING/);
   await deny(makeCase({source:{...pdf.source,source_version_ref:'SYNTHETIC-PDF-V1',version_status:'EXACT'},row:pdf.actual,omitRights:true}),/ACTUAL_INTERNAL_RIGHTS_MISSING/);
   const c=makeCase({source:{...pdf.source,source_version_ref:'SYNTHETIC-PDF-V1',version_status:'EXACT'},row:pdf.actual,
    review:{announced_at:'2026-07-31T08:00:00Z'}});
   const before=count(),result=await call(c),saved=tableRow('canonical_audit',result.audit_id);
   assert.equal(result.status,'INSERTED');assert.equal(result.v1_ready,false);
   assert.deepEqual(count(),[before[0]+1,before[1]+1]);
   const e=json(`select to_jsonb(e) from public.earnings_events e where id=${quote(saved.earnings_event_id)};`);
   assert.equal(e.revenue_actual,123456789);assert.equal(e.eps_actual,1.25);
   assert.equal(e.raw_payload.source_format,'ISSUER_PDF_DIRECT_QUARTER_V1');
   assert.equal(e.raw_payload.measurement.eps_namespace,null);assert.equal(e.raw_payload.measurement.eps_basis,'BASIC');
   for(const key of ['revenue_consensus','eps_consensus','guidance_direction','surprise_score'])assert.equal(e[key],null);
   const after=count();assert.equal((await call(c)).status,'REPLAY');assert.deepEqual(count(),after);
   revoke('rights_id',c.g.id);await deny(c,/ACTUAL_REVOKED/);
  });
  await t.test('PDF-specific evidence cannot be forged by QName, bad source, wrong period, mismatched values, locator or raw extras',async()=>{
   const source={...pdf.source,source_version_ref:'SYNTHETIC-PDF-V1',version_status:'EXACT'};
   const bad=[];
   for(const change of [p=>p.source_sha256='0'.repeat(64),p=>p.receipt_sha256='0'.repeat(64),p=>p.symbol='2454',
    p=>p.period_start='2026-01-01',p=>p.revenue.value_decimal='1',p=>p.eps.value_decimal='NaN',
    p=>p.eps.value_decimal=null,p=>p.eps.period_basis='YTD',p=>p.eps.unit='USD/ADR',
    p=>p.eps.page=0,p=>p.eps.page='6',p=>p.eps.page=161,p=>p.eps.bbox=[130,200,100,210],
    p=>p.eps.bbox=[-1,200,130,210],p=>p.eps.bbox=[100,200,130],p=>p.eps.bbox=[100,200,'130',210],
    p=>p.eps.private_path='FORBIDDEN_PRIVATE_EXTRA',p=>p.eps.resolution_decimal='0',
    p=>p.revenue.resolution_decimal='1000',p=>p.parser_result_sha256=null]){
    const p=structuredClone(pdf.actual.pdf_measurement);change(p);bad.push({pdf_measurement:p});
   }
   for(const row of [...bad,{pdf_measurement:null},{revenue_namespace:'https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full'},
    {eps_concept:'BasicEarningsLossPerShare'},{eps_basis:'DILUTED'},{profile:'FINANCIAL_TIFRS_FH'},
    {consolidation:'INDIVIDUAL'},{eps_locator:'PDF_PAGE:7'}]){
    await deny(makeCase({source,row:{...pdf.actual,...row},review:{announced_at:'2026-07-31T08:00:00Z'}}),/ACTUAL_PDF_MEASUREMENT_UNPROVEN/);
   }
   await deny(makeCase({row:{pdf_measurement:pdf.actual.pdf_measurement}}),/ACTUAL_SOURCE_FORMAT_UNSUPPORTED/);
   await deny(makeCase({source,row:pdf.actual,review:{announced_at:null}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
   await deny(makeCase({source,row:pdf.actual,review:{announcement_precision:'DATE_ONLY'}}),/ACTUAL_EXACT_ANNOUNCEMENT_REQUIRED/);
  });
  await t.test('NULL/unknown financial dimensions and unrepresentable numbers reject before canonical write',async()=>{
   for(const row of [{period_start:null},{period_end:null},{period_basis:'YTD'},{profile:null},{revenue_definition:null},
    {consolidation:null},{accounting_basis:'ADJUSTED'},{currency:'USD'},{revenue_unit:'THOUSAND_TWD'},{revenue_scale:1000},
    {revenue_resolution_twd:null},{share_class:'ADR'},{eps_basis:null},{eps_unit:'TWD_PER_ADR'},
    {eps_concept:'BasicEarningsLossPerShare'},{eps_namespace:'https://synthetic.invalid/spoof'},
    {revenue_actual:null},{eps_actual:null},{revenue_actual:'NaN'},{eps_actual:'Infinity'},
    {eps_actual:1.1234567},{revenue_actual:1.12345},{revenue_actual:'9007199254740992'},
    {eps_actual:'9999999999999'},{eps_actual:'123456789012.123456'},
    {revenue_actual:'9007199254740990.1234'}]){
    const c=makeCase({row});
    try{await deny(c,/ACTUAL_(MEASUREMENT_BASIS_UNPROVEN|PROFILE_UNPROVEN|REVENUE_DEFINITION_MISMATCH|EPS_CONCEPT_MISMATCH|VALUES_UNREPRESENTABLE)/);}
    catch(error){t.diagnostic(JSON.stringify({SYNTHETIC_FAILED_DIMENSION:row,source:c.s,actual:c.r,db_time:q('select clock_timestamp();')}));throw error;}
   }
   const represented=makeCase({row:{revenue_actual:'123456789.1234',eps_actual:'0.123456'}});
   const saved=await call(represented);
   const values=json(`select jsonb_build_array(revenue_actual,eps_actual) from public.earnings_events where id=${quote(saved.earnings_event_id)};`);
   assert.deepEqual(values,[123456789.1234,0.123456],'finite decimal roundtrip is accepted without an investment cutoff');
  });
  await t.test('financial NetIncomeLoss stays typed PRIVATE; even a reviewed net measure cannot enter generic canonical revenue',async()=>{
   const row={profile:'FINANCIAL_TIFRS_FH',revenue_definition:'FINANCIAL_NET_REVENUE',
    revenue_namespace:'http://www.xbrl.org/tifrs/bsci/fh/2026-03-31',revenue_concept:'NetIncomeLoss'};
   const financial=makeCase({source:{symbol:'2881'},row});
   await deny(financial,/ACTUAL_FINANCIAL_CANONICAL_METHOD_REVIEW_REQUIRED/);
   assert.equal(tableRow('actual_rows',financial.r.id).revenue_definition,'FINANCIAL_NET_REVENUE');
   assert.equal(q("select count(*) from public.earnings_events where symbol='2881';"),'0');
   await deny(makeCase({source:{symbol:'2881'},row:{...row,revenue_definition:'IFRS_REVENUE'}}),/ACTUAL_FINANCIAL_REVENUE_NOT_GENERIC/);
   await deny(makeCase({source:{symbol:'2881'},row:{...row,revenue_concept:'Revenue'}}),/ACTUAL_FINANCIAL_REVENUE_NOT_GENERIC/);
   await deny(makeCase({source:{symbol:'2881'},row:{...row,consolidation:'INDIVIDUAL'}}),/ACTUAL_FINANCIAL_REVENUE_NOT_GENERIC/);
   await deny(makeCase({source:{symbol:'2881'}}),/ACTUAL_REVENUE_DEFINITION_MISMATCH/);
  });
  await t.test('canonical conflict, external drift and revoked replay never silently overwrite or resurrect',async()=>{
   await deny(makeCase({source:{provider:sourceTemplate.provider}}),/ACTUAL_CANONICAL_CONFLICT/);
   const changed=makeCase(),saved=await call(changed);
   q(`update public.earnings_events set eps_actual=9 where id=${quote(saved.earnings_event_id)};`,'service_role'); // Existing privilege deliberately unchanged.
   await deny(changed,/ACTUAL_CANONICAL_CONFLICT/);
   for(const [field,selectId] of [['source_revision_id',c=>c.s.id],['row_id',c=>c.r.id],['review_id',c=>c.v.id],['rights_id',c=>c.g.id]]){
    const c=makeCase();revoke(field,selectId(c));await deny(c,/ACTUAL_REVOKED/);
   }
   revoke('review_id',reviewTemplate.id);await deny(seedIds,/ACTUAL_REVOKED/);
   assert.equal(q(`select count(*) from public.earnings_events where id=${quote(first.earnings_event_id)};`),'1','revocation never deletes a historical canonical row');
  });
  await t.test('writer/audit rollback is real SQL atomicity, not mocked port success',async()=>{
   const c=makeCase(),before=count();
   q(`begin;set local role service_role;select public.append_v1_canonical_actual_candidate_v1(${quote(c.s.id)},${quote(c.r.id)});rollback;`);
   assert.deepEqual(count(),before);
   q(`create function v1_actual_candidate.synthetic_audit_failure() returns trigger language plpgsql as $$begin if new.row_id='${c.r.id}'::uuid then raise exception 'SYNTHETIC_AUDIT_FAILURE';end if;return new;end$$;
    create trigger synthetic_audit_failure before insert on v1_actual_candidate.canonical_audit for each row execute function v1_actual_candidate.synthetic_audit_failure();`);
   try{await deny(c,/SYNTHETIC_AUDIT_FAILURE/);}finally{
    q('drop trigger synthetic_audit_failure on v1_actual_candidate.canonical_audit;drop function v1_actual_candidate.synthetic_audit_failure();');
   }
   assert.equal(q(`select count(*) from v1_actual_candidate.canonical_audit where row_id=${quote(c.r.id)};`),'0');
   assert.equal((await call(c)).status,'INSERTED','failed transaction leaves no poisoned idempotency marker');
   assert.throws(()=>q(`begin isolation level repeatable read;set local role service_role;select public.append_v1_canonical_actual_candidate_v1(${quote(c.s.id)},${quote(c.r.id)});`),/ACTUAL_ISOLATION_UNSUPPORTED/);
  });
  await t.test('append-only registry, original schema/RLS/ACL and old row remain unchanged',()=>{
   for(const table of ['authorities','source_revisions','actual_rows','independent_reviews','internal_rights','revocations','canonical_audit']){
    assert.throws(()=>q(`update v1_actual_candidate.${table} set recorded_at=clock_timestamp();`),/V1_ACTUAL_APPEND_ONLY/);
    assert.throws(()=>q(`delete from v1_actual_candidate.${table};`),/V1_ACTUAL_APPEND_ONLY/);
   }
   assert.equal(meta(),beforeMeta);assert.equal(q("select to_jsonb(e) from public.earnings_events e where provider='SYNTHETIC_LEGACY';"),oldRow);
   assert.throws(()=>q(migration),/already exists/);assert.equal(meta(),beforeMeta);
   assert.throws(()=>q(`insert into v1_actual_candidate.source_revisions(id,authority_id,provider,symbol,source_kind,source_ref,source_sha256,source_bytes,receipt_document_ref,receipt_document_sha256,first_seen_at,available_at)
    values(gen_random_uuid(),${quote(SOURCE_AUTH)},'SYNTHETIC','2330','ISSUER_FILING','https://synthetic.invalid','bad',1,'SYNTHETIC',repeat('a',64),clock_timestamp(),clock_timestamp());`),/check constraint/);
  });
  await t.test('actual SQL rows through unchanged loader -> buildRecommendationProof remain 0 evaluated; old cutoff sees no new Actual',async()=>{
   const cutoff=new Date(q("select clock_timestamp()+interval '1 second';")).toISOString(),date=new Date(Date.parse(cutoff)+8*3600000).toISOString().slice(0,10);
   const identity={report_date:date,today_date:date,revision_id:'SYNTHETIC-LOCAL-ACTUAL-ONLY',generated_at:cutoff,data_as_of:cutoff,is_trading_day:true};
   let actualQuery;
   const read=async request=>{
    if(request.table==='sector_stock_map')return {data:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true,created_at:cutoff,updated_at:cutoff})),error:null};
    if(request.table!=='earnings_events')return {data:[],error:null};
    actualQuery=request;
    const fields=request.columns.split(',');assert(fields.every(k=>/^[a-z_]+$/.test(k)));
    const filters=request.filters.map(f=>{assert(['announced_at','created_at'].includes(f.column));return `${f.column}${f.operator==='lte'?'<=':'>='}${quote(f.value)}::timestamptz`;}).join(' and ');
    return {data:json(`select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select ${fields.join(',')} from public.earnings_events where ${filters} order by ${request.order} desc limit ${request.limit}) x;`,'service_role'),error:null};
   };
   const data=await loadDecisionEvidence(read,identity);assert.equal(data.failures.length,0);
   assert(data.earnings.length>=1,'real psql JSON, not supplied financial fixtures');assert.equal(actualQuery.table,'earnings_events');
   assert(data.earnings.every(e=>e.eps_consensus===null&&e.revenue_consensus===null&&e.guidance_direction===null));
   const proof=await buildRecommendationProof(data,identity);
   assert.equal(proof.decision.screening.evaluated_count,0);assert.equal(proof.decision.phase_evaluation.blocked_count,72);
   assert(proof.decision.screening.rejected.every(r=>r.reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING')));
   assert.equal(proof.decision.stock_opportunities.length,0);assert.deepEqual(proof.business_writes,[]);
   const oldCutoff=new Date(Date.parse(sourceTemplate.recorded_at)-1).toISOString(),oldDate=new Date(Date.parse(oldCutoff)+8*3600000).toISOString().slice(0,10);
   const historical=await loadDecisionEvidence(read,{...identity,generated_at:oldCutoff,data_as_of:oldCutoff,today_date:oldDate,report_date:oldDate});
   assert.equal(historical.earnings.length,0,'today registry/approval/writer cannot backfill historical availability');
   formalProofVerified=true;
  });
  await t.test('authority revocation also denies a previously valid fresh row',async()=>{
   const c=makeCase();revoke('authority_id',SOURCE_AUTH);await deny(c,/ACTUAL_REVOKED/);
  });
  console.log(JSON.stringify({scope:'SYNTHETIC_NETWORK_NONE_FRESH_POSTGRES_NOT_PRODUCTION',image:IMAGE,image_id:image.Id,synthetic_db_clock:SYNTHETIC_DB_CLOCK+' UTC',sql_sha256:createHash('sha256').update(migration).digest('hex'),canonical_counts:count(),formal_v1_evaluated:formalProofVerified?0:null,source_originals_read:0,production_operations:0,container:name}));
 } finally {
  if(created){
   const inspect=JSON.parse(docker(['inspect',name]))[0];assert.equal(inspect.Config.Labels['morning-alpha.test'],'v1-actual-canonical');
   docker(['rm','-f','-v',name]);
   const absent=command(['container','inspect',name]);assert.notEqual(absent.status,0);assert.match(absent.stderr,/No such (?:object|container)/i);
   const remaining=docker(['ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}']);assert.equal(remaining,'');cleaned=true;
   console.log(JSON.stringify({cleanup:'VERIFIED_CONTAINER_AND_TMPFS_REMOVED',container:name,network:'none',ports:0}));
  }
 }
 assert(cleaned,'cleanup must be positively verified');
});
