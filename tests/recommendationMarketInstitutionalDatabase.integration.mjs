// Disposable real SQL/RLS. All inserted values are SYNTHETIC, not Production.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizeMarketInstitutionalTwd, withMarketInstitutionalEvidence } from '../supabase/functions/_shared/recommendation-market-institutional-candidate.ts';
import { emptyEvidenceData } from '../supabase/functions/_shared/decision-v1-data.ts';
const name='ma-market-flow-candidate-'+process.pid;
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:2e6}).trim();
const sql=input=>run(['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],input);
try {
 // Bound the tiny disposable database to RAM; do not prune or resize the
 // developer's full Docker data disk or touch any existing test service.
 run(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=268435456','--env','POSTGRES_PASSWORD=isolated-only','postgres:17']);
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
 // Exact rollback: omit the candidate adapter, retaining original empty input.
 assert.deepEqual(source,emptyEvidenceData());assert.equal(fingerprint(),before);
 console.log(JSON.stringify({scope:'ISOLATED_SQL_RLS_NOT_PRODUCTION_AUTH',fresh_db:'PASS',anon:'DENY',free_premium_raw:'DENY',memory_integration:'PASS',business_writes:0,security_diff:0,rollback:'PASS'}));
} finally { try {run(['rm','-f','-v',name]);}catch{} }
