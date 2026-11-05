-- LOCAL CANDIDATE ONLY. Original readers and all data remain unchanged.
-- Every call executes the old reader first. This reduces wire payload, not database work.
begin;
do $member_delta_guard$
declare f jsonb;p pg_catalog.pg_proc;
begin
 if pg_catalog.to_regprocedure('public.get_daily_ai_member_research_delta_v1(text,text)') is not null
  then raise exception 'AI_MEMBER_DELTA_ALREADY_EXISTS';end if;
 for f in select value from pg_catalog.jsonb_array_elements($pinned_readers$[{"signature":"public.is_research_owner_v1()","hash":"eaf18ce70212175aa93b60e23b266978cb631cb98bda4c74169fd2ea06fd162b","acl":"{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}","security_definer":true},{"signature":"academy_private.access_v11()","hash":"6a3d6865188b13c70e37f23e4235e18c83ba993b1e619ba8e7536038088cd135","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true},{"signature":"vnext_private.ai_edition_rights_v1(text,timestamptz)","hash":"a1d17f43ddc8c19103d436f84aed6cd59710da9e6e96a4de09efdd714101a054","acl":"{postgres=X/postgres}","security_definer":true},{"signature":"public.get_daily_ai_member_research_v1()","hash":"75f25f11361c83e33297f4f7386339cdb959d02f4431a9571681eda59717cbc8","acl":"{postgres=X/postgres,authenticated=X/postgres}","security_definer":true}]$pinned_readers$::jsonb) loop
  select * into p from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure(f->>'signature');
  if p.oid is null or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex') is distinct from f->>'hash'
   then raise exception 'AI_MEMBER_DELTA_READER_BASELINE_DRIFT:%',f->>'signature';end if;
  if p.proacl::text is distinct from f->>'acl' or p.prosecdef is distinct from (f->>'security_definer')::boolean
   or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
   or pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' then raise exception 'AI_MEMBER_DELTA_READER_PRIVILEGE_DRIFT';end if;
 end loop;
end
$member_delta_guard$;
CREATE FUNCTION public.get_daily_ai_member_research_delta_v1(p_known_edition_id text, p_known_tier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare current_payload jsonb; current_edition jsonb; current_tier text; caller_id uuid; envelope jsonb;
begin
 -- Always execute the original reader first. Known values never grant access
 -- or bypass current membership, source-use, review, publication or expiry gates.
 current_payload:=public.get_daily_ai_member_research_v1();
 caller_id:=auth.uid();current_edition:=current_payload->'edition';current_tier:=current_payload->>'tier';
 if caller_id is null or current_payload->>'schema' is distinct from 'VNEXT_AI_MEMBER_EDITION_V1'
  or current_payload->'research_only' is distinct from 'true'::jsonb
  or current_tier is null or current_tier not in('free','premium','owner')
  then raise exception 'AI_MEMBER_DELTA_READER_CONTRACT' using errcode='42501';end if;
 envelope:=jsonb_build_object('schema','VNEXT_AI_MEMBER_DELTA_V1','user_id',caller_id,'tier',current_tier,
  'business_date',current_payload->'business_date','research_only',true,'edition',current_edition);
 if jsonb_typeof(current_edition)='object' and p_known_edition_id ~ '^[a-f0-9]{64}$'
  and current_edition->>'id'=p_known_edition_id and current_tier=p_known_tier then
  return envelope||jsonb_build_object('mode','UNCHANGED');
 end if;
 return envelope||jsonb_build_object('mode','FULL','payload',current_payload);
end
$function$;

revoke all on function public.get_daily_ai_member_research_delta_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_daily_ai_member_research_delta_v1(text,text) to authenticated;
do $member_delta_verify$
declare p pg_catalog.pg_proc;
begin
 select * into strict p from pg_catalog.pg_proc where oid='public.get_daily_ai_member_research_delta_v1(text,text)'::regprocedure;
 if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')<>'a23ac838e94bc1d5d244bd9b9577082a16817a31aa4557a2f24bd445d033ec78'
  or p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or p.proacl::text<>'{postgres=X/postgres,authenticated=X/postgres}'
  then raise exception 'AI_MEMBER_DELTA_RESULT_DRIFT';end if;
end
$member_delta_verify$;
commit;
