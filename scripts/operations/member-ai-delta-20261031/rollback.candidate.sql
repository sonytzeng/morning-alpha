-- LOCAL ROLLBACK CANDIDATE ONLY: exact new RPC, no CASCADE or data writes.
begin;
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
drop function public.get_daily_ai_member_research_delta_v1(text,text);
commit;
