// Disposable real SQL/RLS. All inserted values are SYNTHETIC, not Production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizeMarketInstitutionalTwd, withMarketInstitutionalEvidence } from '../supabase/functions/_shared/recommendation-market-institutional-candidate.ts';
import { emptyEvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
import { buildRecommendationFoundationCandidate, persistedFoundationCandidateInput } from '../supabase/functions/_shared/recommendation-foundation-candidate.ts';
import { persistedRecommendationReaderInput } from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const name='ma-market-flow-candidate-'+process.pid;
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:2e6,timeout:15000}).trim();
const sql=input=>run(['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],input);
let owned=false,summary;
try {
 // Bound the tiny disposable database to RAM; do not prune or resize the
 // developer's full Docker data disk or touch any existing test service.
 run(['image','inspect','postgres:17']); // No implicit image pull or external network.
 run(['run','-d','--name',name,'--network','none','--memory','384m','--cpus','1','--tmpfs','/var/lib/postgresql/data:rw,size=268435456','--env','POSTGRES_PASSWORD=isolated-only','postgres:17']);owned=true;
 let ready=false;for(let i=0;i<40;i++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
 const schema=readFileSync(new URL('./fixtures/six-bug-schema-only-20260930.sql',import.meta.url),'utf8');
 const start=schema.indexOf('CREATE TABLE public.institutional_flows ('),end=schema.indexOf('\n);',start)+3;
 assert(start>=0&&end>start);
 sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;'+schema.slice(start,end));
 // Reproduce the deployed private table boundary, not a new Production policy.
 sql('alter table public.institutional_flows enable row level security;alter table public.institutional_flows force row level security;revoke all on public.institutional_flows from public,anon,authenticated;grant select on public.institutional_flows to service_role;');
 for(const role of ['anon','authenticated'])assert.throws(()=>sql('set role '+role+';select * from public.institutional_flows'),/permission denied/);
 assert.equal(sql('set role service_role;select count(*) from public.institutional_flows'),'0');
 const fingerprint=()=>sql("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl,'rows',(select count(*) from public.institutional_flows))from pg_class where oid='public.institutional_flows'::regclass");
 const before=fingerprint();
 const p={stat:'OK',date:'20260904',hints:'單位：元',fields:['單位名稱','買進金額','賣出金額','買賣差額'],data:[['自營商(自行買賣)','20','10','10'],['自營商(避險)','30','20','10'],['投信','50','20','30'],['外資及陸資(不含外資自營商)','100','50','50'],['外資自營商','8','3','5'],['合計','200','100','100']]};
 const c=await normalizeMarketInstitutionalTwd(p,'2026-09-04','2026-09-06T22:50:00Z');
 const id={report_date:'2026-09-07',today_date:'2026-09-07',generated_at:'2026-09-06T23:00:00Z',data_as_of:'2026-09-06T23:00:00Z',revision_id:'synthetic-isolation',is_trading_day:true};
 const source=emptyEvidenceData(),merged=await withMarketInstitutionalEvidence(source,id,c);
 assert.equal(source.flows.length,0);assert.equal(merged.flows.length,3);
 assert.equal(fingerprint(),before,'adapter is memory-only; table bytes/security unchanged');
 // Install the EXACT existing cache table/RPC SQL, not a new Production
 // migration. Seed a synthetic lease directly: this is a persistence test,
 // not a claim that this historical fixture naturally ran on a trading day.
 const lifecycle=readFileSync(new URL('../supabase/migrations/20261007125316_recommendation_v2_forward_lifecycle.sql',import.meta.url),'utf8');
 const cacheStart=lifecycle.indexOf('create table research_private.recommendation_v2_acquisition_cache ('),cacheEnd=lifecycle.indexOf('-- Outcome observations are independently captured',cacheStart);
 assert(cacheStart>=0&&cacheEnd>cacheStart);
 sql('create schema research_private;revoke all on schema research_private from public,anon,authenticated,service_role;'+lifecycle.slice(cacheStart,cacheEnd));
 const quote=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 const lease=sql("insert into research_private.recommendation_v2_acquisition_cache(business_date,phase,lease_until)values('2026-09-07','PREMARKET',clock_timestamp()+interval '60 seconds')returning id");
 const bundle={business_date:id.report_date,acquisition_cutoff:id.generated_at,captures:[],marketFlow:c};
 const finish=(role,value)=>sql(`set role ${role};select public.finish_recommendation_v2_acquisition('${lease}',${quote(value)})`);
 for(const role of ['anon','authenticated'])assert.throws(()=>finish(role,bundle),/permission denied/);
 assert.equal(finish('service_role',bundle),'STORED');assert.equal(finish('service_role',bundle),'ALREADY_STORED');
 const changed=structuredClone(bundle);changed.marketFlow.source_revision='0'.repeat(64);
 assert.throws(()=>finish('service_role',changed),/V2_ACQUISITION_IMMUTABLE/);
 const persisted=JSON.parse(sql(`select payload from research_private.recommendation_v2_acquisition_cache where id='${lease}'`));assert.deepEqual(persisted,bundle);
 // Same market rows, actually reordered by PostgreSQL JSONB, must stay one
 // private capture instead of becoming MARKET_FLOW_CONFLICT on a later read.
 assert.notEqual(JSON.stringify(c.rows[0]),JSON.stringify(persisted.marketFlow.rows[0]));
 const held={...source,flows:structuredClone(c.rows)},heldBefore=structuredClone(held);
 const reread=await withMarketInstitutionalEvidence(held,id,persisted.marketFlow);
 assert.deepEqual(reread,heldBefore);assert.deepEqual(held,heldBefore);
 assert.equal(new Set(reread.flows.map(r=>r.id)).size,3);
 const changedHeld=structuredClone(held);changedHeld.flows[0].raw_payload.publication_approved=true;
 const conflict=await withMarketInstitutionalEvidence(changedHeld,id,persisted.marketFlow);
 assert(conflict.failures.includes('MARKET_FLOW_CONFLICT'));
 const proof=await buildRecommendationFoundationCandidate({data:source,identity:id,captures:[],officialActuals:[],marketFlow:persisted.marketFlow,evidenceCutoff:persisted.acquisition_cutoff});
 const savedReport={revision_id:id.revision_id,correlation_id:id.revision_id,generated_at:id.generated_at,decision_v1:proof.decision,recommendation_stock_evidence:proof.acquisition};
 // Report's unchanged JSON serialization preserves this additive field.
 const report=JSON.parse(sql(`select ${quote(savedReport)}`));
 assert.equal((await persistedFoundationCandidateInput(source,id,report,{ownerAuthorized:true})).data.flows.length,3);
 assert.equal((await persistedFoundationCandidateInput(source,id,report)).data.flows.length,0);
 const cacheBefore=sql(`select md5(payload::text) from research_private.recommendation_v2_acquisition_cache where id='${lease}'`);
 const oldReader=await persistedRecommendationReaderInput(source,id,report);assert.equal(oldReader.data.flows.length,0);
 assert.equal(sql(`select md5(payload::text) from research_private.recommendation_v2_acquisition_cache where id='${lease}'`),cacheBefore,'rollback Reader is read-only and keeps the additive receipt');
 assert.equal(fingerprint(),before,'cache writes never populate or relax the private flow table');
 // Exact rollback: omit the candidate adapter, retaining original empty input.
 assert.deepEqual(source,emptyEvidenceData());assert.equal(fingerprint(),before);
 summary={scope:'ISOLATED_SQL_RLS_NOT_PRODUCTION_AUTH',fresh_db:'PASS',anon:'DENY',free_premium_raw:'DENY',memory_integration:'PASS',existing_cache_rpc:'STORED_THEN_ALREADY_STORED',immutable_payload:'PASS',saved_report_reader:'PASS',jsonb_market_reread:'IDENTICAL_THREE_IDS',changed_authority_metadata:'DENIED',formal_business_writes:0,synthetic_cache_rows:1,security_diff:0,rollback:'PASS'};
} finally {
 if(owned){
  run(['rm','-f',name]);let absent=false;
  try{run(['inspect',name]);}catch(error){assert.equal(error.status,1);assert.match(error.stderr,/no such (?:object|container)/i);absent=true;}
  assert(absent,'OWNED_MARKET_FLOW_TEST_CONTAINER_STILL_EXISTS');
 }
}
console.log(JSON.stringify({...summary,cleanup:'VERIFIED_REMOVED'}));
