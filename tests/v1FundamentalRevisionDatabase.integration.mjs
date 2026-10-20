// Targeted Fresh PostgreSQL earnings/RLS -> real loader -> original evaluator.
// All company values/identities are SYNTHETIC. Other source families reuse the
// unchanged memory control fixture; this is NOT a full Production/provider E2E.
// No ports, network, volumes, credentials from files, or Production operations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {loadDecisionEvidence,DATA_QUERIES} from '../supabase/functions/_shared/decision-v1-data.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {IDENTITY,evidenceRows} from './fixtures/decision-evidence-rows.mjs';
const container='ma-v1-quarter-revision-'+randomUUID();
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:15000,maxBuffer:8e6,stdio:['pipe','pipe','pipe']}).trim();
const sql=input=>run(['exec','-i',container,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],input);
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const uuid=value=>createHash('md5').update('SYNTHETIC_ONLY:'+value).digest('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5');
const base=evidenceRows(),data=structuredClone(base);
for(const key of ['quotes','flows','earnings','universe','mappings']){
 const template=base[key].filter(r=>(r.symbol||r.stock_symbol)==='2330');
 data[key]=base[key].filter(r=>!/^\d/.test(String(r.symbol||r.stock_symbol)));
 for(const symbol of RECOMMENDATION_UNIVERSE)for(const row of template){
  const copy=JSON.parse(JSON.stringify(row).replaceAll('2330',symbol));copy.id=String(copy.id)+'-'+symbol;data[key].push(copy);
 }
}
const current=data.earnings.map(row=>{
 const [,year,quarter]=row.fiscal_period.match(/^(\d{4})-Q([1-4])$/);
 return {...row,id:uuid(row.id),raw_payload:{
 contract:'SYNTHETIC_CANONICAL_SOURCE_IDENTITY',symbol:row.symbol,fiscal_period:row.fiscal_period,
 internal_review_ref:'SYNTHETIC_NOT_A_PUBLIC_FIELD',
 measurement:{symbol:row.symbol,fiscal_year:Number(year),fiscal_quarter:Number(quarter),
  period_start:new Date(Date.UTC(Number(year),(Number(quarter)-1)*3,1)).toISOString().slice(0,10),
  period_end:new Date(Date.UTC(Number(year),Number(quarter)*3,0)).toISOString().slice(0,10),
  period_basis:'DIRECT_STANDALONE_QUARTER',accounting_basis:'IFRS_AS_REPORTED',
  consolidation:'CONSOLIDATED',currency:'TWD',revenue_unit:'TWD',revenue_scale:1,
  share_class:'COMMON_SHARE',eps_basis:'BASIC',eps_unit:'TWD_PER_COMMON_SHARE',
  profile:'NONFINANCIAL_IFRS',revenue_definition:'IFRS_REVENUE',
  revenue_actual:row.revenue_actual,eps_actual:row.eps_actual},
 }};
});
const target=current.find(r=>r.symbol==='2330'&&r.fiscal_period==='2026-Q2');
const write=rows=>sql('insert into public.earnings_events select * from jsonb_populate_recordset(null::public.earnings_events,'+quote(JSON.stringify(rows))+'::jsonb)');
const candidate=r=>r.phase_evaluation.candidates.find(c=>c.symbol==='2330');
const read=async request=>{
 if(request.table!==DATA_QUERIES.earnings.table){
  const key=Object.keys(DATA_QUERIES).find(k=>DATA_QUERIES[k].table===request.table);
  assert(key);return {data:structuredClone(data[key]),error:null};
 }
 assert.equal(request.columns,DATA_QUERIES.earnings.columns);
 assert.equal(request.limit,1001);assert.equal(request.order,'announced_at');
 const predicates=request.filters.map(f=>{
  assert(['announced_at','created_at'].includes(f.column));assert(['lte','gte'].includes(f.operator));
  assert(Number.isFinite(Date.parse(f.value)));
  return f.column+(f.operator==='lte'?' <= ':' >= ')+quote(f.value)+'::timestamptz';
 });
 const query='select '+request.columns+' from public.earnings_events where '+predicates.join(' and ')+' order by announced_at desc limit '+request.limit;
 return {data:JSON.parse(sql("set role service_role; select coalesce(jsonb_agg(x),'[]') from ("+query+') x')),error:null};
};
const assess=async()=>buildEvidenceDecision(await loadDecisionEvidence(read,IDENTITY),IDENTITY);
let owned=false,summary;
try{
 run(['image','inspect','postgres:17']); // Fail instead of implicitly pulling an image.
 run(['run','-d','--name',container,'--label','ma.test.scope=v1-fundamental-revision',
  '--network','none','--memory','384m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=192m',
  '--env','POSTGRES_PASSWORD=SYNTHETIC_LOCAL_ONLY','postgres:17']);owned=true;
 let ready=false;for(let i=0;i<40;i++){try{assert.equal(sql('select 1'),'1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}
 assert(ready,'ISOLATED_DB_NOT_READY');
 const original=readFileSync(new URL('./fixtures/six-bug-schema-only-20260930.sql',import.meta.url),'utf8');
 const start=original.indexOf('CREATE TABLE public.earnings_events ('),end=original.indexOf('\n\n\n--',start);
 assert(start>=0&&end>start);
 const constraints=[...original.matchAll(/ALTER TABLE ONLY public\.earnings_events\n\s+ADD CONSTRAINT [^;]+;/g)].map(m=>m[0]);
 assert.equal(constraints.length,2,'EXACT_CANONICAL_EARNINGS_CONSTRAINTS');
 sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;'+original.slice(start,end)+constraints.join('\n')
  +'alter table public.earnings_events enable row level security;alter table public.earnings_events force row level security;'
  +'revoke all on public.earnings_events from public,anon,authenticated;grant select on public.earnings_events to service_role;');
 const acl=()=>sql("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl,'policies',(select count(*)from pg_policies where tablename='earnings_events'))from pg_class where oid='public.earnings_events'::regclass");
 const rights=acl();
 for(const role of ['anon','authenticated'])assert.throws(()=>sql('set role '+role+';select * from public.earnings_events'),/permission denied/);
 assert.throws(()=>sql('set role service_role;insert into public.earnings_events default values'),/permission denied/);
 write(current);assert.equal(sql('select count(*) from public.earnings_events'),'288');
 const loaded=await loadDecisionEvidence(read,IDENTITY);
 assert.equal(loaded.earnings.length,288);
 for(const expected of current){
  const actual=loaded.earnings.find(row=>row.id===expected.id);
  assert.deepEqual(actual?.raw_payload,expected.raw_payload,'CANONICAL_JSONB_SOURCE_IDENTITY_WAS_DROPPED');
 }
 let result=await assess();assert.equal(result.phase_evaluation.universe_count,72);assert.equal(result.phase_evaluation.evaluated_count,72);
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_NOT_A_PUBLIC_FIELD|internal_review_ref/,'INTERNAL_EARNINGS_METADATA_LEAKED');
 const invalidMeasurements=[
  [{period_basis:'YTD'},'FUNDAMENTAL_PERIOD_BASIS_UNPROVEN'],
  [{period_start:'2026-01-01'},'FUNDAMENTAL_PERIOD_IDENTITY_MISMATCH'],
  [{eps_basis:'DILUTED'},'FUNDAMENTAL_MEASUREMENT_BASIS_CONFLICT'],
  [{currency:'USD'},'FUNDAMENTAL_MEASUREMENT_BASIS_UNPROVEN'],
  [{profile:'FINANCIAL_TIFRS_FH'},'FUNDAMENTAL_PROFILE_METHOD_REVIEW_REQUIRED'],
 ];
 for(const [patch,reason]of invalidMeasurements){
  // Mutate only this owned synthetic fixture to simulate a bad canonical row;
  // the read/evaluation path must neither repair it nor silently accept it.
  const changed={...target.raw_payload,measurement:{...target.raw_payload.measurement,...patch}};
  sql('update public.earnings_events set raw_payload='+quote(JSON.stringify(changed))+'::jsonb where id='+quote(target.id));
  result=await assess();assert.equal(result.phase_evaluation.evaluated_count,71);assert.equal(result.phase_evaluation.blocked_count,1);
  assert(candidate(result).reasons.includes(reason));
  assert.equal(result.stock_opportunities.some(r=>r.symbol==='2330'),false);
  assert.deepEqual(JSON.parse(sql('select raw_payload from public.earnings_events where id='+quote(target.id))),changed,'READER_REWROTE_BAD_CANONICAL_METADATA');
  sql('update public.earnings_events set raw_payload='+quote(JSON.stringify(target.raw_payload))+'::jsonb where id='+quote(target.id));
 }
 assert.equal((await assess()).phase_evaluation.evaluated_count,72,'SYNTHETIC_FIXTURE_NOT_RESTORED');
 for(const [announced,accepted]of [['2026-06-30T15:59:59.999Z',false],['2026-06-30T16:00:00Z',true]]){
  sql('update public.earnings_events set announced_at='+quote(announced)+',created_at='+quote(announced)+' where id='+quote(target.id));
  result=await assess();assert.equal(result.phase_evaluation.evaluated_count,accepted?72:71);
  assert.equal(candidate(result).reasons.includes('FUNDAMENTAL_ANNOUNCEMENT_BEFORE_PERIOD_END'),!accepted);
 }
 sql('update public.earnings_events set announced_at='+quote(target.announced_at)+',created_at='+quote(target.created_at)+' where id='+quote(target.id));
 assert.throws(()=>write([{...target,id:uuid('same-source-second-capture'),created_at:'2026-09-07T01:00:00Z'}]),/duplicate key/);
 assert.equal(sql('select count(*) from public.earnings_events'),'288');
 write([{...target,id:uuid('new-actual-only'),created_at:'2026-09-07T01:10:00Z',eps_actual:1,
  announced_at:'2026-09-07T00:30:00Z',revenue_consensus:null,eps_consensus:null,guidance_direction:null}]);
 const rowsHash=()=>sql("select md5(coalesce(string_agg(row_to_json(e)::text,E'\\n'order by id),'')) from public.earnings_events e");
 const before=rowsHash();result=await assess();
 assert.equal(result.phase_evaluation.evaluated_count,71);assert.equal(result.phase_evaluation.blocked_count,1);
 assert(candidate(result).reasons.includes('FUNDAMENTAL_SOURCE_EQUIVALENCE_UNPROVEN'));
 assert.deepEqual(result.stock_opportunities,[]);assert.equal(result.screening.status,'INCOMPLETE');
 assert.equal(rowsHash(),before,'READ_MODEL_MUTATED_CANONICAL_HISTORY');assert.equal(acl(),rights,'READ_MODEL_CHANGED_RLS_OR_ACL');
 summary={scope:'FRESH_DB_EARNINGS_REAL_LOADER_SYNTHETIC_72_UNIVERSE_OTHER_FAMILIES_MEMORY',
  synthetic_users:false,real_members_verified:false,baseline_evaluated:72,canonical_primary_and_unique_keys:'ENFORCED',duplicate_same_release_insert:'DENIED',
  newer_partial_evaluated:71,newer_partial_blocked:1,canonical_history_unchanged:true,
  canonical_jsonb_source_identities_read:288,internal_metadata_projected_to_decision:false,
  explicit_measurement_rejections:invalidMeasurements.length,
  taipei_quarter_end_boundary_controls:2,
  anon_raw:'DENY',authenticated_raw:'DENY',service_write:'DENY',rls_acl_unchanged:true,
  external_requests:0,production_changed:false};
}finally{
 if(owned){
  run(['rm','-f',container]);let absent=false;
  try{run(['inspect',container]);}catch(error){assert.equal(error.status,1);assert.match(error.stderr,/no such (?:object|container)/i);absent=true;}
  assert(absent,'OWNED_CONTAINER_STILL_EXISTS');
 }
}
console.log(JSON.stringify({...summary,cleanup:'VERIFIED_REMOVED'}));
