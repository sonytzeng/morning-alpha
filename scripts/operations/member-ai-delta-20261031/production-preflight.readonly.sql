-- Read-only metadata; no member impersonation, body output or data writes.
with expected(signature,definition_sha256,acl,security_definer) as (values
 ('public.is_research_owner_v1()','eaf18ce70212175aa93b60e23b266978cb631cb98bda4c74169fd2ea06fd162b','{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',true),
 ('academy_private.access_v11()','6a3d6865188b13c70e37f23e4235e18c83ba993b1e619ba8e7536038088cd135','{postgres=X/postgres,authenticated=X/postgres}',true),
 ('vnext_private.ai_edition_rights_v1(text,timestamptz)','a1d17f43ddc8c19103d436f84aed6cd59710da9e6e96a4de09efdd714101a054','{postgres=X/postgres}',true),
 ('public.get_daily_ai_member_research_v1()','75f25f11361c83e33297f4f7386339cdb959d02f4431a9571681eda59717cbc8','{postgres=X/postgres,authenticated=X/postgres}',true)
), reader_checks as (
 select e.signature,p.oid is not null and encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')=e.definition_sha256 hash_matches,
  p.proacl::text=e.acl acl_matches,p.prosecdef=e.security_definer and p.provolatile='s'
   and p.proconfig=array['search_path=""']::text[] and pg_get_userbyid(p.proowner)='postgres' metadata_matches
 from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), prerequisites as (
 select coalesce((select bool_and(hash_matches and acl_matches and metadata_matches) from reader_checks),false) old_readers_match,
  has_schema_privilege('authenticated','auth','USAGE') auth_schema_usage,
  has_function_privilege('authenticated','auth.uid()','EXECUTE') auth_uid_execute,
  exists(select from pg_trigger t where t.tgrelid='vnext_private.ai_research_editions'::regclass
   and t.tgname='immutable' and t.tgenabled in('O','A')
   and t.tgfoid='vnext_private.immutable_record()'::regprocedure
   and pg_get_triggerdef(t.oid)='CREATE TRIGGER immutable BEFORE DELETE OR UPDATE ON vnext_private.ai_research_editions FOR EACH ROW EXECUTE FUNCTION vnext_private.immutable_record()') edition_immutable
)
select jsonb_build_object(
 'ready_for_this_candidate',old_readers_match and auth_schema_usage and auth_uid_execute and edition_immutable
  and to_regprocedure('public.get_daily_ai_member_research_delta_v1(text,text)') is null,
 'old_readers_match',old_readers_match,'auth_schema_usage',auth_schema_usage,'auth_uid_execute',auth_uid_execute,
 'edition_immutable',edition_immutable,
 'new_rpc_absent',to_regprocedure('public.get_daily_ai_member_research_delta_v1(text,text)') is null,
 'reader_checks',(select jsonb_agg(to_jsonb(r) order by signature) from reader_checks r)) result
from prerequisites;
