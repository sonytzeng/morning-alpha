// Materialize a local-only candidate from the captured immutable live readers.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const here=new URL('.',import.meta.url),read=name=>readFileSync(new URL(name,here),'utf8');
const write=(name,value)=>writeFileSync(new URL(name,here),value);
assert(process.env.MA_PGLITE_MODULE?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const sha=s=>createHash('sha256').update(s).digest('hex');
try{
 const definition=read('wrapper-definition.sql');await db.exec(definition);
 const canonical=(await db.query("select pg_get_functiondef('public.get_daily_ai_member_research_delta_v1(text,text)'::regprocedure) definition")).rows[0].definition;
 write('wrapper-canonical-definition.sql',canonical);
 const signatures={is_research_owner_v1:'public.is_research_owner_v1()',access_v11:'academy_private.access_v11()',ai_edition_rights_v1:'vnext_private.ai_edition_rights_v1(text,timestamptz)',get_daily_ai_member_research_v1:'public.get_daily_ai_member_research_v1()'};
 const old=JSON.parse(read('live-baseline.json')).functions;
 const pins=old.map(f=>({signature:signatures[f.proname],hash:f.definition_sha256,acl:f.acl,security_definer:f.prosecdef}));
 assert.equal(pins.length,4);assert(pins.every(p=>p.signature));
 for(const f of old)assert.equal(sha(f.definition),f.definition_sha256);
 const hash=sha(canonical);
 const guard=`do $member_delta_guard$
declare f jsonb;p pg_catalog.pg_proc;
begin
 if pg_catalog.to_regprocedure('public.get_daily_ai_member_research_delta_v1(text,text)') is not null
  then raise exception 'AI_MEMBER_DELTA_ALREADY_EXISTS';end if;
 for f in select value from pg_catalog.jsonb_array_elements($pinned_readers$${JSON.stringify(pins)}$pinned_readers$::jsonb) loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(f->>'signature');
  if p.oid is null or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from f->>'hash'
   then raise exception 'AI_MEMBER_DELTA_READER_BASELINE_DRIFT:%',f->>'signature';end if;
  if p.proacl::text is distinct from f->>'acl' or p.prosecdef is distinct from (f->>'security_definer')::boolean
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
   or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' then raise exception 'AI_MEMBER_DELTA_READER_PRIVILEGE_DRIFT';end if;
 end loop;
end
$member_delta_guard$;
`;
 const post=`do $member_delta_verify$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='public.get_daily_ai_member_research_delta_v1(text,text)'::regprocedure;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')<>'${hash}'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text<>'{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'AI_MEMBER_DELTA_RESULT_DRIFT';end if;
end
$member_delta_verify$;
`;
 const sql='-- LOCAL CANDIDATE ONLY. Original readers and all data remain unchanged.\n-- Every call executes the old reader first. This reduces wire payload, not database work.\nbegin;\n'+guard+definition+'\nrevoke all on function public.get_daily_ai_member_research_delta_v1(text,text) from public,anon,authenticated,service_role;\ngrant execute on function public.get_daily_ai_member_research_delta_v1(text,text) to authenticated;\n'+post+'commit;\n';
 const rollback='-- LOCAL ROLLBACK CANDIDATE ONLY: exact new RPC, no CASCADE or data writes.\nbegin;\n'+post+'drop function public.get_daily_ai_member_research_delta_v1(text,text);\ncommit;\n';
 write('member-ai-delta.candidate.sql',sql);write('rollback.candidate.sql',rollback);
 const manifest={schema:'MEMBER_AI_DELTA_CANDIDATE_V1',new_signature:'public.get_daily_ai_member_research_delta_v1(text,text)',wrapper_definition_sha256:hash,candidate_sql_sha256:sha(sql),rollback_sql_sha256:sha(rollback),old_reader:'public.get_daily_ai_member_research_v1()',old_reader_definition_sha256:pins.find(p=>p.signature==='public.get_daily_ai_member_research_v1()').hash,pinned_readers:pins,security:'INVOKER',execute_grants:['postgres','authenticated'],anonymous_grant:false,original_readers_modified:false,old_reader_executes_on_every_request:true,network_payload_optimization_only:true,db_cpu_reduction_claimed:false,production_10000_member_capacity_proven:false,permission_cache:false,production_change_performed:false,response_contract:{schema:'VNEXT_AI_MEMBER_DELTA_V1',common_fields:['mode','user_id','tier','business_date','research_only','edition'],unchanged:'Only when current nonnull edition.id and server tier both equal known values; no payload/cards field.',full:'payload is the complete unmodified original-reader response, including null edition after withdrawal or expiry.'},client_cache_binding:['user_id','Auth generation','business_date','edition.id','tier','edition.expires_at'],client_rules:['Keep cards only in memory.','FULL replaces all cached data, including clearing null editions.','UNCHANGED requires a current cache with exact server user/tier/date/edition/expiry binding.','No cache, mismatch or malformed UNCHANGED must clear and request known=null.','Identity change, authorization denial, expiry and Taipei date change invalidate the cache.']};
 write('candidate-manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({wrapper_sha256:hash,candidate_sha256:sha(sql)}));
}catch(error){console.error(JSON.stringify({message:error.message,code:error.code}));process.exitCode=1;}
finally{await db.close();}
