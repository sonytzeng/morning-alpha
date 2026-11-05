// Disposable PostgreSQL only: no production mutations, source grants or network.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const modulePath=process.env.MA_PGLITE_MODULE;
assert(modulePath?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(modulePath),db=new PGlite();await db.waitReady;
const here=new URL('.',import.meta.url),read=name=>readFileSync(new URL(name,here),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const manifest=JSON.parse(read('candidate-manifest.json')),baseline=read('live-definition.sql');
const candidate=read('allow-exact-sec-primary-documents.candidate.sql'),rollback=read('rollback.candidate.sql');
const signature=manifest.signature,SEC=manifest.exact_additional_documents;
const TIPO='https://www.tipo.gov.tw/tw/copyright/692-16653.html';
const SEC_SOURCE='https://www.sec.gov/Archives/edgar/data/1046179/000119312526125192/tsm-20251231.htm';
const treasury=['https://home.treasury.gov/treasury-daily-interest-rate-xml-feed','https://catalog.data.gov/dataset/interest-rate-statistics-daily-treasury-yield-curve-rates'];
let checks=0,phase='bootstrap';
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const call=async(basis,urls,sources=[SEC_SOURCE])=>(await db.query('select vnext_private.ai_use_primary_documents_v1($1,$2,$3) ok',[basis,urls,sources])).rows[0].ok;
const fingerprint=async()=>(await db.query(`select encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') hash,
 p.oid,p.proacl::text acl,p.provolatile,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner
 from pg_proc p where p.oid=$1::regprocedure`,[signature])).rows[0];
const snapshot=async()=>(await db.query('select jsonb_agg(to_jsonb(r) order by id) data from public.existing_review_rows r')).rows[0].data;
try{
 check(sha(baseline),manifest.live_definition_sha256,'Captured live definition bytes must match live fingerprint');
 check(sha(candidate),manifest.candidate_sql_sha256,'Forward candidate is exactly the reviewed file');
 check(sha(rollback),manifest.rollback_sql_sha256,'Rollback candidate is exactly the reviewed file');
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema vnext_private;grant usage on schema vnext_private to anon,authenticated,service_role;
 create table public.existing_review_rows(id int primary key,body jsonb);
 insert into public.existing_review_rows values(1,'{"state":"EXISTING_PASS","snapshot":"synthetic-1"}'),(2,'{"state":"EXISTING_PENDING","snapshot":"synthetic-2"}');`);
 await db.exec(baseline);
 await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');
 const original=await fingerprint(),records=await snapshot();
 check(original.hash,manifest.live_definition_sha256);check(original.acl,'{postgres=X/postgres}');
 const oldPredicate="u<>'https://www.federalreserve.gov/disclaimer.htm'";
 const newPredicate="u not in ('https://www.federalreserve.gov/disclaimer.htm',\n    "+SEC.map(url=>"'"+url+"'").join(',\n    ')+')';
 const expectedDefinition=baseline.replace(oldPredicate,newPredicate);
 check(baseline.split(oldPredicate).length,2,'Exactly one preimage predicate');
 check(sha(expectedDefinition),manifest.candidate_definition_sha256,'Every other live function byte is unchanged');
 check(read('candidate-definition.sql'),expectedDefinition);

 phase='capture existing behavior';
 const oldDocs=[null,[],[null],[TIPO],[TIPO,TIPO],['https://www.tipo.gov.tw/unknown'],
  ['https://www.twse.com.tw/zh/terms/use.html'],['https://www.twse.com.tw/terms?password=private'],
  ['https://www.twse.com.tw/terms?token=private'],['https://user:password@www.twse.com.tw/terms'],
  ['https://data.gov.tw/license','https://data.gov.tw/dataset/11549'],treasury,
  ['https://www.federalreserve.gov/disclaimer.htm',TIPO],Array.from({length:21},(_,i)=>TIPO+'?item='+i)];
 const bases=['FACT_ONLY_OWN_ANALYSIS','OPEN_LICENSE','EXPLICIT_PERMISSION','UNKNOWN',null];
 const sources=[null,[],[SEC_SOURCE],['https://www.twse.com.tw/test-facts'],['https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC'],['https://home.treasury.gov/treasury-daily-interest-rate-xml-feed']];
 const oldCases=[];
 for(const basis of bases)for(const docs of oldDocs)for(const source of sources)
  oldCases.push({basis,docs,source,result:await call(basis,docs,source)});
 for(const url of SEC)check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,url]),false,'Old host gate rejects SEC policy pages');

 phase='refuse altered body and privileges';
 await db.exec(baseline.replace(' select coalesce',' -- isolated body drift\n select coalesce'));
 await assert.rejects(()=>db.exec(candidate),/SEC_PRIMARY_DOCUMENT_BASELINE_DRIFT/);checks++;await db.exec('rollback');
 await db.exec(baseline);
 await db.exec('grant execute on function '+signature+' to service_role');
 await assert.rejects(()=>db.exec(candidate),/SEC_PRIMARY_DOCUMENT_PRIVILEGE_DRIFT/);checks++;await db.exec('rollback');
 await db.exec('revoke execute on function '+signature+' from service_role');

 phase='apply guarded candidate locally';
 await db.exec(candidate);
 const current=await fingerprint();check(current.hash,manifest.candidate_definition_sha256);
 check({...current,hash:original.hash},original,'OID, owner, ACL, volatility, invoker and search_path stay identical');
 check(await snapshot(),records,'Candidate never changes existing review data');
 for(const c of oldCases)check(await call(c.basis,c.docs,c.source),c.result,'Existing basis/source/document behavior stays identical');

 phase='exact SEC documents and unchanged basis gates';
 for(const url of SEC)check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,url]),true);
 check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,...SEC]),true);
 for(const basis of bases)check(await call(basis,SEC),false,'SEC documents alone never supply a new basis or source permission');
 check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,...SEC],['https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC']),false);
 check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,...SEC],['https://FINANCE.YAHOO.COM/quote/TSM']),false);
 check(await call('EXPLICIT_PERMISSION',[TIPO,...SEC],[SEC_SOURCE]),false,'SEC is not added to publisher permission roots');
 check(await call('OPEN_LICENSE',[...treasury,...SEC],['https://home.treasury.gov/treasury-daily-interest-rate-xml-feed']),true);
 check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,SEC[0],SEC[0]]),false,'Duplicate documents remain denied');
 check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,...SEC,null]),false);

 phase='reject near-match, credential and arbitrary SEC URLs';
 for(const url of SEC){
  const parsed=new URL(url),path=parsed.pathname;
  const denied=[url+'/',url+'?page=1',url+'?token=private',url+'?password=private',url+'?email=a@example.test',url+'#terms',url+'/other',
   url.replace('https:','http:'),url.replace('https:','HTTPS:'),url.replace('www.sec.gov','WWW.SEC.GOV'),
   url.replace('www.sec.gov','sec.gov'),url.replace('www.sec.gov','www.sec.gov.'),url.replace('www.sec.gov','www.sec.gov:443'),
   url.replace('www.sec.gov','sub.www.sec.gov'),url.replace('www.sec.gov','www.sec.gov.evil.test'),
   url.replace('www.sec.gov','www.sec.gov@evil.test'),url.replace('www.sec.gov','user:password@www.sec.gov'),
   'https://www.sec.gov'+path.replaceAll('-','%2D'),'https://www.sec.gov/'+path,url+' ',url+'\n',
   'https://www.sec.gov/Archives/edgar/data/1046179/another-document.htm','https://www.sec.gov/about/unreviewed-policy'];
  for(const wrong of denied)check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,wrong]),false,'Only exact approved document strings may be added');
 }

 phase='closed execution ACL, repeat refusal and exact rollback';
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);await assert.rejects(()=>call('FACT_ONLY_OWN_ANALYSIS',[TIPO,...SEC]),/permission denied/);checks++;await db.exec('reset role');
 }
 await assert.rejects(()=>db.exec(candidate),/SEC_PRIMARY_DOCUMENT_BASELINE_DRIFT/);checks++;await db.exec('rollback');
 check((await fingerprint()).hash,manifest.candidate_definition_sha256,'Rejected repeat leaves new function intact');
 await db.exec(rollback);check(await fingerprint(),original,'Guarded rollback restores the exact original function and ACL');
 check(await snapshot(),records);
 for(const url of SEC)check(await call('FACT_ONLY_OWN_ANALYSIS',[TIPO,url]),false);
 await assert.rejects(()=>db.exec(rollback),/SEC_PRIMARY_DOCUMENT_BASELINE_DRIFT/);checks++;await db.exec('rollback');
 await db.exec('drop function '+signature);
 await assert.rejects(()=>db.exec(candidate),/SEC_PRIMARY_DOCUMENT_BASELINE_MISSING/);checks++;await db.exec('rollback');
 const version=(await db.query('show server_version')).rows[0].server_version;
 const report={schema:'EXACT_SEC_PRIMARY_DOCUMENTS_LOCAL_SQL_RESULT_V1',result:'PASS',checks,server_version:version,
  old_behavior_cases:oldCases.length,exact_additional_documents:SEC.length,production_used:false,network_used:false,
  source_permissions_written:false,business_rows_changed:false,candidate_sql_sha256:manifest.candidate_sql_sha256,
  before_definition_sha256:manifest.live_definition_sha256,after_definition_sha256:manifest.candidate_definition_sha256};
 writeFileSync(new URL('local-sql-result.json',here),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({result:'FAIL',phase,checks,message:error.message,code:error.code}));process.exitCode=1;}
finally{await db.close();}
